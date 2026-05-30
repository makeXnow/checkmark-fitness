/**
 * Prototype: FatSecret barcode lookup (food.find_id_for_barcode.v2)
 *
 * Usage:
 *   node scripts/fatsecret-barcode-prototype.mjs [barcode] [region]
 *
 * Reads FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET from .dev.vars (or env).
 * Default barcode: 850064950434 (normalized to GTIN-13).
 *
 * Note: barcode lookup requires OAuth scope "barcode" (not just "basic" like text search).
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function loadDevVars() {
  const path = join(root, '.dev.vars')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    if (key && process.env[key] == null) process.env[key] = val
  }
}

/** Pad UPC-A / EAN-8 / EAN-13 to GTIN-13 for FatSecret. */
function toGtin13(raw) {
  const digits = String(raw).replace(/\D/g, '')
  if (digits.length > 13) throw new Error(`Barcode too long: ${digits}`)
  if (digits.length === 13) return digits
  return digits.padStart(13, '0')
}

async function getAccessToken(clientId, clientSecret, scope = 'basic barcode') {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const res = await fetch('https://oauth.fatsecret.com/connect/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`OAuth failed (${res.status}): ${text.slice(0, 300)}`)
  const data = JSON.parse(text)
  if (!data.access_token) throw new Error('OAuth returned no access_token')
  return data.access_token
}

async function lookupBarcode(token, gtin13, region) {
  const params = new URLSearchParams({
    barcode: gtin13,
    format: 'json',
    flag_default_serving: 'true',
  })
  if (region) params.set('region', region)

  const url = `https://platform.fatsecret.com/rest/food/barcode/find-by-id/v2?${params}`
  console.log('GET', url.replace(token, '***'))

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = { raw: text }
  }
  return { ok: res.ok, status: res.status, data }
}

function summarizeFood(data) {
  const food = data?.food ?? data?.food_id
  if (!food || typeof food !== 'object') return null

  const servingsRaw = food.servings?.serving
  const servings = Array.isArray(servingsRaw) ? servingsRaw : servingsRaw ? [servingsRaw] : []

  return {
    foodId: food.food_id,
    name: food.food_name,
    brand: food.brand_name,
    type: food.food_type,
    servings: servings.slice(0, 4).map((s) => ({
      id: s.serving_id,
      description: s.serving_description || s.measurement_description,
      calories: s.calories,
      protein: s.protein,
      isDefault: s.is_default === 1 || s.is_default === '1',
    })),
  }
}

async function main() {
  loadDevVars()

  const rawBarcode = process.argv[2] ?? '850064950434'
  const region = process.argv[3] ?? 'US'
  const gtin13 = toGtin13(rawBarcode)

  const clientId = process.env.FATSECRET_CLIENT_ID
  const clientSecret = process.env.FATSECRET_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    console.error('Missing FATSECRET_CLIENT_ID / FATSECRET_CLIENT_SECRET in .dev.vars or env')
    process.exit(1)
  }

  console.log(`Raw barcode: ${rawBarcode}`)
  console.log(`GTIN-13:     ${gtin13}`)
  console.log(`Region:      ${region}`)
  console.log()

  const token = await getAccessToken(clientId, clientSecret)
  console.log('OAuth scope: basic barcode — OK\n')

  const result = await lookupBarcode(token, gtin13, region)

  if (result.data?.error) {
    console.log('API error:', result.data.error)
  }

  const summary = summarizeFood(result.data)
  if (summary) {
    console.log('Match:')
    console.log(JSON.stringify(summary, null, 2))
  } else {
    console.log('No food match in response.')
    console.log('Full response:')
    console.log(JSON.stringify(result.data, null, 2))
  }

  if (!result.ok) process.exit(1)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
