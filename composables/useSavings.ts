// 예금/적금 컴포저블 — savingsInfoRepo / savingsHistoryRepo 위에 액션을 얹은 레이어.
// 적금 정보(info)는 명시 저장(autoPersist:false), 납입 이력(history)은 자동 저장.
import { computed } from 'vue'
import {
  savingsInfoRepo,
  savingsHistoryRepo,
  defaultSavingsInfo,
  type PaymentEntry,
  type SavingsInfo
} from '~/repositories/savingsRepository'
import { useFamily } from '~/composables/useFamily'

const info = savingsInfoRepo.state
const allHistory = savingsHistoryRepo.state

/** 활성 멤버의 납입 이력만 노출 */
const history = computed<PaymentEntry[]>(() => {
  const fam = useFamily()
  return allHistory.value.filter((h) => fam.isMemberActive(h.memberId))
})

function uid() {
  return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-6)
}

// ── 정보 액션 ──
function saveInfo(): boolean {
  return savingsInfoRepo.save()
}
function resetInfo() {
  info.value = defaultSavingsInfo()
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
    id: uid(),
    date: input.date,
    amount: Math.abs(amt),
    note,
    createdAt: new Date().toISOString(),
    memberId: fam.primaryMemberId.value ?? undefined
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

const progress = computed(() =>
  targetAmount.value > 0 ? Math.min(100, (totalPaid.value / targetAmount.value) * 100) : 0
)

export function useSavings() {
  return {
    info,
    history,
    sortedAsc,
    historyWithBalance,
    totalPaid,
    targetAmount,
    progress,
    saveInfo,
    resetInfo,
    addPayment,
    updatePayment,
    removePayment
  }
}

export type { SavingsInfo, PaymentEntry }
