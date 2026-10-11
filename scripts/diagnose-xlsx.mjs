// 사용법: node scripts/diagnose-xlsx.mjs <파일> [검색어]
// 예)    node scripts/diagnose-xlsx.mjs "C:\Users\ysy\Downloads\가계부.xlsx" 청년도약
//
// 파서(utils/classify.ts)와 같은 함수로 모든 시트를 훑어서
//  - 시트별 헤더 행 / 인식된 열 / 총 행 / 채택 가능 행 / 스킵 사유별 건수
//  - 검색어가 들어간 원본 행이 "채택됨 / 스킵(사유)" 중 어디인지
// 를 출력한다. 앱 저장 단계의 중복 제거(append)는 여기서 따로 계산한다.
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import XLSX from 'xlsx'

const [, , fileArg, keyword = ''] = process.argv
if (!fileArg) { console.error('사용법: node scripts/diagnose-xlsx.mjs <파일> [검색어]'); process.exit(1) }

const out = join(tmpdir(), `classify-${Date.now()}.mjs`)
await build({ entryPoints: [resolve('utils/classify.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' })
const C = await import(pathToFileURL(out).href)

const buf = readFileSync(fileArg)
const isBin = (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf)
let wb
if (isBin) wb = XLSX.read(buf, { type: 'buffer', cellDates: false })
else {
  let text
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch { text = new TextDecoder('euc-kr').decode(buf) }
  wb = XLSX.read(text.replace(/^\uFEFF/, ''), { type: 'string', cellDates: true })
}

const kw = keyword.trim()
const fmt = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '')
console.log(`파일: ${fileArg}\n시트 ${wb.SheetNames.length}개: ${wb.SheetNames.join(' | ')}\n`)

const keptAll = []
wb.SheetNames.forEach((name, si) => {
  const sheet = wb.Sheets[name]
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: true })
  const scan = C.detectHeaderRow(aoa)
  const origin = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r : 0
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true, blankrows: false, range: origin + scan.index })
  const merged = {}
  for (const r of rows.slice(0, 20)) for (const k of Object.keys(r)) if (!(k in merged)) merged[k] = null
  const map = rows.length ? C.detectColumns(merged) : scan.map
  const sk = { blank: 0, noDate: 0, noAmount: 0 }
  let kept = 0
  const skippedRows = []
  const hits = []
  rows.forEach((row, idx) => {
    const text = Object.values(row).map((v) => (v == null ? '' : v instanceof Date ? fmt(v) : String(v))).join(' | ')
    const blank = Object.values(row).every((v) => v == null || String(v).trim() === '')
    let status = 'kept'
    if (blank) { sk.blank++; status = 'skip:빈행' }
    else {
      const d = C.toDate(map.date ? row[map.date] : null)
      const a = Math.abs(C.toSignedAmount(map.amount ? row[map.amount] : null))
      if (!d) { sk.noDate++; status = `skip:날짜해석실패(${JSON.stringify(row[map.date])})` }
      else if (a <= 0) { sk.noAmount++; status = `skip:금액없음/0(${map.amount}=${JSON.stringify(row[map.amount])})` }
      else { kept++; keptAll.push({ d, desc: String(row[map.description] ?? '').trim(), a, sheet: name }) }
    }
    if (status !== 'kept' && !blank && skippedRows.length < 15) skippedRows.push(`  [${status}] ${text}`)
    if (kw && text.includes(kw)) hits.push(`  원본행#${idx + 1} → ${status}  :: ${text}`)
  })
  console.log(`■ 시트 ${si + 1}: "${name}"`)
  console.log(`  헤더 행: ${scan.index + 1}번째 / 헤더: ${scan.headers.filter(Boolean).join(', ')}`)
  console.log(`  인식된 열: ${JSON.stringify(map)}`)
  console.log(`  데이터 행 ${rows.length} → 채택 ${kept} / 스킵 ${JSON.stringify(sk)}`)
  if (skippedRows.length) console.log('  스킵된 행(최대 15):\n' + skippedRows.join('\n'))
  if (kw) console.log(`  "${kw}" 포함 행 ${hits.length}건` + (hits.length ? '\n' + hits.join('\n') : ''))
  console.log()
})

// 앱의 파서는 채택 행이 가장 많은 시트 "하나"만 쓴다 — 어느 시트인지 / 나머지는 몇 건이 버려지는지
const bySheet = new Map()
for (const t of keptAll) bySheet.set(t.sheet, (bySheet.get(t.sheet) ?? 0) + 1)
const best = [...bySheet.entries()].sort((a, b) => b[1] - a[1])[0]
if (best) {
  console.log(`앱이 채택하는 시트: "${best[0]}" (${best[1]}건). 다른 시트의 채택 가능 행 ${keptAll.length - best[1]}건은 적재되지 않음`)
}
// append 모드 중복 제거(날짜|내용|금액) 시뮬레이션
const seen = new Set(); let dup = 0
for (const t of keptAll.filter((t) => !best || t.sheet === best[0])) {
  const k = `${t.d.toISOString().slice(0, 10)}|${t.desc}|${t.a}`
  if (seen.has(k)) dup++; else seen.add(k)
}
console.log(`같은 날짜·내용·금액 중복(append 시 건너뜀): ${dup}건`)
