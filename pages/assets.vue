<script setup lang="ts">
import { formatGrouped as fmtKRW } from '~/utils/format'
// 자산 현황 페이지: 총 자산 히어로(총액·도넛·카테고리 타일), 상세 내역(비중 바 + 인라인 편집), 변동 추이, 비고.
import { computed, ref, nextTick } from 'vue'
import { Doughnut, Line } from 'vue-chartjs'
import { useAssets } from '~/composables/useAssets'
import { useSavings } from '~/composables/useSavings'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '자산 현황 · 가계부' })

const {
  state,
  total,
  breakdown,
  setEntry,
  setBaseDate,
  snapshotCurrent,
  removeTrendPoint,
  addRemark,
  updateRemark,
  removeRemark
} = useAssets()

// ── 예금/적금 동기화 ──
// '현금 및 예금' = 등록된 예금/적금 상품의 누적 납입액 합계(활성 멤버 기준, 이자 제외 원금).
// 자동 반영하지 않고 버튼으로만 덮어쓴다 — 직접 입력한 현금 값을 의도치 않게 잃지 않도록.
const { productSummaries } = useSavings()
const savingsTotal = computed(() => productSummaries.value.reduce((s, p) => s + p.paid, 0))
const cashAmount = computed(() => state.value.entries.cash?.amount ?? 0)
const savingsDiff = computed(() => savingsTotal.value - cashAmount.value)
const showSavingsList = ref(false)

function syncSavings() {
  const n = productSummaries.value.length
  const d = new Date()
  setEntry('cash', savingsTotal.value, `예금/적금 ${n}건 · ${d.getMonth() + 1}/${d.getDate()} 동기화`)
  notify('ok', withBackupHint('예금/적금 합계를 현금 및 예금에 반영했습니다'))
}

// 인라인 편집 input 마운트 시 포커스 + 전체 선택
const vFocus = {
  mounted: (el: HTMLInputElement) => {
    el.focus()
    el.select?.()
  }
}

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 카테고리 인라인 편집 (Enter 저장 / Esc 취소) ──
const editingKey = ref<string | null>(null)
const editAmountText = ref<string>('')
const editNote = ref<string>('')

// 숫자 외 문자는 입력 즉시 제거 → 음수/소수 입력 자체가 불가능
const editAmountNum = computed(() => Number(editAmountText.value || 0))

function onAmountInput(e: Event) {
  const el = e.target as HTMLInputElement
  const digits = el.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  editAmountText.value = digits
  el.value = digits
}
function startEditEntry(key: string) {
  const entry = state.value.entries[key] ?? { amount: 0, note: '' }
  editingKey.value = key
  editAmountText.value = String(entry.amount)
  editNote.value = entry.note
}
function commitEditEntry() {
  if (!editingKey.value) return
  if (editAmountText.value === '') { notify('err', '금액을 입력하세요'); return }
  setEntry(editingKey.value, editAmountNum.value, editNote.value)
  editingKey.value = null
  notify('ok', withBackupHint('저장되었습니다'))
}
function cancelEditEntry() {
  editingKey.value = null
}

// ── 비고 편집 ──
const newRemark = ref<string>('')
const remarkInput = ref<HTMLInputElement | null>(null)
const editingRemarkIdx = ref<number | null>(null)
const editingRemarkText = ref<string>('')

function onAddRemark() {
  if (addRemark(newRemark.value)) {
    newRemark.value = ''
    notify('ok', withBackupHint('비고가 추가되었습니다'))
  } else {
    notify('err', '내용을 입력하세요')
  }
}
function focusRemarkInput() {
  nextTick(() => remarkInput.value?.focus())
}
function startEditRemark(idx: number) {
  editingRemarkIdx.value = idx
  editingRemarkText.value = state.value.remarks[idx] ?? ''
}
function commitEditRemark() {
  if (editingRemarkIdx.value === null) return
  updateRemark(editingRemarkIdx.value, editingRemarkText.value)
  editingRemarkIdx.value = null
}
function cancelEditRemark() { editingRemarkIdx.value = null }

// ── 스냅샷 추가 ──
function onSnapshot() {
  snapshotCurrent()
  notify('ok', withBackupHint('현재 상태를 변동 추이에 기록했습니다'))
}

// ── 포맷터 ──
function fmtBigKRW(n: number): string {
  // 1,842,500,000원 → "18억 4,250만원"
  if (!Number.isFinite(n) || n === 0) return '0원'
  const eok = Math.floor(n / 100_000_000)
  const man = Math.floor((n % 100_000_000) / 10_000)
  const parts: string[] = []
  if (eok > 0) parts.push(`${eok}억`)
  if (man > 0) parts.push(`${man.toLocaleString('ko-KR')}만`)
  if (parts.length === 0) parts.push(fmtKRW(n))
  return parts.join(' ') + '원'
}
function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}

// ── 도넛 ──
// 총액 0이면 Chart.js가 아무것도 그리지 않으므로 빈 트랙 한 조각을 대신 그린다.
const donutData = computed(() => {
  const empty = total.value <= 0
  return {
    labels: empty ? ['자산 없음'] : breakdown.value.map((b) => b.label),
    datasets: [
      {
        data: empty ? [1] : breakdown.value.map((b) => b.amount),
        backgroundColor: empty ? ['#edf0f6'] : breakdown.value.map((b) => b.color),
        borderColor: '#ffffff',
        borderWidth: empty ? 0 : 3,
        hoverOffset: 4
      }
    ]
  }
})

const donutOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  cutout: '72%',
  plugins: {
    legend: { display: false },
    tooltip: {
      enabled: total.value > 0,
      backgroundColor: '#101826',
      padding: 10,
      cornerRadius: 10,
      callbacks: {
        label: (ctx: any) => {
          const pct = total.value > 0 ? (ctx.parsed / total.value) * 100 : 0
          return `${ctx.label}: ${fmtKRW(ctx.parsed)}원 (${pct.toFixed(1)}%)`
        }
      }
    }
  }
}))

const activeCategoryCount = computed(() => breakdown.value.filter((b) => b.amount > 0).length)

// ── 변동 추이 차트 (Line) ──
// 단위: 만원으로 표시 (data를 /10000 변환)
const trendSorted = computed(() =>
  state.value.trend.slice().sort((a, b) => a.ym.localeCompare(b.ym))
)

// 직전 스냅샷 대비 증감 (스냅샷 2개 이상일 때만)
const trendDelta = computed(() => {
  const t = trendSorted.value
  if (t.length < 2) return null
  const cur = t[t.length - 1]
  const prev = t[t.length - 2]
  const diff = cur.total - prev.total
  const pct = prev.total > 0 ? (diff / prev.total) * 100 : null
  return { diff, pct, prevYm: prev.ym }
})

const BRAND = '#1a5eeb'

const trendData = computed(() => ({
  labels: trendSorted.value.map((p) => p.ym),
  datasets: [
    {
      label: '총 자산 (만원)',
      data: trendSorted.value.map((p) => Math.round(p.total / 10000)),
      borderColor: BRAND,
      borderWidth: 2.5,
      // 영역 그라디언트: chartArea가 잡힌 뒤에만 생성
      backgroundColor: (ctx: any) => {
        const { chart } = ctx
        const area = chart.chartArea
        if (!area) return 'rgba(26,94,235,0.08)'
        const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom)
        g.addColorStop(0, 'rgba(26,94,235,0.22)')
        g.addColorStop(1, 'rgba(26,94,235,0)')
        return g
      },
      pointBackgroundColor: '#ffffff',
      pointBorderColor: BRAND,
      pointBorderWidth: 2.5,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0.25,
      fill: true
    }
  ]
}))

// 캔버스에 직접 값 라벨을 그리는 인라인 플러그인
const valueLabelsPlugin = {
  id: 'valueLabels',
  afterDatasetsDraw(chart: any) {
    const { ctx } = chart
    chart.data.datasets.forEach((dataset: any, di: number) => {
      const meta = chart.getDatasetMeta(di)
      meta.data.forEach((point: any, i: number) => {
        const v = dataset.data[i]
        if (v == null) return
        ctx.save()
        ctx.fillStyle = '#475569'
        ctx.font = '600 11px Pretendard, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(Number(v).toLocaleString('ko-KR'), point.x, point.y - 12)
        ctx.restore()
      })
    })
  }
}

const trendOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index' as const, intersect: false },
  layout: { padding: { top: 18, right: 8 } },
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#101826',
      padding: 10,
      cornerRadius: 10,
      displayColors: false,
      callbacks: {
        label: (ctx: any) => fmtBigKRW(Number(ctx.parsed.y) * 10000)
      }
    }
  },
  scales: {
    y: {
      beginAtZero: false,
      border: { display: false },
      ticks: { color: '#566074', callback: (v: any) => Number(v).toLocaleString('ko-KR') },
      grid: { color: '#e3e8f0', borderDash: [3, 4] }
    },
    x: { border: { display: false }, ticks: { color: '#566074' }, grid: { display: false } }
  }
}
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 페이지 헤더 -->
    <div>
      <div class="text-[13px] text-slate-500">자산</div>
      <h2 class="text-[26px] font-extrabold text-slate-900 leading-tight">자산 현황</h2>
      <p class="text-slate-500 mt-0.5">카테고리별 자산을 한눈에 보고, 금액을 바로 수정할 수 있습니다.</p>
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

    <!-- 히어로: 총 자산 + 기준일/스냅샷 + 도넛 + 카테고리 타일 -->
    <section class="card">
      <div class="flex flex-col-reverse md:flex-row md:items-center md:justify-between gap-6 md:gap-8">
        <div class="flex-1 min-w-0">
          <div class="text-[13px] font-bold text-slate-500">총 자산</div>
          <div class="mt-1 text-4xl sm:text-5xl font-extrabold tracking-tight text-slate-900 tabular-nums break-all leading-[1.15]">
            {{ fmtKRW(total) }}<span class="text-2xl font-bold tracking-normal ml-1 text-slate-500">원</span>
          </div>
          <span class="inline-block mt-2 px-3 py-0.5 rounded-full bg-brand-50 text-brand-800 font-bold text-sm">{{ fmtBigKRW(total) }}</span>

          <div class="flex flex-wrap items-end gap-3 mt-6">
            <div class="flex flex-col gap-1.5 w-48">
              <label for="asset-base-date" class="text-[13px] font-bold text-slate-500">기준일</label>
              <input
                id="asset-base-date"
                type="date"
                :value="state.baseDate"
                class="inp"
                @change="setBaseDate(($event.target as HTMLInputElement).value)"
              />
            </div>
            <button type="button" class="btn-dark" title="현재 합계를 기준일의 월 변동 추이로 저장" @click="onSnapshot">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
              이번 달 스냅샷
            </button>
          </div>
        </div>

        <div class="relative w-56 h-56 md:w-60 md:h-60 flex-shrink-0 mx-auto">
          <Doughnut :data="donutData" :options="donutOptions" />
          <div class="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            <div class="text-[13px] font-bold text-slate-500">자산 구성</div>
            <div class="text-[22px] font-extrabold text-slate-900">{{ activeCategoryCount }}개</div>
            <div class="text-[13px] text-slate-500">카테고리</div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-7">
        <div
          v-for="b in breakdown"
          :key="b.key"
          class="relative overflow-hidden rounded-[14px] border border-slate-200 pl-5 pr-4 py-3.5"
        >
          <span class="absolute left-0 inset-y-0 w-[5px]" :style="{ background: b.color }"></span>
          <div class="text-[13px] font-bold text-slate-500 truncate">{{ b.label }}</div>
          <div class="mt-0.5 text-[19px] font-extrabold tracking-tight tabular-nums whitespace-nowrap">{{ fmtKRW(b.amount) }}원</div>
          <span class="inline-block mt-1.5 px-2 py-px rounded-full bg-slate-100 text-slate-500 text-[12.5px] font-bold tabular-nums">{{ fmtPct(b.share) }}</span>
        </div>
      </div>
    </section>

    <!-- 자산 상세 내역 -->
    <section class="card">
      <div class="mb-4">
        <h3 class="text-[17px] font-bold text-slate-900">자산 상세 내역</h3>
        <p class="text-[13.5px] text-slate-500">행을 클릭하거나 ‘수정’을 누르면 금액과 비고를 바로 고칠 수 있습니다.</p>
      </div>
      <!-- 예금/적금 동기화 -->
      <div class="mb-4 rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="flex-1 min-w-[240px]">
            <div class="text-[13px] font-bold text-brand-800">예금/적금 연동</div>
            <div class="text-sm text-slate-700 tabular-nums">
              {{ productSummaries.length }}건 누적 납입 <b>{{ fmtKRW(savingsTotal) }}원</b>
              <span class="text-slate-500"> · 현금 및 예금 {{ fmtKRW(cashAmount) }}원</span>
            </div>
            <div v-if="savingsDiff !== 0" class="text-xs tabular-nums" :class="savingsDiff > 0 ? 'text-rose-600' : 'text-blue-600'">
              동기화 시 {{ savingsDiff > 0 ? '+' : '-' }}{{ fmtKRW(Math.abs(savingsDiff)) }}원 변경
            </div>
            <div v-else class="text-xs text-emerald-600">예금/적금과 일치합니다.</div>
          </div>
          <button type="button" class="btn-line" @click="showSavingsList = !showSavingsList">{{ showSavingsList ? '내역 접기' : '내역 보기' }}</button>
          <button type="button" class="btn-pri" :disabled="savingsDiff === 0" @click="syncSavings">예금/적금으로 동기화</button>
        </div>
        <ul v-if="showSavingsList" class="mt-3 pt-2 border-t border-brand-200/70 divide-y divide-brand-100 text-sm">
          <li v-for="sp in productSummaries" :key="sp.id" class="flex justify-between gap-3 py-1.5">
            <span class="truncate">{{ sp.label }}</span>
            <span class="tabular-nums font-bold">{{ fmtKRW(sp.paid) }}원</span>
          </li>
        </ul>
        <div class="text-xs text-slate-500 mt-2">납입 원금 기준이며 이자는 포함하지 않습니다. 동기화하면 ‘현금 및 예금’ 금액이 덮어쓰기됩니다.</div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] border-collapse">
          <thead>
            <tr class="text-[13px] text-slate-500 border-b border-slate-200">
              <th class="py-2.5 px-3 text-left font-bold">카테고리</th>
              <th class="py-2.5 px-3 text-right font-bold">금액</th>
              <th class="py-2.5 px-3 text-right font-bold">비중</th>
              <th class="py-2.5 px-3 w-44"></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="b in breakdown" :key="b.key">
              <!-- 보기 -->
              <tr
                v-if="editingKey !== b.key"
                class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer"
                @click="startEditEntry(b.key)"
              >
                <td class="py-2 px-3 h-16">
                  <div class="flex items-center">
                    <span class="inline-block w-3 h-3 rounded mr-2.5 flex-shrink-0" :style="{ background: b.color }"></span>
                    <div class="min-w-0">
                      <div class="font-bold">{{ b.label }}</div>
                      <div v-if="b.note" class="text-xs text-slate-500 truncate max-w-[220px]">{{ b.note }}</div>
                    </div>
                  </div>
                </td>
                <td class="py-2 px-3 text-right font-extrabold tabular-nums whitespace-nowrap">{{ fmtKRW(b.amount) }}원</td>
                <td class="py-2 px-3">
                  <div class="flex items-center justify-end gap-2.5">
                    <div class="flex-1 max-w-[200px] h-2 rounded-full bg-slate-100 overflow-hidden">
                      <i class="block h-full rounded-full" :style="{ width: b.share * 100 + '%', background: b.color }"></i>
                    </div>
                    <span class="w-[52px] text-right text-[13.5px] text-slate-500 tabular-nums">{{ fmtPct(b.share) }}</span>
                  </div>
                </td>
                <td class="py-2 px-3 text-right">
                  <button type="button" class="btn-line" @click.stop="startEditEntry(b.key)">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
                    수정
                  </button>
                </td>
              </tr>
              <!-- 편집 -->
              <tr v-else class="border-b border-slate-100 bg-brand-50/60 align-top">
                <td class="py-3 px-3">
                  <div class="flex items-center mb-2">
                    <span class="inline-block w-3 h-3 rounded mr-2.5 flex-shrink-0" :style="{ background: b.color }"></span>
                    <span class="font-bold">{{ b.label }}</span>
                  </div>
                  <input
                    v-model="editNote"
                    type="text"
                    maxlength="60"
                    placeholder="비고 (선택)"
                    :aria-label="b.label + ' 비고'"
                    class="inp !h-10 w-full max-w-[280px] text-sm"
                    @keydown.enter="commitEditEntry"
                    @keydown.esc="cancelEditEntry"
                  />
                </td>
                <td class="py-3 px-3 text-right">
                  <input
                    v-focus
                    :value="editAmountText"
                    type="text"
                    inputmode="numeric"
                    :aria-label="b.label + ' 금액'"
                    class="inp w-44 text-right font-bold tabular-nums !border-brand-600 ring-2 ring-brand-600"
                    @input="onAmountInput"
                    @keydown.enter="commitEditEntry"
                    @keydown.esc="cancelEditEntry"
                  />
                  <div class="text-xs text-brand-800 mt-1 tabular-nums">{{ fmtBigKRW(editAmountNum) }}</div>
                </td>
                <td class="py-3 px-3 text-right text-slate-400 tabular-nums">
                  {{ total - b.amount + editAmountNum > 0 ? fmtPct(editAmountNum / (total - b.amount + editAmountNum)) : '0.0%' }}
                </td>
                <td class="py-3 px-3">
                  <div class="flex gap-2 justify-end">
                    <button type="button" class="btn-pri" @click="commitEditEntry">저장</button>
                    <button type="button" class="btn-line" @click="cancelEditEntry">취소</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
          <tfoot>
            <tr class="bg-slate-100 font-extrabold">
              <td class="py-3 px-3 h-14 rounded-l-lg">합계</td>
              <td class="py-3 px-3 text-right tabular-nums">{{ fmtKRW(total) }}원</td>
              <td class="py-3 px-3 text-right tabular-nums">{{ total > 0 ? '100.0%' : '0.0%' }}</td>
              <td class="rounded-r-lg"></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div class="text-[13px] text-slate-400 mt-2.5">Enter로 저장, Esc로 취소합니다. 저장하면 총합·비중·도넛에 반영됩니다. (편집 중 비중은 미리보기)</div>
    </section>

    <!-- 변동 추이 -->
    <section class="card">
      <div class="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h3 class="text-[17px] font-bold text-slate-900">자산 변동 추이</h3>
          <p class="text-[13.5px] text-slate-500">월별 총 자산 (단위: 만원) · 점에 마우스를 올리면 값이 표시됩니다.</p>
        </div>
        <div
          v-if="trendDelta"
          :class="[
            'px-3 py-1 rounded-full text-sm font-bold tabular-nums',
            trendDelta.diff > 0 ? 'bg-rose-50 text-rose-600' : trendDelta.diff < 0 ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
          ]"
          :title="trendDelta.prevYm + ' 대비'"
        >
          직전 기록 대비 {{ trendDelta.diff > 0 ? '+' : trendDelta.diff < 0 ? '-' : '' }}{{ fmtBigKRW(Math.abs(trendDelta.diff)) }}<template v-if="trendDelta.pct !== null"> ({{ trendDelta.diff > 0 ? '+' : '' }}{{ trendDelta.pct.toFixed(1) }}%)</template>
        </div>
      </div>

      <div class="h-64">
        <Line v-if="trendSorted.length > 0" :data="trendData" :options="trendOptions" :plugins="[valueLabelsPlugin]" />
        <div v-else class="h-full grid place-items-center text-center text-slate-500">
          <div>
            <div class="empty-ic">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>
            </div>
            <p class="m-0 mb-3">기록된 스냅샷이 없습니다.</p>
            <button type="button" class="btn-line" @click="onSnapshot">이번 달 스냅샷 기록하기</button>
          </div>
        </div>
      </div>

      <div v-if="trendSorted.length > 0" class="flex flex-wrap items-center gap-2 mt-4">
        <span class="text-[13px] font-bold text-slate-500 mr-1">기록</span>
        <span
          v-for="p in trendSorted"
          :key="p.ym"
          class="inline-flex items-center gap-1 min-h-[36px] pl-3.5 pr-1 rounded-full bg-brand-50 text-brand-800 font-bold text-sm tabular-nums"
        >
          {{ p.ym }} · {{ Math.round(p.total / 10000).toLocaleString('ko-KR') }}만원
          <button
            type="button"
            class="w-8 h-8 grid place-items-center rounded-full text-slate-400 hover:text-rose-500 hover:bg-white/70"
            :aria-label="p.ym + ' 기록 삭제'"
            @click="removeTrendPoint(p.ym)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </span>
      </div>
    </section>

    <!-- 주요 비고 -->
    <section class="card">
      <div class="mb-4">
        <h3 class="text-[17px] font-bold text-slate-900">주요 자산 비고</h3>
        <p class="text-[13.5px] text-slate-500">전세 보증금, 만기 예정 등 기억해 둘 내용을 적어 두세요.</p>
      </div>
      <div class="flex gap-2.5">
        <input
          ref="remarkInput"
          v-model="newRemark"
          type="text"
          placeholder="예: 전세보증금 5,000만원 (2027.03 만기)"
          aria-label="비고 내용"
          class="inp flex-1 min-w-0"
          @keydown.enter="onAddRemark"
        />
        <button type="button" class="btn-pri" @click="onAddRemark">추가</button>
      </div>

      <ul v-if="state.remarks.length > 0" class="mt-3 divide-y divide-slate-100">
        <li v-for="(r, idx) in state.remarks" :key="idx" class="flex items-center gap-2 py-1.5 min-h-[52px]">
          <template v-if="editingRemarkIdx === idx">
            <input
              v-model="editingRemarkText"
              v-focus
              type="text"
              class="inp flex-1 min-w-0"
              aria-label="비고 수정"
              @keydown.enter="commitEditRemark"
              @keydown.esc="cancelEditRemark"
            />
            <button type="button" class="btn-pri" @click="commitEditRemark">저장</button>
            <button type="button" class="btn-line" @click="cancelEditRemark">취소</button>
          </template>
          <template v-else>
            <span class="flex-1 min-w-0 leading-relaxed break-words">{{ r }}</span>
            <button type="button" class="btn-line" @click="startEditRemark(idx)">수정</button>
            <button type="button" class="btn-line !text-rose-600 !border-rose-200 hover:!bg-rose-50" @click="removeRemark(idx)">삭제</button>
          </template>
        </li>
      </ul>
      <div v-else class="text-center text-slate-500 pt-7 pb-2">
        <div class="empty-ic">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l3 3v15H6z"/><path d="M9 11h6M9 15h4"/></svg>
        </div>
        <p class="m-0 mb-3">등록된 비고가 없습니다.</p>
        <button type="button" class="btn-line" @click="focusRemarkInput">첫 비고 입력하기</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.inp {
  @apply h-[46px] rounded-[10px] border border-slate-300 bg-white px-3 text-[15px] text-slate-900
    focus:border-brand-600 focus:ring-1 focus:ring-brand-600 focus:outline-none;
}
.btn-pri:disabled { @apply opacity-50 cursor-not-allowed hover:bg-brand-600; }
.btn-pri {
  @apply min-h-[44px] px-[18px] rounded-[10px] bg-brand-600 border border-brand-600 text-white font-bold text-[15px]
    inline-flex items-center justify-center gap-1.5 whitespace-nowrap hover:bg-brand-700;
}
.btn-dark {
  @apply min-h-[44px] px-[18px] rounded-[10px] bg-[#101826] border border-[#101826] text-white font-bold text-[15px]
    inline-flex items-center gap-1.5 whitespace-nowrap hover:bg-slate-800;
}
.btn-line {
  @apply min-h-[44px] px-[18px] rounded-[10px] bg-white border border-slate-200 text-slate-800 font-bold text-[15px]
    inline-flex items-center justify-center gap-1.5 whitespace-nowrap hover:bg-slate-50;
}
.empty-ic {
  @apply w-[52px] h-[52px] rounded-2xl bg-slate-100 text-slate-400 grid place-items-center mx-auto mb-2.5;
}
</style>
