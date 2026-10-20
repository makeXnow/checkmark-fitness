import { describe, expect, it } from 'vitest'
import { preferNewerBootstrapBundles } from './preferNewerBootstrapBundles'
import type { BootstrapResponse } from '../types/domain'

function boot(partial: {
  macroAt?: number
  habitsAt?: number
  liftAt?: number
  macroLogs?: BootstrapResponse['macro']['logs']
}): BootstrapResponse {
  return {
    appState: { selected_date: '2026-09-17' } as BootstrapResponse['appState'],
    habits: {
      goals: {} as BootstrapResponse['habits']['goals'],
      logs: {},
      appSettings: { firstDayOfWeek: 0 },
      updatedAt: partial.habitsAt ?? 1,
    },
    macro: {
      goals: {} as BootstrapResponse['macro']['goals'],
      customFoods: [],
      logs: partial.macroLogs ?? {},
      updatedAt: partial.macroAt ?? 1,
    },
    lift: {
      payload: {} as BootstrapResponse['lift']['payload'],
      updatedAt: partial.liftAt ?? 1,
    },
  }
}

describe('preferNewerBootstrapBundles', () => {
  it('keeps newer local macro logs over a stale incoming payload', () => {
    const local = boot({
      macroAt: 200,
      macroLogs: { '2026-09-17': [{ id: 'salad', name: 'Salad' } as never] },
    })
    const incoming = boot({
      macroAt: 100,
      macroLogs: { '2026-09-17': [{ id: 'cucumber', name: 'Cucumber' } as never] },
    })

    const { data, keptLocal } = preferNewerBootstrapBundles(incoming, local)

    expect(keptLocal.macro).toBe(true)
    expect(data.macro.logs['2026-09-17']?.map((i) => i.id)).toEqual(['salad'])
    expect(data.macro.updatedAt).toBe(200)
  })

  it('takes incoming macro when it is newer', () => {
    const local = boot({ macroAt: 100, macroLogs: { '2026-09-17': [] } })
    const incoming = boot({
      macroAt: 200,
      macroLogs: { '2026-09-17': [{ id: 'chicken', name: 'Chicken' } as never] },
    })

    const { data, keptLocal } = preferNewerBootstrapBundles(incoming, local)

    expect(keptLocal.macro).toBe(false)
    expect(data.macro.logs['2026-09-17']?.map((i) => i.id)).toEqual(['chicken'])
  })

  it('recovers a cached food day omitted by a newer server bundle', () => {
    const local = boot({
      macroAt: 100,
      macroLogs: { '2026-10-16': [{ id: 'dinner', calories: 650 } as never] },
    })
    const incoming = boot({ macroAt: 200, macroLogs: { '2026-10-01': [] } })

    const result = preferNewerBootstrapBundles(incoming, local)

    expect(result.data.macro.logs['2026-10-16']).toEqual(local.macro.logs['2026-10-16'])
    expect(result.data.macro.logs['2026-10-01']).toEqual([])
    expect(result.data.macro.updatedAt).toBe(200)
    expect(result.recoveredMacroDays).toBe(true)
    expect(result.keptLocal.macro).toBe(false)
    expect(incoming.macro.logs['2026-10-16']).toBeUndefined()
    // Once the repaired bundle is received, recovery no longer queues a save.
    expect(preferNewerBootstrapBundles(result.data, local).recoveredMacroDays).toBe(false)
  })

  it('honors explicitly cleared days and server edits without resurrecting foods', () => {
    const local = boot({
      macroAt: 100,
      macroLogs: {
        '2026-10-16': [{ id: 'deleted-dinner' } as never],
        '2026-10-15': [{ id: 'deleted-snack' } as never],
      },
    })
    const incoming = boot({
      macroAt: 200,
      macroLogs: { '2026-10-16': [], '2026-10-15': [{ id: 'lunch' } as never] },
    })

    const result = preferNewerBootstrapBundles(incoming, local)

    expect(result.data).toBe(incoming)
    expect(result.recoveredMacroDays).toBe(false)
  })
})
