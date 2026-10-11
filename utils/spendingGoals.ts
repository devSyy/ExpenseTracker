// 지출 목표 · 지출 추이 — 순수 계산 모듈 (Vue/스토리지 의존 없음).
//
// 입력은 "이미 지출로 확정된 거래"의 일별 합계(DayMap)뿐이다. 어떤 거래가 지출인지(지출제외·환불 상계·
// 이체·저축 제거)는 useExpenses의 규칙(isExcluded + flowKind)이 정하고, 여기서는 다시 판단하지 않는다.

export type GoalUnit = 'month' | 'quarter' | 'half' | 'year'
export type TrendUnit = 'day' | 'week' | 'month' | 'quarter' | 'half' | 'year'
export type PeriodStatus = 'none' | 'over' | 'warn' | 'prog' | 'ok'

export interface SpendingGoals {
  /** 월 목표 지출 (0 = 미설정) */
  monthly: number
  /** 분기·반기·연 직접 입력값 — null이면 월 목표 × 개월수로 자동 계산 */
  overrides: { quarter: number | null; half: number | null; year: number | null }
}

export const EMPTY_GOALS = (): SpendingGoals => ({
  monthly: 0,
  overrides: { quarter: null, half: null, year: null }
})

export const GOAL_MONTHS: Record<Exclude<GoalUnit, 'month'>, number> = { quarter: 3, half: 6, year: 12 }

export const TREND_UNITS: { value: TrendUnit; label: string }[] = [
  { value: 'day', label: '일' },
  { value: 'week', label: '주' },
  { value: 'month', label: '월' },
  { value: 'quarter', label: '분기' },
  { value: 'half', label: '반기' },
  { value: 'year', label: '년도' }
]

export interface DayAgg { total: number; count: number }
export type DayMap = Map<string, DayAgg>

const DAY_MS = 86400000
const pad = (n: number) => String(n).padStart(2, '0')

export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const daysBetween = (a: Date, b: Date) => Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)

export function isValidGoals(x: unknown): x is SpendingGoals {
  if (!x || typeof x !== 'object') return false
  const g = x as any
  const okNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0
  const okOv = (v: unknown) => v === null || okNum(v)
  return okNum(g.monthly) && !!g.overrides && okOv(g.overrides.quarter) && okOv(g.overrides.half) && okOv(g.overrides.year)
}

/** 일별 합계 맵 — 거래 목록은 이미 지출만 걸러진 상태여야 한다 */
export function buildDayMap(txs: { date: Date | string | number; amount: number }[]): DayMap {
  const map: DayMap = new Map()
  for (const t of txs) {
    const d = t.date instanceof Date ? t.date : new Date(t.date)
    if (Number.isNaN(d.getTime())) continue
    const k = dayKey(d)
    const cur = map.get(k) ?? { total: 0, count: 0 }
    cur.total += Number(t.amount) || 0
    cur.count += 1
    map.set(k, cur)
  }
  return map
}

/** 단위별 목표. 주는 월 목표 × 12 ÷ 52 (참고선), 일은 월 목표를 그대로 돌려준다(페이스선용) */
export function targetFor(goals: SpendingGoals, unit: TrendUnit | GoalUnit): number {
  const m = goals.monthly > 0 ? goals.monthly : 0
  if (unit === 'week') return m ? (m * 12) / 52 : 0
  if (unit === 'month' || unit === 'day') return m
  const ov = goals.overrides[unit]
  if (ov != null && ov > 0) return ov
  return m ? m * GOAL_MONTHS[unit] : 0
}

export interface Period {
  label: string
  start: Date
  end: Date
  total: number
  count: number
  days: number
  elapsed: number
  ratio: number
  inProgress: boolean
}

function sumRange(map: DayMap, start: Date, end: Date) {
  let total = 0
  let count = 0
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const a = map.get(dayKey(d))
    if (a) { total += a.total; count += a.count }
  }
  return { total, count }
}

function makePeriod(label: string, start: Date, end: Date, map: DayMap, today: Date): Period {
  const { total, count } = sumRange(map, start, end)
  const days = daysBetween(start, end) + 1
  const elapsed = Math.min(days, Math.max(0, daysBetween(start, today) + 1))
  return { label, start, end, total, count, days, elapsed, ratio: elapsed / days, inProgress: end > today }
}

/** 오늘이 속한 기간 하나 (진행 카드용) */
export function currentPeriod(unit: GoalUnit, map: DayMap, today: Date): Period {
  const list = buildPeriods(unit, map, today, today.getFullYear())
  return list[list.length - 1]
}

/** 차트에 그릴 기간 목록 (오래된 순). 주=12주, 월=12개월, 분기=8분기, 반기=6반기, 년=firstYear~올해 */
export function buildPeriods(unit: Exclude<TrendUnit, 'day'>, map: DayMap, today: Date, firstYear: number): Period[] {
  const out: Period[] = []
  const y = today.getFullYear()
  const m = today.getMonth()
  const yy2 = (n: number) => String(n).slice(2)
  if (unit === 'week') {
    const mon = addDays(startOfDay(today), -((today.getDay() + 6) % 7))
    for (let i = 11; i >= 0; i--) {
      const s = addDays(mon, -7 * i)
      out.push(makePeriod(`${pad(s.getMonth() + 1)}/${pad(s.getDate())}`, s, addDays(s, 6), map, today))
    }
  } else if (unit === 'month') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(y, m - i, 1)
      out.push(makePeriod(`${yy2(d.getFullYear())}.${pad(d.getMonth() + 1)}`, d, new Date(d.getFullYear(), d.getMonth() + 1, 0), map, today))
    }
  } else if (unit === 'quarter') {
    const q = Math.floor(m / 3)
    for (let i = 7; i >= 0; i--) {
      const idx = y * 4 + q - i
      const yy = Math.floor(idx / 4)
      const qq = idx % 4
      out.push(makePeriod(`${yy2(yy)} ${qq + 1}Q`, new Date(yy, qq * 3, 1), new Date(yy, qq * 3 + 3, 0), map, today))
    }
  } else if (unit === 'half') {
    const h = m < 6 ? 0 : 1
    for (let i = 5; i >= 0; i--) {
      const idx = y * 2 + h - i
      const yy = Math.floor(idx / 2)
      const hh = idx % 2
      out.push(makePeriod(`${yy2(yy)} ${hh ? '하반기' : '상반기'}`, new Date(yy, hh * 6, 1), new Date(yy, hh * 6 + 6, 0), map, today))
    }
  } else {
    for (let yy = Math.min(firstYear, y); yy <= y; yy++) {
      out.push(makePeriod(String(yy), new Date(yy, 0, 1), new Date(yy, 11, 31), map, today))
    }
  }
  return out
}

/**
 * 기간 판정.
 *  over : 기간 합계가 목표를 넘음 (진행 중이어도 이미 넘었으면 초과)
 *  warn : 진행 중이며 경과 비율만큼의 페이스를 넘음
 *  prog : 진행 중, 페이스 이내
 *  ok   : 끝난 기간, 목표 이내
 */
export function periodStatus(p: Period, target: number): PeriodStatus {
  if (!target) return 'none'
  if (p.total > target) return 'over'
  if (p.inProgress && p.total > target * p.ratio) return 'warn'
  return p.inProgress ? 'prog' : 'ok'
}

export interface DailySeries {
  labels: number[]
  daily: (number | null)[]
  cumulative: (number | null)[]
  pace: (number | null)[]
  total: number
  elapsed: number
  nDays: number
  inProgress: boolean
  count: number
}

/** 선택한 달의 일별 누적 vs 균등 배분 페이스 */
export function dailySeries(year: number, month1: number, map: DayMap, today: Date, monthlyTarget: number): DailySeries {
  const start = new Date(year, month1 - 1, 1)
  const end = new Date(year, month1, 0)
  const nDays = end.getDate()
  const labels: number[] = []
  const daily: (number | null)[] = []
  const cumulative: (number | null)[] = []
  const pace: (number | null)[] = []
  let acc = 0
  let count = 0
  for (let i = 1; i <= nDays; i++) {
    const d = new Date(year, month1 - 1, i)
    labels.push(i)
    const a = d <= today ? map.get(dayKey(d)) : undefined
    const v = d <= today ? (a?.total ?? 0) : null
    if (v != null) { acc += v; count += a?.count ?? 0 }
    daily.push(v)
    cumulative.push(v == null ? null : acc)
    pace.push(monthlyTarget ? (monthlyTarget * i) / nDays : null)
  }
  const elapsed = Math.min(nDays, Math.max(0, daysBetween(start, today) + 1))
  return { labels, daily, cumulative, pace, total: acc, elapsed, nDays, inProgress: end > today, count }
}

/** 지출 데이터가 시작되는 연도 (없으면 올해) */
export function firstYearOf(map: DayMap, today: Date): number {
  let min = today.getFullYear()
  for (const k of map.keys()) {
    const y = Number(k.slice(0, 4))
    if (y < min) min = y
  }
  return min
}
