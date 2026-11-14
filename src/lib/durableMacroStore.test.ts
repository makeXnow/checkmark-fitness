import 'fake-indexeddb/auto'
import {expect,it} from 'vitest'
import {saveDurablePending,readDurablePending,acknowledgeDurablePending,saveDurableAudio,readDurableAudio,saveVoiceDraft,readMediaDrafts} from './durableMacroStore'
import type {BootstrapResponse} from '../types/domain'
it('retains full unsynced food and audio across a reopened store, beyond localStorage size limits',async()=>{
  const macro={clientSaveId:'first',logs:{today:[{id:'food',name:'Dinner',audit:'x'.repeat(8_500_000)}]}} as unknown as BootstrapResponse['macro']
  await saveDurablePending('durable-test',{macro,changedDays:['today']})
  expect((await readDurablePending('durable-test'))?.macro.logs.today[0]).toEqual(macro.logs.today[0])
  const audio=new Blob(['recover this recording'],{type:'audio/webm'})
  await saveDurableAudio('durable-test','voice',audio)
  expect(await(await readDurableAudio('durable-test','voice'))?.text()).toBe('recover this recording')
})
it('never erases a newer unsynced edit when an older acknowledgement arrives',async()=>{
  const macro={clientSaveId:'newer',logs:{today:[{id:'newer-food'}]}} as unknown as BootstrapResponse['macro']
  await saveDurablePending('ack-test',{macro,changedDays:['today']})
  await acknowledgeDurablePending('ack-test','older')
  expect((await readDurablePending('ack-test'))?.macro.clientSaveId).toBe('newer')
  await acknowledgeDurablePending('ack-test','newer')
  expect(await readDurablePending('ack-test')).toBeNull()
})

it('commits the recording and its entry identity together before the UI accepts it',async()=>{
  await saveVoiceDraft('media-test',{date:'2026-11-11',item:{id:'voice',name:'',amount:'',status:'transcribing',audioPending:true}},new Blob(['voice source']))
  expect((await readMediaDrafts('media-test'))[0].item.id).toBe('voice')
  expect(await(await readDurableAudio('media-test','voice'))?.text()).toBe('voice source')
})
