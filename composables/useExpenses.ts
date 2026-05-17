// 대시보드 거래 컴포저블 — 영속화는 transactionsRepo에 위임.
// 비영속 상태(필터, 경고, 검출 컬럼 등)만 이 모듈에서 관리한다.
import { computed, reactive, ref } from 'vue'
import { classifyCategory, deriveFields } from '~/utils/classify'
import {
  transactionsRepo,
  transactionsMetaRepo,
  saveTransactions as repoSaveTransactions,
  clearTransactions as repoClearTransactions
} from '~/repositories/transactionsRepository'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { useFamily } from '~/composables/useFamily'
import type {
  Category,
  CostType,
  ParseResult,
  PaymentMethod,
  Transaction
} from '~/utils/types'

interface Filters {
  year: 'all' | number
  month: 'all' | number          // 1..12
  category: 'all' | Category
  payment: 'all' | PaymentMethod
  costType: 'all' | CostType
  search: string
}

// 영속 상태
const transactions = transactionsRepo.state

// 비영속 상태
const warnings = ref<string[]>([])
const detectedColumns = ref<Record<string, string>>({})
const fileName = ref<string>(transactionsMetaRepo.state.value?.fileName ?? '')
const loadedAt = ref<Date | null>(transactions.value.length > 0 ? new Date() : null)
const lastSavedAt = ref<Date | null>(
  transactionsMetaRepo.state.value?.savedAt ? new Date(transactionsMetaRepo.state.value.savedAt) : null
)

const filters = reactive<Filters>({
  year: 'all',
  month: 'all',
  category: 'all',
  payment: 'all',
  costType: 'all',
  search: ''
})

const filtered = computed<Transaction[]>(() => {
  // 비활성화(숨김) 카테고리 거래는 모든 화면에서 제외
  const tax = useTaxonomies()
  const fam = useFamily()
  const hiddenCats = new Set(tax.categories.value.filter((c) => c.hidden).map((c) => c.name))
  const q = filters.search.trim().toLowerCase()
  return transactions.value.filter((t) => {
    // 활성 멤버 필터 (memberId 없으면 primary 소속으로 간주 — 레거시 호환)
    if (!fam.isMemberActive(t.memberId)) return false
    if (hiddenCats.has(t.category)) return false
    if (filters.year !== 'all' && t.year !== filters.year) return false
    if (filters.month !== 'all' && t.month !== filters.month) return false
    if (filters.category !== 'all' && t.category !== filters.category) return false
    if (filters.payment !== 'all' && t.paymentMethod !== filters.payment) return false
    if (filters.costType !== 'all' && t.costType !== filters.costType) return false
    if (q && !(`${t.description} ${t.category} ${t.paymentMethod}`.toLowerCase().includes(q))) return false
    return true
  })
})

const availableYears = computed<number[]>(() => {
  const s = new Set<number>()
  transactions.value.forEach((t) => s.add(t.year))
  return Array.from(s).sort()
})

/** 선택된 연도(또는 전체)에서 데이터가 있는 월(1..12) 목록 */
const availableMonths = computed<number[]>(() => {
  const s = new Set<number>()
  for (const t of transactions.value) {
    if (filters.year !== 'all' && t.year !== filters.year) continue
    s.add(t.month)
  }
  return Array.from(s).sort((a, b) => a - b)
})

function setParseResult(r: ParseResult, name: string) {
  // 신규로 파싱된 거래는 모두 현재 primary 멤버로 태깅
  const fam = useFamily()
  const primaryId = fam.primaryMemberId.value ?? undefined
  transactions.value = r.transactions.map((t) => ({ ...t, memberId: t.memberId ?? primaryId }))
  warnings.value = r.warnings
  detectedColumns.value = r.detectedColumns
  fileName.value = name
  loadedAt.value = new Date()
  filters.year = 'all'
  filters.month = 'all'
  filters.category = 'all'
  filters.payment = 'all'
  filters.costType = 'all'
  filters.search = ''
  registerDiscoveredTaxonomies(r.transactions)
}

function registerDiscoveredTaxonomies(txs: Transaction[]) {
  const tax = useTaxonomies()
  const cats = new Set<string>()
  const pays = new Set<string>()
  for (const t of txs) {
    if (t.category) cats.add(t.category)
    if (t.paymentMethod) pays.add(t.paymentMethod)
  }
  for (const c of cats) tax.addCategory(c)
  for (const p of pays) tax.addPayment(p)
}

function reset() {
  transactionsRepo.reset()
  warnings.value = []
  detectedColumns.value = {}
  fileName.value = ''
  loadedAt.value = null
}

// ── 거래 단위 편집 ──
type EditablePatch = Partial<Pick<Transaction, 'category' | 'paymentMethod' | 'costType'>>

function updateTransaction(id: string, patch: EditablePatch): boolean {
  const idx = transactions.value.findIndex((t) => t.id === id)
  if (idx === -1) return false
  const next = transactions.value.slice()
  next[idx] = { ...next[idx], ...patch }
  transactions.value = next
  return true
}

function updateByDescription(description: string, patch: EditablePatch): number {
  if (!description) return 0
  let count = 0
  const next = transactions.value.map((t) => {
    if (t.description === description) { count++; return { ...t, ...patch } }
    return t
  })
  if (count > 0) transactions.value = next
  return count
}

function remapCategory(from: Category, to: Category): number {
  if (from === to) return 0
  let count = 0
  const next = transactions.value.map((t) => {
    if (t.category === from) { count++; return { ...t, category: to } }
    return t
  })
  if (count > 0) transactions.value = next
  return count
}

function remapPayment(from: PaymentMethod, to: PaymentMethod): number {
  if (from === to) return 0
  let count = 0
  const next = transactions.value.map((t) => {
    if (t.paymentMethod === from) { count++; return { ...t, paymentMethod: to } }
    return t
  })
  if (count > 0) transactions.value = next
  return count
}

function reapplyDescriptionRules(): number {
  let changed = 0
  const next = transactions.value.map((t) => {
    const newCat = classifyCategory(t.category, t.description)
    if (newCat !== t.category) { changed++; return { ...t, category: newCat } }
    return t
  })
  if (changed > 0) transactions.value = next
  return changed
}

function countByCategory(name: Category): number {
  return transactions.value.reduce((n, t) => n + (t.category === name ? 1 : 0), 0)
}
function countByPayment(name: PaymentMethod): number {
  return transactions.value.reduce((n, t) => n + (t.paymentMethod === name ? 1 : 0), 0)
}

// ── 수기 추가 ──
export interface NewTransactionInput {
  date: Date | string
  description: string
  amount: number
  category?: Category
  paymentMethod?: PaymentMethod
  costType?: CostType
  note?: string
}

function addTransaction(input: NewTransactionInput): Transaction | null {
  const d = input.date instanceof Date ? input.date : new Date(input.date)
  if (isNaN(d.getTime())) return null
  const amt = Number(input.amount)
  if (!Number.isFinite(amt) || amt <= 0) return null

  const description = (input.description ?? '').trim() || '(내용 없음)'
  const category = (input.category ?? '기타').trim() || '기타'
  const paymentMethod = (input.paymentMethod ?? '기타결제').trim() || '기타결제'
  const costType: CostType = input.costType === '고정비' ? '고정비' : '변동비'

  const id = `manual-${d.getTime()}-${Math.random().toString(36).slice(2, 8)}`
  const fam = useFamily()
  const tx: Transaction = {
    id, date: d, description, amount: Math.abs(amt),
    category: classifyCategory(category, description),
    paymentMethod, costType,
    note: input.note?.trim() || undefined,
    memberId: fam.primaryMemberId.value ?? undefined,
    ...deriveFields(d)
  }
  transactions.value = [...transactions.value, tx]
  return tx
}

// ── 영속화 ──
function saveToStorage(): { ok: boolean; count: number; reason?: string } {
  const r = repoSaveTransactions(transactions.value, fileName.value)
  if (r.ok) lastSavedAt.value = new Date()
  return r
}

function loadFromStorage(): { ok: boolean; count: number } {
  const before = transactions.value.length
  transactionsRepo.load()
  const meta = transactionsMetaRepo.state.value
  fileName.value = meta?.fileName ?? ''
  if (meta?.savedAt) lastSavedAt.value = new Date(meta.savedAt)
  loadedAt.value = transactions.value.length > 0 ? new Date() : null
  if (transactions.value.length > 0) registerDiscoveredTaxonomies(transactions.value)
  return { ok: true, count: transactions.value.length - before }
}

function clearStorage(): void {
  repoClearTransactions()
  fileName.value = ''
  lastSavedAt.value = null
  loadedAt.value = null
}

// 모듈 초기화 시 한 번 더 분류 자동 등록 (auto-load는 이미 repo 생성 시 수행됨)
if (transactions.value.length > 0) registerDiscoveredTaxonomies(transactions.value)

export function useExpenses() {
  return {
    transactions,
    filtered,
    warnings,
    detectedColumns,
    fileName,
    loadedAt,
    lastSavedAt,
    filters,
    availableYears,
    availableMonths,
    setParseResult,
    reset,
    updateTransaction,
    updateByDescription,
    remapCategory,
    remapPayment,
    reapplyDescriptionRules,
    countByCategory,
    countByPayment,
    addTransaction,
    saveToStorage,
    loadFromStorage,
    clearStorage
  }
}
