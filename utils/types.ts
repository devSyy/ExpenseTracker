// 공용 타입 정의
//
// 카테고리/결제수단은 사용자가 settings 페이지에서 자유롭게 추가·수정·삭제할 수 있으므로
// 정적 union 대신 `string`으로 완화한다. 아래 DEFAULT_* 상수는 처음 실행 시에만
// 초기값으로 사용되며, 이후에는 useTaxonomies()의 reactive 목록이 진실의 원천(SoT)이다.

/** 결제수단 (기본 7종) — 사용자가 자유롭게 변경 가능 */
export type PaymentMethod = string

export const DEFAULT_PAYMENT_METHODS = [
  '롯데카드',
  '삼성카드',
  '지역화폐',
  '신한체크카드',
  '토스공유카드1',
  '토스공유카드2',
  '기타결제'
] as const

/** 지출 카테고리 — 사용자가 자유롭게 변경 가능 */
export type Category = string

export const DEFAULT_CATEGORIES = [
  '식비',
  '마트',
  '전통시장',
  '공과금',
  '전기요금',
  '관리비',
  '가스요금',
  '통신비',
  '대출이자',
  '교통',
  '의료',
  '교육',
  '문화/여가',
  '의류/미용',
  '경조사',
  '주거',
  '입출금',
  '기타'
] as const

/** 고정비 / 변동비 */
export type CostType = '고정비' | '변동비'

/** 기본적으로 고정비로 처리되는 카테고리 (초기값) */
export const DEFAULT_FIXED_CATEGORIES = [
  '공과금',
  '전기요금',
  '관리비',
  '가스요금',
  '통신비',
  '대출이자',
  '주거'
] as const

/** 카테고리 정의 — 이름 + 고정비 여부 + 표시 여부 */
export interface CategoryDef {
  name: string
  isFixed: boolean
  hidden?: boolean
}

/** 결제수단 정의 — 이름 + 표시 여부 */
export interface PaymentDef {
  name: string
  hidden?: boolean
}

// ── 하위 호환 alias ──
// 기존 코드(특히 utils/classify.ts)가 CATEGORIES / PAYMENT_METHODS / FIXED_CATEGORIES를 import 한다.
// 분류 로직은 "초기 분류"용이므로 기본값을 그대로 사용해도 무방하다.
export const CATEGORIES: readonly string[] = DEFAULT_CATEGORIES
export const PAYMENT_METHODS: readonly string[] = DEFAULT_PAYMENT_METHODS
export const FIXED_CATEGORIES: readonly string[] = DEFAULT_FIXED_CATEGORIES

/** 집계 기간 구분 */
export type PeriodKind = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly'

/** 표준화된 단일 거래 */
export interface Transaction {
  id: string
  date: Date
  description: string
  amount: number                  // 양수 = 지출
  category: Category
  paymentMethod: PaymentMethod
  costType: CostType
  note?: string
  /** 가족 멤버 ID — 활성 멤버 필터/합산에 사용. 비어있으면 primary 소속으로 간주. */
  memberId?: string
  // 사전 계산된 파생 필드 (필터/그룹용)
  year: number                    // 2026
  month: number                   // 1..12
  quarter: number                 // 1..4
  half: 1 | 2                     // 상반기(1) / 하반기(2)
  weekLabel: string               // 2026-W17
  monthLabel: string              // 2026-04
  quarterLabel: string            // 2026-Q2
  halfLabel: string               // 2026-H1
  yearLabel: string               // 2026
}

/** 파일 파싱 결과 */
export interface ParseResult {
  transactions: Transaction[]
  warnings: string[]
  detectedColumns: Record<string, string>
  totalRows: number
}
