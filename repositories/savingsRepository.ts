// 예금/적금 리포지토리. 적금 정보(info)와 납입 이력(history) 두 가지를 별도 키로 관리.
import { createRepository } from './createRepository'

export interface SavingsInfo {
  /** 상품 별칭 (선택) — 여러 적금을 구분하는 이름 */
  name: string
  bank: string
  type: string
  startDate: string
  endDate: string
  /** 매월 납입일 (1~31). 비우면 가입일의 '일'을 쓴다 */
  payDay: number | null
  rate: number | null
  targetAmount: number | null
  interestAmount: number | null
  /** 만기 이자금액 (세후) — 만기까지 받게 될 이자 */
  maturityInterest: number | null
  note: string
}

/** 등록된 예금/적금 1건 — 상품 정보 + 식별자. 납입 이력은 PaymentEntry.productId로 연결된다. */
export interface SavingsProduct extends SavingsInfo {
  id: string
  createdAt: string
}

export interface PaymentEntry {
  id: string
  /** 소속 적금(SavingsProduct.id). 구버전 이력에는 없으므로 첫 로드 시 첫 상품으로 채운다 */
  productId?: string
  date: string
  amount: number
  note: string
  createdAt: string
  /** 가족 멤버 ID — 활성 멤버 필터/합산에 사용 */
  memberId?: string
  /** 'dashboard' = 대시보드 거래내역(정기적금)에서 동기화, 'auto' = 가입월~현재월 자동 입력 */
  source?: 'dashboard' | 'auto'
  /** 동기화 항목의 중복 방지 키 (멤버 + 날짜 + 금액) */
  sourceId?: string
}

const KEY_INFO = 'savings:info:v1'
const KEY_HISTORY = 'savings:history:v1'
const KEY_PRODUCTS = 'savings:products:v1'

function defaultInfo(): SavingsInfo {
  return {
    name: '', bank: '', type: '', startDate: '', endDate: '', payDay: null,
    rate: null, targetAmount: null, interestAmount: null, maturityInterest: null, note: ''
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

// 등록된 예금/적금 목록 (여러 개). 정보 입력은 입력 중 자동저장 없이 명시 저장.
// 구버전의 단일 적금(KEY_INFO)은 useSavings 첫 로드 때 첫 상품으로 옮겨진다.
export const savingsProductsRepo = createRepository<SavingsProduct[]>({
  key: KEY_PRODUCTS,
  default: () => [],
  autoPersist: false,
  migrate: (raw) => {
    if (!Array.isArray(raw)) return null
    return raw
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).id === 'string')
      .map((x) => ({ ...defaultInfo(), createdAt: '', ...x }) as SavingsProduct)
  }
})

// 납입 이력: 변경 시 즉시 저장 (자동)
export const savingsHistoryRepo = createRepository<PaymentEntry[]>({
  key: KEY_HISTORY,
  default: () => [],
  validator: (x): x is PaymentEntry[] => Array.isArray(x) && x.every(isValidPayment)
})

export { defaultInfo as defaultSavingsInfo }
