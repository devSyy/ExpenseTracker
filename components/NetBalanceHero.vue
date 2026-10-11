<script setup lang="ts">
// 순수지 Hero — 수입 − 지출. 저축은 빼지 않고, 아래 문구에서 저축을 지정하고도 남았는지를 말해 준다.
import { computed } from 'vue'
import { useFlowSummary } from '~/composables/useFlowSummary'
import { formatKRW, formatPercent } from '~/utils/format'

const { periodLabel, income, expense, savings, net, remaining, expenseRate, incomeCount } = useFlowSummary()

const surplus = computed(() => net.value >= 0)
const signedNet = computed(() => (net.value >= 0 ? '+' : '−') + formatKRW(Math.abs(net.value)))

const note = computed(() => {
  if (income.value <= 0) return '이 기간에 수입 거래가 없어 지출 비율을 계산할 수 없습니다.'
  if (net.value < 0) return `지출이 수입보다 ${formatKRW(-net.value)} 많아 적자입니다.`
  const rate = formatPercent((expenseRate.value ?? 0) * 100)
  if (savings.value <= 0) return `지출은 수입의 ${rate}이고, ${formatKRW(remaining.value)}가 남았습니다.`
  return remaining.value >= 0
    ? `지출은 수입의 ${rate}이고, 저축 ${formatKRW(savings.value)}을 지정하고도 ${formatKRW(remaining.value)}가 남았습니다.`
    : `지출은 수입의 ${rate}이지만, 저축 ${formatKRW(savings.value)}을 지정하면 ${formatKRW(-remaining.value)}가 모자랍니다.`
})
</script>

<template>
  <section class="rounded-2xl bg-[#101826] text-white p-6 sm:p-8 flex flex-col gap-4">
    <div class="text-sm font-medium text-slate-300">{{ periodLabel }} 순수지 (수입 − 지출)</div>
    <div class="flex items-baseline gap-3 flex-wrap">
      <span
        :class="['font-black tabular-nums leading-none tracking-tight text-[clamp(2.25rem,1.6rem+2.6vw,3.75rem)]',
                 surplus ? 'text-[#7EE0D0]' : 'text-[#FFB48A]']"
      >{{ signedNet }}</span>
      <span
        :class="['text-xs font-bold px-3 py-1 rounded-full text-[#101826]', surplus ? 'bg-[#7EE0D0]' : 'bg-[#FFB48A]']"
      >{{ surplus ? '흑자' : '적자' }}</span>
    </div>
    <div class="flex flex-wrap gap-x-7 gap-y-2 text-sm text-slate-300">
      <div class="flex flex-col"><span>총 수입</span><b class="text-xl text-white tabular-nums">{{ formatKRW(income) }}</b></div>
      <div class="flex flex-col"><span>총 지출</span><b class="text-xl text-white tabular-nums">{{ formatKRW(expense) }}</b></div>
      <div class="flex flex-col"><span>수입 거래</span><b class="text-xl text-white tabular-nums">{{ incomeCount.toLocaleString('ko-KR') }}건</b></div>
    </div>
    <p class="text-sm leading-relaxed text-slate-300 border-t border-[#36405A] pt-3.5">{{ note }}</p>
  </section>
</template>
