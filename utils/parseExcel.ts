// SheetJS 로 업로드된 가계부 파일(.xlsx/.xlsm/.xls/.csv/.txt/.tsv) 파싱
//
// 실제 사용자가 올리는 파일은 "깨끗한 1행 헤더 UTF-8" 인 경우가 거의 없다.
// 그래서 아래 세 가지를 모두 처리한다.
//  1) 인코딩   : BOM 없는 UTF-8, EUC-KR(CP949), UTF-16 — 한국 은행/카드사 CSV는 대부분 CP949다.
//  2) 헤더 위치: 첫 행이 제목("○○카드 이용대금 명세서")이고 실제 헤더가 몇 줄 아래인 경우.
//  3) 시트 선택: 첫 시트가 "요약"이고 실제 내역이 두 번째 시트에 있는 경우.
// 셋 중 하나만 어긋나도 "파일이 등록되지 않는" 것처럼 보이므로, 후보를 모두 시도해
// 가장 많은 거래를 얻은 조합을 채택한다.
import * as XLSX from 'xlsx'
import type { ParseResult, Transaction } from './types'
import { classifyRefunds, type RefundMatchOptions } from './refund'
import {
  classifyCategory,
  detectColumns,
  detectHeaderRow,
  deriveFields,
  normalizePaymentMethod,
  resolveCostType,
  toDate,
  toSignedAmount
} from './classify'

/** 업로드를 허용하는 확장자 */
export const SUPPORTED_EXTENSIONS = ['.xlsx', '.xlsm', '.xlsb', '.xls', '.csv', '.tsv', '.txt'] as const

export function isSupportedFileName(name: string): boolean {
  return SUPPORTED_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))
}

// ───────── 인코딩 처리 ─────────

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04] // xlsx / xlsm / xlsb
const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0] // 구형 .xls (OLE 복합 문서)

function startsWith(u8: Uint8Array, magic: number[]): boolean {
  if (u8.length < magic.length) return false
  return magic.every((b, i) => u8[i] === b)
}

/** 바이너리 워크북(xlsx/xls)인지 — 아니면 텍스트(csv/html/xml)로 취급한다. */
function isBinaryWorkbook(u8: Uint8Array): boolean {
  return startsWith(u8, ZIP_MAGIC) || startsWith(u8, CFB_MAGIC)
}

/**
 * 텍스트 파일의 바이트를 문자열로 디코딩한다.
 * BOM → UTF-8/UTF-16, BOM이 없으면 엄격 UTF-8을 먼저 시도하고 실패 시 EUC-KR(CP949)로 간주한다.
 * (한글이 담긴 CP949 바이트열은 거의 항상 UTF-8 검증에 실패하므로 판별이 정확하다)
 */
export function decodeText(u8: Uint8Array): { text: string; encoding: string } {
  if (u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), encoding: 'UTF-8 (BOM)' }
  }
  if (u8[0] === 0xff && u8[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), encoding: 'UTF-16LE' }
  }
  if (u8[0] === 0xfe && u8[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), encoding: 'UTF-16BE' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), encoding: 'UTF-8' }
  } catch {
    /* UTF-8이 아님 → 한국어 레거시 인코딩 시도 */
  }
  for (const enc of ['euc-kr', 'windows-949']) {
    try {
      const text = new TextDecoder(enc).decode(u8)
      if (text && !text.includes('�')) return { text, encoding: 'EUC-KR' }
    } catch {
      /* 해당 인코딩 미지원 환경 */
    }
  }
  return { text: new TextDecoder('utf-8').decode(u8), encoding: 'UTF-8 (일부 손상)' }
}

// ───────── 시트 → 거래 변환 ─────────

interface SheetAttempt {
  sheetName: string
  headerRowIndex: number
  headers: string[]
  map: Record<string, string>
  transactions: Transaction[]
  totalRows: number
  skipped: { noDate: number; noAmount: number; blank: number }
  /** 음수 금액 행 수 */
  negatives: number
}

function attemptSheet(sheet: XLSX.WorkSheet, sheetName: string, sheetIndex: number): SheetAttempt {
  // 1) 전체를 AOA로 읽어 헤더 행을 찾는다.
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true
  })
  const scan = detectHeaderRow(aoa)

  // 2) 찾은 헤더 행부터 다시 객체 배열로 읽는다.
  //    sheet_to_json 의 range(number)는 "시트 좌표계의 시작 행"이므로 시트 원점을 더해준다.
  let originRow = 0
  try {
    if (sheet['!ref']) originRow = XLSX.utils.decode_range(sheet['!ref']).s.r
  } catch {
    originRow = 0
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
    blankrows: false,
    range: originRow + scan.index
  })

  // 3) 실제 읽어온 키로 매핑을 다시 확정한다 (SheetJS의 중복/빈 헤더 처리 반영)
  const map = rows.length > 0 ? detectColumnsFromRows(rows) : scan.map

  const transactions: Transaction[] = []
  const skipped = { noDate: 0, noAmount: 0, blank: 0 }
  let negatives = 0

  rows.forEach((row, idx) => {
    const values = Object.values(row)
    if (values.every((v) => v == null || String(v).trim() === '')) {
      skipped.blank++
      return
    }

    const d = toDate(map.date ? row[map.date] : null)
    // 부호를 보존해서 읽는다. 음수라는 '사실'만 기록하고,
    // 환불 분류는 파일 전체를 다 읽은 뒤 짝 맞추기로 결정한다.
    const signed = toSignedAmount(map.amount ? row[map.amount] : null)
    const amount = Math.abs(signed)
    const negativeAmount = signed < 0
    if (!d) { skipped.noDate++; return }
    if (amount <= 0) { skipped.noAmount++; return }   // 0원/빈 셀만 건너뛴다 (음수는 살린다)
    if (negativeAmount) negatives++

    const description = String(map.description ? row[map.description] ?? '' : '').trim() || '(내용 없음)'
    const category = classifyCategory(map.category ? row[map.category] : '', description)
    const paymentMethod = normalizePaymentMethod(map.paymentMethod ? row[map.paymentMethod] : '')
    const costType = resolveCostType(map.costType ? row[map.costType] : null, category)
    const note = map.note ? (row[map.note] ? String(row[map.note]) : undefined) : undefined

    transactions.push({
      // 시트 인덱스까지 포함해 파일 내부에서 ID가 겹치지 않게 한다
      id: `s${sheetIndex}r${idx}-${d.getTime()}`,
      date: d,
      description,
      amount,
      category,
      paymentMethod,
      costType,
      note,
      negativeAmount,
      ...deriveFields(d)
    })
  })

  transactions.sort((a, b) => a.date.getTime() - b.date.getTime())

  return {
    sheetName,
    headerRowIndex: scan.index,
    headers: scan.headers.filter((h) => h.trim() !== ''),
    map,
    transactions,
    totalRows: rows.length,
    skipped,
    negatives
  }
}

/** sheet_to_json 이 실제로 만들어 낸 키 집합으로 컬럼을 매핑한다. */
function detectColumnsFromRows(rows: Record<string, unknown>[]): Record<string, string> {
  // 모든 행의 키를 합쳐 하나의 대표 행을 만든다 (첫 행에만 값이 없는 컬럼 대비)
  const merged: Record<string, unknown> = {}
  for (const r of rows.slice(0, 20)) {
    for (const k of Object.keys(r)) if (!(k in merged)) merged[k] = null
  }
  return detectColumns(merged)
}

// ───────── 공개 API ─────────

/**
 * File → ParseResult (Transaction[])
 *
 * 인식하는 열: 날짜 / 내용 / 금액 / 카테고리 / 결제수단 / 구분(고정·변동) / 비고
 * 헤더명은 classify.ts 의 HEADER_ALIASES 에서 매우 유연하게 허용된다.
 */
export async function parseExpenseFile(
  file: File,
  /** 환불 짝짓기 옵션 — 호출부(업로드 파이프라인)가 카테고리 유형 판정을 주입한다 */
  refundOpts: RefundMatchOptions = {}
): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const u8 = new Uint8Array(buffer)

  if (u8.length === 0) {
    return emptyResult(['파일이 비어 있습니다.'])
  }

  // ── 워크북 읽기 ──
  let wb: XLSX.WorkBook
  let encoding = ''
  try {
    if (isBinaryWorkbook(u8)) {
      wb = XLSX.read(u8, { type: 'array', cellDates: true })
    } else {
      // CSV / TSV / HTML(.xls로 위장한 표) / SpreadsheetML — 직접 디코딩해서 넘긴다.
      const decoded = decodeText(u8)
      encoding = decoded.encoding
      wb = XLSX.read(decoded.text, { type: 'string', cellDates: true })
    }
  } catch (e) {
    // 텍스트로 실패했으면 바이너리로, 바이너리로 실패했으면 텍스트로 한 번 더 시도
    try {
      wb = isBinaryWorkbook(u8)
        ? XLSX.read(decodeText(u8).text, { type: 'string', cellDates: true })
        : XLSX.read(u8, { type: 'array', cellDates: true })
    } catch {
      throw new Error(`파일 형식을 해석할 수 없습니다. (${(e as Error).message})`)
    }
  }

  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    return emptyResult(['시트를 찾을 수 없습니다.'])
  }

  // ── 모든 시트를 시도해 가장 많은 거래를 얻은 시트를 채택 ──
  const attempts: SheetAttempt[] = []
  wb.SheetNames.forEach((name, i) => {
    const sheet = wb.Sheets[name]
    if (!sheet) return
    try {
      attempts.push(attemptSheet(sheet, name, i))
    } catch {
      /* 개별 시트 실패는 무시하고 다음 시트로 */
    }
  })

  if (attempts.length === 0) {
    return emptyResult(['시트를 읽지 못했습니다.'])
  }

  const preferredRe = /가계부|거래|내역|지출|명세|expense|transactions?/i
  const best = attempts.slice().sort((a, b) => {
    if (b.transactions.length !== a.transactions.length) return b.transactions.length - a.transactions.length
    const ap = preferredRe.test(a.sheetName) ? 1 : 0
    const bp = preferredRe.test(b.sheetName) ? 1 : 0
    return bp - ap
  })[0]!

  // ── 환불 분류 ──
  // 음수 = 무조건 환불이 아니다. 지출 유형이면서 같은 금액의 양수 지출과 짝이 맞는 것만 환불.
  const { transactions: classified, result: refundResult } = classifyRefunds(best.transactions, refundOpts)

  // ── 경고 메시지 ──
  const warnings: string[] = []
  if (!best.map.date) warnings.push('"날짜" 열을 찾지 못했습니다.')
  if (!best.map.amount) warnings.push('"금액" 열을 찾지 못했습니다.')
  if (best.transactions.length === 0 && best.headers.length > 0) {
    warnings.push(`인식한 헤더: ${best.headers.slice(0, 12).join(' · ')}`)
  }
  if (best.skipped.noDate > 0) {
    warnings.push(`날짜를 해석하지 못해 ${best.skipped.noDate.toLocaleString('ko-KR')}행을 건너뛰었습니다.`)
  }
  if (best.skipped.noAmount > 0) {
    warnings.push(`금액이 없거나 0이어서 ${best.skipped.noAmount.toLocaleString('ko-KR')}행을 건너뛰었습니다.`)
  }
  if (refundResult.refundCount > 0) {
    warnings.push(`같은 금액의 결제 건과 짝이 맞는 음수 ${refundResult.refundCount.toLocaleString('ko-KR')}건을 '환불'로 분류했습니다. (지출 합계에서 제외)`)
  }
  if (refundResult.unmatchedNegativeCount > 0) {
    warnings.push(`짝이 맞는 결제 건이 없는 음수 ${refundResult.unmatchedNegativeCount.toLocaleString('ko-KR')}건은 원래 카테고리를 유지합니다. (음수이므로 지출 합계에는 미포함)`)
  }
  if (wb.SheetNames.length > 1) {
    warnings.push(`시트 "${best.sheetName}" 을(를) 사용했습니다. (전체 ${wb.SheetNames.length}개 시트)`)
  }

  return {
    transactions: classified,
    warnings,
    detectedColumns: best.map,
    totalRows: best.totalRows,
    sheetName: best.sheetName,
    sheetNames: wb.SheetNames,
    headerRow: best.headerRowIndex + 1, // 사용자에게는 1-based로 보여준다
    headers: best.headers,
    encoding,
    skipped: best.skipped,
    refundCount: refundResult.refundCount,
    unmatchedNegativeCount: refundResult.unmatchedNegativeCount
  }
}

function emptyResult(warnings: string[]): ParseResult {
  return {
    transactions: [],
    warnings,
    detectedColumns: {},
    totalRows: 0,
    skipped: { noDate: 0, noAmount: 0, blank: 0 },
    refundCount: 0,
    unmatchedNegativeCount: 0
  }
}
