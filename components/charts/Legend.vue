<script setup lang="ts">
// HTML 범례 — Chart.js 내장 범례 대신 쓴다.
//
// 내장 범례는 정렬·줄바꿈·여백을 제어할 수 없고, 값을 같이 보여줄 수 없다.
// 여기서는 이름 + 금액 + 비중을 함께 적어 "색을 눈으로 맞추는" 작업 자체를 없앤다.
// (대비가 3:1에 못 미치는 밝은 슬롯도 이름과 금액이 항상 보이므로 읽는 데 문제가 없다)
//
// 텍스트는 절대 시리즈 색을 입지 않는다 — 색은 옆의 점/막대 표식이 담당한다.
import type { LegendItem } from '~/utils/chartTheme'

const props = withDefaults(defineProps<{
  items: LegendItem[]
  /** 'row' = 가로 흐름(막대차트 상단) · 'list' = 세로 목록(도넛 옆) */
  layout?: 'row' | 'list'
  /** 표식 모양 — 막대/영역은 사각, 선은 선 */
  marker?: 'rect' | 'line'
  /** 클릭으로 항목 표시/숨김 토글 허용 */
  toggleable?: boolean
}>(), {
  layout: 'row',
  marker: 'rect',
  toggleable: false
})

const emit = defineEmits<{ toggle: [index: number] }>()

function onActivate(i: number) {
  if (props.toggleable) emit('toggle', i)
}
</script>

<template>
  <ul
    :class="[
      'chart-legend',
      layout === 'list' ? 'chart-legend-list' : 'chart-legend-row'
    ]"
  >
    <li v-for="(it, i) in items" :key="it.label">
      <component
        :is="toggleable ? 'button' : 'div'"
        :type="toggleable ? 'button' : undefined"
        :class="['legend-item', it.hidden ? 'is-hidden' : '', toggleable ? 'is-clickable' : '']"
        :aria-pressed="toggleable ? !it.hidden : undefined"
        :title="toggleable ? `${it.label} — 클릭하여 ${it.hidden ? '표시' : '숨기기'}` : it.label"
        @click="onActivate(i)"
      >
        <span
          :class="['legend-marker', marker === 'line' ? 'is-line' : '']"
          :style="{ backgroundColor: it.color }"
          aria-hidden="true"
        />
        <span class="legend-label">{{ it.label }}</span>
        <span v-if="it.value" class="legend-value">{{ it.value }}</span>
        <span v-if="it.hint" class="legend-hint">{{ it.hint }}</span>
      </component>
    </li>
  </ul>
</template>

<style scoped>
.chart-legend {
  display: flex;
  margin: 0;
  padding: 0;
  list-style: none;
}
/* 막대차트 상단 — 가로로 흐르고 좁아지면 줄바꿈 */
.chart-legend-row {
  flex-wrap: wrap;
  gap: 0.375rem 0.875rem;
  align-items: center;
}
/* 도넛 옆 — 한 줄에 하나씩, 값이 우측 정렬되어 표처럼 읽힌다 */
.chart-legend-list {
  flex-direction: column;
  gap: 0.125rem;
  width: 100%;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.4375rem;
  width: 100%;
  padding: 0.1875rem 0;
  text-align: left;
  background: none;
  border: 0;
  border-radius: 6px;
  font-size: 0.75rem;
  line-height: 1.35;
  color: rgb(71 85 105);          /* slate-600 — 텍스트는 잉크 토큰 */
  transition: opacity 0.12s ease, background-color 0.12s ease;
}
.chart-legend-row .legend-item {
  width: auto;
  padding: 0;
}
.legend-item.is-clickable {
  cursor: pointer;
}
.chart-legend-list .legend-item.is-clickable {
  padding-inline: 0.25rem;
  margin-inline: -0.25rem;
}
.legend-item.is-clickable:hover {
  background-color: rgb(248 250 252);   /* slate-50 */
}
.legend-item.is-clickable:focus-visible {
  outline: 2px solid rgb(89 158 255);   /* brand-400 */
  outline-offset: 1px;
}
/* 숨긴 항목: 취소선 + 흐리게 — 색만으로 상태를 말하지 않는다 */
.legend-item.is-hidden {
  opacity: 0.45;
}
.legend-item.is-hidden .legend-label {
  text-decoration: line-through;
}

.legend-marker {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.legend-marker.is-line {
  width: 14px;
  height: 3px;
  border-radius: 2px;
}

.legend-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 세로 목록에서는 라벨이 남는 폭을 먹고 값이 우측에 붙는다 */
.chart-legend-list .legend-label {
  flex: 1 1 auto;
}
.legend-value {
  flex: 0 0 auto;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: rgb(15 23 42);          /* slate-900 */
  white-space: nowrap;
}
.legend-hint {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: rgb(148 163 184);       /* slate-400 */
  white-space: nowrap;
}
</style>
