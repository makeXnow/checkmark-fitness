import type {BootstrapResponse,MacroDayItem} from '../types/domain'
import {entryChanges,stableJson} from './macroEntryChanges'
import {macroLogPatch} from './macroLogPatch'
type Macro=BootstrapResponse['macro']
export type PendingMacro={macro:Macro;changedDays:string[]}
/** Older phone backups omit lookup traces. Merge them into the full server entry. */
function recoverCachedEntry(server:MacroDayItem|undefined,cached:MacroDayItem):MacroDayItem{
 if(!server)return cached
 const recovered={...server,...cached,macroEstimateSnapshot:server.macroEstimateSnapshot||cached.macroEstimateSnapshot
   ?{...server.macroEstimateSnapshot,...cached.macroEstimateSnapshot}:undefined}
 if(cached.macroEstimateSnapshot?.statedNutritionApplied){recovered.calories=cached.calories;recovered.protein=cached.protein;recovered.baseCalories=cached.baseCalories;recovered.baseProtein=cached.baseProtein}
 return recovered
}
/** Apply only individual unsynced edits; retain additions from other devices. */
export function rebaseUnsavedMacro(server:Macro,pending:PendingMacro):Macro{
 let operations=pending.macro.entryMutations
 if(!operations){
   const intended={...server.logs}
   for(const day of pending.changedDays){
     const current=server.logs[day] ?? [],cached=pending.macro.logs[day] ?? []
     const merged=cached.map(item=>recoverCachedEntry(current.find(i=>i.id===item.id),item))
     // A legacy day snapshot from an older revision cannot authorize deletion
     // of foods added elsewhere since that snapshot.
     const keep=pending.macro.updatedAt===server.updatedAt?[]:current.filter(i=>!cached.some(c=>c.id===i.id))
     intended[day]=[...keep,...merged]
   }
   operations=entryChanges(server.logs,intended,server.entryRevisions ?? {})
 }
 const logs={...server.logs}
 for(const op of operations){
   const day=logs[op.date] ?? []
   if(op.item===null){logs[op.date]=day.filter(i=>i.id!==op.id);continue}
   const item=recoverCachedEntry(day.find(i=>i.id===op.id),op.item)
   logs[op.date]=day.some(i=>i.id===op.id)?day.map(i=>i.id===op.id?item:i):[...day,item]
 }
 return {...pending.macro,updatedAt:server.updatedAt,logs,entryRevisions:server.entryRevisions,entryMutations:operations}
}
export function recoveryHasChanges(server:Macro,recovered:Macro):boolean{
 return Boolean(recovered.entryMutations?.length) || ['goals','goalsSnapshotsByDay','goalsHistory','customFoods'].some(key=>
   stableJson((server as any)[key] ?? null)!==stableJson((recovered as any)[key] ?? null))
}
export function pendingMacro(macro:Macro,confirmedLogs:Macro['logs']):PendingMacro{
 return {macro,changedDays:Object.keys(macroLogPatch(confirmedLogs,macro.logs))}
}
