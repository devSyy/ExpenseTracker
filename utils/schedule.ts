// 날짜/기한 계산 유틸 — 계약 만료, 기념일 D-day 등 "날짜 기반 정보"의 단일 소스.
//
// 규칙
//  - 저장 형식은 항상 'YYYY-MM-DD' 문자열이다 (Date 객체를 localStorage에 넣으면 복원이 번거롭다).
//  - 모든 날짜 비교는 **자정 기준**으로 맞춘다. 시:분을 남겨두면 "오늘"이 실행 시각에 따라
//    D-0/D-1로 흔들린다.
//  - 유효하지 않은 입력은 null을 돌려준다. 화면에서 '–'로 표시하면 된다.

/** 오늘 자정 */
export function todayStart(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** 'YYYY-MM-DD' → Date(자정). 형식이 틀리거나 존재하지 않는 날짜면 null */
export function parseYmd(ymd: string | null | undefined): Date | null {
  if (!ymd || typeof ymd !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const da = Number(m[3])
  const d = new Date(y, mo - 1, da)
  d.setHours(0, 0, 0, 0)
  // 2026-02-31 같은 값은 Date가 조용히 3월로 넘겨버리므로 되돌려 확인한다
  if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== da) return null
  return d
}

/** Date → 'YYYY-MM-DD' */
export function toYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const da = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${da}`
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  out.setHours(0, 0, 0, 0)
  return out
}

/** from → to 사이의 일수. 미래면 양수, 과거면 음수 */
export function daysBetween(from: Date, to: Date): number {
  const MS = 24 * 60 * 60 * 1000
  // 자정끼리 비교하므로 DST가 있어도 반올림으로 정수 일수가 나온다
  return Math.round((to.getTime() - from.getTime()) / MS)
}

/** 오늘부터 대상 날짜까지 남은 일수 (오늘이면 0). 파싱 실패 시 null */
export function daysUntil(ymd: string | null | undefined, from: Date = todayStart()): number | null {
  const d = parseYmd(ymd)
  if (!d) return null
  return daysBetween(from, d)
}

/**
 * 매년 반복되는 날짜의 **다음 발생일**.
 *
 * 2월 29일은 평년에 존재하지 않으므로 2월 28일로 당겨 잡는다.
 * (다음 윤년까지 4년을 기다리게 하면 "다가오는 기념일" 목록에서 사라져 버린다)
 */
export function nextYearlyOccurrence(ymd: string | null | undefined, from: Date = todayStart()): Date | null {
  const base = parseYmd(ymd)
  if (!base) return null

  const month = base.getMonth()
  const day = base.getDate()

  const build = (year: number): Date => {
    const lastDay = new Date(year, month + 1, 0).getDate()
    const d = new Date(year, month, Math.min(day, lastDay))
    d.setHours(0, 0, 0, 0)
    return d
  }

  const thisYear = build(from.getFullYear())
  return thisYear.getTime() >= from.getTime() ? thisYear : build(from.getFullYear() + 1)
}

/** D-day 표기 — 'D-12' / 'D-DAY' / 'D+3' */
export function formatDDay(days: number | null): string {
  if (days === null || !Number.isFinite(days)) return '–'
  if (days === 0) return 'D-DAY'
  return days > 0 ? `D-${days}` : `D+${Math.abs(days)}`
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'] as const

/** 'YYYY-MM-DD' → '2026. 9. 16. (수)'. 파싱 실패 시 원문 그대로 */
export function formatYmdLong(ymd: string | null | undefined): string {
  const d = parseYmd(ymd)
  if (!d) return ymd || '–'
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. (${WEEKDAYS[d.getDay()]})`
}

/** 'YYYY-MM-DD' → '9월 16일 (수)' — 연도가 문맥상 분명할 때 */
export function formatMonthDay(ymd: string | null | undefined): string {
  const d = parseYmd(ymd)
  if (!d) return ymd || '–'
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`
}

// ── 음력 ──
// 저장/입력은 항상 양력이고, 음력은 표시용으로만 변환한다 (저장하지 않음).
// 브라우저 내장 Intl 중국력(한국 음력과 동일한 규칙)을 쓰므로 별도 라이브러리가 필요 없다.
let lunarFmt: Intl.DateTimeFormat | null | undefined

function getLunarFmt(): Intl.DateTimeFormat | null {
  if (lunarFmt !== undefined) return lunarFmt
  try {
    lunarFmt = new Intl.DateTimeFormat('ko-KR-u-ca-chinese', { year: 'numeric', month: 'numeric', day: 'numeric' })
  } catch {
    lunarFmt = null
  }
  return lunarFmt
}

/** 'YYYY-MM-DD'(양력) → 음력 { year, month, day, leap }. 변환 불가면 null */
export function toLunar(ymd: string | null | undefined): { year: number; month: number; day: number; leap: boolean } | null {
  const d = parseYmd(ymd)
  const fmt = getLunarFmt()
  if (!d || !fmt) return null
  const parts = fmt.formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const monthRaw = get('month') // '8' / 윤달은 '윤6'
  const year = Number(get('relatedYear'))
  const month = Number(monthRaw.replace(/\D/g, ''))
  const day = Number(get('day'))
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day) || !month || !day) return null
  return { year, month, day, leap: monthRaw.includes('윤') }
}

/** 음력 표기 — '음력 8월 23일' / 윤달은 '음력 윤6월 1일'. withYear면 '음력 2026. 8. 23.' */
export function formatLunar(ymd: string | null | undefined, withYear = false): string {
  const l = toLunar(ymd)
  if (!l) return '–'
  const m = `${l.leap ? '윤' : ''}${l.month}월`
  return withYear ? `음력 ${l.year}년 ${m} ${l.day}일` : `음력 ${m} ${l.day}일`
}

// 음력 연도별 (월, 윤달, 일) → 양력 'YYYY-MM-DD' 표. 연도당 한 번만 훑는다.
const lunarYearCache = new Map<number, Map<string, string>>()

function lunarYearTable(year: number): Map<string, string> {
  const hit = lunarYearCache.get(year)
  if (hit) return hit
  const table = new Map<string, string>()
  // 음력 Y년은 양력 Y년 1~2월 초에 시작해 Y+1년 1~2월에 끝난다
  const end = new Date(year + 1, 2, 1)
  for (let d = new Date(year, 0, 1); d < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const ymd = toYmd(d)
    const l = toLunar(ymd)
    if (l && l.year === year) table.set(`${l.month}-${l.leap ? 1 : 0}-${l.day}`, ymd)
  }
  lunarYearCache.set(year, table)
  return table
}

/**
 * 음력 → 양력 'YYYY-MM-DD'. 해당 날짜가 없으면 null.
 * 폴백: 윤달이 그 해에 없으면 평달로, 30일이 없는 달(29일까지)이면 29일로 — 매년 반복 기념일이 사라지지 않게 한다.
 * strict=true면 폴백 없이 정확히 일치하는 날짜만 인정한다 (사용자 입력 검증용).
 */
export function lunarToSolar(year: number, month: number, day: number, leap = false, strict = false): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 30) return null
  if (!getLunarFmt()) return null
  const t = lunarYearTable(year)
  const exact = t.get(`${month}-${leap ? 1 : 0}-${day}`)
  if (exact || strict) return exact ?? null
  const m = leap && !t.has(`${month}-1-1`) ? 0 : leap ? 1 : 0
  return t.get(`${month}-${m}-${day}`) ?? t.get(`${month}-${m}-${day - 1}`) ?? null
}

/** 음력 기준 매년 반복 — 'YYYY-MM-DD'(양력으로 저장된 원래 날짜)의 음력 월·일이 돌아오는 다음 양력 날짜 */
export function nextLunarOccurrence(ymd: string | null | undefined, from: Date = todayStart()): Date | null {
  const l = toLunar(ymd)
  if (!l) return null
  let best: Date | null = null
  for (const y of [from.getFullYear() - 1, from.getFullYear(), from.getFullYear() + 1]) {
    const s = lunarToSolar(y, l.month, l.day, l.leap)
    const d = parseYmd(s)
    if (d && d.getTime() >= from.getTime() && (!best || d < best)) best = d
  }
  return best
}

/** 남은 일수를 사람 말로 — '오늘' / '내일' / '12일 남음' / '3일 지남' */
export function describeDays(days: number | null): string {
  if (days === null) return '–'
  if (days === 0) return '오늘'
  if (days === 1) return '내일'
  if (days === -1) return '어제'
  return days > 0 ? `${days.toLocaleString('ko-KR')}일 남음` : `${Math.abs(days).toLocaleString('ko-KR')}일 지남`
}

/**
 * 두 날짜 사이의 진행률 0..1 (시작 전 0, 종료 후 1).
 * 종료일이 없으면(무기한) null — 진행바를 그리지 않는다는 뜻.
 */
export function elapsedRatio(
  startYmd: string | null | undefined,
  endYmd: string | null | undefined,
  now: Date = todayStart()
): number | null {
  const start = parseYmd(startYmd)
  const end = parseYmd(endYmd)
  if (!start || !end) return null
  const total = daysBetween(start, end)
  if (total <= 0) return 1
  const done = daysBetween(start, now)
  return Math.max(0, Math.min(1, done / total))
}

/** 간단한 고유 id — 이 앱은 단일 브라우저 저장이라 이 정도로 충분하다 */
export function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
