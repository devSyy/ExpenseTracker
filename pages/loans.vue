<script setup lang="ts">
import { formatGrouped } from '~/utils/format'
// 대출 현황 페이지 (목업 기반 고도화)
// 헤더 → KPI 4장(액센트 바) → 내역 테이블(전폭) → [잔액 비중 | 상환 스케줄] → [금리 현황 | 대출 요약]
// 차트는 Chart.js 대신 SVG/CSS로 그린다: 값·범례가 항상 화면에 보이고 의존성이 줄어든다.
import { computed, reactive, ref } from 'vue'
import { useLoans, LOAN_TYPES, type Loan } from '~/composables/useLoans'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '대출 현황 · 가계부' })

const {
  state,
  visibleLoans,
  activeLoans,
  loansByBalance,
  loansByRate,
  totalBalance,
  totalLimit,
  totalMonthlyPayment,
  weightedAvgRate,
  usageRate,
  annualInterest,
  rateRange,
  typeBreakdown,
  institutionBreakdown,
  typeColor,
  scheduleRows,
  monthsUntilMaturity,
  addLoan,
  updateLoan,
  removeLoan,
  removeLoans,
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
function blankDraft(): Omit<Loan, 'id'> {
  return {
    type: '주택담보대출', institution: '', product: '',
    balance: 0, limit: 0, rate: 0, repaymentMethod: '원리금균등',
    maturityDate: new Date().toISOString().slice(0, 10), monthlyPayment: 0, status: '정상', note: ''
  }
}
const newDraft = reactive<Omit<Loan, 'id'>>(blankDraft())
const tableCard = ref<HTMLElement | null>(null)

const REPAYMENT_OPTIONS = ['원리금균등', '원금균등', '만기일시상환', '리볼빙']
const STATUS_OPTIONS = ['정상', '연체', '휴면', '만기']
const TYPE_OPTIONS = [...LOAN_TYPES]

function openAdd() {
  adding.value = true
  tableCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
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
function onRemoveAll() {
  const ids = visibleLoans.value.map((l) => l.id)
  if (ids.length === 0) return
  if (!window.confirm(`표시 중인 대출 ${ids.length}건을 모두 삭제할까요?\n되돌릴 수 없습니다.`)) return
  const n = removeLoans(ids)
  editingId.value = null
  if (n > 0) notify('ok', withBackupHint(`${n}건이 삭제되었습니다`))
}
function onAdd() {
  if (!newDraft.type || !newDraft.institution) { notify('err', '구분과 금융기관을 입력하세요'); return }
  addLoan({ ...newDraft })
  Object.assign(newDraft, blankDraft())
  adding.value = false
  notify('ok', withBackupHint('대출이 추가되었습니다'))
}

// ── 포맷터 ──
const fmtKRW = (n: number): string => formatGrouped(n, true)
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
/** 도넛 중앙처럼 좁은 곳용 — 1.7억원 / 850만원 */
function fmtCompactKRW(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0원'
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}억원`
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만원`
  return `${fmtKRW(n)}원`
}
function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + '%'
}
/** '주택담보대출' → '주택담보' (칩·아바타용) */
function shortType(t: string): string {
  return t.endsWith('대출') ? t.slice(0, -2) : t
}
function fmtRemaining(months: number): string {
  if (months <= 0) return '만기 도래'
  const y = Math.floor(months / 12)
  const m = months % 12
  return [y > 0 ? `${y}년` : '', m > 0 ? `${m}개월` : ''].filter(Boolean).join(' ')
}
function loanLabel(l: Loan): string {
  return [l.institution, l.product].filter(Boolean).join(' · ') || l.type
}
function statusClass(s: string): string {
  return s === '정상' ? 'st-ok' : s === '연체' ? 'st-late' : 'st-other'
}
/** 만기가 1년 이내로 다가온 대출 — 날짜를 강조한다 */
function isMaturingSoon(l: Loan): boolean {
  const m = monthsUntilMaturity(l)
  return l.status !== '만기' && m > 0 && m <= 12
}

// ── 잔액 비중 도넛 ──
const groupBy = ref<'institution' | 'type'>('institution')
const breakdown = computed(() => groupBy.value === 'institution' ? institutionBreakdown.value : typeBreakdown.value)
const hoverLabel = ref<string | null>(null)
const SEG_GAP = 0.6 // 조각 사이 흰 간격 (둘레 100 기준)
const donutSegments = computed(() => {
  let cum = 0
  const n = breakdown.value.length
  return breakdown.value.map((b) => {
    const pct = b.share * 100
    const len = n > 1 ? Math.max(pct - SEG_GAP, 0.01) : pct
    const seg = { ...b, len, offset: -cum }
    cum += pct
    return seg
  })
})
const donutCenter = computed(() => {
  const hit = hoverLabel.value ? breakdown.value.find((b) => b.label === hoverLabel.value) : null
  return hit
    ? { caption: hit.label, value: fmtCompactKRW(hit.balance) }
    : { caption: '총 잔액', value: fmtCompactKRW(totalBalance.value) }
})

// ── 상환 스케줄 (스택 바) ──
const scheduleMax = computed(() => Math.max(0, ...scheduleRows.value.map((r) => r.principal + r.interest)))
function barPct(v: number): number {
  if (scheduleMax.value <= 0 || v <= 0) return 0
  return Math.max((v / scheduleMax.value) * 100, 0.8) // 0보다 크면 최소한 보이게
}

// ── 금리 현황 ──
const rateMax = computed(() => Math.max(0, ...loansByRate.value.map((l) => l.rate)))
function rateBarPct(rate: number): number {
  return rateMax.value > 0 ? (rate / rateMax.value) * 100 : 0
}
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 헤더 -->
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <div class="text-xs text-slate-500">자산 › 대출</div>
        <h2 class="text-2xl font-extrabold text-slate-900 tracking-tight">대출 현황</h2>
        <p class="text-sm text-slate-500 mt-0.5">
          기준일 {{ state.baseDate }} · 대출 {{ visibleLoans.length }}건
        </p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        <label class="flex items-center gap-2 text-xs text-slate-500">
          기준일
          <input
            type="date"
            :value="state.baseDate"
            @change="setBaseDate(($event.target as HTMLInputElement).value)"
            class="form-input-sm"
          />
        </label>
        <button type="button" class="btn-primary" @click="openAdd">+ 대출 추가</button>
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

    <!-- KPI 4장: 모바일 2열, 데스크톱 4열 -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <div class="card relative overflow-hidden">
        <span class="kpi-bar bg-orange-500"></span>
        <div class="text-xs font-bold text-slate-500">총 대출 잔액</div>
        <div class="kpi-num text-orange-800">{{ fmtKRW(totalBalance) }}<span class="kpi-unit">원</span></div>
        <div class="text-xs text-slate-400 mt-0.5">상환 중 <b class="text-slate-600">{{ activeLoans.length }}건</b> · {{ fmtBigKRW(totalBalance) }}</div>
      </div>

      <div class="card relative overflow-hidden">
        <span class="kpi-bar bg-brand-600"></span>
        <div class="text-xs font-bold text-slate-500">총 대출 한도</div>
        <div class="kpi-num text-brand-800">{{ fmtKRW(totalLimit) }}<span class="kpi-unit">원</span></div>
        <div class="text-xs text-slate-400 mt-0.5">한도 대비 사용률 <b class="text-slate-600">{{ fmtPct(usageRate) }}</b></div>
        <div class="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-2.5">
          <div class="h-full rounded-full bg-brand-600 transition-all" :style="{ width: Math.min(100, usageRate * 100) + '%' }"></div>
        </div>
      </div>

      <div class="card relative overflow-hidden">
        <span class="kpi-bar bg-orange-500"></span>
        <div class="text-xs font-bold text-slate-500">총 월 상환액 (예상)</div>
        <div class="kpi-num text-orange-800">{{ fmtKRW(totalMonthlyPayment) }}<span class="kpi-unit">원</span></div>
        <div class="text-xs text-slate-400 mt-0.5">연간 이자 비용 예상 <b class="text-slate-600">{{ fmtCompactKRW(annualInterest) }}</b></div>
      </div>

      <div class="card relative overflow-hidden">
        <span class="kpi-bar bg-teal-600"></span>
        <div class="text-xs font-bold text-slate-500">평균 금리</div>
        <div class="kpi-num text-teal-700">{{ weightedAvgRate.toFixed(2) }}<span class="kpi-unit">%</span></div>
        <div class="text-xs text-slate-400 mt-0.5">잔액 가중평균 기준</div>
      </div>
    </div>

    <!-- 대출 내역 (전폭) -->
    <section ref="tableCard" class="card scroll-mt-4">
      <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 class="font-bold text-slate-900">
          대출 내역 <span class="text-slate-400 font-medium text-xs">· {{ visibleLoans.length }}건</span>
        </h3>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn-outline text-amber-800"
            :disabled="visibleLoans.length === 0"
            @click="onRemoveAll"
          >전체 삭제</button>
          <button v-if="!adding" type="button" class="btn-primary" @click="openAdd">+ 대출 추가</button>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="min-w-full text-[13px] tabular-nums">
          <thead>
            <tr class="text-xs text-slate-500">
              <th class="th text-left">구분</th>
              <th class="th text-left">금융기관</th>
              <th class="th text-left">대출 상품</th>
              <th class="th text-right">대출 잔액</th>
              <th class="th text-right">대출 한도</th>
              <th class="th text-right">금리</th>
              <th class="th text-left">상환방식</th>
              <th class="th text-right">만기일</th>
              <th class="th text-right">월 상환액<br />(예상)</th>
              <th class="th text-left">상태</th>
              <th class="th text-left">비고</th>
              <th class="th w-20"></th>
            </tr>
          </thead>
          <tbody>
            <!-- 추가 폼 -->
            <tr v-if="adding" class="bg-brand-50/60">
              <td class="py-1.5 px-1">
                <select v-model="newDraft.type" class="form-input-xs w-full">
                  <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
                </select>
              </td>
              <td class="py-1.5 px-1"><input v-model="newDraft.institution" type="text" class="form-input-xs w-full" placeholder="A은행" /></td>
              <td class="py-1.5 px-1"><input v-model="newDraft.product" type="text" class="form-input-xs w-full" placeholder="상품명" /></td>
              <td class="py-1.5 px-1"><input v-model.number="newDraft.balance" type="number" class="form-input-xs w-28 text-right" /></td>
              <td class="py-1.5 px-1"><input v-model.number="newDraft.limit" type="number" class="form-input-xs w-28 text-right" /></td>
              <td class="py-1.5 px-1"><input v-model.number="newDraft.rate" type="number" step="0.01" class="form-input-xs w-16 text-right" /></td>
              <td class="py-1.5 px-1">
                <select v-model="newDraft.repaymentMethod" class="form-input-xs w-full">
                  <option v-for="r in REPAYMENT_OPTIONS" :key="r" :value="r">{{ r }}</option>
                </select>
              </td>
              <td class="py-1.5 px-1"><input v-model="newDraft.maturityDate" type="date" class="form-input-xs" /></td>
              <td class="py-1.5 px-1"><input v-model.number="newDraft.monthlyPayment" type="number" class="form-input-xs w-24 text-right" /></td>
              <td class="py-1.5 px-1">
                <select v-model="newDraft.status" class="form-input-xs">
                  <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
                </select>
              </td>
              <td class="py-1.5 px-1"><input v-model="newDraft.note" type="text" class="form-input-xs w-full" /></td>
              <td class="py-1.5 px-1 text-center whitespace-nowrap">
                <button type="button" class="btn-mini-primary" @click="onAdd">추가</button>
                <button type="button" class="btn-mini ml-1" @click="adding = false">취소</button>
              </td>
            </tr>

            <!-- 빈 상태 -->
            <tr v-if="visibleLoans.length === 0 && !adding">
              <td colspan="12" class="py-12 text-center">
                <div class="text-slate-500 text-sm">등록된 대출이 없습니다.</div>
                <button type="button" class="btn-primary mt-3" @click="openAdd">+ 대출 추가</button>
              </td>
            </tr>

            <!-- 데이터 행 -->
            <template v-for="loan in visibleLoans" :key="loan.id">
              <tr v-if="editingId !== loan.id" class="border-t border-slate-100 hover:bg-slate-50/60 transition-colors">
                <td class="py-3 px-2"><span class="chip-type">{{ shortType(loan.type) }}</span></td>
                <td class="py-3 px-2 text-slate-700 min-w-[5rem]">{{ loan.institution }}</td>
                <td class="py-3 px-2 font-bold text-slate-900 min-w-[7rem]">{{ loan.product }}</td>
                <td class="py-3 px-2 text-right">{{ fmtKRW(loan.balance) }}</td>
                <td class="py-3 px-2 text-right text-slate-600">{{ fmtKRW(loan.limit) }}</td>
                <td class="py-3 px-2 text-right text-slate-700">{{ loan.rate.toFixed(2) }}%</td>
                <td class="py-3 px-2 text-slate-600 whitespace-nowrap">{{ loan.repaymentMethod }}</td>
                <td
                  class="py-3 px-2 text-right whitespace-nowrap"
                  :class="isMaturingSoon(loan) ? 'text-amber-700 font-semibold' : 'text-slate-600'"
                  :title="isMaturingSoon(loan) ? '1년 이내 만기' : undefined"
                >{{ loan.maturityDate }}</td>
                <td class="py-3 px-2 text-right font-bold text-slate-900">{{ loan.monthlyPayment > 0 ? fmtKRW(loan.monthlyPayment) : '-' }}</td>
                <td class="py-3 px-2"><span :class="['status-badge', statusClass(loan.status)]">{{ loan.status }}</span></td>
                <td class="py-3 px-2 text-slate-500 max-w-[8rem] truncate" :title="loan.note">{{ loan.note || '-' }}</td>
                <td class="py-1 px-1 text-center whitespace-nowrap">
                  <button type="button" class="icon-btn" aria-label="수정" title="수정" @click="startEdit(loan)">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>
                  </button>
                  <button type="button" class="icon-btn hover:text-rose-600" aria-label="삭제" title="삭제" @click="onRemove(loan.id)">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>
                  </button>
                </td>
              </tr>
              <tr v-else class="border-t border-slate-100 bg-amber-50/50">
                <td class="py-1.5 px-1">
                  <select v-model="editDraft.type" class="form-input-xs w-full">
                    <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
                  </select>
                </td>
                <td class="py-1.5 px-1"><input v-model="editDraft.institution" type="text" class="form-input-xs w-full" /></td>
                <td class="py-1.5 px-1"><input v-model="editDraft.product" type="text" class="form-input-xs w-full" /></td>
                <td class="py-1.5 px-1"><input v-model.number="editDraft.balance" type="number" class="form-input-xs w-28 text-right" /></td>
                <td class="py-1.5 px-1"><input v-model.number="editDraft.limit" type="number" class="form-input-xs w-28 text-right" /></td>
                <td class="py-1.5 px-1"><input v-model.number="editDraft.rate" type="number" step="0.01" class="form-input-xs w-16 text-right" /></td>
                <td class="py-1.5 px-1">
                  <select v-model="editDraft.repaymentMethod" class="form-input-xs w-full">
                    <option v-for="r in REPAYMENT_OPTIONS" :key="r" :value="r">{{ r }}</option>
                  </select>
                </td>
                <td class="py-1.5 px-1"><input v-model="editDraft.maturityDate" type="date" class="form-input-xs" /></td>
                <td class="py-1.5 px-1"><input v-model.number="editDraft.monthlyPayment" type="number" class="form-input-xs w-24 text-right" /></td>
                <td class="py-1.5 px-1">
                  <select v-model="editDraft.status" class="form-input-xs">
                    <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ s }}</option>
                  </select>
                </td>
                <td class="py-1.5 px-1"><input v-model="editDraft.note" type="text" class="form-input-xs w-full" /></td>
                <td class="py-1.5 px-1 text-center whitespace-nowrap">
                  <button type="button" class="btn-mini-primary" @click="commitEdit">저장</button>
                  <button type="button" class="btn-mini ml-1" @click="cancelEdit">취소</button>
                </td>
              </tr>
            </template>
          </tbody>
          <!-- 합계 -->
          <tfoot v-if="visibleLoans.length > 0">
            <tr class="bg-slate-50 font-extrabold text-slate-900">
              <td class="py-3 px-2 rounded-l-lg" colspan="3">
                합계 <span class="font-medium text-slate-400 text-xs">({{ visibleLoans.length }}건)</span>
              </td>
              <td class="py-3 px-2 text-right">{{ fmtKRW(totalBalance) }}</td>
              <td class="py-3 px-2 text-right">{{ fmtKRW(totalLimit) }}</td>
              <td class="py-3 px-2 text-right">{{ weightedAvgRate.toFixed(2) }}%</td>
              <td></td>
              <td></td>
              <td class="py-3 px-2 text-right">{{ fmtKRW(totalMonthlyPayment) }}</td>
              <td colspan="3" class="rounded-r-lg"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>

    <!-- 잔액 비중 | 상환 스케줄 -->
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.25fr] gap-4 sm:gap-5">
      <section class="card">
        <div class="flex items-center justify-between flex-wrap gap-2 mb-3">
          <h3 class="font-bold text-slate-900">대출 잔액 비중</h3>
          <div class="seg" role="group" aria-label="비중 기준">
            <button type="button" :class="{ on: groupBy === 'institution' }" :aria-pressed="groupBy === 'institution'" @click="groupBy = 'institution'">기관별</button>
            <button type="button" :class="{ on: groupBy === 'type' }" :aria-pressed="groupBy === 'type'" @click="groupBy = 'type'">구분별</button>
          </div>
        </div>

        <div v-if="breakdown.length > 0" class="flex items-center gap-5 flex-wrap sm:flex-nowrap">
          <div class="relative w-40 h-40 sm:w-44 sm:h-44 flex-none mx-auto sm:mx-0">
            <svg viewBox="0 0 42 42" class="w-full h-full -rotate-90" role="img" :aria-label="`대출 잔액 ${groupBy === 'institution' ? '기관별' : '구분별'} 비중`">
              <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#eef2f7" stroke-width="5.5" />
              <circle
                v-for="s in donutSegments"
                :key="s.label"
                cx="21" cy="21" r="15.9155" fill="none"
                :stroke="s.color" stroke-width="5.5"
                :stroke-dasharray="`${s.len} ${100 - s.len}`"
                :stroke-dashoffset="s.offset"
                class="transition-opacity cursor-pointer"
                :style="{ opacity: hoverLabel && hoverLabel !== s.label ? 0.25 : 1 }"
                @mouseenter="hoverLabel = s.label"
                @mouseleave="hoverLabel = null"
              >
                <title>{{ s.label }}: {{ fmtKRW(s.balance) }}원 ({{ fmtPct(s.share) }})</title>
              </circle>
            </svg>
            <div class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none px-6 text-center">
              <span class="text-xs text-slate-500 truncate max-w-full">{{ donutCenter.caption }}</span>
              <span class="text-lg font-extrabold text-slate-900 tabular-nums">{{ donutCenter.value }}</span>
            </div>
          </div>

          <ul class="flex-1 min-w-[10rem] space-y-2 text-sm">
            <li
              v-for="b in breakdown"
              :key="b.label"
              class="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 transition-colors"
              :class="hoverLabel === b.label ? 'bg-slate-50' : ''"
              @mouseenter="hoverLabel = b.label"
              @mouseleave="hoverLabel = null"
            >
              <span class="inline-block w-2.5 h-2.5 rounded-[3px] flex-none" :style="{ background: b.color }"></span>
              <span class="flex-1 text-slate-800 truncate" :title="b.label">{{ b.label }}</span>
              <span class="text-xs text-slate-400 tabular-nums hidden xl:inline">{{ fmtCompactKRW(b.balance) }}</span>
              <b class="text-slate-600 tabular-nums w-14 text-right">{{ fmtPct(b.share) }}</b>
            </li>
          </ul>
        </div>
        <div v-else class="h-40 grid place-items-center text-sm text-slate-400">데이터가 없습니다.</div>
      </section>

      <section class="card">
        <h3 class="font-bold text-slate-900">상환 스케줄 요약</h3>
        <p class="text-xs text-slate-500 mt-0.5 mb-4">
          기준일 이후 기간별 상환 예정 원금 · 이자 (월 상환액이 없거나 리볼빙인 대출은 제외)
        </p>
        <div v-for="r in scheduleRows" :key="r.key" class="mb-4 last:mb-3">
          <div class="flex items-baseline justify-between text-sm mb-1.5">
            <span class="text-slate-700">{{ r.label }}</span>
            <b class="tabular-nums text-slate-900">{{ fmtKRW(r.principal) }}원</b>
          </div>
          <div class="flex h-3.5 rounded-full bg-slate-100 overflow-hidden" role="img" :aria-label="`${r.label} 원금 ${fmtKRW(r.principal)}원, 이자 ${fmtKRW(r.interest)}원`">
            <i class="block h-full bg-[#eb6834]" :style="{ width: barPct(r.principal) + '%' }"></i>
            <i class="block h-full bg-[#f8cdb9]" :style="{ width: barPct(r.interest) + '%' }"></i>
          </div>
          <div class="text-xs text-slate-400 mt-1">{{ r.count }}건 상환 · 예상 이자 {{ fmtKRW(r.interest) }}원</div>
        </div>
        <div class="flex gap-4 text-xs text-slate-500">
          <span class="flex items-center gap-1.5"><i class="inline-block w-2.5 h-2.5 rounded-[3px] bg-[#eb6834]"></i>원금</span>
          <span class="flex items-center gap-1.5"><i class="inline-block w-2.5 h-2.5 rounded-[3px] bg-[#f8cdb9]"></i>예상 이자</span>
        </div>
      </section>
    </div>

    <!-- 금리 현황 | 대출 요약 -->
    <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.25fr] gap-4 sm:gap-5">
      <section class="card">
        <h3 class="font-bold text-slate-900">금리 현황</h3>
        <p class="text-xs text-slate-500 mt-0.5">잔액 가중평균 기준</p>
        <div class="flex items-baseline gap-2.5 mt-3">
          <span class="text-[2rem] leading-none font-extrabold text-teal-700 tracking-tight tabular-nums">{{ weightedAvgRate.toFixed(2) }}%</span>
          <span class="text-xs text-slate-500">가중평균 금리</span>
        </div>
        <div class="grid grid-cols-3 gap-2.5 my-4">
          <div class="rounded-xl bg-slate-50 px-3 py-2.5">
            <small class="block text-xs text-slate-500">최저 금리</small>
            <b class="tabular-nums">{{ rateRange.min.toFixed(2) }}%</b>
          </div>
          <div class="rounded-xl bg-slate-50 px-3 py-2.5">
            <small class="block text-xs text-slate-500">최고 금리</small>
            <b class="tabular-nums">{{ rateRange.max.toFixed(2) }}%</b>
          </div>
          <div class="rounded-xl bg-slate-50 px-3 py-2.5 min-w-0">
            <small class="block text-xs text-slate-500">연 이자 예상</small>
            <b class="tabular-nums block truncate" :title="fmtKRW(annualInterest) + '원'">{{ fmtCompactKRW(annualInterest) }}</b>
          </div>
        </div>
        <div v-if="loansByRate.length > 0" class="space-y-1.5">
          <div
            v-for="l in loansByRate"
            :key="l.id"
            class="grid grid-cols-[minmax(0,1fr)_2fr_3.5rem] gap-2.5 items-center text-[13px] py-0.5"
          >
            <span class="truncate text-slate-700" :title="loanLabel(l)">{{ l.institution || l.type }} {{ l.product }}</span>
            <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
              <i class="block h-full rounded-full bg-teal-700" :style="{ width: rateBarPct(l.rate) + '%' }"></i>
            </div>
            <b class="text-right tabular-nums">{{ l.rate.toFixed(2) }}%</b>
          </div>
        </div>
        <div v-else class="py-6 text-center text-sm text-slate-400">데이터가 없습니다.</div>
      </section>

      <section class="card">
        <h3 class="font-bold text-slate-900">대출 요약</h3>
        <p class="text-xs text-slate-500 mt-0.5 mb-3">상환 중인 대출을 잔액이 큰 순서로 보여줍니다.</p>
        <ul v-if="loansByBalance.length > 0">
          <li
            v-for="(l, i) in loansByBalance"
            :key="l.id"
            class="flex items-center gap-3.5 py-3"
            :class="i > 0 ? 'border-t border-slate-100' : 'pt-0'"
          >
            <span
              class="w-10 h-10 rounded-xl grid place-items-center font-extrabold text-white flex-none"
              :style="{ background: typeColor(l.type) }"
              :title="l.type"
            >{{ shortType(l.type).charAt(0) }}</span>
            <div class="flex-1 min-w-0">
              <b class="block truncate text-slate-900" :title="loanLabel(l)">{{ loanLabel(l) }}</b>
              <small class="text-slate-400 text-xs">
                {{ l.repaymentMethod }} · 금리 {{ l.rate.toFixed(2) }}% · 만기 {{ fmtRemaining(monthsUntilMaturity(l)) }}
              </small>
            </div>
            <div class="text-right whitespace-nowrap">
              <b class="text-orange-800 tabular-nums">{{ fmtKRW(l.balance) }}원</b>
              <small class="block text-xs text-slate-500 tabular-nums">
                {{ l.monthlyPayment > 0 ? `월 ${fmtKRW(l.monthlyPayment)}원 (예상)` : '월 상환액 미입력' }}
              </small>
            </div>
          </li>
        </ul>
        <div v-else class="py-8 text-center text-sm text-slate-400">상환 중인 대출이 없습니다.</div>
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

/* 버튼 */
.btn-primary {
  @apply inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-lg bg-brand-600 text-white text-sm font-bold whitespace-nowrap hover:bg-brand-700 transition-colors;
}
.btn-outline {
  @apply inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-lg border border-slate-300 bg-white text-sm font-bold whitespace-nowrap hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed;
}
.btn-mini {
  @apply px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-600 text-xs hover:bg-slate-50;
}
.btn-mini-primary {
  @apply px-2 py-0.5 rounded bg-brand-600 text-white text-xs hover:bg-brand-700;
}
.icon-btn {
  @apply inline-grid place-items-center w-8 h-9 rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors;
}

/* KPI */
.kpi-bar {
  @apply absolute left-0 inset-y-0 w-1;
}
.kpi-num {
  @apply font-extrabold tracking-tight tabular-nums whitespace-nowrap mt-1;
  font-size: clamp(1.1rem, 0.85rem + 0.8vw, 1.5rem);
  line-height: 1.2;
}
.kpi-unit {
  @apply ml-0.5 font-bold;
  font-size: 0.7em;
}

/* 테이블 */
.th {
  @apply py-2.5 px-2 font-bold leading-tight border-b border-slate-200 whitespace-nowrap;
}
.chip-type {
  @apply inline-block px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold whitespace-nowrap;
}
.status-badge {
  @apply inline-block px-2.5 py-0.5 rounded-full text-xs font-bold whitespace-nowrap;
}
.st-ok { background: rgb(232 240 253); color: rgb(18 58 138); }
.st-late { background: rgb(254 226 226); color: rgb(185 28 28); }
.st-other { background: rgb(241 245 249); color: rgb(71 85 105); }

/* 세그먼트 토글 */
.seg {
  @apply inline-flex bg-slate-100 rounded-xl p-1 gap-1;
}
.seg button {
  @apply min-h-[36px] px-3.5 rounded-lg text-sm font-bold text-slate-500 transition-colors;
}
.seg button.on {
  @apply bg-white text-slate-900 shadow-sm;
}
</style>
