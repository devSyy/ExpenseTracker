<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface Tx { id: string; date: string; amount: number; description: string }

const STORAGE_KEY = 'tx-store:v1'
const META_KEY = 'tx-store:meta:v1'

// ── state ──
const txs = ref<Tx[]>(load())
const meta = ref<{ source: string; importedAt: string } | null>(loadMeta())
const message = ref<string>('')

// new-row form
const draft = ref<Tx>(emptyDraft())
function emptyDraft(): Tx {
  return { id: '', date: new Date().toISOString().slice(0, 10), amount: 0, description: '' }
}

// inline edit
const editingId = ref<string | null>(null)
const editDraft = ref<Tx>(emptyDraft())

// ── persistence ──
function load(): Tx[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isValidTx) : []
  } catch { return [] }
}
function loadMeta() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(META_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
watch(txs, (v) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) } catch {}
}, { deep: true })
watch(meta, (v) => {
  try {
    if (v) localStorage.setItem(META_KEY, JSON.stringify(v))
    else localStorage.removeItem(META_KEY)
  } catch {}
}, { deep: true })

function isValidTx(x: unknown): x is Tx {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.id === 'string'
      && typeof o.date === 'string'
      && typeof o.amount === 'number' && Number.isFinite(o.amount)
      && typeof o.description === 'string'
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// ── CRUD ──
function create(t: Omit<Tx, 'id'>): Tx | null {
  const date = (t.date || '').trim()
  const description = (t.description || '').trim()
  const amount = Number(t.amount)
  if (!date || !Number.isFinite(amount)) {
    message.value = 'date and numeric amount are required.'
    return null
  }
  const row: Tx = { id: uid(), date, amount, description }
  txs.value = [...txs.value, row]
  message.value = `Created ${row.id}.`
  return row
}

function update(id: string, patch: Partial<Omit<Tx, 'id'>>): boolean {
  const i = txs.value.findIndex((t) => t.id === id)
  if (i === -1) { message.value = 'Not found.'; return false }
  const next = txs.value.slice()
  next[i] = { ...next[i], ...patch, amount: Number(patch.amount ?? next[i].amount) }
  txs.value = next
  message.value = `Updated ${id}.`
  return true
}

function remove(id: string): boolean {
  const before = txs.value.length
  txs.value = txs.value.filter((t) => t.id !== id)
  const ok = txs.value.length < before
  message.value = ok ? `Deleted ${id}.` : 'Not found.'
  return ok
}

function read(id: string): Tx | undefined {
  return txs.value.find((t) => t.id === id)
}

function clearAll() {
  if (!window.confirm('Clear all transactions and metadata?')) return
  txs.value = []
  meta.value = null
  message.value = 'Cleared.'
}

// ── one-time Excel → JSON import ──
// SheetJS is dynamically imported only when the user uploads a file.
// After initial import there is no further Excel dependency at runtime.
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array', cellDates: true })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })
    const imported: Tx[] = rows.map((r) => normalizeRow(r)).filter((x): x is Tx => x !== null)
    if (imported.length === 0) { message.value = 'No valid rows found.'; return }
    txs.value = imported
    meta.value = { source: file.name, importedAt: new Date().toISOString() }
    message.value = `Imported ${imported.length} from "${file.name}". Excel is no longer needed.`
  } catch (err) {
    message.value = `Import failed: ${(err as Error).message}`
  } finally {
    input.value = ''
  }
}

function normalizeRow(r: Record<string, unknown>): Tx | null {
  const get = (...keys: string[]) => {
    for (const k of Object.keys(r)) {
      const lk = k.trim().toLowerCase()
      if (keys.some((c) => lk === c || lk.includes(c))) return r[k]
    }
    return undefined
  }
  const dateRaw = get('date', '날짜', '일자')
  const amtRaw = get('amount', '금액', '지출')
  const descRaw = get('description', '내용', '적요', '메모', '가맹점')
  const date = toDateStr(dateRaw)
  const amount = toNum(amtRaw)
  if (!date || amount === null) return null
  return {
    id: uid(),
    date,
    amount,
    description: String(descRaw ?? '').trim()
  }
}

function toDateStr(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  if (typeof v === 'number' && Number.isFinite(v)) {
    const epoch = new Date(Date.UTC(1899, 11, 30))
    const d = new Date(epoch.getTime() + v * 86400000)
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  if (typeof v === 'string') {
    const s = v.trim().replace(/\./g, '-').replace(/\//g, '-')
    const d = new Date(s)
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
  }
  return null
}
function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s₩$￦원()]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

// ── export / import JSON (no Excel) ──
function exportJSON() {
  const blob = new Blob([JSON.stringify(txs.value, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'transactions.json'
  a.click()
  URL.revokeObjectURL(url)
}
async function importJSON(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) throw new Error('Not an array')
    const valid = parsed.filter(isValidTx)
    txs.value = valid
    message.value = `Imported ${valid.length} from JSON.`
  } catch (err) {
    message.value = `JSON import failed: ${(err as Error).message}`
  } finally {
    input.value = ''
  }
}

// ── form actions ──
function onCreate() {
  const r = create({ date: draft.value.date, amount: draft.value.amount, description: draft.value.description })
  if (r) draft.value = emptyDraft()
}
function startEdit(t: Tx) {
  editingId.value = t.id
  editDraft.value = { ...t }
}
function commitEdit() {
  if (!editingId.value) return
  update(editingId.value, {
    date: editDraft.value.date,
    amount: editDraft.value.amount,
    description: editDraft.value.description
  })
  editingId.value = null
}
function cancelEdit() { editingId.value = null }

const total = computed(() => txs.value.reduce((s, t) => s + t.amount, 0))
</script>

<template>
  <div style="font-family:system-ui,sans-serif;max-width:920px;margin:24px auto;padding:0 16px;color:#111">
    <h2 style="margin:0 0 6px">Transaction Store (local JSON)</h2>
    <p style="color:#666;font-size:13px;margin:0 0 14px">
      One-time Excel import → JSON in localStorage. CRUD locally; persists across sessions.
    </p>

    <!-- Initial import / migration -->
    <section style="margin-bottom:14px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;font-size:13px">
        <strong>Source:</strong>
        <span v-if="meta">{{ meta.source }} · imported {{ meta.importedAt.slice(0,16).replace('T',' ') }}</span>
        <span v-else style="color:#9ca3af">no excel imported yet (or already migrated to JSON)</span>
      </div>
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px;font-size:13px">
        <label>
          <span style="color:#6b7280">Excel (one-time):</span>
          <input type="file" accept=".xlsx,.xls,.csv" @change="onFile" />
        </label>
        <label>
          <span style="color:#6b7280">JSON:</span>
          <input type="file" accept="application/json" @change="importJSON" />
        </label>
        <button type="button" @click="exportJSON">Export JSON</button>
        <button type="button" @click="clearAll" style="margin-left:auto;color:#b91c1c">Clear all</button>
      </div>
    </section>

    <!-- Create form -->
    <section style="margin-bottom:14px;padding:10px 12px;border:1px solid #e5e7eb;border-radius:8px">
      <strong style="display:block;margin-bottom:6px">Add transaction</strong>
      <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:13px">
        <input v-model="draft.date" type="date" />
        <input v-model.number="draft.amount" type="number" step="any" placeholder="amount" style="width:120px" />
        <input v-model="draft.description" type="text" placeholder="description" style="flex:1;min-width:160px" />
        <button type="button" @click="onCreate">Add</button>
      </div>
    </section>

    <div v-if="message" style="margin-bottom:8px;font-size:12px;color:#374151">{{ message }}</div>

    <!-- Table -->
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f9fafb;text-align:left">
          <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">date</th>
          <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">description</th>
          <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">amount</th>
          <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb;width:1%"></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="t in txs" :key="t.id">
          <tr v-if="editingId !== t.id" style="border-bottom:1px solid #f3f4f6">
            <td style="padding:6px 8px;font-variant-numeric:tabular-nums">{{ t.date }}</td>
            <td style="padding:6px 8px">{{ t.description }}</td>
            <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums">
              {{ t.amount.toLocaleString() }}
            </td>
            <td style="padding:6px 8px;white-space:nowrap">
              <button type="button" @click="startEdit(t)" style="font-size:11px">edit</button>
              <button type="button" @click="remove(t.id)" style="font-size:11px;color:#b91c1c">del</button>
            </td>
          </tr>
          <tr v-else style="border-bottom:1px solid #f3f4f6;background:#fffbea">
            <td style="padding:4px 6px"><input v-model="editDraft.date" type="date" /></td>
            <td style="padding:4px 6px"><input v-model="editDraft.description" type="text" style="width:100%" /></td>
            <td style="padding:4px 6px;text-align:right">
              <input v-model.number="editDraft.amount" type="number" step="any" style="width:120px;text-align:right" />
            </td>
            <td style="padding:4px 6px;white-space:nowrap">
              <button type="button" @click="commitEdit" style="font-size:11px">save</button>
              <button type="button" @click="cancelEdit" style="font-size:11px">cancel</button>
            </td>
          </tr>
        </template>
        <tr v-if="txs.length === 0">
          <td colspan="4" style="padding:24px;text-align:center;color:#9ca3af">
            No transactions. Import an Excel file or add one above.
          </td>
        </tr>
      </tbody>
      <tfoot v-if="txs.length > 0">
        <tr>
          <td colspan="2" style="padding:8px;color:#6b7280">{{ txs.length }} txs</td>
          <td style="padding:8px;text-align:right;font-variant-numeric:tabular-nums;font-weight:600">
            {{ total.toLocaleString() }}
          </td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
