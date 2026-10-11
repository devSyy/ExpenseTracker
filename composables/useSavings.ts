// 예금/적금 컴포저블 — savingsProductsRepo / savingsHistoryRepo 위에 액션을 얹은 레이어.
// 예금/적금은 여러 개 등록할 수 있다. 상품 정보(products)는 명시 저장(autoPersist:false),
// 납입 이력(history)은 자동 저장이며 PaymentEntry.productId로 상품에 연결된다.
// 화면은 '선택된 상품'(selectedId) 하나의 정보·이력을 보여 준다.
import { createId } from '~/utils/id'
import { computed, ref } from 'vue'
import {
  savingsInfoRepo,
  savingsProductsRepo,
  savingsHistoryRepo,
  defaultSavingsInfo,
  type PaymentEntry,
  type SavingsInfo,
  type SavingsProduct
} from '~/repositories/savingsRepository'
import { useFamily } from '~/composables/useFamily'
import { flowKind, isCategoryExcluded } from '~/composables/useExpenses'
import { storage } from '~/utils/storage'
import type { Transaction } from '~/utils/types'

const products = savingsProductsRepo.state
const allHistory = savingsHistoryRepo.state
const selectedId = ref<string>('')
const SELECTED_KEY = 'savings:selected:v1'

function newProduct(base?: Partial<SavingsInfo>): SavingsProduct {
  return { ...defaultSavingsInfo(), ...base, id: createId(), createdAt: new Date().toISOString() }
}

/** 목록·탭에 보일 이름 — 별칭 > 은행+종류 > '적금 N' */
export function productLabel(p: Partial<SavingsInfo>, index = 0): string {
  const n = (p.name ?? '').trim()
  if (n) return n
  const bt = [p.bank, p.type].filter(Boolean).join(' ')
  return bt || `적금 ${index + 1}`
}

// 첫 사용 시 한 번: 구버전 단일 적금(info + 이력)을 첫 상품으로 옮기고, 항상 상품이 1개 이상 있게 한다.
let inited = false
function init() {
  if (inited) return
  inited = true
  if (products.value.length === 0) {
    const legacy = savingsInfoRepo.state.value
    const hasLegacy = Object.values(legacy).some((v) => v !== '' && v !== null) || allHistory.value.length > 0
    products.value = [newProduct(hasLegacy ? legacy : undefined)]
    savingsProductsRepo.save()
  }
  const first = products.value[0].id
  if (allHistory.value.some((h) => !h.productId)) {
    allHistory.value = allHistory.value.map((h) => (h.productId ? h : { ...h, productId: first }))
  }
  const saved = storage.has(SELECTED_KEY) ? storage.getRaw<string>(SELECTED_KEY) : null
  selectedId.value = typeof saved === 'string' && products.value.some((p) => p.id === saved) ? saved : first
}

const fallbackProduct = newProduct()
/** 선택된 상품 — v-model로 직접 편집하는 객체 (저장하기 전까지는 메모리에만 반영) */
const info = computed<SavingsProduct>(() =>
  products.value.find((p) => p.id === selectedId.value) ?? products.value[0] ?? fallbackProduct
)

/** 선택된 상품의 납입 이력 중 활성 멤버의 것만 노출 */
const history = computed<PaymentEntry[]>(() => {
  const fam = useFamily()
  return allHistory.value.filter((h) => h.productId === selectedId.value && fam.isMemberActive(h.memberId))
})

// ── 목표금액 / 달성률 ──
//
// '예금액' 입력칸은 적금에서는 **월 납입액**이다 (자동 입력도 이 값으로 매월 납입을 만든다).
// 이 값을 그대로 목표로 쓰면 한 번만 납입해도 달성률이 100%가 되므로,
//  - 적금류(자유적금·정기적금·청약저축·종류 미선택): 목표 = 월 납입액 × 납입 개월수 (가입일~만기일)
//  - 예금류(정기예금·자유예금·회전식 정기예금)·ISA: 일시 납입이라 목표 = 예금액 그대로
// 기간(가입일·만기일)이 없으면 개월수를 알 수 없으므로 월 납입액을 그대로 쓴다.
const LUMP_SUM_TYPE = /예금|ISA/i
const MS_DAY = 86_400_000

function ymdMs(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null
}

/** 가입일~만기일 개월 수 (기간이 없거나 거꾸로면 0) */
export function termMonthsOf(p: Pick<SavingsInfo, 'startDate' | 'endDate'>): number {
  const a = ymdMs(p.startDate), b = ymdMs(p.endDate)
  if (a === null || b === null || b <= a) return 0
  return Math.round((b - a) / MS_DAY / 30.4375)
}

/** 월 납입 방식(적금류)인지 */
export function isInstallmentType(type: string): boolean {
  return !LUMP_SUM_TYPE.test(type || '')
}

/** 만기까지 납입할 총 목표금액 */
export function goalAmountOf(p: SavingsInfo): number {
  const base = Number(p.targetAmount) || 0
  if (base <= 0 || !isInstallmentType(p.type)) return base
  const months = termMonthsOf(p)
  return months > 0 ? base * months : base
}

/** 상품 탭용 요약 — 상품별 누적 납입액(활성 멤버 기준) */
const productSummaries = computed(() => {
  const fam = useFamily()
  return products.value.map((p, i) => ({
    id: p.id,
    label: productLabel(p, i),
    paid: allHistory.value
      .filter((h) => h.productId === p.id && fam.isMemberActive(h.memberId))
      .reduce((sum, h) => sum + h.amount, 0),
    target: goalAmountOf(p)
  }))
})

function selectProduct(id: string) {
  if (!products.value.some((p) => p.id === id)) return
  selectedId.value = id
  storage.set(SELECTED_KEY, id)
}

/** 새 적금 추가 — 빈 상품을 만들어 선택하고 즉시 저장한다 */
function addProduct(): SavingsProduct | null {
  const p = newProduct()
  products.value = [...products.value, p]
  if (!savingsProductsRepo.save()) {
    products.value = products.value.filter((x) => x.id !== p.id)
    return null
  }
  selectProduct(p.id)
  return products.value.find((x) => x.id === p.id) ?? p
}

// ── 정보 액션 ──
function saveInfo(): boolean {
  return savingsProductsRepo.save()
}
/** 선택된 상품의 입력값만 비운다 (id·이력은 유지, 저장은 하지 않는다) */
function resetInfo() {
  Object.assign(info.value, defaultSavingsInfo())
}

/**
 * 선택된 적금 삭제 — 상품과 그 납입 이력(모든 멤버)을 지운다.
 * 마지막 하나를 지우면 빈 적금이 새로 생긴다(항상 1개 이상 유지).
 * 되돌릴 수 없으므로 즉시 저장하고, 저장에 실패하면 모두 원복한다.
 */
function deleteSavings(): { ok: boolean; removed: number } {
  const id = selectedId.value
  const prevProducts = products.value
  const prevHistory = allHistory.value
  let next = prevProducts.filter((p) => p.id !== id)
  if (next.length === 0) next = [newProduct()]
  products.value = next
  allHistory.value = prevHistory.filter((h) => h.productId !== id)
  if (!savingsProductsRepo.save()) {
    products.value = prevProducts
    allHistory.value = prevHistory
    return { ok: false, removed: 0 }
  }
  selectProduct(next[0].id)
  return { ok: true, removed: prevHistory.length - allHistory.value.length }
}

// ── 이력 액션 ──
function addPayment(input: { date: string; amount: number; note?: string }): PaymentEntry | null {
  if (!input.date) return null
  const amt = Number(input.amount)
  if (!Number.isFinite(amt) || amt <= 0) return null
  const fam = useFamily()
  // 첫 납입엔 자동으로 "첫 납입" 비고 부여 (해당 멤버 기준)
  const note = input.note?.trim() ?? (history.value.length === 0 ? '첫 납입' : '')
  const entry: PaymentEntry = {
    id: createId(),
    date: input.date,
    amount: Math.abs(amt),
    note,
    createdAt: new Date().toISOString(),
    memberId: fam.primaryMemberId.value ?? undefined,
    productId: selectedId.value
  }
  allHistory.value = [...allHistory.value, entry]
  return entry
}

function updatePayment(id: string, patch: Partial<Omit<PaymentEntry, 'id' | 'createdAt'>>): boolean {
  const idx = allHistory.value.findIndex((h) => h.id === id)
  if (idx === -1) return false
  const next = allHistory.value.slice()
  const merged = { ...next[idx], ...patch }
  if (typeof merged.amount === 'number') merged.amount = Math.abs(Number(merged.amount))
  next[idx] = merged
  allHistory.value = next
  return true
}

function removePayment(id: string): boolean {
  const before = allHistory.value.length
  allHistory.value = allHistory.value.filter((h) => h.id !== id)
  return allHistory.value.length < before
}

// ── 대시보드 동기화 ──
//
// 대시보드 거래내역 중 '정기적금' 카테고리 거래를 납입 이력으로 가져온다.
//  - 이체·환불 상계 행은 제외 (flowKind), 거래에 직접 켠 '지출 계산 제외'도 제외
//  - 금액은 절대값 (적금 납입은 출금 쪽 음수로 들어와도 납입액이다)
//  - 같은 멤버·날짜·금액은 1건으로 합친다 — 같은 납입이 출금 통장과 적금 통장 양쪽 내역에
//    두 번 찍히는 경우의 이중 계상을 막는다. 합쳐진 건수는 결과로 알려 준다.
//  - 이미 가져온 항목(sourceId 동일)은 건너뛰므로 여러 번 눌러도 안전하다. 사용자가 이력에서
//    지운 항목은 다시 동기화하면 되살아난다.
export const SAVINGS_SYNC_CATEGORY = '정기적금'

function localYmd(d: Date): string {
  const p2 = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

function syncFromDashboard(dashboardTxs: Transaction[]): { added: number; skipped: number; merged: number; candidates: number } {
  const fam = useFamily()
  const primaryId = fam.primaryMemberId.value ?? undefined
  const pid = selectedId.value
  const seen = new Set(allHistory.value.filter((h) => h.productId === pid && h.source === 'dashboard' && h.sourceId).map((h) => h.sourceId as string))
  const picked = new Map<string, PaymentEntry>()
  let candidates = 0, skipped = 0

  for (const t of dashboardTxs) {
    if ((t.category ?? '').trim() !== SAVINGS_SYNC_CATEGORY) continue
    if (!(t.date instanceof Date) || isNaN(t.date.getTime())) continue
    if (!fam.isMemberActive(t.memberId)) continue
    if (flowKind(t) === null) continue
    if (t.excluded === true && !isCategoryExcluded(t)) continue
    const amount = Math.abs(Number(t.amount) || 0)
    if (amount <= 0) continue
    candidates++

    const memberId = t.memberId ?? primaryId
    const date = localYmd(t.date)
    const sourceId = `dash::${pid}::${memberId ?? ''}::${date}|${amount}`
    if (picked.has(sourceId)) continue            // 같은 납입의 중복 내역 — 합친다
    if (seen.has(sourceId)) { skipped++; picked.set(sourceId, null as unknown as PaymentEntry); continue }
    picked.set(sourceId, {
      id: createId(), date, amount,
      note: '대시보드 동기화',
      createdAt: new Date().toISOString(),
      memberId, productId: pid, source: 'dashboard', sourceId
    })
  }

  const fresh = Array.from(picked.values()).filter(Boolean)
  if (fresh.length > 0) allHistory.value = [...allHistory.value, ...fresh]
  const unique = picked.size
  return { added: fresh.length, skipped, merged: candidates - unique, candidates }
}

// ── 납입 자동 입력 ──
//
// 가입일의 월부터 현재월까지 매월 '월 납입 계획'(예금액) 금액의 납입을 만든다.
//  - 납입일은 '납입 날짜'(payDay)이고 비어 있으면 가입일의 '일'. 말일을 넘으면 그 달 말일로 맞춘다.
//    가입일보다 이른 날짜(가입월 첫 납입일이 가입일 전)와 오늘 이후, 만기일 이후는 만들지 않는다
//    → 이번 달 납입일이 아직 안 왔으면 이번 달은 건너뛴다
//  - 이미 납입 이력이 있는 달은 건너뛴다 (수기·동기화 입력 보존, 여러 번 눌러도 중복 없음)
// 계획(plan)과 반영(commit)을 나눠, 화면에서 건수·금액을 확인받은 뒤 반영한다.
export interface AutoPaymentPlan {
  ok: boolean
  reason?: string
  entries: PaymentEntry[]
  /** 이미 납입이 있어 건너뛴 달 수 */
  skippedMonths: number
  amount: number
}

function planAutoPayments(now = new Date()): AutoPaymentPlan {
  const p = info.value
  const fail = (reason: string): AutoPaymentPlan => ({ ok: false, reason, entries: [], skippedMonths: 0, amount: 0 })
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.startDate || '')
  if (!m) return fail('가입일을 먼저 입력하세요')
  const amount = Math.abs(Number(p.targetAmount) || 0)
  if (amount <= 0) return fail('예금액(월 납입 계획)을 먼저 입력하세요')

  const pad = (n: number) => String(n).padStart(2, '0')
  const today = localYmd(now)
  const end = /^\d{4}-\d{2}-\d{2}$/.test(p.endDate || '') ? p.endDate : ''
  const limit = end && end < today ? end : today
  const pd = Number(p.payDay)
  const startDay = Number.isInteger(pd) && pd >= 1 && pd <= 31 ? pd : +m[3]
  const have = new Set(history.value.map((h) => h.date.slice(0, 7)))
  const primaryId = useFamily().primaryMemberId.value ?? undefined
  const pid = selectedId.value

  const entries: PaymentEntry[] = []
  let skippedMonths = 0
  let y = +m[1], mo = +m[2]
  for (let i = 0; i < 1200; i++) {
    const ym = `${y}-${pad(mo)}`
    const day = Math.min(startDay, new Date(y, mo, 0).getDate())
    const date = `${ym}-${pad(day)}`
    if (date > limit) break
    if (date < p.startDate) { /* 가입일 전 납입일 — 건너뜀 */ }
    else if (have.has(ym)) skippedMonths++
    else entries.push({
      id: createId(), date, amount, note: '자동 입력',
      createdAt: new Date().toISOString(), memberId: primaryId, productId: pid,
      source: 'auto', sourceId: `auto::${pid}::${ym}`
    })
    if (++mo > 12) { mo = 1; y++ }
  }
  if (entries.length === 0 && skippedMonths === 0) return fail('아직 납입일이 도래하지 않았습니다')
  return { ok: true, entries, skippedMonths, amount }
}

function commitAutoPayments(entries: PaymentEntry[]): number {
  if (entries.length === 0) return 0
  allHistory.value = [...allHistory.value, ...entries]
  return entries.length
}

// ── 파생 ──
const sortedAsc = computed<PaymentEntry[]>(() =>
  history.value.slice().sort((a, b) =>
    a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)
  )
)

const historyWithBalance = computed(() => {
  let cum = 0
  return sortedAsc.value.map((h, i) => {
    cum += h.amount
    return { ...h, no: i + 1, balance: cum }
  })
})

const totalPaid = computed(() => history.value.reduce((s, h) => s + h.amount, 0))

const targetAmount = computed(() => Number(info.value.targetAmount) || 0)

/** 만기까지 납입할 총 목표금액 (적금: 월 납입액 × 개월수) */
const goalAmount = computed(() => goalAmountOf(info.value))

const progress = computed(() =>
  goalAmount.value > 0 ? Math.min(100, (totalPaid.value / goalAmount.value) * 100) : 0
)

export function useSavings() {
  init()
  return {
    products,
    productSummaries,
    selectedId,
    selectProduct,
    addProduct,
    planAutoPayments,
    commitAutoPayments,
    info,
    history,
    sortedAsc,
    historyWithBalance,
    totalPaid,
    targetAmount,
    goalAmount,
    progress,
    saveInfo,
    resetInfo,
    deleteSavings,
    syncFromDashboard,
    addPayment,
    updatePayment,
    removePayment
  }
}

export type { SavingsInfo, SavingsProduct, PaymentEntry }
