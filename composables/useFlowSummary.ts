// 수입 · 지출 · 저축 · 남은 금액 요약 — "수입은 어디로 갔나", 순수지 Hero, 흐름 Sankey, 저축 비율이
// 같은 숫자를 보도록 한 곳에서 계산한다. (module-level computed: 모든 컴포넌트가 같은 인스턴스를 공유)
//
// 기준은 KPI/흐름과 같은 flowKind() 규칙이다.
//  - 이체·환불 상계 행은 제외, 음수 금액은 지출
//  - 저축 = 저축 유형 카테고리 + 저축 태그 결제수단 거래 (isSavingsFlow) — 지출에서는 빠진다
//  - 지출은 '지출 계산 제외' 플래그를 존중한다 (수입은 excluded를 보지 않는다)
// 즉 수입 = 지출 + 저축 + 남은 금액(역산) 이 항상 성립한다.
//
// 주의: 여기의 지출은 '저축을 분리한' 값이라, 저축 태그 결제를 지출에 그대로 두는
// KPI 총지출(expenseTotal)과 그 금액만큼 다를 수 있다 (kpiExpenseGap).
import { computed, effectScope } from 'vue'
import { useExpenses, flowKind, isSavingsFlow, isExcluded } from '~/composables/useExpenses'

export interface FlowGroup { category: string; amount: number; share: number }
type Bucket = '수입' | '지출' | '저축'

function toGroups(map: Map<string, number>): FlowGroup[] {
  const entries = Array.from(map.entries()).filter(([, v]) => v > 0)
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1
  return entries
    .map(([category, amount]) => ({ category, amount, share: amount / total }))
    .sort((a, b) => b.amount - a.amount)
}

function build() {
const { filteredAll, expenseTotal, incomeFiltered, filters } = useExpenses()

const buckets = computed(() => {
  const maps: Record<Bucket, Map<string, number>> = { 수입: new Map(), 지출: new Map(), 저축: new Map() }
  for (const t of filteredAll.value) {
    const k = flowKind(t)
    if (k === null) continue
    const eff: Bucket = isSavingsFlow(t) ? '저축' : k
    if (eff === '지출' && isExcluded(t)) continue
    maps[eff].set(t.category, (maps[eff].get(t.category) ?? 0) + (Number(t.amount) || 0))
  }
  return { income: toGroups(maps.수입), expense: toGroups(maps.지출), savings: toGroups(maps.저축) }
})

const sum = (g: FlowGroup[]) => g.reduce((s, x) => s + x.amount, 0)
const ratio = (v: number, base: number) => (base > 0 ? v / base : null)

const incomeGroups = computed(() => buckets.value.income)
const expenseGroups = computed(() => buckets.value.expense)
const savingsGroups = computed(() => buckets.value.savings)
const income = computed(() => sum(incomeGroups.value))
const expense = computed(() => sum(expenseGroups.value))
const savings = computed(() => sum(savingsGroups.value))

/** 순수지 = 수입 − 지출 (저축은 빼지 않는다) */
const net = computed(() => income.value - expense.value)
/** 남은 금액 = 수입 − 지출 − 저축 (역산). 음수면 수입보다 많이 쓴 것 */
const remaining = computed(() => income.value - expense.value - savings.value)

/**
 * 총수입이 어디로 흘러가는지 — 지출 → 저축 순으로 수입을 먼저 채우고, 모자라는 몫은 shortfall로 따로 센다.
 * 모든 노드에서 들어오는 양 = 나가는 양이 되도록 Sankey와 막대가 같은 값을 쓴다.
 */
const allocation = computed(() => {
  const inc = income.value
  const outFromIn = Math.min(expense.value, inc)
  const savFromIn = Math.min(savings.value, Math.max(0, inc - outFromIn))
  return {
    outFromIn,
    savFromIn,
    remainFromIn: Math.max(0, inc - outFromIn - savFromIn),
    shortfallOut: expense.value - outFromIn,
    shortfallSav: savings.value - savFromIn
  }
})

const savingsRate = computed(() => ratio(savings.value, income.value))
const expenseRate = computed(() => ratio(expense.value, income.value))
const remainingRate = computed(() => ratio(remaining.value, income.value))
/** KPI 총지출과 이 요약의 지출 차이 (저축 태그 결제분) */
const kpiExpenseGap = computed(() => Math.abs(expenseTotal.value - expense.value))

/** 전역 필터를 사람이 읽는 기간 이름으로 */
const periodLabel = computed(() => {
  const y = filters.year, m = filters.month
  if (y === 'all' && m === 'all') return '전체 기간'
  if (y !== 'all' && m === 'all') return `${y}년`
  if (y === 'all' && m !== 'all') return `${m}월 (매년)`
  return `${y}년 ${m}월`
})
/** 수입으로 집계된 거래 건수 */
const incomeCount = computed(() => incomeFiltered.value.length)

return {
    periodLabel, incomeCount,
    incomeGroups, expenseGroups, savingsGroups,
    income, expense, savings, net, remaining, allocation,
    savingsRate, expenseRate, remainingRate, kpiExpenseGap
  }
}

// useExpenses()는 첫 호출 시점(컴포넌트 setup)에 한 번만 열고, 이후 모든 호출이 같은 computed를 공유한다.
//
// 중요: build()를 첫 호출 컴포넌트의 setup 안에서 그냥 실행하면 거기서 만든 computed가 그 컴포넌트의
// effect scope에 묶인다. 그 컴포넌트가 unmount(페이지 이동 등)되면 공유 computed가 함께 정지되어
// 이후에는 거래를 수정·삭제해도 수입/지출/저축 구성이 갱신되지 않고 옛 값에 멈춘다.
// 그래서 컴포넌트와 무관한 분리(detached) scope 안에서 만들어 앱 수명 동안 살려 둔다.
let cached: ReturnType<typeof build> | null = null
export function useFlowSummary() {
  if (!cached) cached = effectScope(true).run(build)!
  return cached
}
