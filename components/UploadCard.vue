<script setup lang="ts">
import { ref } from 'vue'
import { parseExpenseFile } from '~/utils/parseExcel'
import { useExpenses } from '~/composables/useExpenses'

const { setParseResult, reset } = useExpenses()
const dragging = ref(false)
const error = ref<string>('')
const busy = ref(false)

async function handleFile(file: File) {
  error.value = ''
  busy.value = true
  try {
    const result = await parseExpenseFile(file)
    if (result.transactions.length === 0) {
      error.value =
        '유효한 거래 데이터를 찾지 못했습니다. "날짜", "금액" 열이 포함되어 있는지 확인해 주세요.'
      return
    }
    setParseResult(result, file.name)
  } catch (e) {
    error.value = `파일을 읽는 중 오류가 발생했습니다: ${(e as Error).message}`
  } finally {
    busy.value = false
  }
}

function onSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) handleFile(file)
  input.value = ''
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) handleFile(file)
}

async function loadSample() {
  busy.value = true
  error.value = ''
  try {
    const res = await fetch('/sample-expenses.csv')
    if (!res.ok) throw new Error('샘플 파일을 불러올 수 없습니다.')
    const blob = await res.blob()
    const file = new File([blob], 'sample-expenses.csv', { type: 'text/csv' })
    const result = await parseExpenseFile(file)
    setParseResult(result, file.name)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="card">
    <!-- 좁은 화면에서는 헤더가 자연스럽게 두 줄로 줄바꿈되도록 flex-wrap -->
    <div class="flex items-start sm:items-center justify-between mb-4 flex-wrap gap-2">
      <div class="min-w-0">
        <h2 class="text-lg font-semibold text-slate-900">엑셀 파일 업로드</h2>
        <p class="text-sm text-slate-500 mt-0.5">
          .xlsx / .xls / .csv 형식의 가계부 파일을 올리면 자동으로 분류하고 시각화합니다.
        </p>
      </div>
      <button
        type="button"
        class="text-sm text-brand-700 hover:text-brand-800 font-medium whitespace-nowrap"
        @click="loadSample"
      >
        샘플 데이터 불러오기 →
      </button>
    </div>

    <label
      :class="[
        'block border-2 border-dashed rounded-xl px-6 py-10 text-center cursor-pointer transition',
        dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50'
      ]"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop="onDrop"
    >
      <input type="file" accept=".xlsx,.xls,.csv" class="hidden" @change="onSelect" />
      <div class="flex flex-col items-center gap-2">
        <div class="w-12 h-12 rounded-xl bg-brand-50 text-brand-600 grid place-items-center text-2xl">⬆</div>
        <p class="text-slate-700 font-medium">
          <span class="text-brand-700 underline">파일 선택</span> 또는 여기로 드래그 앤 드롭
        </p>
        <p class="text-xs text-slate-500">
          인식하는 열 예시: 날짜 · 내용 · 금액 · 카테고리 · 결제수단 · 구분
        </p>
      </div>
    </label>

    <div v-if="busy" class="mt-3 text-sm text-slate-500">파일 분석 중...</div>
    <div v-else-if="error" class="mt-3 rounded-md bg-red-50 text-red-700 text-sm px-3 py-2">
      {{ error }}
    </div>
  </section>
</template>
