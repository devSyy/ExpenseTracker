// 기념일 관리 리포지토리.
import { createRepository } from './createRepository'

/** 기념일 종류 */
export const ANNIVERSARY_KINDS = ['생일', '결혼기념일', '기일', '기념일', '기타'] as const
export type AnniversaryKind = typeof ANNIVERSARY_KINDS[number]

export interface Anniversary {
  id: string
  /** 기념일 이름 */
  title: string
  /** 원래 날짜 'YYYY-MM-DD' — 생일이면 태어난 날 */
  date: string
  kind: AnniversaryKind
  /**
   * 매년 반복 여부.
   * true면 매년 같은 월·일에 돌아온다(기본). false면 지정된 그 날 한 번뿐이다.
   */
  repeatYearly: boolean
  /** 며칠 전부터 '임박'으로 표시할지. 없으면 null(기본값 사용) */
  remindDays: number | null
  /** 관련 인물 — 누구의 기념일인지 */
  person: string
  note: string
  createdAt: string
  updatedAt: string
}

const KEY = 'anniversaries:state:v1'

function normalizeKind(raw: unknown): AnniversaryKind {
  return (ANNIVERSARY_KINDS as readonly string[]).includes(raw as string)
    ? (raw as AnniversaryKind)
    : '기념일'
}

function normalizeYmd(raw: unknown): string {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : ''
}

function normalizeNumber(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function normalizeAnniversary(raw: unknown): Anniversary | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  const date = normalizeYmd(o.date)
  // 이름이나 날짜가 없으면 기념일로서 의미가 없다
  if (!title || !date) return null
  const now = new Date().toISOString()
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `a-${Math.random().toString(36).slice(2, 10)}`,
    title,
    date,
    kind: normalizeKind(o.kind),
    // 구버전 데이터에 필드가 없으면 '매년 반복'이 자연스러운 기본값이다
    repeatYearly: o.repeatYearly === undefined ? true : Boolean(o.repeatYearly),
    remindDays: normalizeNumber(o.remindDays),
    person: typeof o.person === 'string' ? o.person.trim() : '',
    note: typeof o.note === 'string' ? o.note : '',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now
  }
}

function defaultAnniversaries(): Anniversary[] {
  return []
}

export const anniversariesRepo = createRepository<Anniversary[]>({
  key: KEY,
  default: defaultAnniversaries,
  validator: (x): x is Anniversary[] =>
    Array.isArray(x) &&
    x.every((y) => {
      if (!y || typeof y !== 'object') return false
      const o = y as Record<string, unknown>
      return typeof o.id === 'string'
        && typeof o.title === 'string' && o.title.trim().length > 0
        && typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.date)
        && typeof o.kind === 'string'
        && typeof o.repeatYearly === 'boolean'
    }),
  migrate: (raw) => {
    if (!Array.isArray(raw)) return null
    return raw.map(normalizeAnniversary).filter((x): x is Anniversary => x !== null)
  }
})

export { defaultAnniversaries, normalizeAnniversary }
