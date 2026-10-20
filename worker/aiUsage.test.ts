import { afterEach, describe, expect, it, vi } from 'vitest'
import { trackedOpenAiFetch, withAiUsage } from './aiUsage'

const endpoint = 'https://api.openai.com/v1/chat/completions'
const init = { method: 'POST', body: JSON.stringify({ model: 'gpt-5.6-luna', messages: ['PRIVATE MEAL'] }) }
function database(fail = false) {
  const rows: unknown[][] = []
  return {
    rows,
    db: { prepare: vi.fn(() => ({ bind: (...args: unknown[]) => ({ run: async () => {
      if (fail) throw new Error('database down')
      rows.push(args)
    } }) })) } as unknown as D1Database,
  }
}
function request(profile: string, source = 'app') {
  return new Request('https://example.com/api/ai/json', { method: 'POST', headers: {
    'content-type': 'application/json', 'x-checkmark-source': source, 'x-checkmark-profile': profile,
  }, body: JSON.stringify({ promptKey: 'PARSER', user: 'PRIVATE MEAL' }) })
}
function success() {
  return Response.json({ model: 'gpt-5.6-luna', choices: [], usage: {
    prompt_tokens: 1200, completion_tokens: 50,
    prompt_tokens_details: { cached_tokens: 200, cache_write_tokens: 500 },
  } }, { headers: { 'x-request-id': 'req_123' } })
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('AI usage attribution', () => {
  it('keeps concurrent users isolated and groups repeated calls within the inbound request', async () => {
    const { db, rows } = database()
    vi.stubGlobal('fetch', vi.fn(async () => { await Promise.resolve(); return success() }))
    await Promise.all([
      withAiUsage(request('alexander'), db, async () => {
        await trackedOpenAiFetch(endpoint, init)
        await trackedOpenAiFetch(endpoint, init)
      }),
      withAiUsage(request('second', 'test'), db, async () => { await trackedOpenAiFetch(endpoint, init) }),
    ])
    const first = rows.filter(row => row[3] === 'alexander')
    expect(first.map(row => row[6])).toEqual([1, 2])
    expect(first[0][1]).toBe(first[1][1])
    const second = rows.find(row => row[3] === 'second')!
    expect(second[1]).not.toBe(first[0][1])
    expect(second[4]).toBe('test')
    expect(first[0].slice(11, 15)).toEqual([1200, 50, 200, 500])
    expect(JSON.stringify(rows)).not.toContain('PRIVATE MEAL')
  })

  it('records sanitized billing errors and leaves the original response readable', async () => {
    const { db, rows } = database()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: {
      code: 'credit_balance_exhausted', message: 'PRIVATE ERROR',
    } }, { status: 429 })))
    const result = await withAiUsage(request('alexander'), db, () => trackedOpenAiFetch(endpoint, init))
    expect(result.status).toBe(429)
    expect(await result.json()).toHaveProperty('error.message', 'PRIVATE ERROR')
    expect(rows[0][9]).toBe('credit_balance_exhausted')
    expect(rows[0][11]).toBeNull()
    expect(JSON.stringify(rows)).not.toContain('PRIVATE ERROR')
  })

  it('records network failures and rethrows the original error', async () => {
    const { db, rows } = database()
    const error = new Error('timeout with private details')
    vi.stubGlobal('fetch', vi.fn(async () => { throw error }))
    await expect(withAiUsage(request('alexander'), db, () => trackedOpenAiFetch(endpoint, init))).rejects.toBe(error)
    expect(rows[0][8]).toBeNull()
    expect(rows[0][9]).toBe('network_or_timeout')
  })

  it('does not break a successful request when logging fails', async () => {
    const { db } = database(true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn(async () => success()))
    const response = await withAiUsage(request('alexander'), db, () => trackedOpenAiFetch(endpoint, init))
    expect(response.status).toBe(200)
    expect(console.error).toHaveBeenCalledWith('AI usage record could not be saved')
  })

  it('does not invent user attribution or token counts for unmarked/audio requests', async () => {
    const { db, rows } = database()
    const form = new FormData()
    form.set('model', 'gpt-4o-transcribe')
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ text: 'PRIVATE AUDIO' })))
    await withAiUsage(new Request('https://example.com/api/ai/transcribe'), db,
      () => trackedOpenAiFetch(endpoint, { method: 'POST', body: form }))
    expect(rows[0][3]).toBeNull()
    expect(rows[0][4]).toBe('unknown')
    expect(rows[0][7]).toBe('gpt-4o-transcribe')
    expect(rows[0][11]).toBeNull()
    expect(JSON.stringify(rows)).not.toContain('PRIVATE AUDIO')
  })
})
