import { AsyncLocalStorage } from 'node:async_hooks'

type Source = 'app' | 'development' | 'test' | 'unknown'
type UsageContext = {
  db: D1Database
  requestId: string
  profile: string | null
  feature: string
  source: Source
  callIndex: number
}
const storage = new AsyncLocalStorage<UsageContext>()
const label = (value: unknown): string | null =>
  typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : null

/** Attribution is diagnostic, not authentication: profiles and source labels are client-declared. */
export async function withAiUsage<T>(request: Request, db: D1Database, next: () => Promise<T>): Promise<T> {
  const url = new URL(request.url)
  let profile = label(request.headers.get('x-checkmark-profile')) || label(url.searchParams.get('profile'))
  let feature = url.pathname.split('/').filter(Boolean).slice(-2).join(':')
  if (/\/api\/(ai\/|macro\/estimate|fatsecret\/barcode)|\/macro\/packaging-retest$/.test(url.pathname)
      && request.headers.get('content-type')?.includes('application/json')) {
    try {
      const body = await request.clone().json() as Record<string, unknown>
      profile ||= label(body.profile)
      const promptKey = label(body.promptKey)
      if (promptKey) feature += `:${promptKey}`
    } catch { /* request handler reports invalid input */ }
  }
  const profileMatch = url.pathname.match(/\/api\/u\/([^/]+)\//)
  if (profileMatch) profile = label(profileMatch[1]) || profile
  const declared = request.headers.get('x-checkmark-source')
  const source: Source = declared === 'app' || declared === 'test' || declared === 'development'
    ? declared
    : url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? 'development' : 'unknown'
  return storage.run({ db, requestId: crypto.randomUUID(), profile, feature, source, callIndex: 0 }, next)
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/** Thin wrapper around native fetch; every retry/cross-check is a separate row in the same request. */
export async function trackedOpenAiFetch(url: string, init: RequestInit): Promise<Response> {
  const context = storage.getStore()
  if (!context) return fetch(url, init)
  const callIndex = ++context.callIndex
  const started = Date.now()
  let model: string | null = null
  try {
    model = init.body instanceof FormData
      ? label(init.body.get('model'))
      : label(JSON.parse(String(init.body)).model)
  } catch { /* missing metadata must not prevent the call */ }
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    await save(context, { callIndex, started, model, status: null, errorCode: 'network_or_timeout' })
    throw error
  }
  let body: Record<string, any> = {}
  try { body = await response.clone().json() as Record<string, any> } catch { /* non-JSON upstream error */ }
  const usage = body.usage ?? {}
  const details = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {}
  await save(context, {
    callIndex, started, model: label(body.model) || model, status: response.status,
    upstreamId: label(response.headers.get('x-request-id')),
    errorCode: response.ok ? null : label(body.error?.code) || 'upstream_error',
    input: count(usage.prompt_tokens ?? usage.input_tokens),
    output: count(usage.completion_tokens ?? usage.output_tokens),
    cached: count(details.cached_tokens),
    cacheWrite: count(details.cache_write_tokens ?? usage.cache_write_tokens),
    duration: count(usage.seconds),
  })
  return response
}

type CallRecord = {
  callIndex: number; started: number; model: string | null; status: number | null; errorCode: string | null
  upstreamId?: string | null; input?: number | null; output?: number | null
  cached?: number | null; cacheWrite?: number | null; duration?: number | null
}
async function save(context: UsageContext, call: CallRecord): Promise<void> {
  try {
    await context.db.prepare(`INSERT INTO ai_request_usage
      (id, request_id, created_at, profile_id, source, feature, call_index, model, http_status,
       error_code, upstream_request_id, input_tokens, output_tokens, cached_input_tokens,
       cache_write_tokens, audio_seconds, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), context.requestId, call.started, context.profile, context.source,
        context.feature, call.callIndex, call.model, call.status, call.errorCode, call.upstreamId ?? null,
        call.input ?? null, call.output ?? null, call.cached ?? null, call.cacheWrite ?? null,
        call.duration ?? null, Date.now() - call.started).run()
  } catch {
    // Fixed message only: never print request bodies, credentials, or upstream error text.
    console.error('AI usage record could not be saved')
  }
}
