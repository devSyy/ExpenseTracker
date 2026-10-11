<script setup lang="ts">
// 지출 목표 · 추이 — 월 목표 하나로 분기·반기·연 목표를 만들고, 목표 대비 진행과 기간별 추이를 본다.
// 지출 합계는 대시보드 KPI와 같은 규칙으로 집계한다 (지출제외·환불 상계·이체·저축 제외).
import { computed, reactive, ref } from 'vue'
import { useSpendingGoals } from '~/composables/useSpendingGoals'
import { formatKRW, formatKoreanAmount } from '~/utils/format'
import {
  GOAL_MONTHS,
  currentPeriod,
  periodStatus,
  startOfDay,
  targetFor,
  type GoalUnit,
  type SpendingGoals
} from '~/utils/spendingGoals'

useHead({ title: '지출 목표/추이 · 가계부' })

const { dayMap, firstYear, hasData, savedGoals, saveGoals } = useSpendingGoals()
const today = startOfDay(new Date())

type OvUnit = 'quarter' | 'half' | 'year'
const OV_ROWS: { unit: OvUnit; name: string }[] = [
  { unit: 'quarter', name: '분기 (월 × 3)' },
  { unit: 'half', name: '반기 (월 × 6)' },
  { unit: 'year', name: '연 (월 × 12)' }
]

// ── 설정 초안 (저장 전까지는 화면 미리보기에만 쓰인다) ──
const draft = reactive({
  monthly: '' as number | '',
  manual: { quarter: false, half: false, year: false } as Record<OvUnit, boolean>,
  value: { quarter: '', half: '', year: '' } as Record<OvUnit, number | ''>
})

function loadDraft(g: SpendingGoals) {
  draft.monthly = g.monthly > 0 ? g.monthly : ''
  for (const { unit } of OV_ROWS) {
    const v = g.overrides[unit]
    draft.manual[unit] = v != null && v > 0
    draft.value[unit] = v != null && v > 0 ? v : ''
  }
}
loadDraft(savedGoals())

const effective = computed<SpendingGoals>(() => {
  const m = Number(draft.monthly) || 0
  const ov = (u: OvUnit) => (draft.manual[u] && Number(draft.value[u]) > 0 ? Number(draft.value[u]) : null)
  return { monthly: m > 0 ? m : 0, overrides: { quarter: ov('quarter'), half: ov('half'), year: ov('year') } }
})

const dirty = computed(() => JSON.stringify(effective.value) !== JSON.stringify(savedGoals()))
const monthlyKorean = computed(() => (Number(draft.monthly) > 0 ? formatKoreanAmount(Number(draft.monthly)) : ''))
const MONTHLY_CHIPS = [1500000, 2000000, 2500000, 3000000]

function toggleManual(u: OvUnit) {
  // 체크하는 순간 현재 자동값을 입력칸에 채워 두면 "조금만 고치기"가 쉽다
  if (draft.manual[u] && draft.value[u] === '') draft.value[u] = Math.round((Number(draft.monthly) || 0) * GOAL_MONTHS[u]) || ''
}
function resetOverrides() {
  for (const { unit } of OV_ROWS) { draft.manual[unit] = false; draft.value[unit] = '' }
  flash('ok', '분기·반기·연 목표를 자동값으로 되돌렸습니다 (저장 전)')
}

const toast = ref<{ kind: 'ok' | 'err'; text: string } | null>(null)
let toastTimer: number | undefined
function flash(kind: 'ok' | 'err', text: string) {
  toast.value = { kind, text }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 3000) as unknown as number
}
function onSave() {
  if (saveGoals(effective.value)) flash('ok', '지출 목표를 저장했습니다')
  else flash('err', '저장에 실패했습니다 (브라우저 저장 공간을 확인하세요)')
}

// ── 진행 카드 ──
const CARD_DEFS: { unit: GoalUnit; name: string }[] = [
  { unit: 'month', name: '이번 달' },
  { unit: 'quarter', name: '이번 분기' },
  { unit: 'half', name: '이번 반기' },
  { unit: 'year', name: '올해' }
]
const won = (n: number) => formatKRW(Math.round(n))
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatKRW(Math.abs(Math.round(n)))}`

const cards = computed(() =>
  CARD_DEFS.map(({ unit, name }) => {
    const p = currentPeriod(unit, dayMap.value, today)
    const target = targetFor(effective.value, unit)
    const st = periodStatus(p, target)
    const pct = target ? p.total / target : 0
    const left = p.days - p.elapsed
    const remain = target - p.total
    const perDay = Math.max(0, remain) / Math.max(1, left)
    let msg = ''
    if (target) {
      if (st === 'over') msg = `▲ 목표 초과 ${signed(p.total - target)}`
      else if (st === 'warn') msg = `▲ 페이스 초과 ${signed(p.total - target * p.ratio)} · 남은 ${left}일, 하루 ${won(perDay)} 이하`
      else msg = `✓ 페이스 여유 ${won(target * p.ratio - p.total)} · 남은 ${left}일, 하루 ${won(perDay)} 사용 가능`
    }
    return { unit, name, p, target, st, pct, msg, pace: target * p.ratio }
  })
)
const stClass = { over: 'text-rose-700', warn: 'text-amber-700', prog: 'text-emerald-700', ok: 'text-emerald-700', none: 'text-slate-400' } as const
const barClass = { over: 'bg-rose-600', warn: 'bg-amber-400', prog: 'bg-brand-600', ok: 'bg-brand-600', none: 'bg-brand-600' } as const
</script>

<template>
  <div class="page-shell section-gap">
    <div class="flex items-center justify-between flex-wrap gap-3">
      <h2 class="text-2xl font-bold text-slate-900">지출 목표/추이</h2>
      <nav class="text-xs text-slate-400 flex items-center gap-1.5">
        <NuxtLink to="/" class="hover:text-slate-700">홈</NuxtLink>
        <span>›</span>
        <span class="text-slate-700 font-medium">지출 목표/추이</span>
      </nav>
    </div>

    <transition name="toast-drop">
      <div
        v-if="toast"
        :class="[
          'fixed top-6 inset-x-0 mx-auto w-fit text-center z-50 px-4 py-2 rounded-lg shadow text-sm whitespace-pre-line max-w-sm leading-relaxed',
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        ]"
        role="status"
      >{{ toast.text }}</div>
    </transition>

    <p class="text-sm text-slate-500">
      전체 지출 합계 기준입니다. 지출제외 카테고리·환불 상계·이체·저축은 대시보드 KPI와 같은 규칙으로 이미 빠집니다.
      가족 멤버 선택과 숨김 카테고리는 따르지만, 대시보드의 기간·카테고리·결제수단 필터는 적용되지 않습니다.
    </p>

    <!-- ① 목표 설정 -->
    <section class="card" aria-labelledby="goal-set">
      <div class="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h3 id="goal-set" class="font-semibold text-slate-900">지출 목표 설정</h3>
          <p class="text-xs text-slate-500 mt-0.5">월 목표만 입력하면 분기·반기·연 목표는 자동 계산됩니다. 필요한 기간만 직접 덮어쓸 수 있습니다.</p>
        </div>
        <span v-if="dirty" class="text-xs font-semibold text-amber-700 bg-amber-50 rounded-full px-2.5 py-1">저장되지 않은 변경</span>
      </div>

      <div class="mt-4 grid gap-6 md:grid-cols-2">
        <div>
          <label for="goal-monthly" class="block text-sm font-semibold text-slate-700">월 목표 지출</label>
          <div class="mt-1.5 flex items-center rounded-lg border border-slate-200 focus-within:border-brand-500 focus-within:ring-2 focus-within:ring-brand-100">
            <input
              id="goal-monthly"
              v-model.number="draft.monthly"
              type="number" min="0" step="10000" inputmode="numeric"
              class="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-right text-lg font-bold tabular-nums outline-none"
              placeholder="0"
            />
            <span class="pr-3 text-slate-500">원</span>
          </div>
          <p class="mt-1 min-h-[1.25rem] text-right text-xs text-slate-500" aria-live="polite">{{ monthlyKorean }}</p>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button
              v-for="v in MONTHLY_CHIPS"
              :key="v"
              type="button"
              class="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-brand-500 hover:text-brand-700"
              @click="draft.monthly = v"
            >{{ v / 10000 }}만원</button>
          </div>
          <p class="mt-3 text-xs text-slate-400">비우거나 0이면 목표 미설정 — 카드와 차트에서 목표 표시가 사라집니다.</p>
        </div>

        <div>
          <table class="w-full text-sm tabular-nums">
            <thead>
              <tr class="text-xs text-slate-500">
                <th class="py-2 text-left font-semibold">기간</th>
                <th class="py-2 text-right font-semibold">목표</th>
                <th class="py-2 text-right font-semibold">직접 입력</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-t border-slate-100">
                <td class="py-2">월</td>
                <td class="py-2 text-right">{{ effective.monthly ? won(effective.monthly) : '–' }}</td>
                <td class="py-2 text-right text-slate-400">기준값</td>
              </tr>
              <tr v-for="r in OV_ROWS" :key="r.unit" class="border-t border-slate-100">
                <td class="py-2">{{ r.name }}</td>
                <td class="py-2 text-right">{{ targetFor(effective, r.unit) ? won(targetFor(effective, r.unit)) : '–' }}</td>
                <td class="py-2 text-right whitespace-nowrap">
                  <input
                    v-model="draft.manual[r.unit]"
                    type="checkbox"
                    :aria-label="`${r.name} 직접 입력`"
                    @change="toggleManual(r.unit)"
                  />
                  <input
                    v-model.number="draft.value[r.unit]"
                    type="number" min="0" step="100000"
                    :disabled="!draft.manual[r.unit]"
                    :aria-label="`${r.name} 목표 금액`"
                    class="ml-1.5 w-28 rounded-md border border-slate-200 px-2 py-1 text-right disabled:bg-slate-100 disabled:text-slate-400"
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="btn-secondary" @click="resetOverrides">자동값으로 되돌리기</button>
            <button type="button" class="btn-primary" :disabled="!dirty" @click="onSave">저장</button>
          </div>
        </div>
      </div>
    </section>

    <!-- ② 목표 대비 지출 -->
    <section class="card" aria-labelledby="goal-prog">
      <h3 id="goal-prog" class="font-semibold text-slate-900">목표 대비 지출</h3>
      <p class="text-xs text-slate-500 mt-0.5">검은 눈금은 오늘 기준 <b>페이스</b>(경과 기간 비율만큼 쓴 금액)입니다. 눈금보다 오른쪽이면 앞서 쓰고 있다는 뜻입니다.</p>
      <div class="mt-4 grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <div v-for="c in cards" :key="c.unit" class="rounded-xl border border-slate-200 p-4">
          <div class="flex justify-between text-xs font-bold text-slate-600">
            <span>{{ c.name }}</span>
            <span>{{ c.target ? Math.round(c.pct * 100) + '%' : '' }}</span>
          </div>
          <div class="mt-1 text-xl font-extrabold tabular-nums text-slate-900">{{ won(c.p.total) }}</div>
          <div class="text-xs text-slate-500 tabular-nums">{{ c.target ? `목표 ${won(c.target)}` : '목표 미설정' }}</div>
          <template v-if="c.target">
            <div class="relative mt-3 mb-1.5 h-2.5 rounded-full bg-slate-100">
              <div :class="['absolute inset-y-0 left-0 rounded-full', barClass[c.st]]" :style="{ width: Math.min(100, c.pct * 100) + '%' }" />
              <div
                class="absolute -top-1 -bottom-1 w-0.5 rounded bg-slate-900"
                :style="{ left: `calc(${c.p.ratio * 100}% - 1px)` }"
                :title="`페이스 ${won(c.pace)}`"
              />
            </div>
            <div class="flex justify-between text-[11px] text-slate-400 tabular-nums">
              <span>경과 {{ c.p.elapsed }}/{{ c.p.days }}일</span>
              <span>페이스 {{ won(c.pace) }}</span>
            </div>
            <p :class="['mt-2 text-xs font-semibold', stClass[c.st]]">{{ c.msg }}</p>
          </template>
          <p v-else class="mt-3 text-xs text-slate-400">위에서 월 목표를 입력하세요</p>
        </div>
      </div>
    </section>

    <!-- ③ 지출 추이 -->
    <ChartsSpendingTrendChart :goals="effective" :day-map="dayMap" :first-year="firstYear" :today="today" />

    <p v-if="!hasData" class="text-xs text-slate-400">대시보드에서 엑셀을 업로드하면 실제 지출이 카드와 차트에 반영됩니다.</p>
  </div>
</template>
