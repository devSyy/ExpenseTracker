// 카테고리·결제수단 분류 리포지토리.
import { createRepository } from './createRepository'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_FIXED_CATEGORIES,
  DEFAULT_PAYMENT_METHODS,
  type CategoryDef,
  type PaymentDef
} from '~/utils/types'

const KEY_CAT = 'expense:categories:v1'
const KEY_PAY = 'expense:payments:v1'

const FALLBACK_CATEGORY = '기타'
const FALLBACK_PAYMENT = '기타결제'

function defaultCategoryDefs(): CategoryDef[] {
  const fixed = new Set(DEFAULT_FIXED_CATEGORIES as readonly string[])
  return DEFAULT_CATEGORIES.map((name) => ({ name, isFixed: fixed.has(name), hidden: false }))
}

function defaultPaymentDefs(): PaymentDef[] {
  return DEFAULT_PAYMENT_METHODS.map((name) => ({ name, hidden: false }))
}

/** 시스템이 의존하는 필수 카테고리 자동 보강. */
function ensureRequiredCategories(list: CategoryDef[]): CategoryDef[] {
  const required = [
    { name: '입출금', isFixed: false },
    { name: FALLBACK_CATEGORY, isFixed: false }
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
  validator: (x): x is CategoryDef[] =>
    Array.isArray(x) && x.every((y) => y && typeof (y as any).name === 'string'),
  migrate: (raw) => {
    if (!Array.isArray(raw)) return null
    const list = raw
      .filter((x) => x && typeof x.name === 'string' && (x.name as string).trim())
      .map((x) => ({
        name: String(x.name).trim(),
        isFixed: Boolean(x.isFixed),
        hidden: Boolean(x.hidden)
      }))
    return ensureRequiredCategories(list)
  }
})

// 로드 직후에도 필수 카테고리 보강을 한 번 실행한다 (기존 사용자 마이그레이션).
categoriesRepo.state.value = ensureRequiredCategories(categoriesRepo.state.value)

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
        if (typeof x === 'string') return { name: x.trim(), hidden: false }
        if (x && typeof (x as any).name === 'string') {
          return { name: String((x as any).name).trim(), hidden: Boolean((x as any).hidden) }
        }
        return null
      })
      .filter((x): x is PaymentDef => Boolean(x && x.name))
  }
})

export { FALLBACK_CATEGORY, FALLBACK_PAYMENT }
