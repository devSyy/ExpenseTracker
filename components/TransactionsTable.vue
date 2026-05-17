<script setup lang="ts">
// 거래 내역 테이블.
// 카테고리/결제수단/구분 셀은 모두 인라인 <select>로 즉시 편집 가능하다.
// 변경 즉시 useExpenses.updateTransaction()을 호출해 전역 상태를 갱신한다.
import { computed, ref, watch } from 'vue'
import { useExpenses } from '~/composables/useExpenses'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { formatDate, formatKRW } from '~/utils/format'
import type { CostType, Transaction } from '~/utils/types'

const {
  filtered,
  updateTransaction,
  updateByDescription,
  addTransaction,
  saveToStorage,
  lastSavedAt,
  transactions
} = useExpenses()
const { visibleCategoryNames, visiblePaymentNames } = useTaxonomies()

// ── 카테고리 칩 필터 (테이블 로컬, 다중 선택) ──
// FiltersBar의 단일 선택 카테고리 필터와 별개로, 거래내역에서 빠르게 여러 카테고리를
// 토글할 수 있도록 하는 다중 선택 필터. 빈 Set = 필터 미적용(전체).
const selectedCategories = ref<Set<string>>(new Set())

function toggleCategoryChip(name: string) {
  const next = new Set(selectedCategories.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selectedCategories.value = next
}
function clearCategoryChips() {
  if (selectedCategories.value.size > 0) selectedCategories.value = new Set()
}

// 칩으로 노출할 카테고리: 활성 + 현재 filtered에 등장한 항목만(빈 카테고리는 노이즈가 됨).
// 각 칩에 표시할 카운트도 함께 계산.
const categoryChips = computed<Array<{ name: string; count: number }>>(() => {
  const counts = new Map<string, number>()
  for (const t of filtered.value) {
    counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
  }
  return visibleCategoryNames.value
    .filter((c) => counts.has(c))
    .map((c) => ({ name: c, count: counts.get(c) ?? 0 }))
    .sort((a, b) => b.count - a.count)
})

// FiltersBar(전역) 위에 칩 필터를 한 번 더 적용한 결과
const chipFiltered = computed<Transaction[]>(() => {
  if (selectedCategories.value.size === 0) return filtered.value
  return filtered.value.filter((t) => selectedCategories.value.has(t.category))
})

// ── 테이블 로컬 검색 ──
// FiltersBar의 전역 검색과 별도로, 거래내역 테이블에서만 빠르게 좁혀볼 수 있는 검색.
// 내용/카테고리/소분류/결제수단/메모 모두 부분 일치(공백 구분 다중 토큰 지원, AND).
const tableSearch = ref<string>('')

function clearTableSearch() { tableSearch.value = '' }

const searchTokens = computed<string[]>(() =>
  tableSearch.value.trim().toLowerCase().split(/\s+/).filter((t) => t.length > 0)
)

function matchesSearch(t: Transaction): boolean {
  if (searchTokens.value.length === 0) return true
  const haystack = [
    t.description, t.category, t.paymentMethod, t.costType,
    t.note ?? '', String(t.amount)
  ].join(' ').toLowerCase()
  // 모든 토큰이 포함되어야 매치 (AND)
  return searchTokens.value.every((tok) => haystack.includes(tok))
}

const searchFiltered = computed<Transaction[]>(() =>
  searchTokens.value.length === 0 ? chipFiltered.value : chipFiltered.value.filter(matchesSearch)
)

// ── 정렬 ──
// 날짜/금액 컬럼 헤더 클릭으로 토글. 같은 키 재클릭 시 방향 전환, 다른 키면 desc로 시작.
type SortKey = 'date' | 'amount'
type SortDir = 'asc' | 'desc'
const sortKey = ref<SortKey>('date')
const sortDir = ref<SortDir>('desc')

function setSort(key: SortKey) {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}
function sortIndicator(key: SortKey): string {
  if (sortKey.value !== key) return '↕'
  return sortDir.value === 'asc' ? '↑' : '↓'
}

const tableFiltered = computed<Transaction[]>(() => {
  const arr = searchFiltered.value.slice()
  const dir = sortDir.value === 'asc' ? 1 : -1
  arr.sort((a, b) => {
    if (sortKey.value === 'date') {
      const diff = a.date.getTime() - b.date.getTime()
      // 날짜가 같으면 id로 안정 정렬 (입력 순서 유지)
      return diff !== 0 ? diff * dir : a.id.localeCompare(b.id)
    }
    // amount
    const diff = a.amount - b.amount
    return diff !== 0 ? diff * dir : a.date.getTime() - b.date.getTime()
  })
  return arr
})

// ── 페이지네이션 ──
// 기존엔 상위 N건만 잘라 보여줘서 500건 이후 거래에 접근할 수 없었다.
// 이제 페이지네이션으로 전체 데이터를 순회 가능.
const PAGE_SIZES = [20, 50, 100, 500] as const
const pageSize = ref<number>(20)
const page = ref<number>(1)

const total = computed(() => tableFiltered.value.length)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))

const startIdx = computed(() => (page.value - 1) * pageSize.value)
const endIdx = computed(() => Math.min(startIdx.value + pageSize.value, total.value))

const visible = computed(() => tableFiltered.value.slice(startIdx.value, endIdx.value))

// 필터/페이지크기 변경 시 첫 페이지로 이동, 범위 벗어나면 보정
watch([total, pageSize], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
  if (page.value < 1) page.value = 1
})
watch(pageSize, () => { page.value = 1 })
// 칩 필터 토글 시 1페이지로 리셋
watch(selectedCategories, () => { page.value = 1 })
// 정렬 변경 시 1페이지로 리셋
watch([sortKey, sortDir], () => { page.value = 1 })
// 테이블 검색어 변경 시 1페이지로 리셋
watch(tableSearch, () => { page.value = 1 })

function goFirst() { page.value = 1 }
function goPrev()  { if (page.value > 1) page.value-- }
function goNext()  { if (page.value < pageCount.value) page.value++ }
function goLast()  { page.value = pageCount.value }
function goPage(p: number) {
  const n = Math.floor(p)
  if (Number.isFinite(n) && n >= 1 && n <= pageCount.value) page.value = n
}

// 표시할 페이지 번호 윈도우 (현재 페이지 기준 ±2, 최대 5개)
const pageWindow = computed<number[]>(() => {
  const last = pageCount.value
  const cur = page.value
  let from = Math.max(1, cur - 2)
  let to = Math.min(last, from + 4)
  from = Math.max(1, to - 4)
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
})

const COST_TYPES: CostType[] = ['고정비', '변동비']

function onChangeCategory(id: string, value: string) {
  // 같은 내용(가맹점·항목)을 가진 모든 거래의 카테고리를 함께 갱신
  const tx = transactions.value.find((t) => t.id === id)
  if (!tx) return
  const n = updateByDescription(tx.description, { category: value })
  if (n > 1) flashMsg(`카테고리 일괄 변경: '${tx.description}' ${n}건 → ${value}`)
}
function onChangePayment(id: string, value: string) {
  updateTransaction(id, { paymentMethod: value })
}
function onChangeCostType(id: string, value: string) {
  if (value !== '고정비' && value !== '변동비') return
  // 같은 내용(가맹점·항목)을 가진 모든 거래의 구분을 함께 갱신
  const tx = transactions.value.find((t) => t.id === id)
  if (!tx) return
  const n = updateByDescription(tx.description, { costType: value })
  if (n > 1) flashMsg(`구분 일괄 변경: '${tx.description}' ${n}건 → ${value}`)
}

// ───────── 저장하기 ─────────
const saveMessage = ref<string>('')
let saveMsgTimer: number | undefined
function flashMsg(msg: string) {
  saveMessage.value = msg
  if (saveMsgTimer) window.clearTimeout(saveMsgTimer)
  saveMsgTimer = window.setTimeout(() => (saveMessage.value = ''), 2400) as unknown as number
}
function onSave() {
  const r = saveToStorage()
  flashMsg(r.ok ? `저장 완료 · ${r.count.toLocaleString('ko-KR')}건` : `저장 실패: ${r.reason ?? ''}`)
}

const lastSavedLabel = computed(() => {
  if (!lastSavedAt.value) return '저장된 데이터 없음'
  const d = lastSavedAt.value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `최근 저장: ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

// ───────── 수기 추가 ─────────
const showAddForm = ref(false)
function emptyDraft() {
  return {
    date: new Date().toISOString().slice(0, 10),
    description: '',
    amount: 0 as number | string,
    category: '기타' as string,
    paymentMethod: '기타결제' as string,
    costType: '변동비' as CostType,
    note: ''
  }
}
const draft = ref(emptyDraft())
const addError = ref<string>('')

function toggleAddForm() {
  showAddForm.value = !showAddForm.value
  if (showAddForm.value) draft.value = emptyDraft()
  addError.value = ''
}

function onSubmitAdd() {
  addError.value = ''
  const amt = Number(draft.value.amount)
  if (!draft.value.date) { addError.value = '날짜를 입력하세요'; return }
  if (!Number.isFinite(amt) || amt <= 0) { addError.value = '금액은 양수여야 합니다'; return }
  const tx = addTransaction({
    date: draft.value.date,
    description: draft.value.description,
    amount: amt,
    category: draft.value.category,
    paymentMethod: draft.value.paymentMethod,
    costType: draft.value.costType,
    note: draft.value.note
  })
  if (!tx) { addError.value = '추가에 실패했습니다'; return }
  flashMsg(`거래 추가됨 · 1건 (저장 누름 시 영구 보관)`)
  // 폼 초기화 후 닫기 (연속 입력 시엔 다시 열 수 있도록)
  draft.value = emptyDraft()
  showAddForm.value = false
}

// 폼 옵션: visible 목록 + 현재 draft 값이 숨김/외부면 임시 노출
const draftCategoryOptions = computed<string[]>(() => {
  const list = visibleCategoryNames.value
  return list.includes(draft.value.category) ? list : [...list, draft.value.category]
})
const draftPaymentOptions = computed<string[]>(() => {
  const list = visiblePaymentNames.value
  return list.includes(draft.value.paymentMethod) ? list : [...list, draft.value.paymentMethod]
})

const txCount = computed(() => transactions.value.length)
</script>

<template>
  <section class="card overflow-hidden">
    <!--
      헤더 영역 모바일 컴팩트화:
      - <sm: 제목/도움말 한 줄, 액션 영역(추가/저장/페이지크기)은 그 아래 한 줄로 묶음
      - 페이지크기는 모바일에서 select(공간 1/4 수준), sm+에서는 토글 버튼 4개
      - 도움말 부연(셀 직접 클릭…)은 모바일에서 숨김 — 텍스트가 화면을 잡아먹음
     -->
    <div class="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between flex-wrap gap-2">
      <div class="min-w-0">
        <h3 class="font-semibold text-slate-900">거래 내역</h3>
        <p class="text-xs text-slate-500">
          필터 적용 결과 · 총 {{ total.toLocaleString('ko-KR') }}건
          <span class="hidden sm:inline text-slate-400">· 카테고리·결제수단·구분 셀을 직접 클릭해 변경할 수 있습니다</span>
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="hidden sm:inline text-[11px] text-slate-400 mr-1">{{ lastSavedLabel }}</span>
        <button type="button" class="btn-action btn-action-add" @click="toggleAddForm">
          {{ showAddForm ? '× 닫기' : '+ 추가' }}
        </button>
        <button
          type="button"
          class="btn-action btn-action-save"
          :disabled="txCount === 0"
          :title="txCount === 0 ? '저장할 거래가 없습니다' : '거래내역을 브라우저에 영구 저장합니다'"
          @click="onSave"
        >
          저장
        </button>
        <!-- 모바일: select / sm+: 토글 버튼 그룹 -->
        <select
          v-model.number="pageSize"
          class="sm:hidden text-xs rounded-md border-slate-300 py-1 pr-7"
          aria-label="페이지당 행 수"
        >
          <option v-for="n in PAGE_SIZES" :key="n" :value="n">{{ n }}행</option>
        </select>
        <div class="hidden sm:flex text-xs gap-1">
          <button
            v-for="n in PAGE_SIZES"
            :key="n"
            type="button"
            :class="[
              'px-2.5 py-1 rounded-md border',
              pageSize === n ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-300'
            ]"
            @click="pageSize = n"
          >
            {{ n }}행
          </button>
        </div>
      </div>
    </div>

    <!-- 저장 결과 토스트 (인라인) -->
    <div
      v-if="saveMessage"
      class="mb-2 inline-block px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs"
    >
      {{ saveMessage }}
    </div>

    <!-- 거래 검색 -->
    <div class="mb-3 flex items-center gap-2 flex-wrap">
      <div class="relative flex-1 min-w-[16rem] max-w-md">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          v-model="tableSearch"
          type="text"
          placeholder="거래 검색 — 내용·가맹점·카테고리·결제수단·메모·금액"
          class="search-input"
        />
        <button
          v-if="tableSearch"
          type="button"
          class="search-clear"
          title="검색어 지우기"
          @click="clearTableSearch"
        >×</button>
      </div>
      <span v-if="tableSearch.trim()" class="text-[11px] text-slate-500 tabular-nums">
        {{ total.toLocaleString('ko-KR') }}건 일치
      </span>
    </div>

    <!-- 카테고리 칩 필터 -->
    <div v-if="categoryChips.length > 0" class="mb-3 flex items-center gap-1.5 flex-wrap">
      <span class="text-[11px] font-medium text-slate-500 mr-1">카테고리:</span>
      <button
        type="button"
        :class="['cat-chip', selectedCategories.size === 0 ? 'cat-chip-active' : '']"
        @click="clearCategoryChips"
        title="전체 보기"
      >
        전체
      </button>
      <button
        v-for="c in categoryChips"
        :key="c.name"
        type="button"
        :class="['cat-chip', selectedCategories.has(c.name) ? 'cat-chip-active' : '']"
        @click="toggleCategoryChip(c.name)"
        :title="`${c.name} · ${c.count.toLocaleString('ko-KR')}건`"
      >
        {{ c.name }}
        <span class="cat-chip-count">{{ c.count }}</span>
      </button>
      <button
        v-if="selectedCategories.size > 0"
        type="button"
        class="ml-1 text-[11px] text-slate-500 hover:text-slate-700 underline"
        @click="clearCategoryChips"
      >
        선택 해제
      </button>
    </div>

    <!-- 수기 추가 폼 -->
    <div
      v-if="showAddForm"
      class="mb-3 p-3 rounded-lg border border-slate-200 bg-slate-50/60"
    >
      <div class="text-xs font-semibold text-slate-700 mb-2">새 거래 추가</div>
      <div class="grid grid-cols-1 md:grid-cols-6 gap-2 text-sm">
        <div class="md:col-span-1">
          <label class="kpi-label">날짜</label>
          <input v-model="draft.date" type="date" class="mt-1 w-full rounded-md border-slate-300 text-sm" />
        </div>
        <div class="md:col-span-2">
          <label class="kpi-label">내용</label>
          <input v-model="draft.description" type="text" placeholder="가맹점·메모" class="mt-1 w-full rounded-md border-slate-300 text-sm" />
        </div>
        <div class="md:col-span-1">
          <label class="kpi-label">금액(원)</label>
          <input v-model.number="draft.amount" type="number" min="0" step="1" class="mt-1 w-full rounded-md border-slate-300 text-sm text-right tabular-nums" />
        </div>
        <div class="md:col-span-1">
          <label class="kpi-label">카테고리</label>
          <select v-model="draft.category" class="mt-1 w-full rounded-md border-slate-300 text-sm">
            <option v-for="c in draftCategoryOptions" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="md:col-span-1">
          <label class="kpi-label">결제수단</label>
          <select v-model="draft.paymentMethod" class="mt-1 w-full rounded-md border-slate-300 text-sm">
            <option v-for="p in draftPaymentOptions" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="md:col-span-1">
          <label class="kpi-label">구분</label>
          <select v-model="draft.costType" class="mt-1 w-full rounded-md border-slate-300 text-sm">
            <option value="변동비">변동비</option>
            <option value="고정비">고정비</option>
          </select>
        </div>
        <div class="md:col-span-3">
          <label class="kpi-label">메모(선택)</label>
          <input v-model="draft.note" type="text" class="mt-1 w-full rounded-md border-slate-300 text-sm" />
        </div>
        <div class="md:col-span-2 flex items-end gap-2">
          <button type="button" class="btn-action btn-action-add flex-1" @click="onSubmitAdd">추가</button>
          <button type="button" class="btn-action" @click="toggleAddForm">취소</button>
        </div>
      </div>
      <div v-if="addError" class="mt-2 text-xs text-rose-600">{{ addError }}</div>
      <div class="mt-2 text-[11px] text-slate-400">
        추가만으로는 메모리에만 반영됩니다. 다음 방문에도 유지하려면 위 <b>저장하기</b>를 누르세요.
      </div>
    </div>

    <!--
      좁은 화면에서는 가로 스크롤로 처리하되, 헤더는 sticky로 고정해
      많은 행을 스크롤 시 어떤 컬럼인지 항상 보이도록.
      max-height는 viewport 비례로 두어 큰 모니터에선 더 많은 행이 보인다.
     -->
    <div class="overflow-auto max-h-[clamp(420px,60vh,720px)] -mx-1 px-1">
      <table class="min-w-[720px] w-full text-sm">
        <thead class="sticky top-0 z-10 bg-white">
          <tr class="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <th class="py-2 pr-3">
              <button
                type="button"
                :class="['sort-th', sortKey === 'date' ? 'sort-th-active' : '']"
                @click="setSort('date')"
                :title="sortKey === 'date' ? `날짜 ${sortDir === 'asc' ? '오름차순' : '내림차순'}` : '날짜로 정렬'"
              >
                날짜 <span class="sort-arrow">{{ sortIndicator('date') }}</span>
              </button>
            </th>
            <th class="py-2 pr-3">내용</th>
            <th class="py-2 pr-3">카테고리</th>
            <th class="py-2 pr-3">결제수단</th>
            <th class="py-2 pr-3">구분</th>
            <th class="py-2 pr-3 text-right">
              <button
                type="button"
                :class="['sort-th sort-th-right', sortKey === 'amount' ? 'sort-th-active' : '']"
                @click="setSort('amount')"
                :title="sortKey === 'amount' ? `금액 ${sortDir === 'asc' ? '오름차순' : '내림차순'}` : '금액으로 정렬'"
              >
                <span class="sort-arrow">{{ sortIndicator('amount') }}</span> 금액
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="t in visible"
            :key="t.id"
            class="border-b border-slate-100 hover:bg-slate-50/60"
          >
            <td class="py-2 pr-3 tabular-nums text-slate-600 whitespace-nowrap">{{ formatDate(t.date) }}</td>
            <td class="py-2 pr-3 text-slate-900 max-w-[24rem] truncate" :title="t.description">{{ t.description }}</td>

            <!-- 카테고리: 인라인 select (chip 스타일) — 숨김 항목은 옵션에서 제외하되 현재값은 보존 -->
            <td class="py-2 pr-3">
              <select
                class="cell-select bg-slate-100 text-slate-700"
                :value="t.category"
                @change="onChangeCategory(t.id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="!visibleCategoryNames.includes(t.category)" :value="t.category">
                  {{ t.category }} (숨김/외부)
                </option>
                <option v-for="c in visibleCategoryNames" :key="c" :value="c">{{ c }}</option>
              </select>
            </td>

            <!-- 결제수단: 인라인 select -->
            <td class="py-2 pr-3">
              <select
                class="cell-select bg-white text-slate-700"
                :value="t.paymentMethod"
                @change="onChangePayment(t.id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="!visiblePaymentNames.includes(t.paymentMethod)" :value="t.paymentMethod">
                  {{ t.paymentMethod }} (숨김/외부)
                </option>
                <option v-for="p in visiblePaymentNames" :key="p" :value="p">{{ p }}</option>
              </select>
            </td>

            <!-- 구분: 인라인 select (고정비/변동비 색상 유지) -->
            <td class="py-2 pr-3">
              <select
                :class="[
                  'cell-select',
                  t.costType === '고정비' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-700'
                ]"
                :value="t.costType"
                @change="onChangeCostType(t.id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="ct in COST_TYPES" :key="ct" :value="ct">{{ ct }}</option>
              </select>
            </td>

            <td class="py-2 pr-3 text-right tabular-nums font-medium text-slate-900">
              {{ formatKRW(t.amount) }}
            </td>
          </tr>
          <tr v-if="visible.length === 0">
            <td colspan="6" class="py-8 text-center text-slate-400 text-sm">
              표시할 거래가 없습니다.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 페이지네이션 컨트롤 -->
    <div v-if="total > 0" class="mt-3 flex items-center justify-between flex-wrap gap-2 text-xs">
      <div class="text-slate-500 tabular-nums">
        {{ (startIdx + 1).toLocaleString('ko-KR') }}–{{ endIdx.toLocaleString('ko-KR') }}
        <span class="text-slate-400">/ 총 {{ total.toLocaleString('ko-KR') }}건</span>
      </div>
      <div class="flex items-center gap-1">
        <button type="button" class="page-btn" :disabled="page === 1" @click="goFirst" title="처음">«</button>
        <button type="button" class="page-btn" :disabled="page === 1" @click="goPrev" title="이전">‹</button>

        <button
          v-for="p in pageWindow"
          :key="p"
          type="button"
          :class="['page-btn', p === page ? 'page-btn-active' : '']"
          @click="goPage(p)"
        >{{ p }}</button>

        <button type="button" class="page-btn" :disabled="page === pageCount" @click="goNext" title="다음">›</button>
        <button type="button" class="page-btn" :disabled="page === pageCount" @click="goLast" title="마지막">»</button>

        <span class="ml-2 text-slate-400 tabular-nums">{{ page }} / {{ pageCount }}</span>

        <!-- 페이지 번호 직접 입력: 모바일에선 숨김 (페이지 버튼만으로 충분, 공간 절약) -->
        <input
          type="number"
          min="1"
          :max="pageCount"
          :value="page"
          @change="goPage(Number(($event.target as HTMLInputElement).value))"
          @keydown.enter="goPage(Number(($event.target as HTMLInputElement).value))"
          class="hidden sm:inline-block ml-2 w-16 rounded-md border-slate-300 text-xs text-center tabular-nums"
          title="페이지 번호로 이동"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 거래 검색 인풋 */
.search-input {
  width: 100%;
  padding: 7px 30px 7px 32px;
  border: 1px solid rgb(203 213 225);
  border-radius: 8px;
  font-size: 12.5px;
  color: rgb(15 23 42);
  background: #fff;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
}
.search-input::placeholder { color: rgb(148 163 184); }
.search-input:focus {
  outline: none;
  border-color: rgb(37 99 235);
  box-shadow: 0 0 0 2px rgb(199 210 254);
}
.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: rgb(148 163 184);
  pointer-events: none;
}
.search-clear {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgb(241 245 249);
  color: rgb(71 85 105);
  border: none;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: grid;
  place-items: center;
}
.search-clear:hover {
  background: rgb(226 232 240);
  color: rgb(15 23 42);
}

/* 정렬 가능한 컬럼 헤더 버튼 */
.sort-th {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 6px;
  margin: -2px -6px;
  border-radius: 4px;
  background: transparent;
  border: none;
  color: inherit;
  font-size: inherit;
  font-weight: inherit;
  text-transform: inherit;
  letter-spacing: inherit;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.sort-th:hover {
  background: rgb(241 245 249);
  color: rgb(15 23 42);
}
.sort-th-right { float: right; }
.sort-th-active {
  color: rgb(37 99 235);
  font-weight: 600;
}
.sort-arrow {
  font-size: 11px;
  opacity: 0.7;
}
.sort-th-active .sort-arrow { opacity: 1; }

/* 카테고리 칩 필터 */
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border: 1px solid rgb(226 232 240);
  border-radius: 9999px;
  background: #fff;
  color: rgb(71 85 105);
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
}
.cat-chip:hover {
  background: rgb(248 250 252);
  border-color: rgb(148 163 184);
  color: rgb(15 23 42);
}
.cat-chip-active,
.cat-chip-active:hover {
  background: rgb(15 23 42);
  border-color: rgb(15 23 42);
  color: #fff;
}
.cat-chip-count {
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9999px;
  background: rgb(226 232 240);
  color: rgb(71 85 105);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.cat-chip-active .cat-chip-count {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

/* 액션 버튼 (저장/추가) */
.btn-action {
  padding: 0.375rem 0.75rem;
  border-radius: 6px;
  border: 1px solid rgb(203 213 225);
  background: #fff;
  color: rgb(71 85 105);
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}
.btn-action:hover:not(:disabled) {
  background: rgb(248 250 252);
}
.btn-action:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-action-save {
  background: rgb(15 23 42);
  border-color: rgb(15 23 42);
  color: #fff;
}
.btn-action-save:hover:not(:disabled) {
  background: rgb(30 41 59);
  border-color: rgb(30 41 59);
}
.btn-action-add {
  background: rgb(239 246 255);
  border-color: rgb(191 219 254);
  color: rgb(29 78 216);
}
.btn-action-add:hover:not(:disabled) {
  background: rgb(219 234 254);
}

/* 페이지네이션 버튼 */
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
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.page-btn-active,
.page-btn-active:hover {
  background: rgb(15 23 42);
  border-color: rgb(15 23 42);
  color: #fff;
}

/* select가 chip처럼 보이도록 — 테두리 제거하고 컴팩트하게 */
.cell-select {
  appearance: none;
  -webkit-appearance: none;
  -moz-appearance: none;
  border: 1px solid transparent;
  border-radius: 9999px;
  padding: 0.125rem 1.5rem 0.125rem 0.625rem;
  font-size: 0.75rem;
  line-height: 1.25;
  font-weight: 500;
  cursor: pointer;
  background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2210%22%20height%3D%226%22%20viewBox%3D%220%200%2010%206%22%3E%3Cpath%20fill%3D%22%2364748b%22%20d%3D%22M0%200l5%206%205-6z%22%2F%3E%3C%2Fsvg%3E");
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
  background-size: 8px 5px;
  transition: border-color 0.12s ease, box-shadow 0.12s ease;
  max-width: 12rem;
}
.cell-select:hover {
  border-color: rgb(203 213 225);
}
.cell-select:focus {
  outline: none;
  border-color: rgb(99 102 241);
  box-shadow: 0 0 0 2px rgb(199 210 254);
}
</style>
