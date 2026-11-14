import { createStore, get, set, update, setMany, keys, getMany, del } from 'idb-keyval'
import type { BootstrapResponse } from '../types/domain'
import type { PendingMacro } from './macroRecovery'
const store = () => createStore('checkmark-food-v1', 'durable-food')
let cachedStore: ReturnType<typeof createStore> | undefined
const db = () => cachedStore ??= store()
export class LocalFoodStorageError extends Error {
  constructor() { super('Could not save food on this device. Keep the app open and free some storage before trying again.'); this.name='LocalFoodStorageError' }
}
export async function saveDurablePending(profile: string, value: PendingMacro): Promise<void> {
  try { await set(`pending:${profile}`, value, db()) } catch { throw new LocalFoodStorageError() }
}
export async function readDurablePending(profile: string): Promise<PendingMacro | null> {
  return (await get<PendingMacro>(`pending:${profile}`, db())) ?? null
}
export async function acknowledgeDurablePending(profile: string, saveId: string | undefined): Promise<void> {
  await update<PendingMacro | undefined>(`pending:${profile}`, current =>
    current?.macro.clientSaveId === saveId ? undefined : current, db())
}
export async function writeDurableBootstrap(profile: string, value: BootstrapResponse): Promise<void> {
  await set(`bootstrap:${profile}`, value, db())
}
export async function readDurableBootstrap(profile: string): Promise<BootstrapResponse | null> {
  return (await get<BootstrapResponse>(`bootstrap:${profile}`, db())) ?? null
}
export async function saveDurableAudio(profile: string, id: string, blob: Blob): Promise<void> {
  try { await set(`audio:${profile}:${id}`, blob, db()) } catch { throw new LocalFoodStorageError() }
}
export async function readDurableAudio(profile: string, id: string): Promise<Blob | undefined> {
  return get<Blob>(`audio:${profile}:${id}`, db())
}

export type SavedScan = {front:string;nutrition:string}
export async function saveDurableScan(profile:string,id:string,scan:SavedScan):Promise<void> {
  try {await set(`scan:${profile}:${id}`,scan,db())}catch{throw new LocalFoodStorageError()}
}
export async function readDurableScan(profile:string,id:string):Promise<SavedScan|undefined>{return get<SavedScan>(`scan:${profile}:${id}`,db())}

export type MediaDraft = {date:string;item:import('../types/domain').MacroDayItem}
export async function saveVoiceDraft(profile:string,draft:MediaDraft,blob:Blob):Promise<void>{
  try{await setMany([[`audio:${profile}:${draft.item.id}`,blob],[`media-draft:${profile}:${draft.item.id}`,draft]],db())}catch{throw new LocalFoodStorageError()}
}
export async function saveScanDraft(profile:string,draft:MediaDraft,scan:SavedScan):Promise<void>{
  try{await setMany([[`scan:${profile}:${draft.item.id}`,scan],[`media-draft:${profile}:${draft.item.id}`,draft]],db())}catch{throw new LocalFoodStorageError()}
}
export async function readMediaDrafts(profile:string):Promise<MediaDraft[]>{
  const names=(await keys(db())).filter(k=>String(k).startsWith(`media-draft:${profile}:`))
  return (await getMany<MediaDraft>(names,db())).filter((d):d is MediaDraft=>Boolean(d))
}
export async function removeMediaDraft(profile:string,id:string):Promise<void>{await del(`media-draft:${profile}:${id}`,db())}
