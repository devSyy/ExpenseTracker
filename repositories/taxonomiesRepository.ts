// 카테고리·결제수단 분류 리포지토리.
import { createRepository } from './createRepository'
import {
  DEFAULT_CATEGORIES,
  DEFAULT_FIXED_CATEGORIES,
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_PAYMENT_METHODS,
  DEFAULT_TX_TYPE,
  REFUND_CATEGORY,
  type CategoryDef,
  type PaymentDef,
  type TxType
} from '~/utils/types'

const KEY_CAT = 'expense:categories:v1'
const KEY_PAY = 'expense:payments:v1'

const FALLBACK_CATEGORY = '기타'
const FALLBACK_PAYMENT = '기타결제'

/** 저장된 값이 무엇이든 유효한 TxType으로 정규화. 미지정 → '지출'(기존 동작 유지) */
export function normalizeTxType(raw: unknown): TxType {
  return raw === '수입' ? '수입' : DEFAULT_TX_TYPE
}

function defaultCategoryDefs(): CategoryDef[] {
  const fixed = new Set(DEFAULT_FIXED_CATEGORIES as readonly string[])
  const expense: CategoryDef[] = DEFAULT_CATEGORIES.map((name) => ({
    name, isFixed: fixed.has(name), hidden: false, type: '지출'
  }))
  // 신규 설치에만 수입 카테고리를 함께 제공한다.
  // (기존 사용자의 목록에는 migrate에서 임의로 추가하지 않는다 — 데이터 보존 우선)
  const income: CategoryDef[] = DEFAULT_INCOME_CATEGORIES.map((name) => ({
    name, isFixed: false, hidden: false, type: '수입'
  }))
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

function defaultPaymentDefs(): PaymentDef[] {
  return DEFAULT_PAYMENT_METHODS.map((name) => ({ name, hidden: false }))
}

/** 시스템이 의존하는 필수 카테고리 자동 보강. */
function ensureRequiredCategories(list: CategoryDef[]): CategoryDef[] {
  const required: CategoryDef[] = [
    { name: '입출금', isFixed: false, type: '지출' },
    // 환불: 음수 금액(결제 취소) 거래가 자동으로 배정되는 카테고리.
    // 기존 사용자에게도 자동 보강되므로 별도 마이그레이션이 필요 없다.
    { name: REFUND_CATEGORY, isFixed: false, type: '지출' },
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
      ((y as any).type === '수입' || (y as any).type === '지출')),
  migrate: (raw) => {
    if (!Array.isArray(raw)) return null
    const list: CategoryDef[] = raw
      .filter((x) => x && typeof x.name === 'string' && (x.name as string).trim())
      .map((x) => ({
        name: String(x.name).trim(),
        isFixed: Boolean(x.isFixed),
        hidden: Boolean(x.hidden),
        // 기존 카테고리는 전부 지출로 이관된다 (데이터 손실 없음)
        type: normalizeTxType(x.type)
      }))
    return ensureRequiredCategories(list)
  }
})

// 로드 직후에도 필수 카테고리 보강을 한 번 실행한다 (기존 사용자 마이그레이션).
categoriesRepo.state.value = ensureRequiredCategories(normalizeCategoryDefs(categoriesRepo.state.value))

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

export { FALLBACK_CATEGORY, FALLBACK_PAYMENT, REFUND_CATEGORY }
