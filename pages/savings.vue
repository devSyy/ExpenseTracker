<script setup lang="ts">
// 예금/적금 관리 페이지.
// 영속화/계산은 useSavings 컴포저블(→ savingsRepository) 책임.
import { computed, reactive, ref, watch } from 'vue'
import { useSavings, type PaymentEntry } from '~/composables/useSavings'

useHead({ title: '예금/적금 관리 · 가계부 대시보드' })

const {
  info,
  history,
  historyWithBalance,
  totalPaid,
  targetAmount,
  progress,
  saveInfo,
  resetInfo,
  addPayment,
  updatePayment,
  removePayment: removePaymentAction
} = useSavings()

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
  toastTimer = window.setTimeout(() => (toast.value = null), 2400) as unknown as number
}

// ── 납입 이력 입력 ──
const draft = reactive({
  date: new Date().toISOString().slice(0, 10),
  amount: null as number | null
})

function onAddPayment() {
  if (!draft.date) { notify('err', '적금 날짜를 입력하세요'); return }
  const amt = Number(draft.amount)
  if (!Number.isFinite(amt) || amt <= 0) { notify('err', '납입 금액은 양수여야 합니다'); return }
  const r = addPayment({ date: draft.date, amount: amt })
  if (!r) { notify('err', '추가에 실패했습니다'); return }
  draft.amount = null
  notify('ok', '납입 이력이 추가되었습니다')
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
  notify('ok', '수정되었습니다')
}

function removePayment(id: string) {
  if (!window.confirm('이 납입 이력을 삭제할까요?')) return
  if (removePaymentAction(id)) notify('ok', '삭제되었습니다')
}

// ── 적금 정보 저장/초기화 ──
function onSaveInfo() {
  if (saveInfo()) notify('ok', '적금 정보가 저장되었습니다')
  else notify('err', '저장에 실패했습니다')
}
function onResetInfo() {
  if (!window.confirm('입력값을 모두 초기화할까요?')) return
  resetInfo()
  notify('ok', '입력값이 초기화되었습니다')
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

// ── 포맷터 ──
function fmtKRW(n: number): string {
  return Number.isFinite(n) ? Number(n).toLocaleString('ko-KR') : '0'
}
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
    <transition name="fade">
      <div
        v-if="toast"
        :class="[
          'fixed top-6 right-6 z-50 px-4 py-2 rounded-lg shadow text-sm',
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        ]"
      >{{ toast.text }}</div>
    </transition>

    <!-- 적금 정보 입력 -->
    <section class="card">
      <h3 class="font-semibold text-slate-900 mb-4">적금 정보 입력</h3>

      <!-- 예금/적금 KPI: 모든 폰 2, 데스크톱 4, 와이드 6 -->
      <div class="grid grid-cols-2 lg:grid-cols-4 3xl:grid-cols-6 gap-3 sm:gap-4">
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
          <label class="kpi-label">이자율 (%)</label>
          <div class="relative mt-1">
            <input type="number" step="0.01" v-model.number="info.rate" placeholder="0.00" class="form-input pr-8 text-right tabular-nums" />
            <span class="suffix">%</span>
          </div>
        </div>
        <div>
          <label class="kpi-label">예금액</label>
          <div class="relative mt-1">
            <input type="number" v-model.number="info.targetAmount" placeholder="0" class="form-input pr-10 text-right tabular-nums" />
            <span class="suffix">원</span>
          </div>
        </div>
        <div>
          <label class="kpi-label">이자금액 (세후)</label>
          <div class="relative mt-1">
            <input type="number" v-model.number="info.interestAmount" placeholder="0" class="form-input pr-10 text-right tabular-nums" />
            <span class="suffix">원</span>
          </div>
        </div>
        <div>
          <label class="kpi-label">비고</label>
          <input type="text" v-model="info.note" placeholder="비고를 입력하세요" class="form-input mt-1" />
        </div>
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn-secondary" @click="onResetInfo">초기화</button>
        <button type="button" class="btn-primary" @click="onSaveInfo">저장하기</button>
      </div>
    </section>

    <!-- 적금 납입 입력 -->
    <section class="card">
      <h3 class="font-semibold text-slate-900 mb-4">적금 납입 입력</h3>
      <div class="flex flex-wrap items-end gap-4">
        <div class="min-w-[14rem]">
          <label class="kpi-label">적금 날짜</label>
          <input type="date" v-model="draft.date" class="form-input mt-1" @keydown.enter="onAddPayment" />
        </div>
        <div class="min-w-[14rem]">
          <label class="kpi-label">납입 금액</label>
          <div class="relative mt-1">
            <input type="number" v-model.number="draft.amount" placeholder="0" class="form-input pr-10 text-right tabular-nums" @keydown.enter="onAddPayment" />
            <span class="suffix">원</span>
          </div>
        </div>
        <button type="button" class="btn-primary self-end" @click="onAddPayment">납입 추가</button>
      </div>
      <p class="mt-3 text-xs text-slate-500 flex items-center gap-1.5">
        <span class="inline-block w-1.5 h-1.5 rounded-full bg-brand-500"></span>
        납입 정보를 추가하면 아래 적금 이력에 표시됩니다.
      </p>
    </section>

    <!-- 적금 이력 -->
    <section class="card">
      <header class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h3 class="font-semibold text-slate-900">적금 이력</h3>
        <div class="flex items-center gap-3 ml-auto min-w-[400px] flex-1 max-w-3xl">
          <div class="text-xs text-slate-600 whitespace-nowrap">
            총 납입금액 <b class="text-slate-900 tabular-nums">{{ fmtKRW(totalPaid) }}원</b>
            <span class="text-slate-300 mx-1">/</span>
            목표금액 <b class="text-slate-900 tabular-nums">{{ fmtKRW(targetAmount) }}원</b>
            <span class="text-slate-500 ml-1">({{ progress.toFixed(1) }}%)</span>
          </div>
          <div class="flex-1 min-w-[100px]">
            <div class="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div class="h-full bg-brand-600 transition-all" :style="{ width: progress + '%' }"></div>
            </div>
          </div>
          <span class="text-xs text-slate-500 tabular-nums w-10 text-right">{{ progress.toFixed(0) }}%</span>
        </div>
      </header>

      <div class="overflow-x-auto rounded-lg border border-slate-200">
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
                <td class="py-2 px-3 text-slate-600">{{ item.note || '–' }}</td>
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
            <tr v-if="historyWithBalance.length === 0">
              <td colspan="7" class="py-10 text-center text-slate-400 text-sm">납입 이력이 없습니다.</td>
            </tr>
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
