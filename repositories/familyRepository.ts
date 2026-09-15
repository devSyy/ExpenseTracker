// 가족 구성원 리포지토리.
//
// 모델:
//  - primaryMemberId: 새 항목 작성 시 자동으로 태깅되는 "기본 멤버"
//  - activeMemberIds: 화면에 데이터를 표시할 멤버들 (다중 선택, 합산 표시)
//
// 데이터(거래/지출 등)는 항목별 memberId로 태깅되어 활성 멤버 합산이 가능하다.
import { createRepository } from './createRepository'

export type FamilyRole = '남편' | '아내' | '자녀' | '부모' | '본인' | '기타'

export interface FamilyMember {
  id: string
  name: string
  role: FamilyRole | string
  color: string
  emoji?: string
  note?: string
}

export interface FamilyState {
  familyName: string
  members: FamilyMember[]
  /** 신규 항목이 자동 태깅되는 주 멤버 (writes 대상) */
  primaryMemberId: string | null
  /** 화면 표시(필터/합산) 대상 멤버 집합. 비어있으면 [primary]로 간주. */
  activeMemberIds: string[]
}

const KEY = 'family:state:v1'

export const ROLE_OPTIONS: FamilyRole[] = ['남편', '아내', '자녀', '부모', '본인', '기타']

export function roleEmoji(role: string): string {
  switch (role) {
    case '남편': return '👨'
    case '아내': return '👩'
    case '자녀': return '🧒'
    case '부모': return '👴'
    case '본인': return '🙂'
    default: return '👤'
  }
}

export function roleColor(role: string): string {
  switch (role) {
    case '남편': return '#3b82f6'
    case '아내': return '#ec4899'
    case '자녀': return '#10b981'
    case '부모': return '#f59e0b'
    case '본인': return '#8b5cf6'
    default: return '#94a3b8'
  }
}

function defaultFamilyState(): FamilyState {
  const husband: FamilyMember = {
    id: 'm_husband', name: '남편', role: '남편',
    color: roleColor('남편'), emoji: roleEmoji('남편')
  }
  const wife: FamilyMember = {
    id: 'm_wife', name: '아내', role: '아내',
    color: roleColor('아내'), emoji: roleEmoji('아내')
  }
  return {
    familyName: '우리 가족',
    members: [husband, wife],
    primaryMemberId: husband.id,
    activeMemberIds: [husband.id, wife.id]  // 기본은 둘 다 활성 (합산 표시)
  }
}

function isValidMember(x: unknown): x is FamilyMember {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.id === 'string' && typeof o.name === 'string'
}

export const familyRepo = createRepository<FamilyState>({
  key: KEY,
  default: defaultFamilyState,
  migrate: (raw) => {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as any
    const def = defaultFamilyState()
    const members: FamilyMember[] = Array.isArray(r.members) ? r.members.filter(isValidMember) : def.members
    if (members.length === 0) members.push(...def.members)

    // 구버전: activeMemberId(단수) → primaryMemberId + activeMemberIds 마이그레이션
    let primary: string | null = null
    if (typeof r.primaryMemberId === 'string' && members.some((m) => m.id === r.primaryMemberId)) {
      primary = r.primaryMemberId
    } else if (typeof r.activeMemberId === 'string' && members.some((m) => m.id === r.activeMemberId)) {
      primary = r.activeMemberId
    } else {
      primary = members[0]?.id ?? null
    }

    let active: string[]
    if (Array.isArray(r.activeMemberIds)) {
      // 빈 배열은 "전원 비활성(선택 없음)"이라는 사용자의 명시적 상태이므로 그대로 유지한다.
      // (선택 없음 = 업로드 비활성화 / 표시할 데이터 없음)
      active = r.activeMemberIds.filter((id: unknown) =>
        typeof id === 'string' && members.some((m) => m.id === id)
      )
    } else {
      // 구버전 단일 활성 멤버 → 모든 멤버 합산을 기본으로 (사용자 의도: 모든 데이터 합산)
      active = members.map((m) => m.id)
    }

    return {
      familyName: typeof r.familyName === 'string' ? r.familyName : def.familyName,
      members,
      primaryMemberId: primary,
      activeMemberIds: active
    }
  }
})

export { defaultFamilyState }
