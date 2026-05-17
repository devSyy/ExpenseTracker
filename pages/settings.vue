<script setup lang="ts">
// 카테고리·결제수단 관리 페이지.
// 모든 변경은 useTaxonomies()를 통해 reactive 상태에 반영되며 localStorage에 저장된다.
// 이름 변경/삭제 시 거래에서 사용 중인 항목은 useExpenses의 remap*로 일괄 처리한다.
import { computed, ref } from 'vue'
import { useExpenses } from '~/composables/useExpenses'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { downloadBackup, importFromJSON, type ImportStrategy } from '~/utils/backup'

useHead({ title: '카테고리·결제수단 관리 · 가계부 대시보드' })

const {
  categories,
  payments,
  addCategory,
  renameCategory,
  setCategoryFixed,
  setCategoryHidden,
  removeCategory,
  moveCategory,
  reorderCategories,
  addPayment,
  renamePayment,
  setPaymentHidden,
  removePayment,
  movePayment,
  reorderPayments,
  resetToDefaults,
  FALLBACK_CATEGORY,
  FALLBACK_PAYMENT
} = useTaxonomies()

const {
  countByCategory,
  countByPayment,
  remapCategory,
  remapPayment
} = useExpenses()

// ── 새 항목 입력 폼 ──
const newCategoryName = ref('')
const newCategoryFixed = ref(false)
const newPaymentName = ref('')

// ── 인라인 이름 편집 상태 ──
const editingCategory = ref<string | null>(null)
const editingCategoryName = ref('')
const editingPayment = ref<string | null>(null)
const editingPaymentName = ref('')

// ── 토스트 (성공/에러 알림) ──
const toast = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', msg: string) {
  toast.value = { kind, msg }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2400) as unknown as number
}

// ── 카테고리 액션 ──
function onAddCategory() {
  const r = addCategory(newCategoryName.value, newCategoryFixed.value)
  if (!r.ok) return notify('err', r.reason ?? '추가 실패')
  notify('ok', `카테고리 추가됨: ${newCategoryName.value.trim()}`)
  newCategoryName.value = ''
  newCategoryFixed.value = false
}

function startEditCategory(name: string) {
  editingCategory.value = name
  editingCategoryName.value = name
}

function commitEditCategory() {
  if (!editingCategory.value) return
  const oldName = editingCategory.value
  const newName = editingCategoryName.value.trim()
  if (!newName || newName === oldName) {
    editingCategory.value = null
    return
  }
  const r = renameCategory(oldName, newName)
  if (!r.ok) return notify('err', r.reason ?? '이름 변경 실패')
  // 거래에서 사용 중인 카테고리도 함께 갱신
  const moved = remapCategory(oldName, newName)
  notify('ok', moved > 0 ? `이름 변경됨 · 거래 ${moved}건 갱신` : '이름 변경됨')
  editingCategory.value = null
}

function cancelEditCategory() {
  editingCategory.value = null
}

function onToggleFixed(name: string, isFixed: boolean) {
  setCategoryFixed(name, isFixed)
}

function onRemoveCategory(name: string) {
  const usage = countByCategory(name)
  const msg = usage > 0
    ? `'${name}' 카테고리를 사용하는 거래가 ${usage}건 있습니다.\n해당 거래를 '${FALLBACK_CATEGORY}'로 옮긴 뒤 삭제할까요?`
    : `'${name}' 카테고리를 삭제할까요?`
  if (!window.confirm(msg)) return

  if (usage > 0) remapCategory(name, FALLBACK_CATEGORY)
  const r = removeCategory(name)
  if (!r.ok) return notify('err', r.reason ?? '삭제 실패')
  notify('ok', usage > 0 ? `삭제됨 · 거래 ${usage}건을 ${FALLBACK_CATEGORY}로 이동` : '삭제됨')
}

// ── 결제수단 액션 ──
function onAddPayment() {
  const r = addPayment(newPaymentName.value)
  if (!r.ok) return notify('err', r.reason ?? '추가 실패')
  notify('ok', `결제수단 추가됨: ${newPaymentName.value.trim()}`)
  newPaymentName.value = ''
}

function startEditPayment(name: string) {
  editingPayment.value = name
  editingPaymentName.value = name
}

function commitEditPayment() {
  if (!editingPayment.value) return
  const oldName = editingPayment.value
  const newName = editingPaymentName.value.trim()
  if (!newName || newName === oldName) {
    editingPayment.value = null
    return
  }
  const r = renamePayment(oldName, newName)
  if (!r.ok) return notify('err', r.reason ?? '이름 변경 실패')
  const moved = remapPayment(oldName, newName)
  notify('ok', moved > 0 ? `이름 변경됨 · 거래 ${moved}건 갱신` : '이름 변경됨')
  editingPayment.value = null
}

function cancelEditPayment() {
  editingPayment.value = null
}

function onRemovePayment(name: string) {
  const usage = countByPayment(name)
  const msg = usage > 0
    ? `'${name}' 결제수단을 사용하는 거래가 ${usage}건 있습니다.\n해당 거래를 '${FALLBACK_PAYMENT}'로 옮긴 뒤 삭제할까요?`
    : `'${name}' 결제수단을 삭제할까요?`
  if (!window.confirm(msg)) return

  if (usage > 0) remapPayment(name, FALLBACK_PAYMENT)
  const r = removePayment(name)
  if (!r.ok) return notify('err', r.reason ?? '삭제 실패')
  notify('ok', usage > 0 ? `삭제됨 · 거래 ${usage}건을 ${FALLBACK_PAYMENT}로 이동` : '삭제됨')
}

// ── 전체 초기화 ──
function onResetAll() {
  if (!window.confirm('카테고리와 결제수단 목록을 기본값으로 초기화할까요?\n현재 거래에 적용된 카테고리/결제수단 값 자체는 변경되지 않습니다.')) return
  resetToDefaults()
  notify('ok', '기본값으로 초기화됨')
}

// ── 가시성 토글 ──
function onToggleCategoryHidden(name: string, hidden: boolean) {
  setCategoryHidden(name, hidden)
}
function onTogglePaymentHidden(name: string, hidden: boolean) {
  setPaymentHidden(name, hidden)
}

// ── 백업: Export / Import ──
const importStrategy = ref<ImportStrategy>('replace')
const backupFileInput = ref<HTMLInputElement | null>(null)

function onExportBackup() {
  try {
    downloadBackup()
    notify('ok', '백업 파일이 다운로드되었습니다')
  } catch (e) {
    notify('err', `다운로드 실패: ${(e as Error).message}`)
  }
}

function onPickBackupFile() {
  backupFileInput.value?.click()
}

async function onBackupFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const text = await file.text()
  const result = importFromJSON(text, importStrategy.value)
  input.value = ''
  if (!result.ok) {
    notify('err', `복원 실패 · ${result.errors[0] ?? '알 수 없는 오류'}`)
    return
  }
  notify('ok', `복원 완료 · ${result.imported}개 항목 (${importStrategy.value})`)
  // 페이지 새로고침으로 모든 컴포저블이 새 데이터로 다시 로드되도록 한다
  setTimeout(() => window.location.reload(), 800)
}

// ── 카테고리 드래그앤드롭 ──
const draggedCategoryIdx = ref<number | null>(null)
const dragOverCategoryIdx = ref<number | null>(null)

function onCategoryDragStart(idx: number, event: DragEvent) {
  draggedCategoryIdx.value = idx
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(idx))
  }
}
function onCategoryDragOver(idx: number, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  if (draggedCategoryIdx.value !== null && draggedCategoryIdx.value !== idx) {
    dragOverCategoryIdx.value = idx
  }
}
function onCategoryDragLeave(idx: number) {
  if (dragOverCategoryIdx.value === idx) dragOverCategoryIdx.value = null
}
function onCategoryDrop(targetIdx: number, event: DragEvent) {
  event.preventDefault()
  const fromIdx = draggedCategoryIdx.value
  resetCategoryDragState()
  if (fromIdx === null || fromIdx === targetIdx) return
  const names = categories.value.map((c) => c.name)
  const [moved] = names.splice(fromIdx, 1)
  names.splice(targetIdx, 0, moved)
  reorderCategories(names)
  notify('ok', `'${moved}' 위치 변경됨`)
}
function onCategoryDragEnd() {
  resetCategoryDragState()
}
function resetCategoryDragState() {
  draggedCategoryIdx.value = null
  dragOverCategoryIdx.value = null
}

// ── 결제수단 드래그앤드롭 ──
const draggedPaymentIdx = ref<number | null>(null)
const dragOverPaymentIdx = ref<number | null>(null)

function onPaymentDragStart(idx: number, event: DragEvent) {
  draggedPaymentIdx.value = idx
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(idx))
  }
}
function onPaymentDragOver(idx: number, event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  if (draggedPaymentIdx.value !== null && draggedPaymentIdx.value !== idx) {
    dragOverPaymentIdx.value = idx
  }
}
function onPaymentDragLeave(idx: number) {
  if (dragOverPaymentIdx.value === idx) dragOverPaymentIdx.value = null
}
function onPaymentDrop(targetIdx: number, event: DragEvent) {
  event.preventDefault()
  const fromIdx = draggedPaymentIdx.value
  resetPaymentDragState()
  if (fromIdx === null || fromIdx === targetIdx) return
  // 새 순서 계산: from을 빼고 target 자리에 삽입
  const names = payments.value.map((p) => p.name)
  const [moved] = names.splice(fromIdx, 1)
  names.splice(targetIdx, 0, moved)
  reorderPayments(names)
  notify('ok', `'${moved}' 위치 변경됨`)
}
function onPaymentDragEnd() {
  resetPaymentDragState()
}
function resetPaymentDragState() {
  draggedPaymentIdx.value = null
  dragOverPaymentIdx.value = null
}

// ── 통계 ──
const totalCategoryUsage = computed(() =>
  categories.value.reduce((sum, c) => sum + countByCategory(c.name), 0)
)
const totalPaymentUsage = computed(() =>
  payments.value.reduce((sum, p) => sum + countByPayment(p.name), 0)
)
const visibleCategoryCount = computed(() => categories.value.filter((c) => !c.hidden).length)
const visiblePaymentCount = computed(() => payments.value.filter((p) => !p.hidden).length)
</script>

<template>
  <!-- 설정 페이지는 폼 위주라 본문을 너무 넓히지 않는 narrow shell 사용 -->
  <div class="page-shell-narrow section-gap">
    <!-- 페이지 헤더 -->
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-bold text-slate-900">카테고리 · 결제수단 관리</h2>
        <p class="text-sm text-slate-500 mt-1">
          여기서 변경한 목록은 거래내역 화면의 분류 옵션과 필터에 즉시 반영되며 브라우저에 저장됩니다.
        </p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/" class="btn-secondary">← 거래내역으로</NuxtLink>
        <button type="button" class="btn-secondary" @click="onResetAll">기본값으로 초기화</button>
      </div>
    </div>

    <!-- 토스트 -->
    <transition name="fade">
      <div
        v-if="toast"
        :class="[
          'fixed top-6 right-6 z-50 px-4 py-2 rounded-lg shadow text-sm',
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        ]"
      >
        {{ toast.msg }}
      </div>
    </transition>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- 카테고리 카드 -->
      <section class="card">
        <header class="flex items-center justify-between mb-3">
          <div>
            <h3 class="font-semibold text-slate-900">카테고리</h3>
            <p class="text-xs text-slate-500">
              {{ categories.length }}개 등록 · 활성 {{ visibleCategoryCount }}개 ·
              거래 {{ totalCategoryUsage.toLocaleString('ko-KR') }}건에 적용
            </p>
          </div>
        </header>

        <!-- 추가 폼 -->
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <input
            v-model="newCategoryName"
            type="text"
            placeholder="새 카테고리 이름"
            class="flex-1 min-w-[10rem] rounded-md border-slate-300 text-sm focus:border-brand-500 focus:ring-brand-500"
            @keydown.enter="onAddCategory"
          />
          <label class="flex items-center gap-1.5 text-xs text-slate-600 select-none">
            <input v-model="newCategoryFixed" type="checkbox" class="rounded" />
            고정비
          </label>
          <button type="button" class="btn-primary" @click="onAddCategory">추가</button>
        </div>

        <!-- 목록 -->
        <ul class="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
          <li
            v-for="(cat, idx) in categories"
            :key="cat.name"
            draggable="true"
            @dragstart="onCategoryDragStart(idx, $event)"
            @dragover="onCategoryDragOver(idx, $event)"
            @dragleave="onCategoryDragLeave(idx)"
            @drop="onCategoryDrop(idx, $event)"
            @dragend="onCategoryDragEnd"
            :class="[
              'flex items-center gap-2 px-3 py-2 hover:bg-slate-50/60 transition-colors',
              cat.hidden ? 'bg-slate-50/80 text-slate-400' : 'bg-white',
              draggedCategoryIdx === idx ? 'opacity-40' : '',
              dragOverCategoryIdx === idx && draggedCategoryIdx !== null && draggedCategoryIdx !== idx
                ? 'ring-2 ring-brand-400 ring-inset'
                : ''
            ]"
          >
            <!-- 드래그 핸들 -->
            <span
              class="drag-handle text-slate-400 cursor-grab active:cursor-grabbing select-none"
              title="드래그하여 순서 변경"
              aria-hidden="true"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.5"/>
                <circle cx="15" cy="6" r="1.5"/>
                <circle cx="9" cy="12" r="1.5"/>
                <circle cx="15" cy="12" r="1.5"/>
                <circle cx="9" cy="18" r="1.5"/>
                <circle cx="15" cy="18" r="1.5"/>
              </svg>
            </span>

            <!-- 정렬 -->
            <div class="flex flex-col text-slate-400 text-[10px] leading-none">
              <button
                type="button"
                class="hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400"
                :disabled="idx === 0"
                @click="moveCategory(cat.name, -1)"
                title="위로"
              >▲</button>
              <button
                type="button"
                class="hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400"
                :disabled="idx === categories.length - 1"
                @click="moveCategory(cat.name, 1)"
                title="아래로"
              >▼</button>
            </div>

            <!-- 이름 / 편집 -->
            <div class="flex-1 min-w-0">
              <template v-if="editingCategory === cat.name">
                <input
                  v-model="editingCategoryName"
                  type="text"
                  class="w-full rounded-md border-slate-300 text-sm focus:border-brand-500 focus:ring-brand-500"
                  @keydown.enter="commitEditCategory"
                  @keydown.esc="cancelEditCategory"
                />
              </template>
              <template v-else>
                <button
                  type="button"
                  class="text-sm text-slate-900 hover:underline truncate text-left"
                  @click="startEditCategory(cat.name)"
                  title="클릭하여 이름 변경"
                >{{ cat.name }}</button>
              </template>
            </div>

            <!-- 사용량 -->
            <span class="text-xs text-slate-400 tabular-nums whitespace-nowrap">
              {{ countByCategory(cat.name).toLocaleString('ko-KR') }}건
            </span>

            <!-- 고정/변동 토글 -->
            <label class="flex items-center gap-1 text-xs text-slate-600 select-none whitespace-nowrap">
              <input
                type="checkbox"
                :checked="cat.isFixed"
                class="rounded"
                @change="onToggleFixed(cat.name, ($event.target as HTMLInputElement).checked)"
              />
              고정비
            </label>

            <!-- 활성화 / 비활성화 토글 (체크 = 거래내역에 보임) -->
            <label
              :class="[
                'flex items-center gap-1 text-xs select-none whitespace-nowrap',
                cat.hidden ? 'text-slate-400' : 'text-emerald-700'
              ]"
              :title="cat.hidden ? '비활성화 — 거래내역에서 숨겨집니다' : '활성화 — 거래내역에 표시됩니다'"
            >
              <input
                type="checkbox"
                :checked="!cat.hidden"
                class="rounded"
                @change="onToggleCategoryHidden(cat.name, !($event.target as HTMLInputElement).checked)"
              />
              {{ cat.hidden ? '비활성화' : '활성화' }}
            </label>

            <!-- 액션 -->
            <div class="flex gap-1">
              <template v-if="editingCategory === cat.name">
                <button type="button" class="btn-mini-primary" @click="commitEditCategory">저장</button>
                <button type="button" class="btn-mini" @click="cancelEditCategory">취소</button>
              </template>
              <template v-else>
                <button type="button" class="btn-mini" @click="startEditCategory(cat.name)">이름</button>
                <button
                  type="button"
                  class="btn-mini-danger"
                  :disabled="cat.name === FALLBACK_CATEGORY"
                  :title="cat.name === FALLBACK_CATEGORY ? '폴백 카테고리는 삭제할 수 없습니다' : '삭제'"
                  @click="onRemoveCategory(cat.name)"
                >삭제</button>
              </template>
            </div>
          </li>
          <li v-if="categories.length === 0" class="px-3 py-6 text-center text-slate-400 text-sm bg-white">
            카테고리가 비어있습니다.
          </li>
        </ul>
      </section>

      <!-- 결제수단 카드 -->
      <section class="card">
        <header class="flex items-center justify-between mb-3">
          <div>
            <h3 class="font-semibold text-slate-900">결제수단</h3>
            <p class="text-xs text-slate-500">
              {{ payments.length }}개 등록 · 표시 {{ visiblePaymentCount }}개 ·
              거래 {{ totalPaymentUsage.toLocaleString('ko-KR') }}건에 적용
            </p>
          </div>
        </header>

        <!-- 추가 폼 -->
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <input
            v-model="newPaymentName"
            type="text"
            placeholder="새 결제수단 이름"
            class="flex-1 min-w-[10rem] rounded-md border-slate-300 text-sm focus:border-brand-500 focus:ring-brand-500"
            @keydown.enter="onAddPayment"
          />
          <button type="button" class="btn-primary" @click="onAddPayment">추가</button>
        </div>

        <!-- 목록 -->
        <ul class="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
          <li
            v-for="(pm, idx) in payments"
            :key="pm.name"
            draggable="true"
            @dragstart="onPaymentDragStart(idx, $event)"
            @dragover="onPaymentDragOver(idx, $event)"
            @dragleave="onPaymentDragLeave(idx)"
            @drop="onPaymentDrop(idx, $event)"
            @dragend="onPaymentDragEnd"
            :class="[
              'flex items-center gap-2 px-3 py-2 hover:bg-slate-50/60 transition-colors',
              pm.hidden ? 'bg-slate-50/80 text-slate-400' : 'bg-white',
              draggedPaymentIdx === idx ? 'opacity-40' : '',
              dragOverPaymentIdx === idx && draggedPaymentIdx !== null && draggedPaymentIdx !== idx
                ? 'ring-2 ring-brand-400 ring-inset'
                : ''
            ]"
          >
            <!-- 드래그 핸들 -->
            <span
              class="drag-handle text-slate-400 cursor-grab active:cursor-grabbing select-none"
              title="드래그하여 순서 변경"
              aria-hidden="true"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="9" cy="6" r="1.5"/>
                <circle cx="15" cy="6" r="1.5"/>
                <circle cx="9" cy="12" r="1.5"/>
                <circle cx="15" cy="12" r="1.5"/>
                <circle cx="9" cy="18" r="1.5"/>
                <circle cx="15" cy="18" r="1.5"/>
              </svg>
            </span>

            <div class="flex flex-col text-slate-400 text-[10px] leading-none">
              <button
                type="button"
                class="hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400"
                :disabled="idx === 0"
                @click="movePayment(pm.name, -1)"
                title="위로"
              >▲</button>
              <button
                type="button"
                class="hover:text-slate-700 disabled:opacity-30 disabled:hover:text-slate-400"
                :disabled="idx === payments.length - 1"
                @click="movePayment(pm.name, 1)"
                title="아래로"
              >▼</button>
            </div>

            <div class="flex-1 min-w-0">
              <template v-if="editingPayment === pm.name">
                <input
                  v-model="editingPaymentName"
                  type="text"
                  class="w-full rounded-md border-slate-300 text-sm focus:border-brand-500 focus:ring-brand-500"
                  @keydown.enter="commitEditPayment"
                  @keydown.esc="cancelEditPayment"
                />
              </template>
              <template v-else>
                <button
                  type="button"
                  class="text-sm text-slate-900 hover:underline truncate text-left"
                  @click="startEditPayment(pm.name)"
                  title="클릭하여 이름 변경"
                >{{ pm.name }}</button>
              </template>
            </div>

            <span class="text-xs text-slate-400 tabular-nums whitespace-nowrap">
              {{ countByPayment(pm.name).toLocaleString('ko-KR') }}건
            </span>

            <!-- 표시/숨김 토글 -->
            <button
              type="button"
              :class="['btn-mini', pm.hidden ? 'btn-mini-active' : '']"
              :title="pm.hidden ? '숨김 상태 — 클릭하여 표시' : '표시 상태 — 클릭하여 숨김'"
              @click="onTogglePaymentHidden(pm.name, !pm.hidden)"
            >
              {{ pm.hidden ? '숨김' : '표시' }}
            </button>

            <div class="flex gap-1">
              <template v-if="editingPayment === pm.name">
                <button type="button" class="btn-mini-primary" @click="commitEditPayment">저장</button>
                <button type="button" class="btn-mini" @click="cancelEditPayment">취소</button>
              </template>
              <template v-else>
                <button type="button" class="btn-mini" @click="startEditPayment(pm.name)">이름</button>
                <button
                  type="button"
                  class="btn-mini-danger"
                  :disabled="pm.name === FALLBACK_PAYMENT"
                  :title="pm.name === FALLBACK_PAYMENT ? '폴백 결제수단은 삭제할 수 없습니다' : '삭제'"
                  @click="onRemovePayment(pm.name)"
                >삭제</button>
              </template>
            </div>
          </li>
          <li v-if="payments.length === 0" class="px-3 py-6 text-center text-slate-400 text-sm bg-white">
            결제수단이 비어있습니다.
          </li>
        </ul>
      </section>
    </div>

    <!-- 백업 / 복원 -->
    <section class="card">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 class="font-semibold text-slate-900">백업 · 복원</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            모든 데이터(카테고리·결제수단·거래내역·자산·대출·예금적금)를 하나의 JSON으로 내보내거나 되돌립니다.
          </p>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn-secondary" @click="onExportBackup">
            <span class="inline-block mr-1">⬇</span> JSON 내보내기
          </button>
          <button type="button" class="btn-primary" @click="onPickBackupFile">
            <span class="inline-block mr-1">⬆</span> JSON 가져오기
          </button>
          <input
            ref="backupFileInput"
            type="file"
            accept="application/json,.json"
            class="hidden"
            @change="onBackupFileChange"
          />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3 text-xs">
        <span class="text-slate-500">가져오기 방식:</span>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" v-model="importStrategy" value="replace" />
          <span class="text-slate-700"><b>덮어쓰기</b> — 백업 파일의 키를 그대로 적용</span>
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" v-model="importStrategy" value="merge" />
          <span class="text-slate-700"><b>병합</b> — 기존 데이터에 추가/갱신</span>
        </label>
      </div>

      <p class="mt-3 text-[11px] text-slate-400">
        가져오기 직후 페이지가 자동으로 새로고침됩니다.
      </p>
    </section>

    <!-- 안내 박스 -->
    <section class="card bg-slate-50 border-slate-200">
      <h4 class="text-sm font-semibold text-slate-700">사용 가이드</h4>
      <ul class="mt-2 text-xs text-slate-600 space-y-1 list-disc list-inside">
        <li>카테고리 이름을 변경하면 해당 카테고리를 사용 중인 거래도 자동으로 새 이름으로 갱신됩니다.</li>
        <li>삭제 시 사용 중인 거래는 폴백 항목('{{ FALLBACK_CATEGORY }}' / '{{ FALLBACK_PAYMENT }}')으로 이동된 뒤 목록에서 제거됩니다.</li>
        <li><b>활성화/비활성화</b> 체크박스는 항목을 삭제하지 않고 거래내역의 필터·편집 드롭다운에서만 가립니다. 비활성화된 카테고리를 이미 사용 중인 거래는 그대로 유지됩니다.</li>
        <li><b>카테고리·결제수단 순서</b>는 좌측 ▲▼ 버튼 또는 행을 드래그하여 변경할 수 있습니다.</li>
        <li>고정비 체크는 새로 입력되거나 자동 분류되는 거래의 기본값에 영향을 주지만, 이미 입력된 거래의 구분 값을 강제로 바꾸지는 않습니다.</li>
        <li>이 페이지에서 변경한 목록은 브라우저(localStorage)에 저장되어 새로고침 후에도 유지됩니다.</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.btn-primary {
  @apply px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50;
}
.btn-secondary {
  @apply px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50;
}
.btn-mini {
  @apply px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-600 text-xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed;
}
.btn-mini-active {
  @apply bg-slate-700 text-white border-slate-700 hover:bg-slate-800;
}
.btn-mini-primary {
  @apply px-2 py-0.5 rounded bg-brand-600 text-white text-xs hover:bg-brand-700;
}
.btn-mini-danger {
  @apply px-2 py-0.5 rounded border border-rose-200 bg-white text-rose-600 text-xs hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
