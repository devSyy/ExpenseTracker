// 수입/지출 컴포저블 — incomeExpenseRepo 위에 액션을 얹은 얇은 레이어.
import { computed } from 'vue'
import { incomeExpenseRepo } from '~/repositories/incomeExpenseRepository'
import { useFamily } from '~/composables/useFamily'
import type { Transaction } from '~/utils/types'

export type TxKind = '수입' | '지출'
/** 항목 출처 — 'manual'은 사용자가 수기로 입력, 'dashboard'는 사용내역에서 가져옴 */
export type TxSource = 'manual' | 'dashboard'

export interface IncomeExpenseTx {
  id: string
  date: string
  kind: TxKind
  category: string
  description: string
  paymentMethod: string
  amount: number
  note: string
  createdAt: string
  /** 출처 (선택) — 가져오기 시 'dashboard'로 마킹되어 중복 import를 방지 */
  source?: TxSource
  /** dashboard에서 가져온 경우 원본 거래 id */
  sourceId?: string
  /** 가족 멤버 ID — 활성 멤버 필터/합산에 사용 */
  memberId?: string
}

export const INCOME_CATEGORIES = ['급여', '보너스', '용돈', '이자', '환급', '판매수입', '기타수입']
export const EXPENSE_CATEGORIES = [
  '식비', '교통비', '쇼핑', '통신비', '주거비', '의료',
  '문화/여가', '교육', '경조사', '카페/간식', '기타지출'
]
export const PAYMENT_METHODS = ['계좌이체', '카드', '교통카드', '현금', '간편결제', '기타']

const allTransactions = incomeExpenseRepo.state

/** 활성 멤버 필터를 통과한 거래만 노출. memberId 누락 시 primary 소속으로 간주. */
const transactions = computed<IncomeExpenseTx[]>(() => {
  const fam = useFamily()
  return allTransactions.value.filter((t) => fam.isMemberActive(t.memberId))
})

function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6)
}

function add(input: Omit<IncomeExpenseTx, 'id' | 'createdAt'>): IncomeExpenseTx | null {
  const amt = Number(input.amount)
  if (!input.date || !Number.isFinite(amt) || amt <= 0) return null
  const fam = useFamily()
  const tx: IncomeExpenseTx = {
    id: uid(),
    date: input.date,
    kind: input.kind,
    category: (input.category ?? '').trim(),
    description: (input.description ?? '').trim(),
    paymentMethod: (input.paymentMethod ?? '').trim(),
    amount: Math.abs(amt),
    note: (input.note ?? '').trim(),
    createdAt: new Date().toISOString(),
    memberId: input.memberId ?? fam.primaryMemberId.value ?? undefined
  }
  allTransactions.value = [...allTransactions.value, tx]
  return tx
}

function update(id: string, patch: Partial<Omit<IncomeExpenseTx, 'id' | 'createdAt'>>): boolean {
  const idx = allTransactions.value.findIndex((t) => t.id === id)
  if (idx === -1) return false
  const next = allTransactions.value.slice()
  const merged = { ...next[idx], ...patch }
  if (typeof merged.amount === 'number') merged.amount = Math.abs(Number(merged.amount))
  next[idx] = merged as IncomeExpenseTx
  allTransactions.value = next
  return true
}

function remove(id: string): boolean {
  const before = allTransactions.value.length
  allTransactions.value = allTransactions.value.filter((t) => t.id !== id)
  return allTransactions.value.length < before
}

const totalIncome = computed(() =>
  transactions.value.filter((t) => t.kind === '수입').reduce((s, t) => s + t.amount, 0)
)
const totalExpense = computed(() =>
  transactions.value.filter((t) => t.kind === '지출').reduce((s, t) => s + t.amount, 0)
)
const netProfit = computed(() => totalIncome.value - totalExpense.value)

function monthlyStats(ym: string) {
  const items = transactions.value.filter((t) => t.date.startsWith(ym))
  const income = items.filter((t) => t.kind === '수입').reduce((s, t) => s + t.amount, 0)
  const expense = items.filter((t) => t.kind === '지출').reduce((s, t) => s + t.amount, 0)
  return { income, expense, net: income - expense }
}

/**
 * 대시보드 사용내역을 수입/지출의 '지출' 항목으로 가져온다.
 *
 * 옵션:
 *  - aggregateBy(기본 'monthCategory'): 'transaction'은 거래 1:1 입력,
 *    'monthCategory'는 (연월, 카테고리)별로 묶어 합계 1건으로 입력
 *  - onlyNew(기본 true): 이미 가져온(sourceId 동일) 항목은 건너뜀
 *  - replace: dashboard 출처의 모든 항목을 먼저 제거한 뒤 다시 가져옴
 */
function importFromDashboard(
  dashboardTxs: Transaction[],
  options: {
    onlyNew?: boolean
    replace?: boolean
    aggregateBy?: 'transaction' | 'monthCategory'
  } = {}
): { added: number; skipped: number; removed: number } {
  const { onlyNew = true, replace = false, aggregateBy = 'monthCategory' } = options
  if (!Array.isArray(dashboardTxs)) return { added: 0, skipped: 0, removed: 0 }
  const fam = useFamily()
  const primaryId = fam.primaryMemberId.value ?? undefined

  let base = allTransactions.value
  let removed = 0
  if (replace) {
    const before = base.length
    base = base.filter((t) => t.source !== 'dashboard')
    removed = before - base.length
  }

  const existingSourceIds = new Set(
    base.filter((t) => t.source === 'dashboard' && t.sourceId).map((t) => t.sourceId as string)
  )

  const newEntries: IncomeExpenseTx[] = []
  let added = 0
  let skipped = 0

  if (aggregateBy === 'monthCategory') {
    // 월×카테고리 집계: 같은 (YYYY-MM, category)에 속한 모든 거래를 합계 한 건으로 변환
    interface Group {
      ym: string
      category: string
      amount: number
      count: number
      pms: Set<string>
      lastDate: string  // 그룹 내 가장 늦은 날짜를 entry 날짜로 사용
    }
    const groups = new Map<string, Group>()
    for (const t of dashboardTxs) {
      const ym = t.monthLabel || (t.date instanceof Date ? t.date.toISOString().slice(0, 7) : '')
      if (!ym) continue
      const cat = (t.category ?? '').trim() || '기타'
      const key = `${ym}::${cat}`
      const dateStr = t.date instanceof Date && !isNaN(t.date.getTime())
        ? t.date.toISOString().slice(0, 10) : ''
      const g = groups.get(key) ?? { ym, category: cat, amount: 0, count: 0, pms: new Set(), lastDate: '' }
      g.amount += Math.abs(Number(t.amount) || 0)
      g.count += 1
      if (t.paymentMethod) g.pms.add(t.paymentMethod)
      if (dateStr > g.lastDate) g.lastDate = dateStr
      groups.set(key, g)
    }

    for (const [key, g] of groups) {
      const sourceId = `agg::${key}`
      if (onlyNew && existingSourceIds.has(sourceId)) { skipped++; continue }
      const pmList = Array.from(g.pms)
      const paymentMethod = pmList.length === 1 ? pmList[0] : pmList.length > 1 ? '여러 건' : '통합'
      const date = g.lastDate || `${g.ym}-01`
      newEntries.push({
        id: `imp-agg-${g.ym}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        date,
        kind: '지출',
        category: g.category,
        description: `${g.category} 합계`,
        paymentMethod,
        amount: g.amount,
        note: `사용내역 ${g.ym} (${g.count}건)`,
        createdAt: new Date().toISOString(),
        source: 'dashboard',
        sourceId,
        // dashboard 거래의 원본 memberId가 있으면 보존, 아니면 primary
        memberId: dashboardTxs.find((dt) => dt.monthLabel === g.ym && dt.category === g.category)?.memberId ?? primaryId
      })
      added++
    }
  } else {
    // 거래 1:1 입력 (이전 동작)
    for (const t of dashboardTxs) {
      if (onlyNew && existingSourceIds.has(t.id)) { skipped++; continue }
      const dateStr = t.date instanceof Date && !isNaN(t.date.getTime())
        ? t.date.toISOString().slice(0, 10) : String(t.date)
      newEntries.push({
        id: `imp-${t.id}-${Date.now().toString(36)}`,
        date: dateStr,
        kind: '지출',
        category: (t.category ?? '').trim(),
        description: (t.description ?? '').trim(),
        paymentMethod: (t.paymentMethod ?? '').trim(),
        amount: Math.abs(Number(t.amount) || 0),
        note: (t.note ?? '').trim(),
        createdAt: new Date().toISOString(),
        source: 'dashboard',
        sourceId: t.id,
        memberId: t.memberId ?? primaryId
      })
      added++
    }
  }

  if (replace || added > 0) {
    allTransactions.value = added > 0 ? [...base, ...newEntries] : base
  }
  return { added, skipped, removed }
}

/** dashboard에서 가져온 항목만 한꺼번에 제거 */
function clearDashboardImports(): number {
  const before = allTransactions.value.length
  allTransactions.value = allTransactions.value.filter((t) => t.source !== 'dashboard')
  return before - allTransactions.value.length
}

const dashboardImportCount = computed(() =>
  allTransactions.value.filter((t) => t.source === 'dashboard').length
)

export function useIncomeExpense() {
  return {
    transactions,
    add,
    update,
    remove,
    totalIncome,
    totalExpense,
    netProfit,
    monthlyStats,
    importFromDashboard,
    clearDashboardImports,
    dashboardImportCount,
    INCOME_CATEGORIES,
    EXPENSE_CATEGORIES,
    PAYMENT_METHODS
  }
}
