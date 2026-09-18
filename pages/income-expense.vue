<script setup lang="ts">
// 수입/지출 관리 페이지: 입력 폼 + 거래 이력 + 필터 + 통계.
import { computed, reactive, ref, watch } from 'vue'
import {
  useIncomeExpense,
  incomeCategoryOptions,
  expenseCategoryOptions,
  PAYMENT_METHODS,
  type TxKind,
  type IncomeExpenseTx
} from '~/composables/useIncomeExpense'
import { useExpenses } from '~/composables/useExpenses'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '수입/지출 관리 · 가계부' })

const {
  transactions,
  add,
  update,
  remove,
  importFromDashboard,
  clearDashboardImports,
  dashboardImportCount,
  isIncomeExpenseMirror
} = useIncomeExpense()
const { transactions: allDashboardTxs } = useExpenses()

/**
 * 가져오기 대상이 되는 대시보드 사용내역.
 * 이 화면에서 대시보드로 미러링해 올려보낸 항목은 원래 여기 것이므로 가져오기 대상이 아니다
 * (건수 표시와 버튼 활성 조건도 같은 기준을 쓴다).
 */
const dashboardTxs = computed(() => allDashboardTxs.value.filter((t) => !isIncomeExpenseMirror(t)))

// ── 사용내역에서 가져오기 ──
//
// 사용내역의 거래는 보통 과거 날짜를 갖는데, 이 페이지의 기본 필터는 "최근 1개월"이라
// 가져온 직후 거래 이력 테이블에 안 보일 수 있다. 그래서 가져오기 직후엔
// 필터 날짜 범위를 전체 거래(가져온 것 포함)를 덮도록 자동 확장하고, 즉시 조회한다.
function expandFilterToCoverAll() {
  if (transactions.value.length === 0) return
  const dates = transactions.value.map((t) => t.date).filter(Boolean).sort()
  if (dates.length === 0) return
  filterDraft.startDate = dates[0]
  filterDraft.endDate = dates[dates.length - 1]
  filterDraft.kind = 'all'
  filterDraft.category = 'all'
  filterDraft.paymentMethod = 'all'
  appliedFilters.value = { ...filterDraft }
  page.value = 1
}

function onImportFromDashboard() {
  if (dashboardTxs.value.length === 0) {
    notify('err', '대시보드에 사용내역이 없습니다. 거래내역에서 엑셀을 먼저 업로드하세요.')
    return
  }
  const r = importFromDashboard(dashboardTxs.value, { onlyNew: true })
  if (r.added === 0 && r.skipped > 0) {
    expandFilterToCoverAll()
    notify('ok', `이미 ${r.skipped}건이 모두 가져와져 있습니다`)
  } else if (r.added > 0) {
    expandFilterToCoverAll()
    notify('ok', withBackupHint(`월×카테고리 합계 ${r.added}건을 지출로 자동 입력했습니다${r.skipped > 0 ? ` · ${r.skipped}건 중복 제외` : ''}`))
  } else {
    notify('err', '가져올 거래가 없습니다')
  }
}

function onResyncFromDashboard() {
  if (!window.confirm('사용내역에서 가져온 모든 항목을 다시 동기화할까요?\n기존에 가져온 항목은 모두 제거되고 현재 사용내역으로 새로 채워집니다.')) return
  if (dashboardTxs.value.length === 0) {
    notify('err', '대시보드에 사용내역이 없습니다.')
    return
  }
  const r = importFromDashboard(dashboardTxs.value, { onlyNew: false, replace: true })
  expandFilterToCoverAll()
  notify('ok', withBackupHint(`재동기화 완료 · 제거 ${r.removed}건 / 합계 ${r.added}건 새로 입력`))
}

function onClearDashboardImports() {
  if (!window.confirm(`사용내역에서 가져온 ${dashboardImportCount.value}건을 모두 제거할까요?`)) return
  const n = clearDashboardImports()
  notify('ok', withBackupHint(`${n}건이 제거되었습니다`))
}

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 입력 폼 ──
function emptyForm() {
  return {
    kind: '수입' as TxKind,
    category: incomeCategoryOptions.value[0] ?? '',
    amount: null as number | null,
    date: new Date().toISOString().slice(0, 10),
    paymentMethod: PAYMENT_METHODS[0],
    description: '',
    note: ''
  }
}
const form = reactive(emptyForm())

const formCategoryOptions = computed(() =>
  form.kind === '수입' ? incomeCategoryOptions.value : expenseCategoryOptions.value
)

watch(() => form.kind, (k) => {
  // 구분 변경 시 카테고리 기본값 재설정
  form.category = (k === '수입' ? incomeCategoryOptions.value : expenseCategoryOptions.value)[0] ?? ''
})

function onResetForm() {
  Object.assign(form, emptyForm())
}

function onSubmit() {
  if (!form.date) { notify('err', '날짜를 입력하세요'); return }
  const amt = Number(form.amount)
  if (!Number.isFinite(amt) || amt <= 0) { notify('err', '금액은 양수여야 합니다'); return }
  const tx = add({
    date: form.date,
    kind: form.kind,
    category: form.category,
    description: form.description,
    paymentMethod: form.paymentMethod,
    amount: amt,
    note: form.note
  })
  if (!tx) { notify('err', '저장에 실패했습니다'); return }
  notify('ok', withBackupHint(`${form.kind} ${fmtKRW(amt)}원이 추가되었습니다`))
  // 동일 구분으로 연속 입력하기 쉽도록 금액·내용·비고만 초기화
  form.amount = null
  form.description = ''
  form.note = ''
}

// ── 필터 ──
//
// 기본 조회 범위는 **오늘 기준 최근 1개월** — 시작일 = 한 달 전 같은 날, 종료일 = 오늘.
// 특정 날짜를 하드코딩하지 않으므로 해·달·일이 바뀌면 기본값도 자동으로 따라간다.

/** Date → 'YYYY-MM-DD'. toISOString()은 UTC라 KST(UTC+9)에서 하루 밀리므로 로컬 기준으로 만든다. */
function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * n개월 전 같은 날. 대상 월에 그 날짜가 없으면 말일로 맞춘다.
 * (3월 31일의 한 달 전은 2월 28/29일 — 보정하지 않으면 JS가 3월로 넘겨버린다)
 */
function monthsBefore(d: Date, months: number): Date {
  const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() - months + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() - months, Math.min(d.getDate(), lastDayOfTarget))
}

/** 오늘 기준 기본 조회 범위 (최근 1개월) */
function defaultDateRange(): { startDate: string; endDate: string } {
  const today = new Date()
  return { startDate: ymd(monthsBefore(today, 1)), endDate: ymd(today) }
}

const filterDraft = reactive({
  ...defaultDateRange(),
  kind: 'all' as 'all' | TxKind,
  category: 'all' as string,
  paymentMethod: 'all' as string
})
// 적용된 필터 (조회 버튼 클릭 시점)
const appliedFilters = ref({ ...filterDraft })

function onApplyFilter() {
  appliedFilters.value = { ...filterDraft }
  page.value = 1
  notify('ok', '조회되었습니다')
}

const filtered = computed<IncomeExpenseTx[]>(() => {
  const f = appliedFilters.value
  return transactions.value.filter((t) => {
    if (f.startDate && t.date < f.startDate) return false
    if (f.endDate && t.date > f.endDate) return false
    if (f.kind !== 'all' && t.kind !== f.kind) return false
    if (f.category !== 'all' && t.category !== f.category) return false
    if (f.paymentMethod !== 'all' && t.paymentMethod !== f.paymentMethod) return false
    return true
  })
})

const totalIncome = computed(() =>
  filtered.value.filter((t) => t.kind === '수입').reduce((s, t) => s + t.amount, 0)
)
const totalExpense = computed(() =>
  filtered.value.filter((t) => t.kind === '지출').reduce((s, t) => s + t.amount, 0)
)
const netProfit = computed(() => totalIncome.value - totalExpense.value)

// 필터 카테고리 옵션은 양쪽 모두 + 데이터에서 발견된 추가 항목
const filterCategoryOptions = computed<string[]>(() => {
  const set = new Set<string>([...incomeCategoryOptions.value, ...expenseCategoryOptions.value])
  transactions.value.forEach((t) => set.add(t.category))
  return Array.from(set)
})

// ── 뷰 모드: 카테고리 합산(기본) / 거래별 상세 ──
type ViewMode = 'category' | 'transaction'
const viewMode = ref<ViewMode>('category')

// ── 카테고리 합산 ──
interface CategoryGroup {
  key: string
  kind: TxKind
  category: string
  total: number
  count: number
  avg: number
  latestDate: string
  items: IncomeExpenseTx[]
}

const categoryGroups = computed<CategoryGroup[]>(() => {
  const map = new Map<string, CategoryGroup>()
  for (const t of filtered.value) {
    const key = `${t.kind}::${t.category}`
    const g = map.get(key) ?? {
      key, kind: t.kind, category: t.category,
      total: 0, count: 0, avg: 0, latestDate: '', items: []
    }
    g.total += t.amount
    g.count += 1
    g.items.push(t)
    if (t.date > g.latestDate) g.latestDate = t.date
    map.set(key, g)
  }
  // 수입을 위로, 같은 구분 안에서는 합계 내림차순
  return Array.from(map.values())
    .map((g) => ({ ...g, avg: g.count > 0 ? g.total / g.count : 0 }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === '수입' ? -1 : 1
      return b.total - a.total
    })
})

// 펼친 그룹 키 추적 — 클릭하면 그 카테고리의 개별 거래 보기
const expandedKeys = ref<Set<string>>(new Set())
function toggleExpand(key: string) {
  const next = new Set(expandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}
function expandAll() { expandedKeys.value = new Set(categoryGroups.value.map((g) => g.key)) }
function collapseAll() { expandedKeys.value = new Set() }

// ── 정렬·페이지네이션 (거래별 모드) ──
const sortedRows = computed<IncomeExpenseTx[]>(() =>
  filtered.value.slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt))
)

const PAGE_SIZES = [10, 20, 50] as const
const pageSize = ref<number>(10)
const page = ref<number>(1)
const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value)))
watch([pageSize, () => sortedRows.value.length], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
  if (page.value < 1) page.value = 1
})
// 모드 전환 시 페이지 초기화
watch(viewMode, () => { page.value = 1; expandedKeys.value = new Set() })

const visibleRows = computed<IncomeExpenseTx[]>(() => {
  const start = (page.value - 1) * pageSize.value
  return sortedRows.value.slice(start, start + pageSize.value)
})

// ── 인라인 편집 ──
const editingId = ref<string | null>(null)
const editDraft = reactive({
  date: '',
  kind: '수입' as TxKind,
  category: '',
  description: '',
  paymentMethod: '',
  amount: null as number | null,
  note: ''
})
const editCategoryOptions = computed(() =>
  editDraft.kind === '수입' ? incomeCategoryOptions.value : expenseCategoryOptions.value
)

function startEdit(t: IncomeExpenseTx) {
  editingId.value = t.id
  editDraft.date = t.date
  editDraft.kind = t.kind
  editDraft.category = t.category
  editDraft.description = t.description
  editDraft.paymentMethod = t.paymentMethod
  editDraft.amount = t.amount
  editDraft.note = t.note
}
function cancelEdit() { editingId.value = null }
function commitEdit() {
  if (!editingId.value) return
  const amt = Number(editDraft.amount)
  if (!editDraft.date || !Number.isFinite(amt) || amt <= 0) { notify('err', '날짜와 금액을 확인하세요'); return }
  update(editingId.value, {
    date: editDraft.date,
    kind: editDraft.kind,
    category: editDraft.category,
    description: editDraft.description,
    paymentMethod: editDraft.paymentMethod,
    amount: amt,
    note: editDraft.note
  })
  editingId.value = null
  notify('ok', withBackupHint('수정되었습니다'))
}
function onRemove(id: string) {
  if (!window.confirm('이 거래를 삭제할까요?')) return
  if (remove(id)) notify('ok', withBackupHint('삭제되었습니다'))
}

// ── 카테고리 아이콘(이모지) ──
const CATEGORY_EMOJI: Record<string, string> = {
  '급여': '🎁', '보너스': '🎁', '용돈': '💵', '이자': '💰', '환급': '💸',
  '판매수입': '🧾', '기타수입': '💼',
  '식비': '🍴', '교통비': '🚇', '쇼핑': '🛍️', '통신비': '📱',
  '주거비': '🏠', '의료': '🏥', '문화/여가': '🎬', '교육': '📚',
  '경조사': '💝', '카페/간식': '☕', '기타지출': '💳'
}
function emoji(cat: string): string {
  return CATEGORY_EMOJI[cat] ?? '💼'
}

// ── 포맷터 ──
function fmtKRW(n: number): string {
  return Number.isFinite(n) ? Number(n).toLocaleString('ko-KR') : '0'
}
function fmtSigned(t: IncomeExpenseTx): string {
  const sign = t.kind === '수입' ? '+' : '-'
  return `${sign}${fmtKRW(t.amount)}원`
}
</script>

<template>
  <!-- 본문 컨테이너: 화면 폭에 따라 max-width가 단계 확장됨. 정의는 assets/css/tailwind.css -->
  <div class="page-shell section-gap">
    <!-- 페이지 헤더 + 브레드크럼 -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-slate-900">수입/지출 관리</h2>
      <nav class="text-xs text-slate-400 flex items-center gap-1.5">
        <NuxtLink to="/" class="hover:text-slate-700">홈</NuxtLink>
        <span>›</span>
        <span class="text-slate-700 font-medium">수입/지출 관리</span>
      </nav>
    </div>

    <!-- 사용내역 가져오기 -->
    <section class="card flex flex-wrap items-center gap-3">
      <div class="flex-1 min-w-[16rem]">
        <h3 class="font-semibold text-slate-900 text-sm">사용내역(대시보드) 연동</h3>
        <p class="text-xs text-slate-500 mt-0.5">
          가져오기를 누르면 대시보드 거래가 <b class="text-slate-700">월×카테고리</b>로 묶여
          <b class="text-rose-600">지출 합계</b>로 자동 입력됩니다. 같은 (연월, 카테고리)는
          이미 가져왔다면 중복 추가되지 않습니다.
        </p>
        <p class="text-xs text-slate-500 mt-0.5">
          대시보드
          <b class="text-slate-700 tabular-nums">{{ dashboardTxs.length.toLocaleString('ko-KR') }}건</b>
          중 합계 항목
          <b class="text-blue-600 tabular-nums">{{ dashboardImportCount.toLocaleString('ko-KR') }}건</b>
          이 이미 가져와져 있습니다.
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button
          type="button"
          class="btn-secondary text-xs px-3 py-1.5"
          :disabled="dashboardTxs.length === 0"
          @click="onImportFromDashboard"
        >+ 사용내역 가져오기</button>
        <button
          v-if="dashboardImportCount > 0"
          type="button"
          class="btn-secondary text-xs px-3 py-1.5"
          @click="onResyncFromDashboard"
        >↻ 재동기화</button>
        <button
          v-if="dashboardImportCount > 0"
          type="button"
          class="btn-mini-danger text-xs px-3 py-1.5"
          @click="onClearDashboardImports"
        >가져온 항목 제거</button>
      </div>
    </section>

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

    <!-- 수입/지출 입력 -->
    <section class="card">
      <h3 class="font-semibold text-slate-900 mb-4">수입/지출 입력</h3>

      <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
        <!-- 구분 토글 -->
        <div>
          <label class="kpi-label">구분</label>
          <div class="mt-1 inline-flex rounded-md border border-slate-300 overflow-hidden w-full">
            <button
              type="button"
              :class="[
                'flex-1 px-3 py-2 text-sm font-medium transition',
                form.kind === '수입' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              ]"
              @click="form.kind = '수입'"
            >수입</button>
            <button
              type="button"
              :class="[
                'flex-1 px-3 py-2 text-sm font-medium transition border-l border-slate-300',
                form.kind === '지출' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
              ]"
              @click="form.kind = '지출'"
            >지출</button>
          </div>
        </div>

        <!-- 카테고리 -->
        <div>
          <label class="kpi-label">카테고리</label>
          <select v-model="form.category" class="form-input mt-1">
            <option v-for="c in formCategoryOptions" :key="c" :value="c">{{ emoji(c) }} {{ c }}</option>
          </select>
        </div>

        <!-- 금액 -->
        <div>
          <label class="kpi-label">금액</label>
          <div class="relative mt-1">
            <input
              type="number"
              v-model.number="form.amount"
              placeholder="0"
              class="form-input pr-10 text-right tabular-nums"
              @keydown.enter="onSubmit"
            />
            <span class="suffix">원</span>
          </div>
        </div>

        <!-- 날짜 -->
        <div>
          <label class="kpi-label">날짜</label>
          <input type="date" v-model="form.date" class="form-input mt-1" />
        </div>

        <!-- 결제수단 -->
        <div>
          <label class="kpi-label">결제수단</label>
          <select v-model="form.paymentMethod" class="form-input mt-1">
            <option v-for="p in PAYMENT_METHODS" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
      </div>

      <!-- 비고 (전체폭) -->
      <div class="mt-4">
        <label class="kpi-label">비고</label>
        <input
          v-model="form.note"
          type="text"
          placeholder="비고를 입력하세요"
          class="form-input mt-1"
          @keydown.enter="onSubmit"
        />
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="onResetForm">초기화</button>
        <button type="button" class="btn-primary" @click="onSubmit">저장하기</button>
      </div>
    </section>

    <!-- 거래 이력 -->
    <section class="card">
      <h3 class="font-semibold text-slate-900 mb-4">거래 이력</h3>

      <!-- 필터 -->
      <div class="flex flex-wrap items-center gap-2 mb-4">
        <input type="date" v-model="filterDraft.startDate" class="form-input-sm" />
        <span class="text-slate-400 text-xs">~</span>
        <input type="date" v-model="filterDraft.endDate" class="form-input-sm" />
        <select v-model="filterDraft.kind" class="form-input-sm">
          <option value="all">전체 구분</option>
          <option value="수입">수입</option>
          <option value="지출">지출</option>
        </select>
        <select v-model="filterDraft.category" class="form-input-sm">
          <option value="all">전체 카테고리</option>
          <option v-for="c in filterCategoryOptions" :key="c" :value="c">{{ c }}</option>
        </select>
        <select v-model="filterDraft.paymentMethod" class="form-input-sm">
          <option value="all">전체 결제수단</option>
          <option v-for="p in PAYMENT_METHODS" :key="p" :value="p">{{ p }}</option>
        </select>
        <button type="button" class="btn-primary px-5 ml-auto" @click="onApplyFilter">조회</button>
      </div>

      <!-- 통계 카드 3개 -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <div class="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-center">
          <div class="text-xs text-blue-700 mb-1">총 수입</div>
          <div class="text-lg font-bold text-blue-700 tabular-nums">{{ fmtKRW(totalIncome) }}원</div>
        </div>
        <div class="rounded-lg bg-rose-50 border border-rose-100 px-4 py-3 text-center">
          <div class="text-xs text-rose-700 mb-1">총 지출</div>
          <div class="text-lg font-bold text-rose-700 tabular-nums">{{ fmtKRW(totalExpense) }}원</div>
        </div>
        <div class="rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-3 text-center">
          <div class="text-xs text-emerald-700 mb-1">순수익</div>
          <div
            :class="[
              'text-lg font-bold tabular-nums',
              netProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'
            ]"
          >{{ fmtKRW(netProfit) }}원</div>
        </div>
      </div>

      <!-- 뷰 모드 토글 -->
      <div class="mb-3 flex items-center gap-2 flex-wrap">
        <span class="text-xs text-slate-500">표시 방식:</span>
        <div class="inline-flex rounded-md border border-slate-300 overflow-hidden text-xs">
          <button
            type="button"
            :class="[
              'px-3 py-1.5 transition',
              viewMode === 'category' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            ]"
            @click="viewMode = 'category'"
          >카테고리 합산</button>
          <button
            type="button"
            :class="[
              'px-3 py-1.5 border-l border-slate-300 transition',
              viewMode === 'transaction' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            ]"
            @click="viewMode = 'transaction'"
          >거래별 상세</button>
        </div>
        <template v-if="viewMode === 'category' && categoryGroups.length > 0">
          <button type="button" class="text-xs text-slate-500 hover:text-slate-800 ml-2" @click="expandAll">모두 펼치기</button>
          <button type="button" class="text-xs text-slate-500 hover:text-slate-800" @click="collapseAll">모두 접기</button>
          <span class="text-[11px] text-slate-400 ml-auto">{{ categoryGroups.length }}개 카테고리 · 클릭하여 거래 펼치기</span>
        </template>
      </div>

      <!-- 카테고리 합산 테이블 -->
      <div v-if="viewMode === 'category'" class="overflow-x-auto rounded-lg border border-slate-200">
        <!--
          컬럼 폭 고정 (table-layout: fixed).
          카테고리 이름 길이·금액 자릿수·펼침 여부가 달라져도 컬럼 경계가 움직이지 않는다.
          폭을 조정할 일이 생기면 이 colgroup과 아래 .ie-cat-table col 규칙만 고치면 된다.
          남는 폭은 '카테고리'가 가져간다.
        -->
        <table class="ie-table ie-cat-table text-sm">
          <colgroup>
            <col class="cat-col-toggle" />
            <col class="cat-col-kind" />
            <col class="cat-col-name" />
            <col class="cat-col-count" />
            <col class="cat-col-avg" />
            <col class="cat-col-latest" />
            <col class="cat-col-total" />
          </colgroup>
          <thead>
            <tr class="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <th class="py-2 px-3"></th>
              <th class="py-2 px-3">구분</th>
              <th class="py-2 px-3">카테고리</th>
              <th class="py-2 px-3 text-right">건수</th>
              <th class="py-2 px-3 text-right">평균</th>
              <th class="py-2 px-3">최근 일자</th>
              <th class="py-2 px-3 text-right">합계</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in categoryGroups" :key="g.key">
              <!-- 카테고리 합계 행 -->
              <tr class="border-t border-slate-100 hover:bg-slate-50/40 cursor-pointer" @click="toggleExpand(g.key)">
                <td class="py-2 px-3 text-slate-400 text-center">
                  <span class="inline-block transition-transform" :class="expandedKeys.has(g.key) ? 'rotate-90' : ''">▶</span>
                </td>
                <td class="py-2 px-3">
                  <span :class="['kind-badge', g.kind === '수입' ? 'kind-income' : 'kind-expense']">{{ g.kind }}</span>
                </td>
                <td class="py-2 px-3">
                  <span class="cat-cell text-slate-700 font-medium" :title="g.category">
                    <span class="cat-emoji">{{ emoji(g.category) }}</span>
                    <span class="cat-name">{{ g.category }}</span>
                  </span>
                </td>
                <td class="py-2 px-3 text-right tabular-nums text-slate-600">{{ g.count.toLocaleString('ko-KR') }}건</td>
                <td class="py-2 px-3 text-right tabular-nums text-slate-500">{{ fmtKRW(g.avg) }}원</td>
                <td class="py-2 px-3 tabular-nums text-slate-500">{{ g.latestDate || '–' }}</td>
                <td
                  :class="[
                    'py-2 px-3 text-right tabular-nums font-bold text-base',
                    g.kind === '수입' ? 'text-blue-600' : 'text-rose-600'
                  ]"
                >{{ g.kind === '수입' ? '+' : '-' }}{{ fmtKRW(g.total) }}원</td>
              </tr>
              <!-- 펼친 개별 거래 -->
              <template v-if="expandedKeys.has(g.key)">
                <tr v-for="t in g.items" :key="t.id" class="border-t border-slate-50 bg-slate-50/30">
                  <td class="py-1.5 px-3"></td>
                  <td class="py-1.5 px-3 tabular-nums text-slate-500 text-xs">{{ t.date }}</td>
                  <td class="py-1.5 px-3 text-slate-600 text-xs cell-ellipsis" colspan="2" :title="t.description || ''">{{ t.description || '–' }}</td>
                  <td class="py-1.5 px-3 text-slate-500 text-xs cell-ellipsis" colspan="2" :title="t.note ? `${t.paymentMethod} · ${t.note}` : t.paymentMethod">{{ t.paymentMethod }}<span v-if="t.note" class="ml-2 text-slate-400">· {{ t.note }}</span></td>
                  <td
                    :class="[
                      'py-1.5 px-3 text-right tabular-nums text-xs',
                      t.kind === '수입' ? 'text-blue-600' : 'text-rose-600'
                    ]"
                  >{{ fmtSigned(t) }}
                    <button type="button" class="icon-btn icon-edit ml-1" title="수정" @click.stop="startEdit(t); viewMode = 'transaction'">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                    <button type="button" class="icon-btn icon-del" title="삭제" @click.stop="onRemove(t.id)">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
                    </button>
                  </td>
                </tr>
              </template>
            </template>
            <tr v-if="categoryGroups.length === 0">
              <td colspan="7" class="py-10 text-center text-slate-400 text-sm">해당 기간의 거래가 없습니다.</td>
            </tr>
          </tbody>
          <tfoot v-if="categoryGroups.length > 0">
            <tr class="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-700">
              <td class="py-2 px-3" colspan="6">합계 (활성 멤버 · 적용 필터 기준)</td>
              <td class="py-2 px-3 text-right tabular-nums">
                <span class="text-blue-600">+{{ fmtKRW(totalIncome) }}</span>
                <span class="text-slate-400 mx-1">/</span>
                <span class="text-rose-600">-{{ fmtKRW(totalExpense) }}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- 거래별 상세 테이블 -->
      <div v-else class="overflow-x-auto rounded-lg border border-slate-200">
        <!--
          컬럼 폭 고정 (table-layout: fixed).
          이 표는 같은 행이 '보기 행'과 '편집 행(input/select)' 두 모습을 오가므로,
          고정하지 않으면 수정 버튼을 누르는 순간 컬럼이 통째로 밀린다.
          '날짜'는 <input type="date">가 들어갈 폭(148px)을 기준으로 잡았다 — 더 줄이면 편집 행에서 잘린다.
          남는 폭은 '내용'과 '비고'가 나눠 가진다.
        -->
        <table class="ie-table ie-tx-table text-sm">
          <colgroup>
            <col class="tx-col-date" />
            <col class="tx-col-kind" />
            <col class="tx-col-category" />
            <col class="tx-col-desc" />
            <col class="tx-col-payment" />
            <col class="tx-col-amount" />
            <col class="tx-col-note" />
            <col class="tx-col-actions" />
          </colgroup>
          <thead>
            <tr class="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <th class="py-2 px-3">날짜</th>
              <th class="py-2 px-3">구분</th>
              <th class="py-2 px-3">카테고리</th>
              <th class="py-2 px-3">내용</th>
              <th class="py-2 px-3">결제수단</th>
              <th class="py-2 px-3 text-right">금액</th>
              <th class="py-2 px-3">비고</th>
              <th class="py-2 px-3 text-center">관리</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="t in visibleRows" :key="t.id">
              <!-- 일반 행 -->
              <tr v-if="editingId !== t.id" class="border-t border-slate-100 hover:bg-slate-50/40">
                <td class="py-2 px-3 tabular-nums text-slate-700">{{ t.date }}</td>
                <td class="py-2 px-3">
                  <span :class="['kind-badge', t.kind === '수입' ? 'kind-income' : 'kind-expense']">{{ t.kind }}</span>
                </td>
                <td class="py-2 px-3">
                  <span class="cat-cell text-slate-700" :title="t.category">
                    <span class="cat-emoji">{{ emoji(t.category) }}</span>
                    <span class="cat-name">{{ t.category }}</span>
                  </span>
                </td>
                <td class="py-2 px-3 text-slate-700 cell-ellipsis" :title="t.description || ''">{{ t.description || '–' }}</td>
                <td class="py-2 px-3 text-slate-600 cell-ellipsis" :title="t.paymentMethod">{{ t.paymentMethod }}</td>
                <td
                  :class="[
                    'py-2 px-3 text-right tabular-nums font-semibold',
                    t.kind === '수입' ? 'text-blue-600' : 'text-rose-600'
                  ]"
                >{{ fmtSigned(t) }}</td>
                <td class="py-2 px-3 text-slate-500 cell-ellipsis" :title="t.note || ''">{{ t.note || '–' }}</td>
                <td class="py-2 px-3 text-center whitespace-nowrap">
                  <button type="button" class="icon-btn icon-edit" title="수정" @click="startEdit(t)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button type="button" class="icon-btn icon-del" title="삭제" @click="onRemove(t.id)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                  </button>
                </td>
              </tr>
              <!-- 편집 행 -->
              <tr v-else class="border-t border-slate-100 bg-amber-50/40">
                <td class="py-2 px-3"><input type="date" v-model="editDraft.date" class="form-input-sm" /></td>
                <td class="py-2 px-3">
                  <select v-model="editDraft.kind" class="form-input-sm">
                    <option value="수입">수입</option>
                    <option value="지출">지출</option>
                  </select>
                </td>
                <td class="py-2 px-3">
                  <select v-model="editDraft.category" class="form-input-sm">
                    <option v-for="c in editCategoryOptions" :key="c" :value="c">{{ c }}</option>
                  </select>
                </td>
                <td class="py-2 px-3"><input type="text" v-model="editDraft.description" class="form-input-sm" /></td>
                <td class="py-2 px-3">
                  <select v-model="editDraft.paymentMethod" class="form-input-sm">
                    <option v-for="p in PAYMENT_METHODS" :key="p" :value="p">{{ p }}</option>
                  </select>
                </td>
                <td class="py-2 px-3 text-right">
                  <input type="number" v-model.number="editDraft.amount" class="form-input-sm text-right tabular-nums" />
                </td>
                <td class="py-2 px-3"><input type="text" v-model="editDraft.note" class="form-input-sm" /></td>
                <td class="py-2 px-3 text-center whitespace-nowrap">
                  <button type="button" class="btn-mini-primary" @click="commitEdit">저장</button>
                  <button type="button" class="btn-mini ml-1" @click="cancelEdit">취소</button>
                </td>
              </tr>
            </template>
            <tr v-if="sortedRows.length === 0">
              <td colspan="8" class="py-10 text-center text-slate-400 text-sm">
                해당 기간의 거래가 없습니다.
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 페이지네이션 (거래별 모드만) -->
      <div v-if="viewMode === 'transaction' && sortedRows.length > 0" class="mt-4 flex items-center justify-center gap-2 text-xs">
        <button type="button" class="page-btn" :disabled="page === 1" @click="page = Math.max(1, page - 1)" title="이전">‹</button>
        <button
          v-for="p in pageCount"
          :key="p"
          type="button"
          :class="['page-btn', p === page ? 'page-btn-active' : '']"
          @click="page = p"
        >{{ p }}</button>
        <button type="button" class="page-btn" :disabled="page === pageCount" @click="page = Math.min(pageCount, page + 1)" title="다음">›</button>
        <select v-model.number="pageSize" class="ml-3 rounded-md border-slate-300 text-xs py-1">
          <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}개씩 보기</option>
        </select>
      </div>
    </section>
  </div>
</template>

<style scoped>
.form-input {
  @apply w-full rounded-md border-slate-300 text-sm focus:border-brand-500 focus:ring-brand-500;
}
.form-input-sm {
  @apply rounded-md border-slate-300 text-xs py-1.5 focus:border-brand-500 focus:ring-brand-500;
}
.suffix {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: rgb(148 163 184);
  pointer-events: none;
}
.btn-primary {
  @apply px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50;
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
/* ─────────────────────────────────────────
 * 거래 이력 테이블 — 컬럼 폭 고정
 *
 * table-layout: fixed 이면 브라우저가 셀 내용을 재지 않고 colgroup 폭만 본다.
 * 그래서 카테고리 이름이 길어지거나, 금액 자릿수가 달라지거나, 페이지를 넘기거나,
 * 행이 편집 모드(input/select)로 바뀌어도 컬럼 경계가 움직이지 않는다.
 *
 * 폭이 부족해 잘리는 건 말줄임(.cell-ellipsis / .cat-name)으로 처리하고
 * 전체 내용은 title 툴팁으로 볼 수 있게 한다.
 *
 * min-width는 고정폭 합 + auto 컬럼 몫이다. 화면이 더 좁으면 바깥
 * overflow-x-auto 래퍼가 가로 스크롤을 만든다.
 * ───────────────────────────────────────── */
.ie-table {
  table-layout: fixed;
  width: 100%;
}

/*
 * 카테고리 합산 — 고정분 692px + 합계(auto)
 *
 * 남는 폭을 가져가는 auto 컬럼은 '합계'다. 처음엔 '카테고리'를 auto로 뒀는데,
 * 이 표에서 auto 컬럼이 하나뿐이라 넓은 화면에서 남는 폭을 전부 흡수해
 * 카테고리 한 컬럼만 800px 넘게 늘어났다. 카테고리 이름은 길어야 열 글자 남짓이므로
 * 240px로 고정하고, 남는 폭은 우측 정렬 숫자인 '합계'가 받도록 바꿨다
 * (숫자 컬럼은 여백이 늘어도 어색하지 않다).
 */
.ie-cat-table { min-width: 860px; }
.cat-col-toggle { width: 36px; }
.cat-col-kind   { width: 88px; }
.cat-col-name   { width: 240px; }
.cat-col-count  { width: 88px; }
.cat-col-avg    { width: 128px; }
.cat-col-latest { width: 112px; }
.cat-col-total  { width: auto; min-width: 168px; }

/*
 * 거래별 상세 — 고정분 720px + 내용·비고(auto)
 * auto 컬럼이 둘이라 남는 폭을 나눠 가진다 — 한 컬럼만 길어지지 않는다.
 */
.ie-tx-table { min-width: 1060px; }
.tx-col-date     { width: 148px; }  /* <input type="date"> 기준 — 더 줄이면 편집 행에서 잘린다 */
.tx-col-kind     { width: 88px; }
.tx-col-category { width: 132px; }
.tx-col-desc     { width: auto; }
.tx-col-payment  { width: 132px; }
.tx-col-amount   { width: 132px; }
.tx-col-note     { width: auto; }
.tx-col-actions  { width: 88px; }

/* 고정 폭을 넘는 텍스트는 한 줄 말줄임 — 행 높이가 들쭉날쭉해지지 않게 */
.ie-table .cell-ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 이모지 + 카테고리명 — 이모지는 줄지 않고 이름만 말줄임된다 */
.cat-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cat-emoji {
  flex: 0 0 auto;
  font-size: 1rem;
  line-height: 1;
}
.cat-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 편집 행의 입력 요소는 셀 폭을 넘지 않게 한다.
 * table-layout: fixed 에서는 intrinsic 폭이 큰 <input type="date"> 같은 요소가
 * 셀 밖으로 삐져나오므로 명시적으로 100%로 묶어 둔다.
 */
.ie-table td .form-input-sm {
  width: 100%;
  min-width: 0;
}

.kind-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 500;
}
.kind-income {
  background: rgb(219 234 254);
  color: rgb(29 78 216);
}
.kind-expense {
  background: rgb(254 226 226);
  color: rgb(185 28 28);
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s ease;
  border: 1px solid transparent;
}
.icon-edit { color: rgb(37 99 235); }
.icon-edit:hover { background: rgb(239 246 255); }
.icon-del { color: rgb(220 38 38); margin-left: 2px; }
.icon-del:hover { background: rgb(254 242 242); }
.page-btn {
  min-width: 28px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid rgb(203 213 225);
  border-radius: 6px;
  background: #fff;
  color: rgb(71 85 105);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.page-btn:hover:not(:disabled) {
  background: rgb(248 250 252);
  border-color: rgb(148 163 184);
}
.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.page-btn-active,
.page-btn-active:hover {
  background: rgb(37 99 235);
  border-color: rgb(37 99 235);
  color: #fff;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
