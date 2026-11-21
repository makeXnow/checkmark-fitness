import { describe, expect, it } from 'vitest'
import { canResumeRecovery, pendingMacro, rebaseUnsavedMacro, recoveryHasChanges } from './macroRecovery'
import type { BootstrapResponse } from '../types/domain'
const bundle = (logs: unknown, updatedAt: number) => ({ logs, updatedAt, goals: {}, customFoods: [] }) as BootstrapResponse['macro']
describe('unsaved food recovery', () => {
  it('keeps eight unsaved foods visible instead of replacing them with three server foods', () => {
    const first = Array.from({ length: 3 }, (_, id) => ({ id: String(id), name: 'Food' }))
    const eight = Array.from({ length: 8 }, (_, id) => ({ id: String(id), name: 'Food' }))
    const confirmed = bundle({ today: first, yesterday: [{ id: 'old' }] }, 10)
    const unsaved = bundle({ ...confirmed.logs, today: eight }, 10)
    const server = bundle({ today: first, yesterday: [{ id: 'new-on-other-device' }] }, 11)
    const recovered = rebaseUnsavedMacro(server, pendingMacro(unsaved, confirmed.logs))
    expect(recovered.logs.today).toHaveLength(8)
    expect(recovered.logs.yesterday).toEqual(server.logs.yesterday)
    expect(recovered.updatedAt).toBe(11)
  })
  it('keeps an intentional empty day while recovering other changed days', () => {
    const confirmed = bundle({ today: [{ id: 'deleted' }], yesterday: [] }, 10)
    const unsaved = bundle({ today: [], yesterday: [{ id: 'unsaved' }] }, 10)
    const recovered = rebaseUnsavedMacro(confirmed, pendingMacro(unsaved, confirmed.logs))
    expect(recovered.logs.today).toEqual([])
    expect(recovered.logs.yesterday).toEqual([{ id: 'unsaved' }])
  })
})

it('clears already-synced recovery without rewriting omitted audit details',()=>{
 const item={id:'food',name:'Beans',amount:'5 oz',status:'ready',calories:40,protein:2,fatSecretResults:[{foodId:'kept'}],macroEstimateSnapshot:{rawMacrosPass1Json:'keep the original trace'}}
 const server=bundle({today:[item]},10)
 const cached=bundle({today:[{id:'food',name:'Beans',amount:'5 oz',status:'ready',calories:40,protein:2,macroEstimateSnapshot:{}}]},10)
 const recovered=rebaseUnsavedMacro(server,pendingMacro(cached,{}))
 expect(recovered.logs.today[0]).toEqual(item)
 expect(recoveryHasChanges(server,recovered)).toBe(false)
})
it('retains other-device foods while applying an explicit entry edit',()=>{
 const server=bundle({today:[{id:'mine',calories:1},{id:'other-device',calories:2}]},20)
 const local=bundle({today:[{id:'mine',calories:3}]},10)
 local.entryMutations=[{id:'mine',date:'today',item:{id:'mine',name:'Food',amount:'1',status:'ready',calories:3},baseRevision:1,mutationId:'edit',ordinal:0,supersedes:[]}]
 const recovered=rebaseUnsavedMacro(server,pendingMacro(local,{}))
 expect(recovered.logs.today.map(i=>i.id)).toEqual(['mine','other-device'])
})

it('only requests review while a queued edit differs from the server', () => {
  const server = bundle({today: [{id: 'food', name: 'Beans', calories: 40}]}, 20)
  const local = bundle(server.logs, 10)
  local.entryMutations = [{
    id: 'food', date: 'today', item: server.logs.today[0], baseRevision: 1,
    mutationId: 'saved', ordinal: 0, supersedes: [],
  }]
  const pending = pendingMacro(local, {})
  expect(recoveryHasChanges(server, rebaseUnsavedMacro(server, pending))).toBe(false)
  local.entryMutations[0].item = null
  expect(recoveryHasChanges(server, rebaseUnsavedMacro(server, pending))).toBe(true)
})

it('quietly resumes edits across unrelated revisions and holds actual conflicts for review', () => {
  const server=bundle({today:[]},20)
  const local=bundle({today:[]},10)
  local.entryMutations=[{id:'new',date:'today',baseRevision:0,mutationId:'m1',item:{id:'new',name:'Beans',amount:'1 cup'},ordinal:0,supersedes:[]}]
  const pending=pendingMacro(local,{})
  expect(canResumeRecovery(server,pending)).toBe(true)
  expect(canResumeRecovery(server,{...pending,requiresReview:true})).toBe(false)
  server.entryRevisions={today:{new:2}}
  expect(canResumeRecovery(server,pending)).toBe(false)
})
