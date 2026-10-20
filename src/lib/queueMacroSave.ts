/** Publish edits immediately; serialize only network writes. Older acknowledgements update
 * the revision without replacing newer cards (including intentional deletions). */
export function queueMacroSave<T extends { updatedAt: number }>(
  previous: Promise<void>,
  snapshot: T,
  deps: {
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
  deps.publish(snapshot)
  return previous.then(async () => {
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
    deps.saved()
  })
}
