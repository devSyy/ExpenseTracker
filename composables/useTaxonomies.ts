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
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_PAYMENT_TAG,
  DEFAULT_TX_TYPE,
  PAYMENT_TAGS,
  type CategoryDef,
  type PaymentDef,
  type PaymentTag,
  type TxType
} from '~/utils/types'

const categories = categoriesRepo.state
const payments = paymentsRepo.state

// ── 수입/지출 유형 ──
//
// 카테고리의 type이 거래 유형의 **단일 진실의 원천**이다.
// 수입/지출 계산은 모두 categoryType()을 거쳐 판단하므로, 여기만 바꾸면 전체가 따라간다.
// 등록되지 않은 이름은 '지출'로 간주한다(기존 동작 유지 — 업로드 중 새로 등장한 카테고리 등).

/** CategoryDef → TxType (미지정 시 기본값) */
function defType(c: CategoryDef | undefined): TxType {
  if (!c) return DEFAULT_TX_TYPE
  return c.type === '수입' ? '수입' : DEFAULT_TX_TYPE
}

const categoryNames = computed<string[]>(() => categories.value.map((c) => c.name))
const visibleCategoryNames = computed<string[]>(() =>
  categories.value.filter((c) => !c.hidden).map((c) => c.name)
)
const fixedCategoryNames = computed<string[]>(() =>
  categories.value.filter((c) => c.isFixed).map((c) => c.name)
)
const incomeCategories = computed<CategoryDef[]>(() =>
  categories.value.filter((c) => defType(c) === '수입')
)
const expenseCategories = computed<CategoryDef[]>(() =>
  categories.value.filter((c) => defType(c) === '지출')
)
const incomeCategoryNames = computed<string[]>(() => incomeCategories.value.map((c) => c.name))
const expenseCategoryNames = computed<string[]>(() => expenseCategories.value.map((c) => c.name))
const visibleIncomeCategoryNames = computed<string[]>(() =>
  incomeCategories.value.filter((c) => !c.hidden).map((c) => c.name)
)
const visibleExpenseCategoryNames = computed<string[]>(() =>
  expenseCategories.value.filter((c) => !c.hidden).map((c) => c.name)
)

const paymentNames = computed<string[]>(() => payments.value.map((p) => p.name))
const visiblePaymentNames = computed<string[]>(() =>
  payments.value.filter((p) => !p.hidden).map((p) => p.name)
)
/** 소비 태그 결제수단 이름 */
const consumptionPaymentNames = computed<string[]>(() =>
  payments.value.filter((p) => (p.tag ?? DEFAULT_PAYMENT_TAG) !== '저축').map((p) => p.name)
)
/** 저축 태그 결제수단 이름 */
const savingsPaymentNames = computed<string[]>(() =>
  payments.value.filter((p) => p.tag === '저축').map((p) => p.name)
)
/** 현재 태그에 카테고리 매핑이 걸려 있는 결제수단 수 (설정 화면 요약용) */
const mappedPaymentCount = computed<number>(() =>
  payments.value.reduce((n, p) => {
    const v = p.categoryByTag?.[p.tag === '저축' ? '저축' : DEFAULT_PAYMENT_TAG]
    return n + (v && v.trim() ? 1 : 0)
  }, 0)
)

function findCategory(name: string): CategoryDef | undefined {
  return categories.value.find((c) => c.name === name)
}
function findPayment(name: string): PaymentDef | undefined {
  return payments.value.find((p) => p.name === name)
}
// ── 결제수단 태그(소비/저축) + 태그별 카테고리 매핑 ──
//
// 태그는 집계 규칙을 바꾸지 않는다. 수입/지출 판정은 여전히 카테고리 유형(categoryType)이
// 단독으로 결정하며, 태그가 하는 일은 **이 결제수단에 어떤 카테고리를 매핑할지** 고르는 것뿐이다.
// 그래서 태그만 바꿔도 기존 거래의 합계·차트는 달라지지 않는다.

/** PaymentDef → PaymentTag (미지정 시 기본값 '소비') */
function defTag(p: PaymentDef | undefined): PaymentTag {
  if (!p) return DEFAULT_PAYMENT_TAG
  return p.tag === '저축' ? '저축' : DEFAULT_PAYMENT_TAG
}

function isFixedCategory(name: string): boolean { return Boolean(findCategory(name)?.isFixed) }
/** 카테고리 이름 → 수입/지출. 모든 수입·지출 계산이 이 함수를 통해 판단한다. */
function categoryType(name: string): TxType { return defType(findCategory(name)) }
function isIncomeCategory(name: string): boolean { return categoryType(name) === '수입' }
function isCategoryHidden(name: string): boolean { return Boolean(findCategory(name)?.hidden) }
function isPaymentHidden(name: string): boolean { return Boolean(findPayment(name)?.hidden) }
/** 결제수단 이름 → 소비/저축 태그 (미등록/미지정은 '소비') */
function paymentTag(name: string): PaymentTag { return defTag(findPayment(name)) }
function isSavingsPayment(name: string): boolean { return paymentTag(name) === '저축' }

// ── 카테고리 액션 ──
function addCategory(
  name: string,
  isFixed = false,
  type: TxType = DEFAULT_TX_TYPE
): { ok: boolean; reason?: string } {
  const v = name.trim()
  if (!v) return { ok: false, reason: '이름을 입력하세요' }
  if (categories.value.some((c) => c.name === v)) return { ok: false, reason: '이미 존재하는 카테고리' }
  const t: TxType = type === '수입' ? '수입' : '지출'
  // 수입 카테고리는 고정비/변동비 개념이 없으므로 항상 false
  categories.value = [...categories.value, { name: v, isFixed: t === '수입' ? false : isFixed, hidden: false, type: t }]
  return { ok: true }
}

/** 카테고리의 수입/지출 유형 변경. 해당 카테고리를 쓰는 거래는 자동으로 새 유형을 따른다. */
function setCategoryType(name: string, type: TxType) {
  const idx = categories.value.findIndex((c) => c.name === name)
  if (idx === -1) return
  const t: TxType = type === '수입' ? '수입' : '지출'
  const next = [...categories.value]
  // 수입으로 바꾸면 고정비 플래그는 의미가 없으므로 해제
  next[idx] = { ...next[idx], type: t, isFixed: t === '수입' ? false : next[idx].isFixed }
  categories.value = next
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
  // 결제수단 매핑도 새 이름을 따라가게 한다 (이름 변경으로 매핑이 끊기지 않도록)
  remapPaymentCategoryName(oldName, v)
  return { ok: true }
}
function setCategoryFixed(name: string, isFixed: boolean) {
  const idx = categories.value.findIndex((c) => c.name === name)
  if (idx === -1) return
  // 수입 카테고리에는 고정비/변동비가 적용되지 않는다
  if (defType(categories.value[idx]) === '수입') return
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
  // 사라진 카테고리를 가리키던 결제수단 매핑은 해제한다 (없는 카테고리가 배정되는 것을 막는다)
  clearPaymentCategoryMappings(name)
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
function addPayment(name: string, tag: PaymentTag = DEFAULT_PAYMENT_TAG): { ok: boolean; reason?: string } {
  const v = name.trim()
  if (!v) return { ok: false, reason: '이름을 입력하세요' }
  if (payments.value.some((p) => p.name === v)) return { ok: false, reason: '이미 존재하는 결제수단' }
  const t: PaymentTag = tag === '저축' ? '저축' : DEFAULT_PAYMENT_TAG
  // 매핑은 비워둔다 — 매핑이 없으면 자동 카테고리 배정이 일어나지 않는다(기존 동작).
  payments.value = [...payments.value, { name: v, hidden: false, tag: t }]
  return { ok: true }
}

/**
 * 결제수단의 소비/저축 태그 변경.
 *
 * 이 결제수단을 쓰는 **기존 거래는 변경되지 않는다** — 태그는 앞으로 선택될 때
 * 어떤 매핑을 적용할지만 결정하기 때문이다. (매핑 값 자체도 그대로 보존한다)
 */
function setPaymentTag(name: string, tag: PaymentTag) {
  const idx = payments.value.findIndex((p) => p.name === name)
  if (idx === -1) return
  const t: PaymentTag = tag === '저축' ? '저축' : DEFAULT_PAYMENT_TAG
  const next = [...payments.value]
  next[idx] = { ...next[idx], tag: t }
  payments.value = next
}

/** 특정 결제수단·태그에 매핑된 카테고리 (없으면 undefined) */
function paymentCategoryMap(name: string, tag: PaymentTag): string | undefined {
  const p = findPayment(name)
  if (!p) return undefined
  const v = p.categoryByTag?.[tag]
  return v && v.trim() ? v : undefined
}

/**
 * 결제수단에 **현재 적용되는** 매핑 카테고리.
 * 현재 태그에 매핑된 값을 돌려주며, 매핑이 없거나 그 카테고리가 목록에서 사라졌으면 undefined다.
 * 거래 자동 배정은 모두 이 함수 하나를 거치므로 판정 기준이 한 곳에만 존재한다.
 */
function paymentMappedCategory(name: string): string | undefined {
  const p = findPayment(name)
  if (!p) return undefined
  const mapped = paymentCategoryMap(p.name, defTag(p))
  if (!mapped) return undefined
  // 등록되어 있고 비활성화되지 않은 카테고리만 배정한다.
  // (등록되지 않은 값이 거래에 새로 생기거나, 비활성 카테고리가 배정되어 거래가
  //  화면에서 사라지는 일을 막는다. 매핑 값 자체는 보존되므로 다시 활성화하면 되살아난다)
  const def = categories.value.find((c) => c.name === mapped)
  return def && !def.hidden ? mapped : undefined
}

/**
 * 결제수단·태그에 카테고리를 매핑한다. category가 빈 값이면 매핑 해제.
 * 매핑이 하나도 남지 않으면 키 자체를 지워 저장 데이터를 깔끔하게 유지한다.
 */
function setPaymentCategoryMap(
  name: string,
  tag: PaymentTag,
  category: string | null | undefined
): { ok: boolean; reason?: string } {
  const idx = payments.value.findIndex((p) => p.name === name)
  if (idx === -1) return { ok: false, reason: '대상 결제수단 없음' }
  const v = (category ?? '').trim()
  if (v && !categories.value.some((c) => c.name === v)) {
    return { ok: false, reason: '등록되지 않은 카테고리' }
  }

  const current = payments.value[idx]
  const map: Partial<Record<PaymentTag, string>> = { ...(current.categoryByTag ?? {}) }
  if (v) map[tag] = v
  else delete map[tag]

  const next = [...payments.value]
  const def: PaymentDef = { ...current }
  if (Object.keys(map).length > 0) def.categoryByTag = map
  else delete def.categoryByTag
  next[idx] = def
  payments.value = next
  return { ok: true }
}

/** 카테고리 이름이 바뀌었을 때 매핑도 함께 따라가게 한다 (매핑이 끊기지 않도록) */
function remapPaymentCategoryName(oldName: string, newName: string): number {
  let changed = 0
  const next = payments.value.map((p) => {
    if (!p.categoryByTag) return p
    let touched = false
    const map: Partial<Record<PaymentTag, string>> = { ...p.categoryByTag }
    for (const tag of PAYMENT_TAGS) {
      if (map[tag] === oldName) { map[tag] = newName; touched = true }
    }
    if (!touched) return p
    changed++
    return { ...p, categoryByTag: map }
  })
  if (changed > 0) payments.value = next
  return changed
}

/** 카테고리가 삭제됐을 때 그 카테고리를 가리키던 매핑을 해제한다 */
function clearPaymentCategoryMappings(categoryName: string): number {
  let changed = 0
  const next = payments.value.map((p) => {
    if (!p.categoryByTag) return p
    let touched = false
    const map: Partial<Record<PaymentTag, string>> = { ...p.categoryByTag }
    for (const tag of PAYMENT_TAGS) {
      if (map[tag] === categoryName) { delete map[tag]; touched = true }
    }
    if (!touched) return p
    changed++
    const def: PaymentDef = { ...p }
    if (Object.keys(map).length > 0) def.categoryByTag = map
    else delete def.categoryByTag
    return def
  })
  if (changed > 0) payments.value = next
  return changed
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
  categories.value = [
    ...DEFAULT_CATEGORIES.map((name) => ({ name, isFixed: fixed.has(name), hidden: false, type: '지출' as TxType })),
    ...DEFAULT_INCOME_CATEGORIES.map((name) => ({ name, isFixed: false, hidden: false, type: '수입' as TxType }))
  ]
  // 초기화된 결제수단은 모두 '소비' 태그이며 카테고리 매핑은 비어 있다
  payments.value = DEFAULT_PAYMENT_METHODS.map((name) => ({
    name, hidden: false, tag: DEFAULT_PAYMENT_TAG
  }))
}

export function useTaxonomies() {
  return {
    categories,
    payments,
    categoryNames,
    visibleCategoryNames,
    fixedCategoryNames,
    incomeCategories,
    expenseCategories,
    incomeCategoryNames,
    expenseCategoryNames,
    visibleIncomeCategoryNames,
    visibleExpenseCategoryNames,
    categoryType,
    isIncomeCategory,
    setCategoryType,
    paymentNames,
    visiblePaymentNames,
    consumptionPaymentNames,
    savingsPaymentNames,
    mappedPaymentCount,
    paymentTag,
    isSavingsPayment,
    setPaymentTag,
    paymentCategoryMap,
    paymentMappedCategory,
    setPaymentCategoryMap,
    PAYMENT_TAGS,
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
