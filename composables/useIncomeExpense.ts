// 수입/지출 컴포저블 — incomeExpenseRepo 위에 액션을 얹은 얇은 레이어.
import { computed, watch } from 'vue'
import { incomeExpenseRepo } from '~/repositories/incomeExpenseRepository'
import { transactionsRepo } from '~/repositories/transactionsRepository'
import { useFamily } from '~/composables/useFamily'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { deriveFields } from '~/utils/classify'
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

// 카테고리 관리 화면에서 설정한 유형을 우선 사용하고, 아직 하나도 없으면 위 기본 목록으로 폴백한다.
// (수입/지출 입력 폼의 카테고리 선택지 — 유형이 맞지 않는 카테고리는 애초에 노출되지 않는다)
export const incomeCategoryOptions = computed<string[]>(() => {
  const names = useTaxonomies().visibleIncomeCategoryNames.value
  return names.length > 0 ? names : INCOME_CATEGORIES
})
export const expenseCategoryOptions = computed<string[]>(() => {
  const names = useTaxonomies().visibleExpenseCategoryNames.value
  return names.length > 0 ? names : EXPENSE_CATEGORIES
})

/** 카테고리 이름으로 수입/지출 판정 — 카테고리 관리 설정을 그대로 따른다. */
function kindOfCategory(name: string): TxKind {
  return useTaxonomies().categoryType((name ?? '').trim())
}

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

// ── 대시보드 미러링 ──
//
// 수입/지출 관리에서 **수기로 입력한** 항목은 대시보드 거래 목록에도 그대로 반영되어
// KPI·차트·카테고리 집계에 함께 잡혀야 한다. 반대로 "사용내역 가져오기"로 들어온
// source='dashboard' 항목은 원래 대시보드에서 온 것이므로 되돌려 보내면 이중 계상이 된다.
//
// 추가/수정/삭제마다 개별 처리하면 경로를 빠뜨리기 쉬우므로, 미러링 대상 집합을
// 통째로 다시 만들어 대시보드 배열의 미러 구간만 교체한다(멱등).
// 대시보드 배열 쪽 변화(엑셀 업로드로 전체 교체 등)로 미러가 날아가도 다시 복구된다.

const MIRROR_ID_PREFIX = 'ie::'

/** 대시보드 거래가 수입/지출 관리에서 미러링된 것인지 */
export function isIncomeExpenseMirror(t: Transaction): boolean {
  return typeof t.ieSourceId === 'string' && t.ieSourceId !== ''
}

/** 수입/지출 항목 1건 → 대시보드 거래. 날짜가 잘못된 항목은 건너뛴다(null). */
function toDashboardTransaction(t: IncomeExpenseTx): Transaction | null {
  // 'YYYY-MM-DD'를 로컬 자정으로 해석한다 (new Date('YYYY-MM-DD')는 UTC라 하루 밀린다)
  const d = new Date(`${t.date}T00:00:00`)
  if (isNaN(d.getTime())) return null

  const tax = useTaxonomies()
  const category = (t.category ?? '').trim() || '기타'
  return {
    id: `${MIRROR_ID_PREFIX}${t.id}`,
    ieSourceId: t.id,
    date: d,
    description: (t.description ?? '').trim() || category,
    amount: Math.abs(Number(t.amount) || 0),
    category,
    paymentMethod: (t.paymentMethod ?? '').trim() || '기타결제',
    costType: tax.isFixedCategory(category) ? '고정비' : '변동비',
    note: (t.note ?? '').trim() || undefined,
    memberId: t.memberId,
    // 수입 카테고리는 대시보드 규칙대로 항상 지출 계산에서 제외 (enforceIncomeExclusion과 동일 판정)
    excluded: tax.isIncomeCategory(category),
    ...deriveFields(d)
  }
}

/**
 * 미러 비교용 서명.
 * excluded는 일부러 제외한다 — 대시보드 쪽에서 사용자가 직접 켠 제외 플래그나
 * 수입 자동 제외 규칙이 다시 덮어써지며 무한 루프가 되는 것을 막기 위해서다.
 */
function mirrorSignature(t: Transaction): string {
  return [
    t.id, t.date.getTime(), t.amount, t.category, t.paymentMethod,
    t.costType, t.description, t.note ?? '', t.memberId ?? ''
  ].join('|')
}

let syncingMirror = false
function syncMirrorToDashboard(): void {
  if (syncingMirror) return
  syncingMirror = true
  try {
    const desired = allTransactions.value
      .filter((t) => t.source !== 'dashboard')   // 가져온 항목은 되돌려 보내지 않는다
      .map(toDashboardTransaction)
      .filter((t): t is Transaction => t !== null)

    const current = transactionsRepo.state.value
    const existingMirrors = current.filter(isIncomeExpenseMirror)

    const before = existingMirrors.map(mirrorSignature).sort().join('\n')
    const after = desired.map(mirrorSignature).sort().join('\n')
    if (before === after) return               // 달라진 게 없으면 배열을 건드리지 않는다

    // 사용자가 대시보드에서 직접 켠 "지출 계산 제외"는 보존한다
    const keptExcluded = new Map(existingMirrors.map((t) => [t.id, t.excluded === true]))
    const merged = desired.map((t) =>
      keptExcluded.get(t.id) === true ? { ...t, excluded: true } : t
    )

    transactionsRepo.state.value = [...current.filter((t) => !isIncomeExpenseMirror(t)), ...merged]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  } finally {
    syncingMirror = false
  }
}

// 수입/지출 항목이 바뀌면(추가·수정·삭제) 물론이고, 대시보드 배열이 통째로 바뀐 경우에도 다시 맞춘다.
watch(
  [allTransactions, transactionsRepo.state],
  () => syncMirrorToDashboard(),
  { flush: 'sync', immediate: true }
)

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
  // 이 화면에서 미러링해 올려보낸 거래는 다시 가져오지 않는다 (자기 항목의 중복 생성 방지)
  dashboardTxs = dashboardTxs.filter((t) => !isIncomeExpenseMirror(t))
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
        // 카테고리에 설정된 유형을 따른다 (수입 카테고리는 수입으로 들어간다)
        kind: kindOfCategory(g.category),
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
        // 카테고리에 설정된 유형을 따른다
        kind: kindOfCategory((t.category ?? '').trim()),
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
    isIncomeExpenseMirror,
    INCOME_CATEGORIES,
    EXPENSE_CATEGORIES,
    incomeCategoryOptions,
    expenseCategoryOptions,
    kindOfCategory,
    PAYMENT_METHODS
  }
}
