<script setup lang="ts">
// 차트 카드 껍데기 — 제목·설명·우측 컨트롤·범례·본문·푸터의 위치와 간격을 한 곳에서 정한다.
// 5개 차트가 모두 이 컴포넌트를 쓰므로 여백과 글자 크기가 서로 어긋나지 않는다.
withDefaults(defineProps<{
  title: string
  /** 제목 아래 한 줄 설명 */
  subtitle?: string
  /** 우측 상단에 표시할 요약 값 (예: 총 지출) */
  metric?: string
  metricLabel?: string
  /** 데이터 없음 상태 */
  empty?: boolean
  emptyText?: string
  /** 차트 본문 높이 클래스 */
  bodyClass?: string
}>(), {
  subtitle: '',
  emptyText: '표시할 데이터가 없습니다.',
  bodyClass: 'h-chart-md xl:h-chart-lg'
})
</script>

<template>
  <section class="card flex flex-col">
    <!--
      헤더: 제목/설명 (좌) + 컨트롤이나 요약값 (우).
      좁은 화면에서는 아래로 흐르되 제목이 먼저 오도록 flex-wrap만 쓴다.
    -->
    <header class="flex items-start justify-between gap-3 flex-wrap">
      <div class="min-w-0">
        <h3 class="chart-title">{{ title }}</h3>
        <p v-if="subtitle" class="chart-subtitle">{{ subtitle }}</p>
      </div>

      <!-- ml-auto: 좁은 화면에서 이 묶음이 아래 줄로 내려가도 항상 우측에 붙는다(가운데로 뜨지 않게) -->
      <div v-if="$slots.actions || metric" class="flex items-center gap-3 shrink-0 ml-auto">
        <div v-if="metric" class="text-right">
          <div v-if="metricLabel" class="chart-metric-label">{{ metricLabel }}</div>
          <div class="chart-metric">{{ metric }}</div>
        </div>
        <slot name="actions" />
      </div>
    </header>

    <!-- 범례: 헤더와 차트 사이 고정 위치 -->
    <div v-if="$slots.legend && !empty" class="mt-3">
      <slot name="legend" />
    </div>

    <!-- 본문 -->
    <div :class="['relative mt-3', bodyClass]">
      <template v-if="empty">
        <div class="h-full grid place-items-center text-center px-4">
          <div>
            <!-- 빈 막대 3개 — 폰트에 따라 깨질 수 있는 기호 대신 SVG로 그린다 -->
            <svg
              width="34" height="26" viewBox="0 0 34 26" fill="none"
              class="mx-auto text-slate-200" aria-hidden="true"
            >
              <rect x="1" y="12" width="8" height="13" rx="2" fill="currentColor" />
              <rect x="13" y="6" width="8" height="19" rx="2" fill="currentColor" />
              <rect x="25" y="16" width="8" height="9" rx="2" fill="currentColor" />
            </svg>
            <p class="mt-2 text-sm text-slate-400">{{ emptyText }}</p>
          </div>
        </div>
      </template>
      <slot v-else />
    </div>

    <div v-if="$slots.footer && !empty" class="mt-3 pt-3 border-t border-slate-100">
      <slot name="footer" />
    </div>
  </section>
</template>

<style scoped>
.chart-title {
  @apply font-semibold text-slate-900 leading-snug;
  font-size: clamp(0.9375rem, 0.85rem + 0.2vw, 1.0625rem);
}
.chart-subtitle {
  @apply text-slate-500 mt-0.5 leading-relaxed;
  font-size: 0.75rem;
}
.chart-metric-label {
  @apply text-[10px] font-medium text-slate-400 uppercase tracking-wide;
}
.chart-metric {
  @apply font-bold text-slate-900 tabular-nums leading-none;
  font-size: clamp(0.9375rem, 0.85rem + 0.25vw, 1.125rem);
}
</style>
