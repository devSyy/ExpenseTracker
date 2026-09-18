<script setup lang="ts">
// 가족 구성원 관리 페이지: 가족 이름, 멤버 추가/수정/삭제/순서 변경, 활성 멤버 선택.
import { reactive, ref } from 'vue'
import {
  useFamily,
  ROLE_OPTIONS,
  roleEmoji,
  roleColor,
  type FamilyMember
} from '~/composables/useFamily'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '가족 관리 · 가계부' })

const {
  members,
  familyName,
  primaryMemberId,
  activeMemberIds,
  isActive,
  toggleActive,
  setPrimary,
  activateAll,
  setFamilyName,
  addMember,
  updateMember,
  removeMember,
  moveMember,
  resetToDefaults
} = useFamily()

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 가족 이름 편집 ──
const editingFamilyName = ref(false)
const familyNameDraft = ref('')
function startEditFamilyName() {
  editingFamilyName.value = true
  familyNameDraft.value = familyName.value
}
function commitEditFamilyName() {
  setFamilyName(familyNameDraft.value)
  editingFamilyName.value = false
  notify('ok', withBackupHint('가족 이름이 저장되었습니다'))
}
function cancelEditFamilyName() {
  editingFamilyName.value = false
}

// ── 새 멤버 추가 ──
const adding = ref(false)
const newMember = reactive({
  name: '', role: '기타' as string, color: '', emoji: '', note: ''
})
function resetNew() {
  Object.assign(newMember, { name: '', role: '기타', color: '', emoji: '', note: '' })
}
function onAddMember() {
  const role = newMember.role || '기타'
  const m = addMember({
    name: newMember.name.trim() || (role !== '기타' ? role : '새 가족'),
    role,
    color: newMember.color || roleColor(role),
    emoji: newMember.emoji || roleEmoji(role),
    note: newMember.note.trim() || undefined
  })
  resetNew()
  adding.value = false
  notify('ok', withBackupHint(`'${m.name}' 멤버가 추가되었습니다`))
}

// ── 인라인 편집 ──
const editingId = ref<string | null>(null)
const editDraft = reactive<FamilyMember>({
  id: '', name: '', role: '기타', color: '', emoji: '', note: ''
})
function startEdit(m: FamilyMember) {
  editingId.value = m.id
  Object.assign(editDraft, m)
}
function cancelEdit() { editingId.value = null }
function commitEdit() {
  if (!editingId.value) return
  if (!editDraft.name.trim()) { notify('err', '이름을 입력하세요'); return }
  updateMember(editingId.value, {
    name: editDraft.name.trim(),
    role: editDraft.role,
    color: editDraft.color || roleColor(editDraft.role),
    emoji: editDraft.emoji || roleEmoji(editDraft.role),
    note: editDraft.note?.trim() || undefined
  })
  editingId.value = null
  notify('ok', withBackupHint('멤버가 수정되었습니다'))
}

function onRemove(id: string, name: string) {
  if (members.value.length <= 1) {
    notify('err', '최소 한 명의 가족 구성원은 유지되어야 합니다'); return
  }
  if (!window.confirm(`'${name}' 멤버를 삭제할까요?`)) return
  if (removeMember(id)) notify('ok', withBackupHint(`'${name}' 삭제됨`))
}

function onResetAll() {
  if (!window.confirm('가족 구성원을 기본값(남편·아내)으로 초기화할까요?')) return
  resetToDefaults()
  notify('ok', withBackupHint('기본값으로 초기화됨'))
}

// 자주 쓰는 이모지 프리셋
const EMOJI_PRESETS = ['👨', '👩', '🧒', '👧', '👦', '👴', '👵', '🐶', '🐱', '🙂', '😊', '👤']
const COLOR_PRESETS = ['#3b82f6', '#ec4899', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#f97316', '#94a3b8']
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 헤더 -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-md bg-blue-50 text-blue-600 grid place-items-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        </div>
        <h2 class="text-2xl font-bold text-slate-900">가족 관리</h2>
      </div>
      <button type="button" class="btn-secondary text-xs px-3 py-1.5" @click="onResetAll">기본값으로 초기화</button>
    </div>

    <!-- 토스트 -->
    <transition name="fade">
      <div
        v-if="toast"
        :class="[
          'fixed top-6 right-6 z-50 px-4 py-2 rounded-lg shadow text-sm whitespace-pre-line max-w-sm leading-relaxed',
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        ]"
      >{{ toast.text }}</div>
    </transition>

    <!-- 가족 이름 -->
    <section class="card">
      <h3 class="font-semibold text-slate-900 mb-2">가족 이름</h3>
      <p class="text-xs text-slate-500 mb-3">사이드바 상단에 표시됩니다.</p>
      <div class="flex items-center gap-2">
        <template v-if="editingFamilyName">
          <input
            v-model="familyNameDraft"
            type="text"
            class="form-input-sm flex-1 max-w-md"
            placeholder="우리 가족"
            @keydown.enter="commitEditFamilyName"
            @keydown.esc="cancelEditFamilyName"
          />
          <button type="button" class="btn-mini-primary" @click="commitEditFamilyName">저장</button>
          <button type="button" class="btn-mini" @click="cancelEditFamilyName">취소</button>
        </template>
        <template v-else>
          <span class="text-base font-bold text-slate-900">{{ familyName }}</span>
          <button type="button" class="btn-mini" @click="startEditFamilyName">편집</button>
        </template>
      </div>
    </section>

    <!-- 가족 구성원 -->
    <section class="card">
      <header class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 class="font-semibold text-slate-900">가족 구성원</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            <b class="text-slate-700">{{ members.length }}명</b> 등록 · 활성 멤버는 사이드바에서 강조됩니다.
          </p>
        </div>
        <button v-if="!adding" type="button" class="btn-primary text-xs px-3 py-1.5" @click="adding = true">+ 가족 추가</button>
      </header>

      <!-- 추가 폼 -->
      <div v-if="adding" class="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50/60 space-y-2">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input v-model="newMember.name" type="text" placeholder="이름" class="form-input-sm" />
          <select v-model="newMember.role" class="form-input-sm">
            <option v-for="r in ROLE_OPTIONS" :key="r" :value="r">{{ roleEmoji(r) }} {{ r }}</option>
          </select>
          <input v-model="newMember.note" type="text" placeholder="비고 (선택)" class="form-input-sm" />
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <div class="flex items-center gap-1">
            <span class="text-xs text-slate-500 mr-1">아바타:</span>
            <button
              v-for="e in EMOJI_PRESETS"
              :key="e"
              type="button"
              :class="['emoji-btn', newMember.emoji === e ? 'emoji-btn-active' : '']"
              @click="newMember.emoji = e"
            >{{ e }}</button>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-xs text-slate-500 mr-1">색상:</span>
            <button
              v-for="c in COLOR_PRESETS"
              :key="c"
              type="button"
              :class="['color-dot', newMember.color === c ? 'color-dot-active' : '']"
              :style="{ background: c }"
              @click="newMember.color = c"
            ></button>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-mini" @click="adding = false; resetNew()">취소</button>
          <button type="button" class="btn-mini-primary" @click="onAddMember">추가</button>
        </div>
      </div>

      <!-- 멤버 리스트 -->
      <ul class="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
        <li
          v-for="(m, idx) in members"
          :key="m.id"
          :class="[
            'flex items-center gap-3 px-3 py-2.5',
            primaryMemberId === m.id
              ? 'bg-blue-50/80'
              : isActive(m.id) ? 'bg-emerald-50/30' : 'bg-white hover:bg-slate-50/50'
          ]"
        >
          <!-- 정렬 -->
          <div class="flex flex-col text-slate-400 text-[10px] leading-none">
            <button
              type="button"
              class="hover:text-slate-700 disabled:opacity-30"
              :disabled="idx === 0"
              @click="moveMember(m.id, -1)"
              title="위로"
            >▲</button>
            <button
              type="button"
              class="hover:text-slate-700 disabled:opacity-30"
              :disabled="idx === members.length - 1"
              @click="moveMember(m.id, 1)"
              title="아래로"
            >▼</button>
          </div>

          <!-- 인라인 편집 -->
          <template v-if="editingId === m.id">
            <span
              class="avatar-lg flex-shrink-0"
              :style="{ background: editDraft.color || roleColor(editDraft.role) }"
            >{{ editDraft.emoji || roleEmoji(editDraft.role) }}</span>
            <div class="flex-1 grid grid-cols-1 md:grid-cols-3 gap-1.5">
              <input v-model="editDraft.name" type="text" class="form-input-sm" placeholder="이름" />
              <select v-model="editDraft.role" class="form-input-sm">
                <option v-for="r in ROLE_OPTIONS" :key="r" :value="r">{{ roleEmoji(r) }} {{ r }}</option>
              </select>
              <input v-model="editDraft.note" type="text" class="form-input-sm" placeholder="비고" />
              <div class="md:col-span-3 flex flex-wrap items-center gap-2">
                <div class="flex items-center gap-1">
                  <span class="text-[11px] text-slate-500 mr-0.5">아바타:</span>
                  <button
                    v-for="e in EMOJI_PRESETS"
                    :key="e"
                    type="button"
                    :class="['emoji-btn', editDraft.emoji === e ? 'emoji-btn-active' : '']"
                    @click="editDraft.emoji = e"
                  >{{ e }}</button>
                </div>
                <div class="flex items-center gap-1">
                  <span class="text-[11px] text-slate-500 mr-0.5">색상:</span>
                  <button
                    v-for="c in COLOR_PRESETS"
                    :key="c"
                    type="button"
                    :class="['color-dot', editDraft.color === c ? 'color-dot-active' : '']"
                    :style="{ background: c }"
                    @click="editDraft.color = c"
                  ></button>
                </div>
              </div>
            </div>
            <div class="flex gap-1">
              <button type="button" class="btn-mini-primary" @click="commitEdit">저장</button>
              <button type="button" class="btn-mini" @click="cancelEdit">취소</button>
            </div>
          </template>

          <!-- 보기 모드 -->
          <template v-else>
            <span
              class="avatar-lg flex-shrink-0"
              :style="{ background: m.color || roleColor(m.role), color: '#fff' }"
            >{{ m.emoji || roleEmoji(m.role) }}</span>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="font-semibold text-slate-900">{{ m.name }}</span>
                <span class="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{{ m.role }}</span>
                <span v-if="primaryMemberId === m.id" class="text-[10px] px-1.5 py-0.5 rounded bg-blue-600 text-white">주 멤버</span>
                <span v-if="isActive(m.id)" class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">활성 (합산)</span>
              </div>
              <div v-if="m.note" class="text-[11px] text-slate-500 mt-0.5 truncate">{{ m.note }}</div>
            </div>
            <div class="flex gap-1.5 flex-wrap">
              <label class="flex items-center gap-1 text-xs text-slate-600 select-none cursor-pointer" :title="primaryMemberId === m.id ? '주 멤버는 항상 활성' : '활성/비활성 토글'">
                <input
                  type="checkbox"
                  :checked="isActive(m.id)"
                  :disabled="primaryMemberId === m.id"
                  @change="toggleActive(m.id)"
                  class="rounded"
                />
                <span>합산</span>
              </label>
              <button
                v-if="primaryMemberId !== m.id"
                type="button"
                class="btn-mini"
                title="이 멤버를 신규 입력 시 자동 태깅되는 주 멤버로 설정"
                @click="setPrimary(m.id)"
              >주 멤버로</button>
              <button type="button" class="btn-mini" @click="startEdit(m)">편집</button>
              <button type="button" class="btn-mini-danger" @click="onRemove(m.id, m.name)">삭제</button>
            </div>
          </template>
        </li>
      </ul>
    </section>

    <!-- 안내 -->
    <section class="card bg-slate-50 border-slate-200">
      <h4 class="text-sm font-semibold text-slate-700">사용 가이드</h4>
      <ul class="mt-2 text-xs text-slate-600 space-y-1 list-disc list-inside">
        <li>각 가족 구성원의 거래·지출·카드·대출·납입 이력은 멤버별로 태깅되어 분리 저장됩니다.</li>
        <li><b>합산 체크박스</b>로 활성화한 멤버들의 데이터가 모든 화면(거래내역·차트·KPI)에서 합쳐져 표시됩니다.</li>
        <li><b>주 멤버</b>는 새로 입력하는 거래/카드/대출/납입의 자동 태깅 대상이고 항상 활성입니다.</li>
        <li>예: 남편만 체크 = 남편 데이터, 둘 다 체크 = 가족 합산. 자녀를 추가하고 체크하면 자녀 지출까지 함께 합산.</li>
        <li>멤버를 다른 멤버로 바꾸려면 항목 우측 "주 멤버로" 버튼을 누르세요. 기존 데이터의 소속은 변경되지 않습니다.</li>
        <li>최소 한 명의 멤버는 유지되어야 합니다. 변경 사항은 자동 저장됩니다.</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.form-input-sm {
  @apply rounded-md border-slate-300 text-xs py-1.5 focus:border-brand-500 focus:ring-brand-500;
}
.btn-primary {
  @apply px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700;
}
.btn-secondary {
  @apply px-4 py-2 rounded-md border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50;
}
.btn-mini {
  @apply px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-600 text-xs hover:bg-slate-50;
}
.btn-mini-primary {
  @apply px-2 py-0.5 rounded bg-brand-600 text-white text-xs hover:bg-brand-700;
}
.btn-mini-danger {
  @apply px-2 py-0.5 rounded border border-rose-200 bg-white text-rose-600 text-xs hover:bg-rose-50;
}
.avatar-lg {
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  display: grid;
  place-items: center;
  font-size: 18px;
  line-height: 1;
}
.emoji-btn {
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid rgb(226 232 240);
  background: #fff;
  font-size: 14px;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 0.12s ease;
}
.emoji-btn:hover { background: rgb(248 250 252); }
.emoji-btn-active {
  border-color: rgb(37 99 235);
  background: rgb(239 246 255);
}
.color-dot {
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  border: 2px solid #fff;
  box-shadow: 0 0 0 1px rgb(226 232 240);
  cursor: pointer;
}
.color-dot-active {
  box-shadow: 0 0 0 2px rgb(15 23 42);
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
