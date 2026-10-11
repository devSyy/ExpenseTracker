<script setup lang="ts">
/**
 * 앱 아이덴티티 마크.
 *
 * 형태: 지붕(오버행 있는 처마) 아래 벽면이 있고, 그 안에 오른쪽으로 갈수록 높아지는
 * 막대 3개가 **파여** 있다. "집(가계) 안에 쌓이는 기록"을 한 덩어리로 읽히게 한 것.
 *
 * 구현 메모
 *  - 단일 <path> + fill-rule="evenodd". 막대를 따로 칠하지 않고 파냈기 때문에
 *    어떤 배경 위에 올려도(파란 사각형, 흰 배경, 파비콘) 색을 바꿀 필요가 없다.
 *  - currentColor를 쓰므로 부모의 text 색을 그대로 따라간다.
 *  - 16px 파비콘까지 버티도록 막대 폭 3 / 간격 0.9 (24 그리드 기준)로 잡았다.
 *    이보다 가늘게 하면 작은 크기에서 막대가 뭉개진다.
 */
withDefaults(defineProps<{ size?: number | string }>(), { size: 24 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="currentColor"
    fill-rule="evenodd"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="
        M12 2 L23 9.6 L20.8 9.6 L12 3.5 L3.2 9.6 L1 9.6 Z
        M3.6 10.8 H20.4 V21.6 H3.6 Z
        M6.6 16 h3 v3.4 h-3 Z
        M10.5 14.2 h3 v5.2 h-3 Z
        M14.4 12.4 h3 v7 h-3 Z
      "
    />
  </svg>
</template>
