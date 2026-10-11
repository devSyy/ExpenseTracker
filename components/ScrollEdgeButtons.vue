<script setup lang="ts">
// 화면 가로 정중앙의 최상단/최하단에 떠 있는 반투명 "맨 위로 / 맨 아래로" 버튼.
// 이미 맨 위(또는 맨 아래)에 있으면 해당 버튼은 숨긴다. 스크롤 컨테이너는 window 하나뿐이다.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const atTop = ref(true)
const atBottom = ref(false)
const THRESHOLD = 80

let ticking = false
function update() {
  ticking = false
  const doc = document.documentElement
  const y = window.scrollY || doc.scrollTop
  atTop.value = y <= THRESHOLD
  atBottom.value = y + window.innerHeight >= doc.scrollHeight - THRESHOLD
}
function onScroll() {
  if (ticking) return
  ticking = true
  requestAnimationFrame(update)
}

function goTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
function goBottom() {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
}

let ro: ResizeObserver | undefined
onMounted(() => {
  update()
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll)
  // 페이지 높이가 바뀌어도(데이터 로드·펼침) 맨 아래 판정을 갱신한다
  ro = new ResizeObserver(onScroll)
  ro.observe(document.body)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  ro?.disconnect()
})
</script>

<template>
  <div class="scroll-edge" aria-hidden="false">
    <transition name="edge-fade">
      <button
        v-show="!atTop"
        type="button"
        class="edge-btn edge-top"
        aria-label="맨 위로 이동"
        title="맨 위로"
        @click="goTop"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
        <span>맨 위로</span>
      </button>
    </transition>
    <transition name="edge-fade">
      <button
        v-show="!atBottom"
        type="button"
        class="edge-btn edge-bottom"
        aria-label="맨 아래로 이동"
        title="맨 아래로"
        @click="goBottom"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        <span>맨 아래로</span>
      </button>
    </transition>
  </div>
</template>

<style scoped>
.edge-btn {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40; /* 사이드바(30)·오버레이(20)보다 위, 토스트(50)보다 아래 */
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  background: rgba(15, 23, 42, 0.6); /* 반투명 slate-900 */
  opacity: 0.85;
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: background 0.15s, opacity 0.2s;
}
.edge-btn:hover { background: rgba(15, 23, 42, 0.9); opacity: 1; }
.edge-top { top: 8px; }
.edge-bottom { bottom: 8px; }

.edge-fade-enter-active,
.edge-fade-leave-active { transition: opacity 0.2s; }
.edge-fade-enter-from,
.edge-fade-leave-to { opacity: 0; }

@media print { .scroll-edge { display: none; } }
</style>
