// 대출 현황 컴포저블 — loansRepo 위의 계산·액션 레이어.
import { computed } from 'vue'
import { loansRepo, defaultLoanState } from '~/repositories/loansRepository'
import { useFamily } from '~/composables/useFamily'

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

export const LOAN_TYPE_COLORS: Record<string, string> = {
  '주택담보대출': '#3b82f6',
  '사업자대출':   '#10b981',
  '신용대출':     '#f59e0b',
  '카드론':       '#f97316',
  '기타대출':     '#94a3b8'
}

function colorFor(type: string): string {
  return LOAN_TYPE_COLORS[type] ?? '#94a3b8'
}

const state = loansRepo.state

/** 활성 멤버의 대출만 필터링 */
const visibleLoans = computed<Loan[]>(() => {
  const fam = useFamily()
  return state.value.loans.filter((l) => fam.isMemberActive(l.memberId))
})

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

const balanceBreakdown = computed(() => {
  const map = new Map<string, number>()
  for (const l of visibleLoans.value) map.set(l.type, (map.get(l.type) ?? 0) + l.balance)
  const tb = totalBalance.value || 1
  return Array.from(map.entries())
    .map(([type, balance]) => ({ type, balance, share: balance / tb, color: colorFor(type) }))
    .sort((a, b) => b.balance - a.balance)
})

const ratesByType = computed(() => {
  const groups = new Map<string, { sum: number; bal: number }>()
  for (const l of visibleLoans.value) {
    const g = groups.get(l.type) ?? { sum: 0, bal: 0 }
    g.sum += l.balance * l.rate
    g.bal += l.balance
    groups.set(l.type, g)
  }
  return Array.from(groups.entries()).map(([type, g]) => ({ type, rate: g.bal > 0 ? g.sum / g.bal : 0 }))
})

interface ScheduleBucket { principal: number; interest: number }
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

function bucketFor(months: number, payload: SchedulePayload): ScheduleBucket {
  if (months <= 12) return payload.within1y
  if (months <= 36) return payload.y1to3
  if (months <= 60) return payload.y3to5
  return payload.over5y
}

const schedule = computed<SchedulePayload>(() => {
  const out: SchedulePayload = {
    within1y: { principal: 0, interest: 0 },
    y1to3:    { principal: 0, interest: 0 },
    y3to5:    { principal: 0, interest: 0 },
    over5y:   { principal: 0, interest: 0 }
  }
  const base = state.value.baseDate

  for (const loan of visibleLoans.value) {
    const months = monthsBetween(base, loan.maturityDate)
    if (months <= 0 || loan.balance <= 0) continue
    const monthlyRate = (loan.rate / 100) / 12

    if (loan.repaymentMethod === '원리금균등' && loan.monthlyPayment > 0) {
      let balance = loan.balance
      for (let m = 1; m <= months && balance > 0; m++) {
        const interest = balance * monthlyRate
        let principal = loan.monthlyPayment - interest
        if (principal > balance) principal = balance
        if (principal < 0) principal = 0
        const b = bucketFor(m, out)
        b.principal += principal
        b.interest += interest
        balance -= principal
      }
    } else if (loan.repaymentMethod === '만기일시상환') {
      const monthlyInterest = loan.balance * monthlyRate
      for (let m = 1; m <= months; m++) bucketFor(m, out).interest += monthlyInterest
      bucketFor(months, out).principal += loan.balance
    } else if (loan.repaymentMethod === '원금균등' && loan.monthlyPayment > 0) {
      const principalPerMonth = loan.balance / months
      let balance = loan.balance
      for (let m = 1; m <= months && balance > 0; m++) {
        const interest = balance * monthlyRate
        const principal = Math.min(principalPerMonth, balance)
        const b = bucketFor(m, out)
        b.principal += principal
        b.interest += interest
        balance -= principal
      }
    }
  }
  return out
})

function uid() {
  return 'l_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
}

function addLoan(input: Omit<Loan, 'id'>): Loan {
  const fam = useFamily()
  const loan: Loan = { ...input, id: uid(), memberId: input.memberId ?? fam.primaryMemberId.value ?? undefined }
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

function setBaseDate(date: string) {
  state.value = { ...state.value, baseDate: date }
}

function resetToDefaults() {
  state.value = defaultLoanState()
}

export function useLoans() {
  return {
    state,
    totalBalance,
    totalLimit,
    totalMonthlyPayment,
    weightedAvgRate,
    usageRate,
    annualInterest,
    balanceBreakdown,
    ratesByType,
    schedule,
    addLoan,
    updateLoan,
    removeLoan,
    setBaseDate,
    resetToDefaults,
    LOAN_TYPE_COLORS
  }
}
