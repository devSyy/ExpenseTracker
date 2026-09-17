// 계약 관리 컴포저블 — Repository 위에 CRUD와 날짜 파생 정보를 얹은 레이어.
// 영속화/검증은 repositories/contractsRepository가 담당한다.
import { computed } from 'vue'
import {
  contractsRepo,
  CONTRACT_CYCLES,
  CONTRACT_KINDS,
  type Contract,
  type ContractCycle,
  type ContractKind
} from '~/repositories/contractsRepository'
import { daysUntil, elapsedRatio, makeId, parseYmd, todayStart, toYmd } from '~/utils/schedule'

const contracts = contractsRepo.state

/** 만료 임박으로 볼 기본 기간 (통보 기한이 따로 없는 계약에 적용) */
export const DEFAULT_SOON_DAYS = 30

export type ContractStatus = '예정' | '진행중' | '임박' | '만료' | '해지'

/** 계약 + 날짜에서 파생된 정보. 화면은 이 형태만 본다 */
export interface ContractView {
  contract: Contract
  status: ContractStatus
  /** 종료일까지 남은 일수. 무기한이면 null */
  daysLeft: number | null
  /** 갱신·해지 통보 기한 날짜 (종료일 − noticeDays). 없으면 null */
  noticeDate: string | null
  /** 통보 기한까지 남은 일수 */
  noticeDaysLeft: number | null
  /** 계약 경과율 0..1. 무기한이면 null */
  progress: number | null
  /** 월 환산 금액 — 주기가 다른 계약을 한 줄로 비교하기 위한 값 */
  monthlyAmount: number | null
}

/**
 * 주기당 금액 → 월 환산.
 * '일시'는 반복 지출이 아니므로 월 환산하지 않는다(null). 월 합계를 부풀리면 안 된다.
 */
export function toMonthlyAmount(amount: number | null, cycle: ContractCycle): number | null {
  if (amount === null || !Number.isFinite(amount)) return null
  switch (cycle) {
    case '월': return amount
    case '분기': return amount / 3
    case '반기': return amount / 6
    case '연': return amount / 12
    case '일시': return null
  }
}

/** 상태 판정 — 해지 > 만료 > 예정 > 임박 > 진행중 순으로 본다 */
function statusOf(c: Contract, daysLeft: number | null, noticeDaysLeft: number | null): ContractStatus {
  if (c.terminated) return '해지'
  if (daysLeft !== null && daysLeft < 0) return '만료'

  const start = daysUntil(c.startDate)
  if (start !== null && start > 0) return '예정'

  // 통보 기한이 지정돼 있으면 그 기한이 임박 기준이다. 없으면 기본 30일.
  if (noticeDaysLeft !== null && noticeDaysLeft <= 0 && daysLeft !== null && daysLeft >= 0) return '임박'
  if (daysLeft !== null && daysLeft <= (c.noticeDays ?? DEFAULT_SOON_DAYS)) return '임박'
  return '진행중'
}

function toView(c: Contract): ContractView {
  const daysLeft = c.endDate ? daysUntil(c.endDate) : null

  let noticeDate: string | null = null
  let noticeDaysLeft: number | null = null
  if (c.endDate && c.noticeDays !== null && c.noticeDays > 0) {
    const end = parseYmd(c.endDate)
    if (end) {
      const d = new Date(end)
      d.setDate(d.getDate() - c.noticeDays)
      noticeDate = toYmd(d)
      noticeDaysLeft = daysUntil(noticeDate)
    }
  }

  return {
    contract: c,
    status: statusOf(c, daysLeft, noticeDaysLeft),
    daysLeft,
    noticeDate,
    noticeDaysLeft,
    progress: elapsedRatio(c.startDate, c.endDate),
    monthlyAmount: toMonthlyAmount(c.amount, c.cycle)
  }
}

/** 전체 계약의 파생 정보. 다가오는 종료일 순으로 정렬한다 */
const views = computed<ContractView[]>(() => {
  const list = contracts.value.map(toView)
  const rank: Record<ContractStatus, number> = { 임박: 0, 진행중: 1, 예정: 2, 만료: 3, 해지: 4 }
  return list.sort((a, b) => {
    // 신경 써야 하는 것(임박)이 위로, 그 안에서는 종료일이 가까운 순
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status]
    const al = a.daysLeft ?? Number.MAX_SAFE_INTEGER   // 무기한은 맨 뒤
    const bl = b.daysLeft ?? Number.MAX_SAFE_INTEGER
    if (al !== bl) return al - bl
    return a.contract.title.localeCompare(b.contract.title, 'ko-KR')
  })
})

const activeViews = computed(() => views.value.filter((v) => v.status === '진행중' || v.status === '임박'))
const soonViews = computed(() => views.value.filter((v) => v.status === '임박'))

/** 요약 — 화면 상단 KPI용 */
const summary = computed(() => {
  const active = activeViews.value
  const monthlyTotal = active.reduce((s, v) => s + (v.monthlyAmount ?? 0), 0)
  return {
    total: contracts.value.length,
    active: active.length,
    soon: soonViews.value.length,
    expired: views.value.filter((v) => v.status === '만료').length,
    terminated: views.value.filter((v) => v.status === '해지').length,
    /** 진행 중 계약의 월 환산 합계 — '일시' 계약은 제외된다 */
    monthlyTotal,
    /** 통보 기한이 이미 지났거나 오늘인 진행 중 계약 */
    noticeDue: active.filter((v) => v.noticeDaysLeft !== null && v.noticeDaysLeft <= 0).length
  }
})

// ── CRUD ──

export interface ContractInput {
  title: string
  counterparty?: string
  kind?: ContractKind
  startDate?: string
  endDate?: string
  amount?: number | null
  cycle?: ContractCycle
  autoRenew?: boolean
  noticeDays?: number | null
  terminated?: boolean
  note?: string
}

export interface MutationResult {
  ok: boolean
  id?: string
  reason?: string
}

function validate(input: ContractInput): string | null {
  if (!input.title?.trim()) return '계약명을 입력하세요'
  if (input.startDate && !parseYmd(input.startDate)) return '시작일 형식이 올바르지 않습니다'
  if (input.endDate && !parseYmd(input.endDate)) return '종료일 형식이 올바르지 않습니다'
  if (input.startDate && input.endDate) {
    const s = parseYmd(input.startDate)
    const e = parseYmd(input.endDate)
    if (s && e && e.getTime() < s.getTime()) return '종료일이 시작일보다 앞설 수 없습니다'
  }
  if (input.amount !== undefined && input.amount !== null) {
    if (!Number.isFinite(input.amount) || input.amount < 0) return '금액은 0 이상이어야 합니다'
  }
  if (input.noticeDays !== undefined && input.noticeDays !== null) {
    if (!Number.isInteger(input.noticeDays) || input.noticeDays < 0) return '통보 기한은 0 이상의 일수여야 합니다'
  }
  return null
}

function addContract(input: ContractInput): MutationResult {
  const err = validate(input)
  if (err) return { ok: false, reason: err }

  const now = new Date().toISOString()
  const c: Contract = {
    id: makeId('c'),
    title: input.title.trim(),
    counterparty: input.counterparty?.trim() ?? '',
    kind: input.kind ?? '기타',
    startDate: input.startDate ?? '',
    endDate: input.endDate ?? '',
    amount: input.amount ?? null,
    cycle: input.cycle ?? '월',
    autoRenew: input.autoRenew ?? false,
    noticeDays: input.noticeDays ?? null,
    terminated: input.terminated ?? false,
    note: input.note?.trim() ?? '',
    createdAt: now,
    updatedAt: now
  }
  contracts.value = [...contracts.value, c]
  return { ok: true, id: c.id }
}

function updateContract(id: string, patch: ContractInput): MutationResult {
  const idx = contracts.value.findIndex((c) => c.id === id)
  if (idx === -1) return { ok: false, reason: '대상 계약을 찾을 수 없습니다' }

  const merged: ContractInput = { ...contracts.value[idx], ...patch }
  const err = validate(merged)
  if (err) return { ok: false, reason: err }

  const next = [...contracts.value]
  next[idx] = {
    ...next[idx],
    ...patch,
    title: merged.title.trim(),
    counterparty: merged.counterparty?.trim() ?? '',
    note: merged.note?.trim() ?? '',
    updatedAt: new Date().toISOString()
  }
  contracts.value = next
  return { ok: true, id }
}

function removeContract(id: string): MutationResult {
  const next = contracts.value.filter((c) => c.id !== id)
  if (next.length === contracts.value.length) return { ok: false, reason: '대상 계약을 찾을 수 없습니다' }
  contracts.value = next
  return { ok: true, id }
}

/** 해지 토글 — 목록에서 한 번에 처리할 수 있게 별도 액션으로 둔다 */
function setTerminated(id: string, terminated: boolean): MutationResult {
  return updateContract(id, { terminated } as ContractInput)
}

function findContract(id: string): Contract | undefined {
  return contracts.value.find((c) => c.id === id)
}

/** 계약 입력 폼이 다루는 값 — 모든 필드가 채워진 형태 */
export interface ContractDraft {
  title: string
  counterparty: string
  kind: ContractKind
  startDate: string
  endDate: string
  amount: number | null
  cycle: ContractCycle
  autoRenew: boolean
  noticeDays: number | null
  terminated: boolean
  note: string
}

/** 새 계약 폼의 초기값 — 시작일은 오늘 */
export function emptyContractDraft(): ContractDraft {
  return {
    title: '',
    counterparty: '',
    kind: '기타',
    startDate: toYmd(todayStart()),
    endDate: '',
    amount: null,
    cycle: '월',
    autoRenew: false,
    noticeDays: null,
    terminated: false,
    note: ''
  }
}

export function useContracts() {
  return {
    contracts,
    views,
    activeViews,
    soonViews,
    summary,
    addContract,
    updateContract,
    removeContract,
    setTerminated,
    findContract,
    toMonthlyAmount,
    CONTRACT_KINDS,
    CONTRACT_CYCLES,
    DEFAULT_SOON_DAYS
  }
}

export type { Contract, ContractKind, ContractCycle }
