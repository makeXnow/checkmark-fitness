import { describe, expect, it } from 'vitest'
import { queueMacroSave } from './queueMacroSave'

type Diary = { updatedAt: number; cards: string[] }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('optimistic diary saves', () => {
  it('shows transcription and parsed cards immediately despite a slow save; old acknowledgements never resurrect placeholders', async () => {
    let current: Diary = { updatedAt: 10, cards: [] }
    let pending: Diary | null = null
    let version = 0
    const writes: { snapshot: Diary; revision: number | undefined }[] = []
    const responses = [deferred<{ updatedAt: number }>(), deferred<{ updatedAt: number }>(), deferred<{ updatedAt: number }>()]
    let queue = Promise.resolve()
    function edit(cards: string[]) {
      const mine = ++version
      queue = queueMacroSave(queue, { ...current, cards }, {
        read: () => current,
        publish: value => { current = value },
        pending: value => { pending = value },
        persist: (snapshot, revision) => {
          writes.push({ snapshot, revision })
          return responses[writes.length - 1].promise
        },
        isCurrent: () => true, isLatest: () => mine === version, saved: () => {},
      })
      return queue
    }
    const first = edit(['transcribing'])
    expect(current.cards).toEqual(['transcribing'])
    const second = edit(['processing: two rice cakes'])
    const last = edit(['Rice cakes: 2'])
    expect(current.cards).toEqual(['Rice cakes: 2'])
    await Promise.resolve()
    expect(writes).toHaveLength(1)
    responses[0].resolve({ updatedAt: 11 })
    await first
    expect(current.cards).toEqual(['Rice cakes: 2'])
    expect(current.updatedAt).toBe(11)
    expect(pending).not.toBeNull()
    await Promise.resolve()
    expect(writes[1].revision).toBe(11)
    responses[1].resolve({ updatedAt: 12 })
    await second
    await Promise.resolve()
    expect(writes[2].revision).toBe(12)
    responses[2].resolve({ updatedAt: 13 })
    await last
    expect(current).toEqual({ updatedAt: 13, cards: ['Rice cakes: 2'] })
    expect(pending).toBeNull()
  })

  it('preserves a deletion while an older save is in flight and cancels writes after a failure generation changes', async () => {
    let current: Diary = { updatedAt: 10, cards: [] }
    let generation = 0
    const response = deferred<{ updatedAt: number }>()
    const deps = {
      read: () => current,
      publish: (value: Diary) => { current = value },
      pending: () => {},
      persist: async () => response.promise,
      isCurrent: () => generation === 0,
      isLatest: () => false,
      saved: () => {},
    }
    const first = queueMacroSave(Promise.resolve(), { ...current, cards: ['old card'] }, deps)
    const second = queueMacroSave(first, { ...current, cards: [] }, deps)
    expect(current.cards).toEqual([])
    await Promise.resolve()
    generation++
    response.resolve({ updatedAt: 11 })
    await second
    expect(current).toEqual({ updatedAt: 10, cards: [] })
  })
})
