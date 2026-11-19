import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest'
import {Miniflare,Response as MFResponse} from 'miniflare'
import {build} from 'esbuild'
import {readFileSync} from 'node:fs'
import {readMacroLogs} from './macroLogs'
import type {EntryMutation} from '../src/lib/macroEntryChanges'

describe('individual entry reliability',()=>{
 let mf:Miniflare,db:D1Database
 let processor:(body:any)=>Promise<any>
 let parserCalls=0,audioObserved=false
 beforeAll(async()=>{
  const script=(await build({entryPoints:['worker/runtime.ts'],bundle:true,write:false,format:'esm',platform:'browser',external:['node:async_hooks','cloudflare:workers'],target:'es2022',plugins:[{name:'isolated-nutrition-service',setup(b){b.onLoad({filter:/worker\/macroEstimate\.ts$/},()=>({contents:`export async function runMacroEstimate(env,body){const r=await env.PROCESSOR.fetch('https://processor.test',{method:'POST',body:JSON.stringify(body)});if(!r.ok)throw new Error('Synthetic processor failed');return r.json()}`,loader:'ts'}))}}]})).outputFiles[0].text
  processor=async()=>({calories:40,protein:2,servingType:'oz',servingMultiplier:5,baseCalories:8,baseProtein:0.4})
  mf=new Miniflare({modules:true,script,name:"checkmark-test",workflows:{VOICE_JOBS:{name:"voice-test",className:"VoiceDiaryWorkflow"}},compatibilityDate:'2025-12-01',compatibilityFlags:['nodejs_als'],d1Databases:{DB:'entry-reliability'},r2Buckets:['SCAN_IMAGES'],bindings:{OPENAI_API_KEY:'synthetic-test-key'},serviceBindings:{PROCESSOR:async req=>{
    const body=await req.json()
    try{return new MFResponse(JSON.stringify(await processor(body)),{headers:{'content-type':'application/json'}})}catch{return new MFResponse('failed',{status:500})}
  }},outboundService:async req=>{
    if(req.url.includes('/audio/transcriptions')){
      const form=await req.formData()
      const file=form.get('file')
      if(file && typeof file!=='string' && await file.text()==='synthetic voice job') {
        return new MFResponse(JSON.stringify({text:'five ounces of green beans'}),{headers:{'content-type':'application/json'}})
      }
      const row=await db.prepare("SELECT payload_json FROM macro_entries WHERE device_id='voice-retention' AND entry_id='voice-1'").first<{payload_json:string}>()
      const saved=JSON.parse(row!.payload_json)
      expect(saved.audioKey).toBeTruthy()
      expect(await(await mf.getR2Bucket('SCAN_IMAGES')).get(saved.audioKey)).not.toBeNull()
      audioObserved=true
      return new MFResponse(JSON.stringify({text:'five ounces of green beans'}),{headers:{'content-type':'application/json'}})
    }
    parserCalls++
    return new MFResponse(JSON.stringify({choices:[{message:{content:JSON.stringify({items:[{name:'Green Beans',quantity:5,unitSingular:'oz',unitPlural:'oz',unitFamily:'mass',estimated:false,originalPortion:'',notes:'',fatSecretSearch:'green beans'}]})}}]}),{headers:{'content-type':'application/json'}})
  }})
  db=await mf.getD1Database('DB') as unknown as D1Database
  for(const file of ['0001_init.sql','0007_macro_bundle_backups.sql','0008_ai_request_usage.sql','0009_macro_log_days.sql','0010_macro_entries.sql','0011_voice_jobs.sql']){
    const sql=readFileSync(`migrations/${file}`,'utf8'),triggers=sql.match(/CREATE TRIGGER[\s\S]*?END;/g)??[]
    for(const s of sql.replace(/CREATE TRIGGER[\s\S]*?END;/g,'').split(';').filter(s=>s.trim()))await db.prepare(s).run()
    for(const t of triggers)await db.prepare(t).run()
  }
 })
 afterAll(async()=>{await mf?.dispose()})
 async function seed(profile:string){await db.prepare("INSERT INTO app_state(device_id,selected_date,updated_at)VALUES(?,'2026-11-11',1)").bind(profile).run();await db.prepare("INSERT INTO macro_bundle(device_id,goals_json,custom_foods_json,logs_json,updated_at)VALUES(?,'{}','[]','{}',1)").bind(profile).run()}
 const item=(id:string)=>({id,name:'Green Beans',amount:'5 oz',status:'pending' as const,timestamp:1})
 const operation=(id:string,revision=0,extra:Partial<EntryMutation>={}):EntryMutation=>({id,date:'2026-11-11',item:item(id),baseRevision:revision,mutationId:crypto.randomUUID(),ordinal:1,supersedes:[],...extra})
 const mutate=(profile:string,op:EntryMutation)=>mf.dispatchFetch(`https://example.test/api/u/${profile}/macro/entries/${op.date}/${op.id}`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(op)})
 const estimate=(profile:string,id:string)=>mf.dispatchFetch('https://example.test/api/macro/estimate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({profile,name:'Green Beans',amount:'5 oz',diaryEntry:{date:'2026-11-11',item:item(id)}})})
 it('lets independent foods save concurrently while preventing stale edits to the same food',async()=>{
  await seed('concurrent')
  const a=operation('a'),b=operation('b')
  expect((await mutate('concurrent',a)).status).toBe(200);expect((await mutate('concurrent',b)).status).toBe(200)
  const results=await Promise.all([mutate('concurrent',operation('a',1,{item:{...item('a'),status:'ready',calories:40}})),mutate('concurrent',operation('b',1,{item:{...item('b'),status:'ready',calories:50}}))])
  expect(results.map(r=>r.status)).toEqual([200,200])
  const stale=await mutate('concurrent',operation('a',1,{item:{...item('a'),status:'ready',calories:999}}))
  expect(stale.status).toBe(409)
  expect((await readMacroLogs(db,'concurrent'))['2026-11-11'].find(i=>i.id==='a')?.calories).toBe(40)
 })
 it('handles lost acknowledgements without duplicate entries and rebases newer edits over its own earlier mutation',async()=>{
  await seed('lost-ack')
  const op=operation('food')
  await mutate('lost-ack',op)
  expect((await mutate('lost-ack',op)).status).toBe(200)
  expect((await readMacroLogs(db,'lost-ack'))['2026-11-11']).toHaveLength(1)
  const next=operation('food',0,{item:{...item('food'),status:'ready',calories:45},supersedes:[op.mutationId]})
  expect((await mutate('lost-ack',next)).status).toBe(200)
  expect((await readMacroLogs(db,'lost-ack'))['2026-11-11'][0].calories).toBe(45)
 })
 it('stores the original food before processing and stores its result before responding',async()=>{
  await seed('server-first')
  processor=async body=>{
    const logs=await readMacroLogs(db,'server-first')
    expect(logs['2026-11-11'][0].id).toBe(body.diaryEntry.item.id)
    return {calories:40,protein:2,servingType:'oz',servingMultiplier:5,baseCalories:8,baseProtein:0.4}
  }
  const response=await estimate('server-first','beans')
  expect(response.status).toBe(200)
  // No follow-up phone save: a lost response still leaves the completed food in D1.
  expect((await readMacroLogs(db,'server-first'))['2026-11-11'][0]).toMatchObject({status:'ready',calories:40,protein:2})
 })
 it('keeps a failed processing request recoverable',async()=>{
  await seed('processor-failure');processor=async()=>{throw new Error('synthetic failure')}
  expect((await estimate('processor-failure','beans')).status).toBe(502)
  expect((await readMacroLogs(db,'processor-failure'))['2026-11-11'][0]).toMatchObject({id:'beans',amount:'5 oz',status:'error'})
 })
 it('does not resurrect a deleted food when a processing response arrives late',async()=>{
  await seed('delete-during-processing')
  let release!:(value:any)=>void,started!:()=>void
  const running=new Promise<void>(resolve=>{started=resolve})
  processor=async()=>{started();return new Promise(resolve=>{release=resolve})}
  const response=estimate('delete-during-processing','beans');await running
  expect((await mutate('delete-during-processing',operation('beans',1,{item:null}))).status).toBe(200)
  release({calories:40,protein:2})
  expect((await response).status).toBe(409)
  expect((await readMacroLogs(db,'delete-during-processing'))['2026-11-11']).toEqual([])
  expect(await db.prepare("SELECT payload_json FROM macro_entries WHERE device_id='delete-during-processing' AND deleted_at IS NOT NULL").first()).not.toBeNull()
 })
 it('persists parsed children and replays the same request without duplicating foods',async()=>{
  await seed('parser-replay');const before=parserCalls
  const request=()=>mf.dispatchFetch('https://example.test/api/u/parser-replay/macro/parse',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({date:'2026-11-11',item:{id:'request-1',name:'',amount:'',status:'processing_cancellable',timestamp:1},rawText:'five ounces of green beans'})})
  const first=await request();expect(first.status).toBe(200)
  const result=await first.json() as {items:{id:string}[]}
  expect(result.items[0].id).toBe('request-1-0')
  expect((await readMacroLogs(db,'parser-replay'))['2026-11-11']).toHaveLength(1)
  expect((await request()).status).toBe(200);expect(parserCalls-before).toBe(1)
  expect((await readMacroLogs(db,'parser-replay'))['2026-11-11']).toHaveLength(1)
 })
 it('stores the original recording before transcription and retains the transcript without a follow-up phone save',async()=>{
  await seed('voice-retention')
  const form=new FormData()
  form.set('file',new File(['synthetic recording'],'recording.webm',{type:'audio/webm'}))
  form.set('diaryEntry',JSON.stringify({date:'2026-11-11',item:{id:'voice-1',name:'',amount:'',status:'transcribing',audioPending:true,timestamp:1}}))
  const request=new Request('https://example.test/api/ai/transcribe?profile=voice-retention',{method:'POST',body:form})
  const response=await mf.dispatchFetch(request.url,{method:'POST',headers:request.headers,body:new Uint8Array(await request.arrayBuffer())})
  expect(response.status,await response.clone().text()).toBe(200);expect(audioObserved).toBe(true)
  const saved=(await readMacroLogs(db,'voice-retention'))['2026-11-11'][0]
  expect(saved).toMatchObject({rawText:'five ounces of green beans',audioPending:false,status:'editing_raw'})
  expect(saved.audioKey).toBeTruthy()
 })
 it('does not let an older phone progress update invalidate an in-flight processing job',async()=>{
  await seed('progress-race')
  let release!:(v:any)=>void,started!:()=>void
  const running=new Promise<void>(r=>{started=r})
  processor=async()=>{started();return new Promise(r=>{release=r})}
  const response=estimate('progress-race','food');await running
  expect((await mutate('progress-race',operation('food'))).status).toBe(200)
  release({calories:40,protein:2})
  expect((await response).status).toBe(200)
  expect((await readMacroLogs(db,'progress-race'))['2026-11-11'][0].status).toBe('ready')
 })

 it('finishes a voice upload without a phone and deduplicates repeated delivery',async()=>{
   const profile='voice-job',date='2026-11-11',id=crypto.randomUUID()
   await seed(profile)
   processor=async()=>({calories:40,protein:2})
   const path=`https://example.test/api/u/${profile}/macro/voice/${date}/${id}`
   const upload=(body:string)=>mf.dispatchFetch(path,{method:'PUT',headers:{'content-type':'audio/webm'},body})
   const first=await upload('synthetic voice job')
   expect(first.status,await first.text()).toBe(202)
   expect((await upload('duplicate')).status).toBe(202)
   await vi.waitFor(async()=>{
     const phase=await db.prepare('SELECT phase FROM voice_jobs WHERE id=?').bind(id).first('phase')
     expect(phase).toBe('complete')
   },{timeout:20000,interval:100})
   expect((await readMacroLogs(db,profile))[date]).toMatchObject([{id:id+'-0',status:'ready',calories:40}])
   expect(await (await (await mf.getR2Bucket('SCAN_IMAGES')).get(profile+'/voice/'+id))!.text()).toBe('synthetic voice job')
   expect((await upload('reopened')).status).toBe(202)
   const status=await mf.dispatchFetch(`https://example.test/api/u/${profile}/macro/voice/${date}`)
   expect(await status.json()).toMatchObject({jobs:[]})
 },25000)

 it('resumes a failed split without overwriting a later user edit or reviving a deletion',async()=>{
   const profile='voice-retry', date='2026-11-11', id=crypto.randomUUID()
   await seed(profile)
   const foods=[0,1,2].map(n=>item(id+'-'+n))
   await db.prepare("INSERT INTO voice_jobs(profile,id,date,recorded_at,phase,transcript,foods) VALUES(?,?,?,1,'failed','beans',?)")
     .bind(profile,id,date,JSON.stringify(foods)).run()
   await mutate(profile,operation(foods[0].id,0,{item:{...foods[0],status:'ready',calories:123}}))
   await mutate(profile,operation(foods[1].id))
   await mutate(profile,operation(foods[1].id,1,{item:null}))
   const calls:string[]=[]
   processor=async body=>{ calls.push(body.id);return {calories:42,protein:1} }
   const retry=await mf.dispatchFetch(`https://example.test/api/u/${profile}/macro/voice/${id}/retry`,{method:'POST'})
   expect(retry.status).toBe(202)
   await vi.waitFor(async()=>expect(await db.prepare('SELECT phase FROM voice_jobs WHERE id=?').bind(id).first('phase')).toBe('complete'))
   expect(calls).toHaveLength(1)
   expect((await readMacroLogs(db,profile))[date]).toMatchObject([{calories:123},{calories:42}])
 })
 it('discards an estimate that returns after cancellation',async()=>{
   const profile='voice-cancel', date='2026-11-11', id=crypto.randomUUID()
   await seed(profile)
   let release!:()=>void,started!:()=>void
   const began=new Promise<void>(resolve=>{started=resolve})
   const hold=new Promise<void>(resolve=>{release=resolve})
   processor=async()=>{started();await hold;return {calories:40,protein:2}}
   const base=`https://example.test/api/u/${profile}/macro/voice`
   await mf.dispatchFetch(base+'/'+date+'/'+id,{method:'PUT',headers:{'content-type':'audio/webm'},body:'synthetic voice job'})
   await began
   const midway=await (await mf.dispatchFetch(base+'/'+date)).json()
   expect(midway).toMatchObject({jobs:[{phase:'estimating',names:'Green Beans'}]})
   try {
     expect((await mf.dispatchFetch(base+'/'+id+'/cancel',{method:'POST'})).status).toBe(200)
   } finally {release()}
   const {VOICE_JOBS:flow}=await mf.getBindings<{VOICE_JOBS:Workflow}>()
   const instance=await flow.get(profile+'-'+id+'-0')
   await vi.waitFor(async()=>expect((await instance.status()).status).toBe('complete'),{timeout:5000})
   expect((await readMacroLogs(db,profile))[date] ?? []).toEqual([])
   expect(await db.prepare('SELECT phase FROM voice_jobs WHERE id=?').bind(id).first('phase')).toBe('cancelled')
 })

})
