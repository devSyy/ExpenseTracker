// 선불 자산(지역화폐·상품권·선불카드·포인트) 컴포저블 — prepaidRepo 위에 계산·액션을 얹은 레이어.
//
// 핵심 규칙
//  1) 연결의 단일 소스는 asset.linkedPayments다. 설정의 지역화폐 탭과 결제수단 탭이 같은 데이터를 보고 쓴다.
//  2) '지역화폐 사용' 체크는 **활성 자산 + 연결된 카드 + 지출 유형 거래**에만 허용한다.
//     (이미 체크된 거래는 자산이 꺼지거나 연결이 풀려도 표시·해제가 가능해야 하므로 해제는 항상 허용)
//  3) 사용 거래는 소비 통계에 한 번만 잡힌다 — 거래 원본은 그대로이고 카드 실적/결제수단 집계에서만 분리된다.
//  4) 충전은 거래가 아니라 원장 항목이다 — 소비 집계에 들어가지 않는다.
//  5) 잔액은 파생값이다 (utils/localCurrency.summarize).
import { todayYmd } from '~/utils/format'
import { computed } from 'vue'
import { prepaidRepo } from '~/repositories/prepaidRepository'
import { useExpenses } from '~/composables/useExpenses'
import { useTaxonomies } from '~/composables/useTaxonomies'
import {
  buildHistory,
  clampRate,
  eligibleAssets,
  isLocalCurrencyTx,
  paidFromValue,
  summarize,
  usageTxsOf,
  valueFromPaid,
  type AssetSummary,
  type HistoryRow,
  type PrepaidAsset,
  type PrepaidKind,
  type PrepaidLedgerEntry
} from '~/utils/localCurrency'
import type { Transaction } from '~/utils/types'

const assets = prepaidRepo.state

/** 빠른 추가용 프리셋 — id는 거래가 참조하는 안정 코드 */
export const PREPAID_PRESETS: ReadonlyArray<{ id: string; name: string; kind: PrepaidKind; discountRate: number }> = [
  { id: 'SEOUL_PAY', name: '서울페이', kind: 'LOCAL_CURRENCY', discountRate: 10 },
  { id: 'ONNURI', name: '온누리상품권', kind: 'GIFT_CARD', discountRate: 10 }
] as const

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()
}

type Result<T = unknown> = { ok: true; value?: T } | { ok: false; reason: string }

function patchAsset(id: string, patch: Partial<PrepaidAsset>): boolean {
  const idx = assets.value.findIndex((a) => a.id === id)
  if (idx === -1) return false
  const next = assets.value.slice()
  next[idx] = { ...next[idx]!, ...patch }
  assets.value = next
  return true
}

export function useLocalCurrency() {
  const { transactions, setLocalCurrency } = useExpenses()
  const tax = useTaxonomies()

  // ── 파생 ──
  const summaries = computed<Map<string, AssetSummary>>(
    () => new Map(assets.value.map((a) => [a.id, summarize(a, transactions.value)]))
  )
  const emptySummary: AssetSummary = {
    balance: 0, totalRecharge: 0, totalPaid: 0, benefit: 0, totalUsage: 0, totalAdjust: 0, usageCount: 0
  }
  const summaryOf = (id: string): AssetSummary => summaries.value.get(id) ?? emptySummary
  const historyOf = (id: string): HistoryRow[] => {
    const a = assets.value.find((x) => x.id === id)
    return a ? buildHistory(a, transactions.value) : []
  }

  /** 전체 합계 — 소비 통계와 자금 흐름을 따로 보여주기 위한 값 */
  const totals = computed(() => {
    let balance = 0, recharge = 0, paid = 0, usage = 0, benefit = 0
    for (const a of assets.value) {
      const s = summaryOf(a.id)
      balance += s.balance; recharge += s.totalRecharge; paid += s.totalPaid; usage += s.totalUsage; benefit += s.benefit
    }
    return { balance, recharge, paid, usage, benefit }
  })

  /** 결제수단별 충전 결제액 (자금 흐름: 카드 → 선불 자산) */
  const rechargeByPayment = computed(() => {
    const m = new Map<string, { paid: number; value: number }>()
    for (const a of assets.value) {
      for (const e of a.ledger) {
        if (e.type !== 'RECHARGE') continue
        const k = e.paymentMethod || '(미지정)'
        const cur = m.get(k) ?? { paid: 0, value: 0 }
        cur.paid += e.paid; cur.value += e.value
        m.set(k, cur)
      }
    }
    return m
  })

  /** 사용 체크를 새로 켤 수 있는 활성 연결이 하나라도 있는지 (없으면 거래표에 아무 UI도 더하지 않는다) */
  const hasActiveLink = computed(() => assets.value.some((a) => a.active && a.linkedPayments.length > 0))

  // ── 거래 연동 ──
  const byId = (id: string | undefined): PrepaidAsset | undefined =>
    id ? assets.value.find((a) => a.id === id) : undefined

  /** 이 거래에서 새로 고를 수 있는 자산 목록 — 활성·연결 + 지출 유형 거래만 */
  function eligibleFor(t: Transaction): PrepaidAsset[] {
    if (tax.categoryType(t.category) !== '지출') return []
    return eligibleAssets(assets.value, t.paymentMethod)
  }

  /** 이 거래가 사용으로 표시한 자산 (없으면 undefined) */
  function currentOf(t: Transaction): PrepaidAsset | undefined {
    return isLocalCurrencyTx(t) ? byId(t.localCurrencyId) : undefined
  }

  /**
   * 거래 행에 지역화폐 UI를 보여야 하는지.
   * 새로 켤 수 있거나(eligible) 이미 켜져 있을 때만 — 무관한 카드 거래에는 아무것도 그리지 않는다.
   */
  function showControl(t: Transaction): boolean {
    return isLocalCurrencyTx(t) || eligibleFor(t).length > 0
  }

  /** 결제수단 집계용 라벨 — 지역화폐 사용 거래는 카드가 아니라 자산 이름으로 묶는다 */
  function paymentLabel(t: Transaction): string {
    if (!isLocalCurrencyTx(t)) return t.paymentMethod
    const a = byId(t.localCurrencyId)
    return `${a?.name ?? '지역화폐'} (지역화폐)`
  }

  /**
   * 사용 표시를 켜거나(currencyId) 뗀다(null).
   * 켤 때는 eligible 검증을 통과해야 한다. 잔액이 모자라면 warning을 돌려준다(막지는 않는다 —
   * 기초잔액을 아직 입력하지 않은 사용자도 있다).
   */
  function applyToTransaction(txId: string, currencyId: string | null): Result<{ warning?: string; name?: string }> {
    if (currencyId === null) {
      const r = setLocalCurrency(txId, null)
      return r.ok ? { ok: true, value: {} } : { ok: false, reason: r.reason ?? '변경 실패' }
    }
    const t = transactions.value.find((x) => x.id === txId)
    if (!t) return { ok: false, reason: '거래를 찾을 수 없습니다. 목록을 새로고침해 주세요.' }
    const already = t.localCurrencyId === currencyId && isLocalCurrencyTx(t)
    const target = eligibleFor(t).find((a) => a.id === currencyId) ?? (already ? byId(currencyId) : undefined)
    if (!target) return { ok: false, reason: '이 거래에는 사용할 수 없는 지역화폐입니다 (카드 연결 또는 활성 상태를 확인하세요).' }

    const before = summaryOf(currencyId).balance
    const r = setLocalCurrency(txId, currencyId)
    if (!r.ok) return { ok: false, reason: r.reason ?? '변경 실패' }
    const after = summaryOf(currencyId).balance
    const warning = after < 0 && after < before ? `${target.name} 잔액이 부족합니다 (현재 ${after.toLocaleString('ko-KR')}원)` : undefined
    return { ok: true, value: { warning, name: target.name } }
  }

  // ── 자산 CRUD ──
  function addAsset(input: {
    id?: string; name: string; kind?: PrepaidKind; discountRate?: number; openingBalance?: number
  }): Result<PrepaidAsset> {
    const name = (input.name ?? '').trim()
    if (!name) return { ok: false, reason: '이름을 입력하세요' }
    if (assets.value.some((a) => a.name === name)) return { ok: false, reason: '이미 존재하는 이름입니다' }
    let id = (input.id ?? '').trim()
    if (!id) id = newId('PA')
    if (assets.value.some((a) => a.id === id)) return { ok: false, reason: '이미 등록된 자산입니다' }
    const asset: PrepaidAsset = {
      id, name,
      kind: input.kind ?? 'LOCAL_CURRENCY',
      active: true,
      discountRate: clampRate(Number(input.discountRate ?? 0)),
      openingBalance: Math.round(Number(input.openingBalance ?? 0)) || 0,
      linkedPayments: [],
      ledger: [],
      createdAt: new Date().toISOString()
    }
    assets.value = [...assets.value, asset]
    return { ok: true, value: asset }
  }

  function updateAsset(
    id: string,
    patch: Partial<Pick<PrepaidAsset, 'name' | 'kind' | 'discountRate' | 'openingBalance' | 'note'>>
  ): Result {
    const p: Partial<PrepaidAsset> = {}
    if (patch.name !== undefined) {
      const name = patch.name.trim()
      if (!name) return { ok: false, reason: '이름을 입력하세요' }
      if (assets.value.some((a) => a.id !== id && a.name === name)) return { ok: false, reason: '이미 존재하는 이름입니다' }
      p.name = name
    }
    if (patch.kind !== undefined) p.kind = patch.kind
    if (patch.discountRate !== undefined) p.discountRate = clampRate(Number(patch.discountRate))
    if (patch.openingBalance !== undefined) p.openingBalance = Math.round(Number(patch.openingBalance)) || 0
    if (patch.note !== undefined) p.note = patch.note.trim() || undefined
    return patchAsset(id, p) ? { ok: true } : { ok: false, reason: '대상을 찾을 수 없습니다' }
  }

  function setActive(id: string, active: boolean): Result {
    return patchAsset(id, { active }) ? { ok: true } : { ok: false, reason: '대상을 찾을 수 없습니다' }
  }

  /** 사용 내역이 있는 자산은 지울 수 없다 — 지우면 거래의 사용 표시가 가리킬 곳이 사라진다. 비활성화를 안내한다. */
  function removeAsset(id: string): Result {
    const used = usageTxsOf(id, transactions.value).length
    if (used > 0) {
      return { ok: false, reason: `이 자산을 사용한 거래가 ${used}건 있어 삭제할 수 없습니다. 대신 '사용' 스위치를 꺼서 비활성화하세요.` }
    }
    const next = assets.value.filter((a) => a.id !== id)
    if (next.length === assets.value.length) return { ok: false, reason: '대상을 찾을 수 없습니다' }
    assets.value = next
    return { ok: true }
  }

  // ── 카드 연결 (한 카드 ↔ 여러 자산, 한 자산 ↔ 여러 카드) ──
  const isLinked = (id: string, payment: string): boolean =>
    byId(id)?.linkedPayments.includes(payment) ?? false

  function setLink(id: string, payment: string, linked: boolean): Result {
    const a = byId(id)
    if (!a) return { ok: false, reason: '대상을 찾을 수 없습니다' }
    const has = a.linkedPayments.includes(payment)
    if (has === linked) return { ok: true }
    const next = linked ? [...a.linkedPayments, payment] : a.linkedPayments.filter((p) => p !== payment)
    patchAsset(id, { linkedPayments: next })
    return { ok: true }
  }

  /** 결제수단에 연결된 자산 (비활성 포함 — 설정 화면 표시용) */
  const linkedAssetsOf = (payment: string): PrepaidAsset[] =>
    assets.value.filter((a) => a.linkedPayments.includes(payment))

  // ── 충전 / 조정 ──
  function addRecharge(
    id: string,
    input: { date?: string; value: number; paid?: number; paymentMethod?: string; memo?: string }
  ): Result<PrepaidLedgerEntry> {
    const a = byId(id)
    if (!a) return { ok: false, reason: '대상을 찾을 수 없습니다' }
    const value = Math.round(Number(input.value))
    if (!Number.isFinite(value) || value <= 0) return { ok: false, reason: '충전액은 0보다 커야 합니다' }
    const paid = input.paid !== undefined && Number.isFinite(Number(input.paid))
      ? Math.round(Number(input.paid))
      : paidFromValue(value, a.discountRate)
    if (paid < 0) return { ok: false, reason: '결제액은 0 이상이어야 합니다' }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? (input.date as string) : todayYmd()
    const entry: PrepaidLedgerEntry = { id: newId('R'), date, type: 'RECHARGE', paid, value }
    const pm = (input.paymentMethod ?? '').trim()
    if (pm) entry.paymentMethod = pm
    const memo = (input.memo ?? '').trim()
    if (memo) entry.memo = memo
    patchAsset(id, { ledger: [...a.ledger, entry] })
    return { ok: true, value: entry }
  }

  function addAdjustment(id: string, input: { date?: string; delta: number; memo?: string }): Result<PrepaidLedgerEntry> {
    const a = byId(id)
    if (!a) return { ok: false, reason: '대상을 찾을 수 없습니다' }
    const delta = Math.round(Number(input.delta))
    if (!Number.isFinite(delta) || delta === 0) return { ok: false, reason: '조정액은 0이 아니어야 합니다' }
    const date = /^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') ? (input.date as string) : todayYmd()
    const entry: PrepaidLedgerEntry = { id: newId('A'), date, type: 'ADJUST', paid: 0, value: delta }
    const memo = (input.memo ?? '').trim()
    if (memo) entry.memo = memo
    patchAsset(id, { ledger: [...a.ledger, entry] })
    return { ok: true, value: entry }
  }

  function removeLedgerEntry(id: string, entryId: string): Result {
    const a = byId(id)
    if (!a) return { ok: false, reason: '대상을 찾을 수 없습니다' }
    const next = a.ledger.filter((e) => e.id !== entryId)
    if (next.length === a.ledger.length) return { ok: false, reason: '내역을 찾을 수 없습니다' }
    patchAsset(id, { ledger: next })
    return { ok: true }
  }

  return {
    assets,
    summaries,
    summaryOf,
    historyOf,
    totals,
    rechargeByPayment,
    hasActiveLink,
    eligibleFor,
    currentOf,
    showControl,
    paymentLabel,
    applyToTransaction,
    addAsset,
    updateAsset,
    setActive,
    removeAsset,
    isLinked,
    setLink,
    linkedAssetsOf,
    addRecharge,
    addAdjustment,
    removeLedgerEntry,
    valueFromPaid,
    paidFromValue
  }
}
