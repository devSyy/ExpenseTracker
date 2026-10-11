<script setup lang="ts">
// 계약 관리 페이지.
// 영속화/검증/날짜 파생 계산은 useContracts 컴포저블(→ contractsRepository) 책임.
import { computed, reactive, ref } from 'vue'
import {
  emptyContractDraft,
  useContracts,
  type ContractDraft,
  type ContractStatus,
  type ContractView
} from '~/composables/useContracts'
import { formatKRW, formatKoreanAmount } from '~/utils/format'
import { describeDays, formatDDay } from '~/utils/schedule'
import { withBackupHint } from '~/utils/backupHint'

useHead({ title: '계약 관리 · 가계부' })

const {
  views,
  summary,
  addContract,
  updateContract,
  removeContract,
  setTerminated,
  CONTRACT_KINDS,
  CONTRACT_CYCLES,
  DEFAULT_SOON_DAYS
} = useContracts()

// ── 토스트 ──
const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3600) as unknown as number
}

// ── 필터 ──
const STATUS_FILTERS = ['전체', '임박', '진행중', '예정', '만료', '해지'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

const statusFilter = ref<StatusFilter>('전체')
const kindFilter = ref<string>('전체')
const search = ref('')

const filtered = computed<ContractView[]>(() => {
  const q = search.value.trim().toLowerCase()
  return views.value.filter((v) => {
    if (statusFilter.value !== '전체' && v.status !== statusFilter.value) return false
    if (kindFilter.value !== '전체' && v.contract.kind !== kindFilter.value) return false
    if (q) {
      const hay = `${v.contract.title} ${v.contract.counterparty} ${v.contract.note}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
})

/** 상태 칩에 붙일 건수 */
function countOf(s: StatusFilter): number {
  if (s === '전체') return views.value.length
  return views.value.filter((v) => v.status === s).length
}

// ── 추가 / 편집 폼 ──
// 같은 폼을 신규와 편집에 함께 쓴다. editingId가 null이면 신규.
const formOpen = ref(false)
const editingId = ref<string | null>(null)
const draft = reactive<ContractDraft>(emptyContractDraft())
const formError = ref('')

function openCreate() {
  Object.assign(draft, emptyContractDraft())
  editingId.value = null
  formError.value = ''
  formOpen.value = true
}

function openEdit(v: ContractView) {
  const c = v.contract
  Object.assign(draft, {
    title: c.title,
    counterparty: c.counterparty,
    kind: c.kind,
    startDate: c.startDate,
    endDate: c.endDate,
    amount: c.amount,
    cycle: c.cycle,
    autoRenew: c.autoRenew,
    noticeDays: c.noticeDays,
    terminated: c.terminated,
    note: c.note
  } satisfies ContractDraft)
  editingId.value = c.id
  formError.value = ''
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  editingId.value = null
  formError.value = ''
}

/** 빈 숫자 입력은 null로 — 0과 '입력 안 함'은 다른 뜻이다 */
function numOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function onSubmit() {
  formError.value = ''
  const payload = {
    title: draft.title,
    counterparty: draft.counterparty,
    kind: draft.kind,
    startDate: draft.startDate,
    endDate: draft.endDate,
    amount: numOrNull(draft.amount),
    cycle: draft.cycle,
    autoRenew: draft.autoRenew,
    noticeDays: numOrNull(draft.noticeDays),
    terminated: draft.terminated,
    note: draft.note
  }

  const r = editingId.value
    ? updateContract(editingId.value, payload)
    : addContract(payload)

  if (!r.ok) {
    formError.value = r.reason ?? '저장에 실패했습니다'
    return
  }
  notify('ok', withBackupHint(editingId.value ? '계약이 수정되었습니다' : '계약이 추가되었습니다'))
  closeForm()
}

function onRemove(v: ContractView) {
  if (!window.confirm(`'${v.contract.title}' 계약을 삭제할까요?\n되돌릴 수 없습니다.`)) return
  const r = removeContract(v.contract.id)
  if (!r.ok) return notify('err', r.reason ?? '삭제에 실패했습니다')
  if (editingId.value === v.contract.id) closeForm()
  notify('ok', withBackupHint('삭제되었습니다'))
}

function onToggleTerminated(v: ContractView) {
  const next = !v.contract.terminated
  if (next && !window.confirm(`'${v.contract.title}' 계약을 해지 처리할까요?`)) return
  const r = setTerminated(v.contract.id, next)
  if (!r.ok) return notify('err', r.reason ?? '처리에 실패했습니다')
  notify('ok', withBackupHint(next ? '해지 처리되었습니다' : '해지를 취소했습니다'))
}

// ── 표시 도우미 ──
const STATUS_CLASS: Record<ContractStatus, string> = {
  임박: 'pill-warn',
  진행중: 'pill-ok',
  예정: 'pill-info',
  만료: 'pill-muted',
  해지: 'pill-muted'
}

/** 'YYYY-MM-DD' → 'YYYY.MM.DD' (목록 표기용) */
function dot(ymd: string | null | undefined): string {
  return ymd ? ymd.replace(/-/g, '.') : ''
}

/** 입력 중인 금액의 한글 표기 (비었거나 숫자가 아니면 숨김) */
const amountKorean = computed(() => formatKoreanAmount(draft.amount))

/** 금액 한 줄 — "780,000원 / 연", 일시 결제는 "780,000원 (일시)" */
function amountText(v: ContractView): string {
  const c = v.contract
  if (c.amount === null) return '–'
  return c.cycle === '일시' ? `${formatKRW(c.amount)} (일시)` : `${formatKRW(c.amount)} / ${c.cycle}`
}

/** 진행 중인(해지·만료가 아닌) 계약인가 — 경고/강조는 이때만 */
function isLive(v: ContractView): boolean {
  return v.status !== '해지' && v.status !== '만료'
}

/**
 * 통보 기한 경고 문구. 지났으면 경고(warn), 30일 이내면 안내(info), 그 외 null.
 * 이미 지난 계약(해지·만료)에는 붙이지 않는다.
 */
function noticeNote(v: ContractView): { tone: 'warn' | 'info'; text: string } | null {
  if (!isLive(v) || !v.noticeDate || v.noticeDaysLeft === null) return null
  const d = dot(v.noticeDate)
  if (v.noticeDaysLeft < 0) return { tone: 'warn', text: `통보 기한 ${Math.abs(v.noticeDaysLeft)}일 경과 (${d})` }
  if (v.noticeDaysLeft === 0) return { tone: 'warn', text: `통보 기한 오늘 (${d})` }
  if (v.noticeDaysLeft <= DEFAULT_SOON_DAYS) return { tone: 'info', text: `통보 기한 ${v.noticeDaysLeft}일 남음 (${d})` }
  return null
}

/** 경과율 % (정수) */
function pct(v: ContractView): number {
  return v.progress === null ? 0 : Math.round(v.progress * 100)
}
</script>

<template>
  <div class="page-shell section-gap">
    <!-- 헤더 -->
    <div class="flex items-end justify-between flex-wrap gap-4">
      <div>
        <h2 class="text-[26px] font-extrabold tracking-tight text-slate-900">계약 관리</h2>
        <p class="text-[15px] text-slate-500 mt-1 max-w-[640px]">
          임대차·보험·통신·구독 등 계약의 기간과 갱신 기한을 한곳에서 관리합니다.
          종료일과 통보 기한이 다가오면 목록 위쪽에 먼저 보입니다.
        </p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/" class="btn-secondary">← 대시보드</NuxtLink>
        <button type="button" class="btn-primary" @click="openCreate">
          <svg viewBox="0 0 24 24" class="ico" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          계약 추가
        </button>
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

    <!-- 요약 KPI — 왼쪽 컬러 바로 성격을 구분 -->
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
      <div class="kpi kpi-blue">
        <div class="kpi-l">진행 중</div>
        <div class="kpi-v">{{ summary.active.toLocaleString('ko-KR') }}<small>건</small></div>
        <div class="kpi-n">전체 {{ summary.total.toLocaleString('ko-KR') }}건 등록</div>
      </div>
      <div class="kpi kpi-teal">
        <div class="kpi-l">월 환산 금액</div>
        <div class="kpi-v">{{ formatKRW(summary.monthlyTotal) }}</div>
        <div class="kpi-n">진행 중 계약 기준 · 일시 결제 제외</div>
      </div>
      <div :class="['kpi', summary.soon > 0 ? 'kpi-orange' : 'kpi-zero']">
        <div class="kpi-l">만료 임박</div>
        <div class="kpi-v">{{ summary.soon.toLocaleString('ko-KR') }}<small>건</small></div>
        <div class="kpi-n">통보 기한 또는 {{ DEFAULT_SOON_DAYS }}일 이내</div>
      </div>
      <div :class="['kpi', summary.noticeDue > 0 ? 'kpi-orange' : 'kpi-zero']">
        <div class="kpi-l">통보 기한 경과</div>
        <div class="kpi-v">{{ summary.noticeDue.toLocaleString('ko-KR') }}<small>건</small></div>
        <div class="kpi-n">갱신·해지 통보가 필요한 계약</div>
      </div>
    </section>

    <!-- 추가/편집 폼 -->
    <section v-if="formOpen" class="panel">
      <h3 class="panel-title">{{ editingId ? '계약 수정' : '새 계약 추가' }}</h3>
      <div class="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="sm:col-span-2">
          <label class="f-label" for="c-title">계약명 *</label>
          <input id="c-title" v-model="draft.title" type="text" placeholder="예: 전세 임대차계약" class="form-input mt-1" />
        </div>
        <div>
          <label class="f-label" for="c-cp">상대방</label>
          <input id="c-cp" v-model="draft.counterparty" type="text" placeholder="임대인·보험사·통신사" class="form-input mt-1" />
        </div>
        <div>
          <label class="f-label" for="c-kind">유형</label>
          <select id="c-kind" v-model="draft.kind" class="form-input mt-1">
            <option v-for="k in CONTRACT_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
        </div>

        <div>
          <label class="f-label" for="c-start">시작일</label>
          <input id="c-start" v-model="draft.startDate" type="date" class="form-input mt-1" />
        </div>
        <div>
          <label class="f-label" for="c-end">종료일</label>
          <input id="c-end" v-model="draft.endDate" type="date" class="form-input mt-1" />
          <p class="mt-1 text-xs text-slate-400">비워두면 무기한 계약으로 처리됩니다</p>
        </div>
        <div>
          <label class="f-label" for="c-amt">금액</label>
          <input id="c-amt" v-model="draft.amount" type="number" min="0" step="1000" placeholder="0" class="form-input mt-1 text-right tabular-nums" />
          <p v-if="amountKorean" class="mt-1 text-xs text-right text-slate-500" aria-live="polite">{{ amountKorean }}</p>
        </div>
        <div>
          <label class="f-label" for="c-cycle">결제 주기</label>
          <select id="c-cycle" v-model="draft.cycle" class="form-input mt-1">
            <option v-for="c in CONTRACT_CYCLES" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>

        <div>
          <label class="f-label" for="c-notice">통보 기한 (종료 N일 전)</label>
          <input id="c-notice" v-model="draft.noticeDays" type="number" min="0" step="1" placeholder="예: 60" class="form-input mt-1 text-right tabular-nums" />
        </div>
        <div class="flex items-end gap-5 min-h-[44px]">
          <label class="flex items-center gap-2 text-sm text-slate-700 select-none min-h-[44px]">
            <input v-model="draft.autoRenew" type="checkbox" class="rounded w-[18px] h-[18px]" />
            자동 갱신
          </label>
          <label class="flex items-center gap-2 text-sm text-slate-700 select-none min-h-[44px]">
            <input v-model="draft.terminated" type="checkbox" class="rounded w-[18px] h-[18px]" />
            해지됨
          </label>
        </div>
        <div class="sm:col-span-2">
          <label class="f-label" for="c-note">메모</label>
          <input id="c-note" v-model="draft.note" type="text" placeholder="특약·갱신 조건 등" class="form-input mt-1" />
        </div>
      </div>

      <p v-if="formError" class="mt-3 text-sm font-medium text-rose-600" role="alert">{{ formError }}</p>

      <div class="mt-4 flex gap-2">
        <button type="button" class="btn-primary" @click="onSubmit">
          {{ editingId ? '수정 저장' : '추가' }}
        </button>
        <button type="button" class="btn-secondary" @click="closeForm">취소</button>
      </div>
    </section>

    <!-- 필터 + 목록 -->
    <section class="panel">
      <h3 class="panel-title">계약 목록</h3>
      <p class="panel-desc">
        임박한 계약이 먼저, 이어서 종료일이 가까운 순으로 정렬됩니다.
        <span class="text-slate-400">· {{ filtered.length.toLocaleString('ko-KR') }}건 표시</span>
      </p>

      <div class="flex items-end justify-between gap-3 flex-wrap mb-3.5">
        <!-- 상태 칩 -->
        <div class="flex flex-wrap gap-2">
          <button
            v-for="s in STATUS_FILTERS"
            :key="s"
            type="button"
            :class="['status-chip', statusFilter === s ? 'is-active' : '']"
            :aria-pressed="statusFilter === s"
            @click="statusFilter = s"
          >
            {{ s }}
            <span class="status-chip-count">{{ countOf(s) }}</span>
          </button>
        </div>
        <div class="flex items-center gap-2.5 flex-wrap">
          <select v-model="kindFilter" class="tool-input" aria-label="유형 필터">
            <option value="전체">모든 유형</option>
            <option v-for="k in CONTRACT_KINDS" :key="k" :value="k">{{ k }}</option>
          </select>
          <input v-model="search" type="search" placeholder="계약명·상대방 검색" class="tool-input w-[220px]" aria-label="검색" />
        </div>
      </div>

      <!-- 목록 — 좁은 화면에서는 가로 스크롤 -->
      <div class="-mx-1 px-1 overflow-x-auto">
        <table class="tbl w-full min-w-[960px]">
          <colgroup>
            <col style="width: 6rem" />
            <col />
            <col style="width: 7rem" />
            <col style="width: 8.5rem" />
            <col style="width: 11rem" />
            <col style="width: 11rem" />
            <col style="width: 10rem" />
          </colgroup>
          <thead>
            <tr>
              <th>상태</th>
              <th>계약 · 상대방</th>
              <th>유형</th>
              <th>기간</th>
              <th class="text-right">금액</th>
              <th>남은 기간</th>
              <th class="text-right">관리</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="v in filtered"
              :key="v.contract.id"
              :class="[
                v.status === '임박' ? 'row-soon' : '',
                !isLive(v) ? 'row-done' : ''
              ]"
            >
              <td>
                <span :class="['pill', STATUS_CLASS[v.status]]">{{ v.status }}</span>
              </td>

              <td>
                <div class="nm">{{ v.contract.title }}</div>
                <div v-if="v.contract.counterparty" class="cp">{{ v.contract.counterparty }}</div>
                <div
                  v-if="noticeNote(v)"
                  :class="['notice', noticeNote(v)!.tone === 'warn' ? 'notice-warn' : 'notice-info']"
                >{{ noticeNote(v)!.text }}</div>
                <div v-if="v.contract.note" class="cp !text-slate-400 truncate max-w-[22rem]" :title="v.contract.note">
                  {{ v.contract.note }}
                </div>
              </td>

              <td>
                <span class="type">{{ v.contract.kind }}</span>
                <div v-if="v.contract.autoRenew" class="auto">자동갱신</div>
              </td>

              <td class="num text-[14px] text-slate-600">
                <template v-if="v.contract.startDate || v.contract.endDate">
                  <div>{{ dot(v.contract.startDate) || '–' }} ~</div>
                  <div>{{ v.contract.endDate ? dot(v.contract.endDate) : '무기한' }}</div>
                </template>
                <span v-else class="text-slate-400">–</span>
              </td>

              <td class="text-right num">
                <div class="amt">{{ amountText(v) }}</div>
                <div v-if="v.monthlyAmount !== null && v.contract.cycle !== '월'" class="cp">
                  월 환산 {{ formatKRW(Math.round(v.monthlyAmount)) }}
                </div>
              </td>

              <td>
                <template v-if="v.contract.endDate">
                  <div :class="['dd num', v.status === '임박' ? 'dd-soon' : !isLive(v) ? 'dd-done' : '']">
                    {{ formatDDay(v.daysLeft) }}
                  </div>
                  <div class="cp">{{ describeDays(v.daysLeft) }}</div>
                  <!-- 경과율 — 무기한 계약은 그리지 않는다 -->
                  <div
                    v-if="v.progress !== null"
                    :class="['prog', v.status === '임박' ? 'prog-soon' : '']"
                    role="progressbar"
                    :aria-valuenow="pct(v)"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="`계약 경과율 ${pct(v)}%`"
                  ><i :style="{ width: `${pct(v)}%` }" /></div>
                  <div v-if="v.progress !== null" class="pct">경과 {{ pct(v) }}%</div>
                </template>
                <div v-else class="dd dd-done">무기한</div>
              </td>

              <td>
                <div class="ops">
                  <button type="button" class="ib" aria-label="수정" title="수정" @click="openEdit(v)">
                    <svg viewBox="0 0 24 24" class="ico"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>
                  </button>
                  <button type="button" class="btn-sm" @click="onToggleTerminated(v)">
                    {{ v.contract.terminated ? '복구' : '해지' }}
                  </button>
                  <button type="button" class="ib ib-danger" aria-label="삭제" title="삭제" @click="onRemove(v)">
                    <svg viewBox="0 0 24 24" class="ico"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                  </button>
                </div>
              </td>
            </tr>

            <tr v-if="filtered.length === 0">
              <td colspan="7" class="!py-14 text-center">
                <svg width="34" height="26" viewBox="0 0 34 26" fill="none" class="mx-auto text-slate-200" aria-hidden="true">
                  <rect x="1" y="12" width="8" height="13" rx="2" fill="currentColor" />
                  <rect x="13" y="6" width="8" height="19" rx="2" fill="currentColor" />
                  <rect x="25" y="16" width="8" height="9" rx="2" fill="currentColor" />
                </svg>
                <p class="mt-2 text-sm text-slate-400">
                  {{ views.length === 0 ? '등록된 계약이 없습니다. 위 \'계약 추가\'로 시작하세요.' : '조건에 맞는 계약이 없습니다.' }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 사용 가이드 — 접고 펼 수 있다 -->
    <details class="panel guide" open>
      <summary>
        <svg viewBox="0 0 24 24" class="ico ic" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
        사용 가이드
        <svg viewBox="0 0 24 24" class="ico chev" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
      </summary>
      <ol>
        <li>통보 기한을 넣어두면 종료일에서 그만큼 앞당긴 날짜를 계산해 갱신·해지를 알려야 하는 시점을 따로 표시합니다.</li>
        <li>통보 기한을 넣지 않은 계약은 종료 {{ DEFAULT_SOON_DAYS }}일 전부터 '임박'으로 표시됩니다.</li>
        <li>월 환산 금액은 주기가 다른 계약을 나란히 비교하기 위한 값입니다. '일시' 결제는 반복 지출이 아니므로 합계에서 빠집니다.</li>
        <li>종료일을 비워두면 무기한 계약으로 처리되어 남은 기간·경과율을 계산하지 않습니다.</li>
        <li>해지는 날짜와 무관하게 종료로 취급합니다. 잘못 눌렀다면 '복구'로 되돌릴 수 있습니다.</li>
        <li>이 페이지의 데이터는 브라우저(localStorage)에 저장되며, 설정 화면의 백업·복원에 함께 포함됩니다.</li>
      </ol>
    </details>
  </div>
</template>

<style scoped>
/* 값은 Contracts.dc.html 목업의 inline style/helmet 값을 그대로 옮겼다 */

.ico { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }

/* ── 버튼 ── */
.btn-primary,
.btn-secondary {
  min-height: 44px;
  padding: 0 18px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}
.btn-primary { background: #1b55c9; border: 1px solid #1b55c9; color: #fff; }
.btn-primary:hover { background: #1749bf; }
.btn-secondary { background: #fff; border: 1px solid #cbd3e1; color: #141a24; }
.btn-secondary:hover { background: #f6f7fa; }
.btn-sm {
  min-height: 44px;
  padding: 0 12px;
  border-radius: 10px;
  border: 1px solid #cbd3e1;
  background: #fff;
  font-size: 14px;
  font-weight: 700;
  white-space: nowrap;
}
.btn-sm:hover { background: #f6f7fa; }
.ib {
  width: 44px; height: 44px;
  display: inline-grid; place-items: center;
  border: 0; background: transparent; border-radius: 10px; color: #8993a6;
}
.ib:hover { background: #f1f4f9; color: #3b4658; }
.ib-danger:hover { background: #fdecec; color: #c62828; }
:is(.btn-primary, .btn-secondary, .btn-sm, .ib, .status-chip):focus-visible,
:is(.form-input, .tool-input):focus-visible { outline: 2px solid #1b55c9; outline-offset: 2px; }

/* ── KPI ── */
.kpi {
  position: relative; overflow: hidden;
  background: #fff; border: 1px solid #e3e8f0; border-radius: 16px;
  padding: 18px 20px 18px 24px;
  --accent: #1b55c9; --accent-ink: #123a8a;
}
.kpi::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 5px; background: var(--accent); }
.kpi-teal   { --accent: #0f766e; --accent-ink: #0f766e; }
.kpi-orange { --accent: #d9540f; --accent-ink: #8a3306; }
.kpi-zero   { --accent: #cbd3e1; --accent-ink: #8993a6; } /* 해당 건이 없으면 경고색을 쓰지 않는다 */
.kpi-l { color: #566074; font-weight: 700; font-size: 13px; }
.kpi-v { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-top: 2px; font-variant-numeric: tabular-nums; color: var(--accent-ink); line-height: 1.3; }
.kpi-v small { font-size: 16px; font-weight: 700; margin-left: 2px; }
.kpi-n { color: #8993a6; font-size: 13px; margin-top: 2px; }

/* ── 패널 ── */
.panel { background: #fff; border: 1px solid #e3e8f0; border-radius: 16px; padding: 22px; }
.panel-title { font-size: 17px; font-weight: 700; margin: 0; color: #141a24; }
.panel-desc { color: #566074; font-size: 13px; margin: 2px 0 16px; }

/* ── 폼 ── */
.f-label { display: block; font-size: 13px; font-weight: 700; color: #566074; }
.form-input {
  width: 100%; min-height: 44px; border-radius: 10px; border: 1px solid #cbd3e1;
  padding: 0 12px; font-size: 15px; background: #fff;
}
.form-input:focus { border-color: #1b55c9; --tw-ring-color: #1b55c9; }
.tool-input {
  height: 44px; border: 1px solid #cbd3e1; border-radius: 10px; padding: 0 12px;
  background: #fff; font-size: 15px;
}

/* ── 상태 칩 ── */
.status-chip {
  min-height: 44px; padding: 0 14px; border-radius: 999px;
  border: 1px solid #e3e8f0; background: #fff;
  font-size: 15px; font-weight: 700; color: #566074;
  display: inline-flex; align-items: center; gap: 8px;
}
.status-chip:hover { background: #f6f7fa; }
.status-chip.is-active { background: #e8f0fd; border-color: #b9cbef; color: #123a8a; }
.status-chip-count {
  font-size: 12.5px; background: #edf0f6; border-radius: 999px;
  padding: 0 8px; min-width: 24px; text-align: center; font-variant-numeric: tabular-nums;
}
.status-chip.is-active .status-chip-count { background: #fff; }

/* ── 테이블 ── */
.tbl { border-collapse: collapse; table-layout: fixed; }
.tbl th {
  font-size: 13px; color: #566074; text-align: left; padding: 10px 12px;
  border-bottom: 1px solid #e3e8f0; font-weight: 700; white-space: nowrap;
}
.tbl th.text-right { text-align: right; }
.tbl td { padding: 14px 12px; border-bottom: 1px solid #eef1f6; vertical-align: middle; }
.tbl tr:last-child td { border-bottom: 0; }
.tbl tbody tr:hover td { background: #f9fafc; }
.tbl tr.row-soon td { background: #fffaf6; }
.tbl tr.row-soon:hover td { background: #fff3ea; }
.tbl tr.row-done td { color: #8993a6; }
.tbl tr.row-done .nm { color: #566074; }
.num { font-variant-numeric: tabular-nums; }

.nm { font-weight: 700; font-size: 15.5px; color: #141a24; }
.cp { color: #566074; font-size: 13px; }
.notice { margin-top: 4px; font-size: 13px; font-weight: 700; }
.notice-warn { color: #8a3306; }
.notice-info { color: #566074; font-weight: 500; }
.amt { font-weight: 800; color: #141a24; }
.dd { font-weight: 800; font-size: 16px; color: #141a24; }
.dd-soon { color: #8a3306; }
.dd-done { color: #8993a6; font-weight: 700; }
.pct { font-size: 12.5px; color: #8993a6; }
.prog { height: 6px; width: 150px; max-width: 100%; border-radius: 999px; background: #edf0f6; margin-top: 6px; overflow: hidden; }
.prog i { display: block; height: 100%; background: #1b55c9; border-radius: 999px; transition: width 0.3s ease; }
.prog-soon i { background: #d9540f; }
.ops { display: flex; gap: 4px; justify-content: flex-end; align-items: center; }

/* 상태 배지 — 색만으로 말하지 않도록 글자를 항상 함께 적는다 */
.pill { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; white-space: nowrap; }
.pill-warn  { background: #fdeee5; color: #8a3306; }
.pill-ok    { background: #e1f4f1; color: #0f766e; }
.pill-info  { background: #e8f0fd; color: #123a8a; }
.pill-muted { background: #edf0f6; color: #566074; }

.type {
  display: inline-block; font-size: 13px; font-weight: 700; color: #566074;
  background: #f4f6fa; border: 1px solid #e3e8f0; border-radius: 8px; padding: 1px 8px;
}
.auto { margin-top: 4px; font-size: 12px; font-weight: 700; color: #1b55c9; }

/* ── 가이드 ── */
.guide { padding: 0; }
.guide summary {
  list-style: none; display: flex; align-items: center; gap: 12px;
  min-height: 60px; padding: 0 22px; font-weight: 700; font-size: 17px; cursor: pointer;
}
.guide summary::-webkit-details-marker { display: none; }
.guide summary .ic { width: 20px; height: 20px; color: #1b55c9; }
.guide summary .chev { width: 20px; height: 20px; margin-left: auto; color: #8993a6; transition: transform 0.15s ease; }
.guide[open] summary .chev { transform: rotate(90deg); }
.guide ol { margin: 0; padding: 0 22px 20px; list-style: none; counter-reset: g; display: grid; gap: 10px; }
.guide li { counter-increment: g; display: flex; gap: 12px; color: #566074; font-size: 14.5px; }
.guide li::before {
  content: counter(g); flex: none; width: 24px; height: 24px; border-radius: 8px;
  background: #e8f0fd; color: #123a8a; font-weight: 800; font-size: 13px;
  display: grid; place-items: center; margin-top: 1px;
}

@media (max-width: 640px) {
  .panel { padding: 16px; }
  .kpi-v { font-size: 22px; }
  .tool-input { width: 100% !important; }
}
</style>
