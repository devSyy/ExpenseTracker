// 카드 관리 리포지토리.
// 보유 카드, 카드별 이번 달 사용금액, 금액별 혜택 단계(threshold + benefit)를 관리.
import { createRepository } from './createRepository'

export interface CardBenefitTier {
  /** 충족 조건 금액 (원 단위) */
  threshold: number
  /** 혜택 설명 (예: "카페 10% 할인") */
  benefit: string
  /** 혜택 가치 (월 환산, 통계용 — 선택) */
  benefitValue?: number
}

export type CardKind = '신용카드' | '체크카드' | '하이브리드'

export interface CardItem {
  id: string
  name: string                    // 카드 이름
  issuer: string                  // 카드사
  type: CardKind | string
  number: string                  // 마스킹된 카드번호 (예: **** **** **** 1234)
  color: string                   // 카드 비주얼 색
  /**
   * 수동 입력된 사용금액 (fallback). linkedPaymentMethods가 비어있을 때만 사용.
   * dashboard 거래에 연결되어 있으면 이 값은 무시되고 계산된 값이 우선한다.
   */
  monthlySpending: number
  benefits: CardBenefitTier[]
  note: string
  /**
   * 이 카드가 대표하는 대시보드 거래의 결제수단 이름들.
   * 비어있으면 monthlySpending(수동값)을 사용. 한 카드가 여러 paymentMethod를
   * 합산할 수도 있다 (예: "네이버페이 간편결제" + "네이버페이 간편결제(머니)").
   */
  linkedPaymentMethods?: string[]
  /** 가족 멤버 ID — 활성 멤버 필터/합산에 사용 */
  memberId?: string
}

export interface CardState {
  baseDate: string
  cards: CardItem[]
}

const KEY = 'cards:state:v1'

function defaultCardState(): CardState {
  return {
    baseDate: '2024-06-30',
    cards: [
      {
        id: 'cd1',
        name: '신한 Deep Dream',
        issuer: '신한카드',
        type: '신용카드',
        number: '**** **** **** 1234',
        color: '#0046ff',
        monthlySpending: 850_000,
        benefits: [
          { threshold:   300_000, benefit: '카페 10% 할인',     benefitValue:  10_000 },
          { threshold:   700_000, benefit: '주유 50원/L 할인',  benefitValue:  20_000 },
          { threshold: 1_000_000, benefit: '연회비 면제',       benefitValue:  15_000 }
        ],
        note: ''
      },
      {
        id: 'cd2',
        name: '삼성 taptap O',
        issuer: '삼성카드',
        type: '신용카드',
        number: '**** **** **** 5678',
        color: '#1428a0',
        monthlySpending: 420_000,
        benefits: [
          { threshold:   300_000, benefit: '대중교통 10% 할인', benefitValue:  8_000 },
          { threshold:   600_000, benefit: '편의점 15% 할인',   benefitValue: 12_000 },
          { threshold: 1_000_000, benefit: '온라인쇼핑 5% 할인', benefitValue: 25_000 }
        ],
        note: ''
      },
      {
        id: 'cd3',
        name: '국민 마이위시',
        issuer: 'KB국민카드',
        type: '신용카드',
        number: '**** **** **** 9012',
        color: '#ffbc00',
        monthlySpending: 1_120_000,
        benefits: [
          { threshold:   500_000, benefit: '외식 5% 할인',      benefitValue: 15_000 },
          { threshold:   800_000, benefit: '여행 3% 적립',      benefitValue: 18_000 },
          { threshold: 1_500_000, benefit: '바우처 30,000원',   benefitValue: 30_000 }
        ],
        note: ''
      },
      {
        id: 'cd4',
        name: '카카오뱅크 체크',
        issuer: '카카오뱅크',
        type: '체크카드',
        number: '**** **** **** 3456',
        color: '#ffd400',
        monthlySpending: 180_000,
        benefits: [
          { threshold: 100_000, benefit: '생활비 1% 캐시백',  benefitValue:  3_000 },
          { threshold: 300_000, benefit: '카페 5% 캐시백',    benefitValue:  8_000 }
        ],
        note: ''
      }
    ]
  }
}

function isValidCard(x: unknown): x is CardItem {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.id === 'string'
    && typeof o.name === 'string'
    && typeof o.monthlySpending === 'number'
    && Array.isArray(o.benefits)
}

export const cardsRepo = createRepository<CardState>({
  key: KEY,
  default: defaultCardState,
  migrate: (raw) => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Partial<CardState>
    const def = defaultCardState()
    return {
      baseDate: typeof r.baseDate === 'string' ? r.baseDate : def.baseDate,
      cards: Array.isArray(r.cards) ? r.cards.filter(isValidCard) : def.cards
    }
  }
})

export { defaultCardState }
