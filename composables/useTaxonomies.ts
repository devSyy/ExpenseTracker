// 카테고리·결제수단 컴포저블 — Repository 위에 액션 API를 얹은 얇은 레이어.
// 영속화/검증/마이그레이션은 모두 repositories/taxonomiesRepository에서 처리한다.
import { computed } from 'vue'
import {
  categoriesRepo,
  paymentsRepo,
  FALLBACK_CATEGORY,
  FALLBACK_PAYMENT
} from '~/repositories/taxonomiesRepository'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_FIXED_CATEGORIES,
  DEFAULT_PAYMENT_METHODS,
  type CategoryDef,
  type PaymentDef
} from '~/utils/types'

const categories = categoriesRepo.state
const payments = paymentsRepo.state

const categoryNames = computed<string[]>(() => categories.value.map((c) => c.name))
const visibleCategoryNames = computed<string[]>(() =>
  categories.value.filter((c) => !c.hidden).map((c) => c.name)
)
const fixedCategoryNames = computed<string[]>(() =>
  categories.value.filter((c) => c.isFixed).map((c) => c.name)
)
const paymentNames = computed<string[]>(() => payments.value.map((p) => p.name))
const visiblePaymentNames = computed<string[]>(() =>
  payments.value.filter((p) => !p.hidden).map((p) => p.name)
)

function findCategory(name: string): CategoryDef | undefined {
  return categories.value.find((c) => c.name === name)
}
function findPayment(name: string): PaymentDef | undefined {
  return payments.value.find((p) => p.name === name)
}
function isFixedCategory(name: string): boolean { return Boolean(findCategory(name)?.isFixed) }
function isCategoryHidden(name: string): boolean { return Boolean(findCategory(name)?.hidden) }
function isPaymentHidden(name: string): boolean { return Boolean(findPayment(name)?.hidden) }

// ── 카테고리 액션 ──
function addCategory(name: string, isFixed = false): { ok: boolean; reason?: string } {
  const v = name.trim()
  if (!v) return { ok: false, reason: '이름을 입력하세요' }
  if (categories.value.some((c) => c.name === v)) return { ok: false, reason: '이미 존재하는 카테고리' }
  categories.value = [...categories.value, { name: v, isFixed, hidden: false }]
  return { ok: true }
}
function renameCategory(oldName: string, newName: string): { ok: boolean; reason?: string } {
  const v = newName.trim()
  if (!v) return { ok: false, reason: '이름을 입력하세요' }
  if (oldName === v) return { ok: true }
  if (categories.value.some((c) => c.name === v)) return { ok: false, reason: '이미 존재하는 이름' }
  const idx = categories.value.findIndex((c) => c.name === oldName)
  if (idx === -1) return { ok: false, reason: '대상 카테고리 없음' }
  const next = [...categories.value]
  next[idx] = { ...next[idx], name: v }
  categories.value = next
  return { ok: true }
}
function setCategoryFixed(name: string, isFixed: boolean) {
  const idx = categories.value.findIndex((c) => c.name === name)
  if (idx === -1) return
  const next = [...categories.value]
  next[idx] = { ...next[idx], isFixed }
  categories.value = next
}
function setCategoryHidden(name: string, hidden: boolean) {
  const idx = categories.value.findIndex((c) => c.name === name)
  if (idx === -1) return
  const next = [...categories.value]
  next[idx] = { ...next[idx], hidden }
  categories.value = next
}
function removeCategory(name: string): { ok: boolean; reason?: string } {
  if (name === FALLBACK_CATEGORY) return { ok: false, reason: '폴백 카테고리는 삭제할 수 없습니다' }
  const next = categories.value.filter((c) => c.name !== name)
  if (next.length === categories.value.length) return { ok: false, reason: '대상 카테고리 없음' }
  categories.value = next
  return { ok: true }
}
function moveCategory(name: string, direction: -1 | 1) {
  const idx = categories.value.findIndex((c) => c.name === name)
  if (idx === -1) return
  const target = idx + direction
  if (target < 0 || target >= categories.value.length) return
  const next = [...categories.value]
  ;[next[idx], next[target]] = [next[target], next[idx]]
  categories.value = next
}
function reorderCategories(orderedNames: string[]) {
  const map = new Map(categories.value.map((c) => [c.name, c]))
  const next: CategoryDef[] = []
  for (const n of orderedNames) {
    const c = map.get(n)
    if (c) { next.push(c); map.delete(n) }
  }
  for (const c of map.values()) next.push(c)
  categories.value = next
}

// ── 결제수단 액션 ──
function addPayment(name: string): { ok: boolean; reason?: string } {
  const v = name.trim()
  if (!v) return { ok: false, reason: '이름을 입력하세요' }
  if (payments.value.some((p) => p.name === v)) return { ok: false, reason: '이미 존재하는 결제수단' }
  payments.value = [...payments.value, { name: v, hidden: false }]
  return { ok: true }
}
function renamePayment(oldName: string, newName: string): { ok: boolean; reason?: string } {
  const v = newName.trim()
  if (!v) return { ok: false, reason: '이름을 입력하세요' }
  if (oldName === v) return { ok: true }
  if (payments.value.some((p) => p.name === v)) return { ok: false, reason: '이미 존재하는 이름' }
  const idx = payments.value.findIndex((p) => p.name === oldName)
  if (idx === -1) return { ok: false, reason: '대상 결제수단 없음' }
  const next = [...payments.value]
  next[idx] = { ...next[idx], name: v }
  payments.value = next
  return { ok: true }
}
function setPaymentHidden(name: string, hidden: boolean) {
  const idx = payments.value.findIndex((p) => p.name === name)
  if (idx === -1) return
  const next = [...payments.value]
  next[idx] = { ...next[idx], hidden }
  payments.value = next
}
function removePayment(name: string): { ok: boolean; reason?: string } {
  if (name === FALLBACK_PAYMENT) return { ok: false, reason: '폴백 결제수단은 삭제할 수 없습니다' }
  const next = payments.value.filter((p) => p.name !== name)
  if (next.length === payments.value.length) return { ok: false, reason: '대상 결제수단 없음' }
  payments.value = next
  return { ok: true }
}
function movePayment(name: string, direction: -1 | 1) {
  const idx = payments.value.findIndex((p) => p.name === name)
  if (idx === -1) return
  const target = idx + direction
  if (target < 0 || target >= payments.value.length) return
  const next = [...payments.value]
  ;[next[idx], next[target]] = [next[target], next[idx]]
  payments.value = next
}
function reorderPayments(orderedNames: string[]) {
  const map = new Map(payments.value.map((p) => [p.name, p]))
  const next: PaymentDef[] = []
  for (const n of orderedNames) {
    const p = map.get(n)
    if (p) { next.push(p); map.delete(n) }
  }
  for (const p of map.values()) next.push(p)
  payments.value = next
}

function resetToDefaults() {
  const fixed = new Set(DEFAULT_FIXED_CATEGORIES as readonly string[])
  categories.value = DEFAULT_CATEGORIES.map((name) => ({ name, isFixed: fixed.has(name), hidden: false }))
  payments.value = DEFAULT_PAYMENT_METHODS.map((name) => ({ name, hidden: false }))
}

export function useTaxonomies() {
  return {
    categories,
    payments,
    categoryNames,
    visibleCategoryNames,
    fixedCategoryNames,
    paymentNames,
    visiblePaymentNames,
    findCategory,
    findPayment,
    isFixedCategory,
    isCategoryHidden,
    isPaymentHidden,
    addCategory,
    renameCategory,
    setCategoryFixed,
    setCategoryHidden,
    removeCategory,
    moveCategory,
    reorderCategories,
    addPayment,
    renamePayment,
    setPaymentHidden,
    removePayment,
    movePayment,
    reorderPayments,
    resetToDefaults,
    FALLBACK_CATEGORY,
    FALLBACK_PAYMENT
  }
}
