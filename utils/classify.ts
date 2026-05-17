// 분류 로직: 컬럼 헤더 추론, 카테고리/결제수단 정규화, 고정/변동 판별, 파생필드 계산
import type { Category, CostType, PaymentMethod, Transaction } from './types'
import { FIXED_CATEGORIES } from './types'

// ───────── 헤더 별칭 맵 ─────────
// 사용자가 어떤 헤더명을 써도 최대한 인식하도록 넓게 매핑합니다.

export const HEADER_ALIASES: Record<string, string[]> = {
  date: ['날짜', '일자', '거래일', '사용일', 'date', '일시', '거래일자'],
  description: ['내용', '적요', '항목', '메모', '사용처', '가맹점', 'description', 'memo', '상세'],
  amount: ['금액', '지출', '사용금액', '출금', '출금액', 'amount', 'price', '합계', '결제금액'],
  category: ['카테고리', '분류', '항목분류', 'category', '대분류'],
  paymentMethod: ['결제수단', '결제방법', '결제', '수단', '카드', 'method', 'payment', '결제카드', '결제처'],
  costType: ['구분', '고정변동', '고정여부', 'type', '비용구분'],
  note: ['비고', 'note', '참고', '메모2']
}

/**
 * 시트의 첫 행(헤더)을 기준으로 논리 컬럼 → 실제 컬럼명 매핑.
 * 1단계: 완전 일치 → 2단계: 부분 일치. 한 번 매칭된 키는 재사용하지 않습니다.
 */
export function detectColumns(sampleRow: Record<string, unknown>): Record<string, string> {
  const keys = Object.keys(sampleRow)
  const normalize = (s: string) =>
    s.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, '')
  const resolved: Record<string, string> = {}
  const used = new Set<string>()

  // Pass 1: 완전 일치
  for (const [logical, aliases] of Object.entries(HEADER_ALIASES)) {
    const found = keys.find(
      (k) => !used.has(k) && aliases.some((a) => normalize(k) === normalize(a))
    )
    if (found) {
      resolved[logical] = found
      used.add(found)
    }
  }
  // Pass 2: 부분 일치 (긴 별칭부터 검사하면 더 정확합니다)
  for (const [logical, aliases] of Object.entries(HEADER_ALIASES)) {
    if (resolved[logical]) continue
    const sortedAliases = [...aliases].sort((a, b) => b.length - a.length)
    const found = keys.find(
      (k) => !used.has(k) && sortedAliases.some((a) => normalize(k).includes(normalize(a)))
    )
    if (found) {
      resolved[logical] = found
      used.add(found)
    }
  }
  return resolved
}

// ───────── 카테고리 정규화 ─────────
//
// 엑셀의 "대분류" 셀에 적힌 값을 손상 없이 그대로 카테고리로 사용한다.
// (예: '생활', '패션/쇼핑', '여행/숙박' 등 사용자가 가진 분류 체계를 보존)
// 셀이 비어 있으면 폴백 카테고리 '기타'로 둔다. 이후 사용자는
// settings 페이지에서 자유롭게 이름 변경/통합/삭제할 수 있다.

export function normalizeCategory(raw: unknown): Category {
  if (typeof raw !== 'string') return '기타'
  const v = raw.trim()
  return v || '기타'
}

// ───────── 결제수단 정규화 ─────────
// 엑셀의 결제수단 셀 값도 동일하게 원본 그대로 보존한다.

export function normalizePaymentMethod(raw: unknown): PaymentMethod {
  if (typeof raw !== 'string') return '기타결제'
  const v = raw.trim()
  return v || '기타결제'
}

// ───────── 고정비/변동비 ─────────

export function resolveCostType(rawType: unknown, category: Category): CostType {
  if (typeof rawType === 'string') {
    const t = rawType.trim()
    if (/고정|fixed/i.test(t)) return '고정비'
    if (/변동|variable/i.test(t)) return '변동비'
  }
  return FIXED_CATEGORIES.includes(category) ? '고정비' : '변동비'
}

// ───────── 내용(description) 기반 카테고리 오버라이드 ─────────
//
// 카테고리 셀의 값과는 별개로, 내용(description)이 특정 패턴이면 카테고리를 강제로 변경한다.
// 예: 내용이 "출금 내역" / "입금 내역" 인 자기 계좌 입출금 거래는 항상 "입출금"으로 분류한다.
const DESC_OVERRIDES: Array<{ match: RegExp; to: Category }> = [
  { match: /^\s*(출금|입금)\s*내역\s*$/i, to: '입출금' }
]

/**
 * 카테고리 셀과 내용을 함께 고려해 최종 카테고리를 결정한다.
 * 내용 기반 오버라이드가 카테고리 셀보다 우선한다.
 */
export function classifyCategory(rawCategory: unknown, description: string): Category {
  const desc = (description ?? '').trim()
  for (const r of DESC_OVERRIDES) {
    if (r.match.test(desc)) return r.to
  }
  return normalizeCategory(rawCategory)
}

// ───────── 날짜 파싱 ─────────

/**
 * SheetJS 는 보통 Date 객체나 ISO 문자열을 반환하지만,
 * 문자열로 들어올 때의 유연한 파싱을 지원합니다.
 */
export function toDate(raw: unknown): Date | null {
  if (raw instanceof Date && !isNaN(raw.getTime())) return raw
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // 엑셀 시리얼 번호 폴백
    const epoch = new Date(Date.UTC(1899, 11, 30))
    const d = new Date(epoch.getTime() + raw * 86400000)
    return isNaN(d.getTime()) ? null : d
  }
  if (typeof raw === 'string') {
    const s = raw.trim().replace(/\./g, '-').replace(/\//g, '-')
    const d = new Date(s)
    if (!isNaN(d.getTime())) return d
    // YYYY-MM-DD 이외의 잘못된 포맷
    const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (m) {
      const [, y, mo, da] = m
      const d2 = new Date(Number(y), Number(mo) - 1, Number(da))
      if (!isNaN(d2.getTime())) return d2
    }
  }
  return null
}

// ───────── 파생 필드 계산 ─────────

function isoWeekLabel(d: Date): string {
  // ISO 8601 주차 계산
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

export function deriveFields(
  d: Date
): Pick<Transaction, 'year' | 'month' | 'quarter' | 'half' | 'weekLabel' | 'monthLabel' | 'quarterLabel' | 'halfLabel' | 'yearLabel'> {
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const quarter = Math.ceil(month / 3)
  const half: 1 | 2 = month <= 6 ? 1 : 2
  return {
    year,
    month,
    quarter,
    half,
    weekLabel: isoWeekLabel(d),
    monthLabel: `${year}-${String(month).padStart(2, '0')}`,
    quarterLabel: `${year}-Q${quarter}`,
    halfLabel: `${year}-H${half}`,
    yearLabel: String(year)
  }
}

// ───────── 금액 파싱 ─────────

export function toAmount(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.abs(raw)
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[,\s₩$￦원]/g, '').replace(/[()]/g, '')
    const n = Number(cleaned)
    return Number.isFinite(n) ? Math.abs(n) : 0
  }
  return 0
}
