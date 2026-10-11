<script setup lang="ts">
// 수입은 어디로 갔나 — 수입 100%를 지출 · 저축 · 남은 금액으로 나눈 누적 막대.
// 남은 금액 = 수입 − 지출 − 저축 (역산). 음수(수입보다 많이 씀)면 '부족 금액'으로 바꿔 보여준다.
import { computed } from 'vue'
import { useFlowSummary } from '~/composables/useFlowSummary'
import { formatKRW, formatPercent } from '~/utils/format'

const { income, expense, savings, remaining, allocation } = useFlowSummary()

const hasIncome = computed(() => income.value > 0)
const pct = (v: number) => (income.value > 0 ? (v / income.value) * 100 : 0)

// 막대는 수입 안에서 실제로 채워진 몫만 그린다 (초과분은 막대 밖, 아래 '부족 금액'으로 표시)
const segments = computed(() => [
  { key: 'out', w: pct(allocation.value.outFromIn), color: 'bg-orange-600' },
  { key: 'sav', w: pct(allocation.value.savFromIn), color: 'bg-teal-700' },
  { key: 'rem', w: pct(allocation.value.remainFromIn), color: 'bg-slate-400' }
])

const rows = computed(() => [
  { key: 'out', label: '지출', amount: expense.value, share: pct(expense.value), dot: 'bg-orange-600' },
  { key: 'sav', label: '저축 (지정)', amount: savings.value, share: pct(savings.value), dot: 'bg-teal-700' },
  remaining.value >= 0
    ? { key: 'rem', label: '남은 금액', amount: remaining.value, share: pct(remaining.value), dot: 'bg-slate-400' }
    : { key: 'rem', label: '부족 금액', amount: remaining.value, share: pct(remaining.value), dot: 'bg-rose-500' }
])
const fmtAmount = (v: number) => (v < 0 ? '−' : '') + formatKRW(Math.abs(v))
</script>

<template>
  <section class="card flex flex-col gap-4">
    <div class="flex items-baseline justify-between flex-wrap gap-2">
      <h3 class="text-base font-bold text-slate-900">수입은 어디로 갔나</h3>
      <span v-if="hasIncome" class="text-xs text-slate-500">수입 {{ formatKRW(income) }} = 100%</span>
    </div>

    <template v-if="hasIncome">
      <div class="flex h-7 rounded-[10px] overflow-hidden gap-0.5 bg-slate-100" role="img"
           :aria-label="`수입 대비 지출 ${formatPercent(pct(expense))}, 저축 ${formatPercent(pct(savings))}, 남은 금액 ${formatPercent(pct(remaining))}`">
        <div v-for="s in segments" :key="s.key" :class="s.color" :style="{ width: s.w + '%' }"></div>
      </div>

      <div class="flex flex-col gap-2.5 text-[15px]">
        <div v-for="r in rows" :key="r.key" class="flex items-center justify-between gap-2">
          <span class="inline-flex items-center"><i :class="['inline-block w-2.5 h-2.5 rounded-[3px] mr-1.5', r.dot]"></i>{{ r.label }}</span>
          <span class="tabular-nums">
            <b :class="r.amount < 0 ? 'text-rose-600' : ''">{{ fmtAmount(r.amount) }}</b>
            <span class="text-slate-500"> · {{ formatPercent(r.share) }}</span>
          </span>
        </div>
      </div>
      <div class="text-xs text-slate-500">남은 금액 = 수입 − 지출 − 저축 (역산)</div>
    </template>
    <div v-else class="text-sm text-slate-400 py-6">이 기간에 수입 거래가 없어 배분을 계산할 수 없습니다.</div>
  </section>
</template>
