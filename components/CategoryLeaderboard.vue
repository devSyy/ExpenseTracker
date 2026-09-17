<script setup lang="ts">
// 카테고리 TOP 10 — 미터(진행바) 목록.
// 집계는 utils/aggregate.bucketByCategory()가 그대로 담당한다(계산 변경 없음).
//
// 예전에는 막대마다 다른 색을 줬는데, 색이 **순위**에 붙어 있어서 기간 필터로 순위가
// 흔들리면 같은 카테고리의 색이 매번 달라졌다. 순위 목록은 길이가 이미 크기를 말하므로
// 막대는 한 가지 색으로 통일하고, 빈 트랙은 같은 계열의 밝은 단계를 쓴다.
import { computed } from 'vue'
import { useExpenses } from '~/composables/useExpenses'
import { bucketByCategory } from '~/utils/aggregate'
import { formatKRW, formatPercent } from '~/utils/format'
import { SINGLE_SERIES, SINGLE_SERIES_TRACK } from '~/utils/chartTheme'

const TOP_N = 10

const { filtered } = useExpenses()
const all = computed(() => bucketByCategory(filtered.value))
const rows = computed(() => all.value.slice(0, TOP_N))

/** 막대 길이는 1위 대비 비율로 그린다 — 전체 비중으로 그리면 대부분이 짧아 비교가 안 된다 */
const maxTotal = computed(() => rows.value[0]?.total ?? 0)
function barWidth(total: number): string {
  if (maxTotal.value <= 0) return '0%'
  return `${Math.max((total / maxTotal.value) * 100, 1.5)}%`
}

const shownShare = computed(() => rows.value.reduce((s, r) => s + r.share, 0))
</script>

<template>
  <section class="card flex flex-col">
    <header class="flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <h3 class="lb-title">카테고리 TOP {{ TOP_N }}</h3>
        <p class="lb-subtitle">
          지출이 큰 순서 · 막대 길이는 1위 대비 비율
        </p>
      </div>
      <!-- ml-auto: 좁은 컬럼에서 아래 줄로 내려가도 우측에 붙는다 -->
      <div v-if="rows.length > 0" class="text-right shrink-0 ml-auto">
        <div class="lb-metric-label">합산 비중</div>
        <div class="lb-metric">{{ formatPercent(shownShare * 100) }}</div>
      </div>
    </header>

    <ol v-if="rows.length > 0" class="lb-list">
      <li v-for="(r, i) in rows" :key="r.category" class="lb-row">
        <span class="lb-rank" aria-hidden="true">{{ i + 1 }}</span>

        <div class="lb-body">
          <div class="lb-line">
            <span class="lb-name" :title="r.category">{{ r.category }}</span>
            <span class="lb-amount">{{ formatKRW(r.total) }}</span>
          </div>

          <div
            class="lb-track"
            :style="{ backgroundColor: SINGLE_SERIES_TRACK }"
            role="img"
            :aria-label="`${r.category} ${formatKRW(r.total)}, 전체의 ${formatPercent(r.share * 100)}`"
          >
            <div
              class="lb-fill"
              :style="{ width: barWidth(r.total), backgroundColor: SINGLE_SERIES }"
            />
          </div>

          <div class="lb-meta">
            <span>{{ r.count.toLocaleString('ko-KR') }}건</span>
            <span>전체의 {{ formatPercent(r.share * 100) }}</span>
          </div>
        </div>
      </li>
    </ol>

    <div v-else class="py-10 grid place-items-center text-center">
      <div>
        <svg
          width="34" height="26" viewBox="0 0 34 26" fill="none"
          class="mx-auto text-slate-200" aria-hidden="true"
        >
          <rect x="1" y="12" width="8" height="13" rx="2" fill="currentColor" />
          <rect x="13" y="6" width="8" height="19" rx="2" fill="currentColor" />
          <rect x="25" y="16" width="8" height="9" rx="2" fill="currentColor" />
        </svg>
        <p class="mt-2 text-sm text-slate-400">표시할 데이터가 없습니다.</p>
      </div>
    </div>

    <p v-if="all.length > TOP_N" class="lb-foot">
      나머지 {{ (all.length - TOP_N).toLocaleString('ko-KR') }}개 카테고리는 목록에서 생략되었습니다.
    </p>
  </section>
</template>

<style scoped>
.lb-title {
  @apply font-semibold text-slate-900 leading-snug;
  font-size: clamp(0.9375rem, 0.85rem + 0.2vw, 1.0625rem);
}
.lb-subtitle {
  @apply text-slate-500 mt-0.5;
  font-size: 0.75rem;
}
.lb-metric-label {
  @apply text-[10px] font-medium text-slate-400 uppercase tracking-wide;
}
.lb-metric {
  @apply font-bold text-slate-900 tabular-nums leading-none;
  font-size: clamp(0.9375rem, 0.85rem + 0.25vw, 1.125rem);
}

.lb-list {
  margin: 0.875rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  /* 행 간격을 일정하게 — 예전엔 space-y-3이라 막대/메타가 붙어 보였다 */
  gap: 0.625rem;
}
.lb-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}
.lb-rank {
  flex: 0 0 1.25rem;
  margin-top: 0.0625rem;
  font-size: 0.6875rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: rgb(148 163 184);      /* slate-400 — 순위는 보조 정보 */
  line-height: 1.5;
}
.lb-body {
  flex: 1 1 auto;
  min-width: 0;
}
.lb-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.8125rem;
}
.lb-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
  color: rgb(30 41 59);         /* slate-800 */
}
.lb-amount {
  flex: 0 0 auto;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgb(15 23 42);
}
.lb-track {
  margin-top: 0.3125rem;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
}
.lb-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.25s ease;
}
.lb-meta {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  margin-top: 0.25rem;
  font-size: 0.6875rem;
  font-variant-numeric: tabular-nums;
  color: rgb(148 163 184);
}
.lb-foot {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgb(241 245 249);
  font-size: 0.6875rem;
  color: rgb(148 163 184);
}
</style>
