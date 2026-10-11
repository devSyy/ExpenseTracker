// 지출 목표 저장소 — 설정 화면에서 "저장"을 눌렀을 때만 영속화한다 (입력 중 값이 곧바로 저장되지 않게).
import { createRepository } from '~/repositories/createRepository'
import { EMPTY_GOALS, isValidGoals, type SpendingGoals } from '~/utils/spendingGoals'

export const SPENDING_GOALS_KEY = 'expense:spendingGoals:v1'

export const spendingGoalsRepo = createRepository<SpendingGoals>({
  key: SPENDING_GOALS_KEY,
  default: EMPTY_GOALS,
  validator: isValidGoals,
  autoPersist: false
})
