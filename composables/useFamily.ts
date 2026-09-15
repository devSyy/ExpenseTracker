// 가족 구성원 컴포저블.
// primaryMemberId(새 항목 작성 시 자동 태깅) + activeMemberIds(화면 합산 대상) 관리.
import { computed } from 'vue'
import {
  familyRepo,
  defaultFamilyState,
  ROLE_OPTIONS,
  roleEmoji,
  roleColor,
  type FamilyMember,
  type FamilyRole,
  type FamilyState
} from '~/repositories/familyRepository'

export type { FamilyMember, FamilyRole, FamilyState }
export { ROLE_OPTIONS, roleEmoji, roleColor }

const state = familyRepo.state

const members = computed(() => state.value.members)
const familyName = computed(() => state.value.familyName)

const primaryMemberId = computed<string | null>(() => state.value.primaryMemberId)
/**
 * 화면 표시/업로드 대상이 되는 활성 멤버 ID 목록.
 * 빈 배열은 "선택된 가족 없음"을 의미하며, 이 경우 업로드가 비활성화되고 표시할 데이터도 없다.
 */
const activeMemberIds = computed<string[]>(() => state.value.activeMemberIds)
const activeMembers = computed<FamilyMember[]>(() =>
  state.value.members.filter((m) => activeMemberIds.value.includes(m.id))
)
const hasActiveMember = computed<boolean>(() => activeMemberIds.value.length > 0)
const primaryMember = computed<FamilyMember | null>(() =>
  state.value.members.find((m) => m.id === state.value.primaryMemberId) ?? state.value.members[0] ?? null
)

/**
 * 업로드/저장의 실제 대상이 되는 멤버 ID.
 * - 활성 멤버가 없으면 null (업로드 비활성화)
 * - 주 멤버가 활성이면 주 멤버
 * - 그 외에는 활성 멤버 중 첫 번째
 */
const uploadTargetMemberId = computed<string | null>(() => {
  const ids = activeMemberIds.value
  if (ids.length === 0) return null
  const primary = state.value.primaryMemberId
  if (primary && ids.includes(primary)) return primary
  return ids[0] ?? null
})
const uploadTargetMember = computed<FamilyMember | null>(() =>
  state.value.members.find((m) => m.id === uploadTargetMemberId.value) ?? null
)

function memberName(id: string | null | undefined): string {
  if (!id) return ''
  return state.value.members.find((m) => m.id === id)?.name ?? ''
}

/** activeMemberIds.set: 멤버 ID 집합 (필터/합산 시 사용) */
const activeMemberSet = computed(() => new Set(activeMemberIds.value))

function uid() {
  return 'm_' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
}

function setFamilyName(name: string) {
  const v = name.trim() || '우리 가족'
  state.value = { ...state.value, familyName: v }
}

function setPrimary(id: string) {
  if (!state.value.members.some((m) => m.id === id)) return
  // primary는 항상 활성에 포함
  const active = state.value.activeMemberIds.includes(id)
    ? state.value.activeMemberIds
    : [...state.value.activeMemberIds, id]
  state.value = { ...state.value, primaryMemberId: id, activeMemberIds: active }
}

function toggleActive(id: string) {
  if (!state.value.members.some((m) => m.id === id)) return
  const active = state.value.activeMemberIds
  if (active.includes(id)) {
    // 주 멤버도 해제 가능하다. 전원 해제 시 = "선택된 가족 없음" (업로드 비활성화)
    state.value = { ...state.value, activeMemberIds: active.filter((x) => x !== id) }
  } else {
    state.value = { ...state.value, activeMemberIds: [...active, id] }
  }
}

/** 여러 명이 선택된 상태에서 업로드/저장 대상만 바꾼다 (선택 집합은 유지). */
function setUploadTarget(id: string) {
  if (!state.value.members.some((m) => m.id === id)) return
  const active = state.value.activeMemberIds.includes(id)
    ? state.value.activeMemberIds
    : [...state.value.activeMemberIds, id]
  state.value = { ...state.value, primaryMemberId: id, activeMemberIds: active }
}

function deactivateAll() {
  state.value = { ...state.value, activeMemberIds: [] }
}

function activateAll() {
  state.value = { ...state.value, activeMemberIds: state.value.members.map((m) => m.id) }
}

function activateOnly(id: string) {
  if (!state.value.members.some((m) => m.id === id)) return
  state.value = { ...state.value, primaryMemberId: id, activeMemberIds: [id] }
}

function isActive(id: string): boolean {
  return activeMemberIds.value.includes(id)
}

function addMember(input: Partial<Omit<FamilyMember, 'id'>>): FamilyMember {
  const role = (input.role as string) || '기타'
  const member: FamilyMember = {
    id: uid(),
    name: (input.name?.trim()) || (role !== '기타' ? role : '새 가족'),
    role,
    color: input.color || roleColor(role),
    emoji: input.emoji || roleEmoji(role),
    note: input.note
  }
  // 새 멤버는 기본으로 활성에 포함
  state.value = {
    ...state.value,
    members: [...state.value.members, member],
    activeMemberIds: [...state.value.activeMemberIds, member.id]
  }
  return member
}

function updateMember(id: string, patch: Partial<FamilyMember>): boolean {
  const idx = state.value.members.findIndex((m) => m.id === id)
  if (idx === -1) return false
  const next = state.value.members.slice()
  next[idx] = { ...next[idx], ...patch }
  state.value = { ...state.value, members: next }
  return true
}

function removeMember(id: string): boolean {
  if (state.value.members.length <= 1) return false
  const nextMembers = state.value.members.filter((m) => m.id !== id)
  let primary = state.value.primaryMemberId
  if (primary === id) primary = nextMembers[0]?.id ?? null
  const nextActive = state.value.activeMemberIds.filter((x) => x !== id)
  state.value = {
    ...state.value,
    members: nextMembers,
    primaryMemberId: primary,
    activeMemberIds: nextActive.length > 0 ? nextActive : (primary ? [primary] : [])
  }
  return true
}

function moveMember(id: string, direction: -1 | 1) {
  const idx = state.value.members.findIndex((m) => m.id === id)
  if (idx === -1) return
  const target = idx + direction
  if (target < 0 || target >= state.value.members.length) return
  const next = state.value.members.slice()
  ;[next[idx], next[target]] = [next[target], next[idx]]
  state.value = { ...state.value, members: next }
}

function resetToDefaults() {
  state.value = defaultFamilyState()
}

/** 항목의 memberId를 active 필터에 통과시키는 헬퍼. memberId 없으면 primary 소속으로 간주. */
function isMemberActive(memberId: string | null | undefined): boolean {
  const id = memberId ?? state.value.primaryMemberId ?? ''
  return activeMemberSet.value.has(id)
}

export function useFamily() {
  return {
    state,
    members,
    familyName,
    primaryMember,
    primaryMemberId,
    activeMembers,
    activeMemberIds,
    activeMemberSet,
    hasActiveMember,
    uploadTargetMemberId,
    uploadTargetMember,
    memberName,
    isActive,
    isMemberActive,
    setFamilyName,
    setPrimary,
    setUploadTarget,
    toggleActive,
    activateAll,
    activateOnly,
    deactivateAll,
    addMember,
    updateMember,
    removeMember,
    moveMember,
    resetToDefaults,
    ROLE_OPTIONS,
    roleEmoji,
    roleColor
  }
}
