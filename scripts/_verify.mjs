import { build } from 'esbuild'; import { readFileSync } from 'node:fs'; import { pathToFileURL } from 'node:url'; import { resolve } from 'node:path'
const out = resolve('scripts/_pe.mjs')
await build({ entryPoints:['utils/parseExcel.ts'], bundle:true, format:'esm', platform:'node', outfile:out, external:['xlsx'], logLevel:'silent' })
const { parseExpenseFile } = await import(pathToFileURL(out).href)
const f = new File([readFileSync('scripts/_upload.xlsx')], 'x.xlsx')
const r = await parseExpenseFile(f)
const d = t=>`${t.date.getFullYear()}-${String(t.date.getMonth()+1).padStart(2,'0')}-${String(t.date.getDate()).padStart(2,'0')}`
console.log('sheet', r.sheetName, 'count', r.transactions.length, r.skipped)
r.transactions.filter(t=>t.paymentMethod.includes('청년도약')).forEach(t=>console.log(d(t), t.month, t.description, t.amount, t.negativeAmount, t.category))
const minmax=r.transactions.map(d).sort(); console.log(minmax[0], minmax.at(-1))
const bad=r.transactions.filter(t=>t.date.getHours()!==0||t.date.getMinutes()!==0); console.log('non-midnight', bad.length)
