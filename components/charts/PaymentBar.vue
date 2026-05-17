<script setup lang="ts">
import { computed } from 'vue'
import { Bar } from 'vue-chartjs'
import { useExpenses } from '~/composables/useExpenses'
import { bucketByPayment } from '~/utils/aggregate'
import { formatKRW, formatKRWCompact } from '~/utils/format'
import { pickColors } from '~/utils/palette'

const { filtered } = useExpenses()
const rows = computed(() => bucketByPayment(filtered.value))

const chartData = computed(() => ({
  labels: rows.value.map((r) => r.method),
  datasets: [
    {
      label: '지출',
      data: rows.value.map((r) => r.total),
      backgroundColor: pickColors(rows.value.length),
      borderRadius: 6,
      maxBarThickness: 28
    }
  ]
}))

const chartOptions = computed(() => ({
  indexAxis: 'y' as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        label: (ctx: any) => ` ${formatKRW(ctx.parsed.x)}`
      }
    }
  },
  scales: {
    x: {
      ticks: { callback: (v: number | string) => formatKRWCompact(Number(v)) },
      grid: { color: '#f1f5f9' }
    },
    y: { grid: { display: false } }
  }
}))
</script>

<template>
  <section class="card">
    <h3 class="font-semibold text-slate-900">결제수단별 지출</h3>
    <p class="text-xs text-slate-500 mb-3">롯데·삼성·지역화폐·신한체크·토스공유1/2</p>
    <div class="h-chart-md xl:h-chart-lg">
      <Bar v-if="rows.length" :data="chartData" :options="chartOptions" />
      <div v-else class="h-full grid place-items-center text-sm text-slate-400">데이터가 없습니다.</div>
    </div>
  </section>
</template>
