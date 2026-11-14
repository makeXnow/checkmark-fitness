/** Publish edits immediately; serialize only network writes. Older acknowledgements update
 * the revision without replacing newer cards (including intentional deletions). */
export function queueMacroSave<T extends { updatedAt: number }>(
  previous: Promise<void>,
  snapshot: T,
  deps: {
    durable?: (snapshot: T) => Promise<void>
    stage?: (snapshot: T) => void
    read: () => T | undefined
    publish: (value: T) => void
    pending: (value: T | null) => void
    persist: (snapshot: T, revision: number) => Promise<{ updatedAt: number }>
    isCurrent: () => boolean
    isLatest: () => boolean
    saved: () => void
  },
): Promise<void> {
  deps.pending(snapshot)
  deps.stage?.(snapshot)
  const durable = deps.durable ? deps.durable(snapshot).then(() => {
    if (deps.isCurrent() && deps.isLatest()) deps.publish(snapshot)
  }) : Promise.resolve(deps.publish(snapshot))
  // Attach a rejection handler immediately even while a previous request is running.
  const ready = deps.durable ? durable.then(() => ({ ok: true as const }), error => ({ ok: false as const, error })) : null
  return previous.then(async () => {
    if(ready) {
      const local=await ready
      if(!local.ok) throw local.error
    }
    if (!deps.isCurrent()) return
    const current = deps.read()
    if (!current) return
    const saved = await deps.persist(snapshot, current.updatedAt)
    if (!deps.isCurrent()) return
    const latest = deps.read()
    if (!latest) return
    const acknowledged = { ...latest, updatedAt: saved.updatedAt }
    deps.pending(deps.isLatest() ? null : acknowledged)
    deps.publish(acknowledged)
    if (deps.isLatest()) deps.saved()
  })
}
