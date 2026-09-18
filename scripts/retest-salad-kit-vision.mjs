#!/usr/bin/env node
/**
 * Live vision regression for the Trader Joe's Lemony Arugula fixture photos.
 * Runs ANALYZE_NUTRITION 3× and checks whole-bag resolve → 470 cal / 12g protein.
 *
 *   node scripts/retest-salad-kit-vision.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const envText = fs.readFileSync(path.join(root, '.dev.vars'), 'utf8')
const keyLine = envText.split('\n').find((l) => l.startsWith('OPENAI_API_KEY='))
const apiKey = keyLine?.slice('OPENAI_API_KEY='.length).trim().replace(/^["']|["']$/g, '')
if (!apiKey) {
  console.error('No OPENAI_API_KEY in .dev.vars')
  process.exit(1)
}

const contentFile = fs.readFileSync(path.join(root, 'src/features/macro/macroPromptContent.ts'), 'utf8')
const extract = (name) => {
  const re = new RegExp(`export const ${name} = \`([\\s\\S]*?)\``)
  const m = contentFile.match(re)
  if (!m) throw new Error('missing ' + name)
  return m[1].replace(/\$\{[^}]+\}/g, '')
}
const system = extract('ANALYZE_NUTRITION_PROMPT')
const nutB64 = fs
  .readFileSync(path.join(root, 'src/features/macro/fixtures/tj-lemony-arugula-nutrition.jpg'))
  .toString('base64')

const schema = {
  name: 'analyze_nutrition_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      baseAmount: { type: 'string' },
      calories: { type: 'number' },
      protein: { type: 'number' },
      fat: { type: 'number' },
      carbs: { type: 'number' },
      servingsPerContainer: { type: ['number', 'null'] },
      caloriesPerContainer: { type: ['number', 'null'] },
      proteinPerContainer: { type: ['number', 'null'] },
      fatPerContainer: { type: ['number', 'null'] },
      carbsPerContainer: { type: ['number', 'null'] },
      packageAmount: { type: ['string', 'null'] },
    },
    required: [
      'baseAmount',
      'calories',
      'protein',
      'fat',
      'carbs',
      'servingsPerContainer',
      'caloriesPerContainer',
      'proteinPerContainer',
      'fatPerContainer',
      'carbsPerContainer',
      'packageAmount',
    ],
    additionalProperties: false,
  },
}

function optionalNonNeg(n) {
  if (n == null || n === 0) return null
  return Number(n)
}

function resolveWholeBag(vision) {
  const caloriesPerContainer = optionalNonNeg(vision.caloriesPerContainer)
  const proteinPerContainer = optionalNonNeg(vision.proteinPerContainer)
  const spc = optionalNonNeg(vision.servingsPerContainer)
  if (caloriesPerContainer != null) {
    return {
      mode: 'per_container',
      calories: Math.round(caloriesPerContainer),
      protein: proteinPerContainer != null ? proteinPerContainer : null,
    }
  }
  if (spc != null) {
    return {
      mode: 'servings_per_container',
      calories: Math.round(vision.calories * spc),
      protein: Math.round(vision.protein * spc * 10) / 10,
    }
  }
  return { mode: 'ask', calories: null, protein: null }
}

const results = []
for (let i = 1; i <= 3; i++) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5-nano',
      response_format: { type: 'json_schema', json_schema: schema },
      messages: [
        { role: 'system', content: system },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this nutrition facts panel. Respond with JSON.' },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${nutB64}` } },
          ],
        },
      ],
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`RUN ${i} FAILED`, res.status, text.slice(0, 400))
    process.exit(1)
  }
  const vision = JSON.parse(JSON.parse(text).choices?.[0]?.message?.content || '{}')
  const resolved = resolveWholeBag(vision)
  results.push({ run: i, vision, resolved })
  console.log(`RUN ${i}:`, JSON.stringify({ vision, resolved }))
}

const ok = results.every(
  (r) =>
    r.vision.calories === 170 &&
    r.vision.caloriesPerContainer === 470 &&
    r.vision.proteinPerContainer === 12 &&
    r.resolved.mode === 'per_container' &&
    r.resolved.calories === 470,
)
console.log(ok ? '\nPASS: 3/3 → whole bag 470 cal (per package)' : '\nFAIL')
process.exit(ok ? 0 : 1)
