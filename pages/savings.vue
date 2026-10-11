<script setup lang="ts">
import { todayYmd, formatGrouped as fmtKRW } from '~/utils/format'
// 예금/적금 관리 페이지.
// 영속화/계산은 useSavings 컴포저블(→ savingsRepository) 책임.
import { computed, reactive, ref, watch } from 'vue'
import { useSavings, productLabel, SAVINGS_SYNC_CATEGORY, type PaymentEntry } from '~/composables/useSavings'
import { useExpenses } from '~/composables/useExpenses'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '예금/적금 관리 · 가계부' })

const {
  products,
  productSummaries,
  selectedId,
  selectProduct,
  addProduct,
  planAutoPayments,
  commitAutoPayments,
  info,
  history,
  historyWithBalance,
  totalPaid,
  targetAmount,
  goalAmount,
  progress,
  saveInfo,
  resetInfo,
  deleteSavings,
  syncFromDashboard,
  addPayment,
  updatePayment,
  removePayment: removePaymentAction
} = useSavings()
const { transactions: dashboardTxs } = useExpenses()

const BANK_OPTIONS = [
  '신한은행', '국민은행', '우리은행', 'KEB하나은행', 'NH농협은행',
  'IBK기업은행', 'SC제일은행', '카카오뱅크', '토스뱅크', '케이뱅크',
  '새마을금고', '우체국', '신협'
]
const TYPE_OPTIONS = ['자유적금', '정기적금', '정기예금', '자유예금', '청약저축', 'ISA', '회전식 정기예금']
const PAGE_SIZES = [10, 20, 50] as const

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 납입 이력 입력 ──
const draft = reactive({
  date: new Date().toISOString().slice(0, 10),
  amount: null as number | null,
  note: ''
})

function onAddPayment() {
  if (!draft.date) { notify('err', '적금 날짜를 입력하세요'); return }
  const amt = Number(draft.amount)
  if (!Number.isFinite(amt) || amt <= 0) { notify('err', '납입 금액은 양수여야 합니다'); return }
  const r = addPayment({ date: draft.date, amount: amt, note: draft.note.trim() || undefined })
  if (!r) { notify('err', '추가에 실패했습니다'); return }
  draft.amount = null
  draft.note = ''
  notify('ok', withBackupHint('납입 이력이 추가되었습니다'))
}

// ── 인라인 편집 ──
const editingId = ref<string | null>(null)
const editDraft = reactive({ date: '', amount: null as number | null, note: '' })

function startEdit(item: PaymentEntry) {
  editingId.value = item.id
  editDraft.date = item.date
  editDraft.amount = item.amount
  editDraft.note = item.note
}
function cancelEdit() { editingId.value = null }
function commitEdit() {
  if (!editingId.value) return
  const amt = Number(editDraft.amount)
  if (!editDraft.date || !Number.isFinite(amt) || amt <= 0) {
    notify('err', '날짜와 금액을 확인하세요'); return
  }
  updatePayment(editingId.value, {
    date: editDraft.date, amount: amt, note: editDraft.note.trim()
  })
  editingId.value = null
  notify('ok', withBackupHint('수정되었습니다'))
}

function removePayment(id: string) {
  if (!window.confirm('이 납입 이력을 삭제할까요?')) return
  if (removePaymentAction(id)) notify('ok', withBackupHint('삭제되었습니다'))
}

// ── 적금 정보 저장/초기화 ──
function onSaveInfo() {
  const d = info.value.payDay
  if (d !== null && d !== undefined && (!Number.isInteger(Number(d)) || Number(d) < 1 || Number(d) > 31)) {
    notify('err', '납입 날짜는 1~31 사이 정수여야 합니다'); return
  }
  if (saveInfo()) notify('ok', withBackupHint('적금 정보가 저장되었습니다'))
  else notify('err', '저장에 실패했습니다')
}
function onResetInfo() {
  if (!window.confirm('입력값을 모두 초기화할까요?')) return
  resetInfo()
  notify('ok', '입력값이 초기화되었습니다')
}

// 적금 전환 시 편집 상태·페이지 초기화
watch(selectedId, () => { editingId.value = null; page.value = 1 })

const currentLabel = computed(() => {
  const i = products.value.findIndex((p) => p.id === selectedId.value)
  return productLabel(info.value, Math.max(0, i))
})

function onAddProduct() {
  if (!addProduct()) { notify('err', '적금 추가에 실패했습니다'); return }
  notify('ok', '새 적금을 추가했습니다. "적금 정보 입력"에서 정보를 입력하고 저장하세요')
  document.getElementById('info-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 가입월 ~ 현재월 납입 자동 입력 — 건수·금액을 확인받은 뒤 반영한다
function onAutoPayments() {
  const plan = planAutoPayments()
  if (!plan.ok) { notify('err', plan.reason ?? '자동 입력할 수 없습니다'); return }
  if (plan.entries.length === 0) {
    notify('ok', `이미 모든 달의 납입이 입력되어 있습니다 (${plan.skippedMonths}개월)`)
    return
  }
  const first = plan.entries[0].date, last = plan.entries[plan.entries.length - 1].date
  const total = plan.entries.length * plan.amount
  const skip = plan.skippedMonths > 0 ? `\n(이미 납입이 있는 ${plan.skippedMonths}개월은 건너뜁니다)` : ''
  if (!window.confirm(`'${currentLabel.value}' 납입 ${plan.entries.length}건을 자동 입력할까요?\n${first} ~ ${last} · 매월 ${fmtKRW(plan.amount)}원 · 합계 ${fmtKRW(total)}원${skip}`)) return
  const n = commitAutoPayments(plan.entries)
  page.value = 1
  notify('ok', withBackupHint(`납입 이력 ${n}건을 자동 입력했습니다`))
}

// 대시보드 거래내역의 '정기적금' 거래 → 납입 이력 동기화 (이미 가져온 건 건너뜀)
function onSyncFromDashboard() {
  const r = syncFromDashboard(dashboardTxs.value)
  if (r.candidates === 0) {
    notify('err', `대시보드에 '${SAVINGS_SYNC_CATEGORY}' 카테고리 거래가 없습니다`)
    return
  }
  page.value = 1
  const extra = [r.skipped > 0 ? `${r.skipped}건 이미 동기화됨` : '', r.merged > 0 ? `중복 ${r.merged}건 합침` : ''].filter(Boolean).join(' · ')
  if (r.added === 0) notify('ok', `새로 가져올 납입이 없습니다${extra ? ` (${extra})` : ''}`)
  else notify('ok', withBackupHint(`납입 이력 ${r.added}건을 동기화했습니다${extra ? ` · ${extra}` : ''}`))
}

// 적금 삭제 — 정보 + 납입 이력 전체. 되돌릴 수 없으므로 즉시 저장한다.
const hasSavingsData = computed(() =>
  history.value.length > 0 || Object.values(info.value).some((v) => v !== '' && v !== null)
)
function onDeleteSavings() {
  const n = history.value.length
  const label = currentLabel.value
  if (!window.confirm(`'${label}'을(를) 삭제할까요?\n이 적금의 정보와 납입 이력 ${n}건이 모두 삭제되며 되돌릴 수 없습니다.${products.value.length > 1 ? '' : '\n(마지막 적금이라 빈 적금이 새로 생깁니다)'}`)) return
  const r = deleteSavings()
  if (!r.ok) { notify('err', '삭제에 실패했습니다'); return }
  editingId.value = null
  page.value = 1
  notify('ok', withBackupHint(`'${label}'을(를) 삭제했습니다 (납입 이력 ${r.removed}건)`))
}

// ── 페이지네이션 ──
const pageSize = ref<number>(10)
const page = ref<number>(1)
const pageCount = computed(() => Math.max(1, Math.ceil(historyWithBalance.value.length / pageSize.value)))

watch([pageSize, () => historyWithBalance.value.length], () => {
  if (page.value > pageCount.value) page.value = pageCount.value
  if (page.value < 1) page.value = 1
})
watch(pageSize, () => { page.value = 1 })

const visibleHistory = computed(() => {
  const reversed = historyWithBalance.value.slice().reverse() // 최신이 위
  const start = (page.value - 1) * pageSize.value
  return reversed.slice(start, start + pageSize.value)
})

// ── 요약(hero / KPI) 파생값 ──
const TAX_RATE = 0.154 // 이자소득세 15.4%
const MS_DAY = 86400000

function parseYmd(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '')
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3])
}
function fmtDot(s: string): string { return s ? s.replaceAll('-', '.') : '–' }

const todayStr = todayYmd()
const todayMs = parseYmd(todayStr)!

const hasPeriod = computed(() => parseYmd(info.value.startDate) !== null && parseYmd(info.value.endDate) !== null)
const termMonths = computed(() => {
  const a = parseYmd(info.value.startDate), b = parseYmd(info.value.endDate)
  if (a === null || b === null || b <= a) return 0
  return Math.round((b - a) / MS_DAY / 30.4375)
})
/** 가입→만기 구간에서 오늘의 위치(0~100) */
const elapsedPct = computed(() => {
  const a = parseYmd(info.value.startDate), b = parseYmd(info.value.endDate)
  if (a === null || b === null || b <= a) return 0
  return Math.min(100, Math.max(0, ((todayMs - a) / (b - a)) * 100))
})
const daysToMaturity = computed(() => {
  const b = parseYmd(info.value.endDate)
  return b === null ? null : Math.round((b - todayMs) / MS_DAY)
})
const daysSinceStart = computed(() => {
  const a = parseYmd(info.value.startDate)
  return a === null ? null : Math.round((todayMs - a) / MS_DAY)
})
type Phase = 'none' | 'before' | 'active' | 'matured'
const phase = computed<Phase>(() => {
  const d = daysToMaturity.value, e = daysSinceStart.value
  if (d === null || e === null) return 'none'
  if (e < 0) return 'before'
  return d < 0 ? 'matured' : 'active'
})
const ddayLabel = computed(() => {
  const d = daysToMaturity.value
  if (d === null) return '–'
  return d === 0 ? 'D-Day' : d > 0 ? `D-${d}` : `D+${-d}`
})
const phaseChip = computed(() => ({
  none: { text: '기간 미설정', cls: 'bg-white/10 text-slate-200' },
  before: { text: '가입 예정', cls: 'bg-sky-400/20 text-sky-200' },
  active: { text: '진행 중', cls: 'bg-teal-300/20 text-teal-200' },
  matured: { text: '만기 경과', cls: 'bg-orange-500/30 text-orange-200' }
}[phase.value]))

const rate = computed(() => Number(info.value.rate) || 0)
/** 단순 추정: 금액 × 연이율(세전) */
const interestAtTarget = computed(() => Math.round(targetAmount.value * rate.value / 100))
const interestNow = computed(() => Math.round(totalPaid.value * rate.value / 100))
const remaining = computed(() => Math.max(0, goalAmount.value - totalPaid.value))
const ringLen = 2 * Math.PI * 52
const ringDash = computed(() => `${(ringLen * progress.value) / 100} ${ringLen + 10}`)

function autoEstimateInterest() {
  if (targetAmount.value <= 0 || rate.value <= 0) { notify('err', '예금액과 이자율을 먼저 입력하세요'); return }
  info.value.interestAmount = Math.round(targetAmount.value * (rate.value / 100) * (1 - TAX_RATE))
  notify('ok', '세후 이자를 추정했습니다. 저장하기를 눌러 반영하세요')
}
function focusPayment() {
  document.getElementById('pay-amount')?.focus()
  document.getElementById('pay-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

// ── 포맷터 ──
function fmtDateTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 페이지 헤더 + 브레드크럼 -->
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-slate-900">예금/적금 관리</h2>
      <nav class="text-xs text-slate-400 flex items-center gap-1.5">
        <NuxtLink to="/" class="hover:text-slate-700">홈</NuxtLink>
        <span>›</span>
        <span>자산</span>
        <span>›</span>
        <span class="text-slate-700 font-medium">예금/적금 관리</span>
      </nav>
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

    <!-- 등록된 예금/적금 탭 — 여러 개 등록 가능 -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="p in productSummaries" :key="p.id" type="button"
        :class="['sv-tab', p.id === selectedId ? 'sv-tab-on' : '']"
        @click="selectProduct(p.id)"
      >
        <span class="font-semibold truncate max-w-[12rem]">{{ p.label }}</span>
        <span class="text-xs tabular-nums opacity-70">{{ fmtKRW(p.paid) }}원</span>
      </button>
      <button type="button" class="btn-soft py-2" @click="onAddProduct">+ 적금 추가</button>
    </div>

    <!-- 요약 hero -->
    <section class="rounded-2xl text-white p-5 sm:p-7 grid gap-6 lg:grid-cols-[1fr_auto] items-center bg-gradient-to-br from-[#101826] to-[#1B2A44]">
      <div class="min-w-0">
        <div class="text-xs font-bold text-slate-300">
          {{ info.type || '상품 종류 미선택' }}<template v-if="termMonths"> · {{ termMonths }}개월</template>
        </div>
        <h3 class="text-xl sm:text-2xl font-extrabold tracking-tight mt-1 mb-3 truncate">
          {{ info.name || info.bank ? (info.name || `${info.bank}${info.type ? ' ' + info.type : ''}`) : '예금/적금 정보를 입력하세요' }}
        </h3>
        <div class="flex flex-wrap gap-2">
          <span v-if="rate" class="chip bg-teal-300/20 text-teal-200">연 이율 {{ rate }}%</span>
          <span class="chip" :class="phaseChip.cls">{{ phaseChip.text }}</span>
          <span v-if="targetAmount" class="chip bg-white/10 text-slate-200">예금액 {{ fmtKRW(targetAmount) }}원</span>
          <span v-if="info.payDay" class="chip bg-white/10 text-slate-200">매월 {{ info.payDay }}일 납입</span>
          <span v-if="info.note" class="chip bg-white/10 text-slate-200">{{ info.note }}</span>
        </div>

        <!-- 타임라인 -->
        <div v-if="hasPeriod" class="mt-9 px-1">
          <div class="relative h-2 rounded-full bg-white/15">
            <div class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#3F7BE8] to-[#7EE0D0] transition-all" :style="{ width: elapsedPct + '%' }"></div>
            <span class="tl-dot" style="left:0"></span>
            <span class="tl-dot" style="left:100%"></span>
            <span class="absolute top-1/2 w-[18px] h-[18px] rounded-full bg-teal-300 border-4 border-[#101826] ring-2 ring-teal-300 -translate-x-1/2 -translate-y-1/2" :style="{ left: elapsedPct + '%' }"></span>
            <span
              class="absolute bottom-[22px] whitespace-nowrap bg-teal-300 text-[#0B2B27] text-xs font-extrabold px-2.5 py-0.5 rounded-lg"
              :style="elapsedPct > 85 ? { right: '0' } : { left: elapsedPct + '%', transform: 'translateX(-50%)' }">오늘 {{ fmtDot(todayStr) }}</span>
          </div>
          <div class="flex justify-between mt-3.5 text-xs text-slate-300">
            <div><b class="block text-white text-sm tabular-nums">{{ fmtDot(info.startDate) }}</b>가입일</div>
            <div class="text-right"><b class="block text-white text-sm tabular-nums">{{ fmtDot(info.endDate) }}</b>만기일</div>
          </div>
          <div class="mt-2.5 text-xs text-slate-300 text-center">
            <template v-if="phase === 'matured'">만기 후 {{ -(daysToMaturity ?? 0) }}일 경과 · 가입 후 {{ daysSinceStart }}일</template>
            <template v-else-if="phase === 'active'">만기까지 {{ daysToMaturity }}일 남음 · 가입 후 {{ daysSinceStart }}일</template>
            <template v-else-if="phase === 'before'">가입일까지 {{ -(daysSinceStart ?? 0) }}일 남음</template>
          </div>
        </div>
        <p v-else class="mt-6 text-sm text-slate-400">가입일과 만기일을 입력하면 기간 타임라인이 표시됩니다.</p>
      </div>

      <!-- 달성률 링 -->
      <div class="relative w-[168px] h-[168px] mx-auto lg:mx-0">
        <svg viewBox="0 0 120 120" class="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="12" />
          <circle cx="60" cy="60" r="52" fill="none" stroke="#7EE0D0" stroke-width="12" stroke-linecap="round"
                  :stroke-dasharray="ringDash" style="transition: stroke-dasharray .5s ease" />
        </svg>
        <div class="absolute inset-0 flex flex-col items-center justify-center">
          <span class="text-3xl font-extrabold tabular-nums">{{ progress.toFixed(1) }}%</span>
          <span class="text-xs text-slate-300">목표 달성률</span>
        </div>
      </div>
    </section>

    <!-- KPI 3종 -->
    <div class="grid gap-3 sm:gap-4 sm:grid-cols-3">
      <div class="kpi-card" :class="phase === 'matured' ? 'kpi-o' : 'kpi-b'">
        <div class="kpi-label">만기까지</div>
        <div class="kpi-big">{{ ddayLabel }}</div>
        <div class="kpi-sub">
          <template v-if="info.endDate">만기 {{ fmtDot(info.endDate) }}<template v-if="phase === 'matured'"> · {{ -(daysToMaturity ?? 0) }}일 지남</template></template>
          <template v-else>만기일을 입력하세요</template>
        </div>
      </div>
      <div class="kpi-card kpi-b">
        <div class="kpi-label">총 납입금액</div>
        <div class="kpi-big">{{ fmtKRW(totalPaid) }}원</div>
        <div class="kpi-sub">{{ goalAmount ? `목표까지 남은 금액 ${fmtKRW(remaining)}원` : '예금액을 입력하면 남은 금액이 계산됩니다' }}</div>
      </div>
      <div class="kpi-card kpi-t">
        <div class="kpi-label flex items-center gap-2">예상 이자 <span class="text-[11px] font-bold px-2 rounded-full bg-teal-50 text-teal-800 normal-case">예상(단순)</span></div>
        <div class="kpi-big">{{ fmtKRW(interestNow) }}원</div>
        <div class="kpi-sub">납입액 × 이율 · 목표 달성 시 {{ fmtKRW(interestAtTarget) }}원</div>
      </div>
    </div>

    <!-- 적금 정보 입력 -->
    <section id="info-section" class="card">
      <h3 class="font-semibold text-slate-900">적금 정보 입력</h3>
      <p class="text-xs text-slate-500 mt-0.5 mb-4">상품 기본 정보입니다. 저장하면 위 요약과 목표금액에 반영됩니다.</p>

      <!-- 예금/적금 KPI: 모든 폰 2, 데스크톱 4, 와이드 6 -->
      <div class="grid grid-cols-2 lg:grid-cols-4 3xl:grid-cols-6 gap-3 sm:gap-4">
        <div>
          <label class="kpi-label">상품 별칭</label>
          <input type="text" v-model="info.name" placeholder="예: 여행 적금" class="form-input mt-1" />
        </div>
        <div>
          <label class="kpi-label">은행 이름</label>
          <select v-model="info.bank" class="form-input mt-1">
            <option value="">선택</option>
            <option v-for="b in BANK_OPTIONS" :key="b" :value="b">{{ b }}</option>
          </select>
        </div>
        <div>
          <label class="kpi-label">예금/적금 종류</label>
          <select v-model="info.type" class="form-input mt-1">
            <option value="">선택</option>
            <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div>
          <label class="kpi-label">가입일</label>
          <input type="date" v-model="info.startDate" class="form-input mt-1" />
        </div>
        <div>
          <label class="kpi-label">만기일</label>
          <input type="date" v-model="info.endDate" class="form-input mt-1" />
        </div>

        <div>
          <label class="kpi-label">납입 날짜 (매월)</label>
          <div class="relative mt-1">
            <input type="number" min="1" max="31" step="1" v-model.number="info.payDay" placeholder="가입일과 동일" class="form-input pr-8 text-right tabular-nums" />
            <span class="suffix">일</span>
          </div>
          <p class="hint">자동 입력 시 매월 이 날짜로 납입을 만듭니다</p>
        </div>
        <div>
          <label class="kpi-label">이자율 (%)</label>
          <div class="relative mt-1">
            <input type="number" step="0.01" v-model.number="info.rate" placeholder="0.00" class="form-input pr-8 text-right tabular-nums" />
            <span class="suffix">%</span>
          </div>
        </div>
        <div>
          <label class="kpi-label">예금액 (월 납입 계획)</label>
          <div class="relative mt-1">
            <input type="number" v-model.number="info.targetAmount" placeholder="0" class="form-input pr-10 text-right tabular-nums" />
            <span class="suffix">원</span>
          </div>
          <p class="hint">적금은 월 납입액 × 납입 개월수({{ termMonths || '기간 미설정' }})가 목표금액입니다<template v-if="goalAmount && goalAmount !== targetAmount"> → {{ fmtKRW(goalAmount) }}원</template>. 예금은 예금액이 목표입니다</p>
        </div>
        <div class="col-span-2">
          <label class="kpi-label">이자금액 (세후)</label>
          <div class="flex gap-2 mt-1">
            <div class="relative flex-1">
              <input type="number" v-model.number="info.interestAmount" placeholder="0" class="form-input pr-10 text-right tabular-nums" />
              <span class="suffix">원</span>
            </div>
            <button type="button" class="btn-soft" @click="autoEstimateInterest">자동 추정</button>
          </div>
          <p class="hint">예금액 × 이율에서 이자소득세 15.4%를 뺀 단순 추정입니다</p>
        </div>
        <div>
          <label class="kpi-label">비고</label>
          <input type="text" v-model="info.note" placeholder="비고를 입력하세요" class="form-input mt-1" />
        </div>
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button" class="btn-danger mr-auto"
          :disabled="!hasSavingsData"
          title="적금 정보와 납입 이력을 모두 삭제합니다"
          @click="onDeleteSavings"
        >적금 삭제</button>
        <button type="button" class="btn-secondary" @click="onResetInfo">초기화</button>
        <button type="button" class="btn-primary" @click="onSaveInfo">저장하기</button>
      </div>
    </section>

    <!-- 적금 납입 입력 -->
    <section id="pay-section" class="card">
      <h3 class="font-semibold text-slate-900">적금 납입 입력</h3>
      <p class="text-xs text-slate-500 mt-0.5 mb-4">납입 정보를 추가하면 아래 적금 이력에 표시됩니다.</p>
      <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-[14rem]">
          <label class="kpi-label">적금 날짜</label>
          <input type="date" v-model="draft.date" class="form-input mt-1" @keydown.enter="onAddPayment" />
        </div>
        <div class="min-w-[14rem]">
          <label class="kpi-label">납입 금액</label>
          <div class="relative mt-1">
            <input id="pay-amount" type="number" v-model.number="draft.amount" placeholder="0" class="form-input pr-10 text-right tabular-nums" @keydown.enter="onAddPayment" />
            <span class="suffix">원</span>
          </div>
        </div>
        <div class="min-w-[14rem] flex-1">
          <label class="kpi-label">비고 (선택)</label>
          <input type="text" v-model="draft.note" placeholder="예: 10월분" class="form-input mt-1" @keydown.enter="onAddPayment" />
        </div>
        <button type="button" class="btn-primary self-end" @click="onAddPayment">납입 추가</button>
        <button
          type="button" class="btn-soft py-2 self-end"
          title="가입일의 월부터 현재월까지 월 납입 계획(예금액) 금액으로 매월 납입일(납입 날짜, 비우면 가입일의 일)에 납입을 만듭니다 (이미 납입이 있는 달은 건너뜀)"
          @click="onAutoPayments"
        >납입 자동 입력</button>
      </div>
    </section>

    <!-- 적금 이력 -->
    <section class="card">
      <header class="flex items-end justify-between flex-wrap gap-3 mb-3">
        <div>
          <h3 class="font-semibold text-slate-900">적금 이력</h3>
          <div class="text-xs text-slate-400 mt-0.5">{{ historyWithBalance.length }}건 · 최근 날짜순</div>
          <button
            type="button" class="btn-soft py-2 mt-2"
            :title="`대시보드 거래내역의 '${SAVINGS_SYNC_CATEGORY}' 거래를 납입 이력으로 가져옵니다 (이미 가져온 건 건너뜀)`"
            @click="onSyncFromDashboard"
          >대시보드 정기적금 동기화</button>
        </div>
        <div class="text-right">
          <div class="text-xl font-extrabold text-brand-800 tabular-nums">{{ fmtKRW(totalPaid) }}원</div>
          <div class="text-sm text-slate-500 tabular-nums">목표금액 {{ fmtKRW(goalAmount) }}원 ({{ progress.toFixed(1) }}%)</div>
        </div>
      </header>
      <div class="h-3 rounded-full bg-slate-100 overflow-hidden">
        <div class="h-full bg-brand-600 rounded-full transition-all" :style="{ width: progress + '%' }"></div>
      </div>
      <div class="flex justify-between text-xs text-slate-500 mt-2 mb-4 tabular-nums">
        <span>{{ fmtKRW(totalPaid) }}원</span>
        <span>남은 금액 {{ fmtKRW(remaining) }}원</span>
        <span>{{ fmtKRW(goalAmount) }}원</span>
      </div>

      <div v-if="historyWithBalance.length === 0" class="text-center py-10">
        <div class="w-16 h-16 rounded-full bg-brand-50 text-brand-600 grid place-items-center mx-auto mb-3.5">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7l2-3h12M16 13h2"/></svg>
        </div>
        <div class="text-base font-bold text-slate-900">납입 이력이 없습니다</div>
        <div class="text-sm text-slate-500 mt-1 mb-4">납입일과 금액을 입력하면 누적 잔액과 함께 이곳에 쌓입니다.</div>
        <button type="button" class="btn-primary" @click="focusPayment">첫 납입 추가하기</button>
      </div>

      <div v-else class="overflow-x-auto rounded-lg border border-slate-200">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="bg-slate-50 text-left text-xs text-slate-500 uppercase">
              <th class="py-2 px-3 text-center w-12">번호</th>
              <th class="py-2 px-3">적금 날짜</th>
              <th class="py-2 px-3 text-right">납입 금액</th>
              <th class="py-2 px-3 text-right">납입 후 잔액</th>
              <th class="py-2 px-3">비고</th>
              <th class="py-2 px-3">등록일</th>
              <th class="py-2 px-3 text-center w-20">관리</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="item in visibleHistory" :key="item.id">
              <!-- 일반 행 -->
              <tr v-if="editingId !== item.id" class="border-t border-slate-100 hover:bg-slate-50/40">
                <td class="py-2 px-3 text-center tabular-nums text-slate-600">{{ item.no }}</td>
                <td class="py-2 px-3 tabular-nums">{{ item.date }}</td>
                <td class="py-2 px-3 text-right tabular-nums font-medium">{{ fmtKRW(item.amount) }}원</td>
                <td class="py-2 px-3 text-right tabular-nums text-slate-700">{{ fmtKRW(item.balance) }}원</td>
                <td class="py-2 px-3 text-slate-600">
                  {{ item.note || '–' }}
                  <span v-if="item.source === 'dashboard'" class="ml-1 text-[11px] font-bold px-1.5 rounded-full bg-teal-50 text-teal-800">대시보드</span>
                  <span v-else-if="item.source === 'auto'" class="ml-1 text-[11px] font-bold px-1.5 rounded-full bg-sky-50 text-sky-800">자동</span>
                </td>
                <td class="py-2 px-3 tabular-nums text-slate-500">{{ fmtDateTime(item.createdAt) }}</td>
                <td class="py-2 px-3 text-center whitespace-nowrap">
                  <button type="button" class="icon-btn icon-edit" title="수정" @click="startEdit(item)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  </button>
                  <button type="button" class="icon-btn icon-del" title="삭제" @click="removePayment(item.id)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                  </button>
                </td>
              </tr>
              <!-- 편집 모드 행 -->
              <tr v-else class="border-t border-slate-100 bg-amber-50/40">
                <td class="py-2 px-3 text-center tabular-nums text-slate-600">{{ item.no }}</td>
                <td class="py-2 px-3"><input type="date" v-model="editDraft.date" class="form-input-sm" /></td>
                <td class="py-2 px-3 text-right">
                  <input type="number" v-model.number="editDraft.amount" class="form-input-sm text-right tabular-nums" />
                </td>
                <td class="py-2 px-3 text-right tabular-nums text-slate-500">{{ fmtKRW(item.balance) }}원</td>
                <td class="py-2 px-3"><input type="text" v-model="editDraft.note" class="form-input-sm" /></td>
                <td class="py-2 px-3 tabular-nums text-slate-500">{{ fmtDateTime(item.createdAt) }}</td>
                <td class="py-2 px-3 text-center whitespace-nowrap">
                  <button type="button" class="btn-mini-primary" @click="commitEdit">저장</button>
                  <button type="button" class="btn-mini ml-1" @click="cancelEdit">취소</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <!-- 페이지네이션 -->
      <div v-if="historyWithBalance.length > 0" class="mt-4 flex items-center justify-center gap-2 text-xs">
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
.chip { display:inline-flex; align-items:center; min-height:28px; padding:0 12px; border-radius:9999px; font-size:13px; font-weight:700; }
.tl-dot { position:absolute; top:50%; width:14px; height:14px; border-radius:50%; transform:translate(-50%,-50%); background:#1B2A44; border:3px solid #B7C2D6; }
.kpi-card { position:relative; overflow:hidden; background:#fff; border-radius:1rem; padding:1.25rem 1.375rem; @apply ring-1 ring-slate-200 shadow-sm; }
.kpi-card::before { content:""; position:absolute; left:0; top:0; bottom:0; width:5px; background:#1B55C9; }
.kpi-t::before { background:#0F766E; } .kpi-o::before { background:#D9540F; }
.kpi-big { font-size:1.875rem; font-weight:800; letter-spacing:-.5px; margin-top:.25rem; color:#123A8A; font-variant-numeric:tabular-nums; }
.kpi-t .kpi-big { color:#0F766E; } .kpi-o .kpi-big { color:#8A3306; }
.kpi-sub { font-size:.8125rem; color:#566074; margin-top:.125rem; }
.hint { font-size:11px; color:rgb(148 163 184); margin-top:.25rem; }
.btn-soft { @apply px-4 rounded-md bg-teal-50 text-teal-800 text-sm font-bold hover:bg-teal-100 whitespace-nowrap; }
.form-input {
  @apply w-full rounded-md border-slate-300 text-sm focus:border-brand-500 focus:ring-brand-500;
}
.form-input-sm {
  @apply w-full rounded-md border-slate-300 text-xs py-1 focus:border-brand-500 focus:ring-brand-500;
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
.sv-tab {
  @apply flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 text-sm hover:bg-slate-50;
}
.sv-tab-on {
  @apply bg-slate-900 text-white border-slate-900 hover:bg-slate-900;
}
.btn-danger {
  @apply px-4 py-2 rounded-md border border-rose-300 bg-white text-rose-700 text-sm font-medium hover:bg-rose-50 disabled:opacity-40 disabled:hover:bg-white;
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
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.icon-edit {
  color: rgb(37 99 235);
}
.icon-edit:hover {
  background: rgb(239 246 255);
}
.icon-del {
  color: rgb(220 38 38);
  margin-left: 2px;
}
.icon-del:hover {
  background: rgb(254 242 242);
}
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
  background: rgb(37 99 235);
  border-color: rgb(37 99 235);
  color: #fff;
}
.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
