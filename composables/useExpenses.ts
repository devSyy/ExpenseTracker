// 대시보드 거래 컴포저블 — 영속화는 transactionsRepo에 위임.
// 비영속 상태(필터, 경고, 검출 컬럼 등)만 이 모듈에서 관리한다.
import { computed, reactive, ref, watch } from 'vue'
import { classifyCategory, deriveFields } from '~/utils/classify'
import { incomeExpenseRepo } from '~/repositories/incomeExpenseRepository'
import {
  transactionsRepo,
  transactionsMetaRepo,
  saveTransactions as repoSaveTransactions,
  clearTransactions as repoClearTransactions,
  memberMeta as repoMemberMeta,
  serializeTransactions,
  type MetaShape,
  type MemberMeta
} from '~/repositories/transactionsRepository'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { useFamily } from '~/composables/useFamily'
import { REFUND_CATEGORY } from '~/utils/types'
import type {
  Category,
  CostType,
  ParseResult,
  PaymentMethod,
  Transaction
} from '~/utils/types'

interface Filters {
  year: 'all' | number
  month: 'all' | number          // 1..12
  category: 'all' | Category
  payment: 'all' | PaymentMethod
  costType: 'all' | CostType
  search: string
}

// 영속 상태
const transactions = transactionsRepo.state

// 비영속 상태
const warnings = ref<string[]>([])
const detectedColumns = ref<Record<string, string>>({})
const fileName = ref<string>(transactionsMetaRepo.state.value?.fileName ?? '')
const loadedAt = ref<Date | null>(transactions.value.length > 0 ? new Date() : null)
const lastSavedAt = ref<Date | null>(
  transactionsMetaRepo.state.value?.savedAt ? new Date(transactionsMetaRepo.state.value.savedAt) : null
)

// ── 미저장 변경 추적 ──
//
// 저장은 명시적이다(autoPersist:false). 그래서 "화면에 보이는 값"과 "저장된 값"이
// 갈라질 수 있고, 그 상태로 새로고침하면 대시보드가 옛 저장값으로 되돌아간다.
// 편집 함수마다 플래그를 세우면 새 편집 경로가 생길 때 빠뜨리기 쉬우므로,
// 거래 배열 교체를 한 곳에서 감시한다. (모든 편집 함수는 배열을 통째로 교체한다)
// flush:'sync' — 저장 직후 markSaved()가 이 감시자보다 뒤에 실행되도록 보장한다.
const unsavedChanges = ref(false)
watch(transactions, () => { unsavedChanges.value = true }, { flush: 'sync' })

/** 메모리 = 저장소 상태로 표시 */
function markSaved() {
  unsavedChanges.value = false
}

/** 저장 시점의 멤버별 건수 (memberId → 건수) — 저장 메타를 실제 데이터와 맞추는 데 쓴다 */
function memberCountsOf(txs: Transaction[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const t of txs) {
    const owner = ownerOf(t)
    if (!owner) continue
    counts[owner] = (counts[owner] ?? 0) + 1
  }
  return counts
}

// ── 기간 필터 기본값 ──
// 페이지를 열 때의 실제 날짜를 기준으로 "올해 / 이번 달"을 기본 선택한다.
// 특정 연·월을 하드코딩하지 않으므로 해가 바뀌거나 달이 바뀌면 자동으로 따라간다.
function currentYear(): number { return new Date().getFullYear() }
function currentMonth(): number { return new Date().getMonth() + 1 }

/** 기간 필터를 현재 연·월로 되돌린다 (여러 곳에서 동일한 기본값을 쓰기 위한 단일 지점) */
function defaultPeriodFilters(): { year: number; month: number } {
  return { year: currentYear(), month: currentMonth() }
}

const filters = reactive<Filters>({
  ...defaultPeriodFilters(),
  category: 'all',
  payment: 'all',
  costType: 'all',
  search: ''
})

/** 거래가 "지출 계산 제외" 상태인지 — 값이 없으면(구버전 포함) 포함(false)이 기본 */
export function isExcluded(t: Transaction): boolean {
  return t.excluded === true
}

/**
 * 수입 카테고리에 속한 거래인지.
 * 유형의 단일 진실의 원천은 useTaxonomies().categoryType() 이므로 그것만 본다
 * (카테고리 유형을 설정에서 바꾸면 이 판정도 함께 따라간다).
 */
export function isIncomeTransaction(t: Transaction): boolean {
  return useTaxonomies().isIncomeCategory(t.category)
}

/**
 * 수입 거래는 "지출 계산 제외"를 항상 켠 상태로 유지한다 (사용자가 끌 수 없다).
 *
 * 강제 지점을 편집 함수마다 두면 새 경로(엑셀 업로드·수기 추가·카테고리 변경·
 * 설정에서의 유형 변경 등)가 생길 때 빠뜨리기 쉬우므로, 거래 배열과 카테고리 유형
 * 두 가지를 한 곳에서 감시해 정규화한다. 이미 켜져 있으면 아무것도 하지 않으므로
 * (멱등) 자기 자신을 다시 트리거해도 즉시 멈춘다.
 */
let enforcingIncomeExclusion = false
function enforceIncomeExclusion(): void {
  if (enforcingIncomeExclusion) return
  enforcingIncomeExclusion = true
  try {
    const tax = useTaxonomies()
    let changed = 0
    const next = transactions.value.map((t) => {
      if (t.excluded === true) return t
      if (!tax.isIncomeCategory(t.category)) return t
      changed++
      return { ...t, excluded: true }
    })
    if (changed > 0) transactions.value = next
  } finally {
    enforcingIncomeExclusion = false
  }
}

// 거래가 바뀌거나(업로드·편집·로드) 카테고리 유형이 바뀔 때마다 정규화한다.
watch(
  [transactions, () => useTaxonomies().categories.value],
  () => enforceIncomeExclusion(),
  { flush: 'sync', immediate: true }
)

/**
 * 환불로 분류된 거래인지.
 * 음수라고 무조건 true가 아니다 — 지출 유형이면서 같은 금액의 양수 지출과 짝이 맞은 것만 해당.
 */
export function isRefund(t: Transaction): boolean {
  return t.refund === true
}

/**
 * 거래의 **현재 카테고리**가 '환불'인지.
 *
 * isRefund()는 엑셀 업로드 시점의 짝 매칭 결과(refund 플래그)를 본다. 반면 사용자가
 * 나중에 카테고리를 직접 바꾸면 플래그는 그대로 남아 실제 카테고리와 어긋난다.
 * 화면 표시(예: 금액 취소선)는 언제나 "지금 이 거래가 무슨 카테고리인가"를 따라야 하므로
 * 플래그가 아니라 category 값으로 판정한다. 카테고리 변경/필터/페이지 이동/새로고침
 * 어느 경로로 와도 결과가 동일하다.
 */
export function isRefundCategory(t: Transaction): boolean {
  return t.category === REFUND_CATEGORY
}

/** 원본 금액이 음수였는지 (환불로 분류되지 않은 음수도 포함) */
export function isNegativeAmount(t: Transaction): boolean {
  return t.negativeAmount === true
}

/**
 * 금액 계산에 반영되는 거래인지.
 * - 지출 계산 제외 플래그가 켜진 거래: 제외
 * - 음수 금액 거래: 제외 (환불로 분류됐든 아니든 "쓴 돈"이 아니다)
 */
function countsTowardTotals(t: Transaction): boolean {
  return !isExcluded(t) && !isNegativeAmount(t)
}

/**
 * 필터를 통과한 모든 거래 (지출 계산 제외 항목 **포함**).
 * 거래 내역 테이블처럼 "제외된 거래도 보여야 하는" 화면에서만 사용한다.
 */
const filteredAll = computed<Transaction[]>(() => {
  // 비활성화(숨김) 카테고리 거래는 모든 화면에서 제외
  const tax = useTaxonomies()
  const fam = useFamily()
  const hiddenCats = new Set(tax.categories.value.filter((c) => c.hidden).map((c) => c.name))
  const q = filters.search.trim().toLowerCase()
  return transactions.value.filter((t) => {
    // 활성 멤버 필터 (memberId 없으면 primary 소속으로 간주 — 레거시 호환)
    if (!fam.isMemberActive(t.memberId)) return false
    if (hiddenCats.has(t.category)) return false
    if (filters.year !== 'all' && t.year !== filters.year) return false
    if (filters.month !== 'all' && t.month !== filters.month) return false
    if (filters.category !== 'all' && t.category !== filters.category) return false
    if (filters.payment !== 'all' && t.paymentMethod !== filters.payment) return false
    if (filters.costType !== 'all' && t.costType !== filters.costType) return false
    if (q && !(`${t.description} ${t.category} ${t.paymentMethod}`.toLowerCase().includes(q))) return false
    return true
  })
})

/**
 * 지출 계산의 단일 소스.
 * KPI·차트·카테고리/결제수단 집계 등 **모든 지출 계산은 이 목록만 사용**한다.
 *
 * 세 가지를 여기 한 곳에서 걸러낸다:
 *  1) 지출 계산 제외 플래그가 켜진 거래
 *  2) **음수 금액** 거래 (환불로 분류된 건 포함) — 쓴 돈이 아니므로 지출이 아니다
 *  3) **수입 카테고리**로 분류된 거래 (카테고리 관리에서 유형을 '수입'으로 설정한 것)
 * 덕분에 집계 컴포넌트를 따로 수정하지 않아도 모든 계산이 자동으로 세 규칙을 존중한다.
 */
const filtered = computed<Transaction[]>(() => {
  const tax = useTaxonomies()
  return filteredAll.value.filter((t) => countsTowardTotals(t) && tax.categoryType(t.category) === '지출')
})

/**
 * 수입 카테고리로 분류된 거래.
 *
 * 수입 거래는 위 규칙에 따라 excluded가 **항상 true**다. 그 플래그는 "지출 계산에서 뺀다"는
 * 뜻일 뿐 수입 집계와는 무관하므로, 여기서는 excluded를 보지 않는다.
 * (음수 금액 거래는 지출 쪽과 동일하게 뺀다 — 실제로 들어온 돈이 아니다)
 */
const incomeFiltered = computed<Transaction[]>(() => {
  const tax = useTaxonomies()
  return filteredAll.value.filter((t) => !isNegativeAmount(t) && tax.categoryType(t.category) === '수입')
})

/** 수입 합계 — 수입 카테고리 거래의 금액 합 */
const incomeTotal = computed<number>(() =>
  incomeFiltered.value.reduce((s, t) => s + (Number(t.amount) || 0), 0)
)
/** 지출 합계 */
const expenseTotal = computed<number>(() =>
  filtered.value.reduce((s, t) => s + (Number(t.amount) || 0), 0)
)
/** 순수익 = 수입 − 지출 */
const netTotal = computed<number>(() => incomeTotal.value - expenseTotal.value)

/** 현재 필터 범위의 환불 거래 수 */
const refundCount = computed<number>(() => filteredAll.value.reduce((n, t) => n + (isRefund(t) ? 1 : 0), 0))

/** 환불로 합계에 반영되지 않은 금액 */
const refundAmount = computed<number>(() =>
  filteredAll.value.reduce((s, t) => s + (isRefund(t) ? (Number(t.amount) || 0) : 0), 0)
)

/** 음수지만 환불로 분류되지 않은 (짝이 없는) 거래 수 */
const unmatchedNegativeCount = computed<number>(() =>
  filteredAll.value.reduce((n, t) => n + (isNegativeAmount(t) && !isRefund(t) ? 1 : 0), 0)
)

/**
 * "지출 계산 제외" 요약 — **사용자가 직접 제외한 지출 거래만** 센다.
 * 수입 거래는 자동으로 항상 제외 상태이므로 여기 포함하면 요약이 늘 부풀어 의미를 잃는다.
 */
function isUserExcludedExpense(t: Transaction): boolean {
  return isExcluded(t) && !useTaxonomies().isIncomeCategory(t.category)
}

/** 현재 필터 범위에서 "지출 계산 제외"로 표시된 거래 수 */
const excludedCount = computed<number>(() =>
  filteredAll.value.reduce((n, t) => n + (isUserExcludedExpense(t) ? 1 : 0), 0)
)

/** 현재 필터 범위에서 제외 처리되어 합계에 반영되지 않은 금액 */
const excludedAmount = computed<number>(() =>
  filteredAll.value.reduce((s, t) => s + (isUserExcludedExpense(t) ? (Number(t.amount) || 0) : 0), 0)
)

const availableYears = computed<number[]>(() => {
  const s = new Set<number>()
  transactions.value.forEach((t) => s.add(t.year))
  // 기본값이 현재 연도이므로, 해당 연도 데이터가 아직 없어도 선택지에 항상 포함한다.
  s.add(currentYear())
  return Array.from(s).sort()
})

/** 선택된 연도(또는 전체)에서 데이터가 있는 월(1..12) 목록 */
const availableMonths = computed<number[]>(() => {
  const s = new Set<number>()
  for (const t of transactions.value) {
    if (filters.year !== 'all' && t.year !== filters.year) continue
    s.add(t.month)
  }
  // 현재 연도를 보고 있을 때는 이번 달을 항상 선택지에 포함한다.
  if (filters.year === 'all' || filters.year === currentYear()) s.add(currentMonth())
  return Array.from(s).sort((a, b) => a - b)
})

/** 현재 기간 필터가 적용된 상태인지 (전체 기간이 아닌지) */
const hasPeriodFilter = computed<boolean>(() => filters.year !== 'all' || filters.month !== 'all')

/** 기간 필터를 해제해 전체 기간을 본다 */
function clearPeriodFilter() {
  filters.year = 'all'
  filters.month = 'all'
}

/** 기간 필터를 현재 연·월로 되돌린다 */
function resetPeriodFilter() {
  const p = defaultPeriodFilters()
  filters.year = p.year
  filters.month = p.month
}

/**
 * @deprecated 전체 거래를 파싱 결과로 "교체"하는 레거시 경로.
 * 멤버별 독립 저장을 위해 업로드는 useMemberUploads()의 임시 상태 → saveMemberTransactions() 경로를 사용한다.
 * (외부 호환을 위해 남겨두지만 앱 내부에서는 더 이상 호출하지 않는다.)
 */
function setParseResult(r: ParseResult, name: string) {
  // 신규로 파싱된 거래는 모두 현재 primary 멤버로 태깅
  const fam = useFamily()
  const primaryId = fam.primaryMemberId.value ?? undefined
  transactions.value = r.transactions.map((t) => ({ ...t, memberId: t.memberId ?? primaryId }))
  warnings.value = r.warnings
  detectedColumns.value = r.detectedColumns
  fileName.value = name
  loadedAt.value = new Date()
  const period = defaultPeriodFilters()
  filters.year = period.year
  filters.month = period.month
  filters.category = 'all'
  filters.payment = 'all'
  filters.costType = 'all'
  filters.search = ''
  registerDiscoveredTaxonomies(r.transactions)
}

function registerDiscoveredTaxonomies(txs: Transaction[]) {
  const tax = useTaxonomies()
  const cats = new Set<string>()
  const pays = new Set<string>()
  for (const t of txs) {
    if (t.category) cats.add(t.category)
    if (t.paymentMethod) pays.add(t.paymentMethod)
  }
  for (const c of cats) tax.addCategory(c)
  for (const p of pays) tax.addPayment(p)
}

function reset() {
  transactionsRepo.reset()   // 저장소도 함께 비운다 (autoPersist:false → storage.remove)
  warnings.value = []
  detectedColumns.value = {}
  fileName.value = ''
  loadedAt.value = null
  markSaved()
}

// ── 거래 단위 편집 ──
type EditablePatch = Partial<Pick<Transaction, 'category' | 'paymentMethod' | 'costType'>>

function updateTransaction(id: string, patch: EditablePatch): boolean {
  const idx = transactions.value.findIndex((t) => t.id === id)
  if (idx === -1) return false
  const next = transactions.value.slice()
  next[idx] = { ...next[idx], ...patch }
  transactions.value = next
  return true
}

function updateByDescription(description: string, patch: EditablePatch): number {
  if (!description) return 0
  let count = 0
  const next = transactions.value.map((t) => {
    if (t.description === description) { count++; return { ...t, ...patch } }
    return t
  })
  if (count > 0) transactions.value = next
  return count
}

// ── 지출 계산 제외 플래그 ──
//
// 항상 **단건 전용**이다. 내용·결제수단이 같은 다른 거래는 어떤 경우에도 함께 바뀌지 않는다
// (배열에서 해당 인덱스 1개만 교체하므로 구조적으로 불가능).

export interface ExcludeUpdateResult {
  ok: boolean
  /** 적용된 값 */
  excluded?: boolean
  /** 실제로 값이 바뀌었는지 (이미 같은 값이면 false) */
  changed?: boolean
  reason?: string
}

/**
 * 한 거래의 "지출 계산 제외" 플래그를 설정한다.
 * 거래는 삭제되지 않으며 목록에는 계속 표시된다. 실패 시 상태를 원복한다.
 */
function setExcluded(id: string, excluded: boolean): ExcludeUpdateResult {
  const idx = transactions.value.findIndex((t) => t.id === id)
  if (idx === -1) return { ok: false, reason: '거래를 찾을 수 없습니다. 목록을 새로고침해 주세요.' }

  const current = transactions.value[idx]!
  // 수입 거래는 항상 제외 상태다 — 해제 요청은 무시한다(UI에서도 체크박스가 비활성).
  if (isIncomeTransaction(current)) return { ok: true, excluded: true, changed: false }

  const next = excluded === true
  if (isExcluded(current) === next) return { ok: true, excluded: next, changed: false }

  const snapshot = transactions.value
  try {
    const arr = snapshot.slice()
    arr[idx] = { ...current, excluded: next } // 해당 인덱스 1건만 교체
    transactions.value = arr
    return { ok: true, excluded: next, changed: true }
  } catch (e) {
    transactions.value = snapshot // 롤백 — 실패 시 UI가 잘못 갱신되지 않게
    return { ok: false, reason: (e as Error).message }
  }
}

export interface BulkExcludeResult {
  ok: boolean
  /** 실제로 값이 바뀐 건수 */
  changed: number
  reason?: string
}

/**
 * 여러 거래의 "지출 계산 제외" 플래그를 한 번에 설정한다. (표의 전체 선택용)
 *
 * 대상은 **넘겨받은 id 목록으로만** 정해진다. 목록에 없는 거래는 원본 객체를 그대로 반환하므로
 * 내용·결제수단이 같아도 영향받지 않으며, 대상 거래도 excluded 외의 필드는 건드리지 않는다.
 */
function setExcludedMany(ids: string[], excluded: boolean): BulkExcludeResult {
  if (!Array.isArray(ids) || ids.length === 0) return { ok: true, changed: 0 }

  const targets = new Set(ids)
  const next = excluded === true
  const snapshot = transactions.value
  try {
    let changed = 0
    const arr = snapshot.map((t) => {
      if (!targets.has(t.id)) return t          // 대상 외 — 원본 그대로
      if (isIncomeTransaction(t)) return t      // 수입 거래 — 항상 제외 상태 유지
      if (isExcluded(t) === next) return t      // 이미 같은 값 — 그대로
      changed++
      return { ...t, excluded: next }           // excluded만 변경, 나머지 필드 보존
    })
    if (changed > 0) transactions.value = arr
    return { ok: true, changed }
  } catch (e) {
    transactions.value = snapshot // 롤백
    return { ok: false, changed: 0, reason: (e as Error).message }
  }
}

// ── 거래 삭제 ──

export interface RemoveResult {
  ok: boolean
  /** 실제로 지워진 대시보드 거래 수 */
  removed: number
  /** 함께 지워진 수입/지출 관리 원본 항목 수 */
  removedFromIncomeExpense: number
  reason?: string
}

/**
 * 거래를 영구 삭제한다. (되돌릴 수 없다)
 *
 * 두 가지를 함께 처리한다:
 *  1) 수입/지출 관리에서 미러링된 거래(ieSourceId 보유)는 **원본 항목까지** 지운다.
 *     대시보드 쪽만 지우면 미러 동기화가 곧바로 되살리기 때문이다.
 *  2) 삭제 결과를 즉시 저장소에 반영한다 — 지운 거래가 새로고침 후 되살아나지 않도록.
 * 저장에 실패하면 메모리 상태를 원래대로 되돌려 화면과 저장소가 어긋나지 않게 한다.
 */
function removeTransactions(ids: string[]): RemoveResult {
  const noop: RemoveResult = { ok: true, removed: 0, removedFromIncomeExpense: 0 }
  if (!Array.isArray(ids) || ids.length === 0) return noop

  const targets = new Set(ids)
  const snapshot = transactions.value
  const doomed = snapshot.filter((t) => targets.has(t.id))
  if (doomed.length === 0) return noop

  const ieSnapshot = incomeExpenseRepo.state.value
  try {
    // 1) 미러 거래의 원본부터 제거 (동기화가 되살리지 못하게 먼저)
    const ieIds = new Set(doomed.map((t) => t.ieSourceId).filter((x): x is string => Boolean(x)))
    let removedFromIncomeExpense = 0
    if (ieIds.size > 0) {
      const nextIe = ieSnapshot.filter((t) => !ieIds.has(t.id))
      removedFromIncomeExpense = ieSnapshot.length - nextIe.length
      incomeExpenseRepo.state.value = nextIe
    }

    // 2) 대시보드 거래 제거
    transactions.value = transactions.value.filter((t) => !targets.has(t.id))

    // 3) 즉시 영속화 — 실패하면 전부 원복
    const saved = saveToStorage()
    if (!saved.ok) {
      transactions.value = snapshot
      incomeExpenseRepo.state.value = ieSnapshot
      return { ok: false, removed: 0, removedFromIncomeExpense: 0, reason: saved.reason ?? '저장에 실패했습니다.' }
    }

    return { ok: true, removed: doomed.length, removedFromIncomeExpense }
  } catch (e) {
    transactions.value = snapshot
    incomeExpenseRepo.state.value = ieSnapshot
    return { ok: false, removed: 0, removedFromIncomeExpense: 0, reason: (e as Error).message }
  }
}

// ── 카테고리 변경: 단건 / 관련 거래 일괄 ──
//
// "관련 거래"의 판정 기준은 기존과 동일하게 **내용(description) 완전 일치**다.
// 기준을 바꾸지 않기 위해 아래 isRelated() 한 곳에만 정의하고, UI와 갱신 로직이 함께 사용한다.
// 단건/일괄은 서로 다른 함수가 아니라 scope 인자로 명시적으로 구분하며,
// scope='single'은 오직 id로만 대상을 고르므로 내용·결제수단이 같아도 다른 행을 건드릴 수 없다.

/** 두 거래가 "관련 거래"인지 — 기존 updateByDescription과 동일한 기준 */
function isRelated(a: Transaction, b: Transaction): boolean {
  return a.description === b.description
}

/** 특정 거래와 관련된(= 일괄 변경 대상이 되는) 거래 목록 */
function relatedTransactions(id: string): Transaction[] {
  const target = transactions.value.find((t) => t.id === id)
  if (!target) return []
  return transactions.value.filter((t) => isRelated(t, target))
}

/** 관련 거래 건수 (자기 자신 포함). 1이면 일괄 변경해도 단건과 동일하다. */
function countRelated(id: string): number {
  return relatedTransactions(id).length
}

/** 카테고리 변경 범위 */
export type UpdateScope = 'single' | 'related'

export interface CategoryUpdateResult {
  ok: boolean
  scope: UpdateScope
  /** 실제로 값이 바뀐 건수 */
  updated: number
  category?: Category
  /** 일괄 변경의 기준이 된 내용 */
  description?: string
  reason?: string
}

/**
 * 카테고리를 지정한 범위로만 변경한다.
 * - scope 'single' : 해당 id 거래 1건만. 내용/결제수단이 같은 다른 거래는 절대 바뀌지 않는다.
 * - scope 'related': isRelated() 기준에 해당하는 모든 거래.
 * 실패 시 상태를 원복해 UI가 잘못 갱신되지 않게 한다.
 */
function updateCategoryScoped(id: string, category: Category, scope: UpdateScope): CategoryUpdateResult {
  const fail = (reason: string): CategoryUpdateResult => ({ ok: false, scope, updated: 0, reason })

  if (scope !== 'single' && scope !== 'related') return fail('변경 범위가 올바르지 않습니다.')
  const name = (category ?? '').trim()
  if (!name) return fail('카테고리 값이 비어 있습니다.')

  const target = transactions.value.find((t) => t.id === id)
  if (!target) return fail('거래를 찾을 수 없습니다. 목록을 새로고침해 주세요.')

  const snapshot = transactions.value
  try {
    let updated = 0
    const next = snapshot.map((t) => {
      const inScope = scope === 'single' ? t.id === id : isRelated(t, target)
      if (!inScope || t.category === name) return t
      updated++
      return { ...t, category: name }
    })
    if (updated > 0) transactions.value = next
    return { ok: true, scope, updated, category: name, description: target.description }
  } catch (e) {
    transactions.value = snapshot // 롤백
    return fail((e as Error).message)
  }
}

function remapCategory(from: Category, to: Category): number {
  if (from === to) return 0
  let count = 0
  const next = transactions.value.map((t) => {
    if (t.category === from) { count++; return { ...t, category: to } }
    return t
  })
  if (count > 0) transactions.value = next
  return count
}

function remapPayment(from: PaymentMethod, to: PaymentMethod): number {
  if (from === to) return 0
  let count = 0
  const next = transactions.value.map((t) => {
    if (t.paymentMethod === from) { count++; return { ...t, paymentMethod: to } }
    return t
  })
  if (count > 0) transactions.value = next
  return count
}

function reapplyDescriptionRules(): number {
  let changed = 0
  const next = transactions.value.map((t) => {
    const newCat = classifyCategory(t.category, t.description)
    if (newCat !== t.category) { changed++; return { ...t, category: newCat } }
    return t
  })
  if (changed > 0) transactions.value = next
  return changed
}

function countByCategory(name: Category): number {
  return transactions.value.reduce((n, t) => n + (t.category === name ? 1 : 0), 0)
}
function countByPayment(name: PaymentMethod): number {
  return transactions.value.reduce((n, t) => n + (t.paymentMethod === name ? 1 : 0), 0)
}

// ── 수기 추가 ──
export interface NewTransactionInput {
  date: Date | string
  description: string
  amount: number
  category?: Category
  paymentMethod?: PaymentMethod
  costType?: CostType
  note?: string
}

function addTransaction(input: NewTransactionInput): Transaction | null {
  const d = input.date instanceof Date ? input.date : new Date(input.date)
  if (isNaN(d.getTime())) return null
  const amt = Number(input.amount)
  if (!Number.isFinite(amt) || amt <= 0) return null

  const description = (input.description ?? '').trim() || '(내용 없음)'
  const category = (input.category ?? '기타').trim() || '기타'
  const paymentMethod = (input.paymentMethod ?? '기타결제').trim() || '기타결제'
  const costType: CostType = input.costType === '고정비' ? '고정비' : '변동비'

  const id = `manual-${d.getTime()}-${Math.random().toString(36).slice(2, 8)}`
  const fam = useFamily()
  const tx: Transaction = {
    id, date: d, description, amount: Math.abs(amt),
    category: classifyCategory(category, description),
    paymentMethod, costType,
    note: input.note?.trim() || undefined,
    memberId: fam.primaryMemberId.value ?? undefined,
    ...deriveFields(d)
  }
  transactions.value = [...transactions.value, tx]
  return tx
}

// ── 멤버 단위 조회/저장 ──
//
// 저장소는 "memberId가 태깅된 단일 거래 배열"이다. 멤버별 저장이란
// 그 배열에서 해당 멤버의 행만 교체(또는 추가)하고 나머지 멤버의 행은 손대지 않는 것을 뜻한다.
// 따라서 멤버별 데이터는 서로 완전히 독립적이며, 화면 표시(filtered)에서만 활성 멤버 기준으로 합산된다.

/** 거래의 소속 멤버. 태깅이 없는 레거시 거래는 주 멤버 소속으로 간주한다(isMemberActive와 동일 규칙). */
function ownerOf(t: Transaction): string | undefined {
  return t.memberId ?? (useFamily().primaryMemberId.value ?? undefined)
}

/** 중복 판정 키: 날짜(일) + 내용 + 금액 */
function dupKey(t: Transaction): string {
  return `${t.date.toISOString().slice(0, 10)}|${t.description}|${t.amount}`
}

/** 특정 멤버에게 귀속된 거래 목록 (메모리 기준 = 저장소와 동일) */
function transactionsOf(memberId: string): Transaction[] {
  return transactions.value.filter((t) => ownerOf(t) === memberId)
}

function countOfMember(memberId: string): number {
  return transactionsOf(memberId).length
}

/** 특정 멤버의 마지막 저장 메타 */
function memberMeta(memberId: string) {
  return repoMemberMeta(memberId)
}

export type SaveMode = 'replace' | 'append'

export interface MemberSaveResult {
  ok: boolean
  /** 저장된 해당 멤버의 총 건수 */
  count: number
  /** 저장소 전체 건수 */
  total: number
  /** replace 모드에서 교체(제거)된 기존 건수 */
  replaced: number
  /** append 모드에서 중복으로 건너뛴 건수 */
  skipped: number
  reason?: string
}

/**
 * 업로드된 임시 거래를 "해당 멤버에게만" 영속화한다.
 * - replace: 그 멤버의 기존 거래를 새 데이터로 교체 (다른 멤버 데이터는 그대로)
 * - append : 그 멤버의 기존 거래에 추가 (날짜+내용+금액이 같은 중복 행은 건너뜀)
 */
function saveMemberTransactions(
  memberId: string | null | undefined,
  incoming: Transaction[],
  name: string,
  mode: SaveMode = 'replace'
): MemberSaveResult {
  const empty: MemberSaveResult = { ok: false, count: 0, total: transactions.value.length, replaced: 0, skipped: 0 }
  if (!memberId) {
    return { ...empty, reason: '가족 구성원이 선택되지 않았습니다.' }
  }
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return { ...empty, reason: '저장할 데이터가 없습니다.' }
  }

  const others = transactions.value.filter((t) => ownerOf(t) !== memberId)
  const existing = transactions.value.filter((t) => ownerOf(t) === memberId)

  // 새로 들어온 행은 멤버 스코프로 재태깅 + ID 재발급.
  // (parseExcel의 ID는 행 인덱스 기반이라 멤버 간 충돌 가능 — 반드시 네임스페이스를 준다.)
  const stamp = Date.now().toString(36)
  const tagged: Transaction[] = incoming.map((t, i) => ({
    ...t,
    memberId,
    id: `${memberId}::${stamp}::${i}`
  }))

  let mine: Transaction[]
  let replaced = 0
  let skipped = 0
  if (mode === 'append') {
    const seen = new Set(existing.map(dupKey))
    mine = existing.slice()
    for (const t of tagged) {
      const k = dupKey(t)
      if (seen.has(k)) { skipped++; continue }
      seen.add(k)
      mine.push(t)
    }
  } else {
    replaced = existing.length
    mine = tagged
  }

  const merged = [...others, ...mine].sort((a, b) => a.date.getTime() - b.date.getTime())
  const r = repoSaveTransactions(merged, name || fileName.value, {
    memberId,
    fileName: name,
    count: mine.length
  })
  if (!r.ok) {
    return { ...empty, reason: r.reason ?? '저장에 실패했습니다.' }
  }

  transactions.value = merged
  fileName.value = name || fileName.value
  loadedAt.value = new Date()
  lastSavedAt.value = new Date()
  registerDiscoveredTaxonomies(mine)
  markSaved()   // 방금 저장한 배열이 곧 메모리 상태다

  return { ok: true, count: mine.length, total: merged.length, replaced, skipped }
}

// ── 영속화 ──
/**
 * 현재 메모리 상태를 그대로 저장한다.
 * 저장이 성공하면 저장소에서 파생되는 것들도 같은 데이터 기준으로 맞춘다:
 *  - 멤버별 저장 메타(건수·저장시각) — 편집으로 건수가 바뀌어도 가족 패널이 옛 값을 보이지 않도록
 *  - 카테고리/결제수단 목록 — 편집 중 생긴 값이 필터·설정 화면에서 누락되지 않도록
 *  - 미저장 변경 표시 해제
 * 이로써 저장 직후에는 화면의 모든 합계·요약이 "가장 최근 저장된 데이터"와 일치한다.
 */
function saveToStorage(): { ok: boolean; count: number; reason?: string } {
  const txs = transactions.value
  const r = repoSaveTransactions(txs, fileName.value, undefined, memberCountsOf(txs))
  if (r.ok) {
    lastSavedAt.value = new Date()
    registerDiscoveredTaxonomies(txs)
    markSaved()
  }
  return r
}

function loadFromStorage(): { ok: boolean; count: number } {
  const before = transactions.value.length
  transactionsRepo.load()
  const meta = transactionsMetaRepo.state.value
  fileName.value = meta?.fileName ?? ''
  if (meta?.savedAt) lastSavedAt.value = new Date(meta.savedAt)
  loadedAt.value = transactions.value.length > 0 ? new Date() : null
  if (transactions.value.length > 0) registerDiscoveredTaxonomies(transactions.value)
  markSaved()
  return { ok: true, count: transactions.value.length - before }
}

/**
 * **현재 메모리 상태**를 저장소에 쓰지 않고 백업 형식으로 만들어 돌려준다.
 *
 * 대시보드 거래는 '저장' 버튼을 눌러야만 localStorage에 기록되므로, 백업이 저장소만 읽으면
 * 아직 저장하지 않은 편집·추가·삭제와 **수입/지출 관리에서 미러링된 거래**가 파일에서 빠진다.
 * 내보내기는 이 스냅샷을 써서 "화면에 보이는 그대로"를 담는다 (저장소는 건드리지 않는다).
 *
 * 반환 형태는 저장소 키 → 값이라 백업 모듈이 그대로 덮어쓰기만 하면 된다.
 */
function exportSnapshot(): Record<string, unknown> {
  const txs = transactions.value
  const counts = memberCountsOf(txs)
  const prevByMember = transactionsMetaRepo.state.value?.byMember ?? {}
  const snapshotAt = new Date().toISOString()

  const byMember: Record<string, MemberMeta> = {}
  for (const [id, count] of Object.entries(counts)) {
    byMember[id] = {
      savedAt: snapshotAt,
      fileName: prevByMember[id]?.fileName ?? fileName.value,
      count
    }
  }

  return {
    [transactionsRepo.key]: serializeTransactions(txs, fileName.value),
    [transactionsMetaRepo.key]: {
      savedAt: snapshotAt,
      fileName: fileName.value,
      count: txs.length,
      byMember
    } satisfies MetaShape
  }
}

function clearStorage(): void {
  repoClearTransactions()
  fileName.value = ''
  lastSavedAt.value = null
  loadedAt.value = null
  markSaved()
}

// 모듈 초기화 시 한 번 더 분류 자동 등록 (auto-load는 이미 repo 생성 시 수행됨)
if (transactions.value.length > 0) registerDiscoveredTaxonomies(transactions.value)

export function useExpenses() {
  return {
    transactions,
    filtered,
    filteredAll,
    incomeFiltered,
    incomeTotal,
    expenseTotal,
    netTotal,
    excludedCount,
    excludedAmount,
    isExcluded,
    isIncomeTransaction,
    isRefund,
    isRefundCategory,
    isNegativeAmount,
    refundCount,
    refundAmount,
    unmatchedNegativeCount,
    setExcluded,
    setExcludedMany,
    removeTransactions,
    warnings,
    detectedColumns,
    fileName,
    loadedAt,
    lastSavedAt,
    unsavedChanges,
    filters,
    availableYears,
    availableMonths,
    hasPeriodFilter,
    clearPeriodFilter,
    resetPeriodFilter,
    setParseResult,
    reset,
    updateTransaction,
    updateByDescription,
    isRelated,
    relatedTransactions,
    countRelated,
    updateCategoryScoped,
    remapCategory,
    remapPayment,
    reapplyDescriptionRules,
    countByCategory,
    countByPayment,
    addTransaction,
    transactionsOf,
    countOfMember,
    memberMeta,
    saveMemberTransactions,
    saveToStorage,
    loadFromStorage,
    exportSnapshot,
    clearStorage
  }
}
