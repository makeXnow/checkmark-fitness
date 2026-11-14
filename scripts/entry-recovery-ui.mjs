// Isolated browser fixture: synthetic data, in-memory D1/R2, no production calls.
import {Miniflare,Response as MFResponse} from 'miniflare'
import {build} from 'esbuild'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
const root=process.env.UI_ASSETS || '/tmp/checkmark-entry-ui'
const script=(await build({entryPoints:['worker/index.ts'],bundle:true,write:false,format:'esm',platform:'browser',external:['node:async_hooks'],target:'es2022',plugins:[{name:'synthetic-nutrition',setup(b){b.onLoad({filter:/worker\/macroEstimate\.ts$/},()=>({contents:`export async function runMacroEstimate(){return {calories:95,protein:0.5,servingType:'apple',servingMultiplier:1,baseCalories:95,baseProtein:0.5}}`,loader:'ts'}))}}]})).outputFiles[0].text
const mf=new Miniflare({modules:true,script,compatibilityDate:'2025-12-01',compatibilityFlags:['nodejs_als'],d1Databases:{DB:'browser-entry-test'},r2Buckets:['SCAN_IMAGES'],bindings:{OPENAI_API_KEY:'synthetic-key'},outboundService:async()=>new MFResponse(JSON.stringify({choices:[{message:{content:JSON.stringify({items:[{name:'Diagnostic Apple',quantity:1,unitSingular:'apple',unitPlural:'apples',unitFamily:'count',estimated:false,originalPortion:'',notes:'',fatSecretSearch:'apple'}]})}}]}),{headers:{'content-type':'application/json'}})})
const db=await mf.getD1Database('DB')
for(const file of ['0001_init.sql','0007_macro_bundle_backups.sql','0008_ai_request_usage.sql','0009_macro_log_days.sql','0010_macro_entries.sql']){
 const sql=fs.readFileSync(`migrations/${file}`,'utf8'),triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g)??[]
 for(const s of sql.replace(/CREATE TRIGGER[\s\S]*?END;/g,'').split(';').filter(s=>s.trim()))await db.prepare(s).run()
 for(const t of triggers)await db.prepare(t).run()
}
await mf.dispatchFetch('https://fixture.test/api/u/offline-fixture/bootstrap')
await db.prepare("UPDATE app_state SET selected_tab='macro',selected_date='2026-11-11' WHERE device_id='offline-fixture'").run()
let online=true
const controls=`<div style="position:fixed;z-index:9999;right:0;top:0;background:#123;padding:4px"><button id="fixture-offline">Test offline</button><button id="fixture-online">Test online</button></div><script>document.getElementById('fixture-offline').onclick=async()=>{await fetch('/fixture/offline');window.dispatchEvent(new Event('offline'))};document.getElementById('fixture-online').onclick=async()=>{await fetch('/fixture/online');window.dispatchEvent(new Event('online'))}</script>`
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://127.0.0.1:19024')
  if(url.pathname==='/fixture/offline'||url.pathname==='/fixture/online'){online=url.pathname.endsWith('/online');res.end('ok');return}
  if(url.pathname==='/fixture/verify'){
   const rows=await db.prepare("SELECT entry_id,payload_json,deleted_at FROM macro_entries WHERE device_id='offline-fixture'").all()
   res.setHeader('content-type','application/json');res.end(JSON.stringify(rows.results));return
  }
  if(url.pathname.includes('/api/')){
   if(!online){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"Synthetic offline connection"}');return}
   const chunks=[];for await(const chunk of req)chunks.push(chunk)
   const body=Buffer.concat(chunks)
   const r=await mf.dispatchFetch(`https://fixture.test${url.pathname}${url.search}`,{method:req.method,headers:req.headers,body:body.length?body:undefined})
   res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));return
  }
  const file=url.pathname.includes('/assets/')?path.join(root,url.pathname.slice(url.pathname.indexOf('/assets/')+1)):path.join(root,'index.html')
  let content=fs.readFileSync(file)
  if(file.endsWith('index.html'))content=Buffer.from(content.toString().replace('</body>',`${controls}</body>`))
  res.setHeader('content-type',file.endsWith('.js')?'application/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(content)
 }catch(e){res.statusCode=500;res.end(e.message);console.error(e.message)}
})
server.listen(19024,'127.0.0.1',()=>console.log('Synthetic recovery browser fixture: http://127.0.0.1:19024/u/offline-fixture'))
process.on('SIGINT',async()=>{server.close();await mf.dispose();process.exit()})
