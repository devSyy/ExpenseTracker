// 대출 현황 리포지토리.
import { createRepository } from './createRepository'
import type { Loan, LoanState } from '~/composables/useLoans'

const KEY = 'loans:state:v1'

function isValidLoan(x: unknown): x is Loan {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.id === 'string'
    && typeof o.type === 'string'
    && typeof o.balance === 'number'
    && Number.isFinite(o.balance as number)
}

function defaultLoanState(): LoanState {
  return {
    baseDate: '2024-06-30',
    loans: [
      { id: 'l1', type: '주택담보대출', institution: 'A은행',     product: '주택담보대출',  balance: 305_000_000, limit: 400_000_000, rate: 3.45, repaymentMethod: '원리금균등', maturityDate: '2034-03-15', monthlyPayment: 1_680_000, status: '정상', note: '아파트 1채' },
      { id: 'l2', type: '사업자대출',   institution: 'B은행',     product: '운전자금대출',  balance: 180_000_000, limit: 200_000_000, rate: 4.20, repaymentMethod: '원리금균등', maturityDate: '2027-08-20', monthlyPayment: 1_200_000, status: '정상', note: '' },
      { id: 'l3', type: '신용대출',     institution: 'C캐피탈',   product: '신용대출(개인)', balance:  85_000_000, limit: 100_000_000, rate: 6.90, repaymentMethod: '원리금균등', maturityDate: '2026-07-10', monthlyPayment:   700_000, status: '정상', note: '' },
      { id: 'l4', type: '카드론',       institution: 'D카드',     product: '카드론',         balance:  45_000_000, limit:  50_000_000, rate:15.00, repaymentMethod: '원리금균등', maturityDate: '2025-11-30', monthlyPayment: 0,         status: '정상', note: '' },
      { id: 'l5', type: '기타대출',     institution: 'E저축은행', product: '예금담보대출',  balance:  57_000_000, limit: 100_000_000, rate: 4.80, repaymentMethod: '만기일시상환', maturityDate: '2025-12-31', monthlyPayment: 0,         status: '정상', note: '' }
    ]
  }
}

export const loansRepo = createRepository<LoanState>({
  key: KEY,
  default: defaultLoanState,
  migrate: (raw) => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Partial<LoanState>
    const def = defaultLoanState()
    return {
      baseDate: typeof r.baseDate === 'string' ? r.baseDate : def.baseDate,
      loans: Array.isArray(r.loans) ? r.loans.filter(isValidLoan) : def.loans
    }
  }
})

export { defaultLoanState }
