// 카드 관리 컴포저블 — cardsRepo 위에 계산·액션을 얹은 레이어.
// 사용금액은 대시보드 거래(useExpenses)에 연결된 paymentMethod 합계로 자동 계산되며,
// 연결되지 않은 카드는 card.monthlySpending(수기 입력)을 fallback으로 사용한다.
import { computed, ref } from 'vue'
import { cardsRepo, defaultCardState } from '~/repositories/cardsRepository'
import type { CardBenefitTier, CardItem, CardState } from '~/repositories/cardsRepository'
import { useExpenses } from '~/composables/useExpenses'
import { useFamily } from '~/composables/useFamily'

export type { CardBenefitTier, CardItem, CardState }

const state = cardsRepo.state
const { transactions: dashboardTxs } = useExpenses()

/** 활성 멤버 카드만 필터링한 뷰 */
const visibleCards = computed<CardItem[]>(() => {
  const fam = useFamily()
  return state.value.cards.filter((c) => fam.isMemberActive(c.memberId))
})

// ── 기간 선택 ──
// 'current' = 시스템 현재 월, 'all' = 전체, 'YYYY-MM' = 특정 월
export type Period = 'current' | 'all' | string
const period = ref<Period>('current')

const currentYm = (): string => new Date().toISOString().slice(0, 7)

const periodLabel = computed<string>(() => {
  if (period.value === 'all') return '전체 기간'
  if (period.value === 'current') return `${currentYm()} (이번 달)`
  return period.value
})

const availablePeriods = computed<string[]>(() => {
  const set = new Set<string>()
  for (const t of dashboardTxs.value) {
    if (t.monthLabel) set.add(t.monthLabel)
  }
  return Array.from(set).sort().reverse()
})

/** 대시보드에서 등장한 모든 paymentMethod (활성 정렬) */
const availablePaymentMethods = computed<string[]>(() => {
  const set = new Set<string>()
  for (const t of dashboardTxs.value) if (t.paymentMethod) set.add(t.paymentMethod)
  return Array.from(set).sort()
})

/** 현재 기간(period)에 해당하는 거래 부분집합 */
const periodTxs = computed(() => {
  if (period.value === 'all') return dashboardTxs.value
  const ym = period.value === 'current' ? currentYm() : period.value
  return dashboardTxs.value.filter((t) => t.monthLabel === ym)
})

/** 카드 한 장의 효과적 사용금액 = 연결된 paymentMethod 합계 (없으면 수동값) */
function effectiveSpendingFor(card: CardItem): number {
  const linked = card.linkedPaymentMethods ?? []
  if (linked.length === 0) return card.monthlySpending || 0
  const set = new Set(linked)
  return periodTxs.value
    .filter((t) => set.has(t.paymentMethod))
    .reduce((s, t) => s + t.amount, 0)
}

/** 대시보드 연결 여부 */
function isLinked(card: CardItem): boolean {
  return Array.isArray(card.linkedPaymentMethods) && card.linkedPaymentMethods.length > 0
}

// ── 합계·요약 ──

const cardCount = computed(() => visibleCards.value.length)
const linkedCardCount = computed(() => visibleCards.value.filter((c) => isLinked(c)).length)
const totalSpending = computed(() =>
  visibleCards.value.reduce((s, c) => s + effectiveSpendingFor(c), 0)
)
const totalBenefitTiers = computed(() =>
  visibleCards.value.reduce((s, c) => s + c.benefits.length, 0)
)

const achievedTiers = computed(() => {
  let n = 0
  for (const c of visibleCards.value) {
    const spend = effectiveSpendingFor(c)
    n += c.benefits.filter((b) => spend >= b.threshold).length
  }
  return n
})
const achievedValue = computed(() => {
  let v = 0
  for (const c of visibleCards.value) {
    const spend = effectiveSpendingFor(c)
    for (const b of c.benefits) {
      if (spend >= b.threshold && Number.isFinite(b.benefitValue)) {
        v += Number(b.benefitValue) || 0
      }
    }
  }
  return v
})

// ── 카드별 상세 ──

export interface BenefitAchievement {
  tier: CardBenefitTier
  achieved: boolean
}

export interface CardDetail {
  card: CardItem
  spending: number
  linked: boolean
  achievements: BenefitAchievement[]
  nextTier: CardBenefitTier | null
  remainingToNext: number
  progressToNext: number
  achievedRatio: number
}

const cardDetails = computed<CardDetail[]>(() =>
  visibleCards.value.map((card) => {
    const sorted = card.benefits.slice().sort((a, b) => a.threshold - b.threshold)
    const spending = effectiveSpendingFor(card)
    const achievements: BenefitAchievement[] = sorted.map((tier) => ({
      tier, achieved: spending >= tier.threshold
    }))
    const nextTier = sorted.find((t) => spending < t.threshold) ?? null
    const remainingToNext = nextTier ? Math.max(0, nextTier.threshold - spending) : 0
    let progressToNext = 1
    if (nextTier) {
      const lastAchieved = sorted.filter((t) => spending >= t.threshold).pop()
      const lower = lastAchieved ? lastAchieved.threshold : 0
      const upper = nextTier.threshold
      const span = Math.max(1, upper - lower)
      progressToNext = Math.min(1, Math.max(0, (spending - lower) / span))
    }
    const achievedRatio = sorted.length > 0
      ? achievements.filter((a) => a.achieved).length / sorted.length
      : 0
    return {
      card,
      spending,
      linked: isLinked(card),
      achievements,
      nextTier,
      remainingToNext,
      progressToNext,
      achievedRatio
    }
  })
)

// ── 액션 ──

function uid() {
  return 'cd_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
}

function addCard(input: Omit<CardItem, 'id'>): CardItem {
  const fam = useFamily()
  const card: CardItem = {
    ...input,
    id: uid(),
    benefits: input.benefits ?? [],
    linkedPaymentMethods: input.linkedPaymentMethods ?? [],
    memberId: input.memberId ?? fam.primaryMemberId.value ?? undefined
  }
  state.value = { ...state.value, cards: [...state.value.cards, card] }
  return card
}

function updateCard(id: string, patch: Partial<CardItem>): boolean {
  const idx = state.value.cards.findIndex((c) => c.id === id)
  if (idx === -1) return false
  const next = state.value.cards.slice()
  next[idx] = { ...next[idx], ...patch }
  state.value = { ...state.value, cards: next }
  return true
}

function removeCard(id: string): boolean {
  const before = state.value.cards.length
  state.value = { ...state.value, cards: state.value.cards.filter((c) => c.id !== id) }
  return state.value.cards.length < before
}

/**
 * 대시보드의 paymentMethod별로 카드를 일괄 생성.
 * 이미 같은 paymentMethod에 연결된 카드가 있으면 건너뛴다.
 * 색상은 결정적 해시 기반으로 분배해 시각적으로 구분.
 */
function autoGenerateFromDashboard(): { added: number; skipped: number } {
  const existingLinks = new Set<string>()
  for (const c of state.value.cards) {
    for (const pm of c.linkedPaymentMethods ?? []) existingLinks.add(pm)
  }
  const palette = ['#0046ff', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#0ea5e9', '#f97316', '#22c55e', '#1428a0', '#ffbc00']
  let added = 0
  let skipped = 0
  const newCards: CardItem[] = []
  for (const pm of availablePaymentMethods.value) {
    if (existingLinks.has(pm)) { skipped++; continue }
    const colorIdx = simpleHash(pm) % palette.length
    newCards.push({
      id: uid(),
      name: pm,
      issuer: inferIssuer(pm),
      type: pm.includes('체크') ? '체크카드' : pm.includes('카드') ? '신용카드' : '하이브리드',
      number: '',
      color: palette[colorIdx],
      monthlySpending: 0,
      benefits: [],
      note: '',
      linkedPaymentMethods: [pm]
    })
    added++
  }
  if (added > 0) {
    state.value = { ...state.value, cards: [...state.value.cards, ...newCards] }
  }
  return { added, skipped }
}

function simpleHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}
function inferIssuer(pm: string): string {
  const m = pm.match(/^[가-힣A-Za-z0-9]+/)
  return m ? m[0] : pm
}

// ── 혜택 단계 CRUD ──
function addBenefit(cardId: string, tier: CardBenefitTier): boolean {
  const card = state.value.cards.find((c) => c.id === cardId)
  if (!card) return false
  return updateCard(cardId, {
    benefits: [...card.benefits, tier].sort((a, b) => a.threshold - b.threshold)
  })
}
function updateBenefit(cardId: string, idx: number, patch: Partial<CardBenefitTier>): boolean {
  const card = state.value.cards.find((c) => c.id === cardId)
  if (!card || idx < 0 || idx >= card.benefits.length) return false
  const next = card.benefits.slice()
  next[idx] = { ...next[idx], ...patch }
  next.sort((a, b) => a.threshold - b.threshold)
  return updateCard(cardId, { benefits: next })
}
function removeBenefit(cardId: string, idx: number): boolean {
  const card = state.value.cards.find((c) => c.id === cardId)
  if (!card || idx < 0 || idx >= card.benefits.length) return false
  return updateCard(cardId, { benefits: card.benefits.filter((_, i) => i !== idx) })
}

function setBaseDate(date: string) {
  state.value = { ...state.value, baseDate: date }
}

function resetToDefaults() {
  state.value = defaultCardState()
}

export function useCards() {
  return {
    state,
    period,
    periodLabel,
    availablePeriods,
    availablePaymentMethods,
    cardCount,
    linkedCardCount,
    totalSpending,
    totalBenefitTiers,
    achievedTiers,
    achievedValue,
    cardDetails,
    addCard,
    updateCard,
    removeCard,
    addBenefit,
    updateBenefit,
    removeBenefit,
    autoGenerateFromDashboard,
    setBaseDate,
    resetToDefaults
  }
}
