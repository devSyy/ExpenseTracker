<script setup lang="ts">
import { computed } from 'vue'
import { useExpenses } from '~/composables/useExpenses'
import { bucketByCategory } from '~/utils/aggregate'
import { formatKRW, formatPercent } from '~/utils/format'
import { pickColors } from '~/utils/palette'

const { filtered } = useExpenses()
const rows = computed(() => bucketByCategory(filtered.value).slice(0, 10))
const colors = computed(() => pickColors(rows.value.length))
</script>

<template>
  <section class="card">
    <h3 class="font-semibold text-slate-900">카테고리 TOP 10</h3>
    <p class="text-xs text-slate-500 mb-4">지출 비중이 큰 순서</p>
    <ul class="space-y-3">
      <li v-for="(r, i) in rows" :key="r.category">
        <div class="flex items-center justify-between text-sm">
          <span class="font-medium text-slate-800">{{ i + 1 }}. {{ r.category }}</span>
          <span class="tabular-nums text-slate-900">{{ formatKRW(r.total) }}</span>
        </div>
        <div class="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            class="h-full rounded-full"
            :style="{ width: `${Math.max(r.share * 100, 2)}%`, background: colors[i] }"
          />
        </div>
        <div class="mt-1 text-xs text-slate-500 flex justify-between">
          <span>{{ r.count.toLocaleString('ko-KR') }}건</span>
          <span>{{ formatPercent(r.share * 100) }}</span>
        </div>
      </li>
      <li v-if="rows.length === 0" class="text-sm text-slate-400">데이터가 없습니다.</li>
    </ul>
  </section>
</template>
