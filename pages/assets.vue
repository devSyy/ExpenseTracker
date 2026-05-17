<script setup lang="ts">
// 자산 현황 페이지: 총 자산 요약, 카테고리 카드, 상세 내역, 비중 차트, 변동 추이, 비고.
import { computed, ref } from 'vue'
import { Doughnut, Line } from 'vue-chartjs'
import { useAssets, ASSET_CATEGORIES } from '~/composables/useAssets'

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

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2400) as unknown as number
}

// ── 카테고리 인라인 편집 ──
const editingKey = ref<string | null>(null)
const editAmount = ref<number | null>(null)
const editNote = ref<string>('')

function startEditEntry(key: string) {
  const entry = state.value.entries[key] ?? { amount: 0, note: '' }
  editingKey.value = key
  editAmount.value = entry.amount
  editNote.value = entry.note
}
function commitEditEntry() {
  if (!editingKey.value) return
  const amt = Number(editAmount.value)
  if (!Number.isFinite(amt) || amt < 0) { notify('err', '금액은 0 이상이어야 합니다'); return }
  setEntry(editingKey.value, amt, editNote.value)
  editingKey.value = null
  notify('ok', '저장되었습니다')
}
function cancelEditEntry() {
  editingKey.value = null
}

// ── 비고 편집 ──
const newRemark = ref<string>('')
const editingRemarkIdx = ref<number | null>(null)
const editingRemarkText = ref<string>('')

function onAddRemark() {
  if (addRemark(newRemark.value)) {
    newRemark.value = ''
    notify('ok', '비고가 추가되었습니다')
  } else {
    notify('err', '내용을 입력하세요')
  }
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
  notify('ok', '현재 상태를 변동 추이에 기록했습니다')
}

// ── 포맷터 ──
function fmtKRW(n: number): string {
  return Number.isFinite(n) ? Number(n).toLocaleString('ko-KR') : '0'
}
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

// ── 차트 데이터 ──
const donutData = computed(() => ({
  labels: breakdown.value.map((b) => b.label),
  datasets: [
    {
      data: breakdown.value.map((b) => b.amount),
      backgroundColor: breakdown.value.map((b) => b.color),
      borderColor: '#ffffff',
      borderWidth: 2
    }
  ]
}))

const donutOptionsSmall = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '62%',
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => {
          const totalSum = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0) || 1
          const pct = (ctx.parsed / totalSum) * 100
          return `${ctx.label}: ${fmtKRW(ctx.parsed)}원 (${pct.toFixed(1)}%)`
        }
      }
    }
  }
}

const donutOptionsLarge = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '52%',
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => {
          const totalSum = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0) || 1
          const pct = (ctx.parsed / totalSum) * 100
          return `${ctx.label}: ${fmtKRW(ctx.parsed)}원 (${pct.toFixed(1)}%)`
        }
      }
    }
  }
}

// ── 변동 추이 차트 (Line) ──
// 단위: 만원으로 표시 (data를 /10000 변환)
const trendSorted = computed(() =>
  state.value.trend.slice().sort((a, b) => a.ym.localeCompare(b.ym))
)

const trendData = computed(() => ({
  labels: trendSorted.value.map((p) => Number(p.ym.slice(5)) + '월'),
  datasets: [
    {
      label: '총 자산 (만원)',
      data: trendSorted.value.map((p) => Math.round(p.total / 10000)),
      borderColor: '#2563eb',
      backgroundColor: 'rgba(37,99,235,0.08)',
      pointBackgroundColor: '#2563eb',
      pointRadius: 4,
      pointHoverRadius: 6,
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
        ctx.font = '11px Pretendard, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(Number(v).toLocaleString('ko-KR'), point.x, point.y - 10)
        ctx.restore()
      })
    })
  }
}

const trendOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: true,
      position: 'top' as const,
      align: 'end' as const,
      labels: { boxWidth: 12, font: { size: 11 } }
    },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toLocaleString('ko-KR')}만원`
      }
    }
  },
  scales: {
    y: {
      beginAtZero: false,
      ticks: { callback: (v: any) => Number(v).toLocaleString('ko-KR') },
      grid: { color: 'rgba(148,163,184,0.2)' }
    },
    x: { grid: { display: false } }
  }
}

// ── 카테고리 아이콘 (SVG path) ──
function iconPath(key: string): string {
  switch (key) {
    case 'cash':
      return 'M2 6h20v12H2zM2 10h20M6 14h2M16 14h2'
    case 'stocks':
      return 'M3 17l6-6 4 4 8-8M14 7h7v7'
    case 'realEstate':
      return 'M3 12l9-9 9 9M5 10v10h14V10'
    case 'car':
      return 'M5 17h14M5 17v-3l2-5h10l2 5v3M7 17v2M17 17v2M7 13h10'
    default:
      return 'M5 12h.01M12 12h.01M19 12h.01'
  }
}
function iconBg(key: string): string {
  switch (key) {
    case 'cash': return 'bg-blue-50 text-blue-600'
    case 'stocks': return 'bg-emerald-50 text-emerald-600'
    case 'realEstate': return 'bg-amber-50 text-amber-600'
    case 'car': return 'bg-rose-50 text-rose-600'
    default: return 'bg-slate-100 text-slate-500'
  }
}
function colorClass(key: string): string {
  switch (key) {
    case 'cash': return 'text-blue-600'
    case 'stocks': return 'text-emerald-600'
    case 'realEstate': return 'text-amber-600'
    case 'car': return 'text-rose-600'
    default: return 'text-slate-600'
  }
}
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 페이지 헤더 -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-md bg-blue-50 text-blue-600 grid place-items-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/></svg>
        </div>
        <h2 class="text-2xl font-bold text-slate-900">자산 현황</h2>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-500">
        <span>기준일:</span>
        <input
          type="date"
          :value="state.baseDate"
          @change="setBaseDate(($event.target as HTMLInputElement).value)"
          class="form-input-sm"
        />
        <button
          type="button"
          class="btn-secondary text-xs px-3 py-1.5"
          title="현재 합계를 이 달의 변동 추이로 저장"
          @click="onSnapshot"
        >이번 달 스냅샷</button>
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
      >{{ toast.text }}</div>
    </transition>

    <!-- 상단: 총 자산 + 카테고리 카드 5개 -->
    <section class="card">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 items-center">
        <!-- ───────── 좌측: 총 자산 요약 (총액 + 도넛 + 범례) ───────── -->
        <div class="lg:col-span-5 lg:pr-5 lg:border-r lg:border-dashed lg:border-slate-200">
          <div class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase mb-2">Summary · 총 자산 요약</div>

          <!-- 상단 행: 총액 + 도넛 (항상 가로 정렬, 컴팩트) -->
          <div class="flex items-center gap-4 mb-3">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-semibold text-blue-600 mb-1">총 자산</div>
              <div class="text-2xl font-bold text-slate-900 tabular-nums break-all">{{ fmtKRW(total) }}<span class="text-sm font-medium ml-1">원</span></div>
              <div class="text-xs text-slate-500 mt-1">({{ fmtBigKRW(total) }})</div>
            </div>
            <div class="w-28 h-28 flex-shrink-0 relative">
              <Doughnut :data="donutData" :options="donutOptionsSmall" />
            </div>
          </div>

          <!--
            하단 행: 비중 범례 (full-width, 자기 행을 가짐)
            → narrow/medium 너비에서도 카드 영역과 절대 겹치지 않음
            → narrow(<lg)에서는 외곽 grid-cols-1 로 인해 자연스럽게 카드(col-span-7) "위"에 위치
           -->
          <div class="bg-slate-50/70 rounded-lg p-2.5 border border-slate-200/70">
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
              <div
                v-for="b in breakdown"
                :key="b.key"
                class="flex items-center gap-1.5 text-xs min-w-0"
              >
                <span class="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" :style="{ background: b.color }"></span>
                <span class="text-slate-700 flex-1 truncate">{{ b.label }}</span>
                <span class="tabular-nums text-slate-600 flex-shrink-0">{{ fmtPct(b.share) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ───────── 우측: 카테고리 카드 5장 (상세) ─────────
          - <sm: 2컬럼 / sm~lg: 3컬럼 / lg+: 5컬럼
          (5개 항목 기준 5컬럼이 최대치이므로 더 큰 단계 불필요)
         -->
        <div class="lg:col-span-7 lg:pl-1">
          <div class="text-[11px] font-semibold tracking-wider text-slate-400 uppercase mb-2">Details · 카테고리별 자산</div>
          <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            <div
              v-for="b in breakdown"
              :key="b.key"
              class="rounded-lg border border-slate-200 px-3 py-3 text-center bg-white hover:bg-slate-50/40 hover:border-slate-300 transition"
            >
              <div :class="['mx-auto w-8 h-8 rounded-md grid place-items-center mb-2', iconBg(b.key)]">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path :d="iconPath(b.key)"/>
                </svg>
              </div>
              <div class="text-xs text-slate-500 mb-1">{{ b.label }}</div>
              <div :class="['text-sm font-bold tabular-nums', colorClass(b.key)]">{{ fmtKRW(b.amount) }}<span class="text-xs font-medium ml-0.5">원</span></div>
              <div class="text-[11px] text-blue-500 mt-0.5 tabular-nums">{{ fmtPct(b.share) }}</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 자산 상세 내역 + 자산 비중 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <!-- 자산 상세 내역 -->
      <section class="card">
        <h3 class="font-semibold text-slate-900 mb-3">자산 상세 내역</h3>
        <div class="overflow-hidden rounded-lg border border-slate-200">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="bg-slate-50 text-xs text-slate-500">
                <th class="py-2 px-3 text-left">자산 구분</th>
                <th class="py-2 px-3 text-right">금액</th>
                <th class="py-2 px-3 text-right">비중</th>
                <th class="py-2 px-3 text-left">비고</th>
                <th class="py-2 px-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="b in breakdown" :key="b.key">
                <tr v-if="editingKey !== b.key" class="border-t border-slate-100 hover:bg-slate-50/40">
                  <td class="py-2 px-3 text-slate-700">{{ b.label }}</td>
                  <td class="py-2 px-3 text-right tabular-nums">{{ fmtKRW(b.amount) }} 원</td>
                  <td class="py-2 px-3 text-right tabular-nums text-slate-600">{{ fmtPct(b.share) }}</td>
                  <td class="py-2 px-3 text-slate-500">{{ b.note || '–' }}</td>
                  <td class="py-2 px-3 text-center">
                    <button type="button" class="btn-mini" @click="startEditEntry(b.key)">수정</button>
                  </td>
                </tr>
                <tr v-else class="border-t border-slate-100 bg-amber-50/40">
                  <td class="py-2 px-3 text-slate-700">{{ b.label }}</td>
                  <td class="py-2 px-3 text-right">
                    <input type="number" v-model.number="editAmount" class="form-input-sm text-right tabular-nums w-32" />
                  </td>
                  <td class="py-2 px-3 text-right tabular-nums text-slate-400">–</td>
                  <td class="py-2 px-3">
                    <input type="text" v-model="editNote" class="form-input-sm w-full" />
                  </td>
                  <td class="py-2 px-3 text-center whitespace-nowrap">
                    <button type="button" class="btn-mini-primary" @click="commitEditEntry">저장</button>
                    <button type="button" class="btn-mini ml-1" @click="cancelEditEntry">취소</button>
                  </td>
                </tr>
              </template>
              <tr class="border-t-2 border-slate-200 bg-blue-50/40 font-semibold">
                <td class="py-2 px-3 text-blue-700">합계</td>
                <td class="py-2 px-3 text-right tabular-nums text-blue-700">{{ fmtKRW(total) }} 원</td>
                <td class="py-2 px-3 text-right tabular-nums text-blue-700">100%</td>
                <td class="py-2 px-3 text-slate-400">–</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 자산 비중 -->
      <section class="card">
        <h3 class="font-semibold text-slate-900 mb-3">자산 비중</h3>
        <div class="grid grid-cols-1 sm:grid-cols-5 gap-4 items-center">
          <div class="sm:col-span-3 h-64">
            <Doughnut :data="donutData" :options="donutOptionsLarge" />
          </div>
          <div class="sm:col-span-2 space-y-2">
            <div
              v-for="b in breakdown"
              :key="b.key"
              class="text-xs"
            >
              <div class="flex items-center gap-1.5 mb-0.5">
                <span class="inline-block w-2.5 h-2.5 rounded-sm" :style="{ background: b.color }"></span>
                <span class="text-slate-700 font-medium flex-1">{{ b.label }}</span>
                <span class="tabular-nums text-slate-700 font-semibold">{{ fmtPct(b.share) }}</span>
              </div>
              <div class="text-slate-500 text-[11px] tabular-nums ml-4">{{ fmtKRW(b.amount) }} 원</div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 변동 추이 + 주요 비고 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <!-- 자산 변동 추이 -->
      <section class="card">
        <div class="flex items-center justify-between mb-1">
          <h3 class="font-semibold text-slate-900">자산 변동 추이</h3>
          <span class="text-[11px] text-slate-400">단위: 만원</span>
        </div>
        <div class="h-56 mt-2">
          <Line v-if="trendSorted.length > 0" :data="trendData" :options="trendOptions" :plugins="[valueLabelsPlugin]" />
          <div v-else class="h-full grid place-items-center text-sm text-slate-400">스냅샷이 없습니다.</div>
        </div>
        <div v-if="trendSorted.length > 0" class="mt-2 flex flex-wrap gap-1.5">
          <span
            v-for="p in trendSorted"
            :key="p.ym"
            class="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600"
          >
            {{ p.ym }} · {{ Math.round(p.total / 10000).toLocaleString('ko-KR') }}만원
            <button type="button" class="text-slate-400 hover:text-rose-500" @click="removeTrendPoint(p.ym)" title="삭제">×</button>
          </span>
        </div>
      </section>

      <!-- 주요 자산 비고 -->
      <section class="card">
        <h3 class="font-semibold text-slate-900 mb-3">주요 자산 비고</h3>
        <ul class="space-y-2 mb-3">
          <li
            v-for="(r, idx) in state.remarks"
            :key="idx"
            class="flex items-start gap-2 text-sm text-slate-700"
          >
            <span class="mt-2 inline-block w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0"></span>
            <template v-if="editingRemarkIdx === idx">
              <input
                v-model="editingRemarkText"
                type="text"
                class="form-input-sm flex-1"
                @keydown.enter="commitEditRemark"
                @keydown.esc="cancelEditRemark"
              />
              <button type="button" class="btn-mini-primary" @click="commitEditRemark">저장</button>
              <button type="button" class="btn-mini" @click="cancelEditRemark">취소</button>
            </template>
            <template v-else>
              <span class="flex-1 leading-relaxed">{{ r }}</span>
              <button type="button" class="btn-mini" @click="startEditRemark(idx)">수정</button>
              <button type="button" class="btn-mini-danger" @click="removeRemark(idx)">삭제</button>
            </template>
          </li>
          <li v-if="state.remarks.length === 0" class="text-sm text-slate-400">
            등록된 비고가 없습니다.
          </li>
        </ul>
        <div class="flex gap-2 pt-3 border-t border-slate-100">
          <input
            v-model="newRemark"
            type="text"
            placeholder="새 비고를 입력하고 Enter"
            class="form-input-sm flex-1"
            @keydown.enter="onAddRemark"
          />
          <button type="button" class="btn-primary px-3 py-1.5 text-xs" @click="onAddRemark">추가</button>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.form-input-sm {
  @apply rounded-md border-slate-300 text-xs py-1.5 focus:border-brand-500 focus:ring-brand-500;
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
.btn-mini-danger {
  @apply px-2 py-0.5 rounded border border-rose-200 bg-white text-rose-600 text-xs hover:bg-rose-50;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
