import XLSX from 'xlsx'; import {readFileSync} from 'node:fs'
const wb = XLSX.read(readFileSync('scripts/_upload.xlsx'),{type:'buffer',cellDates:true})
const rows = XLSX.utils.sheet_to_json(wb.Sheets['가계부 내역'],{raw:true,defval:null})
const r = rows.filter(r=>String(r['결제수단']).includes('청년도약')).slice(0,3)
r.forEach(x=>console.log(x['날짜'] instanceof Date? x['날짜'].toString() : x['날짜'], x['날짜'].toISOString()))
