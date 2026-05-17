<script setup lang="ts">
import { computed, ref } from 'vue'
import { Bar } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { bucketByPeriod } from '~/utils/aggregate'
import { formatKRWCompact, formatKRW } from '~/utils/format'
import type { PeriodKind } from '~/utils/types'

const kind = ref<PeriodKind>('monthly')
const labels: Record<PeriodKind, string> = {
  weekly: '주간',
  monthly: '월별',
  quarterly: '분기별',
  semiannual: '반기별',
  yearly: '연도별'
}
const periodOptions: PeriodKind[] = ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']

const { filtered } = useExpenses()
const buckets = computed(() => bucketByPeriod(filtered.value, kind.value))

const chartData = computed(() => ({
  labels: buckets.value.map((b) => b.label),
  datasets: [
    {
      label: '고정비',
      data: buckets.value.map((b) => b.fixed),
      backgroundColor: '#1a5eeb',
      stack: 'total',
      borderRadius: 4,
      maxBarThickness: 36
    },
    {
      label: '변동비',
      data: buckets.value.map((b) => b.variable),
      backgroundColor: '#f59e0b',
      stack: 'total',
      borderRadius: 4,
      maxBarThickness: 36
    }
  ]
}))

const chartOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'bottom' as const },
    tooltip: {
      callbacks: {
        label: (ctx: any) => `${ctx.dataset.label}: ${formatKRW(ctx.parsed.y)}`
      }
    }
  },
  scales: {
    x: { stacked: true, grid: { display: false } },
    y: {
      stacked: true,
      ticks: { callback: (v: number | string) => formatKRWCompact(Number(v)) },
      grid: { color: '#f1f5f9' }
    }
  }
}))
</script>

<template>
  <section class="card">
    <div class="flex items-center justify-between mb-4 flex-wrap gap-2">
      <div>
        <h3 class="font-semibold text-slate-900">{{ labels[kind] }} 지출 추이</h3>
        <p class="text-xs text-slate-500">고정비(파랑)와 변동비(주황)로 누적</p>
      </div>
      <div class="flex gap-1 text-xs">
        <button
          v-for="k in periodOptions"
          :key="k"
          type="button"
          :class="[
            'px-2.5 py-1 rounded-md border',
            kind === k
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
          ]"
          @click="kind = k"
        >
          {{ labels[k] }}
        </button>
      </div>
    </div>
    <!-- 차트 높이: 고정 px 대신 viewport 비례. 작은 화면에선 220px, 4K에선 480px까지 확장 -->
    <div class="h-chart-md xl:h-chart-lg">
      <Bar v-if="buckets.length" :data="chartData" :options="chartOptions" />
      <div v-else class="h-full grid place-items-center text-sm text-slate-400">
        선택된 필터에 해당하는 데이터가 없습니다.
      </div>
    </div>
  </section>
</template>
