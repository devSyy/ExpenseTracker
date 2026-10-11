import { parse, compileTemplate, compileScript } from '@vue/compiler-sfc'
import { readFileSync } from 'node:fs'
import { transformSync, build } from 'esbuild'
import { tmpdir } from 'node:os'; import { join, resolve } from 'node:path'; import { pathToFileURL } from 'node:url'
let bad = 0
for (const f of ['pages/spending-goals.vue','components/charts/SpendingTrendChart.vue','pages/guide.vue','layouts/default.vue']) {
  const { descriptor, errors } = parse(readFileSync(f,'utf8'), { filename: f }); const errs=[...errors]
  if (descriptor.template) errs.push(...compileTemplate({ source: descriptor.template.content, filename: f, id: f }).errors)
  try { const sc = compileScript(descriptor, { id: f }); if (descriptor.scriptSetup) transformSync(sc.content, { loader: 'ts' }) } catch (e) { errs.push(e) }
  console.log(f, errs.length ? 'ERR '+errs.map(String).join('; ') : 'ok'); bad += errs.length
}
for (const f of ['utils/spendingGoals.ts','repositories/spendingGoalsRepository.ts','composables/useSpendingGoals.ts','utils/chartTheme.ts','utils/storage.ts']) {
  try { transformSync(readFileSync(f,'utf8'), { loader: 'ts' }); console.log(f,'ok') } catch (e) { console.log(f,'ERR',e.message); bad++ }
}
// 순수 로직 테스트
const out = join(tmpdir(), `sg-${Date.now()}.mjs`)
await build({ entryPoints:[resolve('utils/spendingGoals.ts')], bundle:true, format:'esm', platform:'node', outfile: out, logLevel:'silent' })
const S = await import(pathToFileURL(out).href)
const today = new Date(2026,9,11)
const map = S.buildDayMap([
  {date:new Date(2026,9,1),amount:400000},{date:new Date(2026,9,5),amount:100000},{date:new Date(2026,8,30),amount:50000},{date:new Date(2024,2,3),amount:70000}
])
const g = {monthly:2000000, overrides:{quarter:null,half:5000000,year:null}}
const eq=(a,b,m)=>{ if(JSON.stringify(a)!==JSON.stringify(b)){console.log('FAIL',m,a,b);bad++} else console.log('pass',m)}
eq(S.targetFor(g,'quarter'),6000000,'분기 자동'); eq(S.targetFor(g,'half'),5000000,'반기 덮어쓰기'); eq(S.targetFor(g,'year'),24000000,'연 자동')
eq(Math.round(S.targetFor(g,'week')),461538,'주 환산')
const cur = S.currentPeriod('month',map,today); eq([cur.total,cur.count,cur.days,cur.elapsed,cur.inProgress],[500000,2,31,11,true],'이번달')
eq(S.currentPeriod('quarter',map,today).total,550000,'이번 분기(9/30 포함)')
eq(S.currentPeriod('year',map,today).total,550000,'올해')
eq(S.buildPeriods('year',map,today,S.firstYearOf(map,today)).length,3,'연 2024~2026')
eq(S.buildPeriods('week',map,today,2026).map(p=>p.label).slice(-1),['10/05'],'이번주 월요일')
eq(S.buildPeriods('month',map,today,2026).length,12,'12개월'); eq(S.buildPeriods('quarter',map,today,2026).length,8,'8분기'); eq(S.buildPeriods('half',map,today,2026).length,6,'6반기')
eq(S.periodStatus(cur,2000000),'prog','진행(페이스이내)'); eq(S.periodStatus(cur,1000000),'warn','페이스초과'); eq(S.periodStatus(cur,400000),'over','초과'); eq(S.periodStatus(cur,0),'none','미설정')
const d = S.dailySeries(2026,10,map,today,2000000); eq([d.total,d.cumulative[10],d.cumulative[11],d.elapsed,d.nDays],[500000,500000,null,11,31],'일별')
eq(S.isValidGoals(g),true,'validator ok'); eq(S.isValidGoals({monthly:-1,overrides:{}}),false,'validator bad')
process.exit(bad?1:0)
