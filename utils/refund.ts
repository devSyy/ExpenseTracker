// 환불(Refund) 판정 로직.
//
// 규칙 — 음수라고 무조건 환불이 아니다. 아래 두 조건을 **모두** 만족할 때만 환불이다.
//   1) 거래 유형이 지출일 것 (수입 카테고리의 음수는 환불이 아니다)
//   2) 같은 금액의 **양수 지출 거래**가 짝으로 존재할 것 (부호만 반대, 절대값 동일)
//
// 짝을 찾지 못한 음수 지출은 카테고리를 바꾸지 않는다(원래 분류 유지).
// 다만 음수 금액은 "쓴 돈"이 아니므로 지출 합계에는 넣지 않는다 —
// 이는 분류(category)와 별개인 negativeAmount 플래그로 표현한다.
//
// 짝짓기는 한 번 쓴 양수 거래를 다시 쓰지 않는 1:1 매칭이며,
// 같은 금액 후보가 여러 개면 환불일보다 앞선(또는 같은 날) 거래 중 가장 가까운 것을 고른다.
// (환불은 결제 이후에 발생하므로) 앞선 거래가 없으면 남은 후보 중 가장 가까운 날짜를 쓴다.
import { REFUND_CATEGORY } from './types'
import type { Transaction } from './types'

export interface RefundMatchResult {
  /** 환불로 분류된 건수 (짝이 맞은 음수 지출) */
  refundCount: number
  /** 음수지만 짝을 찾지 못해 환불로 분류하지 않은 건수 */
  unmatchedNegativeCount: number
}

export interface RefundMatchOptions {
  /**
   * 해당 카테고리가 "지출" 유형인지 판단한다.
   * 기본값은 모두 지출로 간주 — 등록되지 않은 카테고리의 기본 유형이 '지출'이기 때문.
   */
  isExpenseCategory?: (category: string) => boolean
}

/** 금액 비교용 키 — 소수점 오차를 피하기 위해 정수(원) 단위로 반올림 */
function amountKey(n: number): number {
  return Math.round(Math.abs(Number(n) || 0))
}

/**
 * 거래 목록에서 환불 짝을 찾아 분류한다.
 * 입력 배열은 변경하지 않고, 분류가 반영된 **새 배열**을 돌려준다.
 */
export function classifyRefunds(
  txs: Transaction[],
  opts: RefundMatchOptions = {}
): { transactions: Transaction[]; result: RefundMatchResult } {
  const isExpense = opts.isExpenseCategory ?? (() => true)

  // 타입 열이 있는 파일(지출=음수 규약)이면 그 규칙으로만 분류한다 — 아래 기존 규칙(음수=환불)은 정반대 전제라
  // 결제(음수)를 환불로 잘못 바꾸고 실제 환불금(양수 지출)을 그대로 두게 된다.
  if (txs.some((t) => t.refundDeposit)) return classifyTypedRefunds(txs, isExpense)
  // 환불금이 들어온 '입금 행' 후보 — 내용에 환불·취소 표현이 있는 양수 거래만.
  // 금액만으로 짝을 맞추면 계좌이체·급여·'입금 내역' 같은 일반 입금이 같은 금액의 결제와
  // 우연히 맞아 멀쩡한 지출이 대량으로 환불 상계 처리된다(지출 합계가 비어 보이는 원인).
  // 그래서 입금 행에는 환불 표현을 반드시 요구한다. 이런 행은 결제의 짝 후보 풀에도 넣지 않는다.
  const REFUND_WORDS = /환불|취소|반품|환급/
  const isDepositLike = (t: Transaction) =>
    !t.negativeAmount && REFUND_WORDS.test(t.description ?? '')

  // 지출 유형의 양수 거래를 금액별로 모아 둔다 (짝 후보 풀)
  const positivePool = new Map<number, number[]>()   // 금액 → 원본 인덱스 목록
  txs.forEach((t, i) => {
    if (t.negativeAmount) return
    if (!isExpense(t.category)) return
    if (isDepositLike(t)) return
    const k = amountKey(t.amount)
    if (k <= 0) return
    const list = positivePool.get(k)
    if (list) list.push(i)
    else positivePool.set(k, [i])
  })

  const consumed = new Set<number>()   // 이미 짝으로 쓴 양수 거래 인덱스
  const links = new Map<number, 'origin' | 'deposit'>()   // 환불 짝의 상대편 행 표시

  /** 같은 금액의 미사용 양수 지출 중 짝을 고른다 — 기준일 이전(또는 같은 날) 우선, 없으면 가장 가까운 날짜 */
  const pickPartner = (amount: number, date: unknown): number | null => {
    const cands = (positivePool.get(amountKey(amount)) ?? []).filter((i) => !consumed.has(i))
    if (cands.length === 0) return null
    const time = date instanceof Date ? date.getTime() : 0
    const before = cands.filter((i) => {
      const d = txs[i]!.date
      return d instanceof Date && d.getTime() <= time
    })
    const pool = before.length > 0 ? before : cands
    let pick = pool[0]!
    let bestGap = Infinity
    for (const i of pool) {
      const d = txs[i]!.date
      const gap = Math.abs((d instanceof Date ? d.getTime() : 0) - time)
      if (gap < bestGap) { bestGap = gap; pick = i }
    }
    consumed.add(pick)
    return pick
  }
  let refundCount = 0
  let unmatchedNegativeCount = 0

  const out = txs.map((t, idx) => {
    if (!t.negativeAmount) return t

    // 조건 1 — 수입 카테고리의 음수는 환불이 아니다 (분류 그대로 유지)
    if (!isExpense(t.category)) {
      unmatchedNegativeCount++
      return t
    }

    // 조건 2 — 같은 금액의 양수 지출 거래가 있어야 한다
    const pick = pickPartner(t.amount, t.date)
    if (pick === null) {
      unmatchedNegativeCount++
      return t                      // 짝 없음 → 원래 분류 유지
    }
    links.set(pick, 'origin')       // 취소된 원래 결제 행에도 환불 배지를 붙인다
    refundCount++

    // 환불로 분류 — 카테고리를 '환불'로 바꾸고 원본 카테고리는 비고에 남긴다
    const original = t.category
    const note = original && original !== REFUND_CATEGORY
      ? [t.note, `원본 카테고리: ${original}`].filter(Boolean).join(' / ')
      : t.note
    return { ...t, refund: true, category: REFUND_CATEGORY, note }
  })

  // 환불금이 입금으로 들어온 양수 행 — 같은 금액의 미사용 결제와 짝이 맞으면 배지만 붙인다.
  // (카테고리·금액·집계는 그대로 — 수입 집계 규칙을 건드리지 않는다)
  out.forEach((t, i) => {
    if (t.refund || !isDepositLike(t)) return
    if (!isExpense(t.category)) return   // 저축·수입·이체 카테고리 행에는 환불 배지를 붙이지 않는다
    if (amountKey(t.amount) <= 0) return
    const pick = pickPartner(t.amount, t.date)
    if (pick === null) return
    links.set(pick, 'origin')
    links.set(i, 'deposit')
  })

  const linked = out.map((t, i) => {
    const link = links.get(i)
    return link ? { ...t, refundPair: link } : t
  })

  return { transactions: linked, result: { refundCount, unmatchedNegativeCount } }
}

/**
 * 타입 열 기반 환불 분류 — '지출' 타입의 **양수** 행(refundDeposit)이 환불금이다.
 *  - 환불 행: 카테고리를 '환불'로 바꾸고(원본 카테고리는 비고), refund=true, refundPair='deposit'
 *    → 내용 칸에 '환불' 배지가 붙고 취소선 처리되며 지출 합계에서는 빠진다.
 *  - 원래 결제 행: 같은 금액의 음수 지출 중 환불일 이전(같은 날 포함)에서 결제수단이 같은 것을 우선,
 *    그다음 가장 가까운 날짜를 1:1로 골라 refundPair='origin' (카테고리·금액은 그대로, 환불과 함께 상계).
 *  - 짝이 없어도 환불 행은 환불로 분류한다 (환불금은 지출이 아니므로 지출 합계에 넣으면 안 된다).
 */
function classifyTypedRefunds(
  txs: Transaction[],
  isExpense: (category: string) => boolean
): { transactions: Transaction[]; result: RefundMatchResult } {
  const pool = new Map<number, number[]>()   // 금액 → 결제(음수 지출) 행 인덱스
  txs.forEach((t, i) => {
    if (!t.negativeAmount || t.refundDeposit || !isExpense(t.category)) return
    const k = amountKey(t.amount)
    if (k <= 0) return
    const list = pool.get(k)
    if (list) list.push(i)
    else pool.set(k, [i])
  })

  const consumed = new Set<number>()
  const origins = new Set<number>()
  const deposits = txs
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.refundDeposit)
    .sort((a, b) => a.t.date.getTime() - b.t.date.getTime())

  const refunded = new Map<number, Transaction>()
  for (const { t, i } of deposits) {
    const time = t.date.getTime()
    const cands = (pool.get(amountKey(t.amount)) ?? []).filter((j) => !consumed.has(j) && txs[j]!.date.getTime() <= time)
    let pick: number | null = null
    let best: [number, number] = [2, Infinity]   // [결제수단 불일치 여부, 날짜 간격]
    for (const j of cands) {
      const c = txs[j]!
      const score: [number, number] = [c.paymentMethod === t.paymentMethod ? 0 : 1, time - c.date.getTime()]
      if (score[0] < best[0] || (score[0] === best[0] && score[1] < best[1])) { best = score; pick = j }
    }
    if (pick !== null) { consumed.add(pick); origins.add(pick) }
    const original = t.category
    const note = original && original !== REFUND_CATEGORY
      ? [t.note, `원본 카테고리: ${original}`].filter(Boolean).join(' / ')
      : t.note
    refunded.set(i, { ...t, refund: true, refundPair: 'deposit', category: REFUND_CATEGORY, note })
  }

  const out = txs.map((t, i) => {
    const r = refunded.get(i)
    if (r) return r
    return origins.has(i) ? { ...t, refundPair: 'origin' as const } : t
  })
  return { transactions: out, result: { refundCount: deposits.length, unmatchedNegativeCount: 0 } }
}
