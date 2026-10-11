// 선불 자산(지역화폐·상품권·선불카드·포인트) 리포지토리.
//
// 자산 정의 + 충전/조정 원장 + 카드(결제수단) 연결을 담는다. 사용 내역과 잔액은 저장하지 않는다
// (거래의 localCurrencyUsed/localCurrencyId에서 파생 — utils/localCurrency.summarize).
// 설정 성격의 데이터라 편집 즉시 저장(autoPersist)이며, 거래 데이터의 명시 저장과는 키가 분리돼 있다.
import { createRepository } from './createRepository'
import { clampRate, normalizeKind, type PrepaidAsset, type PrepaidLedgerEntry } from '~/utils/localCurrency'

const KEY = 'prepaid:assets:v1'

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

function normalizeLedger(raw: unknown): PrepaidLedgerEntry[] {
  if (!Array.isArray(raw)) return []
  const out: PrepaidLedgerEntry[] = []
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue
    const o = e as Record<string, unknown>
    const id = str(o.id)
    const date = str(o.date)
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const type = o.type === 'ADJUST' ? 'ADJUST' : 'RECHARGE'
    const entry: PrepaidLedgerEntry = {
      id, date, type,
      paid: type === 'RECHARGE' ? num(o.paid) : 0,
      value: num(o.value)
    }
    const pm = str(o.paymentMethod)
    if (pm) entry.paymentMethod = pm
    const memo = str(o.memo)
    if (memo) entry.memo = memo
    out.push(entry)
  }
  return out
}

export function normalizeAsset(raw: unknown): PrepaidAsset | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = str(o.id)
  const name = str(o.name)
  if (!id || !name) return null
  const linked = Array.isArray(o.linkedPayments)
    ? Array.from(new Set(o.linkedPayments.map(str).filter(Boolean)))
    : []
  const asset: PrepaidAsset = {
    id,
    name,
    kind: normalizeKind(o.kind),
    active: o.active !== false,
    discountRate: clampRate(num(o.discountRate)),
    openingBalance: num(o.openingBalance),
    linkedPayments: linked,
    ledger: normalizeLedger(o.ledger),
    createdAt: str(o.createdAt) || new Date().toISOString()
  }
  const note = str(o.note)
  if (note) asset.note = note
  return asset
}

function normalizeList(raw: unknown): PrepaidAsset[] | null {
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const out: PrepaidAsset[] = []
  for (const x of raw) {
    const a = normalizeAsset(x)
    if (!a || seen.has(a.id)) continue   // id는 거래가 참조하는 키라 중복을 허용하지 않는다
    seen.add(a.id)
    out.push(a)
  }
  return out
}

export const prepaidRepo = createRepository<PrepaidAsset[]>({
  key: KEY,
  default: () => [],
  migrate: normalizeList
})

export { KEY as PREPAID_KEY }
