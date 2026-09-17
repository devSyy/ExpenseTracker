// 계약 관리 리포지토리.
// 기존 도메인과 같은 형태다: 저장 키 하나 + createRepository + 검증/마이그레이션.
import { createRepository } from './createRepository'

/** 계약 유형 */
export const CONTRACT_KINDS = ['임대차', '보험', '통신', '구독', '금융', '용역', '기타'] as const
export type ContractKind = typeof CONTRACT_KINDS[number]

/** 결제 주기 */
export const CONTRACT_CYCLES = ['월', '분기', '반기', '연', '일시'] as const
export type ContractCycle = typeof CONTRACT_CYCLES[number]

export interface Contract {
  id: string
  /** 계약명 */
  title: string
  /** 상대방 — 임대인·보험사·통신사 등 */
  counterparty: string
  kind: ContractKind
  /** 계약 시작일 'YYYY-MM-DD' */
  startDate: string
  /** 계약 종료일. 빈 문자열이면 **무기한** */
  endDate: string
  /** 결제 금액 (주기당). 없으면 null */
  amount: number | null
  cycle: ContractCycle
  /** 자동 갱신 여부 */
  autoRenew: boolean
  /** 갱신·해지 통보 기한 — 종료일 며칠 전까지 알려야 하는지. 없으면 null */
  noticeDays: number | null
  /** 사용자가 해지 처리한 계약 (날짜와 무관하게 종료 취급) */
  terminated: boolean
  note: string
  createdAt: string
  updatedAt: string
}

const KEY = 'contracts:state:v1'

function normalizeKind(raw: unknown): ContractKind {
  return (CONTRACT_KINDS as readonly string[]).includes(raw as string)
    ? (raw as ContractKind)
    : '기타'
}

function normalizeCycle(raw: unknown): ContractCycle {
  return (CONTRACT_CYCLES as readonly string[]).includes(raw as string)
    ? (raw as ContractCycle)
    : '월'
}

function normalizeNumber(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

function normalizeYmd(raw: unknown): string {
  return typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()) ? raw.trim() : ''
}

/** 저장된 원시 객체 → 완전한 Contract. 빠진 필드는 기본값으로 채운다 */
function normalizeContract(raw: unknown): Contract | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  // 제목 없는 계약은 목록에서 식별할 수 없으므로 버린다
  if (!title) return null
  const now = new Date().toISOString()
  return {
    id: typeof o.id === 'string' && o.id ? o.id : `c-${Math.random().toString(36).slice(2, 10)}`,
    title,
    counterparty: typeof o.counterparty === 'string' ? o.counterparty.trim() : '',
    kind: normalizeKind(o.kind),
    startDate: normalizeYmd(o.startDate),
    endDate: normalizeYmd(o.endDate),
    amount: normalizeNumber(o.amount),
    cycle: normalizeCycle(o.cycle),
    autoRenew: Boolean(o.autoRenew),
    noticeDays: normalizeNumber(o.noticeDays),
    terminated: Boolean(o.terminated),
    note: typeof o.note === 'string' ? o.note : '',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now
  }
}

/** 신규 설치는 빈 목록에서 시작한다 (샘플 데이터를 심으면 사용자가 지워야 한다) */
function defaultContracts(): Contract[] {
  return []
}

export const contractsRepo = createRepository<Contract[]>({
  key: KEY,
  default: defaultContracts,
  // 필수 필드가 온전한 배열만 그대로 신뢰하고, 아니면 migrate로 보정한다
  validator: (x): x is Contract[] =>
    Array.isArray(x) &&
    x.every((y) => {
      if (!y || typeof y !== 'object') return false
      const o = y as Record<string, unknown>
      return typeof o.id === 'string'
        && typeof o.title === 'string' && o.title.trim().length > 0
        && typeof o.cycle === 'string'
        && typeof o.kind === 'string'
        && typeof o.terminated === 'boolean'
    }),
  migrate: (raw) => {
    if (!Array.isArray(raw)) return null
    return raw.map(normalizeContract).filter((x): x is Contract => x !== null)
  }
})

export { defaultContracts, normalizeContract }
