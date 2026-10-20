import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeBootstrapCache, writeMacroRecoveryCache } from './bootstrapCache'
import type { BootstrapResponse } from '../types/domain'

afterEach(() => vi.unstubAllGlobals())
function storage() {
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
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
