// SheetJS 로 업로드된 엑셀(.xlsx/.xls/.csv) 파싱
import * as XLSX from 'xlsx'
import type { ParseResult, Transaction } from './types'
import {
  classifyCategory,
  detectColumns,
  deriveFields,
  normalizePaymentMethod,
  resolveCostType,
  toAmount,
  toDate
} from './classify'

/**
 * File → ParseResult (Transaction[])
 *
 * 인식하는 열:
 *  - 날짜 / description / 금액 / 카테고리 / 결제수단 / 구분(고정·변동) / 비고
 * 각 열 이름은 classify.ts 의 HEADER_ALIASES 에서 매우 유연하게 허용됩니다.
 */
export async function parseExpenseFile(file: File): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })

  // 1) 시트 선택: "가계부" / "거래" / "내역" 등을 우선, 없으면 첫 시트
  const preferred = wb.SheetNames.find((n) => /가계부|거래|내역|지출|expense|transactions?/i.test(n))
  const sheetName = preferred || wb.SheetNames[0]
  if (!sheetName) {
    return { transactions: [], warnings: ['시트를 찾을 수 없습니다.'], detectedColumns: {}, totalRows: 0 }
  }

  const sheet = wb.Sheets[sheetName]
  const rows: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: false })
  if (rows.length === 0) {
    return { transactions: [], warnings: ['시트에 데이터가 없습니다.'], detectedColumns: {}, totalRows: 0 }
  }

  // 2) 컬럼 매핑 감지
  const map = detectColumns(rows[0] as Record<string, unknown>)
  const warnings: string[] = []
  if (!map.date) warnings.push('"날짜" 열을 찾지 못했습니다.')
  if (!map.amount) warnings.push('"금액" 열을 찾지 못했습니다.')

  // 3) 각 행을 Transaction 으로 변환
  const transactions: Transaction[] = []
  rows.forEach((row, idx) => {
    const dateRaw = map.date ? row[map.date] : null
    const amtRaw = map.amount ? row[map.amount] : null

    const d = toDate(dateRaw)
    const amount = toAmount(amtRaw)
    if (!d || amount <= 0) return // 유효하지 않은 행은 스킵

    const description = String(map.description ? row[map.description] ?? '' : '').trim() || '(내용 없음)'
    // 카테고리: 셀 값 + 내용 패턴 모두 고려. "출금 내역"·"입금 내역" → "입출금" 자동 분류.
    const category = classifyCategory(map.category ? row[map.category] : '', description)
    const paymentMethod = normalizePaymentMethod(map.paymentMethod ? row[map.paymentMethod] : '')
    const costType = resolveCostType(map.costType ? row[map.costType] : null, category)
    const note = map.note ? (row[map.note] ? String(row[map.note]) : undefined) : undefined

    const derived = deriveFields(d)
    transactions.push({
      id: `r${idx}-${d.getTime()}`,
      date: d,
      description,
      amount,
      category,
      paymentMethod,
      costType,
      note,
      ...derived
    })
  })

  // 날짜순 정렬
  transactions.sort((a, b) => a.date.getTime() - b.date.getTime())

  return {
    transactions,
    warnings,
    detectedColumns: map,
    totalRows: rows.length
  }
}
