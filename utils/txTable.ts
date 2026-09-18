// 거래내역 테이블의 순수 계산 로직.
//
// 반응성(ref/computed)에 의존하지 않는 함수만 둔다. 컴포넌트는 여기서 만든
// 비교기·술어를 computed 안에서 쓰기만 한다. 덕분에 정렬·중복 판정 규칙을
// 컴포넌트를 띄우지 않고도 검증할 수 있다.
import type { Transaction } from './types'

// ─────────────────────────────────────────
// 정렬
// ─────────────────────────────────────────

/** 정렬 가능한 컬럼 키 */
export type SortKey = 'date' | 'description' | 'category' | 'paymentMethod' | 'costType' | 'amount'
export type SortDir = 'asc' | 'desc'

/**
 * 한글 정렬용 collator.
 * numeric:true → '항목2'가 '항목10'보다 앞에 온다. sensitivity:'base' → 대소문자 무시.
 */
const collator = new Intl.Collator('ko-KR', { numeric: true, sensitivity: 'base' })

/**
 * 정렬 비교기.
 *
 * 1차 키가 같을 때는 **항상 날짜 → id 순**으로 떨어뜨려 안정 정렬을 보장한다.
 * (타이브레이커에는 방향을 곱하지 않는다. 방향을 곱하면 같은 카테고리 묶음 안의
 *  순서가 정렬 방향을 바꿀 때마다 뒤집혀 "어디까지 봤는지"를 잃는다)
 */
export function compareBy(key: SortKey, dir: SortDir): (a: Transaction, b: Transaction) => number {
  const sign = dir === 'asc' ? 1 : -1
  return (a, b) => {
    let d = 0
    if (key === 'date') d = a.date.getTime() - b.date.getTime()
    else if (key === 'amount') d = a.amount - b.amount
    else d = collator.compare(String(a[key] ?? ''), String(b[key] ?? ''))

    if (d !== 0) return d * sign

    if (key !== 'date') {
      const byDate = a.date.getTime() - b.date.getTime()
      if (byDate !== 0) return byDate
    }
    return a.id.localeCompare(b.id)
  }
}

// ─────────────────────────────────────────
// 중복 의심 거래
// ─────────────────────────────────────────

/**
 * 중복 판정 키 — 같은 날짜 + 같은 금액 + 같은 내용.
 *
 * 엑셀을 두 번 올렸을 때 생기는 완전 중복을 잡는 것이 목적이다. 결제수단·카테고리는
 * 사용자가 나중에 바꿀 수 있으므로 키에 넣지 않는다(넣으면 한쪽만 고친 순간 중복이 풀린다).
 * 날짜는 시각을 버리고 연월일만 쓴다.
 */
export function duplicateKey(t: Transaction): string {
  const d = t.date
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${ymd}|${t.amount}|${t.description.trim()}`
}

/**
 * 키별 건수. 2 이상이면 중복 의심.
 * 판정 범위는 호출자가 정한다 — 필터 결과가 아니라 **전체 거래**를 넘겨야
 * 짝이 필터 밖에 있는 중복도 잡힌다.
 */
export function duplicateCounts(list: Transaction[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of list) {
    const k = duplicateKey(t)
    m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

// ─────────────────────────────────────────
// 컬럼 정의
// ─────────────────────────────────────────

export type ColumnKey =
  | 'date' | 'description' | 'category' | 'paymentMethod' | 'costType' | 'amount' | 'exclude'

export interface ColumnDef {
  key: ColumnKey
  label: string
  /** colgroup 폭(px). null이면 auto — 남는 폭을 나눠 가진다 */
  width: number | null
  /** 숨길 수 있는 컬럼인지. 내용·금액은 이 표의 존재 이유라 항상 표시한다 */
  hideable: boolean
  /** 헤더 클릭 정렬 대상인지 */
  sortKey: SortKey | null
}

export const TX_COLUMNS: readonly ColumnDef[] = [
  { key: 'date',          label: '날짜',      width: 88,   hideable: true,  sortKey: 'date' },
  { key: 'description',   label: '내용',      width: 360,  hideable: false, sortKey: 'description' },
  { key: 'category',      label: '카테고리',  width: null, hideable: true,  sortKey: 'category' },
  { key: 'paymentMethod', label: '결제수단',  width: null, hideable: true,  sortKey: 'paymentMethod' },
  { key: 'costType',      label: '구분',      width: 88,   hideable: true,  sortKey: 'costType' },
  { key: 'amount',        label: '금액',      width: 124,  hideable: false, sortKey: 'amount' },
  { key: 'exclude',       label: '지출 제외', width: 80,   hideable: true,  sortKey: null }
] as const

export const HIDEABLE_COLUMN_KEYS: readonly ColumnKey[] =
  TX_COLUMNS.filter((c) => c.hideable).map((c) => c.key)

export const ALL_COLUMN_KEYS: readonly ColumnKey[] = TX_COLUMNS.map((c) => c.key)

/**
 * 보이는 컬럼만으로 표의 최소 폭을 계산한다.
 *
 * colgroup이 table-layout:fixed를 쓰므로 고정폭 합에 auto 컬럼 몫을 더해야
 * 컬럼을 껐을 때 표가 불필요하게 넓게 남지 않는다.
 * selectWidth: 삭제 모드에서만 생기는 체크박스 컬럼(40px).
 */
export function tableMinWidth(visible: ReadonlySet<ColumnKey>, selectWidth = 0): number {
  let fixed = selectWidth
  let autos = 0
  for (const c of TX_COLUMNS) {
    if (!visible.has(c.key)) continue
    if (c.width == null) autos++
    else fixed += c.width
  }
  // auto 컬럼 1개당 최소 120px은 줘야 카테고리/결제수단 이름이 뭉개지지 않는다
  return Math.max(480, fixed + autos * 120)
}

// ─────────────────────────────────────────
// 고급 필터
// ─────────────────────────────────────────

/** 상태 필터 — 서로 배타적인 단일 선택 */
export type StatusFilter = 'all' | 'expense' | 'income' | 'excluded' | 'negative' | 'duplicate'

export const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string; title: string }> = [
  { value: 'all',       label: '전체',       title: '모든 거래' },
  { value: 'expense',   label: '지출만',     title: '지출 카테고리이면서 제외되지 않은 거래' },
  { value: 'income',    label: '수입만',     title: '수입 카테고리 거래' },
  { value: 'excluded',  label: '제외만',     title: '지출 계산에서 직접 제외한 거래' },
  { value: 'negative',  label: '음수/환불만', title: '원본 금액이 음수인 거래 (환불 포함)' },
  { value: 'duplicate', label: '중복 의심만', title: '날짜·금액·내용이 똑같은 거래가 2건 이상인 것' }
] as const

/** 문자열 금액 입력("1,0000", "", "abc")을 숫자로. 비었거나 숫자가 아니면 null */
export function parseAmountInput(raw: string): number | null {
  const s = raw.replace(/[,\s원]/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * 금액 범위 판정. 비교는 **절대값** 기준이다 —
 * 환불(음수) 거래도 "5만원짜리"로 찾을 수 있어야 하기 때문이다.
 */
export function inAmountRange(t: Transaction, min: number | null, max: number | null): boolean {
  const v = Math.abs(Number(t.amount) || 0)
  if (min != null && v < min) return false
  if (max != null && v > max) return false
  return true
}

/** yyyy-MM-dd 문자열 범위 판정. 빈 문자열은 제한 없음 */
export function inDateRange(t: Transaction, from: string, to: string): boolean {
  if (!from && !to) return true
  const d = t.date
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (from && ymd < from) return false
  if (to && ymd > to) return false
  return true
}
