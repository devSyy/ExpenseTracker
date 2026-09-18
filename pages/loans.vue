<script setup lang="ts">
// 대출 현황 페이지: 요약 카드 4개 + 내역 테이블 + 잔액 비중 도넛 + 상환 스케줄/금리 차트 + 요약 패널.
import { computed, reactive, ref } from 'vue'
import { Bar, Doughnut, Line } from 'vue-chartjs'
import { useLoans, type Loan } from '~/composables/useLoans'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '대출 현황 · 가계부' })

const {
  state,
  totalBalance,
  totalLimit,
  totalMonthlyPayment,
  weightedAvgRate,
  usageRate,
  annualInterest,
  balanceBreakdown,
  ratesByType,
  schedule,
  addLoan,
  updateLoan,
  removeLoan,
  setBaseDate
} = useLoans()

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 인라인 편집 / 추가 ──
const editingId = ref<string | null>(null)
const editDraft = reactive<Loan>({
  id: '', type: '', institution: '', product: '',
  balance: 0, limit: 0, rate: 0, repaymentMethod: '원리금균등',
  maturityDate: '', monthlyPayment: 0, status: '정상', note: ''
})
const adding = ref(false)
const newDraft = reactive<Omit<Loan, 'id'>>({
  type: '주택담보대출', institution: '', product: '',
  balance: 0, limit: 0, rate: 0, repaymentMethod: '원리금균등',
  maturityDate: new Date().toISOString().slice(0, 10), monthlyPayment: 0, status: '정상', note: ''
})

const REPAYMENT_OPTIONS = ['원리금균등', '원금균등', '만기일시상환', '리볼빙']
const STATUS_OPTIONS = ['정상', '연체', '휴면', '만기']
const TYPE_OPTIONS = ['주택담보대출', '사업자대출', '신용대출', '카드론', '기타대출', '자동차대출', '학자금대출']

function startEdit(loan: Loan) {
  editingId.value = loan.id
  Object.assign(editDraft, loan)
}
function cancelEdit() { editingId.value = null }
function commitEdit() {
  if (!editingId.value) return
  if (!editDraft.type) { notify('err', '구분을 입력하세요'); return }
  updateLoan(editingId.value, { ...editDraft })
  editingId.value = null
  notify('ok', withBackupHint('수정되었습니다'))
}
function onRemove(id: string) {
  if (!window.confirm('이 대출을 삭제할까요?')) return
  if (removeLoan(id)) notify('ok', withBackupHint('삭제되었습니다'))
}
function onAdd() {
  if (!newDraft.type || !newDraft.institution) { notify('err', '구분과 금융기관을 입력하세요'); return }
  addLoan({ ...newDraft })
  Object.assign(newDraft, {
    type: '주택담보대출', institution: '', product: '',
    balance: 0, limit: 0, rate: 0, repaymentMethod: '원리금균등',
    maturityDate: new Date().toISOString().slice(0, 10), monthlyPayment: 0, status: '정상', note: ''
  })
  adding.value = false
  notify('ok', withBackupHint('대출이 추가되었습니다'))
}

// ── 포맷터 ──
function fmtKRW(n: number): string {
  return Number.isFinite(n) ? Number(Math.round(n)).toLocaleString('ko-KR') : '0'
}
function fmtBigKRW(n: number): string {
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
function shortType(t: string): string {
  if (t === '주택담보대출') return '주담대'
  return t
}

// ── 차트 데이터 ──

// 잔액 비중 도넛
const donutData = computed(() => ({
  labels: balanceBreakdown.value.map((b) => b.type),
  datasets: [{
    data: balanceBreakdown.value.map((b) => b.balance),
    backgroundColor: balanceBreakdown.value.map((b) => b.color),
    borderColor: '#ffffff',
    borderWidth: 2
  }]
}))
const donutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '55%',
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => {
          const total = ctx.dataset.data.reduce((a: number, b: number) => a + b, 0) || 1
          return `${ctx.label}: ${fmtKRW(ctx.parsed)}원 (${((ctx.parsed / total) * 100).toFixed(1)}%)`
        }
      }
    }
  }
}

// 상환 스케줄 바 (단위: 만원)
const scheduleData = computed(() => {
  const s = schedule.value
  const toMan = (n: number) => Math.round(n / 10000)
  return {
    labels: ['1년 이내', '1~3년 이내', '3~5년 이내', '5년 초과'],
    datasets: [
      {
        label: '원금',
        data: [toMan(s.within1y.principal), toMan(s.y1to3.principal), toMan(s.y3to5.principal), toMan(s.over5y.principal)],
        backgroundColor: '#3b82f6',
        borderRadius: 4,
        maxBarThickness: 28
      },
      {
        label: '이자',
        data: [toMan(s.within1y.interest), toMan(s.y1to3.interest), toMan(s.y3to5.interest), toMan(s.over5y.interest)],
        backgroundColor: '#cbd5e1',
        borderRadius: 4,
        maxBarThickness: 28
      }
    ]
  }
})
const scheduleOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top' as const, align: 'end' as const, labels: { boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${Number(ctx.parsed.y).toLocaleString('ko-KR')}만원`
      }
    }
  },
  scales: {
    y: { beginAtZero: true, ticks: { callback: (v: any) => Number(v).toLocaleString('ko-KR') }, grid: { color: 'rgba(148,163,184,0.2)' } },
    x: { grid: { display: false } }
  }
}

// 캔버스에 직접 값 라벨 그리는 인라인 플러그인
const valueLabelsPlugin = {
  id: 'valueLabels',
  afterDatasetsDraw(chart: any) {
    const { ctx } = chart
    chart.data.datasets.forEach((dataset: any, di: number) => {
      const meta = chart.getDatasetMeta(di)
      meta.data.forEach((point: any, i: number) => {
        const v = dataset.data[i]
        if (v == null || v === 0) return
        ctx.save()
        ctx.fillStyle = '#475569'
        ctx.font = '10.5px Pretendard, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(Number(v).toLocaleString('ko-KR'), point.x, point.y - 6)
        ctx.restore()
      })
    })
  }
}

// 금리 라인
const rateData = computed(() => ({
  labels: ratesByType.value.map((r) => shortType(r.type)),
  datasets: [{
    label: '금리 (%)',
    data: ratesByType.value.map((r) => Number(r.rate.toFixed(2))),
    borderColor: '#3b82f6',
    backgroundColor: 'rgba(59,130,246,0.08)',
    pointBackgroundColor: '#3b82f6',
    pointRadius: 4,
    tension: 0.3,
    fill: true
  }]
}))
const rateOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { callbacks: { label: (ctx: any) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}%` } }
  },
  scales: {
    y: { beginAtZero: true, suggestedMax: 20, ticks: { stepSize: 4, callback: (v: any) => v }, grid: { color: 'rgba(148,163,184,0.2)' } },
    x: { grid: { display: false } }
  }
}
const rateLabelsPlugin = {
  id: 'rateLabels',
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
        ctx.fillText(`${Number(v).toFixed(2)}%`, point.x, point.y - 8)
        ctx.restore()
      })
    })
  }
}
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 헤더 -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <div class="flex items-center gap-2">
        <div class="w-8 h-8 rounded-md bg-blue-50 text-blue-600 grid place-items-center">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M5 21V10l7-5 7 5v11M9 21v-6h6v6"/></svg>
        </div>
        <h2 class="text-2xl font-bold text-slate-900">대출 현황</h2>
      </div>
      <div class="flex items-center gap-2 text-xs text-slate-500">
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
    <!-- 대출 KPI 4장: 모든 폰 2, 데스크톱 4 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <!-- 총 대출 잔액 -->
      <div class="card relative overflow-hidden">
        <div class="text-xs font-semibold text-blue-600 mb-1">총 대출 잔액</div>
        <div class="text-2xl font-bold text-blue-600 tabular-nums">{{ fmtKRW(totalBalance) }} <span class="text-sm font-medium text-slate-700">원</span></div>
        <div class="text-[11px] text-slate-500 mt-1">({{ fmtBigKRW(totalBalance) }})</div>
        <svg class="absolute right-3 bottom-3 opacity-20" width="58" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.5"><path d="M3 21h18M5 21V10l7-5 7 5v11"/></svg>
      </div>

      <!-- 총 대출 한도 -->
      <div class="card relative overflow-hidden">
        <div class="text-xs font-semibold text-emerald-600 mb-1">총 대출 한도</div>
        <div class="text-2xl font-bold text-slate-900 tabular-nums">{{ fmtKRW(totalLimit) }} <span class="text-sm font-medium">원</span></div>
        <div class="text-[11px] text-slate-500 mt-1">({{ fmtBigKRW(totalLimit) }})</div>
        <div class="mt-2 flex items-center gap-2">
          <span class="text-[11px] text-slate-500 whitespace-nowrap">한도 대비 사용률 {{ fmtPct(usageRate) }}</span>
          <div class="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div class="h-full bg-emerald-500 transition-all" :style="{ width: Math.min(100, usageRate * 100) + '%' }"></div>
          </div>
        </div>
      </div>

      <!-- 총 월 상환액 -->
      <div class="card relative overflow-hidden">
        <div class="text-xs font-semibold text-amber-600 mb-1">총 월 상환액</div>
        <div class="text-2xl font-bold text-amber-600 tabular-nums">{{ fmtKRW(totalMonthlyPayment) }} <span class="text-sm font-medium text-slate-700">원</span></div>
        <div class="text-[11px] text-slate-500 mt-1">(예상)</div>
        <div class="mt-2 text-[11px] text-slate-500">
          연간 이자 비용(예상) <b class="text-slate-700 tabular-nums">{{ fmtKRW(annualInterest) }} 원</b>
        </div>
      </div>

      <!-- 평균 금리 -->
      <div class="card relative overflow-hidden">
        <div class="text-xs font-semibold text-violet-600 mb-1">평균 금리</div>
        <div class="text-2xl font-bold text-violet-600 tabular-nums">{{ weightedAvgRate.toFixed(2) }}<span class="text-sm font-medium ml-1">%</span></div>
        <div class="text-[11px] text-slate-500 mt-1">가중평균 금리 기준</div>
        <svg class="absolute right-3 bottom-3 opacity-20" width="58" height="48" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="1.5"><path d="M19 5L5 19M9 9a4 4 0 1 0-1 1M19 19a4 4 0 1 0-1 1"/></svg>
      </div>
    </div>

    <!-- 대출 내역 + 잔액 비중 -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <!-- 대출 내역 (lg:col-span-2) -->
      <section class="card lg:col-span-2 overflow-hidden">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-slate-900">대출 내역</h3>
          <button v-if="!adding" type="button" class="btn-mini-primary" @click="adding = true">+ 대출 추가</button>
        </div>

        <div class="overflow-x-auto rounded-lg border border-slate-200">
          <table class="min-w-full text-xs">
            <thead>
              <tr class="bg-slate-50 text-[11px] text-slate-500 uppercase">
                <th class="py-2 px-2 text-left">구분</th>
                <th class="py-2 px-2 text-left">금융기관</th>
                <th class="py-2 px-2 text-left">대출 상품</th>
                <th class="py-2 px-2 text-right">대출 잔액</th>
                <th class="py-2 px-2 text-right">대출 한도</th>
                <th class="py-2 px-2 text-right">금리</th>
                <th class="py-2 px-2 text-left">상환방식</th>
                <th class="py-2 px-2 text-left">만기일</th>
                <th class="py-2 px-2 text-right">월 상환액</th>
                <th class="py-2 px-2 text-center">상태</th>
                <th class="py-2 px-2 text-left">비고</th>
                <th class="py-2 px-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              <!-- 추가 폼 -->
              <tr v-if="adding" class="border-t border-slate-100 bg-blue-50/40">
                <td class="py-1 px-1">
                  <select v-model="newDraft.type" class="form-input-xs w-full">
                    <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>
                <td class="py-1 px-1"><input v-model="newDraft.institution" type="text" class="form-input-xs w-full" placeholder="A은행" /></td>
                <td class="py-1 px-1"><input v-model="newDraft.product" type="text" class="form-input-xs w-full" placeholder="상품명" /></td>
                <td class="py-1 px-1"><input v-model.number="newDraft.balance" type="number" class="form-input-xs w-28 text-right tabular-nums" /></td>
                <td class="py-1 px-1"><input v-model.number="newDraft.limit" type="number" class="form-input-xs w-28 text-right tabular-nums" /></td>
                <td class="py-1 px-1"><input v-model.number="newDraft.rate" type="number" step="0.01" class="form-input-xs w-16 text-right tabular-nums" /></td>
                <td class="py-1 px-1">
                  <select v-model="newDraft.repaymentMethod" class="form-input-xs w-full">
                    <option v-for="r in REPAYMENT_OPTIONS" :key="r" :value="r">{{ r }}</option>
                  </select>
                </td>
                <td class="py-1 px-1"><input v-model="newDraft.maturityDate" type="date" class="form-input-xs" /></td>
                <td class="py-1 px-1"><input v-model.number="newDraft.monthlyPayment" type="number" class="form-input-xs w-24 text-right tabular-nums" /></td>
                <td class="py-1 px-1">
                  <select v-model="newDraft.status" class="form-input-xs">
                    <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
                  </select>
                </td>
                <td class="py-1 px-1"><input v-model="newDraft.note" type="text" class="form-input-xs w-full" /></td>
                <td class="py-1 px-1 text-center whitespace-nowrap">
                  <button type="button" class="btn-mini-primary" @click="onAdd">추가</button>
                  <button type="button" class="btn-mini ml-1" @click="adding = false">취소</button>
                </td>
              </tr>
              <!-- 데이터 행 -->
              <template v-for="loan in state.loans" :key="loan.id">
                <tr v-if="editingId !== loan.id" class="border-t border-slate-100 hover:bg-slate-50/40">
                  <td class="py-2 px-2 text-slate-700">{{ loan.type }}</td>
                  <td class="py-2 px-2 text-slate-700">{{ loan.institution }}</td>
                  <td class="py-2 px-2 text-slate-700">{{ loan.product }}</td>
                  <td class="py-2 px-2 text-right tabular-nums">{{ fmtKRW(loan.balance) }}</td>
                  <td class="py-2 px-2 text-right tabular-nums text-slate-600">{{ fmtKRW(loan.limit) }}</td>
                  <td class="py-2 px-2 text-right tabular-nums text-slate-700">{{ loan.rate.toFixed(2) }}%</td>
                  <td class="py-2 px-2 text-slate-600">{{ loan.repaymentMethod }}</td>
                  <td class="py-2 px-2 tabular-nums text-slate-600">{{ loan.maturityDate }}</td>
                  <td class="py-2 px-2 text-right tabular-nums text-slate-700">{{ loan.monthlyPayment > 0 ? fmtKRW(loan.monthlyPayment) : '-' }}</td>
                  <td class="py-2 px-2 text-center">
                    <span :class="['status-badge', loan.status === '정상' ? 'st-ok' : loan.status === '연체' ? 'st-late' : 'st-other']">{{ loan.status }}</span>
                  </td>
                  <td class="py-2 px-2 text-slate-500">{{ loan.note || '-' }}</td>
                  <td class="py-2 px-2 text-center whitespace-nowrap">
                    <button type="button" class="btn-mini" @click="startEdit(loan)">수정</button>
                    <button type="button" class="btn-mini-danger ml-1" @click="onRemove(loan.id)">삭제</button>
                  </td>
                </tr>
                <tr v-else class="border-t border-slate-100 bg-amber-50/40">
                  <td class="py-1 px-1">
                    <select v-model="editDraft.type" class="form-input-xs w-full">
                      <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
                    </select>
                  </td>
                  <td class="py-1 px-1"><input v-model="editDraft.institution" type="text" class="form-input-xs w-full" /></td>
                  <td class="py-1 px-1"><input v-model="editDraft.product" type="text" class="form-input-xs w-full" /></td>
                  <td class="py-1 px-1"><input v-model.number="editDraft.balance" type="number" class="form-input-xs w-28 text-right tabular-nums" /></td>
                  <td class="py-1 px-1"><input v-model.number="editDraft.limit" type="number" class="form-input-xs w-28 text-right tabular-nums" /></td>
                  <td class="py-1 px-1"><input v-model.number="editDraft.rate" type="number" step="0.01" class="form-input-xs w-16 text-right tabular-nums" /></td>
                  <td class="py-1 px-1">
                    <select v-model="editDraft.repaymentMethod" class="form-input-xs w-full">
                      <option v-for="r in REPAYMENT_OPTIONS" :key="r" :value="r">{{ r }}</option>
                    </select>
                  </td>
                  <td class="py-1 px-1"><input v-model="editDraft.maturityDate" type="date" class="form-input-xs" /></td>
                  <td class="py-1 px-1"><input v-model.number="editDraft.monthlyPayment" type="number" class="form-input-xs w-24 text-right tabular-nums" /></td>
                  <td class="py-1 px-1">
                    <select v-model="editDraft.status" class="form-input-xs">
                      <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
                    </select>
                  </td>
                  <td class="py-1 px-1"><input v-model="editDraft.note" type="text" class="form-input-xs w-full" /></td>
                  <td class="py-1 px-1 text-center whitespace-nowrap">
                    <button type="button" class="btn-mini-primary" @click="commitEdit">저장</button>
                    <button type="button" class="btn-mini ml-1" @click="cancelEdit">취소</button>
                  </td>
                </tr>
              </template>
              <!-- 합계 -->
              <tr class="border-t-2 border-slate-200 bg-blue-50/40 font-semibold">
                <td class="py-2 px-2 text-blue-700">합계</td>
                <td class="py-2 px-2 text-slate-400">-</td>
                <td class="py-2 px-2 text-slate-400">-</td>
                <td class="py-2 px-2 text-right tabular-nums text-blue-700">{{ fmtKRW(totalBalance) }}</td>
                <td class="py-2 px-2 text-right tabular-nums text-blue-700">{{ fmtKRW(totalLimit) }}</td>
                <td class="py-2 px-2 text-right tabular-nums text-blue-700">{{ weightedAvgRate.toFixed(2) }}%</td>
                <td class="py-2 px-2 text-slate-400">-</td>
                <td class="py-2 px-2 text-slate-400">-</td>
                <td class="py-2 px-2 text-right tabular-nums text-blue-700">{{ fmtKRW(totalMonthlyPayment) }}</td>
                <td class="py-2 px-2 text-slate-400 text-center">-</td>
                <td class="py-2 px-2 text-slate-400">-</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- 대출 잔액 비중 -->
      <section class="card">
        <h3 class="font-semibold text-slate-900 mb-3">대출 잔액 비중</h3>
        <div class="h-48 mb-3">
          <Doughnut v-if="balanceBreakdown.length > 0" :data="donutData" :options="donutOptions" />
          <div v-else class="h-full grid place-items-center text-sm text-slate-400">데이터가 없습니다.</div>
        </div>
        <div class="space-y-1.5">
          <div
            v-for="b in balanceBreakdown"
            :key="b.type"
            class="text-xs"
          >
            <div class="flex items-center gap-1.5">
              <span class="inline-block w-2.5 h-2.5 rounded-sm" :style="{ background: b.color }"></span>
              <span class="text-slate-700 flex-1">{{ b.type }}</span>
              <span class="tabular-nums text-slate-700 font-semibold">{{ fmtPct(b.share) }}</span>
            </div>
            <div class="text-[11px] text-slate-500 tabular-nums ml-4">{{ fmtKRW(b.balance) }} 원</div>
          </div>
        </div>
      </section>
    </div>

    <!-- 상환 스케줄 + 금리 + 대출 요약 -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <!-- 상환 스케줄 -->
      <section class="card">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-slate-900">상환 스케줄 요약</h3>
          <span class="text-[11px] text-slate-400">단위: 만원</span>
        </div>
        <div class="h-56 mt-2">
          <Bar :data="scheduleData" :options="scheduleOptions" :plugins="[valueLabelsPlugin]" />
        </div>
      </section>

      <!-- 금리 현황 -->
      <section class="card">
        <div class="flex items-center justify-between">
          <h3 class="font-semibold text-slate-900">금리 현황</h3>
          <span class="text-[11px] text-slate-400">단위: %</span>
        </div>
        <div class="h-56 mt-2">
          <Line v-if="ratesByType.length > 0" :data="rateData" :options="rateOptions" :plugins="[rateLabelsPlugin]" />
          <div v-else class="h-full grid place-items-center text-sm text-slate-400">데이터가 없습니다.</div>
        </div>
      </section>

      <!-- 대출 요약 -->
      <section class="card">
        <h3 class="font-semibold text-slate-900 mb-3">대출 요약</h3>
        <ul class="space-y-3 text-sm">
          <li class="flex items-center gap-3">
            <span class="w-7 h-7 rounded-md bg-blue-50 text-blue-600 grid place-items-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5A3.5 3.5 0 0 0 6 8.5c0 1.9 1.6 3.5 3.5 3.5H14a3.5 3.5 0 0 1 0 7H6"/></svg>
            </span>
            <span class="text-slate-500 flex-1">총 대출 잔액</span>
            <span class="tabular-nums text-slate-900 font-semibold">{{ fmtKRW(totalBalance) }} 원 <span class="text-[11px] font-normal text-slate-400">({{ fmtBigKRW(totalBalance) }})</span></span>
          </li>
          <li class="flex items-center gap-3">
            <span class="w-7 h-7 rounded-md bg-emerald-50 text-emerald-600 grid place-items-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="9" ry="3"/><path d="M3 6v6c0 1.7 4 3 9 3s9-1.3 9-3V6M3 12v6c0 1.7 4 3 9 3s9-1.3 9-3v-6"/></svg>
            </span>
            <span class="text-slate-500 flex-1">총 대출 한도</span>
            <span class="tabular-nums text-slate-900 font-semibold">{{ fmtKRW(totalLimit) }} 원 <span class="text-[11px] font-normal text-slate-400">({{ fmtBigKRW(totalLimit) }})</span></span>
          </li>
          <li class="flex items-center gap-3">
            <span class="w-7 h-7 rounded-md bg-amber-50 text-amber-600 grid place-items-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            </span>
            <span class="text-slate-500 flex-1">총 월 상환액(예상)</span>
            <span class="tabular-nums text-slate-900 font-semibold">{{ fmtKRW(totalMonthlyPayment) }} 원</span>
          </li>
          <li class="flex items-center gap-3">
            <span class="w-7 h-7 rounded-md bg-violet-50 text-violet-600 grid place-items-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8 8 16M9 9h.01M15 15h.01"/></svg>
            </span>
            <span class="text-slate-500 flex-1">평균 금리</span>
            <span class="tabular-nums text-slate-900 font-semibold">{{ weightedAvgRate.toFixed(2) }}%</span>
          </li>
          <li class="flex items-center gap-3">
            <span class="w-7 h-7 rounded-md bg-emerald-50 text-emerald-600 grid place-items-center flex-shrink-0">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
            </span>
            <span class="text-slate-500 flex-1">한도 대비 사용률</span>
            <span class="tabular-nums text-blue-600 font-semibold">{{ fmtPct(usageRate) }}</span>
          </li>
        </ul>
      </section>
    </div>

    <!-- 안내 -->
    <p class="text-xs text-slate-500 flex items-start gap-1.5 px-1">
      <svg class="mt-0.5 flex-shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      상환 스케줄 및 금리 정보는 예상치이며, 실제와 차이가 있을 수 있습니다.
    </p>
  </div>
</template>

<style scoped>
.form-input-sm {
  @apply rounded-md border-slate-300 text-xs py-1.5 focus:border-brand-500 focus:ring-brand-500;
}
.form-input-xs {
  @apply rounded border-slate-300 text-[11px] py-1 px-1.5 focus:border-brand-500 focus:ring-brand-500;
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
.status-badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 12px;
  font-size: 10.5px;
  font-weight: 500;
  border: 1px solid;
}
.st-ok { background: rgb(220 252 231); color: rgb(21 128 61); border-color: rgb(187 247 208); }
.st-late { background: rgb(254 226 226); color: rgb(185 28 28); border-color: rgb(254 202 202); }
.st-other { background: rgb(241 245 249); color: rgb(71 85 105); border-color: rgb(226 232 240); }
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
