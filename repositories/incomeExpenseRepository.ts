// 수입/지출 거래 리포지토리.
import { createRepository } from './createRepository'
import type { IncomeExpenseTx } from '~/composables/useIncomeExpense'

const KEY = 'transactions:income-expense:v1'

function isValid(x: unknown): x is IncomeExpenseTx {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.id === 'string'
    && typeof o.date === 'string'
    && (o.kind === '수입' || o.kind === '지출')
    && typeof o.category === 'string'
    && typeof o.amount === 'number'
    && Number.isFinite(o.amount as number)
}

export const incomeExpenseRepo = createRepository<IncomeExpenseTx[]>({
  key: KEY,
  default: () => [],
  validator: (x): x is IncomeExpenseTx[] => Array.isArray(x) && x.every(isValid)
})
