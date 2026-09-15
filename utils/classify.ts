// 분류 로직: 컬럼 헤더 추론, 카테고리/결제수단 정규화, 고정/변동 판별, 파생필드 계산
import type { Category, CostType, PaymentMethod, Transaction } from './types'
import { FIXED_CATEGORIES } from './types'

// ───────── 헤더 별칭 맵 ─────────
// 사용자가 어떤 헤더명을 써도 최대한 인식하도록 넓게 매핑합니다.

export const HEADER_ALIASES: Record<string, string[]> = {
  date: [
    '날짜', '일자', '거래일', '사용일', 'date', '일시', '거래일자',
    // 카드사/은행 명세서에서 흔한 표기
    '이용일자', '이용일', '승인일자', '승인일', '결제일자', '결제일', '매출일자', '거래일시', '거래년월일', '작성일자'
  ],
  description: [
    '내용', '적요', '항목', '메모', '사용처', '가맹점', 'description', 'memo', '상세',
    '이용가맹점', '가맹점명', '상호', '상호명', '거래내용', '거래처', '사용내역', '이용내역', '품목', '내역'
  ],
  amount: [
    '금액', '지출', '사용금액', '출금', '출금액', 'amount', 'price', '합계', '결제금액',
    '이용금액', '승인금액', '거래금액', '매출금액', '청구금액', '지출금액', '출금금액', '사용액', '결제액'
  ],
  category: ['카테고리', '분류', '항목분류', 'category', '대분류', '업종', '가맹점업종', '지출분류', '유형'],
  paymentMethod: [
    '결제수단', '결제방법', '결제', '수단', '카드', 'method', 'payment', '결제카드', '결제처',
    '카드명', '카드종류', '이용카드', '계좌', '결제계좌', '은행'
  ],
  costType: ['구분', '고정변동', '고정여부', 'type', '비용구분', '비용유형'],
  note: ['비고', 'note', '참고', '메모2', '특이사항']
}

/** 논리 컬럼별 헤더 매칭 가중치 — 헤더 행 탐지 점수 계산에 사용 */
const HEADER_WEIGHT: Record<string, number> = {
  date: 4,
  amount: 4,
  description: 1.5,
  category: 1,
  paymentMethod: 1,
  costType: 0.5,
  note: 0.5
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

// ───────── 헤더 행 탐지 ─────────
//
// 은행/카드사에서 내려받은 파일은 첫 행이 제목("○○카드 이용대금 명세서")이고
// 실제 헤더는 3~6행쯤에 있는 경우가 대부분이다. 무조건 첫 행을 헤더로 쓰면
// 컬럼을 하나도 인식하지 못해 "등록되지 않음"으로 보인다.
// 그래서 앞쪽 행들을 훑어 "날짜/금액 등 알려진 헤더가 가장 많이 맞는 행"을 헤더로 삼는다.

export interface HeaderScan {
  /** AOA 기준 헤더 행 인덱스 (찾지 못하면 0) */
  index: number
  /** 해당 행의 원본 헤더 문자열 */
  headers: string[]
  /** 논리 컬럼 매핑 */
  map: Record<string, string>
  /** 매칭 점수 (날짜+금액 모두 인식 시 8점 이상) */
  score: number
}

/** 한 행(셀 배열)을 헤더로 가정했을 때의 매핑/점수 */
function scoreHeaderRow(cells: string[]): { map: Record<string, string>; score: number } {
  // 빈 헤더 셀은 고유한 더미 이름으로 채워 detectColumns가 오작동하지 않게 한다.
  const row: Record<string, unknown> = {}
  cells.forEach((c, i) => {
    const key = c.trim() || `__empty_${i}`
    // 같은 헤더명이 중복되면 SheetJS와 동일하게 접미사를 붙인다.
    row[key in row ? `${key}_${i}` : key] = null
  })
  const map = detectColumns(row)
  let score = 0
  for (const [logical, weight] of Object.entries(HEADER_WEIGHT)) {
    if (map[logical] && !map[logical].startsWith('__empty_')) score += weight
  }
  // 헤더 행은 보통 텍스트 셀이 여러 개다 (데이터 행과 구분하는 약한 신호)
  const nonEmpty = cells.filter((c) => c.trim() !== '').length
  score += Math.min(nonEmpty, 10) * 0.05
  return { map, score }
}

/**
 * AOA(2차원 배열)에서 헤더로 보이는 행을 찾는다.
 * 날짜·금액이 모두 인식되는 행을 최우선으로 하고, 없으면 점수가 가장 높은 행을 쓴다.
 */
export function detectHeaderRow(aoa: unknown[][], maxScan = 30): HeaderScan {
  const limit = Math.min(aoa.length, maxScan)
  let best: HeaderScan = { index: 0, headers: [], map: {}, score: -1 }

  for (let i = 0; i < limit; i++) {
    const raw = aoa[i] ?? []
    const cells = raw.map((c) => (c == null ? '' : String(c)))
    if (cells.filter((c) => c.trim() !== '').length < 2) continue
    const { map, score } = scoreHeaderRow(cells)
    if (score > best.score) best = { index: i, headers: cells, map, score }
    // 날짜+금액이 모두 잡히면 더 볼 필요 없다 (앞쪽 행 우선)
    if (map.date && map.amount) break
  }

  if (best.score < 0) {
    const cells = (aoa[0] ?? []).map((c) => (c == null ? '' : String(c)))
    return { index: 0, headers: cells, map: detectColumns(Object.fromEntries(cells.map((c, i) => [c || `__empty_${i}`, null]))), score: 0 }
  }
  return best
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
/** 로컬 타임존 기준으로 안전하게 Date 생성 (UTC 파싱으로 하루 밀리는 문제 방지) */
function ymd(y: number, m: number, d: number): Date | null {
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, m - 1, d)
  // 2026-02-31 같은 값이 3월로 넘어가는 것을 거른다
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null
  return dt
}

/** 엑셀 시리얼 번호로 볼 수 있는 범위 (1900-01-01 ~ 2099-12-31 근사) */
const SERIAL_MIN = 1
const SERIAL_MAX = 73050

function fromSerial(n: number): Date | null {
  if (n < SERIAL_MIN || n > SERIAL_MAX) return null
  const epoch = Date.UTC(1899, 11, 30)
  const utc = new Date(epoch + Math.round(n) * 86400000)
  return ymd(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate())
}

/**
 * 다양한 실제 파일 포맷의 날짜를 관대하게 파싱한다.
 * 지원: Date 객체 / 엑셀 시리얼 / "2026-01-05" / "2026.01.05" / "2026. 1. 5" /
 *      "2026/1/5" / "2026년 1월 5일" / "20260105" / "26-01-05" / 뒤에 시각이 붙은 형태
 */
export function toDate(raw: unknown): Date | null {
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // 20260105 처럼 YYYYMMDD 를 숫자로 저장한 경우가 시리얼보다 흔하다
    if (raw >= 19000101 && raw <= 29991231 && Number.isInteger(raw)) {
      const s = String(raw)
      const d = ymd(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)))
      if (d) return d
    }
    return fromSerial(raw)
  }

  if (typeof raw !== 'string') return null

  let s = raw.trim()
  if (!s) return null

  // "2026년 1월 5일" → "2026-1-5"
  s = s.replace(/(\d{1,4})\s*년\s*/g, '$1-').replace(/(\d{1,2})\s*월\s*/g, '$1-').replace(/(\d{1,2})\s*일/g, '$1')
  // 구분자 통일 + 공백 제거 ("2026. 1. 5" → "2026-1-5")
  s = s.replace(/[./]/g, '-').replace(/\s*-\s*/g, '-').trim()
  // 뒤에 붙은 시각/요일 제거 ("2026-01-05 13:22:00", "2026-01-05(월)")
  s = s.replace(/[\s(T].*$/, '').replace(/-+$/, '')

  // YYYY-M-D
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]))

  // YY-M-D (2자리 연도: 00~69 → 2000년대, 70~99 → 1900년대)
  m = s.match(/^(\d{2})-(\d{1,2})-(\d{1,2})$/)
  if (m) {
    const yy = Number(m[1])
    return ymd(yy <= 69 ? 2000 + yy : 1900 + yy, Number(m[2]), Number(m[3]))
  }

  // YYYYMMDD
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]))

  // 숫자만 있는 문자열 = 엑셀 시리얼
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = fromSerial(Number(s))
    if (d) return d
  }

  // 마지막 폴백: 네이티브 파서 (ISO 등)
  const native = new Date(s)
  if (!isNaN(native.getTime())) return ymd(native.getFullYear(), native.getMonth() + 1, native.getDate())

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

/**
 * 금액 파싱 — **부호를 보존**한다.
 *
 * 가계부 파일에서 음수 금액은 결제 취소/환불을 뜻한다. 예전에는 여기서 Math.abs()로
 * 부호를 버려 취소 건이 같은 금액의 정상 지출로 둔갑했다. 이제 음수를 그대로 돌려주고,
 * 호출부(parseExcel)가 취소 거래로 표시한다.
 *
 * 음수로 인식하는 표기 (국내 카드사/은행 파일에서 실제로 쓰이는 형태):
 *  - 앞에 붙은 빼기 기호: "-1,234", "−1,234"(U+2212), "△1,234", "▲1,234"
 *  - 뒤에 붙은 빼기 기호: "1,234-"
 *  - 회계식 괄호 표기:    "(1,234)"
 *  - 취소/환불/반품 표기가 섞인 셀: "1,234 (취소)"
 *
 * 지원 형식: 1234 / "1,234" / "₩1,234" / "1,234원" / "1 234" / 전각 숫자
 */
export function toSignedAmount(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw !== 'string') return 0

  let s = raw.trim()
  if (!s || s === '-' || s === '–' || s === '−') return 0

  // 전각 숫자/쉼표 → 반각
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
       .replace(/[，､]/g, ',')
       .replace(/[−–—]/g, '-')   // 각종 대시를 ASCII 하이픈으로 통일

  // ── 음수(취소/환불) 판별 ──
  const hasCancelWord = /취소|환불|반품/.test(s)
  const isParenNegative = /^\(.*\)$/.test(s.replace(/[\s₩￦원]/g, ''))
  const hasMinusPrefix = /^[-△▲]/.test(s.replace(/^[\s₩$￦]+/, ''))
  const hasMinusSuffix = /[-]\s*$/.test(s)
  const negative = hasCancelWord || isParenNegative || hasMinusPrefix || hasMinusSuffix

  // 통화기호/단위/공백/괄호/쉼표/부호문자/취소문구 제거 후 숫자만 남긴다
  const cleaned = s
    .replace(/취소|환불|반품/g, '')
    .replace(/[,\s₩$￦원KRWkrw]/g, '')
    .replace(/[()△▲+-]/g, '')
  if (!cleaned || !/\d/.test(cleaned)) return 0

  const n = Number(cleaned)
  if (!Number.isFinite(n)) return 0
  return negative ? -Math.abs(n) : Math.abs(n)
}

/**
 * 금액의 크기(양수)만 필요할 때 쓰는 헬퍼. 부호는 버린다.
 * 취소 여부까지 알아야 하면 toSignedAmount()를 쓸 것.
 */
export function toAmount(raw: unknown): number {
  return Math.abs(toSignedAmount(raw))
}
