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
