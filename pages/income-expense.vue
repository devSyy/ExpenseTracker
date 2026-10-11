<script setup lang="ts">
import { formatDate as ymd, formatGrouped as fmtKRW } from '~/utils/format'
// 수입/지출 관리 페이지: 연동 카드 + 입력 폼 + 필터(실시간) + KPI + 카테고리 합산/거래별 상세.
import { computed, reactive, ref, watch } from 'vue'
import {
  useIncomeExpense,
  incomeCategoryOptions,
  expenseCategoryOptions,
  INCOME_EXPENSE_PAYMENT_METHODS as PAYMENT_METHODS,
  type TxKind,
  type IncomeExpenseTx
} from '~/composables/useIncomeExpense'
import { useExpenses } from '~/composables/useExpenses'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { withBackupHint } from '~/utils/backupHint'
import type { Transaction } from '~/utils/types'

useHead({ title: '수입/지출 관리 · 가계부' })

const tax = useTaxonomies()
const {
  transactions,
  add,
  update,
  remove,
  importFromDashboard,
  clearDashboardImports,
  dashboardImportCount,
  isIncomeExpenseMirror,
  entryCount
} = useIncomeExpense()
const { transactions: allDashboardTxs } = useExpenses()

/**
 * 가져오기 대상이 되는 대시보드 사용내역.
 * 이 화면에서 대시보드로 미러링해 올려보낸 항목은 원래 여기 것이므로 가져오기 대상이 아니다
 * (건수 표시와 버튼 활성 조건도 같은 기준을 쓴다).
 */
const dashboardTxs = computed(() => allDashboardTxs.value.filter((t) => !isIncomeExpenseMirror(t)))

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 날짜 유틸 ──

/**
 * n개월 전 같은 날. 대상 월에 그 날짜가 없으면 말일로 맞춘다.
 * (3월 31일의 한 달 전은 2월 28/29일 — 보정하지 않으면 JS가 3월로 넘겨버린다)
 */
function monthsBefore(d: Date, months: number): Date {
  const lastDayOfTarget = new Date(d.getFullYear(), d.getMonth() - months + 1, 0).getDate()
  return new Date(d.getFullYear(), d.getMonth() - months, Math.min(d.getDate(), lastDayOfTarget))
}

// ── 필터 (실시간) ──
//
// 조회 버튼 없이 입력 즉시 반영한다. 기본 조회 범위는 **오늘 기준 최근 1개월**
// — 특정 날짜를 하드코딩하지 않으므로 해·달·일이 바뀌면 기본값도 자동으로 따라간다.

type PresetKey = 'thisMonth' | 'lastMonth' | 'last3m' | 'thisYear' | 'all'
const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'thisMonth', label: '이번 달' },
  { key: 'lastMonth', label: '지난 달' },
  { key: 'last3m', label: '최근 3개월' },
  { key: 'thisYear', label: '올해' },
  { key: 'all', label: '전체' }
]

function presetRange(key: PresetKey): { startDate: string; endDate: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (key) {
    case 'thisMonth': return { startDate: ymd(new Date(y, m, 1)), endDate: ymd(new Date(y, m + 1, 0)) }
    case 'lastMonth': return { startDate: ymd(new Date(y, m - 1, 1)), endDate: ymd(new Date(y, m, 0)) }
    case 'last3m': return { startDate: ymd(monthsBefore(now, 3)), endDate: ymd(now) }
    case 'thisYear': return { startDate: `${y}-01-01`, endDate: `${y}-12-31` }
    case 'all': return { startDate: '', endDate: '' }
  }
}

/** 오늘 기준 기본 조회 범위 (최근 1개월) */
function defaultDateRange(): { startDate: string; endDate: string } {
  const today = new Date()
  return { startDate: ymd(monthsBefore(today, 1)), endDate: ymd(today) }
}

function defaultFilter() {
  return {
    ...defaultDateRange(),
    kind: 'all' as 'all' | TxKind,
    category: 'all' as string,
    paymentMethod: 'all' as string,
    q: ''
  }
}
const flt = reactive(defaultFilter())

const activePreset = computed<PresetKey | null>(() => {
  for (const p of PRESETS) {
    const r = presetRange(p.key)
    if (r.startDate === flt.startDate && r.endDate === flt.endDate) return p.key
  }
  return null
})
function applyPreset(key: PresetKey) {
  Object.assign(flt, presetRange(key))
}
function onResetFilter() {
  Object.assign(flt, defaultFilter())
}

const KIND_OPTS: { k: 'all' | TxKind; t: string }[] = [
  { k: 'all', t: '전체' },
  { k: '수입', t: '수입' },
  { k: '지출', t: '지출' }
]

const filtered = computed<IncomeExpenseTx[]>(() => {
  const q = flt.q.trim().toLowerCase()
  return transactions.value.filter((t) => {
    if (flt.startDate && t.date < flt.startDate) return false
    if (flt.endDate && t.date > flt.endDate) return false
    if (flt.kind !== 'all' && t.kind !== flt.kind) return false
    if (flt.category !== 'all' && t.category !== flt.category) return false
    if (flt.paymentMethod !== 'all' && t.paymentMethod !== flt.paymentMethod) return false
    if (q && !`${t.category} ${t.description} ${t.note} ${t.paymentMethod}`.toLowerCase().includes(q)) return false
    return true
  })
})

/** 필터가 기본값과 다른지 — '필터 초기화' 버튼 강조용 */
const isFilterDirty = computed(() => {
  const d = defaultFilter()
  return (Object.keys(d) as (keyof typeof d)[]).some((k) => flt[k] !== d[k])
})

// 필터 카테고리 옵션은 양쪽 모두 + 데이터에서 발견된 추가 항목
const filterCategoryOptions = computed<string[]>(() => {
  const set = new Set<string>([...incomeCategoryOptions.value, ...expenseCategoryOptions.value])
  transactions.value.forEach((t) => set.add(t.category))
  return Array.from(set)
})

// 결제수단은 기본 목록 + 가져온 사용내역에서 발견된 값('네이버페이 간편결제', '여러 건' 등).
// 기본 목록만 쓰면 가져온 거래가 필터/편집 select에서 빈 칸으로 보인다.
const paymentOptions = computed<string[]>(() => {
  const set = new Set<string>(PAYMENT_METHODS)
  transactions.value.forEach((t) => { if (t.paymentMethod) set.add(t.paymentMethod) })
  return Array.from(set)
})

// ── 사용내역에서 가져오기 ──
//
// 사용내역의 거래는 보통 과거 날짜를 갖는데, 이 페이지의 기본 필터는 "최근 1개월"이라
// 가져온 직후 거래 이력 테이블에 안 보일 수 있다. 그래서 가져오기 직후엔
// 필터 날짜 범위를 전체 거래(가져온 것 포함)를 덮도록 자동 확장한다.
function expandFilterToCoverAll() {
  if (transactions.value.length === 0) return
  const dates = transactions.value.map((t) => t.date).filter(Boolean).sort()
  if (dates.length === 0) return
  Object.assign(flt, {
    startDate: dates[0],
    endDate: dates[dates.length - 1],
    kind: 'all',
    category: 'all',
    paymentMethod: 'all',
    q: ''
  })
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

// ── 입력 폼 ──
function emptyForm() {
  return {
    kind: '수입' as TxKind,
    category: incomeCategoryOptions.value[0] ?? '',
    amount: null as number | null,
    date: ymd(new Date()),
    paymentMethod: PAYMENT_METHODS[0],
    description: '',
    note: ''
  }
}
const form = reactive(emptyForm())
const errors = reactive<{ amount: string; date: string }>({ amount: '', date: '' })

const formCategoryOptions = computed(() =>
  form.kind === '수입' ? incomeCategoryOptions.value : expenseCategoryOptions.value
)

watch(() => form.kind, (k) => {
  // 구분 변경 시 카테고리 기본값 재설정
  form.category = (k === '수입' ? incomeCategoryOptions.value : expenseCategoryOptions.value)[0] ?? ''
})

/** 금액 입력 — 숫자만 받아 천 단위 콤마로 표시한다. */
const amountText = computed(() => (form.amount ? form.amount.toLocaleString('ko-KR') : ''))
function onAmountInput(e: Event) {
  const el = e.target as HTMLInputElement
  const n = parseInt(el.value.replace(/[^0-9]/g, ''), 10)
  form.amount = Number.isFinite(n) && n > 0 ? n : null
  el.value = form.amount ? form.amount.toLocaleString('ko-KR') : ''
  if (form.amount) errors.amount = ''
}

function validate(): boolean {
  errors.amount = !form.amount || form.amount <= 0 ? '금액을 1원 이상 입력하세요' : ''
  errors.date = !form.date ? '날짜를 선택하세요' : ''
  return !errors.amount && !errors.date
}

function onResetForm() {
  Object.assign(form, emptyForm())
  errors.amount = ''
  errors.date = ''
}

function onSubmit() {
  if (!validate()) return
  const amt = Number(form.amount)
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
  // 저장한 거래가 현재 조회 범위 밖이면 바로 보이도록 범위를 넓힌다
  if (flt.startDate && form.date < flt.startDate) flt.startDate = form.date
  if (flt.endDate && form.date > flt.endDate) flt.endDate = form.date
  // 동일 구분으로 연속 입력하기 쉽도록 금액·내용·비고만 초기화
  form.amount = null
  form.description = ''
  form.note = ''
}

// ── 요약 (KPI) ──
//
// 지출은 카테고리 설정의 '지출제외'가 켜진 카테고리를 뺀다 (useIncomeExpense.totalExpense와 같은 기준).
// 제외된 지출은 합계에서 빠지는 대신 건수·금액을 따로 보여 준다.
const summary = computed(() => {
  let income = 0, expense = 0, inCnt = 0, outCnt = 0, exAmt = 0, exCnt = 0
  for (const t of filtered.value) {
    // 건수는 합계 행 수가 아니라 사용내역 원본 건수 기준 (entryCount)
    const n = entryCount(t)
    if (tax.isExcludedCategory(t.category)) { exAmt += t.amount; exCnt += n }   // 수입·지출 모두 — 제외 카테고리는 합계에서 빠진다
    else if (t.kind === '수입') { income += t.amount; inCnt += n }
    else { expense += t.amount; outCnt += n }
  }
  return { income, expense, inCnt, outCnt, exAmt, exCnt, net: income - expense }
})
const totalIncome = computed(() => summary.value.income)
const totalExpense = computed(() => summary.value.expense)
const netProfit = computed(() => summary.value.net)
const incomePct = computed(() => {
  const s = summary.value.income + summary.value.expense
  return s > 0 ? (summary.value.income / s) * 100 : 0
})
/** 수입 대비 순수익 비율 — 수입이 없으면 의미가 없으므로 null */
const netRate = computed(() =>
  summary.value.income > 0 ? (summary.value.net / summary.value.income) * 100 : null
)

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
  /** 지출제외 카테고리 — 합계에서 빠지므로 비중을 계산하지 않는다 */
  excluded: boolean
  /** 같은 구분(수입/지출) 합계 대비 비중(%) — excluded면 null */
  pct: number | null
}

const categoryGroups = computed<CategoryGroup[]>(() => {
  const map = new Map<string, CategoryGroup>()
  for (const t of filtered.value) {
    const key = `${t.kind}::${t.category}`
    const g = map.get(key) ?? {
      key, kind: t.kind, category: t.category,
      total: 0, count: 0, avg: 0, latestDate: '', items: [],
      excluded: tax.isExcludedCategory(t.category), pct: null
    }
    g.total += t.amount
    g.count += entryCount(t)
    g.items.push(t)
    if (t.date > g.latestDate) g.latestDate = t.date
    map.set(key, g)
  }
  const s = summary.value
  // 수입을 위로, 같은 구분 안에서는 합계 내림차순
  return Array.from(map.values())
    .map((g) => {
      const denom = g.kind === '수입' ? s.income : s.expense
      return {
        ...g,
        avg: g.count > 0 ? g.total / g.count : 0,
        pct: g.excluded || denom <= 0 ? null : (g.total / denom) * 100,
        items: g.items.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      }
    })
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === '수입' ? -1 : 1
      return b.total - a.total
    })
})

// ── 펼침 상세: 사용내역 원본 거래 ──
//
// 사용내역에서 '월×카테고리 합계'로 가져온 항목은 합계 1줄이라, 펼쳤을 때 의미가 없다.
// 같은 (연월, 카테고리)의 대시보드 거래를 풀어서 보여 준다.
// 키 규칙은 useIncomeExpense.importFromDashboard의 sourceId(`agg::<연월>::<카테고리>`)와 같아야 한다.
const dashIndex = computed(() => {
  const m = new Map<string, Transaction[]>()
  for (const t of dashboardTxs.value) {
    const ym = t.monthLabel || (t.date instanceof Date ? ymd(t.date).slice(0, 7) : '')
    if (!ym) continue
    const key = `${ym}::${(t.category ?? '').trim() || '기타'}`
    const arr = m.get(key)
    if (arr) arr.push(t)
    else m.set(key, [t])
  }
  return m
})

interface DetailRow {
  id: string
  date: string
  description: string
  paymentMethod: string
  note: string
  amount: number
  /** 수입/지출 관리의 항목(수정·삭제 가능). 대시보드 원본 거래면 null — 수정은 거래내역 메뉴에서 */
  entry: IncomeExpenseTx | null
}

function detailsOf(g: CategoryGroup): DetailRow[] {
  const rows: DetailRow[] = []
  for (const t of g.items) {
    const src = t.source === 'dashboard' && t.sourceId?.startsWith('agg::') ? dashIndex.value.get(t.sourceId.slice(5)) : undefined
    if (src && src.length > 0) {
      for (const d of src) {
        rows.push({
          id: `dash::${d.id}`,
          date: d.date instanceof Date ? ymd(d.date) : String(d.date),
          description: d.description ?? '',
          paymentMethod: d.paymentMethod ?? '',
          note: d.note ?? '',
          amount: Math.abs(Number(d.amount) || 0),
          entry: null
        })
      }
    } else {
      rows.push({ id: t.id, date: t.date, description: t.description, paymentMethod: t.paymentMethod, note: t.note, amount: t.amount, entry: t })
    }
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date))
}

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

// ── 정렬·페이지네이션 (거래별 모드) — 최신순 ──
const sortedRows = computed<IncomeExpenseTx[]>(() =>
  filtered.value.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
)

const PAGE_SIZES = [10, 20, 50] as const
const pageSize = ref<number>(10)
const page = ref<number>(1)
const pageCount = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value)))
watch([pageSize, () => sortedRows.value.length], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
  if (page.value < 1) page.value = 1
})
// 필터가 바뀌면 1페이지로
watch(flt, () => { page.value = 1 })
// 모드 전환 시 페이지 초기화 — 합산 뷰에서 '수정'으로 넘어온 경우(editingId)는 해당 거래 페이지를 유지한다
watch(viewMode, () => {
  if (!editingId.value) page.value = 1
  expandedKeys.value = new Set()
})

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
// 설정에서 삭제·유형 변경된 카테고리를 가진 거래도 편집 select가 빈 칸이 되지 않게 현재 값을 포함한다
const editCategoryOptions = computed(() => {
  const base = editDraft.kind === '수입' ? incomeCategoryOptions.value : expenseCategoryOptions.value
  return editDraft.category && !base.includes(editDraft.category) ? [editDraft.category, ...base] : base
})

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
/** 카테고리 합산의 펼친 행에서 '수정' → 거래별 상세로 전환하고 해당 거래가 있는 페이지로 이동 */
function startEditFromGroup(t: IncomeExpenseTx) {
  startEdit(t)
  const idx = sortedRows.value.findIndex((x) => x.id === t.id)
  if (idx >= 0) page.value = Math.floor(idx / pageSize.value) + 1
  viewMode.value = 'transaction'
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
  if (editingId.value === id) editingId.value = null
  if (remove(id)) notify('ok', withBackupHint('삭제되었습니다'))
}

/** 지출제외 카테고리의 지출 거래 — 합계에서 빠진다는 걸 행에서 알려 준다 */
function isExcludedRow(t: IncomeExpenseTx): boolean {
  return tax.isExcludedCategory(t.category)
}

// ── 카테고리 아이콘(이모지) ──
const CATEGORY_EMOJI: Record<string, string> = {
  '급여': '🎁', '보너스': '🎁', '용돈': '💵', '이자': '💰', '환급': '💸',
  '판매수입': '🧾', '기타수입': '💼', '금융수입': '💰', '사업수입': '🧾',
  '식비': '🍴', '교통비': '🚇', '쇼핑': '🛍️', '통신비': '📱',
  '주거비': '🏠', '의료': '🏥', '의료/건강': '🏥', '문화/여가': '🎬', '교육': '📚',
  '경조사': '💝', '카페/간식': '☕', '기타지출': '💳',
  '생활': '🧺', '뷰티/미용': '💄', '자동차': '🚗', '온라인쇼핑': '📦',
  '환불': '↩️', '입출금': '🏦', '내계좌이체': '🔁', '저축': '🐖'
}
function emoji(cat: string): string {
  return CATEGORY_EMOJI[cat] ?? '💼'
}

// ── 포맷터 ──
function fmtSigned(t: IncomeExpenseTx): string {
  const sign = t.kind === '수입' ? '+' : '-'
  return `${sign}${fmtKRW(t.amount)}원`
}
function fmtNet(n: number): string {
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}${fmtKRW(Math.abs(n))}원`
}
</script>

<template>
  <!-- 본문 컨테이너: 화면 폭에 따라 max-width가 단계 확장됨. 정의는 assets/css/tailwind.css -->
  <div class="page-shell section-gap">
    <!-- 페이지 헤더 -->
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <nav class="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
          <NuxtLink to="/" class="hover:text-slate-700">홈</NuxtLink>
          <span>›</span>
          <span class="text-slate-700 font-medium">수입/지출 관리</span>
        </nav>
        <h2 class="text-2xl font-bold text-slate-900">수입/지출 관리</h2>
        <p class="text-sm text-slate-500 mt-0.5">직접 입력한 거래와 대시보드 사용내역을 한 곳에서 관리합니다.</p>
      </div>
      <div class="seg" role="tablist" aria-label="표시 방식">
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'category'"
          :class="['seg-btn', viewMode === 'category' && 'seg-on-neutral']"
          @click="viewMode = 'category'"
        >카테고리 합산</button>
        <button
          type="button"
          role="tab"
          :aria-selected="viewMode === 'transaction'"
          :class="['seg-btn', viewMode === 'transaction' && 'seg-on-neutral']"
          @click="viewMode = 'transaction'"
        >거래별 상세</button>
      </div>
    </div>

    <!-- 사용내역 가져오기 -->
    <section class="sync-card">
      <div class="sync-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/></svg>
      </div>
      <div class="flex-1 min-w-[16rem]">
        <h3 class="font-semibold text-base">사용내역(대시보드) 연동</h3>
        <p class="text-[13px] text-slate-300 mt-0.5">
          대시보드
          <b class="text-white tabular-nums">{{ dashboardTxs.length.toLocaleString('ko-KR') }}건</b>
          중 합계 항목
          <b class="text-emerald-300 tabular-nums">{{ dashboardImportCount.toLocaleString('ko-KR') }}건</b>
          이 이미 가져와져 있습니다.
        </p>
        <p class="text-xs text-slate-400 mt-0.5">
          가져오기는 거래를 <b class="text-slate-200">월×카테고리</b>로 묶어 지출 합계로 입력하며, 같은 (연월, 카테고리)는 중복 추가되지 않습니다.
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button
          v-if="dashboardImportCount > 0"
          type="button"
          class="btn-dark-ghost"
          @click="onResyncFromDashboard"
        >↻ 재동기화</button>
        <button
          v-if="dashboardImportCount > 0"
          type="button"
          class="btn-dark-ghost"
          @click="onClearDashboardImports"
        >가져온 항목 제거</button>
        <button
          type="button"
          class="btn-mint"
          :disabled="dashboardTxs.length === 0"
          @click="onImportFromDashboard"
        >+ 사용내역 가져오기</button>
      </div>
    </section>

    <!-- 토스트 -->
    <transition name="toast-drop">
      <div
        v-if="toast"
        :class="[
          'fixed top-6 inset-x-0 mx-auto w-fit text-center z-50 px-4 py-2 rounded-lg shadow text-sm whitespace-pre-line max-w-sm leading-relaxed',
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        ]"
      >{{ toast.text }}</div>
    </transition>

    <!-- 수입/지출 입력 -->
    <section class="card">
      <h3 class="font-semibold text-slate-900">수입/지출 입력</h3>
      <p class="text-[13px] text-slate-500 mt-0.5 mb-4">구분을 고르고 금액과 날짜를 입력하세요. 입력한 거래는 대시보드에도 자동 반영됩니다.</p>

      <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
        <!-- 구분 토글 -->
        <div>
          <label class="kpi-label">구분</label>
          <div class="seg mt-1 w-full">
            <button
              type="button"
              :class="['seg-btn flex-1', form.kind === '수입' && 'seg-on-in']"
              @click="form.kind = '수입'"
            >수입</button>
            <button
              type="button"
              :class="['seg-btn flex-1', form.kind === '지출' && 'seg-on-out']"
              @click="form.kind = '지출'"
            >지출</button>
          </div>
        </div>

        <!-- 카테고리 -->
        <div>
          <label class="kpi-label" for="ie-cat">카테고리</label>
          <select id="ie-cat" v-model="form.category" class="form-input mt-1">
            <option v-for="c in formCategoryOptions" :key="c" :value="c">{{ emoji(c) }} {{ c }}</option>
          </select>
        </div>

        <!-- 금액 -->
        <div>
          <label class="kpi-label" for="ie-amt">금액</label>
          <div class="relative mt-1">
            <input
              id="ie-amt"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              :value="amountText"
              placeholder="0"
              :class="['form-input pr-10 text-right tabular-nums', errors.amount && 'field-err']"
              @input="onAmountInput"
              @keydown.enter="onSubmit"
            />
            <span class="suffix">원</span>
          </div>
          <p v-if="errors.amount" class="field-msg">{{ errors.amount }}</p>
        </div>

        <!-- 날짜 -->
        <div>
          <label class="kpi-label" for="ie-date">날짜</label>
          <input
            id="ie-date"
            type="date"
            v-model="form.date"
            :class="['form-input mt-1', errors.date && 'field-err']"
            @input="errors.date = ''"
          />
          <p v-if="errors.date" class="field-msg">{{ errors.date }}</p>
        </div>

        <!-- 결제수단 -->
        <div>
          <label class="kpi-label" for="ie-pay">결제수단</label>
          <select id="ie-pay" v-model="form.paymentMethod" class="form-input mt-1">
            <option v-for="p in PAYMENT_METHODS" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
      </div>

      <!-- 내용 · 비고 -->
      <div class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="kpi-label" for="ie-desc">내용 (선택)</label>
          <input
            id="ie-desc"
            v-model="form.description"
            type="text"
            maxlength="60"
            placeholder="예: 9월 급여, 마트 장보기"
            class="form-input mt-1"
            @keydown.enter="onSubmit"
          />
        </div>
        <div>
          <label class="kpi-label" for="ie-note">비고 (선택)</label>
          <input
            id="ie-note"
            v-model="form.note"
            type="text"
            maxlength="100"
            placeholder="비고를 입력하세요"
            class="form-input mt-1"
            @keydown.enter="onSubmit"
          />
        </div>
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="onResetForm">초기화</button>
        <button type="button" class="btn-primary" @click="onSubmit">저장하기</button>
      </div>
    </section>

    <!-- 거래 이력: 필터 -->
    <section class="card">
      <h3 class="font-semibold text-slate-900">거래 이력</h3>
      <p class="text-[13px] text-slate-500 mt-0.5 mb-4">기간과 조건으로 거래를 좁혀 봅니다. 입력 즉시 반영됩니다.</p>

      <div class="flex flex-wrap items-end gap-3">
        <div>
          <label class="kpi-label" for="ie-f1">시작일</label>
          <input id="ie-f1" type="date" v-model="flt.startDate" class="form-input-sm block mt-1" />
        </div>
        <div>
          <label class="kpi-label" for="ie-f2">종료일</label>
          <input id="ie-f2" type="date" v-model="flt.endDate" class="form-input-sm block mt-1" />
        </div>
        <div>
          <span class="kpi-label">구분</span>
          <div class="seg mt-1">
            <button
              v-for="o in KIND_OPTS"
              :key="o.k"
              type="button"
              :class="['seg-btn seg-btn-sm', flt.kind === o.k && 'seg-on-neutral']"
              @click="flt.kind = o.k"
            >{{ o.t }}</button>
          </div>
        </div>
        <div>
          <label class="kpi-label" for="ie-f3">카테고리</label>
          <select id="ie-f3" v-model="flt.category" class="form-input-sm block mt-1">
            <option value="all">전체</option>
            <option v-for="c in filterCategoryOptions" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div>
          <label class="kpi-label" for="ie-f4">결제수단</label>
          <select id="ie-f4" v-model="flt.paymentMethod" class="form-input-sm block mt-1">
            <option value="all">전체</option>
            <option v-for="p in paymentOptions" :key="p" :value="p">{{ p }}</option>
          </select>
        </div>
        <div class="flex-1 min-w-[12rem]">
          <label class="kpi-label" for="ie-fq">검색</label>
          <input
            id="ie-fq"
            v-model="flt.q"
            type="search"
            placeholder="카테고리, 내용, 비고, 결제수단"
            class="form-input-sm block w-full mt-1"
          />
        </div>
        <button
          type="button"
          :class="['btn-secondary', !isFilterDirty && 'opacity-60']"
          @click="onResetFilter"
        >필터 초기화</button>
      </div>

      <!-- 기간 프리셋 -->
      <div class="mt-3 flex flex-wrap items-center gap-1.5">
        <span class="text-xs text-slate-400 mr-1">기간</span>
        <button
          v-for="p in PRESETS"
          :key="p.key"
          type="button"
          :class="['chip', activePreset === p.key && 'chip-on']"
          @click="applyPreset(p.key)"
        >{{ p.label }}</button>
      </div>
    </section>

    <!-- KPI -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div class="kpi kpi-in">
        <div class="text-xs font-semibold text-slate-500">총 수입</div>
        <div class="kpi-num text-blue-800">{{ fmtKRW(totalIncome) }}원</div>
        <div class="text-xs text-slate-400 mt-0.5">{{ summary.inCnt.toLocaleString('ko-KR') }}건</div>
      </div>
      <div class="kpi kpi-out">
        <div class="text-xs font-semibold text-slate-500">총 지출</div>
        <div class="kpi-num text-rose-800">{{ fmtKRW(totalExpense) }}원</div>
        <div class="text-xs text-slate-400 mt-0.5">
          {{ summary.outCnt.toLocaleString('ko-KR') }}건<template v-if="summary.exCnt > 0">
            · 지출제외 {{ summary.exCnt.toLocaleString('ko-KR') }}건({{ fmtKRW(summary.exAmt) }}원) 별도
          </template>
        </div>
      </div>
      <div :class="['kpi', netProfit < 0 ? 'kpi-out' : 'kpi-net']">
        <div class="text-xs font-semibold text-slate-500">순수익</div>
        <div :class="['kpi-num', netProfit < 0 ? 'text-rose-800' : 'text-teal-700']">{{ fmtNet(netProfit) }}</div>
        <div class="text-xs text-slate-400 mt-0.5">
          수입 − 지출<template v-if="netRate !== null"> · 수입 대비 {{ netRate.toFixed(1) }}%</template>
        </div>
        <div
          v-if="totalIncome + totalExpense > 0"
          class="mt-3 h-2 rounded-full bg-slate-100 overflow-hidden flex"
          role="img"
          :aria-label="`수입 ${incomePct.toFixed(0)}% 지출 ${(100 - incomePct).toFixed(0)}%`"
        >
          <i class="block h-full bg-blue-600" :style="{ width: incomePct + '%' }"></i>
          <i class="block h-full bg-rose-600" :style="{ width: (100 - incomePct) + '%' }"></i>
        </div>
      </div>
    </div>

    <!-- 합산 / 상세 -->
    <section class="card">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 class="font-semibold text-slate-900">
          {{ viewMode === 'category' ? '카테고리 합산' : '거래별 상세' }}
          <span class="text-slate-400 font-normal text-[13px] ml-1">
            · {{ viewMode === 'category' ? `${categoryGroups.length}개 카테고리` : `${filtered.length.toLocaleString('ko-KR')}건` }}
          </span>
        </h3>
        <div v-if="viewMode === 'category' && categoryGroups.length > 0" class="flex items-center gap-2">
          <span class="text-[11px] text-slate-400 hidden sm:inline">행을 클릭하면 거래가 펼쳐집니다</span>
          <button type="button" class="btn-mini" @click="expandAll">모두 펼치기</button>
          <button type="button" class="btn-mini" @click="collapseAll">모두 접기</button>
        </div>
      </div>

      <!-- 카테고리 합산 테이블 -->
      <div v-if="viewMode === 'category'" class="overflow-x-auto rounded-lg border border-slate-200">
        <!--
          컬럼 폭 고정 (table-layout: fixed).
          카테고리 이름 길이·금액 자릿수·펼침 여부가 달라져도 컬럼 경계가 움직이지 않는다.
          폭을 조정할 일이 생기면 이 colgroup과 아래 .ie-cat-table col 규칙만 고치면 된다.
          남는 폭은 '합계'가 가져간다.
        -->
        <table class="ie-table ie-cat-table text-sm">
          <colgroup>
            <col class="cat-col-toggle" />
            <col class="cat-col-kind" />
            <col class="cat-col-name" />
            <col class="cat-col-count" />
            <col class="cat-col-avg" />
            <col class="cat-col-latest" />
            <col class="cat-col-share" />
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
              <th class="py-2 px-3 text-right">비중</th>
              <th class="py-2 px-3 text-right">합계</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="g in categoryGroups" :key="g.key">
              <!-- 카테고리 합계 행 -->
              <tr
                class="border-t border-slate-100 hover:bg-slate-50/60 cursor-pointer"
                tabindex="0"
                :aria-expanded="expandedKeys.has(g.key)"
                @click="toggleExpand(g.key)"
                @keydown.enter.self="toggleExpand(g.key)"
                @keydown.space.self.prevent="toggleExpand(g.key)"
              >
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
                    <span v-if="g.excluded" class="ex-badge" title="카테고리 설정의 '지출제외' — 총 지출에서 빠집니다">제외</span>
                  </span>
                </td>
                <td class="py-2 px-3 text-right tabular-nums text-slate-600">{{ g.count.toLocaleString('ko-KR') }}건</td>
                <td class="py-2 px-3 text-right tabular-nums text-slate-500">{{ fmtKRW(g.avg) }}원</td>
                <td class="py-2 px-3 tabular-nums text-slate-500">{{ g.latestDate || '–' }}</td>
                <td class="py-2 px-3">
                  <div v-if="g.pct !== null" class="share" :title="`${g.kind} 합계 대비 ${g.pct.toFixed(1)}%`">
                    <span class="share-track"><i :class="g.kind === '수입' ? 'bg-blue-600' : 'bg-rose-600'" :style="{ width: Math.max(2, g.pct) + '%' }"></i></span>
                    <span class="share-num">{{ g.pct.toFixed(1) }}%</span>
                  </div>
                  <div v-else class="text-right text-xs text-slate-300">–</div>
                </td>
                <td
                  :class="[
                    'py-2 px-3 text-right tabular-nums font-bold text-base',
                    g.kind === '수입' ? 'text-blue-600' : g.excluded ? 'text-slate-400' : 'text-rose-600'
                  ]"
                >{{ g.kind === '수입' ? '+' : '-' }}{{ fmtKRW(g.total) }}원</td>
              </tr>
              <!-- 펼친 개별 거래 -->
              <template v-if="expandedKeys.has(g.key)">
                <tr v-for="r in detailsOf(g)" :key="r.id" class="border-t border-slate-50 bg-slate-50/40">
                  <td class="py-1.5 px-3"></td>
                  <td class="py-1.5 px-3 tabular-nums text-slate-500 text-xs">{{ r.date }}</td>
                  <td class="py-1.5 px-3 text-slate-600 text-xs cell-ellipsis" colspan="2" :title="r.description || ''">{{ r.description || '–' }}</td>
                  <td class="py-1.5 px-3 text-slate-500 text-xs cell-ellipsis" colspan="3" :title="r.note ? `${r.paymentMethod} · ${r.note}` : r.paymentMethod">{{ r.paymentMethod }}<span v-if="r.note" class="ml-2 text-slate-400">· {{ r.note }}</span></td>
                  <td
                    :class="[
                      'py-1.5 px-3 text-right tabular-nums text-xs whitespace-nowrap',
                      g.kind === '수입' ? 'text-blue-600' : g.excluded ? 'text-slate-400' : 'text-rose-600'
                    ]"
                  >{{ g.kind === '수입' ? '+' : '-' }}{{ fmtKRW(r.amount) }}원
                    <template v-if="r.entry">
                      <button type="button" class="icon-btn icon-edit ml-1" title="수정" aria-label="수정" @click.stop="startEditFromGroup(r.entry)">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                      <button type="button" class="icon-btn icon-del" title="삭제" aria-label="삭제" @click.stop="onRemove(r.entry.id)">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
                      </button>
                    </template>
                  </td>
                </tr>
              </template>
            </template>
            <tr v-if="categoryGroups.length === 0">
              <td colspan="8" class="py-10 text-center text-slate-400 text-sm">조건에 맞는 거래가 없습니다.</td>
            </tr>
          </tbody>
          <tfoot v-if="categoryGroups.length > 0">
            <tr class="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-700">
              <td class="py-2 px-3" colspan="3">합계 (활성 멤버 · 적용 필터 기준)</td>
              <td class="py-2 px-3 text-right tabular-nums">{{ (summary.inCnt + summary.outCnt + summary.exCnt).toLocaleString('ko-KR') }}건</td>
              <td class="py-2 px-3" colspan="3"></td>
              <td class="py-2 px-3 text-right tabular-nums whitespace-nowrap">
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
              <tr v-if="editingId !== t.id" class="border-t border-slate-100 hover:bg-slate-50/60">
                <td class="py-2 px-3 tabular-nums text-slate-700">{{ t.date }}</td>
                <td class="py-2 px-3">
                  <span :class="['kind-badge', t.kind === '수입' ? 'kind-income' : 'kind-expense']">{{ t.kind }}</span>
                </td>
                <td class="py-2 px-3">
                  <span class="cat-cell text-slate-700" :title="t.category">
                    <span class="cat-emoji">{{ emoji(t.category) }}</span>
                    <span class="cat-name">{{ t.category }}</span>
                    <span v-if="isExcludedRow(t)" class="ex-badge" title="카테고리 설정의 '지출제외' — 총 지출에서 빠집니다">제외</span>
                  </span>
                </td>
                <td class="py-2 px-3 text-slate-700 cell-ellipsis" :title="t.description || ''">{{ t.description || '–' }}</td>
                <td class="py-2 px-3 text-slate-600 cell-ellipsis" :title="t.paymentMethod">{{ t.paymentMethod }}</td>
                <td
                  :class="[
                    'py-2 px-3 text-right tabular-nums font-semibold',
                    t.kind === '수입' ? 'text-blue-600' : isExcludedRow(t) ? 'text-slate-400' : 'text-rose-600'
                  ]"
                >{{ fmtSigned(t) }}</td>
                <td class="py-2 px-3 text-slate-500 cell-ellipsis" :title="t.note || ''">{{ t.note || '–' }}</td>
                <td class="py-2 px-3 text-center whitespace-nowrap">
                  <button type="button" class="icon-btn icon-edit" title="수정" aria-label="수정" @click="startEdit(t)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button type="button" class="icon-btn icon-del" title="삭제" aria-label="삭제" @click="onRemove(t.id)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                  </button>
                </td>
              </tr>
              <!-- 편집 행 (Enter 저장 / Esc 취소) -->
              <tr
                v-else
                class="border-t border-slate-100 bg-amber-50/40"
                @keydown.enter.prevent="commitEdit"
                @keydown.esc="cancelEdit"
              >
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
                    <option v-for="p in paymentOptions" :key="p" :value="p">{{ p }}</option>
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
                조건에 맞는 거래가 없습니다.
              </td>
            </tr>
          </tbody>
          <tfoot v-if="sortedRows.length > 0">
            <tr class="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-700">
              <td class="py-2 px-3" colspan="5">합계 (필터 기준 {{ sortedRows.length.toLocaleString('ko-KR') }}건)</td>
              <td class="py-2 px-3 text-right tabular-nums whitespace-nowrap" colspan="3">
                <span class="text-blue-600">+{{ fmtKRW(totalIncome) }}</span>
                <span class="text-slate-400 mx-1">/</span>
                <span class="text-rose-600">-{{ fmtKRW(totalExpense) }}</span>
              </td>
            </tr>
          </tfoot>
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
.field-err { @apply border-rose-400 focus:border-rose-500 focus:ring-rose-500; }
.field-msg { @apply mt-1 text-xs text-rose-700; }
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
 * 카테고리 합산 — 고정분 852px + 합계(auto)
 *
 * 남는 폭을 가져가는 auto 컬럼은 '합계'다. 처음엔 '카테고리'를 auto로 뒀는데,
 * 이 표에서 auto 컬럼이 하나뿐이라 넓은 화면에서 남는 폭을 전부 흡수해
 * 카테고리 한 컬럼만 800px 넘게 늘어났다. 카테고리 이름은 길어야 열 글자 남짓이므로
 * 240px로 고정하고, 남는 폭은 우측 정렬 숫자인 '합계'가 받도록 바꿨다
 * (숫자 컬럼은 여백이 늘어도 어색하지 않다).
 * '비중'(막대 + 퍼센트)은 160px — 막대 80px + 숫자 52px가 들어가는 최소 폭.
 */
.ie-cat-table { min-width: 1020px; }
.cat-col-toggle { width: 36px; }
.cat-col-kind   { width: 88px; }
.cat-col-name   { width: 240px; }
.cat-col-count  { width: 88px; }
.cat-col-avg    { width: 128px; }
.cat-col-latest { width: 112px; }
.cat-col-share  { width: 160px; }
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


/* ── 세그먼트 토글 (구분 / 표시 방식 / 필터 구분) ── */
.seg {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: rgb(241 245 249);
}
.seg-btn {
  min-height: 36px;
  padding: 0 16px;
  border-radius: 9px;
  font-size: 13.5px;
  font-weight: 600;
  color: rgb(100 116 139);
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
}
.seg-btn:hover { color: rgb(15 23 42); }
.seg-btn-sm { min-height: 32px; padding: 0 14px; font-size: 12.5px; }
.seg-on-neutral,
.seg-on-neutral:hover {
  background: #fff;
  color: rgb(15 23 42);
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.12);
}
.seg-on-in,
.seg-on-in:hover { background: rgb(37 99 235); color: #fff; }
.seg-on-out,
.seg-on-out:hover { background: rgb(225 29 72); color: #fff; }

/* ── 사용내역 연동 카드 ── */
.sync-card {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: clamp(0.875rem, 0.5rem + 0.7vw, 1.5rem);
  border-radius: 1rem;
  color: #fff;
  background: linear-gradient(135deg, rgb(15 23 42), rgb(30 41 59));
}
.sync-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: rgb(110 231 183);
  background: rgba(110, 231, 183, 0.16);
}
.btn-dark-ghost {
  @apply px-3 py-1.5 rounded-md border border-white/30 text-white text-xs font-medium hover:bg-white/10 disabled:opacity-40;
}
.btn-mint {
  @apply px-3 py-1.5 rounded-md bg-emerald-300 text-emerald-950 text-xs font-bold hover:bg-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed;
}

/* ── 기간 프리셋 칩 ── */
.chip {
  @apply px-2.5 py-1 rounded-full border border-slate-200 bg-white text-xs text-slate-600 hover:bg-slate-50;
}
.chip-on,
.chip-on:hover {
  @apply border-brand-600 bg-brand-50 text-brand-700 font-semibold;
}

/* ── KPI ── */
.kpi {
  position: relative;
  overflow: hidden;
  padding: 16px 20px 16px 24px;
  border-radius: 1rem;
  background: #fff;
  box-shadow: 0 0 0 1px rgb(226 232 240), 0 1px 2px rgba(15, 23, 42, 0.05);
}
.kpi::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 5px;
}
.kpi-in::before { background: rgb(37 99 235); }
.kpi-out::before { background: rgb(225 29 72); }
.kpi-net::before { background: rgb(13 148 136); }
.kpi-num {
  margin-top: 2px;
  font-size: clamp(1.375rem, 1.1rem + 0.8vw, 1.875rem);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
  font-variant-numeric: tabular-nums;
}

/* ── 지출제외 배지 / 비중 막대 ── */
.ex-badge {
  flex: 0 0 auto;
  padding: 0 6px;
  border-radius: 4px;
  background: rgb(241 245 249);
  color: rgb(100 116 139);
  font-size: 10.5px;
  font-weight: 600;
  line-height: 18px;
}
.share {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}
.share-track {
  display: block;
  width: 80px;
  height: 6px;
  border-radius: 999px;
  background: rgb(241 245 249);
  overflow: hidden;
}
.share-track > i { display: block; height: 100%; border-radius: 999px; }
.share-num {
  width: 44px;
  text-align: right;
  font-size: 12.5px;
  color: rgb(100 116 139);
  font-variant-numeric: tabular-nums;
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
