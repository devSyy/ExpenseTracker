<script setup lang="ts">
import { formatDate, formatGrouped } from '~/utils/format'
// 카드 관리 페이지: 보유 카드 리스트, 사용금액 차트, 혜택 단계·달성률.
// 사용금액은 대시보드 거래(useExpenses)에 연결된 paymentMethod 합계로 자동 계산된다.
import { computed, reactive, ref, watch } from 'vue'
import { Bar } from 'vue-chartjs'
import { useCards, type CardItem, type CardBenefitTier } from '~/composables/useCards'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '카드 관리 · 가계부' })

const {
  state,
  period,
  periodLabel,
  availablePeriods,
  availablePaymentMethods,
  cardCount,
  linkedCardCount,
  totalSpending,
  totalBenefitTiers,
  achievedTiers,
  achievedValue,
  cardDetails,
  usageOf,
  ownerOf,
  unlinkedPaymentMethods,
  brokenLinksOf,
  suggestLinksFor,
  linkPayment,
  addCard,
  updateCard,
  removeCard,
  addBenefit,
  updateBenefit,
  removeBenefit,
  autoGenerateFromDashboard,
  setBaseDate
} = useCards()

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 카드 추가/편집 ──
const adding = ref(false)
const newCardDraft = reactive<Omit<CardItem, 'id'>>({
  name: '', issuer: '', type: '신용카드', number: '',
  color: '#3b82f6', monthlySpending: 0, benefits: [], note: '',
  linkedPaymentMethods: []
})
const TYPE_OPTIONS = ['신용카드', '체크카드', '하이브리드']
const ISSUER_OPTIONS = ['신한카드', 'KB국민카드', '삼성카드', '현대카드', '롯데카드', '하나카드', 'NH농협카드', 'BC카드', '우리카드', '카카오뱅크', '토스뱅크']
const COLOR_PRESETS = ['#0046ff', '#1428a0', '#ffbc00', '#e60012', '#22c55e', '#0ea5e9', '#8b5cf6', '#f97316', '#0f172a']

function resetAddDraft() {
  Object.assign(newCardDraft, {
    name: '', issuer: '', type: '신용카드', number: '',
    color: '#3b82f6', monthlySpending: 0, benefits: [], note: '',
    linkedPaymentMethods: []
  })
}

function onAddCard() {
  if (!newCardDraft.name || !newCardDraft.issuer) {
    notify('err', '카드 이름과 카드사를 입력하세요'); return
  }
  addCard({ ...newCardDraft, benefits: [] })
  resetAddDraft()
  adding.value = false
  notify('ok', withBackupHint('카드가 추가되었습니다'))
}

function toggleNewLink(pm: string) {
  const list = newCardDraft.linkedPaymentMethods ?? []
  newCardDraft.linkedPaymentMethods = list.includes(pm)
    ? list.filter((x) => x !== pm)
    : [...list, pm]
}

const editingCardId = ref<string | null>(null)
const editCardDraft = reactive<CardItem>({
  id: '', name: '', issuer: '', type: '신용카드', number: '',
  color: '#3b82f6', monthlySpending: 0, benefits: [], note: '',
  linkedPaymentMethods: []
})
function startEditCard(card: CardItem) {
  editingCardId.value = card.id
  Object.assign(editCardDraft, card, {
    linkedPaymentMethods: (card.linkedPaymentMethods ?? []).slice()
  })
}
function cancelEditCard() { editingCardId.value = null }
function commitEditCard() {
  if (!editingCardId.value) return
  updateCard(editingCardId.value, {
    name: editCardDraft.name, issuer: editCardDraft.issuer, type: editCardDraft.type,
    number: editCardDraft.number, color: editCardDraft.color,
    monthlySpending: Number(editCardDraft.monthlySpending) || 0,
    note: editCardDraft.note,
    linkedPaymentMethods: editCardDraft.linkedPaymentMethods ?? []
  })
  editingCardId.value = null
  notify('ok', withBackupHint('카드가 수정되었습니다'))
}
function toggleEditLink(pm: string) {
  const list = editCardDraft.linkedPaymentMethods ?? []
  editCardDraft.linkedPaymentMethods = list.includes(pm)
    ? list.filter((x) => x !== pm)
    : [...list, pm]
}
function onRemoveCard(id: string) {
  if (!window.confirm('이 카드와 모든 혜택 정보를 삭제할까요?')) return
  if (removeCard(id)) notify('ok', withBackupHint('카드가 삭제되었습니다'))
}

function onAutoGenerate() {
  if (availablePaymentMethods.value.length === 0) {
    notify('err', '대시보드에 거래 데이터가 없습니다. 먼저 엑셀을 업로드하세요.'); return
  }
  const r = autoGenerateFromDashboard()
  if (r.added > 0) {
    notify('ok', withBackupHint(`${r.added}개 카드가 자동 생성되었습니다${r.skipped > 0 ? ` · ${r.skipped}개는 이미 연결됨` : ''}`))
  } else {
    notify('ok', `이미 모든 결제수단(${r.skipped}개)이 카드에 연결되어 있습니다`)
  }
}

// ── 혜택 추가 (선택된 카드별) ──
const benefitDrafts = reactive<Record<string, { threshold: number; benefit: string; benefitValue: number }>>({})
function getBenefitDraft(cardId: string) {
  if (!benefitDrafts[cardId]) {
    benefitDrafts[cardId] = { threshold: 0, benefit: '', benefitValue: 0 }
  }
  return benefitDrafts[cardId]
}
function onAddBenefit(cardId: string) {
  const d = getBenefitDraft(cardId)
  const t = Number(d.threshold)
  if (!Number.isFinite(t) || t <= 0) { notify('err', '조건 금액을 입력하세요'); return }
  if (!d.benefit.trim()) { notify('err', '혜택 내용을 입력하세요'); return }
  addBenefit(cardId, { threshold: t, benefit: d.benefit.trim(), benefitValue: Number(d.benefitValue) || undefined })
  benefitDrafts[cardId] = { threshold: 0, benefit: '', benefitValue: 0 }
  notify('ok', withBackupHint('혜택이 추가되었습니다'))
}
function onRemoveBenefit(cardId: string, idx: number) {
  if (!window.confirm('이 혜택을 삭제할까요?')) return
  removeBenefit(cardId, idx)
}

// 인라인 혜택 편집
const editingBenefit = ref<{ cardId: string; idx: number } | null>(null)
const editBenefitDraft = reactive<CardBenefitTier>({ threshold: 0, benefit: '', benefitValue: 0 })
function startEditBenefit(cardId: string, idx: number, tier: CardBenefitTier) {
  editingBenefit.value = { cardId, idx }
  editBenefitDraft.threshold = tier.threshold
  editBenefitDraft.benefit = tier.benefit
  editBenefitDraft.benefitValue = tier.benefitValue ?? 0
}
function cancelEditBenefit() { editingBenefit.value = null }
function commitEditBenefit() {
  if (!editingBenefit.value) return
  const { cardId, idx } = editingBenefit.value
  updateBenefit(cardId, idx, {
    threshold: Number(editBenefitDraft.threshold) || 0,
    benefit: editBenefitDraft.benefit.trim(),
    benefitValue: Number(editBenefitDraft.benefitValue) || undefined
  })
  editingBenefit.value = null
  notify('ok', withBackupHint('혜택이 수정되었습니다'))
}

// ── 정렬 (사용금액 기준) ──
type SortKey = 'default' | 'spend-desc' | 'spend-asc' | 'name'
const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'default', label: '등록순' },
  { value: 'spend-desc', label: '사용금액 많은순' },
  { value: 'spend-asc', label: '사용금액 적은순' },
  { value: 'name', label: '이름순' }
]
const sortKey = ref<SortKey>('spend-desc')
const sortedDetails = computed(() => {
  const list = cardDetails.value.slice() // 원본 순서(등록순)는 건드리지 않는다
  switch (sortKey.value) {
    case 'spend-desc': return list.sort((a, b) => b.spending - a.spending || a.card.name.localeCompare(b.card.name, 'ko'))
    case 'spend-asc': return list.sort((a, b) => a.spending - b.spending || a.card.name.localeCompare(b.card.name, 'ko'))
    case 'name': return list.sort((a, b) => a.card.name.localeCompare(b.card.name, 'ko'))
    default: return list
  }
})

// ── 사용내역 (선택한 카드) ──
const selectedId = ref<string | null>(null)
const selected = computed(() => {
  const list = cardDetails.value
  return list.find((d) => d.card.id === selectedId.value) ?? list[0] ?? null
})
const usage = computed(() => (selected.value ? usageOf(selected.value.card) : null))
const usageSearch = ref('')
const showExcluded = ref(true)
const PAGE = 30
const usageLimit = ref(PAGE)
type UsageSort = 'date-desc' | 'date-asc' | 'amount-desc' | 'amount-asc'
const usageSort = ref<UsageSort>('date-desc')
watch([selectedId, period, usageSearch, showExcluded, usageSort], () => { usageLimit.value = PAGE })
/** 헤더 클릭: 같은 열이면 방향 토글, 다른 열이면 내림차순부터 */
function toggleUsageSort(col: 'date' | 'amount') {
  usageSort.value = usageSort.value === `${col}-desc` ? `${col}-asc` : `${col}-desc`
}
function sortMark(col: 'date' | 'amount'): string {
  if (!usageSort.value.startsWith(col)) return '↕'
  return usageSort.value.endsWith('desc') ? '↓' : '↑'
}

const usageRows = computed(() => {
  const u = usage.value
  if (!u) return []
  const q = usageSearch.value.trim().toLowerCase()
  const list = u.rows.filter((r) => {
    if (!showExcluded.value && !r.counted) return false
    if (q && !`${r.tx.description} ${r.tx.category}`.toLowerCase().includes(q)) return false
    return true
  })
  const time = (r: { tx: { date: unknown } }) => new Date(r.tx.date as string).getTime()
  const amt = (r: { tx: { amount: number } }) => Number(r.tx.amount) || 0
  // 동점이면 최신 거래가 위로 (원본 rows가 이미 최신순이라 안정 정렬로 유지됨)
  switch (usageSort.value) {
    case 'date-asc': return list.sort((a, b) => time(a) - time(b))
    case 'amount-desc': return list.sort((a, b) => amt(b) - amt(a) || time(b) - time(a))
    case 'amount-asc': return list.sort((a, b) => amt(a) - amt(b) || time(b) - time(a))
    default: return list.sort((a, b) => time(b) - time(a))
  }
})
const maxMonth = computed(() => Math.max(1, ...(usage.value?.byMonth ?? []).map((m) => m.amount)))

function fmtDate(v: unknown): string {
  const d = v instanceof Date ? v : new Date(v as string)
  if (Number.isNaN(d.getTime())) return '-'
  return formatDate(d)
}
/** 이미 다른 카드가 쓰는 결제수단인지 (이중 집계 방지) */
function takenByOther(pm: string, cardId: string | null): boolean {
  const o = ownerOf(pm)
  return !!o && o.id !== cardId
}
function onLinkSuggested(cardId: string, pm: string) {
  if (linkPayment(cardId, pm)) notify('ok', withBackupHint(`'${pm}' 연결됨 — 사용내역이 동기화되었습니다`))
}
// ── 포맷터 ──
const fmtKRW = (n: number): string => formatGrouped(n, true)
function fmtMan(n: number): string {
  // 1만원 이상은 만원 단위, 미만은 원 단위
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원`
  return `${fmtKRW(n)}원`
}
function pctText(p: number): string {
  return `${(p * 100).toFixed(0)}%`
}

// ── 차트: 카드별 사용금액 (수평 바) ──
// d.spending(계산된 사용금액)을 사용해 대시보드 데이터에 따라 자동 갱신.
const spendingChartData = computed(() => {
  const sorted = cardDetails.value.slice().sort((a, b) => b.spending - a.spending)
  return {
    labels: sorted.map((d) => d.card.name),
    datasets: [
      {
        label: `사용금액 (${periodLabel.value})`,
        data: sorted.map((d) => Math.round(d.spending / 10_000)),
        backgroundColor: sorted.map((d) => d.card.color),
        borderRadius: 6,
        maxBarThickness: 24
      }
    ]
  }
})

const spendingChartOptions = {
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${Number(ctx.parsed.x).toLocaleString('ko-KR')}만원`
      }
    }
  },
  scales: {
    x: {
      beginAtZero: true,
      ticks: { callback: (v: any) => Number(v).toLocaleString('ko-KR') + '만' },
      grid: { color: 'rgba(148,163,184,0.2)' }
    },
    y: { grid: { display: false } }
  }
}

// 막대 끝에 값 라벨
const valueLabelsPlugin = {
  id: 'valueLabels',
  afterDatasetsDraw(chart: any) {
    const { ctx } = chart
    chart.data.datasets.forEach((dataset: any, di: number) => {
      const meta = chart.getDatasetMeta(di)
      meta.data.forEach((bar: any, i: number) => {
        const v = dataset.data[i]
        if (v == null || v === 0) return
        ctx.save()
        ctx.fillStyle = '#475569'
        ctx.font = '11px Pretendard, sans-serif'
        ctx.textAlign = 'left'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${Number(v).toLocaleString('ko-KR')}만원`, bar.x + 6, bar.y)
        ctx.restore()
      })
    })
  }
}

// ── 카드 비주얼 헬퍼 ──
function lightenColor(hex: string, amount = 30): string {
  // 카드 그라데이션 보조색 — hex를 살짝 밝게
  const c = hex.replace('#', '')
  const num = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16)
  let r = (num >> 16) + amount
  let g = ((num >> 8) & 0xff) + amount
  let b = (num & 0xff) + amount
  r = Math.max(0, Math.min(255, r))
  g = Math.max(0, Math.min(255, g))
  b = Math.max(0, Math.min(255, b))
  return `rgb(${r},${g},${b})`
}
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 헤더 -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-md bg-blue-50 text-blue-600 grid place-items-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        </div>
        <h2 class="text-2xl font-bold text-slate-900">카드 관리</h2>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
        <span class="inline-flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 font-medium" title="대시보드 거래가 바뀌면 사용내역이 즉시 반영됩니다">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>대시보드 연동 · 결제수단 {{ linkedCardCount }}/{{ cardCount }}
        </span>
        <span>기간:</span>
        <select v-model="period" class="form-input-sm">
          <option value="current">이번 달</option>
          <option value="all">전체</option>
          <option v-for="ym in availablePeriods" :key="ym" :value="ym">{{ ym }}</option>
        </select>
        <span class="text-slate-300 mx-1">·</span>
        <span>기준일:</span>
        <input
          type="date"
          :value="state.baseDate"
          @change="setBaseDate(($event.target as HTMLInputElement).value)"
          class="form-input-sm"
        />
      </div>
    </div>

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

    <!-- 4개 요약 카드 -->
    <!-- 카드 KPI: 모바일 2장 → 태블릿/데스크톱 4장 (기본은 sm부터 4로 가도 카드 폭 충분) -->
    <div class="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-4">
      <div class="card">
        <div class="text-xs font-semibold text-blue-600 mb-1">보유 카드</div>
        <div class="text-2xl font-bold text-slate-900 tabular-nums">{{ cardCount }}<span class="text-sm font-medium ml-1">장</span></div>
      </div>
      <div class="card">
        <div class="text-xs font-semibold text-rose-600 mb-1">{{ period === 'all' ? '전체' : period === 'current' ? '이번 달' : period }} 사용금액</div>
        <div class="text-2xl font-bold text-rose-600 tabular-nums">{{ fmtKRW(totalSpending) }}<span class="text-sm font-medium ml-1">원</span></div>
      </div>
      <div class="card">
        <div class="text-xs font-semibold text-emerald-600 mb-1">달성한 혜택</div>
        <div class="text-2xl font-bold text-slate-900 tabular-nums">{{ achievedTiers }}<span class="text-sm font-medium text-slate-500 ml-1">/ {{ totalBenefitTiers }}</span></div>
        <div v-if="totalBenefitTiers > 0" class="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div class="h-full bg-emerald-500 transition-all" :style="{ width: (achievedTiers / Math.max(1, totalBenefitTiers) * 100) + '%' }"></div>
        </div>
      </div>
      <div class="card">
        <div class="text-xs font-semibold text-amber-600 mb-1">예상 혜택 가치</div>
        <div class="text-2xl font-bold text-amber-600 tabular-nums">{{ fmtKRW(achievedValue) }}<span class="text-sm font-medium ml-1">원</span></div>
        <div class="text-[11px] text-slate-500 mt-1">달성 단계 기준</div>
      </div>
    </div>

    <!-- 미연결 결제수단 안내 -->
    <div v-if="unlinkedPaymentMethods.length > 0" class="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 flex items-start gap-3 flex-wrap">
      <div class="flex-1 min-w-[240px]">
        <b>카드에 연결되지 않은 결제수단 {{ unlinkedPaymentMethods.length }}개</b> — 이 결제수단의 거래는 카드 실적에 잡히지 않습니다.
        <div class="mt-1.5 flex flex-wrap gap-1.5">
          <span v-for="pm in unlinkedPaymentMethods" :key="pm" class="px-2 py-0.5 rounded-full bg-white border border-amber-200">{{ pm }}</span>
        </div>
      </div>
      <button type="button" class="btn-secondary text-xs px-3 py-1.5" @click="onAutoGenerate">⚡ 카드로 자동생성</button>
    </div>

    <!-- 보유 카드 리스트 (카드 비주얼 그리드) -->
    <section class="card">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 class="font-semibold text-slate-900">보유 카드</h3>
          <p class="text-[11px] text-slate-500 mt-0.5">
            대시보드 결제수단
            <b class="text-slate-700">{{ availablePaymentMethods.length }}개</b>
            중
            <b class="text-blue-600">{{ linkedCardCount }}/{{ cardCount }}</b>
            개의 카드가 연결되어 자동 계산됩니다.
          </p>
        </div>
        <div class="flex gap-2 items-center flex-wrap">
          <label class="text-[11px] text-slate-500 flex items-center gap-1">정렬
            <select v-model="sortKey" class="form-input-sm">
              <option v-for="o in SORT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
          </label>
          <button
            type="button"
            class="btn-secondary text-xs px-3 py-1.5"
            :disabled="availablePaymentMethods.length === 0"
            title="대시보드의 결제수단마다 카드를 자동 생성"
            @click="onAutoGenerate"
          >⚡ 결제수단으로 자동생성</button>
          <button v-if="!adding" type="button" class="btn-primary text-xs px-3 py-1.5" @click="adding = true">+ 카드 추가</button>
        </div>
      </div>

      <!-- 카드 추가 폼 -->
      <div v-if="adding" class="mb-4 p-3 rounded-lg border border-slate-200 bg-slate-50/60">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input v-model="newCardDraft.name" type="text" placeholder="카드 이름" class="form-input-sm" />
          <select v-model="newCardDraft.issuer" class="form-input-sm">
            <option value="">카드사 선택</option>
            <option v-for="i in ISSUER_OPTIONS" :key="i" :value="i">{{ i }}</option>
          </select>
          <select v-model="newCardDraft.type" class="form-input-sm">
            <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
          </select>
          <input v-model="newCardDraft.number" type="text" placeholder="카드번호 (예: **** **** **** 1234)" class="form-input-sm" />
          <div class="relative">
            <input v-model.number="newCardDraft.monthlySpending" type="number" placeholder="이번 달 사용금액" class="form-input-sm pr-8 text-right tabular-nums" />
            <span class="suffix">원</span>
          </div>
          <div class="flex items-center gap-1">
            <span class="text-xs text-slate-500 mr-1">색상:</span>
            <button
              v-for="c in COLOR_PRESETS"
              :key="c"
              type="button"
              :class="['w-5 h-5 rounded-full border-2', newCardDraft.color === c ? 'border-slate-900' : 'border-white']"
              :style="{ background: c }"
              @click="newCardDraft.color = c"
            ></button>
          </div>
        </div>

        <!-- 결제수단 연결 -->
        <div v-if="availablePaymentMethods.length > 0" class="mt-3">
          <div class="text-xs text-slate-600 mb-1.5">
            대시보드 결제수단 연결 <span class="text-slate-400">— 사용금액 자동 계산</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="pm in availablePaymentMethods"
              :key="pm"
              type="button"
              :class="[
                'pm-chip',
                (newCardDraft.linkedPaymentMethods ?? []).includes(pm) ? 'pm-chip-active' : ''
              ]"
              :disabled="takenByOther(pm, null)"
              :title="takenByOther(pm, null) ? `'${ownerOf(pm)?.name}' 카드에 연결됨` : ''"
              @click="toggleNewLink(pm)"
            >{{ pm }}</button>
          </div>
        </div>

        <div class="mt-2 flex justify-end gap-2">
          <button type="button" class="btn-mini" @click="adding = false; resetAddDraft()">취소</button>
          <button type="button" class="btn-mini-primary" @click="onAddCard">추가</button>
        </div>
      </div>

      <!-- 카드 그리드 -->
      <div v-if="state.cards.length === 0" class="py-10 text-center text-slate-400 text-sm">
        등록된 카드가 없습니다.
      </div>
      <!--
        카드 그리드: 모바일 1, 태블릿 2, 데스크톱 3, FHD 4, QHD 5
        화면이 넓을수록 한 번에 더 많은 카드를 비교할 수 있게 한다
       -->
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 gap-4">
        <article
          v-for="d in sortedDetails"
          :key="d.card.id"
          :class="['card-visual relative rounded-2xl shadow-md text-white p-4 overflow-hidden cursor-pointer transition-all',
            selected && selected.card.id === d.card.id ? 'ring-4 ring-offset-2 ring-brand-500 -translate-y-0.5 shadow-xl' : 'hover:-translate-y-0.5 hover:shadow-lg']"
          @click="editingCardId !== d.card.id && (selectedId = d.card.id)"
          :style="{ background: `linear-gradient(135deg, ${d.card.color} 0%, ${lightenColor(d.card.color, 40)} 100%)` }"
        >
          <!-- 편집 모드 -->
          <div v-if="editingCardId === d.card.id" class="space-y-2 text-slate-900">
            <input v-model="editCardDraft.name" type="text" class="form-input-sm w-full" placeholder="카드 이름" />
            <input v-model="editCardDraft.issuer" type="text" class="form-input-sm w-full" placeholder="카드사" />
            <input v-model="editCardDraft.number" type="text" class="form-input-sm w-full" placeholder="카드번호" />
            <div class="relative">
              <input v-model.number="editCardDraft.monthlySpending" type="number" class="form-input-sm w-full pr-8 text-right tabular-nums" />
              <span class="suffix">원</span>
            </div>
            <div class="flex items-center gap-1 flex-wrap">
              <span class="text-xs text-slate-500 mr-1">색상:</span>
              <button
                v-for="c in COLOR_PRESETS"
                :key="c"
                type="button"
                :class="['w-5 h-5 rounded-full border-2', editCardDraft.color === c ? 'border-slate-900' : 'border-white']"
                :style="{ background: c }"
                @click="editCardDraft.color = c"
              ></button>
            </div>
            <div v-if="availablePaymentMethods.length > 0" class="pt-1">
              <div class="text-[11px] text-slate-500 mb-1">결제수단 연결</div>
              <div class="flex flex-wrap gap-1">
                <button
                  v-for="pm in availablePaymentMethods"
                  :key="pm"
                  type="button"
                  :class="[
                    'pm-chip pm-chip-sm',
                    (editCardDraft.linkedPaymentMethods ?? []).includes(pm) ? 'pm-chip-active' : ''
                  ]"
                  :disabled="takenByOther(pm, editingCardId)"
                  :title="takenByOther(pm, editingCardId) ? `'${ownerOf(pm)?.name}' 카드에 연결됨` : ''"
                  @click="toggleEditLink(pm)"
                >{{ pm }}</button>
              </div>
            </div>
            <div class="flex justify-end gap-1.5">
              <button type="button" class="btn-mini" @click="cancelEditCard">취소</button>
              <button type="button" class="btn-mini-primary" @click="commitEditCard">저장</button>
            </div>
          </div>

          <!-- 보기 모드 -->
          <template v-else>
            <div class="flex items-start justify-between mb-2">
              <div>
                <div class="text-xs opacity-80">{{ d.card.issuer }}</div>
                <div class="text-base font-bold mt-0.5">{{ d.card.name }}</div>
              </div>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-sm">{{ d.card.type }}</span>
            </div>

            <div v-if="d.linked" class="mt-2 flex flex-wrap gap-1">
              <span v-for="pm in d.card.linkedPaymentMethods" :key="pm" class="text-[10px] px-1.5 py-0.5 rounded bg-black/20" :class="brokenLinksOf(d.card).includes(pm) ? 'line-through opacity-70' : ''">{{ pm }}</span>
            </div>

            <div class="mt-3 pt-3 border-t border-white/30">
              <div class="text-[11px] opacity-80 flex items-center justify-between">
                <span>{{ periodLabel }} 사용금액</span>
                <span v-if="!d.linked" class="text-[10px] opacity-90 bg-white/20 rounded-full px-1.5 py-0.5">수동</span>
              </div>
              <div class="text-lg font-bold tabular-nums">{{ fmtKRW(d.spending) }}원</div>
            </div>

            <!-- 다음 혜택 진행률 -->
            <div v-if="d.nextTier" class="mt-3 text-xs">
              <div class="flex justify-between mb-1 opacity-90">
                <span>다음: {{ d.nextTier.benefit }}</span>
                <span class="tabular-nums">{{ fmtKRW(d.remainingToNext) }}원 남음</span>
              </div>
              <div class="h-1.5 rounded-full bg-white/30 overflow-hidden">
                <div class="h-full bg-white transition-all" :style="{ width: (d.progressToNext * 100) + '%' }"></div>
              </div>
            </div>
            <div v-else class="mt-3 text-xs flex items-center gap-1.5 bg-white/15 rounded-lg px-2 py-1.5">
              <span>✓</span>
              <span>모든 단계 달성</span>
            </div>

            <!-- 우상단 액션 -->
            <div class="absolute top-2 right-2 flex gap-1">
              <button type="button" class="card-action" title="편집" @click.stop="startEditCard(d.card)">✎</button>
              <button type="button" class="card-action" title="삭제" @click.stop="onRemoveCard(d.card.id)">×</button>
            </div>
          </template>
        </article>
      </div>
    </section>

    <!-- 사용내역 (대시보드 거래 동기화) -->
    <section v-if="selected && usage" class="card">
      <div class="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div class="flex items-center gap-3">
          <span class="w-10 h-6 rounded-md shadow-sm" :style="{ background: `linear-gradient(135deg, ${selected.card.color}, ${lightenColor(selected.card.color, 40)})` }"></span>
          <div>
            <h3 class="font-semibold text-slate-900">{{ selected.card.name }} 사용내역</h3>
            <p class="text-[11px] text-slate-500 mt-0.5">
              {{ periodLabel }} ·
              <template v-if="selected.linked">대시보드 거래 {{ usage.rows.length }}건 동기화 (실적 반영 {{ usage.countedCount }}건)</template>
              <template v-else>결제수단이 연결되지 않아 수동 입력값을 사용 중입니다</template>
            </p>
          </div>
        </div>
        <div v-if="selected.linked" class="flex items-center gap-2 text-xs flex-wrap">
          <input v-model="usageSearch" type="text" placeholder="가맹점·카테고리 검색" class="form-input-sm w-44" />
          <label class="inline-flex items-center gap-1 text-slate-600 cursor-pointer select-none">
            <input v-model="showExcluded" type="checkbox" class="rounded border-slate-300" /> 제외 항목 표시
          </label>
        </div>
      </div>

      <!-- 연결 깨짐 / 추천 -->
      <div v-if="brokenLinksOf(selected.card).length > 0" class="mb-3 rounded-md bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
        대시보드에서 사라진 결제수단: <b>{{ brokenLinksOf(selected.card).join(', ') }}</b> — 이름이 바뀌었다면 카드 편집에서 다시 연결하세요.
      </div>
      <div v-if="suggestLinksFor(selected.card).length > 0" class="mb-3 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-800 flex items-center gap-2 flex-wrap">
        <span>연결 추천:</span>
        <button v-for="pm in suggestLinksFor(selected.card)" :key="pm" type="button" class="pm-chip" @click="onLinkSuggested(selected.card.id, pm)">+ {{ pm }}</button>
      </div>

      <div v-if="!selected.linked" class="py-10 text-center text-sm text-slate-400">
        카드 우측 상단 ✎ 로 편집해 <b class="text-slate-600">대시보드 결제수단</b>을 연결하면 거래가 자동으로 이 카드의 사용내역이 됩니다.
      </div>

      <template v-else>
        <!-- 요약 타일 -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <div class="rounded-lg bg-slate-50 px-3 py-2.5">
            <div class="text-[11px] text-slate-500">실적 반영 금액</div>
            <div class="text-lg font-bold text-rose-600 tabular-nums">{{ fmtKRW(usage.countedTotal) }}원</div>
          </div>
          <div class="rounded-lg bg-slate-50 px-3 py-2.5">
            <div class="text-[11px] text-slate-500">반영 건수</div>
            <div class="text-lg font-bold text-slate-900 tabular-nums">{{ usage.countedCount }}건</div>
          </div>
          <div class="rounded-lg bg-slate-50 px-3 py-2.5">
            <div class="text-[11px] text-slate-500">제외된 거래</div>
            <div class="text-lg font-bold text-slate-500 tabular-nums">{{ usage.excludedCount }}건 <span class="text-xs font-medium">({{ fmtKRW(usage.excludedTotal) }}원)</span></div>
          </div>
          <div class="rounded-lg bg-slate-50 px-3 py-2.5">
            <div class="text-[11px] text-slate-500">마지막 사용일</div>
            <div class="text-lg font-bold text-slate-900 tabular-nums">{{ usage.lastUsedAt ? fmtDate(usage.lastUsedAt) : '-' }}</div>
          </div>
        </div>

        <!-- 월별 추이 + 카테고리 -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-5">
          <div>
            <div class="text-xs font-semibold text-slate-700 mb-2">최근 6개월 사용금액</div>
            <div class="flex items-end gap-2 h-28">
              <div v-for="m in usage.byMonth" :key="m.ym" class="flex-1 flex flex-col items-center justify-end h-full gap-1">
                <span class="text-[10px] text-slate-500 tabular-nums">{{ m.amount ? fmtMan(m.amount) : '' }}</span>
                <div class="w-full rounded-t" :style="{ height: Math.max(m.amount ? 4 : 1, (m.amount / maxMonth) * 80) + '%', background: m.amount ? selected.card.color : '#e2e8f0' }"></div>
                <span class="text-[10px] text-slate-400">{{ m.ym.slice(5) }}월</span>
              </div>
            </div>
          </div>
          <div>
            <div class="text-xs font-semibold text-slate-700 mb-2">카테고리별 비중 <span class="text-slate-400 font-normal">· {{ periodLabel }}</span></div>
            <ul v-if="usage.byCategory.length" class="space-y-1.5">
              <li v-for="c in usage.byCategory.slice(0, 5)" :key="c.name" class="flex items-center gap-2 text-xs">
                <span class="w-20 truncate text-slate-600">{{ c.name }}</span>
                <div class="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden"><div class="h-full" :style="{ width: (c.ratio * 100) + '%', background: selected.card.color }"></div></div>
                <span class="w-24 text-right tabular-nums text-slate-700">{{ fmtKRW(c.amount) }}원</span>
                <span class="w-9 text-right tabular-nums text-slate-400">{{ pctText(c.ratio) }}</span>
              </li>
            </ul>
            <p v-else class="text-xs text-slate-400 py-4">이 기간에 반영된 거래가 없습니다.</p>
          </div>
        </div>

        <!-- 거래 테이블 -->
        <div class="overflow-x-auto -mx-1">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-left text-slate-500 border-b border-slate-200">
                <th class="py-2 px-1 w-24 font-medium"><button type="button" class="sort-th" @click="toggleUsageSort('date')">일자 <span :class="usageSort.startsWith('date') ? 'text-brand-600' : 'text-slate-300'">{{ sortMark('date') }}</span></button></th>
                <th class="py-2 px-1 font-medium">내용</th>
                <th class="py-2 px-1 w-28 font-medium">카테고리</th>
                <th class="py-2 px-1 w-28 font-medium hidden md:table-cell">결제수단</th>
                <th class="py-2 px-1 w-28 text-right font-medium"><button type="button" class="sort-th" @click="toggleUsageSort('amount')">금액 <span :class="usageSort.startsWith('amount') ? 'text-brand-600' : 'text-slate-300'">{{ sortMark('amount') }}</span></button></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in usageRows.slice(0, usageLimit)" :key="r.tx.id" :class="['border-b border-slate-100', r.counted ? '' : 'text-slate-400 bg-slate-50/60']">
                <td class="py-1.5 px-1 tabular-nums whitespace-nowrap">{{ fmtDate(r.tx.date) }}</td>
                <td class="py-1.5 px-1 truncate max-w-[260px]">
                  {{ r.tx.description }}
                  <span v-if="!r.counted" class="ml-1 px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px]">{{ r.reason }}</span>
                </td>
                <td class="py-1.5 px-1 truncate">{{ r.tx.category }}</td>
                <td class="py-1.5 px-1 truncate hidden md:table-cell">{{ r.tx.paymentMethod }}</td>
                <td :class="['py-1.5 px-1 text-right tabular-nums font-medium', r.counted ? 'text-slate-900' : 'line-through']">{{ fmtKRW(r.tx.amount) }}원</td>
              </tr>
              <tr v-if="usageRows.length === 0">
                <td colspan="5" class="py-8 text-center text-slate-400">표시할 거래가 없습니다.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="usageRows.length > usageLimit" class="mt-3 text-center">
          <button type="button" class="btn-mini" @click="usageLimit += PAGE">더 보기 ({{ usageRows.length - usageLimit }}건 남음)</button>
        </div>
      </template>
    </section>

    <!-- 카드별 사용금액 차트 -->
    <section v-if="state.cards.length > 0" class="card">
      <div class="flex items-center justify-between mb-2">
        <h3 class="font-semibold text-slate-900">카드별 사용금액</h3>
        <span class="text-[11px] text-slate-400">단위: 만원</span>
      </div>
      <div :style="{ height: Math.max(180, state.cards.length * 38) + 'px' }">
        <Bar :data="spendingChartData" :options="spendingChartOptions" :plugins="[valueLabelsPlugin]" />
      </div>
    </section>

    <!-- 혜택 단계·달성률 -->
    <section v-if="state.cards.length > 0" class="card">
      <h3 class="font-semibold text-slate-900 mb-3">혜택 달성 현황</h3>
      <p class="text-xs text-slate-500 mb-4">각 카드의 금액별 혜택 단계와 현재 사용금액 기준 달성 여부입니다.</p>

      <div class="space-y-5">
        <div v-for="d in sortedDetails" :key="d.card.id" class="border-b border-slate-100 pb-5 last:border-b-0 last:pb-0">
          <header class="flex items-center justify-between mb-3 flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <span class="inline-block w-3 h-3 rounded-sm" :style="{ background: d.card.color }"></span>
              <span class="font-semibold text-slate-900">{{ d.card.name }}</span>
              <span class="text-[11px] text-slate-500">· {{ d.card.issuer }}</span>
            </div>
            <div class="text-xs text-slate-600 flex items-center gap-3">
              <span>사용 <b class="text-slate-900 tabular-nums">{{ fmtKRW(d.spending) }}원</b></span>
              <span class="text-slate-300">|</span>
              <span>달성 <b class="text-emerald-600 tabular-nums">{{ d.achievements.filter(a => a.achieved).length }}/{{ d.achievements.length }}</b></span>
            </div>
          </header>

          <!-- 단계 막대 -->
          <ul v-if="d.achievements.length > 0" class="space-y-2">
            <li
              v-for="(a, idx) in d.achievements"
              :key="idx"
              class="grid grid-cols-12 gap-3 items-center text-sm"
            >
              <!-- 인라인 편집 -->
              <template v-if="editingBenefit && editingBenefit.cardId === d.card.id && editingBenefit.idx === idx">
                <div class="col-span-12 grid grid-cols-1 md:grid-cols-12 gap-2 items-center">
                  <div class="md:col-span-3 relative">
                    <input v-model.number="editBenefitDraft.threshold" type="number" class="form-input-sm w-full pr-8 text-right tabular-nums" />
                    <span class="suffix">원</span>
                  </div>
                  <input v-model="editBenefitDraft.benefit" type="text" placeholder="혜택" class="md:col-span-5 form-input-sm" />
                  <div class="md:col-span-2 relative">
                    <input v-model.number="editBenefitDraft.benefitValue" type="number" placeholder="가치" class="form-input-sm w-full pr-8 text-right tabular-nums" />
                    <span class="suffix">원</span>
                  </div>
                  <div class="md:col-span-2 flex justify-end gap-1">
                    <button type="button" class="btn-mini-primary" @click="commitEditBenefit">저장</button>
                    <button type="button" class="btn-mini" @click="cancelEditBenefit">취소</button>
                  </div>
                </div>
              </template>
              <template v-else>
                <!-- 조건 금액 -->
                <div class="col-span-2 text-xs tabular-nums whitespace-nowrap" :class="a.achieved ? 'text-emerald-700 font-semibold' : 'text-slate-500'">
                  {{ fmtMan(a.tier.threshold) }}
                </div>
                <!-- 진행률 + 혜택 -->
                <div class="col-span-7">
                  <div class="flex items-center gap-2 mb-0.5">
                    <span class="text-xs flex-1" :class="a.achieved ? 'text-slate-700' : 'text-slate-500'">{{ a.tier.benefit }}</span>
                    <span v-if="a.tier.benefitValue" class="text-[11px] text-amber-600 tabular-nums">≈ {{ fmtKRW(a.tier.benefitValue) }}원</span>
                  </div>
                  <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      :class="['h-full transition-all', a.achieved ? 'bg-emerald-500' : 'bg-slate-300']"
                      :style="{ width: Math.min(100, (d.spending / Math.max(1, a.tier.threshold)) * 100) + '%' }"
                    ></div>
                  </div>
                </div>
                <!-- 상태 배지 -->
                <div class="col-span-1 text-center">
                  <span :class="['benefit-badge', a.achieved ? 'b-ok' : 'b-pending']">
                    {{ a.achieved ? '✓ 달성' : '진행' }}
                  </span>
                </div>
                <!-- 액션 -->
                <div class="col-span-2 flex justify-end gap-1">
                  <button type="button" class="btn-mini" @click="startEditBenefit(d.card.id, idx, a.tier)">편집</button>
                  <button type="button" class="btn-mini-danger" @click="onRemoveBenefit(d.card.id, idx)">삭제</button>
                </div>
              </template>
            </li>
          </ul>
          <p v-else class="text-xs text-slate-400 text-center py-2">등록된 혜택이 없습니다.</p>

          <!-- 혜택 추가 폼 -->
          <div class="mt-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-center bg-slate-50/60 rounded-lg p-2">
            <div class="md:col-span-3 relative">
              <input
                v-model.number="getBenefitDraft(d.card.id).threshold"
                type="number" placeholder="조건 금액"
                class="form-input-sm w-full pr-8 text-right tabular-nums"
              />
              <span class="suffix">원</span>
            </div>
            <input
              v-model="getBenefitDraft(d.card.id).benefit"
              type="text" placeholder="혜택 내용 (예: 카페 10% 할인)"
              class="md:col-span-5 form-input-sm"
              @keydown.enter="onAddBenefit(d.card.id)"
            />
            <div class="md:col-span-2 relative">
              <input
                v-model.number="getBenefitDraft(d.card.id).benefitValue"
                type="number" placeholder="가치(선택)"
                class="form-input-sm w-full pr-8 text-right tabular-nums"
                @keydown.enter="onAddBenefit(d.card.id)"
              />
              <span class="suffix">원</span>
            </div>
            <div class="md:col-span-2 flex justify-end">
              <button type="button" class="btn-mini-primary" @click="onAddBenefit(d.card.id)">+ 혜택 추가</button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 안내 -->
    <p class="text-xs text-slate-500 flex items-start gap-1.5 px-1">
      <svg class="mt-0.5 flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      혜택 가치는 사용자가 입력한 추정치입니다. 카드사 약관에 따라 실제 혜택은 다를 수 있습니다.
    </p>
  </div>
</template>

<style scoped>
.form-input-sm {
  @apply rounded-md border-slate-300 text-xs py-1.5 focus:border-brand-500 focus:ring-brand-500;
}
.suffix {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: rgb(148 163 184);
  pointer-events: none;
}
.btn-primary {
  @apply px-4 py-2 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50;
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
.card-visual {
  min-height: 200px;
}
.card-chip {
  width: 30px;
  height: 22px;
  border-radius: 5px;
  background: linear-gradient(135deg, #f5deb3 0%, #d4af37 100%);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15);
}
.sort-th { font-weight: 500; cursor: pointer; user-select: none; }
.sort-th:hover { color: rgb(15 23 42); }
.pm-chip:disabled { opacity: 0.4; cursor: not-allowed; }
.card-action {
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: rgba(255,255,255,0.18);
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  border: none;
  display: inline-grid;
  place-items: center;
}
.card-action:hover { background: rgba(255,255,255,0.28); }
.benefit-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 9999px;
  font-size: 10.5px;
  font-weight: 500;
}
.pm-chip {
  display: inline-block;
  padding: 3px 9px;
  border: 1px solid rgb(226 232 240);
  border-radius: 9999px;
  background: #fff;
  color: rgb(71 85 105);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s ease;
}
.pm-chip:hover {
  background: rgb(248 250 252);
  border-color: rgb(148 163 184);
  color: rgb(15 23 42);
}
.pm-chip-active,
.pm-chip-active:hover {
  background: rgb(37 99 235);
  border-color: rgb(37 99 235);
  color: #fff;
}
.pm-chip-sm {
  padding: 2px 7px;
  font-size: 10.5px;
}
.b-ok { background: rgb(220 252 231); color: rgb(21 128 61); }
.b-pending { background: rgb(241 245 249); color: rgb(71 85 105); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
