<script setup lang="ts">
// 파일 선택 / 드래그 앤 드롭 영역만 담당하는 프레젠테이션 컴포넌트.
// 파싱·검증·저장은 상위(MemberUploadPanel)에서 처리한다.
import { ref } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 활성 가족 구성원이 없으면 true — 업로드 영역 비활성화 */
    disabled?: boolean
    /** 파싱 중 */
    busy?: boolean
    accept?: string
    /** 비활성화 사유 안내 문구 */
    disabledHint?: string
  }>(),
  {
    disabled: false,
    busy: false,
    accept: '.xlsx,.xlsm,.xlsb,.xls,.csv,.tsv,.txt',
    disabledHint: '가족 구성원을 먼저 선택해 주세요.'
  }
)

const emit = defineEmits<{ (e: 'file', file: File): void }>()

const dragging = ref(false)

function onSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file && !props.disabled) emit('file', file)
  input.value = ''
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  if (props.disabled) return
  const file = e.dataTransfer?.files?.[0]
  if (file) emit('file', file)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (!props.disabled) dragging.value = true
}
</script>

<template>
  <label
    :class="[
      'block border-2 border-dashed rounded-xl px-6 py-10 text-center transition',
      disabled
        ? 'border-slate-200 bg-slate-50 cursor-not-allowed opacity-70'
        : dragging
          ? 'border-brand-500 bg-brand-50 cursor-pointer'
          : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50 cursor-pointer'
    ]"
    :aria-disabled="disabled"
    @dragover="onDragOver"
    @dragleave.prevent="dragging = false"
    @drop="onDrop"
  >
    <input type="file" :accept="accept" class="hidden" :disabled="disabled" @change="onSelect" />
    <div class="flex flex-col items-center gap-2">
      <div
        :class="[
          'w-12 h-12 rounded-xl grid place-items-center text-2xl',
          disabled ? 'bg-slate-100 text-slate-400' : 'bg-brand-50 text-brand-600'
        ]"
      >{{ disabled ? '🔒' : '⬆' }}</div>

      <template v-if="disabled">
        <p class="text-slate-500 font-medium">{{ disabledHint }}</p>
        <p class="text-xs text-slate-400">왼쪽 사이드바에서 가족 구성원을 체크하면 업로드할 수 있습니다.</p>
      </template>
      <template v-else-if="busy">
        <p class="text-slate-700 font-medium">파일 분석 중...</p>
        <p class="text-xs text-slate-500">잠시만 기다려 주세요.</p>
      </template>
      <template v-else>
        <p class="text-slate-700 font-medium">
          <span class="text-brand-700 underline">파일 선택</span> 또는 여기로 드래그 앤 드롭
        </p>
        <p class="text-xs text-slate-500">
          인식하는 열 예시: 날짜 · 내용 · 금액 · 카테고리 · 결제수단 · 구분
        </p>
      </template>
    </div>
  </label>
</template>
