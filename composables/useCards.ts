// 카드 관리 컴포저블 — cardsRepo 위에 계산·액션을 얹은 레이어.
// 사용금액은 대시보드 거래(useExpenses)에 연결된 paymentMethod 합계로 자동 계산되며,
// 연결되지 않은 카드는 card.monthlySpending(수기 입력)을 fallback으로 사용한다.
import { createId } from '~/utils/id'
import { computed, ref } from 'vue'
import { cardsRepo, defaultCardState } from '~/repositories/cardsRepository'
import type { CardBenefitTier, CardItem, CardState } from '~/repositories/cardsRepository'
import { useExpenses, isExcluded, flowKind } from '~/composables/useExpenses'
import { useFamily } from '~/composables/useFamily'
import { useTaxonomies } from '~/composables/useTaxonomies'
import type { Transaction } from '~/utils/types'
import { isLocalCurrencyTx } from '~/utils/localCurrency'

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

// 로컬(KST) 기준 월 — toISOString()은 UTC라 매월 1일 새벽(00~09시)에 전달로 계산된다
const currentYm = (): string => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

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

// ── 사용내역 소스 ──
// 대시보드의 "현재 화면 필터"(기간·카테고리·결제수단·검색)와는 독립적으로 거래 전체를 본다.
// 카드 페이지는 자체 기간 선택기를 가지므로 filtered를 쓰면 대시보드 필터에 실적이 끌려다닌다.
// 대신 filtered와 **같은 판정**(지출 제외 플래그 · 흐름 유형)을 그대로 쓴다.

/** 활성 멤버 + 비활성(숨김) 카테고리가 아닌 거래 — 모든 화면 공통 전제 */
const baseTxs = computed<Transaction[]>(() => {
  const fam = useFamily()
  const hidden = new Set(useTaxonomies().categories.value.filter((c) => c.hidden).map((c) => c.name))
  return dashboardTxs.value.filter((t) => fam.isMemberActive(t.memberId) && !hidden.has(t.category))
})

export type UsageStatus = { counted: true } | { counted: false; reason: string }

/** 실적(사용금액)에 잡히는 거래인지. 안 잡히면 사유를 함께 돌려준다. */
function usageStatus(t: Transaction): UsageStatus {
  // 지역화폐로 결제한 건은 카드 실적이 아니다 — 카드 거래 원본은 남기되 카드 사용금액에서는 뺀다
  if (isLocalCurrencyTx(t)) return { counted: false, reason: '지역화폐' }
  if (isExcluded(t)) return { counted: false, reason: t.refund || t.refundPair ? '환불' : '지출 제외' }
  const kind = flowKind(t)
  if (kind === null) return { counted: false, reason: '이체/중복' }
  if (kind !== '지출') return { counted: false, reason: kind }
  return { counted: true }
}

const ymOf = (t: Transaction): string => t.monthLabel

/** 현재 기간(period)에 해당하는 거래 부분집합 */
const periodTxs = computed<Transaction[]>(() => {
  if (period.value === 'all') return baseTxs.value
  const ym = period.value === 'current' ? currentYm() : period.value
  return baseTxs.value.filter((t) => ymOf(t) === ym)
})

/** 카드 한 장의 효과적 사용금액 = 연결된 paymentMethod의 **실적 인정** 거래 합계 (없으면 수동값) */
function effectiveSpendingFor(card: CardItem): number {
  const linked = card.linkedPaymentMethods ?? []
  if (linked.length === 0) return card.monthlySpending || 0
  const set = new Set(linked)
  let sum = 0
  for (const t of periodTxs.value) {
    if (set.has(t.paymentMethod) && usageStatus(t).counted) sum += Number(t.amount) || 0
  }
  return sum
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

// ── 사용내역 (대시보드 거래 동기화) ──

export interface UsageRow {
  tx: Transaction
  counted: boolean
  reason: string
}
export interface UsageSummary {
  rows: UsageRow[]                 // 기간 내 전체 거래 (최신순, 제외 항목 포함)
  countedTotal: number
  countedCount: number
  excludedTotal: number
  excludedCount: number
  lastUsedAt: Date | null
  byCategory: { name: string; amount: number; ratio: number }[]
  byMonth: { ym: string; amount: number }[]   // 최근 6개월 (기간 선택과 무관)
}

const toDate = (v: unknown): Date => (v instanceof Date ? v : new Date(v as string))

function usageOf(card: CardItem): UsageSummary {
  const linked = new Set(card.linkedPaymentMethods ?? [])
  const mine = (t: Transaction) => linked.has(t.paymentMethod)

  const rows: UsageRow[] = periodTxs.value
    .filter(mine)
    .map((tx) => {
      const st = usageStatus(tx)
      return { tx, counted: st.counted, reason: st.counted ? '' : st.reason }
    })
    .sort((a, b) => toDate(b.tx.date).getTime() - toDate(a.tx.date).getTime())

  let countedTotal = 0, countedCount = 0, excludedTotal = 0, excludedCount = 0
  const cat = new Map<string, number>()
  for (const r of rows) {
    const amt = Number(r.tx.amount) || 0
    if (r.counted) {
      countedTotal += amt; countedCount++
      cat.set(r.tx.category, (cat.get(r.tx.category) ?? 0) + amt)
    } else { excludedTotal += amt; excludedCount++ }
  }
  const byCategory = Array.from(cat, ([name, amount]) => ({ name, amount, ratio: countedTotal > 0 ? amount / countedTotal : 0 }))
    .sort((a, b) => b.amount - a.amount)

  // 최근 6개월 추이 — 전체 거래 기준(기간 선택과 무관), 실적 인정분만
  const mo = new Map<string, number>()
  for (const t of baseTxs.value) {
    if (!mine(t) || !usageStatus(t).counted) continue
    mo.set(ymOf(t), (mo.get(ymOf(t)) ?? 0) + (Number(t.amount) || 0))
  }
  const byMonth: { ym: string; amount: number }[] = []
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    byMonth.push({ ym, amount: mo.get(ym) ?? 0 })
  }

  return {
    rows, countedTotal, countedCount, excludedTotal, excludedCount,
    lastUsedAt: rows.length ? toDate(rows[0].tx.date) : null,
    byCategory, byMonth
  }
}

/** 이 결제수단을 이미 쓰고 있는 카드 (한 결제수단이 두 카드에 연결되면 실적이 이중 집계된다) */
function ownerOf(pm: string): CardItem | undefined {
  return state.value.cards.find((c) => (c.linkedPaymentMethods ?? []).includes(pm))
}

/** 어떤 카드에도 연결되지 않은 대시보드 결제수단 */
const unlinkedPaymentMethods = computed<string[]>(() =>
  availablePaymentMethods.value.filter((pm) => !ownerOf(pm))
)

/** 연결해 둔 결제수단이 대시보드에서 사라진 경우 (이름 변경·삭제) — 실적이 조용히 0이 되는 걸 막는다 */
function brokenLinksOf(card: CardItem): string[] {
  const live = new Set(availablePaymentMethods.value)
  return (card.linkedPaymentMethods ?? []).filter((pm) => !live.has(pm))
}

/** 카드사/카드명과 이름이 겹치는, 아직 주인 없는 결제수단 추천 */
function suggestLinksFor(card: CardItem): string[] {
  const keys = [card.issuer, card.name]
    .map((x) => (x || '').replace(/카드|체크|뱅크/g, '').trim())
    .filter((x) => x.length >= 2)
  if (keys.length === 0) return []
  return unlinkedPaymentMethods.value.filter((pm) => keys.some((k) => pm.includes(k) || k.includes(pm.replace(/카드|체크/g, ''))))
}

function linkPayment(cardId: string, pm: string): boolean {
  const card = state.value.cards.find((c) => c.id === cardId)
  if (!card || ownerOf(pm)) return false
  return updateCard(cardId, { linkedPaymentMethods: [...(card.linkedPaymentMethods ?? []), pm] })
}

// ── 액션 ──

function addCard(input: Omit<CardItem, 'id'>): CardItem {
  const fam = useFamily()
  const card: CardItem = {
    ...input,
    id: createId('cd_'),
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
      id: createId('cd_'),
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
    usageOf,
    ownerOf,
    unlinkedPaymentMethods,
    brokenLinksOf,
    suggestLinksFor,
    linkPayment,
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
