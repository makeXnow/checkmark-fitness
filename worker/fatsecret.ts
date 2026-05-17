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

type EnvFatSecret = {
  FATSECRET_CLIENT_ID?: string
  FATSECRET_CLIENT_SECRET?: string
}

let tokenCache: { token: string; expiresAt: number } | null = null

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

/** Search FatSecret and return a compact list for AI + storage (max 8 foods, up to 4 servings each). */
export async function fatSecretSearchFoods(env: EnvFatSecret, query: string): Promise<FatSecretFoodRef[]> {
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
    const legacyData = await legacyRes.json()
    const legacyFoods = parseFatSecretSearchJson(legacyData)
    if (legacyFoods.length > 0) {
      return legacyFoods.map((f) => ({ ...f, servings: f.servings.slice(0, 4) }))
    }
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
    const data = await v1Res.json()
    const foods = parseFatSecretSearchJson(data)
    if (foods.length > 0) {
      return foods.map((f) => ({ ...f, servings: f.servings.slice(0, 4) }))
    }
  }

  const errText = legacyRes.ok ? '' : await legacyRes.text()
  throw new Error(`FatSecret search failed: ${errText.slice(0, 300)}`)
}
