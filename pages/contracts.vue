<script setup lang="ts">
// 계약 관리 페이지.
// 영속화/검증/날짜 파생 계산은 useContracts 컴포저블(→ contractsRepository) 책임.
import { computed, reactive, ref } from 'vue'
import {
  emptyContractDraft,
  useContracts,
  type ContractDraft,
  type ContractStatus,
  type ContractView
} from '~/composables/useContracts'
import { formatKRW } from '~/utils/format'
import { describeDays, formatDDay, formatYmdLong } from '~/utils/schedule'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '계약 관리 · 가계부 대시보드' })

const {
  views,
  summary,
  addContract,
  updateContract,
  removeContract,
  setTerminated,
  CONTRACT_KINDS,
  CONTRACT_CYCLES,
  DEFAULT_SOON_DAYS
} = useContracts()

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 필터 ──
const STATUS_FILTERS = ['전체', '임박', '진행중', '예정', '만료', '해지'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

const statusFilter = ref<StatusFilter>('전체')
const kindFilter = ref<string>('전체')
const search = ref('')

const filtered = computed<ContractView[]>(() => {
  const q = search.value.trim().toLowerCase()
  return views.value.filter((v) => {
    if (statusFilter.value !== '전체' && v.status !== statusFilter.value) return false
    if (kindFilter.value !== '전체' && v.contract.kind !== kindFilter.value) return false
    if (q) {
      const hay = `${v.contract.title} ${v.contract.counterparty} ${v.contract.note}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

/** 상태 칩에 붙일 건수 */
function countOf(s: StatusFilter): number {
  if (s === '전체') return views.value.length
  return views.value.filter((v) => v.status === s).length
}

// ── 추가 / 편집 폼 ──
// 같은 폼을 신규와 편집에 함께 쓴다. editingId가 null이면 신규.
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const draft = reactive<ContractDraft>(emptyContractDraft())
const formError = ref('')

function openCreate() {
  Object.assign(draft, emptyContractDraft())
  editingId.value = null
  formError.value = ''
  formOpen.value = true
}

function openEdit(v: ContractView) {
  const c = v.contract
  Object.assign(draft, {
    title: c.title,
    counterparty: c.counterparty,
    kind: c.kind,
    startDate: c.startDate,
    endDate: c.endDate,
    amount: c.amount,
    cycle: c.cycle,
    autoRenew: c.autoRenew,
    noticeDays: c.noticeDays,
    terminated: c.terminated,
    note: c.note
  } satisfies ContractDraft)
  editingId.value = c.id
  formError.value = ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
  formError.value = ''
}

/** 빈 숫자 입력은 null로 — 0과 '입력 안 함'은 다른 뜻이다 */
function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function onSubmit() {
  formError.value = ''
  const payload = {
    title: draft.title,
    counterparty: draft.counterparty,
    kind: draft.kind,
    startDate: draft.startDate,
    endDate: draft.endDate,
    amount: numOrNull(draft.amount),
    cycle: draft.cycle,
    autoRenew: draft.autoRenew,
    noticeDays: numOrNull(draft.noticeDays),
    terminated: draft.terminated,
    note: draft.note
  }

  const r = editingId.value
    ? updateContract(editingId.value, payload)
    : addContract(payload)

  if (!r.ok) {
    formError.value = r.reason ?? '저장에 실패했습니다'
    return
  }
  notify('ok', withBackupHint(editingId.value ? '계약이 수정되었습니다' : '계약이 추가되었습니다'))
  closeForm()
}

function onRemove(v: ContractView) {
  if (!window.confirm(`'${v.contract.title}' 계약을 삭제할까요?\n되돌릴 수 없습니다.`)) return
  const r = removeContract(v.contract.id)
  if (!r.ok) return notify('err', r.reason ?? '삭제에 실패했습니다')
  if (editingId.value === v.contract.id) closeForm()
  notify('ok', withBackupHint('삭제되었습니다'))
}

function onToggleTerminated(v: ContractView) {
  const next = !v.contract.terminated
  if (next && !window.confirm(`'${v.contract.title}' 계약을 해지 처리할까요?`)) return
  const r = setTerminated(v.contract.id, next)
  if (!r.ok) return notify('err', r.reason ?? '처리에 실패했습니다')
  notify('ok', withBackupHint(next ? '해지 처리되었습니다' : '해지를 취소했습니다'))
}

// ── 표시 도우미 ──
const STATUS_CLASS: Record<ContractStatus, string> = {
  임박: 'chip-warn',
  진행중: 'chip-ok',
  예정: 'chip-info',
  만료: 'chip-muted',
  해지: 'chip-muted'
}

/** 결제 주기와 금액을 한 줄로 — "월 120,000원" */
function amountLabel(v: ContractView): string {
  const c = v.contract
  if (c.amount === null) return '–'
  return `${c.cycle} ${formatKRW(c.amount)}`
}

function endLabel(v: ContractView): string {
  if (!v.contract.endDate) return '무기한'
  return formatYmdLong(v.contract.endDate)
}
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 헤더 -->
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-bold text-slate-900">계약 관리</h2>
        <p class="text-sm text-slate-500 mt-1">
          임대차·보험·통신·구독 등 계약의 기간과 갱신 기한을 한곳에서 관리합니다.
          종료일과 통보 기한이 다가오면 목록 위쪽에 먼저 보입니다.
        </p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/" class="btn-secondary">← 대시보드</NuxtLink>
        <button type="button" class="btn-primary" @click="openCreate">+ 계약 추가</button>
      </div>
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

    <!-- 요약 -->
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <div class="card">
        <div class="kpi-label">진행 중</div>
        <div class="kpi-value mt-1">{{ summary.active.toLocaleString('ko-KR') }}건</div>
        <div class="mt-2 text-xs text-slate-500">전체 {{ summary.total.toLocaleString('ko-KR') }}건 등록</div>
      </div>
      <div class="card">
        <div class="kpi-label">월 환산 금액</div>
        <div class="kpi-value mt-1 text-brand-700">{{ formatKRW(summary.monthlyTotal) }}</div>
        <div class="mt-2 text-xs text-slate-500">진행 중 계약 기준 · 일시 결제 제외</div>
      </div>
      <div class="card">
        <div class="kpi-label">만료 임박</div>
        <div :class="['kpi-value mt-1', summary.soon > 0 ? 'text-amber-600' : '']">
          {{ summary.soon.toLocaleString('ko-KR') }}건
        </div>
        <div class="mt-2 text-xs text-slate-500">통보 기한 또는 {{ DEFAULT_SOON_DAYS }}일 이내</div>
      </div>
      <div class="card">
        <div class="kpi-label">통보 기한 경과</div>
        <div :class="['kpi-value mt-1', summary.noticeDue > 0 ? 'text-rose-600' : '']">
          {{ summary.noticeDue.toLocaleString('ko-KR') }}건
        </div>
        <div class="mt-2 text-xs text-slate-500">갱신·해지 통보가 필요한 계약</div>
      </div>
    </section>

    <!-- 임박 알림 -->
    <section v-if="summary.soon > 0" class="card border-amber-200 bg-amber-50 ring-amber-200">
      <h3 class="font-semibold text-amber-900 text-sm">확인이 필요한 계약</h3>
      <ul class="mt-2 space-y-1 text-sm text-amber-900">
        <li v-for="v in views.filter((x) => x.status === '임박')" :key="v.contract.id" class="flex flex-wrap gap-x-2">
          <b>{{ v.contract.title }}</b>
          <span>· 종료 {{ endLabel(v) }}</span>
          <span class="font-semibold">({{ formatDDay(v.daysLeft) }})</span>
          <span v-if="v.noticeDate" class="text-amber-700">
            · 통보 기한 {{ v.noticeDate }} ({{ describeDays(v.noticeDaysLeft) }})
          </span>
          <span v-if="v.contract.autoRenew" class="text-amber-700">· 자동갱신</span>
        </li>
      </ul>
    </section>

    <!-- 추가/편집 폼 -->
    <section v-if="formOpen" class="card">
      <h3 class="font-semibold text-slate-900">{{ editingId ? '계약 수정' : '새 계약 추가' }}</h3>
      <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="sm:col-span-2">
          <label class="kpi-label">계약명 *</label>
          <input v-model="draft.title" type="text" placeholder="예: 전세 임대차계약" class="form-input mt-1" />
        </div>
        <div>
          <label class="kpi-label">상대방</label>
          <input v-model="draft.counterparty" type="text" placeholder="임대인·보험사·통신사" class="form-input mt-1" />
        </div>
        <div>
          <label class="kpi-label">유형</label>
          <select v-model="draft.kind" class="form-input mt-1">
            <option v-for="k in CONTRACT_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
        </div>

        <div>
          <label class="kpi-label">시작일</label>
          <input v-model="draft.startDate" type="date" class="form-input mt-1" />
        </div>
        <div>
          <label class="kpi-label">종료일</label>
          <input v-model="draft.endDate" type="date" class="form-input mt-1" />
          <p class="mt-1 text-[11px] text-slate-400">비워두면 무기한 계약으로 처리됩니다</p>
        </div>
        <div>
          <label class="kpi-label">금액</label>
          <input v-model="draft.amount" type="number" min="0" step="1000" placeholder="0" class="form-input mt-1 text-right tabular-nums" />
        </div>
        <div>
          <label class="kpi-label">결제 주기</label>
          <select v-model="draft.cycle" class="form-input mt-1">
            <option v-for="c in CONTRACT_CYCLES" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>

        <div>
          <label class="kpi-label">통보 기한 (종료 N일 전)</label>
          <input v-model="draft.noticeDays" type="number" min="0" step="1" placeholder="예: 60" class="form-input mt-1 text-right tabular-nums" />
        </div>
        <div class="flex items-end gap-4">
          <label class="flex items-center gap-1.5 text-sm text-slate-700 select-none">
            <input v-model="draft.autoRenew" type="checkbox" class="rounded" />
            자동 갱신
          </label>
          <label class="flex items-center gap-1.5 text-sm text-slate-700 select-none">
            <input v-model="draft.terminated" type="checkbox" class="rounded" />
            해지됨
          </label>
        </div>
        <div class="sm:col-span-2">
          <label class="kpi-label">메모</label>
          <input v-model="draft.note" type="text" placeholder="특약·갱신 조건 등" class="form-input mt-1" />
        </div>
      </div>

      <p v-if="formError" class="mt-3 text-xs text-rose-600">{{ formError }}</p>

      <div class="mt-4 flex gap-2">
        <button type="button" class="btn-primary" @click="onSubmit">
          {{ editingId ? '수정 저장' : '추가' }}
        </button>
        <button type="button" class="btn-secondary" @click="closeForm">취소</button>
      </div>
    </section>

    <!-- 필터 + 목록 -->
    <section class="card">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 class="font-semibold text-slate-900">계약 목록</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            {{ filtered.length.toLocaleString('ko-KR') }}건 표시 · 종료일이 가까운 순
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <select v-model="kindFilter" class="form-input-sm w-auto">
            <option value="전체">모든 유형</option>
            <option v-for="k in CONTRACT_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
          <input v-model="search" type="text" placeholder="계약명·상대방 검색" class="form-input-sm w-auto min-w-[10rem]" />
        </div>
      </div>

      <!-- 상태 칩 -->
      <div class="mt-3 flex flex-wrap gap-1.5">
        <button
          v-for="s in STATUS_FILTERS"
          :key="s"
          type="button"
          :class="['status-chip', statusFilter === s ? 'is-active' : '']"
          :aria-pressed="statusFilter === s"
          @click="statusFilter = s"
        >
          {{ s }}
          <span class="status-chip-count">{{ countOf(s) }}</span>
        </button>
      </div>

      <!-- 목록 — 좁은 화면에서는 가로 스크롤 -->
      <div class="mt-3 -mx-1 px-1 overflow-x-auto">
        <table class="w-full min-w-[920px] text-sm">
          <colgroup>
            <col style="width: 6rem" />
            <col />
            <col style="width: 9rem" />
            <col style="width: 11rem" />
            <col style="width: 9rem" />
            <col style="width: 10rem" />
            <col style="width: 6.5rem" />
          </colgroup>
          <thead>
            <tr class="text-left text-xs text-slate-500 border-b border-slate-200">
              <th class="py-2 pr-3">상태</th>
              <th class="py-2 pr-3">계약 / 상대방</th>
              <th class="py-2 pr-3">유형</th>
              <th class="py-2 pr-3">기간</th>
              <th class="py-2 pr-3 text-right">금액</th>
              <th class="py-2 pr-3">남은 기간</th>
              <th class="py-2 pr-3 text-right">관리</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr
              v-for="v in filtered"
              :key="v.contract.id"
              :class="['align-top hover:bg-slate-50/60 transition-colors', v.status === '해지' || v.status === '만료' ? 'text-slate-400' : '']"
            >
              <td class="py-2.5 pr-3">
                <span :class="['chip', STATUS_CLASS[v.status]]">{{ v.status }}</span>
              </td>

              <td class="py-2.5 pr-3">
                <div class="font-medium text-slate-900">{{ v.contract.title }}</div>
                <div v-if="v.contract.counterparty" class="text-xs text-slate-500 mt-0.5">
                  {{ v.contract.counterparty }}
                </div>
                <div v-if="v.contract.note" class="text-xs text-slate-400 mt-0.5 truncate" :title="v.contract.note">
                  {{ v.contract.note }}
                </div>
              </td>

              <td class="py-2.5 pr-3">
                <span class="text-slate-700">{{ v.contract.kind }}</span>
                <div v-if="v.contract.autoRenew" class="text-[11px] text-brand-600 mt-0.5">자동갱신</div>
              </td>

              <td class="py-2.5 pr-3 text-xs tabular-nums text-slate-600">
                <div>{{ v.contract.startDate || '–' }}</div>
                <div class="text-slate-400">~ {{ v.contract.endDate || '무기한' }}</div>
                <!-- 경과율 — 무기한 계약은 그리지 않는다 -->
                <div v-if="v.progress !== null" class="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div class="h-full rounded-full bg-brand-500" :style="{ width: `${Math.round(v.progress * 100)}%` }" />
                </div>
              </td>

              <td class="py-2.5 pr-3 text-right tabular-nums">
                <div class="text-slate-900">{{ amountLabel(v) }}</div>
                <div v-if="v.monthlyAmount !== null && v.contract.cycle !== '월'" class="text-[11px] text-slate-400 mt-0.5">
                  월 {{ formatKRW(v.monthlyAmount) }}
                </div>
              </td>

              <td class="py-2.5 pr-3">
                <div v-if="v.contract.endDate" class="tabular-nums">
                  <span :class="['font-semibold', v.status === '임박' ? 'text-amber-600' : v.status === '만료' ? 'text-slate-400' : 'text-slate-700']">
                    {{ formatDDay(v.daysLeft) }}
                  </span>
                  <div class="text-[11px] text-slate-400">{{ describeDays(v.daysLeft) }}</div>
                </div>
                <div v-else class="text-xs text-slate-400">–</div>
                <div v-if="v.noticeDate" class="text-[11px] text-slate-500 mt-1">
                  통보 {{ formatDDay(v.noticeDaysLeft) }}
                </div>
              </td>

              <td class="py-2.5 pr-3 text-right whitespace-nowrap">
                <button type="button" class="btn-mini" @click="openEdit(v)">수정</button>
                <button type="button" class="btn-mini ml-1" @click="onToggleTerminated(v)">
                  {{ v.contract.terminated ? '복구' : '해지' }}
                </button>
                <button type="button" class="btn-mini-danger ml-1" @click="onRemove(v)">삭제</button>
              </td>
            </tr>

            <tr v-if="filtered.length === 0">
              <td colspan="7" class="py-12 text-center">
                <svg width="34" height="26" viewBox="0 0 34 26" fill="none" class="mx-auto text-slate-200" aria-hidden="true">
                  <rect x="1" y="12" width="8" height="13" rx="2" fill="currentColor" />
                  <rect x="13" y="6" width="8" height="19" rx="2" fill="currentColor" />
                  <rect x="25" y="16" width="8" height="9" rx="2" fill="currentColor" />
                </svg>
                <p class="mt-2 text-sm text-slate-400">
                  {{ views.length === 0 ? '등록된 계약이 없습니다. 위 \'계약 추가\'로 시작하세요.' : '조건에 맞는 계약이 없습니다.' }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 안내 -->
    <section class="card bg-slate-50 border-slate-200">
      <h4 class="text-sm font-semibold text-slate-700">사용 가이드</h4>
      <ul class="mt-2 text-xs text-slate-600 space-y-1 list-disc list-inside">
        <li><b>통보 기한</b>을 넣어두면 종료일에서 그만큼 앞당긴 날짜를 계산해, 갱신·해지를 알려야 하는 시점을 따로 표시합니다.</li>
        <li>통보 기한을 넣지 않은 계약은 종료 <b>{{ DEFAULT_SOON_DAYS }}일 전</b>부터 '임박'으로 표시됩니다.</li>
        <li><b>월 환산 금액</b>은 주기가 다른 계약을 나란히 비교하기 위한 값입니다. '일시' 결제는 반복 지출이 아니므로 합계에서 빠집니다.</li>
        <li>종료일을 비워두면 무기한 계약으로 처리되어 남은 기간·경과율을 계산하지 않습니다.</li>
        <li><b>해지</b>는 날짜와 무관하게 종료로 취급합니다. 잘못 눌렀다면 '복구'로 되돌릴 수 있습니다.</li>
        <li>이 페이지의 데이터는 브라우저(localStorage)에 저장되며, 설정 화면의 <b>백업·복원</b>에 함께 포함됩니다.</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.form-input {
  @apply w-full rounded-md border-slate-300 text-sm focus:border-brand-500 focus:ring-brand-500;
}
.form-input-sm {
  @apply rounded-md border-slate-300 text-xs py-1 focus:border-brand-500 focus:ring-brand-500;
}
.btn-primary {
  @apply px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50;
}
.btn-secondary {
  @apply px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50;
}
.btn-mini {
  @apply px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-600 text-xs hover:bg-slate-50;
}
.btn-mini-danger {
  @apply px-2 py-0.5 rounded border border-rose-200 bg-white text-rose-600 text-xs hover:bg-rose-50;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* 상태 배지 — 색만으로 말하지 않도록 글자를 항상 함께 적는다 */
.chip-ok    { @apply bg-emerald-50 text-emerald-700; }
.chip-warn  { @apply bg-amber-50 text-amber-700; }
.chip-info  { @apply bg-blue-50 text-blue-700; }
.chip-muted { @apply bg-slate-100 text-slate-500; }

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid rgb(226 232 240);
  background: #fff;
  font-size: 11px;
  font-weight: 500;
  color: rgb(71 85 105);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
}
.status-chip:hover { background: rgb(248 250 252); }
.status-chip.is-active {
  background: rgb(26 94 235);
  border-color: rgb(26 94 235);
  color: #fff;
  font-weight: 600;
}
.status-chip-count {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
</style>
