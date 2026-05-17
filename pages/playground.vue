<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface Tx { date: string; amount: number; description: string }

const STORAGE_KEY = 'playground:tx:v1'

// ── state ──
const txs = ref<Tx[]>(load())
const sortKey = ref<'date' | 'amount'>('date')
const sortDir = ref<'asc' | 'desc'>('desc')
const bulkInput = ref<string>('')
const message = ref<string>('')

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

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(txs.value))
    message.value = `Saved ${txs.value.length} txs to localStorage.`
  } catch (e) {
    message.value = `Save failed: ${(e as Error).message}`
  }
}

function reload() {
  txs.value = load()
  message.value = `Loaded ${txs.value.length} txs from localStorage.`
}

function clearAll() {
  txs.value = []
  localStorage.removeItem(STORAGE_KEY)
  message.value = 'Cleared.'
}

// auto-save on every change
watch(txs, () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(txs.value)) } catch {}
}, { deep: true })

// ── validation ──
function isValidTx(x: unknown): x is Tx {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return typeof o.date === 'string'
      && typeof o.amount === 'number' && Number.isFinite(o.amount)
      && typeof o.description === 'string'
}

// ── sort ──
const sorted = computed<Tx[]>(() => {
  const arr = txs.value.slice()
  const dir = sortDir.value === 'asc' ? 1 : -1
  arr.sort((a, b) => {
    if (sortKey.value === 'date') {
      const da = Date.parse(a.date), db = Date.parse(b.date)
      return (da - db) * dir
    }
    return (a.amount - b.amount) * dir
  })
  return arr
})

function setSort(key: 'date' | 'amount') {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortKey.value = key
    sortDir.value = 'desc'
  }
}

// ── bulk add ──
function bulkAdd() {
  const raw = bulkInput.value.trim()
  if (!raw) { message.value = 'Empty input.'; return }
  let parsed: unknown
  try { parsed = JSON.parse(raw) }
  catch (e) { message.value = `Parse error: ${(e as Error).message}`; return }
  if (!Array.isArray(parsed)) { message.value = 'Input must be a JSON array.'; return }
  const valid: Tx[] = []
  const errors: string[] = []
  parsed.forEach((item, i) => {
    if (isValidTx(item)) valid.push(item)
    else errors.push(`#${i}`)
  })
  txs.value = [...txs.value, ...valid]
  bulkInput.value = ''
  message.value = `Added ${valid.length}.${errors.length ? ` Skipped: ${errors.join(',')}` : ''}`
}

function fillSample() {
  bulkInput.value = JSON.stringify([
    { date: '2026-04-01', amount: 12000, description: 'Lunch' },
    { date: '2026-04-15', amount: 38000, description: 'Groceries' },
    { date: '2026-04-20', amount: 4500,  description: 'Coffee' }
  ], null, 2)
}

function removeAt(i: number) {
  // i is index in `sorted`; map back to txs by reference equality
  const target = sorted.value[i]
  const idx = txs.value.indexOf(target)
  if (idx >= 0) txs.value.splice(idx, 1)
}
</script>

<template>
  <div style="font-family:system-ui,sans-serif;max-width:880px;margin:24px auto;padding:0 16px;color:#111">
    <h2 style="margin:0 0 8px">Transactions Playground</h2>
    <p style="color:#666;font-size:13px;margin:0 0 16px">
      Sort · Bulk add · localStorage persist. Schema: <code>{ date, amount, description }</code>.
    </p>

    <!-- Bulk add -->
    <section style="margin-bottom:16px;padding:12px;border:1px solid #e5e7eb;border-radius:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <strong>Bulk add (JSON array)</strong>
        <button type="button" @click="fillSample" style="font-size:12px">sample</button>
      </div>
      <textarea
        v-model="bulkInput"
        rows="6"
        placeholder='[{"date":"2026-04-01","amount":12000,"description":"Lunch"}]'
        style="width:100%;font-family:monospace;font-size:12px;padding:8px;box-sizing:border-box;border:1px solid #d1d5db;border-radius:6px"
      ></textarea>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button type="button" @click="bulkAdd">Add</button>
        <button type="button" @click="save">Save</button>
        <button type="button" @click="reload">Reload</button>
        <button type="button" @click="clearAll" style="margin-left:auto;color:#b91c1c">Clear all</button>
      </div>
      <div v-if="message" style="margin-top:8px;font-size:12px;color:#374151">{{ message }}</div>
    </section>

    <!-- Sort controls -->
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;font-size:13px">
      <span style="color:#6b7280">Sort by:</span>
      <button type="button" @click="setSort('date')">
        date {{ sortKey === 'date' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}
      </button>
      <button type="button" @click="setSort('amount')">
        amount {{ sortKey === 'amount' ? (sortDir === 'asc' ? '▲' : '▼') : '' }}
      </button>
      <span style="margin-left:auto;color:#6b7280">{{ sorted.length }} txs</span>
    </div>

    <!-- Table -->
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f9fafb;text-align:left">
          <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">date</th>
          <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb">description</th>
          <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">amount</th>
          <th style="padding:6px 8px;border-bottom:1px solid #e5e7eb"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(t, i) in sorted" :key="i" style="border-bottom:1px solid #f3f4f6">
          <td style="padding:6px 8px;font-variant-numeric:tabular-nums">{{ t.date }}</td>
          <td style="padding:6px 8px">{{ t.description }}</td>
          <td style="padding:6px 8px;text-align:right;font-variant-numeric:tabular-nums">
            {{ t.amount.toLocaleString() }}
          </td>
          <td style="padding:6px 8px;text-align:right">
            <button type="button" @click="removeAt(i)" style="font-size:11px;color:#b91c1c">×</button>
          </td>
        </tr>
        <tr v-if="sorted.length === 0">
          <td colspan="4" style="padding:24px;text-align:center;color:#9ca3af">No transactions.</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
