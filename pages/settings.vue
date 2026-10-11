<script setup lang="ts">
// 카테고리·결제수단 관리 페이지.
// 모든 변경은 useTaxonomies()를 통해 reactive 상태에 반영되며 localStorage에 저장된다.
// 이름 변경/삭제 시 거래에서 사용 중인 항목은 useExpenses의 remap*로 일괄 처리한다.
import { computed, ref } from 'vue'
import { useExpenses } from '~/composables/useExpenses'
import { useIncomeExpense } from '~/composables/useIncomeExpense'
import { useTaxonomies } from '~/composables/useTaxonomies'
import { useLocalCurrency } from '~/composables/useLocalCurrency'
import { downloadBackup, importFromJSON, type ImportStrategy } from '~/utils/backup'
import { REFUND_CATEGORY, type PaymentTag, type TxType } from '~/utils/types'

/** 안내 문구에서 쓰는 환불 카테고리 이름 (자동 배정에서 보호되는 카테고리) */
const REFUND_CATEGORY_LABEL = REFUND_CATEGORY

useHead({ title: '카테고리·결제수단 관리 · 가계부' })

const {
  categories,
  payments,
  addCategory,
  renameCategory,
  setCategoryFixed,
  setCategoryExcluded,
  setCategoryType,
  incomeCategories,
  expenseCategories,
  setCategoryHidden,
  removeCategory,
  moveCategory,
  reorderCategories,
  sortCategoriesAlpha,
  sortPaymentsAlpha,
  visibleCategoryNames,
  visibleExpenseCategoryNames,
  visibleIncomeCategoryNames,
  visibleSavingsCategoryNames,
  addPayment,
  renamePayment,
  setPaymentHidden,
  removePayment,
  movePayment,
  reorderPayments,
  paymentTag,
  setPaymentTag,
  paymentCategoryMap,
  paymentMappedCategory,
  setPaymentCategoryMap,
  mappedPaymentCount,
  resetToDefaults,
  FALLBACK_CATEGORY,
  FALLBACK_PAYMENT
} = useTaxonomies()

const { remapCategory: remapIeCategory, remapPayment: remapIePayment } = useIncomeExpense()
const {
  countByCategory,
  countByPayment,
  remapCategory,
  remapPayment,
  exportSnapshot
} = useExpenses()

// 지역화폐(선불 자산) — 결제수단 행에서 카드 연결을 바로 토글할 수 있게 한다 (연결의 단일 소스는 자산 쪽)
const { assets: prepaidAssets, isLinked: isPrepaidLinked, setLink: setPrepaidLink } = useLocalCurrency()
function onTogglePrepaidLink(assetId: string, assetName: string, payment: string, linked: boolean) {
  setPrepaidLink(assetId, payment, linked)
  notify('ok', linked ? `'${payment}' ↔ ${assetName} 연결됨 · 이 카드 거래에 '지역화폐 사용' 체크가 표시됩니다` : `'${payment}' ↔ ${assetName} 연결 해제됨 (기존 사용 내역은 유지)`)
}

// ── 새 항목 입력 폼 ──
const newCategoryName = ref('')
const newCategoryFixed = ref(false)
/** 새 카테고리의 수입/지출 유형 */
const newCategoryType = ref<TxType>('지출')
/** 카테고리 유형 세그먼트(행 UI) — 순서 = 표시 순서 */
const CATEGORY_TYPE_OPTIONS: { type: TxType; title: string }[] = [
  { type: '지출', title: '지출 카테고리로 설정 — 지출 계산에 반영됩니다' },
  { type: '수입', title: '수입 카테고리로 설정 — 수입 계산에 반영됩니다' },
  { type: '이체', title: '이체 카테고리로 설정 — 내 통장 간 이동으로 보고 수입·지출 어느 계산에도 넣지 않습니다' },
  { type: '저축', title: '저축 카테고리로 설정 — 모은 돈으로 보고 수입·지출 어느 계산에도 넣지 않습니다' },
  { type: '충전', title: '충전 카테고리로 설정 — 페이·선불 충전으로 보고 수입·지출 어느 계산에도 넣지 않습니다' }
]
const newPaymentName = ref('')
/** 새 결제수단의 소비/저축 태그 */
const newPaymentTag = ref<PaymentTag>('소비')

// ── 인라인 이름 편집 상태 ──
const editingCategory = ref<string | null>(null)
const editingCategoryName = ref('')
const editingPayment = ref<string | null>(null)
const editingPaymentName = ref('')

// ── 토스트 (성공/에러 알림) ──
const toast = ref<{ kind: 'ok' | 'err'; msg: string } | null>(null)
let toastTimer: number | undefined
function notify(kind: 'ok' | 'err', msg: string) {
  toast.value = { kind, msg }
  if (toastTimer) window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = null), 2400) as unknown as number
}

// ── 카테고리 액션 ──
function onAddCategory() {
  const r = addCategory(newCategoryName.value, newCategoryFixed.value, newCategoryType.value)
  if (!r.ok) { categoryError.value = r.reason ?? '추가 실패'; return notify('err', categoryError.value) }
  categoryError.value = ''
  notify('ok', `${newCategoryType.value} 카테고리 추가됨: ${newCategoryName.value.trim()}`)
  newCategoryName.value = ''
  newCategoryFixed.value = false
}

/** 카테고리 유형 변경 — 이 카테고리를 쓰는 거래가 수입/지출 어느 쪽으로 집계될지 바뀐다. */
function onChangeCategoryType(name: string, type: TxType) {
  const usage = countByCategory(name)
  if (usage > 0) {
    const ok = window.confirm(
      `'${name}' 카테고리를 '${type}'(으)로 변경합니다.\n` +
      `이 카테고리를 사용하는 거래 ${usage.toLocaleString('ko-KR')}건이 앞으로 ${type} 계산에 반영됩니다.\n\n계속할까요?`
    )
    if (!ok) return
  }
  setCategoryType(name, type)
  notify('ok', `'${name}' → ${type} 카테고리로 변경됨`)
}

function startEditCategory(name: string) {
  editingCategory.value = name
  editingCategoryName.value = name
}

function commitEditCategory() {
  if (!editingCategory.value) return
  const oldName = editingCategory.value
  const newName = editingCategoryName.value.trim()
  if (!newName || newName === oldName) {
    editingCategory.value = null
    return
  }
  const r = renameCategory(oldName, newName)
  if (!r.ok) return notify('err', r.reason ?? '이름 변경 실패')
  // 거래에서 사용 중인 카테고리도 함께 갱신
  const moved = remapCategory(oldName, newName)
  remapIeCategory(oldName, newName)   // 수입/지출 관리에 직접 입력한 항목도 같이
  notify('ok', moved > 0 ? `이름 변경됨 · 거래 ${moved}건 갱신` : '이름 변경됨')
  editingCategory.value = null
}

function cancelEditCategory() {
  editingCategory.value = null
}

/** 지출제외 체크의 툴팁 — 유형마다 빠지는 집계가 다르다 */
function excludeTitle(type: string | undefined): string {
  switch (type) {
    case '수입': return '켜면 이 카테고리의 거래가 수입 합계에서 빠집니다. 거래내역에는 그대로 남습니다.'
    case '저축': return '저축은 원래 지출 합계에 들어가지 않습니다. 켜도 대시보드 저축 구성에는 그대로 집계됩니다.'
    case '이체': return '이체는 원래 수입·지출 어느 합계에도 들어가지 않습니다. 설정값만 저장됩니다.'
    default: return '켜면 이 카테고리의 모든 거래가 지출 계산(KPI·차트·집계)에서 빠집니다. 거래내역에는 그대로 남습니다.'
  }
}

function onToggleFixed(name: string, isFixed: boolean) {
  setCategoryFixed(name, isFixed)
}

function onToggleExcluded(name: string, v: boolean) {
  setCategoryExcluded(name, v)
  notify('ok', v ? `'${name}' 거래를 지출 계산에서 제외합니다` : `'${name}' 거래를 지출 계산에 다시 포함합니다`)
}

function onSortCategoriesAlpha() {
  sortCategoriesAlpha()
  notify('ok', '카테고리를 가나다 순으로 정렬했습니다')
}
function onSortPaymentsAlpha() {
  sortPaymentsAlpha()
  notify('ok', '결제수단을 가나다 순으로 정렬했습니다')
}

function onRemoveCategory(name: string) {
  const usage = countByCategory(name)
  const msg = usage > 0
    ? `'${name}' 카테고리를 사용하는 거래가 ${usage}건 있습니다.\n해당 거래를 '${FALLBACK_CATEGORY}'로 옮긴 뒤 삭제할까요?`
    : `'${name}' 카테고리를 삭제할까요?`
  if (!window.confirm(msg)) return

  if (usage > 0) remapCategory(name, FALLBACK_CATEGORY)
  remapIeCategory(name, FALLBACK_CATEGORY)
  const r = removeCategory(name)
  if (!r.ok) return notify('err', r.reason ?? '삭제 실패')
  notify('ok', usage > 0 ? `삭제됨 · 거래 ${usage}건을 ${FALLBACK_CATEGORY}로 이동` : '삭제됨')
}

// ── 결제수단 액션 ──
function onAddPayment() {
  const r = addPayment(newPaymentName.value, newPaymentTag.value)
  if (!r.ok) { paymentError.value = r.reason ?? '추가 실패'; return notify('err', paymentError.value) }
  paymentError.value = ''
  notify('ok', `${newPaymentTag.value} 결제수단 추가됨: ${newPaymentName.value.trim()}`)
  newPaymentName.value = ''
}

// ── 결제수단 태그(소비/저축) · 카테고리 매핑 ──
//
// 태그는 이 결제수단으로 나간 돈의 성격을, 매핑은 "그 결제수단이 선택되면 어떤 카테고리로
// 배정할지"를 정한다. 매핑은 태그별로 따로 보관되므로 태그를 바꿔도 반대쪽 매핑은 남아 있다.
// 태그·매핑 변경은 **기존 거래를 바꾸지 않는다** — 앞으로 결제수단이 선택될 때부터 적용된다.

function onChangePaymentTag(name: string, tag: PaymentTag) {
  if (paymentTag(name) === tag) return
  setPaymentTag(name, tag)
  const mapped = paymentCategoryMap(name, tag)
  notify(
    'ok',
    mapped
      ? `'${name}' → ${tag} 태그로 변경됨 · 매핑 카테고리 ${mapped}`
      : `'${name}' → ${tag} 태그로 변경됨 (매핑된 카테고리 없음)`
  )
}

/** 현재 태그의 매핑 카테고리를 설정/해제한다. 빈 값이면 해제. */
function onChangePaymentCategoryMap(name: string, value: string) {
  const tag = paymentTag(name)
  const r = setPaymentCategoryMap(name, tag, value)
  if (!r.ok) return notify('err', r.reason ?? '매핑 실패')
  notify(
    'ok',
    value
      ? `'${name}'(${tag}) → 카테고리 '${value}' 매핑됨 · 이후 이 결제수단을 선택하면 자동 배정됩니다`
      : `'${name}'(${tag}) 카테고리 매핑 해제됨`
  )
}

/** 목록 렌더용 — 현재 태그에 저장된 매핑 값 (select의 v-model 대신 :value로 사용) */
function paymentMapValue(name: string): string {
  return paymentCategoryMap(name, paymentTag(name)) ?? ''
}

/**
 * 매핑된 카테고리가 목록에 남아 있지 않거나 비활성화되어 실제로는 적용되지 않는 상태인지.
 * (삭제 시에는 매핑이 자동 해제되므로 주로 '비활성화' 상태를 잡아낸다)
 */
function isPaymentMapInactive(name: string): boolean {
  const raw = paymentMapValue(name)
  if (!raw) return false
  return paymentMappedCategory(name) !== raw
}

function startEditPayment(name: string) {
  editingPayment.value = name
  editingPaymentName.value = name
}

function commitEditPayment() {
  if (!editingPayment.value) return
  const oldName = editingPayment.value
  const newName = editingPaymentName.value.trim()
  if (!newName || newName === oldName) {
    editingPayment.value = null
    return
  }
  const r = renamePayment(oldName, newName)
  if (!r.ok) return notify('err', r.reason ?? '이름 변경 실패')
  const moved = remapPayment(oldName, newName)
  remapIePayment(oldName, newName)
  notify('ok', moved > 0 ? `이름 변경됨 · 거래 ${moved}건 갱신` : '이름 변경됨')
  editingPayment.value = null
}

function cancelEditPayment() {
  editingPayment.value = null
}

function onRemovePayment(name: string) {
  const usage = countByPayment(name)
  const msg = usage > 0
    ? `'${name}' 결제수단을 사용하는 거래가 ${usage}건 있습니다.\n해당 거래를 '${FALLBACK_PAYMENT}'로 옮긴 뒤 삭제할까요?`
    : `'${name}' 결제수단을 삭제할까요?`
  if (!window.confirm(msg)) return

  if (usage > 0) remapPayment(name, FALLBACK_PAYMENT)
  remapIePayment(name, FALLBACK_PAYMENT)
  const r = removePayment(name)
  if (!r.ok) return notify('err', r.reason ?? '삭제 실패')
  notify('ok', usage > 0 ? `삭제됨 · 거래 ${usage}건을 ${FALLBACK_PAYMENT}로 이동` : '삭제됨')
}

// ── 전체 초기화 ──
function onResetAll() {
  if (!window.confirm('카테고리와 결제수단 목록을 기본값으로 초기화할까요?\n현재 거래에 적용된 카테고리/결제수단 값 자체는 변경되지 않습니다.')) return
  resetToDefaults()
  notify('ok', '기본값으로 초기화됨')
}

// ── 가시성 토글 ──
function onToggleCategoryHidden(name: string, hidden: boolean) {
  setCategoryHidden(name, hidden)
}
function onTogglePaymentHidden(name: string, hidden: boolean) {
  setPaymentHidden(name, hidden)
}

// ── 백업: Export / Import ──
const importStrategy = ref<ImportStrategy>('replace')
const backupFileInput = ref<HTMLInputElement | null>(null)

/**
 * 백업 복원 진행 상태 — dim + 원형 로딩 오버레이에 사용.
 *  - 'idle': 오버레이 숨김
 *  - 'loading': 파일 읽는 중/적용 중 → 스피너
 *  - 'done': 완료 → 체크 아이콘 + "복원 완료" + 새로고침 안내
 *  - 'error': 실패 → 경고 아이콘 + 사유
 */
const importOverlay = ref<{
  status: 'idle' | 'loading' | 'done' | 'error'
  message: string
  detail?: string
}>({ status: 'idle', message: '' })

function onExportBackup() {
  try {
    // 대시보드 거래는 '저장'을 눌러야 localStorage에 기록되므로, 저장소 값 대신
    // 현재 메모리 상태를 넘겨 "화면에 보이는 그대로"를 내보낸다.
    // (수입/지출 관리에서 미러링된 거래도 여기에 포함된다. 저장소는 건드리지 않는다)
    downloadBackup(undefined, exportSnapshot())
    notify('ok', '백업 파일이 다운로드되었습니다')
  } catch (e) {
    notify('err', `다운로드 실패: ${(e as Error).message}`)
  }
}

function onPickBackupFile() {
  backupFileInput.value?.click()
}

async function onBackupFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  // 로딩 오버레이 즉시 표시 — 사용자 조작/연타 방지
  importOverlay.value = {
    status: 'loading',
    message: '백업 파일을 복원 중입니다',
    detail: `${file.name} · ${(file.size / 1024).toFixed(1)} KB`
  }
  // input 값은 바로 비워 같은 파일을 다시 선택할 수 있게 한다
  input.value = ''

  try {
    // 아주 작은 UI tick을 줘 로딩 오버레이가 확실히 렌더링되고 나서 무거운 파싱을 시작
    await new Promise((r) => setTimeout(r, 50))
    const text = await file.text()
    const result = importFromJSON(text, importStrategy.value)

    if (!result.ok) {
      importOverlay.value = {
        status: 'error',
        message: '복원에 실패했습니다',
        detail: result.errors[0] ?? '알 수 없는 오류'
      }
      // 오류는 사용자가 확인 후 닫을 수 있도록 2.5초 뒤 자동 해제
      setTimeout(() => { importOverlay.value = { status: 'idle', message: '' } }, 2500)
      notify('err', `복원 실패 · ${result.errors[0] ?? '알 수 없는 오류'}`)
      return
    }

    importOverlay.value = {
      status: 'done',
      message: '동기화가 완료되었습니다',
      detail: `${result.imported}개 항목 복원 (${importStrategy.value}) · 잠시 후 페이지가 새로고침됩니다`
    }
    notify('ok', `복원 완료 · ${result.imported}개 항목 (${importStrategy.value})`)
    // 완료 피드백을 사용자에게 보여주고 새로고침
    setTimeout(() => window.location.reload(), 1400)
  } catch (err) {
    importOverlay.value = {
      status: 'error',
      message: '복원에 실패했습니다',
      detail: (err as Error).message
    }
    setTimeout(() => { importOverlay.value = { status: 'idle', message: '' } }, 2500)
    notify('err', `복원 실패 · ${(err as Error).message}`)
  }
}

// ── 카테고리 드래그앤드롭 ──
// 목록이 유형(지출·수입·이체·저축)별로 묶여 보이므로 같은 그룹 안에서만 순서를 바꾼다.
function sameCategoryGroup(a: number, b: number): boolean {
  const ca = categories.value[a], cb = categories.value[b]
  return !!ca && !!cb && catTypeOf(ca) === catTypeOf(cb)
}
function samePaymentGroup(a: number, b: number): boolean {
  const pa = payments.value[a], pb = payments.value[b]
  return !!pa && !!pb && paymentTag(pa.name) === paymentTag(pb.name)
}
const draggedCategoryIdx = ref<number | null>(null)
const dragOverCategoryIdx = ref<number | null>(null)

function onCategoryDragStart(idx: number, event: DragEvent) {
  draggedCategoryIdx.value = idx
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(idx))
  }
}
function onCategoryDragOver(idx: number, event: DragEvent) {
  // 다른 유형 그룹으로는 놓을 수 없다 (preventDefault를 안 하면 drop이 막힌다)
  if (draggedCategoryIdx.value !== null && !sameCategoryGroup(draggedCategoryIdx.value, idx)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  if (draggedCategoryIdx.value !== null && draggedCategoryIdx.value !== idx) {
    dragOverCategoryIdx.value = idx
  }
}
function onCategoryDragLeave(idx: number) {
  if (dragOverCategoryIdx.value === idx) dragOverCategoryIdx.value = null
}
function onCategoryDrop(targetIdx: number, event: DragEvent) {
  event.preventDefault()
  const fromIdx = draggedCategoryIdx.value
  resetCategoryDragState()
  if (fromIdx === null || fromIdx === targetIdx || !sameCategoryGroup(fromIdx, targetIdx)) return
  const names = categories.value.map((c) => c.name)
  const [moved] = names.splice(fromIdx, 1)
  names.splice(targetIdx, 0, moved)
  reorderCategories(names)
  notify('ok', `'${moved}' 위치 변경됨`)
}
function onCategoryDragEnd() {
  resetCategoryDragState()
}
function resetCategoryDragState() {
  draggedCategoryIdx.value = null
  dragOverCategoryIdx.value = null
}

// ── 결제수단 드래그앤드롭 ──
const draggedPaymentIdx = ref<number | null>(null)
const dragOverPaymentIdx = ref<number | null>(null)

function onPaymentDragStart(idx: number, event: DragEvent) {
  draggedPaymentIdx.value = idx
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(idx))
  }
}
function onPaymentDragOver(idx: number, event: DragEvent) {
  if (draggedPaymentIdx.value !== null && !samePaymentGroup(draggedPaymentIdx.value, idx)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  if (draggedPaymentIdx.value !== null && draggedPaymentIdx.value !== idx) {
    dragOverPaymentIdx.value = idx
  }
}
function onPaymentDragLeave(idx: number) {
  if (dragOverPaymentIdx.value === idx) dragOverPaymentIdx.value = null
}
function onPaymentDrop(targetIdx: number, event: DragEvent) {
  event.preventDefault()
  const fromIdx = draggedPaymentIdx.value
  resetPaymentDragState()
  if (fromIdx === null || fromIdx === targetIdx || !samePaymentGroup(fromIdx, targetIdx)) return
  // 새 순서 계산: from을 빼고 target 자리에 삽입
  const names = payments.value.map((p) => p.name)
  const [moved] = names.splice(fromIdx, 1)
  names.splice(targetIdx, 0, moved)
  reorderPayments(names)
  notify('ok', `'${moved}' 위치 변경됨`)
}
function onPaymentDragEnd() {
  resetPaymentDragState()
}
function resetPaymentDragState() {
  draggedPaymentIdx.value = null
  dragOverPaymentIdx.value = null
}

// ── 통계 ──
// 이름별 사용 건수를 한 번에 계산해 둔다 (행마다 countBy*를 여러 번 부르지 않도록).
const categoryUsage = computed(() => new Map(categories.value.map((c) => [c.name, countByCategory(c.name)])))
const paymentUsage = computed(() => new Map(payments.value.map((p) => [p.name, countByPayment(p.name)])))
const catUsage = (name: string) => categoryUsage.value.get(name) ?? 0
const payUsage = (name: string) => paymentUsage.value.get(name) ?? 0
const totalCategoryUsage = computed(() => {
  let n = 0
  for (const v of categoryUsage.value.values()) n += v
  return n
})
const totalPaymentUsage = computed(() => {
  let n = 0
  for (const v of paymentUsage.value.values()) n += v
  return n
})
/** 전체 대비 비율(%) — 합계가 0이면 0 */
function pctOf(n: number, total: number): number {
  return total > 0 ? Math.round((n / total) * 1000) / 10 : 0
}

// ── 탭 · 요약 · 유형별 그룹 ──
type SettingsTab = 'categories' | 'payments' | 'localCurrency'
const activeTab = ref<SettingsTab>('categories')

const TYPE_COLORS: Record<string, string> = {
  지출: '#e5484d', 수입: '#2f7cf6', 이체: '#7c5cf0', 저축: '#f59e0b', 충전: '#0ea5e9'
}
const TAG_COLORS: Record<string, string> = { 소비: '#d97706', 저축: '#0d9488' }
const catTypeOf = (c: { type?: TxType }): TxType => c.type ?? '지출'

/** 카테고리를 유형별로 묶는다 — 표시용일 뿐, 저장 순서(전체 배열)는 그대로다. idx = 전체 배열 인덱스, gi = 그룹 내 위치 */
const categoryGroups = computed(() =>
  (['지출', '수입', '이체', '저축', '충전'] as TxType[])
    .map((type) => ({
      type,
      color: TYPE_COLORS[type],
      items: categories.value
        .map((cat, idx) => ({ cat, idx }))
        .filter((x) => catTypeOf(x.cat) === type)
        .map((x, gi) => ({ ...x, gi }))
    }))
    .filter((g) => g.items.length > 0)
)
const paymentGroups = computed(() =>
  (['소비', '저축'] as PaymentTag[])
    .map((tag) => ({
      tag,
      color: TAG_COLORS[tag],
      items: payments.value
        .map((pm, idx) => ({ pm, idx }))
        .filter((x) => paymentTag(x.pm.name) === tag)
        .map((x, gi) => ({ ...x, gi }))
    }))
    .filter((g) => g.items.length > 0)
)
const categoryStats = computed(() =>
  (['지출', '수입', '이체', '저축', '충전'] as TxType[]).map((type) => ({
    label: type, color: TYPE_COLORS[type],
    count: categories.value.filter((c) => catTypeOf(c) === type).length
  }))
)
const paymentStats = computed(() =>
  (['소비', '저축'] as PaymentTag[]).map((tag) => ({
    label: tag, color: TAG_COLORS[tag],
    count: payments.value.filter((p) => paymentTag(p.name) === tag).length
  }))
)

/** 그룹 안에서만 위/아래로 이동 — 다른 유형 행을 건너뛰어 인접한 같은 그룹 행과 자리를 바꾼다 */
function swapWithinGroup(names: string[], keyOf: (name: string) => string, name: string, dir: -1 | 1): string[] | null {
  const i = names.indexOf(name)
  if (i < 0) return null
  const key = keyOf(name)
  let j = i + dir
  while (j >= 0 && j < names.length && keyOf(names[j]!) !== key) j += dir
  if (j < 0 || j >= names.length) return null
  const next = names.slice()
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  return next
}
function moveCategoryInGroup(name: string, dir: -1 | 1) {
  const next = swapWithinGroup(
    categories.value.map((c) => c.name),
    (n) => catTypeOf(categories.value.find((c) => c.name === n) ?? {}),
    name, dir
  )
  if (next) reorderCategories(next)
}
function movePaymentInGroup(name: string, dir: -1 | 1) {
  const next = swapWithinGroup(payments.value.map((p) => p.name), (n) => paymentTag(n), name, dir)
  if (next) reorderPayments(next)
}

/** 이름 편집 입력 — 열리면 바로 포커스 + 전체 선택 */
const vFocus = { mounted: (el: HTMLInputElement) => { el.focus(); el.select() } }

/** 추가 폼 인라인 오류 (토스트와 함께 입력창 아래에 표시) */
const categoryError = ref('')
const paymentError = ref('')

const visibleCategoryCount = computed(() => categories.value.filter((c) => !c.hidden).length)
const visiblePaymentCount = computed(() => payments.value.filter((p) => !p.hidden).length)
const savingsPaymentCount = computed(() => payments.value.filter((p) => p.tag === '저축').length)
const consumptionPaymentCount = computed(() => payments.value.length - savingsPaymentCount.value)
</script>

<template>
  <!-- 설정 페이지는 폼 위주라 본문을 너무 넓히지 않는 narrow shell 사용 -->
  <div class="page-shell-narrow section-gap">
    <!-- 페이지 헤더 -->
    <div class="flex items-end justify-between flex-wrap gap-3">
      <div>
        <h2 class="text-xl font-bold text-slate-900">카테고리 · 결제수단 관리</h2>
        <p class="text-sm text-slate-500 mt-1">
          여기서 변경한 목록은 거래내역 화면의 분류 옵션과 필터에 즉시 반영되며 브라우저에 저장됩니다.
          결제수단에 <b>카테고리 매핑</b>을 지정하면 그 결제수단이 선택된 거래의 카테고리가 자동으로 맞춰집니다.
        </p>
      </div>
      <div class="flex gap-2">
        <NuxtLink to="/" class="btn-secondary">← 거래내역으로</NuxtLink>
        <button type="button" class="btn-secondary" @click="onResetAll">기본값으로 초기화</button>
      </div>
    </div>

    <!-- 토스트 -->
    <transition name="toast-drop">
      <div
        v-if="toast"
        :class="[
          'fixed top-6 inset-x-0 mx-auto w-fit text-center z-50 px-4 py-2 rounded-lg shadow text-sm',
          toast.kind === 'ok' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
        ]"
      >
        {{ toast.msg }}
      </div>
    </transition>

    <!-- 백업 복원 오버레이 (dim + 원형 로딩 / 완료 / 오류) -->
    <transition name="fade">
      <div
        v-if="importOverlay.status !== 'idle'"
        class="restore-overlay"
        role="dialog"
        aria-modal="true"
        aria-live="polite"
      >
        <div class="restore-card">
          <!-- 로딩 중 -->
          <div v-if="importOverlay.status === 'loading'" class="restore-icon">
            <svg class="spinner" viewBox="0 0 50 50" width="56" height="56" aria-hidden="true">
              <circle
                class="spinner-track"
                cx="25" cy="25" r="20"
                fill="none" stroke-width="4"
              />
              <circle
                class="spinner-head"
                cx="25" cy="25" r="20"
                fill="none" stroke-width="4"
                stroke-linecap="round"
              />
            </svg>
          </div>
          <!-- 완료 -->
          <div v-else-if="importOverlay.status === 'done'" class="restore-icon restore-icon-ok">
            <svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
              <circle cx="28" cy="28" r="26" fill="none" stroke="currentColor" stroke-width="3"/>
              <path
                d="M16 29 L25 38 L41 20"
                fill="none" stroke="currentColor" stroke-width="4"
                stroke-linecap="round" stroke-linejoin="round"
                class="check-path"
              />
            </svg>
          </div>
          <!-- 오류 -->
          <div v-else class="restore-icon restore-icon-err">
            <svg viewBox="0 0 56 56" width="56" height="56" aria-hidden="true">
              <circle cx="28" cy="28" r="26" fill="none" stroke="currentColor" stroke-width="3"/>
              <path
                d="M20 20 L36 36 M36 20 L20 36"
                fill="none" stroke="currentColor" stroke-width="4"
                stroke-linecap="round"
              />
            </svg>
          </div>

          <div class="restore-text">
            <div class="restore-title">{{ importOverlay.message }}</div>
            <div v-if="importOverlay.detail" class="restore-detail">{{ importOverlay.detail }}</div>
          </div>
        </div>
      </div>
    </transition>

    <!-- 탭: 카테고리 / 결제수단 -->
    <div class="set-tabs" role="tablist">
      <button type="button" role="tab" :aria-selected="activeTab === 'categories'" :class="['set-tab', activeTab === 'categories' ? 'on' : '']" @click="activeTab = 'categories'">
        카테고리 <span class="n">{{ categories.length }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="activeTab === 'payments'" :class="['set-tab', activeTab === 'payments' ? 'on' : '']" @click="activeTab = 'payments'">
        결제수단 <span class="n">{{ payments.length }}</span>
      </button>
      <button type="button" role="tab" :aria-selected="activeTab === 'localCurrency'" :class="['set-tab', activeTab === 'localCurrency' ? 'on' : '']" @click="activeTab = 'localCurrency'">
        지역화폐 <span class="n">{{ prepaidAssets.length }}</span>
      </button>
    </div>

    <div class="grid grid-cols-1 gap-6">
      <!-- 지역화폐(선불 자산) -->
      <LocalCurrencyManager v-if="activeTab === 'localCurrency'" @notify="notify" />

      <!-- 카테고리 카드 -->
      <section v-if="activeTab === 'categories'" class="card">
        <header class="mb-3">
          <div class="sum">
            <div class="sum-main">
              <span class="sum-label">등록된 카테고리</span>
              <span class="sum-big">{{ categories.length }}<small> 개</small></span>
              <span class="sum-sub">거래 {{ totalCategoryUsage.toLocaleString('ko-KR') }}건에 적용 · 활성 {{ visibleCategoryCount }}개</span>
            </div>
            <div class="sum-dist">
              <div class="sum-bar" role="img" :aria-label="categoryStats.map((x) => `${x.label} ${x.count}`).join(', ')">
                <div v-for="x in categoryStats" :key="x.label" :style="{ width: pctOf(x.count, categories.length) + '%', background: x.color }"></div>
              </div>
              <div class="sum-leg">
                <span v-for="x in categoryStats" :key="x.label"><i :style="{ background: x.color }"></i>{{ x.label }} <b>{{ x.count }}</b> · {{ pctOf(x.count, categories.length) }}%</span>
              </div>
            </div>
            <button type="button" class="btn-secondary" title="저장 순서를 ㄱㄴㄷㄹ 순으로 바꿉니다 (모든 메뉴에 동일 적용)" @click="onSortCategoriesAlpha">가나다 정렬</button>
          </div>
        </header>

        <!-- 추가 폼 -->
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <!-- 수입/지출 유형 선택 — 이 카테고리를 쓰는 거래가 어느 쪽으로 집계될지 결정 -->
          <div class="type-toggle" role="group" aria-label="카테고리 유형">
            <button
              type="button"
              :class="['type-toggle-btn', newCategoryType === '지출' ? 'is-expense' : '']"
              @click="newCategoryType = '지출'"
            >지출</button>
            <button
              type="button"
              :class="['type-toggle-btn', newCategoryType === '수입' ? 'is-income' : '']"
              @click="newCategoryType = '수입'"
            >수입</button>
            <button
              type="button"
              :class="['type-toggle-btn', newCategoryType === '이체' ? 'is-transfer' : '']"
              @click="newCategoryType = '이체'"
            >이체</button>
            <button
              type="button"
              :class="['type-toggle-btn', newCategoryType === '저축' ? 'is-savings' : '']"
              @click="newCategoryType = '저축'"
            >저축</button>
            <button
              type="button"
              :class="['type-toggle-btn', newCategoryType === '충전' ? 'is-charge' : '']"
              @click="newCategoryType = '충전'"
            >충전</button>
          </div>
          <input
            v-model="newCategoryName"
            type="text"
            :placeholder="`새 ${newCategoryType} 카테고리 이름`"
            :class="['flex-1 min-w-[10rem] rounded-md text-sm focus:border-brand-500 focus:ring-brand-500', categoryError ? 'border-rose-400' : 'border-slate-300']"
            maxlength="20"
            @input="categoryError = ''"
            @keydown.enter="onAddCategory"
          />
          <label
            v-if="newCategoryType === '지출'"
            class="flex items-center gap-1.5 text-xs text-slate-600 select-none"
          >
            <input v-model="newCategoryFixed" type="checkbox" class="rounded" />
            고정비
          </label>
          <button type="button" class="btn-primary" @click="onAddCategory">추가</button>
          <div v-if="categoryError" class="w-full text-xs text-rose-600" role="alert">{{ categoryError }}</div>
        </div>

        <!-- 목록 -->
        <div v-for="g in categoryGroups" :key="g.type" class="rw-group">
        <div class="rw-grouphead" :style="{ color: g.color }"><i :style="{ background: g.color }"></i>{{ g.type }} · {{ g.items.length }}개</div>
        <ul class="flex flex-col gap-1.5">
          <li
            v-for="{ cat, idx, gi } in g.items"
            :key="cat.name"
            :draggable="editingCategory !== cat.name"
            @dragstart="onCategoryDragStart(idx, $event)"
            @dragover="onCategoryDragOver(idx, $event)"
            @dragleave="onCategoryDragLeave(idx)"
            @drop="onCategoryDrop(idx, $event)"
            @dragend="onCategoryDragEnd"
            :data-type="cat.type ?? '지출'"
            :class="[
              'rw',
              cat.hidden ? 'rw-inactive' : '',
              catUsage(cat.name) > 0 ? 'rw-used' : '',
              draggedCategoryIdx === idx ? 'opacity-40' : '',
              dragOverCategoryIdx === idx && draggedCategoryIdx !== null && draggedCategoryIdx !== idx
                ? 'ring-2 ring-brand-400 ring-inset'
                : ''
            ]"
          >
            <!-- LEFT: 드래그 핸들 · 정렬 · 이름/사용량 · 유형 -->
            <div class="rw-left">
              <span
          class="rw-handle drag-handle"
          title="드래그하여 순서 변경"
          aria-hidden="true"
        >⋮⋮</span>
              <div class="rw-sort">
                <button type="button" :disabled="gi === 0" @click="moveCategoryInGroup(cat.name, -1)" title="위로" aria-label="위로">▲</button>
                <button type="button" :disabled="gi === g.items.length - 1" @click="moveCategoryInGroup(cat.name, 1)" title="아래로" aria-label="아래로">▼</button>
              </div>
              <div class="rw-info">
                <div class="rw-name">
                  <input
                    v-if="editingCategory === cat.name"
                    v-model="editingCategoryName"
                    v-focus
                    type="text"
                    maxlength="20"
                    class="rw-name-input"
                    @keydown.enter="commitEditCategory"
                    @keydown.esc="cancelEditCategory"
                  />
                  <template v-else>
                    <button type="button" class="rw-name-text" :title="`${cat.name} — 클릭하여 이름 변경`" @click="startEditCategory(cat.name)">{{ cat.name }}</button>
                    <span class="rw-count" :title="`전체 거래의 ${pctOf(catUsage(cat.name), totalCategoryUsage)}%`">{{ catUsage(cat.name).toLocaleString('ko-KR') }}건<template v-if="catUsage(cat.name) > 0"> · {{ pctOf(catUsage(cat.name), totalCategoryUsage) }}%</template></span>
                    <span v-if="catUsage(cat.name) > 0" class="rw-mini" aria-hidden="true"><span :style="{ width: Math.max(4, pctOf(catUsage(cat.name), totalCategoryUsage)) + '%' }"></span></span>
                  </template>
                </div>
                <div class="rw-seg" role="group" :aria-label="`${cat.name} 유형`">
                  <button
                    v-for="o in CATEGORY_TYPE_OPTIONS"
                    :key="o.type"
                    type="button"
                    :data-t="o.type"
                    :class="{ on: (cat.type ?? '지출') === o.type }"
                    :title="o.title"
                    @click="onChangeCategoryType(cat.name, o.type)"
                  >{{ o.type }}</button>
                </div>
              </div>
            </div>

            <!-- RIGHT: 고정비 · 활성화 / 액션 -->
            <div class="rw-right">
              <div class="rw-opts">
                <label v-if="(cat.type ?? '지출') !== '충전'" :class="['rw-chk', cat.isFixed ? 'checked' : '']">
                  <input
                    type="checkbox"
                    :checked="cat.isFixed"
                    @change="onToggleFixed(cat.name, ($event.target as HTMLInputElement).checked)"
                  />
                  고정비
                </label>
                <span v-else class="rw-chk rw-chk-na" title="충전 카테고리에는 고정비가 적용되지 않습니다">–</span>

                <label class="rw-switch" :title="cat.hidden ? '비활성화 — 거래내역에서 숨겨집니다' : '활성화 — 거래내역에 표시됩니다'">
                  <input
                    type="checkbox"
                    :checked="!cat.hidden"
                    @change="onToggleCategoryHidden(cat.name, !($event.target as HTMLInputElement).checked)"
                  />
                  <span class="rw-track"></span>
                  <span class="rw-switch-label">{{ cat.hidden ? '비활성' : '활성화' }}</span>
                </label>
              </div>
              <div class="rw-opts">
                <label
                  v-if="(cat.type ?? '지출') !== '충전'"
                  :class="['rw-chk', cat.excludeFromCalc ? 'checked-ex' : '']"
                  :title="excludeTitle(cat.type)"
                >
                  <input
                    type="checkbox"
                    :checked="cat.excludeFromCalc === true"
                    @change="onToggleExcluded(cat.name, ($event.target as HTMLInputElement).checked)"
                  />
                  지출제외
                </label>
                <span v-else class="rw-chk rw-chk-na" title="충전 카테고리에는 지출제외가 적용되지 않습니다">–</span>
              </div>
              <div class="rw-btns">
                <template v-if="editingCategory === cat.name">
                  <button type="button" class="rw-btn rw-btn-primary" @click="commitEditCategory">저장</button>
                  <button type="button" class="rw-btn" @click="cancelEditCategory">취소</button>
                </template>
                <template v-else>
                  <button type="button" class="rw-btn" @click="startEditCategory(cat.name)">이름</button>
                  <button
                    type="button"
                    class="rw-btn rw-btn-danger"
                    :disabled="cat.name === FALLBACK_CATEGORY"
                    :title="cat.name === FALLBACK_CATEGORY ? '폴백 카테고리는 삭제할 수 없습니다' : '삭제'"
                    @click="onRemoveCategory(cat.name)"
                  >삭제</button>
                </template>
              </div>
            </div>
          </li>
        </ul>
        </div>
        <div v-if="categories.length === 0" class="px-3 py-6 text-center text-slate-400 text-sm bg-white">
          카테고리가 비어있습니다.
        </div>
      </section>

      <!-- 결제수단 카드 -->
      <section v-if="activeTab === 'payments'" class="card">
        <header class="mb-3">
          <div class="sum">
            <div class="sum-main">
              <span class="sum-label">등록된 결제수단</span>
              <span class="sum-big">{{ payments.length }}<small> 개</small></span>
              <span class="sum-sub">거래 {{ totalPaymentUsage.toLocaleString('ko-KR') }}건에 적용 · 표시 {{ visiblePaymentCount }}개 · 카테고리 매핑 {{ mappedPaymentCount }}개</span>
            </div>
            <div class="sum-dist">
              <div class="sum-bar" role="img" :aria-label="paymentStats.map((x) => `${x.label} ${x.count}`).join(', ')">
                <div v-for="x in paymentStats" :key="x.label" :style="{ width: pctOf(x.count, payments.length) + '%', background: x.color }"></div>
              </div>
              <div class="sum-leg">
                <span v-for="x in paymentStats" :key="x.label"><i :style="{ background: x.color }"></i>{{ x.label }} <b>{{ x.count }}</b> · {{ pctOf(x.count, payments.length) }}%</span>
              </div>
            </div>
            <button type="button" class="btn-secondary" title="저장 순서를 ㄱㄴㄷㄹ 순으로 바꿉니다 (모든 메뉴에 동일 적용)" @click="onSortPaymentsAlpha">가나다 정렬</button>
          </div>
        </header>

        <!-- 추가 폼 -->
        <div class="flex flex-wrap items-center gap-2 mb-4">
          <!-- 소비/저축 태그 선택 -->
          <div class="type-toggle" role="group" aria-label="결제수단 태그">
            <button
              type="button"
              :class="['type-toggle-btn', newPaymentTag === '소비' ? 'is-consume' : '']"
              @click="newPaymentTag = '소비'"
            >소비</button>
            <button
              type="button"
              :class="['type-toggle-btn', newPaymentTag === '저축' ? 'is-savings' : '']"
              @click="newPaymentTag = '저축'"
            >저축</button>
          </div>
          <input
            v-model="newPaymentName"
            type="text"
            :placeholder="`새 ${newPaymentTag} 결제수단 이름`"
            :class="['flex-1 min-w-[10rem] rounded-md text-sm focus:border-brand-500 focus:ring-brand-500', paymentError ? 'border-rose-400' : 'border-slate-300']"
            maxlength="20"
            @input="paymentError = ''"
            @keydown.enter="onAddPayment"
          />
          <button type="button" class="btn-primary" @click="onAddPayment">추가</button>
          <div v-if="paymentError" class="w-full text-xs text-rose-600" role="alert">{{ paymentError }}</div>
        </div>

        <!-- 목록 -->
        <div v-for="g in paymentGroups" :key="g.tag" class="rw-group">
        <div class="rw-grouphead" :style="{ color: g.color }"><i :style="{ background: g.color }"></i>{{ g.tag }} · {{ g.items.length }}개</div>
        <ul class="flex flex-col gap-1.5">
          <li
            v-for="{ pm, idx, gi } in g.items"
            :key="pm.name"
            :draggable="editingPayment !== pm.name"
            @dragstart="onPaymentDragStart(idx, $event)"
            @dragover="onPaymentDragOver(idx, $event)"
            @dragleave="onPaymentDragLeave(idx)"
            @drop="onPaymentDrop(idx, $event)"
            @dragend="onPaymentDragEnd"
            :data-type="paymentTag(pm.name)"
            :class="[
              'rw rw-col',
              pm.hidden ? 'rw-inactive' : '',
              payUsage(pm.name) > 0 ? 'rw-used' : '',
              draggedPaymentIdx === idx ? 'opacity-40' : '',
              dragOverPaymentIdx === idx && draggedPaymentIdx !== null && draggedPaymentIdx !== idx
                ? 'ring-2 ring-brand-400 ring-inset'
                : ''
            ]"
          >
            <div class="rw-main">
              <!-- LEFT: 드래그 핸들 · 정렬 · 이름/사용량 · 태그 -->
              <div class="rw-left">
                <span
          class="rw-handle drag-handle"
          title="드래그하여 순서 변경"
          aria-hidden="true"
        >⋮⋮</span>
                <div class="rw-sort">
                  <button type="button" :disabled="gi === 0" @click="movePaymentInGroup(pm.name, -1)" title="위로" aria-label="위로">▲</button>
                  <button type="button" :disabled="gi === g.items.length - 1" @click="movePaymentInGroup(pm.name, 1)" title="아래로" aria-label="아래로">▼</button>
                </div>
                <div class="rw-info">
                  <div class="rw-name">
                    <input
                      v-if="editingPayment === pm.name"
                      v-model="editingPaymentName"
                      v-focus
                      type="text"
                      maxlength="20"
                      class="rw-name-input"
                      @keydown.enter="commitEditPayment"
                      @keydown.esc="cancelEditPayment"
                    />
                    <template v-else>
                      <button type="button" class="rw-name-text" :title="`${pm.name} — 클릭하여 이름 변경`" @click="startEditPayment(pm.name)">{{ pm.name }}</button>
                      <span class="rw-count" :title="`전체 거래의 ${pctOf(payUsage(pm.name), totalPaymentUsage)}%`">{{ payUsage(pm.name).toLocaleString('ko-KR') }}건<template v-if="payUsage(pm.name) > 0"> · {{ pctOf(payUsage(pm.name), totalPaymentUsage) }}%</template></span>
                      <span v-if="payUsage(pm.name) > 0" class="rw-mini" aria-hidden="true"><span :style="{ width: Math.max(4, pctOf(payUsage(pm.name), totalPaymentUsage)) + '%' }"></span></span>
                    </template>
                  </div>
                  <div class="rw-seg" role="group" :aria-label="`${pm.name} 태그`">
                    <button
                      type="button"
                      data-t="소비"
                      :class="{ on: paymentTag(pm.name) === '소비' }"
                      title="소비 — 실제로 쓴 돈. 소비 태그에 매핑된 카테고리가 적용됩니다"
                      @click="onChangePaymentTag(pm.name, '소비')"
                    >소비</button>
                    <button
                      type="button"
                      data-t="저축"
                      :class="{ on: paymentTag(pm.name) === '저축' }"
                      title="저축 — 자산으로 옮긴 돈. 저축 태그에 매핑된 카테고리가 적용됩니다"
                      @click="onChangePaymentTag(pm.name, '저축')"
                    >저축</button>
                  </div>
                </div>
              </div>

              <!-- RIGHT: 표시 토글 / 액션 -->
              <div class="rw-right">
                <div class="rw-opts">
                  <label class="rw-switch" :title="pm.hidden ? '숨김 상태 — 거래내역에서 숨겨집니다' : '표시 상태 — 거래내역에 표시됩니다'">
                    <input
                      type="checkbox"
                      :checked="!pm.hidden"
                      @change="onTogglePaymentHidden(pm.name, !($event.target as HTMLInputElement).checked)"
                    />
                    <span class="rw-track"></span>
                    <span class="rw-switch-label">{{ pm.hidden ? '숨김' : '표시' }}</span>
                  </label>
                </div>
                <div class="rw-btns">
                  <template v-if="editingPayment === pm.name">
                    <button type="button" class="rw-btn rw-btn-primary" @click="commitEditPayment">저장</button>
                    <button type="button" class="rw-btn" @click="cancelEditPayment">취소</button>
                  </template>
                  <template v-else>
                    <button type="button" class="rw-btn" @click="startEditPayment(pm.name)">이름</button>
                    <button
                      type="button"
                      class="rw-btn rw-btn-danger"
                      :disabled="pm.name === FALLBACK_PAYMENT"
                      :title="pm.name === FALLBACK_PAYMENT ? '폴백 결제수단은 삭제할 수 없습니다' : '삭제'"
                      @click="onRemovePayment(pm.name)"
                    >삭제</button>
                  </template>
                </div>
              </div>
            </div>

            <!--
              2행: 카테고리 매핑.
              현재 태그에 매핑된 카테고리를 고르면, 이후 이 결제수단이 선택된 거래에
              그 카테고리가 자동 배정된다. 매핑은 태그별로 따로 보관된다.
            -->
            <div class="rw-map">
              <label class="text-[11px] text-slate-500 whitespace-nowrap">
                {{ paymentTag(pm.name) }} 카테고리 매핑
              </label>
              <select
                class="map-select"
                :value="paymentMapValue(pm.name)"
                :title="`'${pm.name}'(${paymentTag(pm.name)}) 선택 시 자동 배정할 카테고리`"
                @change="onChangePaymentCategoryMap(pm.name, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">— 매핑 없음 —</option>
                <option
                  v-if="paymentMapValue(pm.name) && !visibleCategoryNames.includes(paymentMapValue(pm.name))"
                  :value="paymentMapValue(pm.name)"
                >
                  {{ paymentMapValue(pm.name) }} (비활성)
                </option>
                <optgroup label="지출">
                  <option v-for="c in visibleExpenseCategoryNames" :key="`pe-${pm.name}-${c}`" :value="c">{{ c }}</option>
                </optgroup>
                <optgroup v-if="visibleIncomeCategoryNames.length > 0" label="수입">
                  <option v-for="c in visibleIncomeCategoryNames" :key="`pi-${pm.name}-${c}`" :value="c">{{ c }}</option>
                </optgroup>
                <optgroup v-if="visibleSavingsCategoryNames.length > 0" label="저축">
                  <option v-for="c in visibleSavingsCategoryNames" :key="`ps-${pm.name}-${c}`" :value="c">{{ c }}</option>
                </optgroup>
              </select>
              <span
                v-if="isPaymentMapInactive(pm.name)"
                class="text-[11px] text-amber-600"
                title="매핑된 카테고리가 비활성화되어 자동 배정이 적용되지 않습니다. 카테고리를 다시 활성화하면 되살아납니다."
              >비활성 카테고리 — 적용 안 됨</span>
              <span
                v-else-if="paymentMapValue(pm.name)"
                class="text-[11px] text-slate-400"
              >이 결제수단 선택 시 자동 배정</span>
            </div>

            <!-- 3행: 지역화폐 연결 — 한 카드에 여러 지역화폐를 연결할 수 있다 -->
            <div v-if="prepaidAssets.length > 0" class="rw-map">
              <label class="text-[11px] text-slate-500 whitespace-nowrap">지역화폐 연결</label>
              <label
                v-for="pa in prepaidAssets"
                :key="`pl-${pm.name}-${pa.id}`"
                :class="['pl-chip', isPrepaidLinked(pa.id, pm.name) ? 'on' : '', pa.active ? '' : 'off']"
                :title="pa.active ? `${pa.name} — 연결하면 이 카드 거래에 '지역화폐 사용' 체크가 표시됩니다` : `${pa.name} (꺼짐) — 켜기 전까지 체크박스는 표시되지 않습니다`"
              >
                <input
                  type="checkbox"
                  :checked="isPrepaidLinked(pa.id, pm.name)"
                  @change="onTogglePrepaidLink(pa.id, pa.name, pm.name, ($event.target as HTMLInputElement).checked)"
                />{{ pa.name }}
              </label>
            </div>
          </li>
        </ul>
        </div>
        <div v-if="payments.length === 0" class="px-3 py-6 text-center text-slate-400 text-sm bg-white">
          결제수단이 비어있습니다.
        </div>
      </section>
    </div>

    <!-- 백업 / 복원 -->
    <section class="card">
      <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 class="font-semibold text-slate-900">백업 · 복원</h3>
          <p class="text-xs text-slate-500 mt-0.5">
            모든 데이터(카테고리·결제수단·거래내역·수입/지출·가족·카드·자산·대출·예금적금·계약·기념일)를 하나의 JSON으로 내보내거나 되돌립니다.
            내보내기는 아직 저장하지 않은 거래내역 변경까지 현재 화면 그대로 담습니다.
          </p>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn-secondary" @click="onExportBackup">
            <span class="inline-block mr-1">⬇</span> JSON 내보내기
          </button>
          <button type="button" class="btn-primary" @click="onPickBackupFile">
            <span class="inline-block mr-1">⬆</span> JSON 가져오기
          </button>
          <input
            ref="backupFileInput"
            type="file"
            accept="application/json,.json"
            class="hidden"
            @change="onBackupFileChange"
          />
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3 text-xs">
        <span class="text-slate-500">가져오기 방식:</span>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" v-model="importStrategy" value="replace" />
          <span class="text-slate-700"><b>덮어쓰기</b> — 백업 파일의 키를 그대로 적용</span>
        </label>
        <label class="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" v-model="importStrategy" value="merge" />
          <span class="text-slate-700"><b>병합</b> — 기존 데이터에 추가/갱신</span>
        </label>
      </div>

      <p class="mt-3 text-[11px] text-slate-400">
        가져오기 직후 페이지가 자동으로 새로고침됩니다.
      </p>
    </section>

    <!-- 안내 박스 -->
    <section class="card bg-slate-50 border-slate-200">
      <h4 class="text-sm font-semibold text-slate-700">사용 가이드</h4>
      <ul class="mt-2 text-xs text-slate-600 space-y-1 list-disc list-inside">
        <li>카테고리 이름을 변경하면 해당 카테고리를 사용 중인 거래도 자동으로 새 이름으로 갱신됩니다.</li>
        <li>삭제 시 사용 중인 거래는 폴백 항목('{{ FALLBACK_CATEGORY }}' / '{{ FALLBACK_PAYMENT }}')으로 이동된 뒤 목록에서 제거됩니다.</li>
        <li><b>활성화/비활성화</b> 체크박스는 항목을 삭제하지 않고 거래내역의 필터·편집 드롭다운에서만 가립니다. 비활성화된 카테고리를 이미 사용 중인 거래는 그대로 유지됩니다.</li>
        <li><b>카테고리·결제수단 순서</b>는 좌측 ▲▼ 버튼 또는 행을 드래그하여 변경할 수 있습니다.</li>
        <li><b>지출제외</b>를 켜면 그 카테고리의 모든 거래가 대시보드·거래내역 합계·차트·수입/지출 관리 합계에서 빠집니다(목록에는 남고 '제외' 배지가 붙습니다). 지출은 지출 합계에서, 수입은 수입 합계에서 빠지고, 저축은 켜도 대시보드 저축 구성에 계속 집계되며, 이체는 원래 집계 대상이 아니라 설정값만 저장됩니다. 고정비·지출제외는 충전을 뺀 모든 유형에서 설정할 수 있습니다. 끄면 바로 복귀하며, 거래별로 직접 제외한 표시는 그대로 유지됩니다.</li>
        <li>고정비 체크는 새로 입력되거나 자동 분류되는 거래의 기본값에 영향을 주지만, 이미 입력된 거래의 구분 값을 강제로 바꾸지는 않습니다.</li>
        <li><b>수입 / 지출</b> 유형은 그 카테고리를 사용하는 <b>모든 거래</b>에 즉시 적용됩니다. 수입 카테고리의 거래는 지출 합계·차트에서 빠지고 수입으로 집계됩니다. 기존 카테고리는 모두 <b>지출</b>로 유지됩니다.</li>
        <li><b>결제수단 태그(소비 / 저축)</b>는 그 결제수단으로 나간 돈의 성격을 표시합니다. 태그는 합계·차트 계산 규칙을 바꾸지 않습니다 — 수입/지출 집계는 여전히 카테고리 유형이 결정합니다. 기존 결제수단은 모두 <b>소비</b>로 유지됩니다.</li>
        <li><b>카테고리 매핑</b>을 지정하면 그 결제수단이 선택된 거래에 매핑 카테고리가 자동 배정됩니다. 적용 시점은 ① 거래내역에서 결제수단을 바꿀 때 ② 거래를 수기로 추가할 때 ③ 엑셀·CSV를 업로드할 때입니다. 매핑을 지정하지 않으면 아무 것도 자동으로 바뀌지 않습니다.</li>
        <li>매핑은 <b>태그별로 따로</b> 보관됩니다. 소비/저축 태그를 바꾸면 그 태그에 저장된 매핑이 적용되며, 반대쪽 매핑 값은 그대로 남아 있습니다.</li>
        <li>자동 배정은 거래의 기존 카테고리를 덮어씁니다. 단 <b>'{{ REFUND_CATEGORY_LABEL }}' 거래는 제외</b>되며, 이미 저장된 거래의 카테고리는 결제수단을 다시 선택하지 않는 한 바뀌지 않습니다.</li>
        <li>이 페이지에서 변경한 목록은 브라우저(localStorage)에 저장되어 새로고침 후에도 유지됩니다.</li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.btn-primary {
  @apply px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50;
}
.btn-secondary {
  @apply px-3 py-1.5 rounded-md border border-slate-300 bg-white text-slate-700 text-sm font-medium hover:bg-slate-50;
}
.btn-mini {
  @apply whitespace-nowrap shrink-0 px-2 py-0.5 rounded border border-slate-300 bg-white text-slate-600 text-xs hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed;
}
.btn-mini-active {
  @apply bg-slate-700 text-white border-slate-700 hover:bg-slate-800;
}
.btn-mini-primary {
  @apply whitespace-nowrap shrink-0 px-2 py-0.5 rounded bg-brand-600 text-white text-xs hover:bg-brand-700;
}
.btn-mini-danger {
  @apply whitespace-nowrap shrink-0 px-2 py-0.5 rounded border border-rose-200 bg-white text-rose-600 text-xs hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed;
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* ─────────────────────────────────────────
 * 복원 오버레이 (dim + 원형 로딩/완료/오류)
 * ───────────────────────────────────────── */
.restore-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(15, 23, 42, 0.55);
  backdrop-filter: blur(2px);
}
.restore-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 32px 40px;
  min-width: 300px;
  max-width: 440px;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 50px -12px rgba(0, 0, 0, 0.3);
  text-align: center;
}
.restore-icon {
  color: rgb(37 99 235); /* brand blue */
}
.restore-icon-ok { color: rgb(16 185 129); }
.restore-icon-err { color: rgb(220 38 38); }
.restore-title {
  font-size: 15px;
  font-weight: 700;
  color: rgb(15 23 42);
}
.restore-detail {
  margin-top: 4px;
  font-size: 12px;
  color: rgb(100 116 139);
  line-height: 1.5;
}

/* 스피너 */
.spinner { animation: spinner-rotate 1.4s linear infinite; }
.spinner-track { stroke: rgb(226 232 240); }
.spinner-head {
  stroke: currentColor;
  stroke-dasharray: 90, 200;
  stroke-dashoffset: 0;
  animation: spinner-dash 1.4s ease-in-out infinite;
}
@keyframes spinner-rotate { to { transform: rotate(360deg); } }
@keyframes spinner-dash {
  0% { stroke-dasharray: 1, 200; stroke-dashoffset: 0; }
  50% { stroke-dasharray: 90, 200; stroke-dashoffset: -35; }
  100% { stroke-dasharray: 90, 200; stroke-dashoffset: -125; }
}

/* 완료 체크 애니메이션 */
.check-path {
  stroke-dasharray: 60;
  stroke-dashoffset: 60;
  animation: check-draw 0.45s ease-out 0.1s forwards;
}
@keyframes check-draw { to { stroke-dashoffset: 0; } }

/* ─────────────────────────────────────────
 * 수입 / 지출 유형 토글
 * ───────────────────────────────────────── */
.type-toggle {
  display: inline-flex;
  flex-shrink: 0;
  border: 1px solid rgb(226 232 240);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.type-toggle-btn {
  white-space: nowrap;
  padding: 4px 10px;
  font-size: 12px;
  line-height: 1.2;
  color: rgb(100 116 139);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.type-toggle-btn:hover {
  background: rgb(248 250 252);
}
.type-toggle-btn.is-expense {
  background: rgb(254 242 242);
  color: rgb(190 18 60);
  font-weight: 700;
}
.type-toggle-btn.is-income {
  background: rgb(239 246 255);
  color: rgb(29 78 216);
  font-weight: 700;
}
.type-toggle-btn.is-transfer {
  background: rgb(245 243 255);
  color: rgb(109 40 217);
  font-weight: 700;
}
/* 결제수단 태그 — 소비 / 저축 */
.type-toggle-btn.is-consume {
  background: rgb(255 251 235);
  color: rgb(180 83 9);
  font-weight: 700;
}
.type-toggle-btn.is-charge {
  background: rgb(240 249 255);
  color: rgb(3 105 161);
  font-weight: 700;
}
.type-toggle-btn.is-savings {
  background: rgb(240 253 250);
  color: rgb(15 118 110);
  font-weight: 700;
}
.type-toggle-sm .type-toggle-btn {
  padding: 2px 7px;
  font-size: 11px;
}

/* 결제수단 → 카테고리 매핑 select */
.map-select {
  @apply rounded-md border-slate-300 text-xs py-0.5 pr-7 pl-2 bg-white text-slate-700
         focus:border-brand-500 focus:ring-brand-500 min-w-[9rem];
}

/* ─────────────────────────────────────────
 * 카테고리 / 결제수단 행 (rw-*)
 * 좌: 핸들 · 정렬 · 이름(+사용량) / 유형   우: 옵션(고정비·활성화) / 액션
 * 좌·우 모두 2줄 구조, 줄 높이(--h)와 줄 간격(--gap-y)을 통일한다.
 * ───────────────────────────────────────── */
.rw {
  --h: 28px; --gap-y: 6px;
  --c-expense: #e5484d; --c-income: #2f7cf6; --c-transfer: #7c5cf0; --c-saving: #f59e0b; --c-charge: #0ea5e9;
  --c-consume: #d97706; --c-pay-saving: #0d9488;
  --c-on: #16a34a; --c-danger: #e5484d; --c-line: #e3e7ee; --c-sub: #6b7280;
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 8px 12px; background: #fff;
  border: 1px solid var(--c-line); border-left: 4px solid var(--accent, var(--c-line));
  border-radius: 8px; transition: box-shadow .15s, opacity .15s;
}
.rw:hover { box-shadow: 0 2px 10px rgba(0, 0, 0, .07); }
.rw-inactive { opacity: .55; }
.rw[data-type='지출'] { --accent: var(--c-expense); }
.rw[data-type='수입'] { --accent: var(--c-income); }
.rw[data-type='이체'] { --accent: var(--c-transfer); }
.rw[data-type='저축'] { --accent: var(--c-saving); }
.rw[data-type='충전'] { --accent: var(--c-charge); }
.rw[data-type='소비'] { --accent: var(--c-consume); }
/* 결제수단은 '저축' 태그 색이 카테고리 저축(amber)과 달라 teal 을 쓴다 */
.rw-col[data-type='저축'] { --accent: var(--c-pay-saving); }

/* 결제수단: 1행(rw-main) + 2행(매핑) 세로 구조 */
.rw-col { flex-direction: column; align-items: stretch; justify-content: flex-start; gap: 6px; }
.rw-main { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.rw-map {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
  padding-top: 6px; border-top: 1px dashed var(--c-line);
}

.rw-left { display: flex; align-items: center; gap: 12px; flex: 1 1 0; min-width: 0; }
.rw-info, .rw-right { display: flex; flex-direction: column; gap: var(--gap-y); }
.rw-info { align-items: flex-start; flex: 1 1 0; min-width: 0; }
.rw-right { align-items: stretch; flex: 0 0 auto; }

.rw-handle { cursor: grab; color: #aab2c0; font-size: 18px; letter-spacing: -2px; user-select: none; }
.rw-handle:active { cursor: grabbing; }
.rw-sort { display: flex; flex-direction: column; }
.rw-sort button {
  border: 0; background: none; padding: 0 4px; line-height: 14px; font-size: 12px;
  color: #8b93a3; cursor: pointer; border-radius: 4px;
}
.rw-sort button:hover:not(:disabled) { background: #eef1f6; color: #1f2937; }
.rw-sort button:disabled { opacity: .3; cursor: default; }

/* 이름: 말줄임 없이 줄바꿈, 사용량은 이름 옆 */
.rw-name { display: flex; align-items: center; gap: 8px; width: 100%; min-height: var(--h); min-width: 0; }
.rw-name-text {
  font-size: 14px; font-weight: 600; color: #1f2937; text-align: left;
  word-break: keep-all; overflow-wrap: anywhere; min-width: 0;
}
.rw-name-text:hover { text-decoration: underline; }
.rw-count { flex: none; font-size: 12px; color: #9aa3b2; font-variant-numeric: tabular-nums; white-space: nowrap; }
.rw-name-input {
  width: 100%; height: var(--h); font: inherit; font-size: 13px; padding: 0 8px;
  border: 2px solid var(--c-income); border-radius: 8px; outline: none;
}

/* 유형 세그먼트 */
.rw-seg {
  display: inline-flex; align-items: stretch; gap: 2px; height: var(--h);
  background: #eef1f6; border-radius: 8px; padding: 2px; flex: none;
}
.rw-seg button {
  border: 0; background: transparent; padding: 0 10px; min-width: 44px; font-size: 12px;
  color: var(--c-sub); border-radius: 8px; cursor: pointer; white-space: nowrap; transition: all .12s;
}
.rw-seg button:hover { color: #1f2937; }
.rw-seg button.on { color: #fff; font-weight: 700; box-shadow: 0 1px 3px rgba(0, 0, 0, .2); }
.rw-seg button.on[data-t='지출'] { background: var(--c-expense); }
.rw-seg button.on[data-t='수입'] { background: var(--c-income); }
.rw-seg button.on[data-t='이체'] { background: var(--c-transfer); }
.rw-seg button.on[data-t='저축'] { background: var(--c-saving); }
.rw-seg button.on[data-t='충전'] { background: var(--c-charge); }
.rw-col .rw-seg button.on[data-t='소비'] { background: var(--c-consume); }
.rw-col .rw-seg button.on[data-t='저축'] { background: var(--c-pay-saving); }

/* 옵션 줄: 고정비 칩 + 활성화 스위치 */
.rw-opts { display: flex; align-items: center; justify-content: space-between; gap: 16px; height: var(--h); }
.rw-chk {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 100%; min-width: 72px;
  padding: 0 8px; font-size: 12px; cursor: pointer; user-select: none; white-space: nowrap;
  border: 1px solid var(--c-line); border-radius: 8px; background: #fff;
}
.rw-chk input { width: 16px; height: 16px; accent-color: var(--c-income); cursor: pointer; }
.rw-chk.checked { border-color: var(--c-income); background: #eef4ff; color: var(--c-income); font-weight: 600; }
.rw-chk.checked-ex { border-color: var(--c-consume); background: #fff7ed; color: var(--c-consume); font-weight: 600; }
.rw-chk.checked-ex input { accent-color: var(--c-consume); }
.rw-chk-na { color: #cbd2de; cursor: default; background: transparent; border-style: dashed; }

.rw-switch { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; user-select: none; white-space: nowrap; }
.rw-switch input { display: none; }
.rw-track { width: 38px; height: 22px; border-radius: 99px; background: #c9cfdb; position: relative; transition: background .15s; flex: none; }
.rw-track::after {
  content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform .15s; box-shadow: 0 1px 2px rgba(0, 0, 0, .3);
}
.rw-switch input:checked + .rw-track { background: var(--c-on); }
.rw-switch input:checked + .rw-track::after { transform: translateX(16px); }
.rw-switch-label { min-width: 44px; font-weight: 600; color: var(--c-sub); }
.rw-switch input:checked ~ .rw-switch-label { color: var(--c-on); }

/* 액션 버튼 */
.rw-btns { display: flex; justify-content: flex-end; gap: 8px; height: var(--h); }
.rw-btn {
  height: 100%; padding: 0 12px; font-size: 12px; border-radius: 6px; cursor: pointer; white-space: nowrap;
  background: #fff; border: 1px solid #c9cfdb; color: #1f2937;
}
.rw-btn:hover:not(:disabled) { background: #f3f5f9; }
.rw-btn:disabled { opacity: .4; cursor: not-allowed; }
.rw-btn-primary { background: var(--c-income); border-color: var(--c-income); color: #fff; }
.rw-btn-primary:hover:not(:disabled) { background: #1f6be0; }
.rw-btn-danger { color: var(--c-danger); border-color: #f3b4b6; }
.rw-btn-danger:hover:not(:disabled) { background: var(--c-danger); color: #fff; border-color: var(--c-danger); }
.rw-btn:focus-visible, .rw-seg button:focus-visible { outline: 2px solid var(--c-income); outline-offset: 2px; }

/* 결제수단 행의 지역화폐 연결 칩 */
.pl-chip { display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 9px; font-size: 11px; border: 1px solid #c9cfdb; border-radius: 999px; background: #fff; color: #3b4658; cursor: pointer; user-select: none; }
.pl-chip input { accent-color: #1b55c9; }
.pl-chip.on { background: #eaf1fd; border-color: #1b55c9; color: #123a8a; font-weight: 600; }
.pl-chip.off { opacity: .55; }

/* 탭 */
.set-tabs { display: flex; gap: 4px; border-bottom: 1px solid #e1e6ee; }
.set-tab {
  display: inline-flex; align-items: center; gap: 6px; height: 38px; padding: 0 16px; margin-bottom: -1px;
  font-size: 14px; font-weight: 500; color: #566074; background: transparent; border: 0;
  border-bottom: 3px solid transparent; cursor: pointer;
}
.set-tab:hover { color: #1f2937; }
.set-tab.on { color: #123a8a; font-weight: 700; border-bottom-color: #1b55c9; }
.set-tab .n { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #eef1f6; color: #566074; }
.set-tab.on .n { background: #e8effc; color: #123a8a; }

/* 요약: 총 개수 + 유형 분포 막대 */
.sum { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 28px; }
.sum-main { display: flex; flex-direction: column; gap: 2px; min-width: 150px; }
.sum-label { font-size: 12px; color: #566074; }
.sum-big { font-size: 28px; font-weight: 800; line-height: 1.1; letter-spacing: -.5px; color: #141a24; }
.sum-big small { font-size: 13px; font-weight: 500; color: #566074; letter-spacing: 0; }
.sum-sub { font-size: 12px; color: #8993a6; }
.sum-dist { flex: 1; min-width: 220px; display: flex; flex-direction: column; gap: 6px; }
.sum-bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; gap: 2px; background: #eef1f6; }
.sum-bar > div { transition: width .25s; }
.sum-leg { display: flex; flex-wrap: wrap; gap: 2px 14px; font-size: 12px; color: #3b4658; }
.sum-leg i { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }

/* 유형(태그)별 그룹 */
.rw-group + .rw-group { margin-top: 10px; }
.rw-grouphead { display: flex; align-items: center; gap: 8px; padding: 6px 2px 6px; font-size: 12px; font-weight: 700; }
.rw-grouphead i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }
.rw-used { background: #f8faff; }
.rw-mini { flex: none; width: 56px; height: 4px; border-radius: 2px; background: #e4e9f1; overflow: hidden; }
.rw-mini > span { display: block; height: 100%; background: var(--accent, #1b55c9); border-radius: 2px; }

/* 좁은 화면: 좌 → 우 순서로 세로 쌓기 */
@media (max-width: 720px) {
  .rw:not(.rw-col), .rw-main { flex-direction: column; align-items: stretch; }
  .rw-btns .rw-btn { flex: 1; }
}
</style>
