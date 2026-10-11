// 카테고리·결제수단 분류 리포지토리.
import { createRepository } from './createRepository'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_EXCLUDED_CATEGORIES,
  DEFAULT_EXCLUDED_TYPES,
  DEFAULT_FIXED_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_PAYMENT_TAG,
  DEFAULT_TX_TYPE,
  PAYMENT_TAGS,
  REFUND_CATEGORY,
  TRANSFER_CATEGORY,
  type CategoryDef,
  type PaymentDef,
  type PaymentTag,
  type TxType
} from '~/utils/types'

const KEY_CAT = 'expense:categories:v1'
const KEY_PAY = 'expense:payments:v1'

const FALLBACK_CATEGORY = '기타'
const FALLBACK_PAYMENT = '기타결제'

/** 저장된 값이 무엇이든 유효한 TxType으로 정규화. 미지정 → '지출'(기존 동작 유지) */
export function normalizeTxType(raw: unknown): TxType {
  return raw === '수입' || raw === '이체' || raw === '저축' || raw === '충전' ? raw : DEFAULT_TX_TYPE
}

function defaultCategoryDefs(): CategoryDef[] {
  const fixed = new Set(DEFAULT_FIXED_CATEGORIES as readonly string[])
  const expense: CategoryDef[] = DEFAULT_CATEGORIES.map((name) => ({
    name, isFixed: fixed.has(name), hidden: false, type: '지출',
    excludeFromCalc: DEFAULT_EXCLUDED_CATEGORIES.includes(name)
  }))
  // 신규 설치에만 수입 카테고리를 함께 제공한다.
  // (기존 사용자의 목록에는 migrate에서 임의로 추가하지 않는다 — 데이터 보존 우선)
  const income: CategoryDef[] = DEFAULT_INCOME_CATEGORIES.map((name) => ({
    name, isFixed: false, hidden: false, type: '수입'
  }))
  // 필수 카테고리(환불·계좌이체)는 ensureRequiredCategories가 지출제외를 켠 채로 보강한다
  return [...expense, ...income]
}

/** 모든 항목이 유효한 type을 갖도록 채운다 (구버전 데이터 마이그레이션). */
function normalizeCategoryDefs(list: CategoryDef[]): CategoryDef[] {
  let changed = false
  const next = list.map((c) => {
    const type = normalizeTxType(c.type)
    if (c.type === type) return c
    changed = true
    return { ...c, type }
  })
  return changed ? next : list
}

/** 저장된 값이 무엇이든 유효한 PaymentTag으로 정규화. 미지정 → '소비'(기존 동작 유지) */
export function normalizePaymentTag(raw: unknown): PaymentTag {
  return raw === '저축' ? '저축' : DEFAULT_PAYMENT_TAG
}

/**
 * 태그별 카테고리 매핑 정규화.
 * - 알 수 없는 태그 키는 버린다
 * - 값이 빈 문자열이면 "매핑 없음"이므로 키 자체를 넣지 않는다
 * - 매핑이 하나도 없으면 undefined를 돌려줘 저장 데이터를 불필요하게 늘리지 않는다
 */
export function normalizeCategoryByTag(raw: unknown): Partial<Record<PaymentTag, string>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src = raw as Record<string, unknown>
  const out: Partial<Record<PaymentTag, string>> = {}
  let count = 0
  for (const tag of PAYMENT_TAGS) {
    const v = src[tag]
    if (typeof v !== 'string') continue
    const name = v.trim()
    if (!name) continue
    out[tag] = name
    count++
  }
  return count > 0 ? out : undefined
}

function defaultPaymentDefs(): PaymentDef[] {
  // 신규 설치의 기본 결제수단은 모두 '소비'이며 카테고리 매핑은 비어 있다
  // (매핑이 비어 있으면 자동 배정이 일어나지 않으므로 기존 동작과 동일하다).
  return DEFAULT_PAYMENT_METHODS.map((name) => ({ name, hidden: false, tag: DEFAULT_PAYMENT_TAG }))
}

/** 모든 결제수단이 유효한 tag/매핑을 갖도록 채운다 (구버전 데이터 마이그레이션). */
function normalizePaymentDefs(list: PaymentDef[]): PaymentDef[] {
  let changed = false
  const next = list.map((p) => {
    const tag = normalizePaymentTag(p.tag)
    const categoryByTag = normalizeCategoryByTag(p.categoryByTag)
    if (p.tag === tag && p.categoryByTag === categoryByTag) return p
    changed = true
    const out: PaymentDef = { ...p, tag }
    if (categoryByTag) out.categoryByTag = categoryByTag
    else delete out.categoryByTag
    return out
  })
  return changed ? next : list
}

/** 시스템이 의존하는 필수 카테고리 자동 보강. */
function ensureRequiredCategories(list: CategoryDef[]): CategoryDef[] {
  const required: CategoryDef[] = [
    { name: '입출금', isFixed: false, type: '지출', excludeFromCalc: true },
    // 환불: 음수 금액(결제 취소) 거래가 자동으로 배정되는 카테고리.
    // 기존 사용자에게도 자동 보강되므로 별도 마이그레이션이 필요 없다.
    // 환불·계좌이체는 신규 보강 시 지출제외가 기본으로 켜진다 (기존 사용자는 아래 v2 이관이 처리)
    { name: REFUND_CATEGORY, isFixed: false, type: '지출', excludeFromCalc: true },
    // 계좌이체: 내 통장 간 이동 — 수입/지출 집계에서 빠지는 '이체' 유형
    { name: TRANSFER_CATEGORY, isFixed: false, type: '이체', excludeFromCalc: true },
    { name: FALLBACK_CATEGORY, isFixed: false, type: '지출' }
  ]
  let next = list
  for (const r of required) {
    if (!next.some((c) => c.name === r.name)) {
      next = [...next, { ...r, hidden: false }]
    }
  }
  return next
}

export const categoriesRepo = createRepository<CategoryDef[]>({
  key: KEY_CAT,
  default: () => defaultCategoryDefs(),
  // type이 없는 구버전 데이터는 검증에 실패시켜 migrate를 거치게 한다.
  validator: (x): x is CategoryDef[] =>
    Array.isArray(x) &&
    x.every((y) => y && typeof (y as any).name === 'string' &&
      ((y as any).type === '수입' || (y as any).type === '지출' || (y as any).type === '이체' || (y as any).type === '저축' || (y as any).type === '충전')),
  migrate: (raw) => {
    if (!Array.isArray(raw)) return null
    const list: CategoryDef[] = raw
      .filter((x) => x && typeof x.name === 'string' && (x.name as string).trim())
      .map((x) => ({
        name: String(x.name).trim(),
        isFixed: Boolean(x.isFixed),
        hidden: Boolean(x.hidden),
        excludeFromCalc: Boolean(x.excludeFromCalc),
        // 기존 카테고리는 전부 지출로 이관된다 (데이터 손실 없음)
        type: normalizeTxType(x.type)
      }))
    return ensureRequiredCategories(list)
  }
})

// 로드 직후에도 필수 카테고리 보강을 한 번 실행한다 (기존 사용자 마이그레이션).
categoriesRepo.state.value = ensureRequiredCategories(normalizeCategoryDefs(categoriesRepo.state.value))

// 기존 사용자 1회 이관: 입출금/카드대금/내계좌이체가 이미 있으면 지출제외를 켠다.
// 마커로 한 번만 실행하므로 이후 사용자가 직접 끈 설정은 유지된다.
const KEY_EXCL_MIGR = 'expense:migr:default-excluded:v1'
function applyDefaultExcludedOnce() {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(KEY_EXCL_MIGR)) return
    let changed = false
    const next = categoriesRepo.state.value.map((c) => {
      if (!DEFAULT_EXCLUDED_CATEGORIES.includes(c.name)) return c
      if (normalizeTxType(c.type) !== '지출' || c.excludeFromCalc) return c
      changed = true
      return { ...c, excludeFromCalc: true }
    })
    if (changed) categoriesRepo.state.value = next
    window.localStorage.setItem(KEY_EXCL_MIGR, '1')
  } catch { /* 저장소 접근 불가 시 무시 */ }
}
applyDefaultExcludedOnce()

// v2 이관: 이체 유형 카테고리와 환불 카테고리도 기본 지출제외를 켠다 (v1 이후 추가된 기본값).
// 마커로 한 번만 실행하므로 이후 사용자가 직접 끈 설정은 유지된다.
const KEY_EXCL_MIGR_V2 = 'expense:migr:default-excluded:v2'
function applyDefaultExcludedV2Once() {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(KEY_EXCL_MIGR_V2)) return
    let changed = false
    const next = categoriesRepo.state.value.map((c) => {
      const type = normalizeTxType(c.type)
      const target = DEFAULT_EXCLUDED_CATEGORIES.includes(c.name) || DEFAULT_EXCLUDED_TYPES.includes(type)
      if (!target || type === '충전' || c.excludeFromCalc) return c
      changed = true
      return { ...c, excludeFromCalc: true }
    })
    if (changed) categoriesRepo.state.value = next
    window.localStorage.setItem(KEY_EXCL_MIGR_V2, '1')
  } catch { /* 저장소 접근 불가 시 무시 */ }
}
applyDefaultExcludedV2Once()

export const paymentsRepo = createRepository<PaymentDef[]>({
  key: KEY_PAY,
  default: () => defaultPaymentDefs(),
  validator: (x): x is PaymentDef[] =>
    Array.isArray(x) && x.every((y) => y && typeof (y as any).name === 'string'),
  migrate: (raw) => {
    // 구버전: string[]도 허용
    if (!Array.isArray(raw)) return null
    return raw
      .map((x) => {
        if (typeof x === 'string') return { name: x.trim(), hidden: false, tag: DEFAULT_PAYMENT_TAG }
        if (x && typeof (x as any).name === 'string') {
          // 태그/매핑이 없는 구버전 항목은 '소비' + 매핑 없음으로 이관된다 (데이터 손실 없음)
          const def: PaymentDef = {
            name: String((x as any).name).trim(),
            hidden: Boolean((x as any).hidden),
            tag: normalizePaymentTag((x as any).tag)
          }
          const map = normalizeCategoryByTag((x as any).categoryByTag)
          if (map) def.categoryByTag = map
          return def
        }
        return null
      })
      .filter((x): x is PaymentDef => Boolean(x && x.name))
  }
})

// 로드 직후 태그/매핑 정규화를 한 번 실행한다 (기존 사용자 마이그레이션).
paymentsRepo.state.value = normalizePaymentDefs(paymentsRepo.state.value)

export { FALLBACK_CATEGORY, FALLBACK_PAYMENT, REFUND_CATEGORY }
