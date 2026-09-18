// 가족 멤버별 "임시 업로드 상태" 컴포저블.
//
// 핵심 규칙
//  - 업로드(Upload) ≠ 저장(Save). 업로드는 파싱/검증 결과를 메모리에만 담는다.
//  - 멤버마다 완전히 독립된 임시 슬롯을 가진다: { [memberId]: { file, data, status, ... } }
//  - 선택 멤버를 바꿔도 다른 멤버의 임시 상태는 절대 사라지지 않는다.
//  - 저장(Save)은 useExpenses().saveMemberTransactions()로 "해당 멤버 데이터만" 영속화한다.
//  - 리셋(Reset)은 그 멤버의 임시 상태만 비운다. 이미 저장된 데이터는 건드리지 않는다.
//
// 기존 아키텍처(모듈 스코프 상태 + use* 접근자)를 그대로 따르며 새 상태관리 라이브러리는 도입하지 않는다.
import { computed, reactive } from 'vue'
import { joinURL } from 'ufo'
import { tryUseNuxtApp } from '#app'
import { parseExpenseFile, isSupportedFileName, SUPPORTED_EXTENSIONS } from '~/utils/parseExcel'
import { applyPaymentMappings, useExpenses, type MemberSaveResult, type SaveMode } from '~/composables/useExpenses'
import { useFamily } from '~/composables/useFamily'
import { useTaxonomies } from '~/composables/useTaxonomies'
import type { ParseResult, Transaction } from '~/utils/types'

export type UploadStatus = 'idle' | 'parsing' | 'ready' | 'error' | 'saved'

export interface MemberUpload {
  /** 업로드된 파일명 (없으면 '') */
  fileName: string
  fileSize: number
  status: UploadStatus
  /** 사용자에게 보여줄 오류 메시지 */
  error: string
  /** 파싱 경고 (열 인식 실패 등) */
  warnings: string[]
  /** 파싱된 거래 (임시 — 저장 전) */
  transactions: Transaction[]
  /** 원본 시트의 전체 행 수 */
  totalRows: number
  /** 감지된 컬럼 매핑 */
  detectedColumns: Record<string, string>
  /** 실제로 읽은 시트 이름 */
  sheetName: string
  /** 헤더로 인식한 행 번호 (1-based) */
  headerRow: number
  /** 헤더 행의 원본 셀 값 */
  headers: string[]
  /** 텍스트 파일일 때 사용한 인코딩 */
  encoding: string
  /** 건너뛴 행 수 */
  skipped: { noDate: number; noAmount: number; blank: number }
  /** 환불로 분류한 건수 (짝이 맞은 음수 지출) */
  refundCount: number
  /** 음수지만 짝이 없어 환불로 분류하지 않은 건수 */
  unmatchedNegativeCount: number
  /** 파일 내부 중복(날짜+내용+금액 동일) 건수 */
  duplicateInFile: number
  /** 저장 방식 — 교체(기본) / 추가 */
  saveMode: SaveMode
  /** 마지막 저장 결과 메시지 */
  message: string
  savedAt: Date | null
  savedCount: number
}

export const ACCEPT_ATTR = SUPPORTED_EXTENSIONS.join(',')

/** memberId → 임시 업로드 상태 */
const uploads = reactive<Record<string, MemberUpload>>({})

function emptyUpload(): MemberUpload {
  return {
    fileName: '',
    fileSize: 0,
    status: 'idle',
    error: '',
    warnings: [],
    transactions: [],
    totalRows: 0,
    detectedColumns: {},
    sheetName: '',
    headerRow: 0,
    headers: [],
    encoding: '',
    skipped: { noDate: 0, noAmount: 0, blank: 0 },
    refundCount: 0,
    unmatchedNegativeCount: 0,
    duplicateInFile: 0,
    saveMode: 'replace',
    message: '',
    savedAt: null,
    savedCount: 0
  }
}

/** 멤버의 임시 상태를 얻는다(없으면 생성). */
function uploadOf(memberId: string): MemberUpload {
  if (!uploads[memberId]) uploads[memberId] = emptyUpload()
  return uploads[memberId]
}

function dupKey(t: Transaction): string {
  return `${t.date.toISOString().slice(0, 10)}|${t.description}|${t.amount}`
}

function countDuplicates(txs: Transaction[]): number {
  const seen = new Set<string>()
  let dup = 0
  for (const t of txs) {
    const k = dupKey(t)
    if (seen.has(k)) dup++
    else seen.add(k)
  }
  return dup
}

/**
 * 파일 하나를 특정 멤버 슬롯에 업로드한다. (파싱 → 검증 → 미리보기까지, 저장은 하지 않음)
 */
async function handleFile(memberId: string | null | undefined, file: File): Promise<void> {
  if (!memberId) return
  const slot = uploadOf(memberId)

  // 1) 파일 형식 검증
  if (!isSupportedFileName(file.name)) {
    Object.assign(slot, emptyUpload(), {
      fileName: file.name,
      fileSize: file.size,
      status: 'error' as UploadStatus,
      saveMode: slot.saveMode,
      error: `지원하지 않는 파일 형식입니다. ${SUPPORTED_EXTENSIONS.join(' / ')} 파일만 업로드할 수 있습니다.`
    })
    return
  }

  Object.assign(slot, emptyUpload(), {
    fileName: file.name,
    fileSize: file.size,
    status: 'parsing' as UploadStatus,
    saveMode: slot.saveMode
  })

  let result: ParseResult
  try {
    // 환불 짝짓기는 "지출 유형" 거래만 대상이다 — 카테고리 관리의 유형 설정을 주입한다.
    const tax = useTaxonomies()
    result = await parseExpenseFile(file, {
      isExpenseCategory: (name) => tax.categoryType(name) === '지출'
    })
  } catch (e) {
    // 2) 파싱 실패
    slot.status = 'error'
    slot.error = `엑셀 파일을 읽는 중 오류가 발생했습니다: ${(e as Error).message}`
    return
  }

  slot.warnings = result.warnings
  slot.detectedColumns = result.detectedColumns
  slot.totalRows = result.totalRows
  slot.sheetName = result.sheetName ?? ''
  slot.headerRow = result.headerRow ?? 0
  slot.headers = result.headers ?? []
  slot.encoding = result.encoding ?? ''
  slot.skipped = result.skipped ?? { noDate: 0, noAmount: 0, blank: 0 }
  slot.refundCount = result.refundCount ?? 0
  slot.unmatchedNegativeCount = result.unmatchedNegativeCount ?? 0

  const headerHint = slot.headers.length > 0
    ? ` 파일에서 인식한 헤더는 [${slot.headers.slice(0, 12).join(', ')}] 입니다.`
    : ' 파일에서 헤더 행을 찾지 못했습니다.'

  // 3) 필수 열 누락
  const missing: string[] = []
  if (!result.detectedColumns.date) missing.push('날짜')
  if (!result.detectedColumns.amount) missing.push('금액')
  if (missing.length > 0) {
    slot.status = 'error'
    slot.error = `필수 열(${missing.join(', ')})을 찾지 못했습니다.${headerHint}`
    return
  }

  // 4) 유효 데이터 없음 — 왜 전부 걸러졌는지 함께 알려준다
  if (result.transactions.length === 0) {
    const why: string[] = []
    if (slot.skipped.noDate > 0) why.push(`날짜를 해석하지 못한 행 ${slot.skipped.noDate.toLocaleString('ko-KR')}개`)
    if (slot.skipped.noAmount > 0) why.push(`금액이 없거나 0인 행 ${slot.skipped.noAmount.toLocaleString('ko-KR')}개`)
    slot.status = 'error'
    slot.error = why.length > 0
      ? `유효한 거래를 찾지 못했습니다. (${why.join(' / ')})${headerHint}`
      : `유효한 거래 데이터가 없습니다. 데이터 행이 비어 있는지 확인해 주세요.${headerHint}`
    return
  }

  // 결제수단 → 카테고리 매핑 적용.
  // 파싱이 끝난 뒤(= 환불 짝짓기까지 끝난 뒤)에 적용하므로 환불로 분류된 거래는 보호되며,
  // 미리보기에도 실제로 저장될 카테고리가 그대로 보인다. 매핑이 없으면 원본 그대로다.
  const mapped = applyPaymentMappings(result.transactions)

  slot.transactions = mapped
  slot.duplicateInFile = countDuplicates(mapped)
  slot.status = 'ready'
  slot.error = ''
  slot.message = ''
}

/**
 * public/ 자산의 실제 경로를 만든다.
 *
 * GitHub Pages(Project Pages)에 올리면 앱이 '/ExpenseTracker/' 아래에 놓이므로
 * '/sample-expenses.csv' 같은 절대경로는 도메인 루트를 가리켜 404가 난다.
 * 라우터 링크(NuxtLink)는 baseURL을 자동으로 붙여 주지만 fetch는 그렇지 않다.
 *
 * tryUseNuxtApp()을 쓰는 이유: 이 함수는 setup이 아니라 이벤트 핸들러에서 불리므로
 * Nuxt 컨텍스트가 없을 수 있다. 없으면 루트 배포로 보고 '/'로 떨어진다.
 */
function publicAssetUrl(path: string): string {
  const base = tryUseNuxtApp()?.$config?.app?.baseURL ?? '/'
  return joinURL(base, path)
}

/** 샘플 CSV를 특정 멤버 슬롯으로 불러온다. (기존 "샘플 데이터 불러오기" 기능 유지) */
async function loadSample(memberId: string | null | undefined): Promise<void> {
  if (!memberId) return
  const slot = uploadOf(memberId)
  slot.status = 'parsing'
  slot.error = ''
  try {
    const res = await fetch(publicAssetUrl('sample-expenses.csv'))
    if (!res.ok) throw new Error('샘플 파일을 불러올 수 없습니다.')
    const blob = await res.blob()
    await handleFile(memberId, new File([blob], 'sample-expenses.csv', { type: 'text/csv' }))
  } catch (e) {
    slot.status = 'error'
    slot.error = `샘플 데이터를 불러오지 못했습니다: ${(e as Error).message}`
  }
}

/**
 * 임시 데이터를 해당 멤버에게만 저장한다.
 * 다른 멤버의 임시/영속 데이터는 어떤 경우에도 영향을 받지 않는다.
 */
function save(memberId: string | null | undefined): MemberSaveResult {
  const fallback: MemberSaveResult = { ok: false, count: 0, total: 0, replaced: 0, skipped: 0 }
  if (!memberId) return { ...fallback, reason: '가족 구성원을 먼저 선택해 주세요.' }

  const slot = uploadOf(memberId)
  if (slot.status !== 'ready' || slot.transactions.length === 0) {
    const reason = slot.status === 'error'
      ? (slot.error || '검증에 실패한 파일은 저장할 수 없습니다.')
      : '저장할 업로드 데이터가 없습니다.'
    slot.message = reason
    return { ...fallback, reason }
  }

  const { saveMemberTransactions } = useExpenses()
  let r: MemberSaveResult
  try {
    // reactive 프록시를 그대로 넘기지 않도록 원본 형태로 복사
    const plain = slot.transactions.map((t) => ({ ...t }))
    r = saveMemberTransactions(memberId, plain, slot.fileName, slot.saveMode)
  } catch (e) {
    r = { ...fallback, reason: (e as Error).message }
  }

  if (!r.ok) {
    slot.message = `저장 실패: ${r.reason ?? '알 수 없는 오류'}`
    return r
  }

  slot.status = 'saved'
  slot.savedAt = new Date()
  slot.savedCount = r.count
  const parts = [`저장 완료 · ${r.count.toLocaleString('ko-KR')}건`]
  if (r.replaced > 0) parts.push(`기존 ${r.replaced.toLocaleString('ko-KR')}건 교체`)
  if (r.skipped > 0) parts.push(`중복 ${r.skipped.toLocaleString('ko-KR')}건 제외`)
  slot.message = parts.join(' · ')
  return r
}

/**
 * 해당 멤버의 임시 업로드 상태만 초기화한다.
 * 이미 저장된 가계부 데이터는 삭제하지 않는다(삭제는 별도 기능).
 */
function reset(memberId: string | null | undefined): void {
  if (!memberId) return
  const keepMode = uploads[memberId]?.saveMode ?? 'replace'
  uploads[memberId] = { ...emptyUpload(), saveMode: keepMode }
}

/** 모든 멤버의 임시 상태 초기화 (디버그/백업 복원 후 정리용) */
function resetAll(): void {
  for (const k of Object.keys(uploads)) delete uploads[k]
}

export function useMemberUploads() {
  const fam = useFamily()

  /** 현재 업로드 대상 멤버의 임시 상태 (대상이 없으면 null) */
  const currentUpload = computed<MemberUpload | null>(() => {
    const id = fam.uploadTargetMemberId.value
    return id ? uploadOf(id) : null
  })

  /** 임시 업로드(미저장)를 가진 멤버 수 — 대상 전환 시 유실 방지 안내용 */
  const pendingMemberIds = computed<string[]>(() =>
    Object.keys(uploads).filter((id) => uploads[id]?.status === 'ready')
  )

  return {
    uploads,
    uploadOf,
    currentUpload,
    pendingMemberIds,
    handleFile,
    loadSample,
    save,
    reset,
    resetAll,
    ACCEPT_ATTR
  }
}
