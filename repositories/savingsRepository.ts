// 예금/적금 리포지토리. 적금 정보(info)와 납입 이력(history) 두 가지를 별도 키로 관리.
import { createRepository } from './createRepository'

export interface SavingsInfo {
  bank: string
  type: string
  startDate: string
  endDate: string
  rate: number | null
  targetAmount: number | null
  interestAmount: number | null
  note: string
}

export interface PaymentEntry {
  id: string
  date: string
  amount: number
  note: string
  createdAt: string
  /** 가족 멤버 ID — 활성 멤버 필터/합산에 사용 */
  memberId?: string
}

const KEY_INFO = 'savings:info:v1'
const KEY_HISTORY = 'savings:history:v1'

function defaultInfo(): SavingsInfo {
  return {
    bank: '', type: '', startDate: '', endDate: '',
    rate: null, targetAmount: null, interestAmount: null, note: ''
  }
}

function isValidPayment(x: unknown): x is PaymentEntry {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.id === 'string'
    && typeof o.date === 'string'
    && typeof o.amount === 'number' && Number.isFinite(o.amount as number)
}

// 적금 정보: 입력 중 자동저장 안 함 (명시 저장)
export const savingsInfoRepo = createRepository<SavingsInfo>({
  key: KEY_INFO,
  default: defaultInfo,
  autoPersist: false,
  migrate: (raw) => {
    if (!raw || typeof raw !== 'object') return null
    return { ...defaultInfo(), ...(raw as Partial<SavingsInfo>) }
  }
})

// 납입 이력: 변경 시 즉시 저장 (자동)
export const savingsHistoryRepo = createRepository<PaymentEntry[]>({
  key: KEY_HISTORY,
  default: () => [],
  validator: (x): x is PaymentEntry[] => Array.isArray(x) && x.every(isValidPayment)
})

export { defaultInfo as defaultSavingsInfo }
