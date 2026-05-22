/** Trimmed FatSecret search snapshot stored on diary items (not shown in UI). */
export type FatSecretServingRef = {
  servingId: string
  description: string
  calories: number
  protein: number
  isDefault?: boolean
}

export type FatSecretFoodRef = {
  foodId: string
  name: string
  brandName?: string
  foodType?: string
  servings: FatSecretServingRef[]
}

import type { FatSecretRoute } from '../src/types/domain'

export type FatSecretSearchResult = {
  foods: FatSecretFoodRef[]
  route: FatSecretRoute
}

type EnvFatSecret = {
  FATSECRET_CLIENT_ID?: string
  FATSECRET_CLIENT_SECRET?: string
  /** Set to `1` in .dev.vars when running `wrangler dev` (home IP egress). */
  FATSECRET_LOCAL_EGRESS?: string
  /** Public base URL of your home tunnel, e.g. https://fatsecret-relay.example.com */
  FATSECRET_RELAY_URL?: string
  /** Shared secret; must match on relay (local) and deployed Worker. */
  FATSECRET_RELAY_SECRET?: string
}

export class FatSecretIpDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FatSecretIpDeniedError'
  }
}

function isLocalEgress(env: EnvFatSecret): boolean {
  const v = env.FATSECRET_LOCAL_EGRESS?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

export function verifyFatSecretRelayAuth(authHeader: string | undefined, secret: string | undefined): boolean {
  if (!secret?.trim()) return false
  const expected = `Bearer ${secret.trim()}`
  return authHeader === expected
}

let tokenCache: { token: string; expiresAt: number } | null = null

/** FatSecret returns HTTP 200 with { error: { code, message } } for IP whitelist failures, etc. */
function fatSecretApiErrorMessage(body: string): string | null {
  try {
    const data = JSON.parse(body) as { error?: { code?: number; message?: string } }
    const err = data.error
    if (!err?.message) return null
    if (err.code === 21) {
      return `FatSecret IP not allowed (${err.message}). Whitelist Cloudflare egress, use a home relay (FATSECRET_RELAY_URL), or run locally with FATSECRET_LOCAL_EGRESS=1.`
    }
    return `FatSecret API error ${err.code ?? ''}: ${err.message}`.trim()
  } catch {
    return null
  }
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

function parseFoodDescription(desc: string): { description: string; calories: number; protein: number } | null {
  const perMatch = desc.match(/^Per\s+(.+?)\s+-/i)
  const calMatch = desc.match(/Calories:\s*([\d.]+)/i)
  const proMatch = desc.match(/Protein:\s*([\d.]+)/i)
  if (!calMatch) return null
  return {
    description: perMatch?.[1]?.trim() || '1 serving',
    calories: num(calMatch[1]),
    protein: proMatch ? num(proMatch[1]) : 0,
  }
}

function parseLegacyFoodsSearch(root: Record<string, unknown>): FatSecretFoodRef[] {
  const foodsBlock = root.foods as Record<string, unknown> | undefined
  if (!foodsBlock) return []
  const foods = asArray(foodsBlock.food as Record<string, unknown> | Record<string, unknown>[])
  const out: FatSecretFoodRef[] = []
  for (const food of foods) {
    const foodId = str(food.food_id)
    const desc = str(food.food_description)
    const parsed = desc ? parseFoodDescription(desc) : null
    if (!foodId || !parsed) continue
    out.push({
      foodId,
      name: str(food.food_name),
      brandName: str(food.brand_name) || undefined,
      foodType: str(food.food_type) || undefined,
      servings: [
        {
          servingId: `${foodId}-0`,
          description: parsed.description,
          calories: parsed.calories,
          protein: parsed.protein,
          isDefault: true,
        },
      ],
    })
  }
  return out
}

export function parseFatSecretSearchJson(data: unknown): FatSecretFoodRef[] {
  if (!data || typeof data !== 'object') return []
  const root = data as Record<string, unknown>
  if (root.foods) return parseLegacyFoodsSearch(root)

  const foodsSearch = (root.foods_search ?? root) as Record<string, unknown>
  const results = foodsSearch.results as Record<string, unknown> | undefined
  const foods = asArray(results?.food as Record<string, unknown> | Record<string, unknown>[])

  const out: FatSecretFoodRef[] = []
  for (const food of foods) {
    const foodId = str(food.food_id)
    if (!foodId) continue
    const servingsRaw = food.servings as Record<string, unknown> | undefined
    const servingList = asArray(servingsRaw?.serving as Record<string, unknown> | Record<string, unknown>[])
    const servings: FatSecretServingRef[] = servingList
      .map((s) => {
        const servingId = str(s.serving_id)
        if (!servingId) return null
        return {
          servingId,
          description: str(s.serving_description) || str(s.measurement_description) || '1 serving',
          calories: num(s.calories),
          protein: num(s.protein),
          isDefault: s.is_default === 1 || s.is_default === '1',
        }
      })
      .filter((s): s is FatSecretServingRef => s != null)

    if (servings.length === 0) continue

    out.push({
      foodId,
      name: str(food.food_name),
      brandName: str(food.brand_name) || undefined,
      foodType: str(food.food_type) || undefined,
      servings,
    })
  }
  return out
}

async function getAccessToken(env: EnvFatSecret): Promise<string> {
  const id = env.FATSECRET_CLIENT_ID
  const secret = env.FATSECRET_CLIENT_SECRET
  if (!id || !secret) throw new Error('FatSecret credentials missing')

  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token
  }

  const basic = btoa(`${id}:${secret}`)
  const res = await fetch('https://oauth.fatsecret.com/connect/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=basic',
  })

  if (!res.ok) {
    const detail = await res.text()
    throw new Error(`FatSecret OAuth failed: ${detail.slice(0, 300)}`)
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number }
  const token = data.access_token
  if (!token) throw new Error('FatSecret OAuth returned no token')

  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600
  tokenCache = { token, expiresAt: Date.now() + expiresIn * 1000 }
  return token
}

function trimFoods(foods: FatSecretFoodRef[]): FatSecretFoodRef[] {
  return foods.map((f) => ({ ...f, servings: f.servings.slice(0, 4) }))
}

function throwFatSecretApiError(msg: string | null): void {
  if (!msg) return
  if (msg.includes('IP not allowed')) throw new FatSecretIpDeniedError(msg)
  throw new Error(msg)
}

/** Direct FatSecret call from this Worker (no home relay). */
export async function fatSecretSearchFoodsDirect(env: EnvFatSecret, query: string): Promise<FatSecretFoodRef[]> {
  const q = query.trim()
  if (!q) return []

  const token = await getAccessToken(env)

  // Free tier: legacy foods.search on server.api (REST v3 needs premier; v1 is IP-sensitive).
  const legacyRes = await fetch('https://platform.fatsecret.com/rest/server.api', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      method: 'foods.search',
      search_expression: q,
      max_results: '8',
      format: 'json',
    }),
  })
  if (legacyRes.ok) {
    const legacyText = await legacyRes.text()
    const legacyErr = fatSecretApiErrorMessage(legacyText)
    throwFatSecretApiError(legacyErr)
    let legacyData: unknown
    try {
      legacyData = JSON.parse(legacyText)
    } catch {
      legacyData = null
    }
    const legacyFoods = parseFatSecretSearchJson(legacyData)
    if (legacyFoods.length > 0) return trimFoods(legacyFoods)
  }

  const params = new URLSearchParams({
    search_expression: q,
    max_results: '8',
    format: 'json',
    flag_default_serving: 'true',
  })
  const v1Res = await fetch(`https://platform.fatsecret.com/rest/foods/search/v1?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (v1Res.ok) {
    const v1Text = await v1Res.text()
    const v1Err = fatSecretApiErrorMessage(v1Text)
    throwFatSecretApiError(v1Err)
    let data: unknown
    try {
      data = JSON.parse(v1Text)
    } catch {
      data = null
    }
    const foods = parseFatSecretSearchJson(data)
    if (foods.length > 0) return trimFoods(foods)
  }

  const errText = legacyRes.ok ? '' : await legacyRes.text()
  const apiErr = fatSecretApiErrorMessage(errText)
  throwFatSecretApiError(apiErr)
  throw new Error(`FatSecret search failed: ${errText.slice(0, 300)}`)
}

async function fatSecretSearchViaRelay(env: EnvFatSecret, query: string): Promise<FatSecretFoodRef[]> {
  const base = env.FATSECRET_RELAY_URL?.trim().replace(/\/$/, '')
  const secret = env.FATSECRET_RELAY_SECRET?.trim()
  if (!base || !secret) {
    throw new Error('FatSecret home relay not configured (FATSECRET_RELAY_URL / FATSECRET_RELAY_SECRET)')
  }

  const res = await fetch(`${base}/api/internal/fatsecret/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ query }),
  })

  const text = await res.text()
  let data: { foods?: FatSecretFoodRef[]; error?: string }
  try {
    data = JSON.parse(text) as { foods?: FatSecretFoodRef[]; error?: string }
  } catch {
    throw new Error(`FatSecret relay invalid JSON: ${text.slice(0, 200)}`)
  }

  if (!res.ok || data.error) {
    throw new Error(data.error || `FatSecret relay failed (${res.status}): ${text.slice(0, 200)}`)
  }

  return data.foods ?? []
}

/**
 * Search FatSecret: direct from this Worker, then optional home relay on IP denial.
 * `route` is `computer` when FATSECRET_LOCAL_EGRESS=1, `cloud` when direct from deploy, `relay` via tunnel.
 */
export async function fatSecretSearchFoods(env: EnvFatSecret, query: string): Promise<FatSecretSearchResult> {
  const q = query.trim()
  if (!q) return { foods: [], route: isLocalEgress(env) ? 'computer' : 'cloud' }

  try {
    const foods = await fatSecretSearchFoodsDirect(env, q)
    return { foods, route: isLocalEgress(env) ? 'computer' : 'cloud' }
  } catch (e) {
    if (e instanceof FatSecretIpDeniedError && env.FATSECRET_RELAY_URL?.trim()) {
      const foods = await fatSecretSearchViaRelay(env, q)
      return { foods, route: 'relay' }
    }
    throw e
  }
}

/** Home relay handler: direct FatSecret only (whitelisted home IP). */
export async function fatSecretSearchFoodsForRelay(env: EnvFatSecret, query: string): Promise<FatSecretSearchResult> {
  const foods = await fatSecretSearchFoodsDirect(env, query)
  return { foods, route: 'computer' }
}
