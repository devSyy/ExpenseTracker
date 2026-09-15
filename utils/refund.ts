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

  // 지출 유형의 양수 거래를 금액별로 모아 둔다 (짝 후보 풀)
  const positivePool = new Map<number, number[]>()   // 금액 → 원본 인덱스 목록
  txs.forEach((t, i) => {
    if (t.negativeAmount) return
    if (!isExpense(t.category)) return
    const k = amountKey(t.amount)
    if (k <= 0) return
    const list = positivePool.get(k)
    if (list) list.push(i)
    else positivePool.set(k, [i])
  })

  const consumed = new Set<number>()   // 이미 짝으로 쓴 양수 거래 인덱스
  let refundCount = 0
  let unmatchedNegativeCount = 0

  const out = txs.map((t) => {
    if (!t.negativeAmount) return t

    // 조건 1 — 수입 카테고리의 음수는 환불이 아니다 (분류 그대로 유지)
    if (!isExpense(t.category)) {
      unmatchedNegativeCount++
      return t
    }

    // 조건 2 — 같은 금액의 양수 지출 거래가 있어야 한다
    const k = amountKey(t.amount)
    const candidates = (positivePool.get(k) ?? []).filter((i) => !consumed.has(i))
    if (candidates.length === 0) {
      unmatchedNegativeCount++
      return t                      // 짝 없음 → 원래 분류 유지
    }

    // 환불일 이전(또는 같은 날) 결제를 우선, 없으면 가장 가까운 날짜
    const time = t.date instanceof Date ? t.date.getTime() : 0
    const before = candidates.filter((i) => {
      const d = txs[i]!.date
      return d instanceof Date && d.getTime() <= time
    })
    const pool = before.length > 0 ? before : candidates
    let pick = pool[0]!
    let bestGap = Infinity
    for (const i of pool) {
      const d = txs[i]!.date
      const gap = Math.abs((d instanceof Date ? d.getTime() : 0) - time)
      if (gap < bestGap) { bestGap = gap; pick = i }
    }
    consumed.add(pick)
    refundCount++

    // 환불로 분류 — 카테고리를 '환불'로 바꾸고 원본 카테고리는 비고에 남긴다
    const original = t.category
    const note = original && original !== REFUND_CATEGORY
      ? [t.note, `원본 카테고리: ${original}`].filter(Boolean).join(' / ')
      : t.note
    return { ...t, refund: true, category: REFUND_CATEGORY, note }
  })

  return { transactions: out, result: { refundCount, unmatchedNegativeCount } }
}
