<script setup lang="ts">
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

// ── 포맷터 ──
function fmtKRW(n: number): string {
  return Number.isFinite(n) ? Number(Math.round(n)).toLocaleString('ko-KR') : '0'
}
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
    <transition name="fade">
      <div
        v-if="toast"
        :class="[
          'fixed top-6 right-6 z-50 px-4 py-2 rounded-lg shadow text-sm whitespace-pre-line max-w-sm leading-relaxed',
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
        <div class="text-xs font-semibold text-rose-600 mb-1">이번 달 사용금액</div>
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
        <div class="flex gap-2">
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
          v-for="d in cardDetails"
          :key="d.card.id"
          class="card-visual relative rounded-2xl shadow-md text-white p-4 overflow-hidden"
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
            <div class="text-xs opacity-90 tabular-nums tracking-wider mt-3">{{ d.card.number || '**** **** **** ****' }}</div>

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
              <button type="button" class="card-action" title="편집" @click="startEditCard(d.card)">✎</button>
              <button type="button" class="card-action" title="삭제" @click="onRemoveCard(d.card.id)">×</button>
            </div>
          </template>
        </article>
      </div>
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
        <div v-for="d in cardDetails" :key="d.card.id" class="border-b border-slate-100 pb-5 last:border-b-0 last:pb-0">
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
