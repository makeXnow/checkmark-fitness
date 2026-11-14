import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeBootstrapCache, writeMacroRecoveryCache, writePendingMacroCache, readPendingMacroCache } from './bootstrapCache'
import type { BootstrapResponse } from '../types/domain'

afterEach(() => vi.unstubAllGlobals())
function storage() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  return values
}
const macro = (id: string) => ({ logs: { '2026-10-16': [{ id, calories: 650 }] } }) as BootstrapResponse['macro']
describe('macro recovery cache', () => {
  it('preserves unsent food separately when a server refresh replaces the display cache', () => {
    const values = storage()
    writeMacroRecoveryCache('alexander', macro('unsent-dinner'))
    writeBootstrapCache('alexander', { macro: macro('server-breakfast') } as BootstrapResponse)
    expect(JSON.parse(values.get('checkmark-bootstrap:macro-recovery:alexander')!)[0].macro.logs['2026-10-16'][0].id).toBe('unsent-dinner')
  })
  it('retains five copies per profile without mixing profiles', () => {
    const values = storage()
    writeMacroRecoveryCache('another-profile', macro('separate'))
    for (let i = 0; i < 8; i++) writeMacroRecoveryCache('alexander', macro(String(i)))
    const copies = JSON.parse(values.get('checkmark-bootstrap:macro-recovery:alexander')!)
    expect(copies).toHaveLength(5)
    expect(copies[0].macro.logs['2026-10-16'][0].id).toBe('3')
    expect(JSON.parse(values.get('checkmark-bootstrap:macro-recovery:another-profile')!)).toHaveLength(1)
  })
})

it('fits food recovery in bounded phone storage despite oversized lookup results', () => {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => {
      const size = [...values.entries()].filter(([k]) => k !== key).reduce((n, [, v]) => n + v.length, value.length)
      if (size > 5_000_000) throw new Error('QuotaExceededError')
      values.set(key, value)
    },
  })
  const big = { updatedAt: 10, logs: { today: Array.from({ length: 8 }, (_, id) => ({
    id: String(id), name: 'Food', amount: '5 oz', calories: 50, status: 'ready',
    fatSecretResults: [{ trace: 'x'.repeat(1_100_000) }],
    macroEstimateSnapshot: { rawMacrosPass1Json: 'x'.repeat(100_000), fatSecretIndex: 1 },
  })) } } as unknown as BootstrapResponse['macro']
  for (let i = 0; i < 5; i++) writeMacroRecoveryCache('alexander', big)
  expect(writePendingMacroCache('alexander', { macro: big, changedDays: ['today'] })).toBe(true)
  const recovery = readPendingMacroCache('alexander')!
  expect(recovery.macro.logs.today).toHaveLength(8)
  expect(recovery.macro.logs.today[0]).toMatchObject({ name: 'Food', amount: '5 oz', calories: 50 })
  expect([...values.values()].join('').length).toBeLessThan(100_000)
  writePendingMacroCache('alexander', null)
  expect(readPendingMacroCache('alexander')).toBeNull()
})
