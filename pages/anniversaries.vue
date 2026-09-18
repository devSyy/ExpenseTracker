<script setup lang="ts">
// 기념일 관리 페이지.
// 영속화/검증/날짜 파생 계산은 useAnniversaries 컴포저블(→ anniversariesRepository) 책임.
import { computed, reactive, ref } from 'vue'
import {
  emptyAnniversaryDraft,
  useAnniversaries,
  type AnniversaryDraft,
  type AnniversaryView
} from '~/composables/useAnniversaries'
import { describeDays, formatDDay, formatMonthDay, formatYmdLong } from '~/utils/schedule'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '기념일 관리 · 가계부 대시보드' })

const {
  views,
  byMonth,
  summary,
  addAnniversary,
  updateAnniversary,
  removeAnniversary,
  ANNIVERSARY_KINDS,
  DEFAULT_REMIND_DAYS
} = useAnniversaries()

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 보기 방식 · 필터 ──
// '다가오는 순'은 평소 쓰는 화면, '월별'은 1년을 훑어볼 때 쓴다.
const viewMode = ref<'upcoming' | 'month'>('upcoming')
const kindFilter = ref<string>('전체')
const search = ref('')

function matches(v: AnniversaryView): boolean {
  if (kindFilter.value !== '전체' && v.anniversary.kind !== kindFilter.value) return false
  const q = search.value.trim().toLowerCase()
  if (!q) return true
  const hay = `${v.anniversary.title} ${v.anniversary.person} ${v.anniversary.note}`.toLowerCase()
  return hay.includes(q)
}

const filtered = computed<AnniversaryView[]>(() => views.value.filter(matches))
const filteredByMonth = computed(() =>
  byMonth.value
    .map((g) => ({ month: g.month, items: g.items.filter(matches) }))
    .filter((g) => g.items.length > 0)
)

// ── 추가 / 편집 폼 ──
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const draft = reactive<AnniversaryDraft>(emptyAnniversaryDraft())
const formError = ref('')

function openCreate() {
  Object.assign(draft, emptyAnniversaryDraft())
  editingId.value = null
  formError.value = ''
  formOpen.value = true
}

function openEdit(v: AnniversaryView) {
  const a = v.anniversary
  Object.assign(draft, {
    title: a.title,
    date: a.date,
    kind: a.kind,
    repeatYearly: a.repeatYearly,
    remindDays: a.remindDays,
    person: a.person,
    note: a.note
  } satisfies AnniversaryDraft)
  editingId.value = a.id
  formError.value = ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
  formError.value = ''
}

function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function onSubmit() {
  formError.value = ''
  const payload = {
    title: draft.title,
    date: draft.date,
    kind: draft.kind,
    repeatYearly: draft.repeatYearly,
    remindDays: numOrNull(draft.remindDays),
    person: draft.person,
    note: draft.note
  }

  const r = editingId.value
    ? updateAnniversary(editingId.value, payload)
    : addAnniversary(payload)

  if (!r.ok) {
    formError.value = r.reason ?? '저장에 실패했습니다'
    return
  }
  notify('ok', withBackupHint(editingId.value ? '기념일이 수정되었습니다' : '기념일이 추가되었습니다'))
  closeForm()
}

function onRemove(v: AnniversaryView) {
  if (!window.confirm(`'${v.anniversary.title}'을(를) 삭제할까요?\n되돌릴 수 없습니다.`)) return
  const r = removeAnniversary(v.anniversary.id)
  if (!r.ok) return notify('err', r.reason ?? '삭제에 실패했습니다')
  if (editingId.value === v.anniversary.id) closeForm()
  notify('ok', withBackupHint('삭제되었습니다'))
}

// ── 표시 도우미 ──
const KIND_CLASS: Record<string, string> = {
  생일: 'chip-birthday',
  결혼기념일: 'chip-wedding',
  기일: 'chip-memorial',
  기념일: 'chip-default',
  기타: 'chip-muted'
}

/** "N주년" 표기 — 생일은 '만 N세', 그 밖은 'N주년'. 첫 해(0)는 생략한다 */
function yearsLabel(v: AnniversaryView): string {
  if (v.years <= 0) return ''
  return v.anniversary.kind === '생일' ? `만 ${v.years}세` : `${v.years}주년`
}

/** 남은 일수에 따른 강조 — 오늘 > 임박 > 평소 */
function ddayClass(v: AnniversaryView): string {
  if (v.isPast) return 'text-slate-400'
  if (v.isToday) return 'text-rose-600'
  if (v.isSoon) return 'text-amber-600'
  return 'text-slate-700'
}

const MONTH_NAMES = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 헤더 -->
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-bold text-slate-900">기념일 관리</h2>
        <p class="text-sm text-slate-500 mt-1">
          생일·결혼기념일·기일 등을 등록하면 다음 날짜까지 남은 일수를 자동으로 계산해 가까운 순으로 보여줍니다.
        </p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/" class="btn-secondary">← 대시보드</NuxtLink>
        <button type="button" class="btn-primary" @click="openCreate">+ 기념일 추가</button>
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
        <div class="kpi-label">등록</div>
        <div class="kpi-value mt-1">{{ summary.total.toLocaleString('ko-KR') }}개</div>
        <div class="mt-2 text-xs text-slate-500">기념일 전체</div>
      </div>
      <div class="card">
        <div class="kpi-label">가장 가까운</div>
        <div class="kpi-value mt-1 text-brand-700">
          {{ summary.next ? formatDDay(summary.next.daysLeft) : '–' }}
        </div>
        <div class="mt-2 text-xs text-slate-500 truncate">
          {{ summary.next ? summary.next.anniversary.title : '등록된 기념일 없음' }}
        </div>
      </div>
      <div class="card">
        <div class="kpi-label">이번 달</div>
        <div class="kpi-value mt-1">{{ summary.thisMonth.toLocaleString('ko-KR') }}개</div>
        <div class="mt-2 text-xs text-slate-500">이번 달에 돌아오는 기념일</div>
      </div>
      <div class="card">
        <div class="kpi-label">오늘</div>
        <div :class="['kpi-value mt-1', summary.today > 0 ? 'text-rose-600' : '']">
          {{ summary.today.toLocaleString('ko-KR') }}개
        </div>
        <div class="mt-2 text-xs text-slate-500">임박 {{ summary.soon.toLocaleString('ko-KR') }}개 (기본 {{ DEFAULT_REMIND_DAYS }}일 전부터)</div>
      </div>
    </section>

    <!-- 오늘/임박 알림 -->
    <section v-if="summary.soon > 0" class="card border-amber-200 bg-amber-50 ring-amber-200">
      <h3 class="font-semibold text-amber-900 text-sm">곧 돌아오는 기념일</h3>
      <ul class="mt-2 space-y-1 text-sm text-amber-900">
        <li v-for="v in views.filter((x) => x.isSoon && !x.isPast)" :key="v.anniversary.id" class="flex flex-wrap gap-x-2">
          <b>{{ v.anniversary.title }}</b>
          <span v-if="v.anniversary.person" class="text-amber-700">· {{ v.anniversary.person }}</span>
          <span>· {{ formatMonthDay(v.nextDate) }}</span>
          <span class="font-semibold">({{ v.isToday ? '오늘' : formatDDay(v.daysLeft) }})</span>
          <span v-if="yearsLabel(v)" class="text-amber-700">· {{ yearsLabel(v) }}</span>
        </li>
      </ul>
    </section>

    <!-- 추가/편집 폼 -->
    <section v-if="formOpen" class="card">
      <h3 class="font-semibold text-slate-900">{{ editingId ? '기념일 수정' : '새 기념일 추가' }}</h3>
      <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="sm:col-span-2">
          <label class="kpi-label">이름 *</label>
          <input v-model="draft.title" type="text" placeholder="예: 아내 생일" class="form-input mt-1" />
        </div>
        <div>
          <label class="kpi-label">날짜 *</label>
          <input v-model="draft.date" type="date" class="form-input mt-1" />
        </div>
        <div>
          <label class="kpi-label">종류</label>
          <select v-model="draft.kind" class="form-input mt-1">
            <option v-for="k in ANNIVERSARY_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
        </div>

        <div>
          <label class="kpi-label">관련 인물</label>
          <input v-model="draft.person" type="text" placeholder="누구의 기념일인지" class="form-input mt-1" />
        </div>
        <div>
          <label class="kpi-label">알림 시작 (N일 전)</label>
          <input
            v-model="draft.remindDays"
            type="number" min="0" step="1"
            :placeholder="`기본 ${DEFAULT_REMIND_DAYS}`"
            class="form-input mt-1 text-right tabular-nums"
          />
        </div>
        <div class="flex items-end">
          <label class="flex items-center gap-1.5 text-sm text-slate-700 select-none">
            <input v-model="draft.repeatYearly" type="checkbox" class="rounded" />
            매년 반복
          </label>
        </div>
        <div>
          <label class="kpi-label">메모</label>
          <input v-model="draft.note" type="text" placeholder="선물·장소 등" class="form-input mt-1" />
        </div>
      </div>

      <p v-if="formError" class="mt-3 text-xs text-rose-600">{{ formError }}</p>
      <p v-if="!draft.repeatYearly" class="mt-2 text-[11px] text-slate-500">
        '매년 반복'을 끄면 지정한 그 날짜 한 번만 관리하며, 날짜가 지나면 목록 아래쪽으로 내려갑니다.
      </p>

      <div class="mt-4 flex gap-2">
        <button type="button" class="btn-primary" @click="onSubmit">
          {{ editingId ? '수정 저장' : '추가' }}
        </button>
        <button type="button" class="btn-secondary" @click="closeForm">취소</button>
      </div>
    </section>

    <!-- 목록 -->
    <section class="card">
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 class="font-semibold text-slate-900">기념일 목록</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            {{ filtered.length.toLocaleString('ko-KR') }}개 표시 ·
            {{ viewMode === 'upcoming' ? '다가오는 순' : '월별' }}
          </p>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <div class="seg" role="group" aria-label="보기 방식">
            <button
              type="button"
              :class="['seg-btn', viewMode === 'upcoming' ? 'is-active' : '']"
              :aria-pressed="viewMode === 'upcoming'"
              @click="viewMode = 'upcoming'"
            >다가오는 순</button>
            <button
              type="button"
              :class="['seg-btn', viewMode === 'month' ? 'is-active' : '']"
              :aria-pressed="viewMode === 'month'"
              @click="viewMode = 'month'"
            >월별</button>
          </div>
          <select v-model="kindFilter" class="form-input-sm w-auto">
            <option value="전체">모든 종류</option>
            <option v-for="k in ANNIVERSARY_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
          <input v-model="search" type="text" placeholder="이름·인물 검색" class="form-input-sm w-auto min-w-[9rem]" />
        </div>
      </div>

      <!-- 빈 상태 -->
      <div v-if="filtered.length === 0" class="py-12 text-center">
        <svg width="34" height="26" viewBox="0 0 34 26" fill="none" class="mx-auto text-slate-200" aria-hidden="true">
          <rect x="1" y="12" width="8" height="13" rx="2" fill="currentColor" />
          <rect x="13" y="6" width="8" height="19" rx="2" fill="currentColor" />
          <rect x="25" y="16" width="8" height="9" rx="2" fill="currentColor" />
        </svg>
        <p class="mt-2 text-sm text-slate-400">
          {{ views.length === 0 ? '등록된 기념일이 없습니다. 위 \'기념일 추가\'로 시작하세요.' : '조건에 맞는 기념일이 없습니다.' }}
        </p>
      </div>

      <!-- 다가오는 순 -->
      <ul v-else-if="viewMode === 'upcoming'" class="mt-3 divide-y divide-slate-100">
        <li v-for="v in filtered" :key="v.anniversary.id" :class="['ann-row', v.isPast ? 'is-past' : '']">
          <!-- D-day 블록 -->
          <div class="ann-dday">
            <div :class="['ann-dday-value', ddayClass(v)]">
              {{ v.isToday ? '오늘' : formatDDay(v.daysLeft) }}
            </div>
            <div class="ann-dday-date">{{ formatMonthDay(v.nextDate) }}</div>
          </div>

          <!-- 본문 -->
          <div class="ann-body">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium text-slate-900">{{ v.anniversary.title }}</span>
              <span :class="['chip', KIND_CLASS[v.anniversary.kind] ?? 'chip-default']">
                {{ v.anniversary.kind }}
              </span>
              <span v-if="yearsLabel(v)" class="text-xs font-medium text-brand-600">{{ yearsLabel(v) }}</span>
              <span v-if="!v.anniversary.repeatYearly" class="text-[11px] text-slate-400">1회</span>
            </div>
            <div class="mt-0.5 text-xs text-slate-500 flex flex-wrap gap-x-2">
              <span v-if="v.anniversary.person">{{ v.anniversary.person }}</span>
              <span>원래 날짜 {{ formatYmdLong(v.anniversary.date) }}</span>
              <span v-if="!v.isToday">{{ describeDays(v.daysLeft) }}</span>
            </div>
            <div v-if="v.anniversary.note" class="mt-0.5 text-xs text-slate-400">{{ v.anniversary.note }}</div>
          </div>

          <!-- 관리 -->
          <div class="ann-actions">
            <button type="button" class="btn-mini" @click="openEdit(v)">수정</button>
            <button type="button" class="btn-mini-danger ml-1" @click="onRemove(v)">삭제</button>
          </div>
        </li>
      </ul>

      <!-- 월별 -->
      <div v-else class="mt-3 space-y-4">
        <div v-for="g in filteredByMonth" :key="g.month">
          <div class="flex items-center gap-2">
            <h4 class="text-sm font-semibold text-slate-700">{{ MONTH_NAMES[g.month - 1] }}</h4>
            <span class="text-xs text-slate-400">{{ g.items.length }}개</span>
            <div class="flex-1 h-px bg-slate-100" />
          </div>
          <ul class="mt-1 divide-y divide-slate-100">
            <li v-for="v in g.items" :key="v.anniversary.id" :class="['ann-row', v.isPast ? 'is-past' : '']">
              <div class="ann-dday">
                <div :class="['ann-dday-value', ddayClass(v)]">
                  {{ v.isToday ? '오늘' : formatDDay(v.daysLeft) }}
                </div>
                <div class="ann-dday-date">{{ formatMonthDay(v.nextDate) }}</div>
              </div>
              <div class="ann-body">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-medium text-slate-900">{{ v.anniversary.title }}</span>
                  <span :class="['chip', KIND_CLASS[v.anniversary.kind] ?? 'chip-default']">
                    {{ v.anniversary.kind }}
                  </span>
                  <span v-if="yearsLabel(v)" class="text-xs font-medium text-brand-600">{{ yearsLabel(v) }}</span>
                </div>
                <div v-if="v.anniversary.person" class="mt-0.5 text-xs text-slate-500">{{ v.anniversary.person }}</div>
              </div>
              <div class="ann-actions">
                <button type="button" class="btn-mini" @click="openEdit(v)">수정</button>
                <button type="button" class="btn-mini-danger ml-1" @click="onRemove(v)">삭제</button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- 안내 -->
    <section class="card bg-slate-50 border-slate-200">
      <h4 class="text-sm font-semibold text-slate-700">사용 가이드</h4>
      <ul class="mt-2 text-xs text-slate-600 space-y-1 list-disc list-inside">
        <li><b>매년 반복</b>이 켜져 있으면 올해(또는 내년) 중 다가오는 날짜를 자동으로 계산합니다. 원래 날짜는 그대로 보관됩니다.</li>
        <li><b>N주년 / 만 N세</b>는 원래 날짜의 연도와 다음 발생 연도의 차이로 계산합니다.</li>
        <li>2월 29일은 평년에 <b>2월 28일</b>로 당겨 계산합니다 — 4년에 한 번만 보이면 목록에서 놓치기 때문입니다.</li>
        <li>날짜는 모두 <b>양력</b> 기준입니다. 음력 기념일은 해당 연도의 양력 날짜로 등록해 주세요.</li>
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

/* 종류 배지 */
.chip-birthday { @apply bg-rose-50 text-rose-700; }
.chip-wedding  { @apply bg-violet-50 text-violet-700; }
.chip-memorial { @apply bg-slate-100 text-slate-600; }
.chip-default  { @apply bg-brand-50 text-brand-700; }
.chip-muted    { @apply bg-slate-100 text-slate-500; }

/* 목록 행 — D-day 블록 / 본문 / 관리 3단 */
.ann-row {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.625rem 0;
}
.ann-row.is-past { opacity: 0.55; }

.ann-dday {
  flex: 0 0 4.75rem;
  text-align: center;
  padding-top: 0.0625rem;
}
.ann-dday-value {
  font-size: 0.8125rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
}
.ann-dday-date {
  margin-top: 0.125rem;
  font-size: 0.6875rem;
  color: rgb(148 163 184);
  white-space: nowrap;
}

.ann-body {
  flex: 1 1 auto;
  min-width: 0;
}
.ann-actions {
  flex: 0 0 auto;
  white-space: nowrap;
  padding-top: 0.0625rem;
}

/* 보기 방식 세그먼트 컨트롤 — 차트 카드와 같은 모양 */
.seg {
  display: inline-flex;
  padding: 2px;
  gap: 2px;
  border-radius: 9px;
  background: rgb(241 245 249);
}
.seg-btn {
  padding: 3px 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  font-size: 0.6875rem;
  font-weight: 500;
  white-space: nowrap;
  color: rgb(71 85 105);
  cursor: pointer;
  transition: background-color 0.12s ease, color 0.12s ease;
}
.seg-btn:hover { color: rgb(15 23 42); }
.seg-btn.is-active {
  background: #ffffff;
  color: rgb(23 73 191);
  font-weight: 700;
  box-shadow: 0 1px 2px rgb(15 23 42 / 0.08);
}
</style>
