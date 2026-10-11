import { parse, compileTemplate, compileScript } from '@vue/compiler-sfc'
import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
let bad = 0
for (const f of ['pages/savings.vue','pages/contracts.vue','pages/settings.vue','pages/income-expense.vue','components/TransactionsTable.vue','pages/guide.vue','components/charts/IncomeExpenseFlow.vue']) {
  const { descriptor, errors } = parse(readFileSync(f,'utf8'), { filename: f })
  const errs = [...errors]
  if (descriptor.template) { const r = compileTemplate({ source: descriptor.template.content, filename: f, id: f }); errs.push(...r.errors) }
  try { compileScript(descriptor, { id: f }) } catch (e) { errs.push(e) }
  console.log(f, errs.length ? 'ERR ' + errs.map(String).join('; ') : 'ok'); bad += errs.length
}
for (const f of ['composables/useSavings.ts','composables/useFlowSummary.ts','composables/useAssets.ts','composables/useTaxonomies.ts','composables/useExpenses.ts','composables/useIncomeExpense.ts','utils/format.ts','utils/refund.ts','utils/classify.ts','utils/parseExcel.ts','utils/txTable.ts','utils/types.ts']) {
  try { transformSync(readFileSync(f,'utf8'), { loader: 'ts' }); console.log(f,'ok') } catch (e) { console.log(f,'ERR',e.message); bad++ }
}
process.exit(bad ? 1 : 0)
