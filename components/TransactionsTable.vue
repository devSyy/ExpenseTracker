<script setup lang="ts">
// 거래 내역 테이블.
// 카테고리/결제수단/구분 셀은 모두 인라인 <select>로 즉시 편집 가능하다.
// 변경 즉시 useExpenses.updateTransaction()을 호출해 전역 상태를 갱신한다.
import { computed, ref, watch } from 'vue'
import { useExpenses, type UpdateScope } from '~/composables/useExpenses'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { formatDate, formatKRW } from '~/utils/format'
import type { CostType, Transaction } from '~/utils/types'

const {
  filtered,
  filteredAll,
  excludedCount,
  excludedAmount,
  isExcluded,
  isRefund,
  isRefundCategory,
  isNegativeAmount,
  refundCount,
  refundAmount,
  unmatchedNegativeCount,
  setExcluded,
  setExcludedMany,
  removeTransactions,
  updateTransaction,
  updateByDescription,
  countRelated,
  updateCategoryScoped,
  addTransaction,
  saveToStorage,
  lastSavedAt,
  unsavedChanges,
  transactions
} = useExpenses()
const {
  visibleCategoryNames,
  visiblePaymentNames,
  visibleIncomeCategoryNames,
  visibleExpenseCategoryNames,
  isIncomeCategory
} = useTaxonomies()

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
  for (const t of filteredAll.value) {
    counts.set(t.category, (counts.get(t.category) ?? 0) + 1)
  }
  return visibleCategoryNames.value
    .filter((c) => counts.has(c))
    .map((c) => ({ name: c, count: counts.get(c) ?? 0 }))
    .sort((a, b) => b.count - a.count)
})

// FiltersBar(전역) 위에 칩 필터를 한 번 더 적용한 결과
const chipFiltered = computed<Transaction[]>(() => {
  if (selectedCategories.value.size === 0) return filteredAll.value
  return filteredAll.value.filter((t) => selectedCategories.value.has(t.category))
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

// ───────── 지출 계산 제외 ─────────
//
// 개별 체크박스: 그 거래 1건만.
// 헤더 전체 선택: **현재 페이지에 표시된 거래만** 대상이다.
//   다른 페이지의 거래는 절대 바뀌지 않는다. 헤더의 체크/indeterminate 상태도
//   현재 페이지 기준으로만 계산하므로, 페이지를 넘기면 그 페이지의 상태를 그대로 보여준다.
//   visible은 page / pageSize / 정렬 / 필터에 따라 자동으로 다시 계산되므로
//   페이지 이동·페이지 크기 변경 시 별도 처리가 필요 없다.

/**
 * 헤더 전체 선택의 대상은 **현재 페이지의 지출 거래**뿐이다.
 * 수입 거래는 항상 제외 상태로 고정이라 켜고 끌 대상이 아니므로 대상·상태 계산 양쪽에서 뺀다.
 * (빼지 않으면 전체 해제를 눌러도 수입 행이 계속 체크돼 있어 헤더가 영원히 indeterminate가 된다)
 */
const togglableRows = computed(() => visible.value.filter((t) => !isIncomeCategory(t.category)))

/**
 * 사용자가 직접 제외한 지출 거래인지.
 * 수입 거래도 excluded=true지만 그것은 자동 규칙이므로, 회색 처리·'제외' 배지 같은
 * "내가 뺐다"는 표시는 지출 거래에만 붙인다. (수입 행은 기존의 수입 표시를 유지)
 */
function isUserExcluded(t: Transaction): boolean {
  return isExcluded(t) && !isIncomeCategory(t.category)
}
/** 현재 페이지에서 전체 선택이 건드릴 수 있는 거래 id */
const pageIds = computed<string[]>(() => togglableRows.value.map((t) => t.id))
/** 현재 페이지에서 제외 상태인 건수 */
const pageExcludedCount = computed<number>(
  () => togglableRows.value.reduce((n, t) => n + (isExcluded(t) ? 1 : 0), 0)
)
/** 현재 페이지 전부가 제외됨 → 전체 선택 체크 */
const allPageExcluded = computed<boolean>(
  () => togglableRows.value.length > 0 && pageExcludedCount.value === togglableRows.value.length
)
/** 현재 페이지 일부만 제외됨 → indeterminate */
const somePageExcluded = computed<boolean>(
  () => pageExcludedCount.value > 0 && pageExcludedCount.value < togglableRows.value.length
)

function onToggleExcludeAll(value: boolean) {
  // pageIds 이외의 거래는 setExcludedMany가 손대지 않는다 → 다른 페이지는 그대로.
  const r = setExcludedMany(pageIds.value, value)
  if (!r.ok) {
    selectRev.value++
    flashMsg(`제외 일괄 설정 실패: ${r.reason ?? '알 수 없는 오류'}`)
    return
  }
  if (r.changed === 0) {
    flashMsg('변경할 내용이 없습니다.')
    return
  }
  flashMsg(
    value
      ? `현재 페이지 ${r.changed.toLocaleString('ko-KR')}건을 지출 계산에서 제외했습니다`
      : `현재 페이지 ${r.changed.toLocaleString('ko-KR')}건을 지출 계산에 다시 포함했습니다`
  )
}

function onToggleExcluded(id: string, value: boolean) {
  const r = setExcluded(id, value)
  if (!r.ok) {
    // 실패 시 체크박스를 실제 데이터와 다시 맞춘다
    selectRev.value++
    flashMsg(`제외 설정 실패: ${r.reason ?? '알 수 없는 오류'}`)
    return
  }
  if (r.changed) {
    flashMsg(value ? '지출 계산에서 제외했습니다 (1건)' : '지출 계산에 다시 포함했습니다 (1건)')
  }
}

// ───────── 카테고리 변경 (단건 / 관련 거래 일괄) ─────────
//
// 예전에는 카테고리를 바꾸면 같은 내용의 거래가 말없이 함께 바뀌었다.
// 이제는 관련 거래가 2건 이상일 때 행 아래에 범위 선택 UI를 띄우고,
// 사용자가 "이 거래만" / "관련 거래 N건 모두" 를 고른 뒤에야 실제로 반영한다.

interface PendingCategoryEdit {
  id: string
  /** 사용자가 드롭다운에서 고른 새 카테고리 */
  value: string
  /** 변경 전 카테고리 */
  current: string
  description: string
  /** 관련 거래 건수 (자기 자신 포함) */
  relatedCount: number
}

const pendingCategory = ref<PendingCategoryEdit | null>(null)
/**
 * select는 네이티브 DOM 상태를 갖기 때문에, 변경을 취소해도 사용자가 고른 값이 화면에 남는다.
 * 이 카운터를 :key에 섞어 select를 다시 만들어 항상 실제 데이터와 일치시킨다.
 */
const selectRev = ref(0)

function onChangeCategory(id: string, value: string) {
  const tx = transactions.value.find((t) => t.id === id)
  if (!tx) {
    selectRev.value++
    flashMsg('거래를 찾을 수 없습니다.')
    return
  }
  if (!value || value === tx.category) {
    pendingCategory.value = null
    selectRev.value++
    return
  }

  const relatedCount = countRelated(id)
  // 관련 거래가 자기 자신뿐이면 선택할 범위가 없으므로 바로 단건 적용
  if (relatedCount <= 1) {
    applyCategory(id, value, 'single')
    return
  }

  pendingCategory.value = {
    id,
    value,
    current: tx.category,
    description: tx.description,
    relatedCount
  }
}

function applyCategory(id: string, value: string, scope: UpdateScope) {
  pendingCategory.value = null
  const r = updateCategoryScoped(id, value, scope)
  // 성공이든 실패든 select DOM을 실제 데이터와 다시 맞춘다
  selectRev.value++

  if (!r.ok) {
    flashMsg(`카테고리 변경 실패: ${r.reason ?? '알 수 없는 오류'}`)
    return
  }
  if (r.updated === 0) {
    flashMsg('변경할 내용이 없습니다.')
    return
  }
  flashMsg(
    scope === 'single'
      ? `이 거래만 변경 · ${value} (1건)`
      : `관련 거래 일괄 변경 · '${r.description}' ${r.updated.toLocaleString('ko-KR')}건 → ${value}`
  )
}

function cancelCategoryEdit() {
  pendingCategory.value = null
  selectRev.value++
}

// 페이지/필터가 바뀌어 대상 행이 화면에서 사라지면 대기 중인 변경은 취소한다
watch([page, tableFiltered], () => {
  const p = pendingCategory.value
  if (p && !visible.value.some((t) => t.id === p.id)) cancelCategoryEdit()
})
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

// ───────── 삭제 모드 ─────────
//
// 평소에는 존재하지 않는 기능이다. '삭제' 버튼을 눌러야 선택 체크박스 컬럼이 나타나고,
// 모드를 끄면 표는 원래 모습·동작 그대로 돌아간다(선택 상태도 비운다).
// 선택은 id 기준이라 정렬·필터·페이지를 옮겨도 유지되지만, 목록에서 사라진 id는 정리한다.
const deleteMode = ref(false)
const selectedForDelete = ref<Set<string>>(new Set())

/** 삭제 모드에서 체크박스 컬럼이 하나 늘어난다 — colspan을 쓰는 행이 함께 따라가야 한다 */
const columnCount = computed(() => (deleteMode.value ? 8 : 7))

function toggleDeleteMode() {
  deleteMode.value = !deleteMode.value
  selectedForDelete.value = new Set()
}

function toggleDeleteSelection(id: string, checked: boolean) {
  const next = new Set(selectedForDelete.value)
  if (checked) next.add(id)
  else next.delete(id)
  selectedForDelete.value = next
}

/** 현재 페이지 전체 선택/해제 — 다른 페이지의 선택은 건드리지 않는다 */
function toggleDeleteSelectAll(checked: boolean) {
  const next = new Set(selectedForDelete.value)
  for (const t of visible.value) {
    if (checked) next.add(t.id)
    else next.delete(t.id)
  }
  selectedForDelete.value = next
}

const pageSelectedCount = computed(
  () => visible.value.reduce((n, t) => n + (selectedForDelete.value.has(t.id) ? 1 : 0), 0)
)
const allPageSelected = computed(
  () => visible.value.length > 0 && pageSelectedCount.value === visible.value.length
)
const somePageSelected = computed(
  () => pageSelectedCount.value > 0 && pageSelectedCount.value < visible.value.length
)

function onDeleteSelected() {
  const ids = Array.from(selectedForDelete.value)
  if (ids.length === 0) return
  if (!window.confirm(`선택한 ${ids.length.toLocaleString('ko-KR')}건을 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return

  const r = removeTransactions(ids)
  if (!r.ok) {
    flashMsg(`삭제 실패: ${r.reason ?? '알 수 없는 오류'}`, 'err')
    return
  }
  selectedForDelete.value = new Set()
  deleteMode.value = false
  const extra = r.removedFromIncomeExpense > 0
    ? ` (수입/지출 관리 원본 ${r.removedFromIncomeExpense.toLocaleString('ko-KR')}건 포함)`
    : ''
  flashMsg(`${r.removed.toLocaleString('ko-KR')}건을 삭제했습니다${extra}`)
}

// 필터·검색 등으로 목록에서 사라진 id는 선택에서 정리한다 (보이지 않는 행이 삭제되지 않도록)
watch(tableFiltered, (rows) => {
  if (selectedForDelete.value.size === 0) return
  const alive = new Set(rows.map((t) => t.id))
  const next = new Set([...selectedForDelete.value].filter((id) => alive.has(id)))
  if (next.size !== selectedForDelete.value.size) selectedForDelete.value = next
})

// ───────── 저장하기 ─────────
// 안내 메시지는 표 안의 인라인 블록이 아니라 화면 우측 상단 토스트로 띄운다.
// (인라인 블록은 나타날 때 아래 내용을 밀어내 표가 흔들렸다. 다른 페이지의 notify()와 같은 방식)
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function flashMsg(msg: string, kind: 'ok' | 'err' = 'ok') {
  toast.value = { kind, text: msg }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2400) as unknown as number
}

function onSave() {
  const r = saveToStorage()
  // 저장에 성공했을 때만 완료 알림을 띄운다. 실패는 실패대로 알려야 하므로 err 토스트.
  if (r.ok) flashMsg(`저장 완료 · ${r.count.toLocaleString('ko-KR')}건`)
  else flashMsg(`저장 실패: ${r.reason ?? '알 수 없는 오류'}`, 'err')
}

const lastSavedLabel = computed(() => {
  if (!lastSavedAt.value) return '저장된 데이터 없음'
  const d = lastSavedAt.value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `최근 저장: ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
})

/**
 * 화면의 합계·차트는 편집 즉시 반영되지만 저장은 명시적이다.
 * 저장하지 않은 채 새로고침하면 마지막 저장 시점으로 되돌아가므로, 그 차이를 눈에 보이게 한다.
 */
const saveHint = computed(() =>
  unsavedChanges.value
    ? '저장되지 않은 변경이 있습니다 — 저장해야 다음 방문에도 유지됩니다'
    : '거래내역을 브라우저에 영구 저장합니다'
)

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
  <section class="card overflow-hidden tx-card">
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
          <span v-if="refundCount > 0" class="text-violet-600 font-medium">
            · 환불 {{ refundCount.toLocaleString('ko-KR') }}건 ({{ formatKRW(refundAmount) }})
          </span>
          <span v-if="unmatchedNegativeCount > 0" class="text-slate-500 font-medium">
            · 짝 없는 음수 {{ unmatchedNegativeCount.toLocaleString('ko-KR') }}건
          </span>
          <span v-if="excludedCount > 0" class="text-amber-600 font-medium">
            · 지출 계산 제외 {{ excludedCount.toLocaleString('ko-KR') }}건 ({{ formatKRW(excludedAmount) }})
          </span>
          <span class="hidden sm:inline text-slate-400">· 카테고리·결제수단·구분 셀을 직접 클릭해 변경할 수 있습니다</span>
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <span class="hidden sm:inline text-[11px] text-slate-400 mr-1">{{ lastSavedLabel }}</span>
        <!-- 메모리와 저장소가 갈라진 상태 — 저장 전까지 표시된다 -->
        <span v-if="unsavedChanges" class="tx-unsaved" :title="saveHint">● 미저장 변경</span>
        <button type="button" class="btn-action btn-action-add" @click="toggleAddForm">
          {{ showAddForm ? '× 닫기' : '+ 추가' }}
        </button>
        <!-- 삭제 모드 토글 — 모드를 켜야 선택 체크박스 컬럼이 나타난다 -->
        <button
          type="button"
          :class="['btn-action', deleteMode ? 'btn-action-delete-on' : 'btn-action-delete']"
          :disabled="txCount === 0 && !deleteMode"
          :title="deleteMode ? '삭제 모드를 끕니다 (선택은 모두 해제됩니다)' : '삭제할 거래를 선택합니다'"
          @click="toggleDeleteMode"
        >
          {{ deleteMode ? '× 삭제 취소' : '삭제' }}
        </button>
        <button
          v-if="deleteMode"
          type="button"
          class="btn-action btn-action-delete-confirm"
          :disabled="selectedForDelete.size === 0"
          :title="selectedForDelete.size === 0
            ? '삭제할 거래를 먼저 선택하세요'
            : `선택한 ${selectedForDelete.size}건을 영구 삭제합니다`"
          @click="onDeleteSelected"
        >
          선택 삭제{{ selectedForDelete.size > 0 ? ` (${selectedForDelete.size})` : '' }}
        </button>
        <button
          type="button"
          :class="['btn-action btn-action-save', unsavedChanges ? 'btn-action-save-dirty' : '']"
          :disabled="txCount === 0"
          :title="txCount === 0 ? '저장할 거래가 없습니다' : saveHint"
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

    <!-- 안내 토스트 — 화면 우측 상단 고정. 표 레이아웃에 영향을 주지 않는다. -->
    <transition name="fade">
      <div
        v-if="toast"
        :class="[
          'fixed top-6 right-6 z-50 px-4 py-2 rounded-lg shadow text-sm',
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        ]"
        role="status"
        aria-live="polite"
      >{{ toast.text }}</div>
    </transition>

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
    <div class="tx-card-body -mx-1 px-1">
      <table class="tx-table min-w-[980px] w-full text-sm">
        <!--
          컬럼 폭 고정 (table-layout: fixed).
          이 colgroup이 각 컬럼의 폭을 결정하므로, 셀 내용(내역 길이·카테고리 이름·금액 자릿수·
          배지 유무)이나 페이지 이동으로 데이터가 바뀌어도 컬럼 경계가 움직이지 않는다.
          폭을 조정할 일이 생기면 여기 한 곳만 고치면 된다.
          '내용'은 고정 폭이고, 남는 폭은 '카테고리'와 '결제수단'이 나눠 가진다.
        -->
        <colgroup>
          <col v-if="deleteMode" class="col-select" />
          <col class="col-date" />
          <col class="col-desc" />
          <col class="col-category" />
          <col class="col-payment" />
          <col class="col-costtype" />
          <col class="col-amount" />
          <col class="col-exclude" />
        </colgroup>
        <thead class="sticky top-0 z-10 bg-white">
          <tr class="text-left text-xs text-slate-500 uppercase border-b border-slate-200">
            <th v-if="deleteMode" class="py-2 pr-2 text-center align-middle">
              <input
                type="checkbox"
                class="delete-check"
                :checked="allPageSelected"
                :indeterminate="somePageSelected"
                :disabled="visible.length === 0"
                :title="`현재 페이지 ${visible.length}건 전체 선택`"
                aria-label="현재 페이지 전체 선택"
                @change="toggleDeleteSelectAll(($event.target as HTMLInputElement).checked)"
              />
            </th>
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
            <th class="py-2 pr-3 text-center whitespace-nowrap align-middle">
              <!--
                헤더 전체가 하나의 클릭 영역이다 (label로 감쌌으므로 "지출 제외" 글자를 눌러도 동작).
                대상은 현재 조회된 거래 목록 전체 — 다음 페이지에 있는 행까지 포함한다.
              -->
              <label
                :class="['exclude-all-label', togglableRows.length === 0 ? 'is-disabled' : '']"
                :title="togglableRows.length === 0
                  ? '전환할 수 있는 지출 거래가 없습니다. (수입 거래는 항상 제외 상태입니다)'
                  : `현재 페이지의 지출 거래 ${togglableRows.length.toLocaleString('ko-KR')}건을 ${allPageExcluded ? '지출 계산에 다시 포함' : '지출 계산에서 제외'}합니다. (수입 거래와 다른 페이지의 거래는 바뀌지 않습니다)`"
              >
                <span class="exclude-all-text">지출 제외</span>
                <input
                  type="checkbox"
                  class="exclude-check exclude-check-all"
                  :key="`exall:${selectRev}`"
                  :checked="allPageExcluded"
                  :indeterminate="somePageExcluded"
                  :disabled="togglableRows.length === 0"
                  :aria-label="`현재 페이지 지출 거래 ${togglableRows.length}건 지출 계산 제외`"
                  @change="onToggleExcludeAll(($event.target as HTMLInputElement).checked)"
                />
              </label>
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="t in visible" :key="t.id">
          <tr :class="[
            'border-b border-slate-100 hover:bg-slate-50/60',
            isUserExcluded(t) ? 'tx-excluded' : '',
            isNegativeAmount(t) ? 'tx-canceled' : '',
            isRefundCategory(t) ? 'tx-refund' : '',
            !isNegativeAmount(t) && isIncomeCategory(t.category) ? 'tx-income' : ''
          ]">
            <td v-if="deleteMode" class="py-2 pr-2 text-center">
              <input
                type="checkbox"
                class="delete-check"
                :checked="selectedForDelete.has(t.id)"
                :aria-label="`${t.description} 선택`"
                @change="toggleDeleteSelection(t.id, ($event.target as HTMLInputElement).checked)"
              />
            </td>
            <td class="py-2 pr-3 tabular-nums text-slate-600 whitespace-nowrap">{{ formatDate(t.date) }}</td>
            <!--
              내용 셀: [배지들] + [내용 텍스트]
              배지는 서로 독립적인 v-if 라서 "수입"과 "제외"가 동시에 표시된다.
              (예전에는 v-else-if 여서 제외된 수입 거래는 '수입' 배지가 가려졌다)
              배지 묶음은 절대 줄어들지 않고(flex:0 0 auto), 내용 텍스트만 말줄임 처리된다.
            -->
            <td class="py-2 pr-3 text-slate-900">
              <div class="desc-cell">
                <span class="desc-badges">
                  <!-- 수입 / 지출 — 카테고리 유형 -->
                  <span
                    v-if="isIncomeCategory(t.category)"
                    class="tx-badge tx-badge-income"
                    title="수입 카테고리입니다 — 지출 합계가 아니라 수입으로 집계됩니다"
                  >수입</span>
                  <span
                    v-else
                    class="tx-badge tx-badge-expense"
                    title="지출 카테고리입니다 — 지출 합계에 반영됩니다"
                  >지출</span>

                  <!-- 환불 — 같은 금액의 결제 건과 짝이 맞은 음수 지출 -->
                  <span
                    v-if="isRefund(t)"
                    class="tx-badge tx-badge-canceled"
                    title="같은 금액의 결제 건과 짝이 맞아 환불로 분류되었습니다 — 지출 합계·차트·집계에서 제외됩니다"
                  >환불</span>

                  <!-- 지출 계산 제외 — 위 배지들과 별개로 함께 표시된다 -->
                  <span
                    v-if="isUserExcluded(t)"
                    class="tx-badge tx-badge-excluded"
                    title="지출 계산에서 제외된 거래입니다 (목록에는 그대로 남습니다)"
                  >제외</span>
                </span>
                <span class="desc-text" :title="t.description">{{ t.description }}</span>
              </div>
            </td>

            <!-- 카테고리: 인라인 select (chip 스타일) — 숨김 항목은 옵션에서 제외하되 현재값은 보존 -->
            <td class="py-2 pr-3">
              <select
                :key="`${t.id}:${t.category}:${selectRev}`"
                :class="[
                  'cell-select bg-slate-100 text-slate-700',
                  pendingCategory && pendingCategory.id === t.id ? 'cell-select-pending' : ''
                ]"
                :value="pendingCategory && pendingCategory.id === t.id ? pendingCategory.value : t.category"
                @change="onChangeCategory(t.id, ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="!visibleCategoryNames.includes(t.category)" :value="t.category">
                  {{ t.category }} (숨김/외부)
                </option>
                <optgroup label="지출">
                  <option v-for="c in visibleExpenseCategoryNames" :key="`e-${c}`" :value="c">{{ c }}</option>
                </optgroup>
                <optgroup v-if="visibleIncomeCategoryNames.length > 0" label="수입">
                  <option v-for="c in visibleIncomeCategoryNames" :key="`i-${c}`" :value="c">{{ c }}</option>
                </optgroup>
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

            <td class="py-2 pr-3 text-right tabular-nums font-medium text-slate-900 whitespace-nowrap">
              <!-- 취소 거래는 원본 금액(음수)을 그대로 보여준다 -->
              <span v-if="isNegativeAmount(t)" :title="isRefund(t) ? '환불 — 원본 금액(음수)' : '원본 금액(음수)'">-{{ formatKRW(t.amount) }}</span>
              <span v-else>{{ formatKRW(t.amount) }}</span>
            </td>

            <!-- 지출 계산 제외 — 항상 이 거래 1건에만 적용된다 -->
            <td class="py-2 pr-3 text-center">
              <input
                type="checkbox"
                class="exclude-check"
                :key="`${t.id}:ex:${selectRev}`"
                :checked="isExcluded(t)"
                :disabled="isIncomeCategory(t.category)"
                :aria-label="`${t.description} 지출 계산에서 제외`"
                :title="isIncomeCategory(t.category)
                  ? '수입 거래는 항상 지출 계산에서 제외됩니다 (해제할 수 없습니다)'
                  : (isExcluded(t) ? '지출 계산에 다시 포함하기' : '이 거래만 지출 계산에서 제외하기')"
                @change="onToggleExcluded(t.id, ($event.target as HTMLInputElement).checked)"
              />
            </td>
          </tr>

          <!--
            카테고리 변경 범위 선택 — 변경한 행 바로 아래에 붙는다.
            (모달 대신 인라인 행이라 기존 테이블 레이아웃/스타일을 그대로 유지)
          -->
          <tr v-if="pendingCategory && pendingCategory.id === t.id" class="scope-row">
            <td :colspan="columnCount" class="py-2.5 px-3">
              <div class="flex items-start sm:items-center justify-between gap-3 flex-wrap">
                <p class="text-xs text-amber-900 min-w-0">
                  <b class="font-semibold">{{ pendingCategory.description }}</b> 의 카테고리를
                  <span class="scope-tag scope-tag-from">{{ pendingCategory.current }}</span>
                  <span class="text-amber-600">→</span>
                  <span class="scope-tag scope-tag-to">{{ pendingCategory.value }}</span>
                  (으)로 변경합니다. 적용 범위를 선택해 주세요.
                </p>
                <div class="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  <button
                    type="button"
                    class="btn-action btn-action-add"
                    title="선택한 거래 1건만 변경합니다. 같은 내용의 다른 거래는 그대로 둡니다."
                    @click="applyCategory(pendingCategory!.id, pendingCategory!.value, 'single')"
                  >
                    이 거래만 변경
                  </button>
                  <button
                    type="button"
                    class="btn-action btn-action-bulk"
                    :title="`내용이 '${pendingCategory.description}' 인 거래 ${pendingCategory.relatedCount}건을 모두 변경합니다.`"
                    @click="applyCategory(pendingCategory!.id, pendingCategory!.value, 'related')"
                  >
                    관련 거래 {{ pendingCategory.relatedCount.toLocaleString('ko-KR') }}건 모두 변경
                  </button>
                  <button type="button" class="btn-action" @click="cancelCategoryEdit">취소</button>
                </div>
              </div>
            </td>
          </tr>
          </template>

          <tr v-if="visible.length === 0">
            <td :colspan="columnCount" class="py-8 text-center text-slate-400 text-sm">
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

/* 토스트 페이드 (다른 페이지의 토스트와 동일) */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ─────────────────────────────────────────
 * 컬럼 폭 고정
 *
 * table-layout: fixed 이면 브라우저가 셀 내용을 재지 않고 colgroup 폭만 본다.
 * 그래서 카테고리를 '식비'에서 '여행/숙박'으로 바꾸거나, 긴 가맹점명이 들어오거나,
 * 금액 자릿수가 달라지거나, 다음 페이지로 넘어가도 컬럼이 밀리지 않는다.
 * ───────────────────────────────────────── */
.tx-table {
  table-layout: fixed;
}
.col-select   { width: 40px; }   /* 삭제 모드에서만 렌더된다 */
.col-date     { width: 88px; }
.col-desc     { width: 360px; }  /* 상한 있음 — 넓은 화면에서 내용만 계속 늘어나지 않게 */
.col-costtype { width: 88px; }
.col-amount   { width: 124px; }
.col-exclude  { width: 80px; }
/*
 * 남는 폭은 이 둘이 균등하게 나눠 가진다 (fixed 레이아웃의 auto 컬럼 동작).
 * 덕분에 표가 카드 폭을 꽉 채우고 '지출 제외' 컬럼도 항상 오른쪽 끝에 붙는다.
 * 고정분 합 740px + 이 둘의 최소치를 감안해 표 min-width를 980px로 둔다.
 */
.col-category { width: auto; }
.col-payment  { width: auto; }

/* 미저장 변경 배지 — 화면 값과 저장된 값이 다르다는 신호 */
.tx-unsaved {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 9999px;
  background: rgb(254 243 199);
  color: rgb(146 64 14);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
/* 미저장 변경이 있을 때 저장 버튼을 눈에 띄게 */
.btn-action-save-dirty {
  box-shadow: 0 0 0 2px rgb(253 230 138);
}

/* 삭제 선택 체크박스 */
.delete-check {
  width: 15px;
  height: 15px;
  margin: 0;
  cursor: pointer;
  accent-color: rgb(225 29 72);
}
.delete-check:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

/* 삭제 모드 버튼 — .btn-action 뒤에 와야 기본 배경/글자색을 덮어쓴다 */
.btn-action-delete {
  color: rgb(190 18 60);
  border-color: rgb(253 164 175);
}
.btn-action-delete:hover:not(:disabled) {
  background: rgb(255 241 242);
}
.btn-action-delete-on {
  background: rgb(255 241 242);
  color: rgb(159 18 57);
  border-color: rgb(251 113 133);
}
.btn-action-delete-confirm {
  background: rgb(225 29 72);
  border-color: rgb(225 29 72);
  color: #fff;
}
.btn-action-delete-confirm:hover:not(:disabled) {
  background: rgb(190 18 60);
  border-color: rgb(190 18 60);
}
.btn-action-delete-confirm:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* 일괄 변경 버튼 — 파급 범위가 크므로 단건 버튼과 확실히 구분되는 색을 쓴다 */
.btn-action-bulk {
  background: rgb(255 251 235);
  border-color: rgb(252 211 77);
  color: rgb(146 64 14);
}
.btn-action-bulk:hover:not(:disabled) {
  background: rgb(254 243 199);
  border-color: rgb(245 158 11);
}

/* ─────────────────────────────────────────
 * 카테고리 변경 범위 선택 행
 * ───────────────────────────────────────── */
.scope-row {
  background: rgb(255 251 235);
  border-bottom: 1px solid rgb(253 230 138);
}
.scope-tag {
  display: inline-block;
  padding: 1px 6px;
  margin: 0 2px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  vertical-align: middle;
}
.scope-tag-from {
  background: rgb(241 245 249);
  color: rgb(71 85 105);
  text-decoration: line-through;
}
.scope-tag-to {
  background: rgb(37 99 235);
  color: #fff;
}

/* ─────────────────────────────────────────
 * 지출 계산 제외 행
 * 목록에는 그대로 보이되 "합계에 안 들어간다"는 것이 한눈에 보이도록.
 * ───────────────────────────────────────── */
.tx-excluded {
  background: rgb(248 250 252);
  color: rgb(148 163 184);
}
.tx-excluded td {
  opacity: 0.65;
}
/*
 * 제외 행에는 취소선을 쓰지 않는다 — 금액 취소선은 '환불' 카테고리 전용 신호다.
 * 제외 여부는 회색 배경 + 낮은 불투명도 + '제외' 배지로 충분히 구분된다.
 */
/* ─────────────────────────────────────────
 * 내용 셀 — 배지 + 내용
 * 배지는 고정 폭을 유지하고 내용만 말줄임되므로,
 * 내용이 아무리 길어도 배지가 잘리거나 밀려나지 않는다.
 * ───────────────────────────────────────── */
.desc-cell {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;          /* 자식 말줄임이 동작하려면 필요 */
  overflow: hidden;      /* 컬럼 폭이 고정이므로 배지가 옆 컬럼을 침범하지 않게 잘라낸다 */
}
.desc-badges {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;        /* 절대 줄어들지 않음 — 두 배지가 항상 온전히 보인다 */
}
.desc-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 배지 공통 */
.tx-badge {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.5;
  white-space: nowrap;
  vertical-align: middle;
}
.tx-badge-income {
  background: rgb(219 234 254);
  color: rgb(29 78 216);
}
/* 지출은 대부분의 행에 붙으므로 눈에 띄지 않게 — 유형은 알 수 있되 시선을 끌지 않는다 */
.tx-badge-expense {
  background: rgb(241 245 249);
  color: rgb(100 116 139);
  font-weight: 600;
}
.tx-badge-excluded {
  background: rgb(254 243 199);
  color: rgb(146 64 14);
}
.tx-badge-canceled {
  background: rgb(237 233 254);
  color: rgb(109 40 217);
}

/* 음수 금액 행(환불 포함) — 지출이 아님을 시각적으로 구분 */
.tx-canceled {
  background: rgb(250 250 252);
}
.tx-canceled td:nth-last-child(2) {
  color: rgb(124 58 237);
}

/*
 * 금액 취소선 — 카테고리가 '환불'인 거래에만 적용된다.
 * 짝을 못 찾은 음수 지출, 수입, 일반 지출, '지출 계산 제외' 행에는 붙지 않는다.
 * 판정 기준이 거래의 현재 category 값이므로 카테고리 변경/엑셀 업로드/필터/
 * 페이지 이동/새로고침 이후에도 표시가 항상 일치한다.
 */
.tx-refund td:nth-last-child(2) {
  text-decoration: line-through;
  text-decoration-color: rgb(196 181 253);
}

/* 수입 카테고리 행 — 금액을 파랗게 해서 지출과 구분 */
.tx-income td:nth-last-child(2) {
  color: rgb(37 99 235);
}

/* 좁은 화면에서는 배지를 조금 더 작게 (두 개가 나란히 들어가도록) */
@media (max-width: 640px) {
  .tx-badge {
    padding: 0 4px;
    font-size: 9px;
  }
  .desc-cell { gap: 4px; }
  .desc-badges { gap: 3px; }
}
.exclude-check {
  width: 15px;
  height: 15px;
  margin: 0;
  cursor: pointer;
  accent-color: rgb(217 119 6);
}
.exclude-check:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
/* 헤더 전체 선택 — 글자까지 통째로 클릭 영역 */
.exclude-check-all {
  width: 14px;
  height: 14px;
}
.exclude-all-label {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
  transition: background 0.12s ease;
}
.exclude-all-label:hover {
  background: rgb(254 243 199);
}
.exclude-all-label.is-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.exclude-all-label.is-disabled:hover {
  background: transparent;
}
.exclude-all-text {
  line-height: 1;
}

/* 변경 대기 중인 select — 아직 반영 전임을 시각적으로 표시 */
.cell-select-pending {
  outline: 2px solid rgb(251 191 36);
  outline-offset: 1px;
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
  /* 컬럼 폭이 고정이므로 select도 그 안에 갇힌다 — 긴 카테고리명은 말줄임 처리 */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-select:hover {
  border-color: rgb(203 213 225);
}
.cell-select:focus {
  outline: none;
  border-color: rgb(99 102 241);
  box-shadow: 0 0 0 2px rgb(199 210 254);
}

/* ─────────────────────────────────────────
 * 거래 내역 카드 — 고정 높이
 *
 * 예전에는 표 영역이 max-height라서 행이 3건이면 카드가 짧고 20건이면 길어져,
 * 페이지 아래 요소들이 데이터 양에 따라 위아래로 밀렸다.
 * 이제 카드 높이를 고정하고 표 영역이 남는 공간을 전부 차지한다.
 * 행이 많으면 표 안에서만 스크롤되고 카드·페이지 레이아웃은 그대로다.
 *
 * height는 clamp로 화면 높이에 비례하되 상·하한을 둬서
 * 작은 노트북에서 잘리지 않고 큰 모니터에서 과도하게 늘어나지도 않게 한다.
 * ───────────────────────────────────────── */
.tx-card {
  display: flex;
  flex-direction: column;
  height: clamp(34rem, 74vh, 55rem);
}

/* 헤더·검색·칩·페이지네이션 등은 자기 높이를 유지 (줄어들지 않음) */
.tx-card > *:not(.tx-card-body) {
  flex: 0 0 auto;
}

/* 표 영역만 남은 공간을 채우고 내부 스크롤 */
.tx-card-body {
  flex: 1 1 auto;
  min-height: 0;   /* flex 아이템이 내용 높이 아래로 줄어들 수 있게 — 없으면 스크롤이 안 생긴다 */
  overflow: auto;
  /* 행 수가 달라져 세로 스크롤바가 생기거나 사라져도 표 폭이 흔들리지 않게 자리를 미리 확보 */
  scrollbar-gutter: stable;
}

/* 모바일: 화면이 낮으므로 상한을 낮춰 카드가 화면을 다 먹지 않게 */
@media (max-width: 640px) {
  .tx-card {
    height: clamp(26rem, 70vh, 38rem);
  }
}

/* 세로로 아주 짧은 창(가로 모드 노트북 등)에서는 최소 높이를 완화 */
@media (max-height: 640px) {
  .tx-card {
    height: clamp(20rem, 80vh, 34rem);
  }
}
</style>
