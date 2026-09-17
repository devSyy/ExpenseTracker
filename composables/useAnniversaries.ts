// 기념일 관리 컴포저블 — Repository 위에 CRUD와 날짜 파생 정보를 얹은 레이어.
// 영속화/검증은 repositories/anniversariesRepository가 담당한다.
import { computed } from 'vue'
import {
  anniversariesRepo,
  ANNIVERSARY_KINDS,
  type Anniversary,
  type AnniversaryKind
} from '~/repositories/anniversariesRepository'
import {
  daysBetween,
  makeId,
  nextYearlyOccurrence,
  parseYmd,
  todayStart,
  toYmd
} from '~/utils/schedule'

const anniversaries = anniversariesRepo.state

/** 며칠 전부터 '임박'으로 볼지 (항목별 remindDays가 없을 때) */
export const DEFAULT_REMIND_DAYS = 14

/** 기념일 + 날짜에서 파생된 정보. 화면은 이 형태만 본다 */
export interface AnniversaryView {
  anniversary: Anniversary
  /** 다음 발생일 'YYYY-MM-DD'. 반복이 아니고 이미 지났으면 원래 날짜 */
  nextDate: string
  /** 다음 발생일까지 남은 일수 (오늘이면 0, 지난 1회성이면 음수) */
  daysLeft: number
  /** 이번에 몇 주년인지 — 원래 연도와 다음 발생 연도의 차이. 0이면 첫 해 */
  years: number
  /** remindDays 안에 들어왔는지 */
  isSoon: boolean
  /** 오늘이 바로 그 날 */
  isToday: boolean
  /** 반복이 아니면서 이미 지나간 항목 */
  isPast: boolean
}

function toView(a: Anniversary, today: Date): AnniversaryView {
  const base = parseYmd(a.date)
  const next = a.repeatYearly ? nextYearlyOccurrence(a.date, today) : base

  // 날짜는 리포지토리에서 검증되므로 여기서 null이 되는 일은 없지만, 방어적으로 처리한다
  const nextDate = next ? toYmd(next) : a.date
  const daysLeft = next ? daysBetween(today, next) : 0
  const years = base && next ? next.getFullYear() - base.getFullYear() : 0
  const remind = a.remindDays ?? DEFAULT_REMIND_DAYS

  return {
    anniversary: a,
    nextDate,
    daysLeft,
    years,
    isToday: daysLeft === 0,
    isSoon: daysLeft >= 0 && daysLeft <= remind,
    isPast: !a.repeatYearly && daysLeft < 0
  }
}

/** 전체 기념일의 파생 정보 — 다가오는 순 정렬 (지난 1회성은 맨 뒤) */
const views = computed<AnniversaryView[]>(() => {
  const today = todayStart()
  return anniversaries.value
    .map((a) => toView(a, today))
    .sort((a, b) => {
      if (a.isPast !== b.isPast) return a.isPast ? 1 : -1
      if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft
      return a.anniversary.title.localeCompare(b.anniversary.title, 'ko-KR')
    })
})

/** 아직 오지 않은(또는 오늘인) 기념일 */
const upcomingViews = computed(() => views.value.filter((v) => !v.isPast))
/** remindDays 안에 들어온 기념일 — 상단 알림용 */
const soonViews = computed(() => upcomingViews.value.filter((v) => v.isSoon))

const summary = computed(() => {
  const today = todayStart()
  const thisMonth = today.getMonth() + 1
  return {
    total: anniversaries.value.length,
    soon: soonViews.value.length,
    today: views.value.filter((v) => v.isToday).length,
    /** 이번 달에 돌아오는 기념일 수 */
    thisMonth: upcomingViews.value.filter((v) => {
      const d = parseYmd(v.nextDate)
      return d ? d.getMonth() + 1 === thisMonth && d.getFullYear() === today.getFullYear() : false
    }).length,
    /** 가장 가까운 기념일 */
    next: upcomingViews.value[0] ?? null
  }
})

/** 월별 묶음 (1..12) — 연간 달력처럼 훑어보기 위한 것 */
const byMonth = computed<Array<{ month: number; items: AnniversaryView[] }>>(() => {
  const buckets = new Map<number, AnniversaryView[]>()
  for (const v of views.value) {
    const d = parseYmd(v.nextDate)
    if (!d) continue
    const m = d.getMonth() + 1
    const arr = buckets.get(m) ?? []
    arr.push(v)
    buckets.set(m, arr)
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([month, items]) => ({
      month,
      items: items.sort((a, b) => a.nextDate.localeCompare(b.nextDate))
    }))
})

// ── CRUD ──

export interface AnniversaryInput {
  title: string
  date: string
  kind?: AnniversaryKind
  repeatYearly?: boolean
  remindDays?: number | null
  person?: string
  note?: string
}

export interface MutationResult {
  ok: boolean
  id?: string
  reason?: string
}

function validate(input: AnniversaryInput): string | null {
  if (!input.title?.trim()) return '기념일 이름을 입력하세요'
  if (!input.date?.trim()) return '날짜를 입력하세요'
  if (!parseYmd(input.date)) return '날짜 형식이 올바르지 않습니다'
  if (input.remindDays !== undefined && input.remindDays !== null) {
    if (!Number.isInteger(input.remindDays) || input.remindDays < 0) {
      return '알림 시작일은 0 이상의 일수여야 합니다'
    }
  }
  return null
}

function addAnniversary(input: AnniversaryInput): MutationResult {
  const err = validate(input)
  if (err) return { ok: false, reason: err }

  const now = new Date().toISOString()
  const a: Anniversary = {
    id: makeId('a'),
    title: input.title.trim(),
    date: input.date.trim(),
    kind: input.kind ?? '기념일',
    repeatYearly: input.repeatYearly ?? true,
    remindDays: input.remindDays ?? null,
    person: input.person?.trim() ?? '',
    note: input.note?.trim() ?? '',
    createdAt: now,
    updatedAt: now
  }
  anniversaries.value = [...anniversaries.value, a]
  return { ok: true, id: a.id }
}

function updateAnniversary(id: string, patch: Partial<AnniversaryInput>): MutationResult {
  const idx = anniversaries.value.findIndex((a) => a.id === id)
  if (idx === -1) return { ok: false, reason: '대상 기념일을 찾을 수 없습니다' }

  const merged = { ...anniversaries.value[idx], ...patch }
  const err = validate(merged)
  if (err) return { ok: false, reason: err }

  const next = [...anniversaries.value]
  next[idx] = {
    ...next[idx],
    ...patch,
    title: merged.title.trim(),
    date: merged.date.trim(),
    person: merged.person?.trim() ?? '',
    note: merged.note?.trim() ?? '',
    updatedAt: new Date().toISOString()
  }
  anniversaries.value = next
  return { ok: true, id }
}

function removeAnniversary(id: string): MutationResult {
  const next = anniversaries.value.filter((a) => a.id !== id)
  if (next.length === anniversaries.value.length) return { ok: false, reason: '대상 기념일을 찾을 수 없습니다' }
  anniversaries.value = next
  return { ok: true, id }
}

function findAnniversary(id: string): Anniversary | undefined {
  return anniversaries.value.find((a) => a.id === id)
}

/** 기념일 입력 폼이 다루는 값 */
export interface AnniversaryDraft {
  title: string
  date: string
  kind: AnniversaryKind
  repeatYearly: boolean
  remindDays: number | null
  person: string
  note: string
}

export function emptyAnniversaryDraft(): AnniversaryDraft {
  return {
    title: '',
    date: toYmd(todayStart()),
    kind: '기념일',
    repeatYearly: true,
    remindDays: null,
    person: '',
    note: ''
  }
}

export function useAnniversaries() {
  return {
    anniversaries,
    views,
    upcomingViews,
    soonViews,
    byMonth,
    summary,
    addAnniversary,
    updateAnniversary,
    removeAnniversary,
    findAnniversary,
    ANNIVERSARY_KINDS,
    DEFAULT_REMIND_DAYS
  }
}

export type { Anniversary, AnniversaryKind }
