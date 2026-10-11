<script setup lang="ts">
// 저축 비율 카드 — 수입 중 저축으로 빠진 비율 (저축 ÷ 수입).
// useExpenses().savingsRate 와 같은 값이고, 수입지출 흐름의 '총저축 · 수입의 N%'와 일치한다.
// 전역 필터(연·월·가족)를 그대로 따르며, 연/월이 지정돼 있으면 직전 기간 비율과 비교한다.
import { computed } from 'vue'
import { useExpenses } from '~/composables/useExpenses'
import { useFlowSummary } from '~/composables/useFlowSummary'
import { formatKRW, formatPercent } from '~/utils/format'

const { periodComparison } = useExpenses()
// 순수지 Hero · 수입은 어디로 갔나 · 흐름과 같은 값(저축 ÷ 수입)을 쓴다
const { income: incomeTotal, savings: savingsTotal, savingsRate } = useFlowSummary()

const rate = computed<number | null>(() => (savingsRate.value === null ? null : savingsRate.value * 100))
// 저축이 수입을 넘을 수 있으므로(예: 적금 해지 후 재예치) 게이지는 0~100%로 자른다
const meterPct = computed(() => (rate.value === null ? 0 : Math.min(100, Math.max(0, rate.value))))

const prevName = computed(() => (periodComparison.value.unit === 'month' ? '지난달' : '지난해'))
const prev = computed(() => {
  const p = periodComparison.value.previous
  if (!p || p.income <= 0) return null
  return { label: p.label, rate: (p.savings / p.income) * 100 }
})
const diff = computed<number | null>(() => (rate.value !== null && prev.value ? rate.value - prev.value.rate : null))
</script>

<template>
  <section class="card">
    <h3 class="font-semibold text-slate-900 text-base">저축 비율</h3>

    <template v-if="rate !== null">
      <div class="mt-2 flex items-baseline flex-wrap gap-x-3 gap-y-1">
        <span class="text-5xl font-black tracking-tight tabular-nums text-slate-900">{{ formatPercent(rate) }}</span>
        <span class="text-sm text-slate-500">
          수입 {{ formatKRW(incomeTotal) }} 중 {{ formatKRW(savingsTotal) }}
        </span>
      </div>

      <div
        class="mt-3 h-5 rounded-lg bg-slate-100 overflow-hidden"
        role="meter" aria-label="저축 비율" :aria-valuenow="meterPct" aria-valuemin="0" aria-valuemax="100"
      >
        <div class="h-5 rounded-lg bg-teal-600 min-w-[4px]" :style="{ width: meterPct + '%' }"></div>
      </div>
      <div class="mt-1 flex justify-between text-[11px] text-slate-400"><span>0%</span><span>100%</span></div>

      <div v-if="prev && diff !== null" class="mt-3 text-xs text-slate-500">
        {{ prevName }}({{ prev.label }}) {{ formatPercent(prev.rate) }}
        <span :class="['ml-1 font-semibold', diff >= 0 ? 'text-teal-700' : 'text-rose-600']">
          {{ diff >= 0 ? '▲' : '▼' }} {{ formatPercent(Math.abs(diff)) }}p
        </span>
      </div>
    </template>
    <div v-else class="mt-3 text-sm text-slate-400">
      이 기간에 수입 거래가 없어 저축 비율을 계산할 수 없습니다.
    </div>
  </section>
</template>
