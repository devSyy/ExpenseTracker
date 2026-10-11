// 지출 목표 · 추이 컴포저블.
//
// 지출 합계는 대시보드 KPI와 같은 규칙(isExcluded + flowKind === '지출')을 쓰되,
// 대시보드의 연·월·카테고리·결제수단·검색 필터는 따르지 않는다 — 이 화면은 항상 "전체 기간의 전체 지출"이다.
// (멤버 선택과 숨김 카테고리만 따른다: 합산 대상이 달라지는 설정이므로)
import { computed } from 'vue'
import { useExpenses, isExcluded, flowKind } from '~/composables/useExpenses'
import { useFamily } from '~/composables/useFamily'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { spendingGoalsRepo } from '~/repositories/spendingGoalsRepository'
import { buildDayMap, firstYearOf, type DayMap, type SpendingGoals } from '~/utils/spendingGoals'

const clone = (g: SpendingGoals): SpendingGoals => ({ monthly: g.monthly, overrides: { ...g.overrides } })

export function useSpendingGoals() {
  const { transactions } = useExpenses()
  const fam = useFamily()
  const tax = useTaxonomies()

  /** 지출 거래만 일별로 합친 맵 */
  const dayMap = computed<DayMap>(() => {
    const hidden = new Set(tax.categories.value.filter((c) => c.hidden).map((c) => c.name))
    const spend = transactions.value.filter(
      (t) => fam.isMemberActive(t.memberId) && !hidden.has(t.category) && !isExcluded(t) && flowKind(t) === '지출'
    )
    return buildDayMap(spend)
  })

  const firstYear = computed(() => firstYearOf(dayMap.value, new Date()))
  const hasData = computed(() => dayMap.value.size > 0)

  const goals = spendingGoalsRepo.state
  const savedGoals = (): SpendingGoals => clone(goals.value)

  function saveGoals(next: SpendingGoals): boolean {
    goals.value = clone(next)
    return spendingGoalsRepo.save()
  }

  return { dayMap, firstYear, hasData, goals, savedGoals, saveGoals }
}
