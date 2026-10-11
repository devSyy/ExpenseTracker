// 대출 현황 컴포저블 — loansRepo 위의 계산·액션 레이어.
import { createId } from '~/utils/id'
import { computed } from 'vue'
import { loansRepo, defaultLoanState } from '~/repositories/loansRepository'
import { useFamily } from '~/composables/useFamily'
import { categoryColors } from '~/utils/chartTheme'

export type RepaymentMethod = '원리금균등' | '원금균등' | '만기일시상환' | '리볼빙'
export type LoanStatus = '정상' | '연체' | '휴면' | '만기'

export interface Loan {
  id: string
  type: string
  institution: string
  product: string
  balance: number
  limit: number
  rate: number
  repaymentMethod: RepaymentMethod | string
  maturityDate: string
  monthlyPayment: number
  status: LoanStatus | string
  note: string
  /** 가족 멤버 ID — 활성 멤버 필터/합산에 사용 */
  memberId?: string
}

export interface LoanState {
  baseDate: string
  loans: Loan[]
}

/** 대출 구분 — 도넛 색 배정의 고정 순서이기도 하다 (금액 순위가 바뀌어도 색은 유지) */
export const LOAN_TYPES = ['주택담보대출', '사업자대출', '신용대출', '카드론', '기타대출', '자동차대출', '학자금대출'] as const

export interface BreakdownItem {
  label: string
  balance: number
  share: number
  color: string
}

const state = loansRepo.state

/** 활성 멤버의 대출만 필터링 */
const visibleLoans = computed<Loan[]>(() => {
  const fam = useFamily()
  return state.value.loans.filter((l) => fam.isMemberActive(l.memberId))
})

/** 상환 중(= 만기 처리되지 않았고 잔액이 남은) 대출 */
const activeLoans = computed(() => visibleLoans.value.filter((l) => l.status !== '만기' && l.balance > 0))

/** 상환 중 대출을 잔액 큰 순으로 */
const loansByBalance = computed(() => [...activeLoans.value].sort((a, b) => b.balance - a.balance))

/** 금리 현황 막대용 — 잔액이 남은 대출을 금리 높은 순으로 */
const loansByRate = computed(() =>
  visibleLoans.value.filter((l) => l.balance > 0).sort((a, b) => b.rate - a.rate)
)

const totalBalance = computed(() => visibleLoans.value.reduce((s, l) => s + (l.balance || 0), 0))
const totalLimit = computed(() => visibleLoans.value.reduce((s, l) => s + (l.limit || 0), 0))
const totalMonthlyPayment = computed(() => visibleLoans.value.reduce((s, l) => s + (l.monthlyPayment || 0), 0))
const weightedAvgRate = computed(() => {
  const tb = totalBalance.value
  if (tb <= 0) return 0
  return visibleLoans.value.reduce((s, l) => s + l.balance * l.rate, 0) / tb
})
const usageRate = computed(() => totalLimit.value > 0 ? totalBalance.value / totalLimit.value : 0)
const annualInterest = computed(() =>
  visibleLoans.value.reduce((s, l) => s + l.balance * (l.rate / 100), 0)
)
const rateRange = computed(() => {
  const rates = visibleLoans.value.filter((l) => l.balance > 0).map((l) => l.rate)
  if (rates.length === 0) return { min: 0, max: 0 }
  return { min: Math.min(...rates), max: Math.max(...rates) }
})

function buildBreakdown(keyOf: (l: Loan) => string, order?: readonly string[]): BreakdownItem[] {
  const map = new Map<string, number>()
  for (const l of visibleLoans.value) {
    if (l.balance <= 0) continue
    const k = keyOf(l)
    map.set(k, (map.get(k) ?? 0) + l.balance)
  }
  const total = totalBalance.value || 1
  const labels = Array.from(map.keys())
  const colors = categoryColors(labels, { order })
  return labels
    .map((label, i) => ({ label, balance: map.get(label)!, share: map.get(label)! / total, color: colors[i] }))
    .sort((a, b) => b.balance - a.balance)
}

const typeBreakdown = computed(() => buildBreakdown((l) => l.type || '기타대출', LOAN_TYPES))
const institutionBreakdown = computed(() => buildBreakdown((l) => l.institution?.trim() || '미지정'))

/** 구분별 색 — 도넛(구분별)과 요약 리스트 아바타가 같은 색을 쓰도록 */
function typeColor(type: string): string {
  const item = typeBreakdown.value.find((b) => b.label === type)
  if (item) return item.color
  return categoryColors([type], { order: LOAN_TYPES })[0]
}

interface ScheduleBucket { principal: number; interest: number; count: number }
interface SchedulePayload {
  within1y: ScheduleBucket
  y1to3:    ScheduleBucket
  y3to5:    ScheduleBucket
  over5y:   ScheduleBucket
}

function monthsBetween(from: string, to: string): number {
  const f = new Date(from), t = new Date(to)
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return 0
  return (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth())
}

/** 기준일 → 만기일까지 남은 개월 수 (만기 지났으면 0 이하) */
function monthsUntilMaturity(loan: Loan): number {
  return monthsBetween(state.value.baseDate, loan.maturityDate)
}

function bucketFor(months: number, payload: SchedulePayload): ScheduleBucket {
  if (months <= 12) return payload.within1y
  if (months <= 36) return payload.y1to3
  if (months <= 60) return payload.y3to5
  return payload.over5y
}

const schedule = computed<SchedulePayload>(() => {
  const out: SchedulePayload = {
    within1y: { principal: 0, interest: 0, count: 0 },
    y1to3:    { principal: 0, interest: 0, count: 0 },
    y3to5:    { principal: 0, interest: 0, count: 0 },
    over5y:   { principal: 0, interest: 0, count: 0 }
  }
  const base = state.value.baseDate

  for (const loan of visibleLoans.value) {
    const months = monthsBetween(base, loan.maturityDate)
    if (months <= 0 || loan.balance <= 0) continue
    const monthlyRate = (loan.rate / 100) / 12

    // 이 대출의 상환액이 실제로 걸치는 구간을 센다 (건수 표시용)
    const touched = new Set<ScheduleBucket>()
    const post = (m: number, principal: number, interest: number) => {
      const b = bucketFor(m, out)
      b.principal += principal
      b.interest += interest
      if (!touched.has(b)) { touched.add(b); b.count++ }
    }

    if (loan.repaymentMethod === '원리금균등' && loan.monthlyPayment > 0) {
      let balance = loan.balance
      for (let m = 1; m <= months && balance > 0; m++) {
        const interest = balance * monthlyRate
        let principal = loan.monthlyPayment - interest
        if (principal > balance) principal = balance
        if (principal < 0) principal = 0
        post(m, principal, interest)
        balance -= principal
      }
    } else if (loan.repaymentMethod === '만기일시상환') {
      const monthlyInterest = loan.balance * monthlyRate
      for (let m = 1; m <= months; m++) post(m, 0, monthlyInterest)
      post(months, loan.balance, 0)
    } else if (loan.repaymentMethod === '원금균등' && loan.monthlyPayment > 0) {
      const principalPerMonth = loan.balance / months
      let balance = loan.balance
      for (let m = 1; m <= months && balance > 0; m++) {
        const interest = balance * monthlyRate
        const principal = Math.min(principalPerMonth, balance)
        post(m, principal, interest)
        balance -= principal
      }
    }
  }
  return out
})

const scheduleRows = computed(() => {
  const s = schedule.value
  return [
    { key: 'within1y', label: '1년 이내',   ...s.within1y },
    { key: 'y1to3',    label: '1~3년 이내', ...s.y1to3 },
    { key: 'y3to5',    label: '3~5년 이내', ...s.y3to5 },
    { key: 'over5y',   label: '5년 초과',   ...s.over5y }
  ]
})

function addLoan(input: Omit<Loan, 'id'>): Loan {
  const fam = useFamily()
  const loan: Loan = { ...input, id: createId('l_'), memberId: input.memberId ?? fam.primaryMemberId.value ?? undefined }
  state.value = { ...state.value, loans: [...state.value.loans, loan] }
  return loan
}

function updateLoan(id: string, patch: Partial<Loan>): boolean {
  const idx = state.value.loans.findIndex((l) => l.id === id)
  if (idx === -1) return false
  const next = state.value.loans.slice()
  next[idx] = { ...next[idx], ...patch }
  state.value = { ...state.value, loans: next }
  return true
}

function removeLoan(id: string): boolean {
  const before = state.value.loans.length
  state.value = { ...state.value, loans: state.value.loans.filter((l) => l.id !== id) }
  return state.value.loans.length < before
}

/** 여러 건 삭제 — 삭제된 건수를 돌려준다 */
function removeLoans(ids: string[]): number {
  const set = new Set(ids)
  const before = state.value.loans.length
  state.value = { ...state.value, loans: state.value.loans.filter((l) => !set.has(l.id)) }
  return before - state.value.loans.length
}

function setBaseDate(date: string) {
  state.value = { ...state.value, baseDate: date }
}

function resetToDefaults() {
  state.value = defaultLoanState()
}

export function useLoans() {
  return {
    state,
    visibleLoans,
    activeLoans,
    loansByBalance,
    loansByRate,
    totalBalance,
    totalLimit,
    totalMonthlyPayment,
    weightedAvgRate,
    usageRate,
    annualInterest,
    rateRange,
    typeBreakdown,
    institutionBreakdown,
    typeColor,
    schedule,
    scheduleRows,
    monthsUntilMaturity,
    addLoan,
    updateLoan,
    removeLoan,
    removeLoans,
    setBaseDate,
    resetToDefaults
  }
}
