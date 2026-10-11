import { build } from 'esbuild'
await build({entryPoints:['utils/format.ts'],bundle:true,format:'esm',platform:'node',outfile:'/tmp/fmt.mjs',logLevel:'silent'})
const {formatKoreanAmount:f}=await import('/tmp/fmt.mjs')
for (const v of [0,1000,15000,1250000,100000000,123456789,1000010000,780000,'', null,-5000,1e16,2500000000000]) console.log(v,'→',f(v))
