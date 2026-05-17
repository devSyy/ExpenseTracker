// 거래 내역을 다양한 기간·차원으로 집계.
// 카테고리/결제수단 목록은 사용자가 settings 페이지에서 자유롭게 추가할 수 있으므로
// 정적 목록을 순회하지 않고 거래에서 실제 등장한 키를 기준으로 집계한다.
import type { Category, PaymentMethod, PeriodKind, Transaction } from './types'

export interface PeriodBucket {
  label: string        // 2026-04, 2026-Q1, 2026-W17 ...
  total: number
  fixed: number
  variable: number
  count: number
}

function keyFor(t: Transaction, kind: PeriodKind): string {
  switch (kind) {
    case 'weekly':      return t.weekLabel
    case 'monthly':     return t.monthLabel
    case 'quarterly':   return t.quarterLabel
    case 'semiannual':  return t.halfLabel
    case 'yearly':      return t.yearLabel
  }
}

export function bucketByPeriod(tx: Transaction[], kind: PeriodKind): PeriodBucket[] {
  const map = new Map<string, PeriodBucket>()
  for (const t of tx) {
    const k = keyFor(t, kind)
    const b = map.get(k) ?? { label: k, total: 0, fixed: 0, variable: 0, count: 0 }
    b.total += t.amount
    b.count += 1
    if (t.costType === '고정비') b.fixed += t.amount
    else b.variable += t.amount
    map.set(k, b)
  }
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label))
}

export interface CategoryRow {
  category: Category
  total: number
  count: number
  share: number // 0..1
}

export function bucketByCategory(tx: Transaction[]): CategoryRow[] {
  const totals = new Map<Category, { total: number; count: number }>()
  for (const t of tx) {
    const b = totals.get(t.category) ?? { total: 0, count: 0 }
    b.total += t.amount
    b.count += 1
    totals.set(t.category, b)
  }
  const grand = tx.reduce((s, t) => s + t.amount, 0) || 1
  const rows: CategoryRow[] = Array.from(totals.entries())
    .map(([category, b]) => ({ category, total: b.total, count: b.count, share: b.total / grand }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
  return rows
}

export interface PaymentRow {
  method: PaymentMethod
  total: number
  count: number
  share: number
}

export function bucketByPayment(tx: Transaction[]): PaymentRow[] {
  const totals = new Map<PaymentMethod, { total: number; count: number }>()
  for (const t of tx) {
    const b = totals.get(t.paymentMethod) ?? { total: 0, count: 0 }
    b.total += t.amount
    b.count += 1
    totals.set(t.paymentMethod, b)
  }
  const grand = tx.reduce((s, t) => s + t.amount, 0) || 1
  return Array.from(totals.entries())
    .map(([method, b]) => ({ method, total: b.total, count: b.count, share: b.total / grand }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
}

export interface FixedVariableSummary {
  fixed: number
  variable: number
  total: number
  fixedShare: number
  variableShare: number
}

export function summarizeFixedVariable(tx: Transaction[]): FixedVariableSummary {
  let fixed = 0
  let variable = 0
  for (const t of tx) {
    if (t.costType === '고정비') fixed += t.amount
    else variable += t.amount
  }
  const total = fixed + variable || 1
  return {
    fixed,
    variable,
    total: fixed + variable,
    fixedShare: fixed / total,
    variableShare: variable / total
  }
}

export interface KPISummary {
  total: number
  count: number
  fixed: number
  variable: number
  avgMonthly: number         // 월평균
  topCategory: Category | null
  topPayment: PaymentMethod | null
  dateRange: { start: Date | null; end: Date | null }
}

export function computeKPIs(tx: Transaction[]): KPISummary {
  if (tx.length === 0) {
    return {
      total: 0, count: 0, fixed: 0, variable: 0, avgMonthly: 0,
      topCategory: null, topPayment: null,
      dateRange: { start: null, end: null }
    }
  }
  const total = tx.reduce((s, t) => s + t.amount, 0)
  const fixed = tx.filter((t) => t.costType === '고정비').reduce((s, t) => s + t.amount, 0)
  const variable = total - fixed
  const months = new Set(tx.map((t) => t.monthLabel)).size || 1
  const catRows = bucketByCategory(tx)
  const payRows = bucketByPayment(tx)
  const start = tx[0].date
  const end = tx[tx.length - 1].date
  return {
    total,
    count: tx.length,
    fixed,
    variable,
    avgMonthly: total / months,
    topCategory: catRows[0]?.category ?? null,
    topPayment: payRows[0]?.method ?? null,
    dateRange: { start, end }
  }
}

/** 월별 × 카테고리 스택 차트를 위한 2차원 집계 */
export interface MonthlyStack {
  months: string[] // YYYY-MM 오름차순
  categories: Category[]
  data: number[][] // [categoryIndex][monthIndex]
}

export function monthlyCategoryStack(tx: Transaction[], topN = 6): MonthlyStack {
  const byCat = bucketByCategory(tx)
  const topCats = byCat.slice(0, topN).map((r) => r.category)
  const hasOthers = byCat.length > topN
  const cats: Category[] = hasOthers ? [...topCats, '기타'] : topCats

  const monthsSet = new Set<string>()
  tx.forEach((t) => monthsSet.add(t.monthLabel))
  const months = Array.from(monthsSet).sort()
  const monthIndex = new Map(months.map((m, i) => [m, i]))

  const data: number[][] = cats.map(() => new Array(months.length).fill(0))
  for (const t of tx) {
    const mIdx = monthIndex.get(t.monthLabel)
    if (mIdx === undefined) continue
    let cIdx = cats.indexOf(t.category)
    if (cIdx < 0) cIdx = hasOthers ? cats.length - 1 : -1
    if (cIdx >= 0) data[cIdx][mIdx] += t.amount
  }
  return { months, categories: cats, data }
}
