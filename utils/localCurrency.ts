// 선불 자산(지역화폐·상품권·선불카드·포인트)의 순수 계산 로직.
//
// 반응성(ref/computed)에 의존하지 않는다 — 잔액·내역·연결 규칙을 컴포넌트 없이 검증할 수 있게 한다.
//
// 설계 원칙
//  - 선불 자산은 **소비 카테고리가 아니라 금융 자산**이다. 카테고리/결제수단/거래의 기존 의미는 바꾸지 않는다.
//  - 잔액은 저장하지 않고 **파생**한다:  잔액 = 기초잔액 + 충전(액면) + 조정 − 사용(거래)
//    사용액의 소스는 거래의 localCurrencyUsed/localCurrencyId 하나뿐이라, 체크를 해제하거나
//    거래를 지우면 잔액이 자동으로 되돌아온다 (잔액과 거래가 어긋날 수 없다).
//  - 충전은 거래가 아니라 **자산 이동**이다. 소비 집계에 들어가지 않으므로 충전액과 실제 사용액이
//    이중 집계되지 않는다 (카드의 충전 결제 건은 '충전' 유형 카테고리로 분류해 소비에서 뺀다).
import { formatDate as ymd } from '~/utils/format'
import type { Transaction, TxType } from './types'

/** 선불 자산 종류 — 같은 구조로 확장한다 (UI 라벨은 PREPAID_KINDS) */
export type PrepaidKind = 'LOCAL_CURRENCY' | 'GIFT_CARD' | 'PREPAID_CARD' | 'POINT' | 'OTHER'

export const PREPAID_KINDS: ReadonlyArray<{ value: PrepaidKind; label: string }> = [
  { value: 'LOCAL_CURRENCY', label: '지역화폐' },
  { value: 'GIFT_CARD', label: '상품권' },
  { value: 'PREPAID_CARD', label: '선불카드' },
  { value: 'POINT', label: '포인트' },
  { value: 'OTHER', label: '기타' }
] as const

export function normalizeKind(raw: unknown): PrepaidKind {
  return PREPAID_KINDS.some((k) => k.value === raw) ? (raw as PrepaidKind) : 'LOCAL_CURRENCY'
}

/** 거래 유형 — 카테고리 유형에서 **파생**한다 (저장하지 않는다: 카테고리 유형이 단일 소스) */
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'RECHARGE'

export function transactionTypeOf(categoryType: TxType): TransactionType {
  switch (categoryType) {
    case '수입': return 'INCOME'
    case '충전': return 'RECHARGE'
    case '이체':
    case '저축': return 'TRANSFER'
    default: return 'EXPENSE'
  }
}

/** 원장 항목 — 충전(RECHARGE) 또는 수기 조정(ADJUST). 사용 내역은 거래에서 파생하므로 여기 없다. */
export type LedgerType = 'RECHARGE' | 'ADJUST'

export interface PrepaidLedgerEntry {
  id: string
  /** YYYY-MM-DD */
  date: string
  type: LedgerType
  /** 충전: 실제 결제액(할인 반영). 조정: 0 */
  paid: number
  /** 충전: 충전된 액면가(+). 조정: 증감액(부호 있음) */
  value: number
  /** 충전에 쓴 결제수단(카드 등) — 자금 흐름 표시용 */
  paymentMethod?: string
  memo?: string
}

export interface PrepaidAsset {
  /** 안정 코드 — 거래의 localCurrencyId가 이 값을 가리킨다 (예: SEOUL_PAY) */
  id: string
  name: string
  kind: PrepaidKind
  active: boolean
  /** 충전 할인율(%) 0~100 */
  discountRate: number
  /** 이 앱에 등록하기 전부터 있던 잔액 */
  openingBalance: number
  /** 연결된 결제수단(카드) 이름들 — 연결의 단일 소스 */
  linkedPayments: string[]
  ledger: PrepaidLedgerEntry[]
  note?: string
  createdAt: string
}

// ── 충전 계산 ──

export function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0
  return Math.min(100, Math.max(0, rate))
}

/** 실결제액 → 충전 액면가. 90,000원 결제 / 10% 할인 → 100,000원 */
export function valueFromPaid(paid: number, ratePct: number): number {
  const r = clampRate(ratePct)
  if (r >= 100) return Math.round(paid)
  return Math.round(paid / (1 - r / 100))
}

/** 충전 액면가 → 실결제액. 100,000원 / 10% 할인 → 90,000원 */
export function paidFromValue(value: number, ratePct: number): number {
  return Math.round(value * (1 - clampRate(ratePct) / 100))
}

// ── 거래 ↔ 선불 자산 ──

/** 부호 있는 금액 — amount는 크기만 보관하고 음수 여부는 negativeAmount가 들고 있다 */
export function signedAmount(t: Pick<Transaction, 'amount' | 'negativeAmount'>): number {
  const a = Math.abs(Number(t.amount) || 0)
  return t.negativeAmount === true ? -a : a
}

/** 거래가 선불 자산 사용으로 표시되어 있는지 (id가 없는 깨진 표시는 무시) */
export function isLocalCurrencyTx(t: Pick<Transaction, 'localCurrencyUsed' | 'localCurrencyId'>): boolean {
  return t.localCurrencyUsed === true && typeof t.localCurrencyId === 'string' && t.localCurrencyId !== ''
}

export function usageTxsOf(assetId: string, txs: readonly Transaction[]): Transaction[] {
  return txs.filter((t) => isLocalCurrencyTx(t) && t.localCurrencyId === assetId)
}

/** 이 결제수단에서 새로 '사용' 체크를 켤 수 있는 자산 — 활성 + 연결된 것만 */
export function eligibleAssets(assets: readonly PrepaidAsset[], paymentName: string): PrepaidAsset[] {
  return assets.filter((a) => a.active && a.linkedPayments.includes(paymentName))
}

// ── 요약 ──

export interface AssetSummary {
  /** 현재 잔액 */
  balance: number
  /** 누적 충전(액면) */
  totalRecharge: number
  /** 누적 충전 실결제액 */
  totalPaid: number
  /** 누적 할인 혜택 = 액면 − 실결제 */
  benefit: number
  /** 누적 사용 (환불 등 음수 거래는 차감) */
  totalUsage: number
  /** 수기 조정 합 (부호 있음) */
  totalAdjust: number
  usageCount: number
}

export function summarize(asset: PrepaidAsset, txs: readonly Transaction[]): AssetSummary {
  let totalRecharge = 0, totalPaid = 0, totalAdjust = 0
  for (const e of asset.ledger) {
    if (e.type === 'RECHARGE') { totalRecharge += e.value; totalPaid += e.paid }
    else totalAdjust += e.value
  }
  const used = usageTxsOf(asset.id, txs)
  const totalUsage = used.reduce((s, t) => s + signedAmount(t), 0)
  return {
    balance: asset.openingBalance + totalRecharge + totalAdjust - totalUsage,
    totalRecharge,
    totalPaid,
    benefit: totalRecharge - totalPaid,
    totalUsage,
    totalAdjust,
    usageCount: used.length
  }
}

// ── 내역 ──

export type HistoryKind = 'RECHARGE' | 'USAGE' | 'ADJUST'

export interface HistoryRow {
  key: string
  date: string
  kind: HistoryKind
  /** 잔액에 미친 영향 (+충전 / −사용) */
  delta: number
  label: string
  /** 충전: 실결제액 */
  paid?: number
  /** 충전에 쓴 결제수단 / 사용 거래의 결제수단 */
  payment?: string
  /** 이 행까지 반영한 잔액 */
  balanceAfter: number
  /** 원장 항목 id 또는 거래 id */
  refId: string
}

/**
 * 충전·조정·사용을 날짜순으로 합쳐 누적 잔액을 계산한다 (오래된 순).
 * 같은 날이면 충전·조정이 사용보다 먼저 — 그날 충전하고 쓴 경우 잔액이 음수로 잠깐 내려가 보이지 않게.
 */
export function buildHistory(asset: PrepaidAsset, txs: readonly Transaction[]): HistoryRow[] {
  type Raw = Omit<HistoryRow, 'balanceAfter'> & { order: number }
  const raws: Raw[] = []
  for (const e of asset.ledger) {
    raws.push({
      key: `L:${e.id}`, date: e.date, kind: e.type === 'RECHARGE' ? 'RECHARGE' : 'ADJUST',
      delta: e.value, label: e.memo || (e.type === 'RECHARGE' ? '충전' : '잔액 조정'),
      paid: e.type === 'RECHARGE' ? e.paid : undefined, payment: e.paymentMethod, refId: e.id, order: 0
    })
  }
  for (const t of usageTxsOf(asset.id, txs)) {
    raws.push({
      key: `T:${t.id}`, date: ymd(t.date), kind: 'USAGE',
      delta: -signedAmount(t), label: t.description || '사용', payment: t.paymentMethod, refId: t.id, order: 1
    })
  }
  raws.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.key.localeCompare(b.key))
  let bal = asset.openingBalance
  return raws.map(({ order: _o, ...r }) => {
    bal += r.delta
    return { ...r, balanceAfter: bal }
  })
}

// ── 결제수단 이름 변경/삭제 시 연결 유지 ──

/** 결제수단 이름이 바뀌면 연결도 따라간다 (이미 새 이름이 있으면 중복 없이 합친다) */
export function renamePaymentLinks(assets: PrepaidAsset[], from: string, to: string): PrepaidAsset[] {
  let changed = false
  const next = assets.map((a) => {
    const touchedLink = a.linkedPayments.includes(from)
    const touchedLedger = a.ledger.some((e) => e.paymentMethod === from)
    if (!touchedLink && !touchedLedger) return a
    changed = true
    const linked = a.linkedPayments.map((p) => (p === from ? to : p))
    return {
      ...a,
      linkedPayments: Array.from(new Set(linked)),
      ledger: a.ledger.map((e) => (e.paymentMethod === from ? { ...e, paymentMethod: to } : e))
    }
  })
  return changed ? next : assets
}

/** 결제수단이 삭제되면 연결만 해제한다 (충전 내역의 결제수단 기록은 이력이라 그대로 둔다) */
export function removePaymentLinks(assets: PrepaidAsset[], name: string): PrepaidAsset[] {
  if (!assets.some((a) => a.linkedPayments.includes(name))) return assets
  return assets.map((a) =>
    a.linkedPayments.includes(name) ? { ...a, linkedPayments: a.linkedPayments.filter((p) => p !== name) } : a
  )
}
