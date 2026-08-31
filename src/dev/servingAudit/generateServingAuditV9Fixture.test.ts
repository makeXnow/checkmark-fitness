/**
 * Generate verified V9 serving audit fixture (live PARSER + MACROS; no AI #3).
 * Run: npm run audit:v9
 * Quick sample: AUDIT_LIMIT=5 npm run audit:v9
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  collectUniqueTestUserInputs,
  servingAuditV9RowsToCsv,
  type ServingAuditV9Row,
} from './servingAuditLib'
import { runServingAuditV9Core } from './servingAuditV9Core'
import type { ServingAuditV9Fixture } from './servingAuditV9Fixture'
import { validateServingAuditV9Rows } from './validateServingAuditV9Rows'
import type { BootstrapResponse } from '../../types/domain'
import type { ParsedFoodItem } from '../../features/macro/macroLib'
import { DEFAULT_MACRO_PROMPTS } from '../../features/macro/prompts'

const PROFILE = (process.env.AUDIT_PROFILE as string | undefined) || 'alexander'
const LIMIT_RAW = process.env.AUDIT_LIMIT
const LIMIT = LIMIT_RAW ? Math.max(1, Number(LIMIT_RAW)) : undefined
const SHOULD_RUN = process.env.AUDIT_GENERATE === '1'

const DEFAULT_WORKER_CANDIDATES = [
  process.env.AUDIT_WORKER,
  'http://127.0.0.1:8787',
  'http://localhost:8787',
].filter((v): v is string => Boolean(v))

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const publicFixturePath = join(rootDir, 'public/dev/serving-audit-v9-latest.json')
const publicCsvPath = join(rootDir, 'public/dev/serving-audit-v9-latest.csv')

async function fetchJsonAt<T>(worker: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${worker.replace(/\/$/, '')}${path}`, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} failed: ${text.slice(0, 400)}`)
  return JSON.parse(text) as T
}

/** Prefer a worker that returns V9 MACROS shape (bridgeQuestion + unitsPerServing). */
async function resolveV9WorkerOrigin(): Promise<string> {
  for (const candidate of DEFAULT_WORKER_CANDIDATES) {
    const origin = candidate.replace(/\/$/, '')
    try {
      const data = await fetchJsonAt<{ result?: { items?: Record<string, unknown>[] } }>(
        origin,
        '/api/ai/json',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            promptKey: 'PARSER',
            user: 'Input: 2 butter cookies',
          }),
        },
      )
      const item = data.result?.items?.[0]
      const hasV8Units =
        item &&
        typeof item.quantity === 'number' &&
        typeof item.unitSingular === 'string' &&
        typeof item.unitPlural === 'string' &&
        typeof item.unitFamily === 'string' &&
        typeof item.estimated === 'boolean'
      if (!hasV8Units) continue

      // Probe MACROS schema via a trivial structured call is expensive; accept parser-ready worker.
      // Audit generation also clears D1 prompts so code-default V9 MACROS is used.
      return origin
    } catch {
      // try next
    }
  }
  throw new Error(
    'No V9-capable worker found. Start local API (npx wrangler dev --port 8787 --ip 127.0.0.1), then rerun npm run audit:v9.',
  )
}

describe.runIf(SHOULD_RUN)('generate V9 serving audit fixture', () => {
  it(
    'runs live PARSER + MACROS and writes public fixture',
    async () => {
      const WORKER = await resolveV9WorkerOrigin()
      console.log(`Using worker: ${WORKER}`)

      // Force code-default V9 MACROS so a stored V8 prompt cannot leak into the audit.
      // Requires profile owner auth on local worker; otherwise clear D1 macro_ai_prompts manually.
      try {
        await fetchJsonAt(WORKER, `/api/u/${encodeURIComponent(PROFILE)}/macro/prompts`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            MACROS: DEFAULT_MACRO_PROMPTS.MACROS,
            PARSER: DEFAULT_MACRO_PROMPTS.PARSER,
          }),
        })
        console.log('Forced MACROS/PARSER prompts to code defaults for V9 audit')
      } catch (e) {
        console.warn(
          'Could not force-reset macro prompts via API:',
          e instanceof Error ? e.message : e,
          '— clear D1 macro_ai_prompts so code defaults apply.',
        )
      }

      const bootstrap = await fetchJsonAt<BootstrapResponse>(
        WORKER,
        `/api/u/${encodeURIComponent(PROFILE)}/bootstrap`,
      )
      const allInputs = collectUniqueTestUserInputs(bootstrap.macro.logs || {})
      const userInputs = LIMIT ? allInputs.slice(0, LIMIT) : allInputs
      expect(userInputs.length).toBeGreaterThan(0)

      const customFoods = bootstrap.macro.customFoods || []
      const rows: ServingAuditV9Row[] = await runServingAuditV9Core(userInputs, customFoods, {
        callParser: async (userInput) => {
          const data = await fetchJsonAt<{ result?: { items?: ParsedFoodItem[] } }>(
            WORKER,
            '/api/ai/json',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                promptKey: 'PARSER',
                user: `Input: ${userInput}`,
              }),
            },
          )
          return data.result ?? {}
        },
        callMacroEstimate: async (body) => {
          const snap = body.parseSnapshot
          const data = await fetchJsonAt<Record<string, unknown>>(WORKER, '/api/macro/estimate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: body.name,
              amount: body.amount,
              notes: body.notes,
              fatSecretSearch: body.fatSecretSearch,
              parseSnapshot: snap,
              userInput: body.userInput,
              customFoods: body.customFoods,
            }),
          })
          if (typeof data.error === 'string') throw new Error(data.error)
          return data as import('../../core/api').MacroEstimateApiResult & { v7CacheHit?: boolean }
        },
      })

      const validation = validateServingAuditV9Rows(rows)
      const fixture: ServingAuditV9Fixture = {
        auditVersion: 'v9',
        generatedAt: new Date().toISOString(),
        workerOrigin: WORKER,
        profile: PROFILE,
        inputCount: userInputs.length,
        rowCount: rows.length,
        validation,
        rows,
      }

      mkdirSync(dirname(publicFixturePath), { recursive: true })
      writeFileSync(publicFixturePath, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
      writeFileSync(publicCsvPath, `${servingAuditV9RowsToCsv(rows)}\n`, 'utf8')

      const relCounts: Record<string, number> = {}
      let bridge = 0
      let retries = 0
      const bridgePairs: Array<{ q: string; n: string; food: string }> = []
      for (const r of rows) {
        const rel = r.relationshipV7 || '(none)'
        relCounts[rel] = (relCounts[rel] ?? 0) + 1
        if (rel === 'NEEDS_UNIT_BRIDGE') {
          bridge += 1
          bridgePairs.push({
            q: r.unitBridgeQuestion,
            n: r.unitsPerServing,
            food: r.parsedName,
          })
        }
        if (r.relationshipRetryRan === 'yes') retries += 1
      }

      console.log(
        `Wrote ${rows.length} rows (${validation.passed}/${validation.total} passed validation) → public/dev/serving-audit-v9-latest.json`,
      )
      console.log('Relationship counts:', JSON.stringify(relCounts, null, 2))
      console.log(
        `NEEDS_UNIT_BRIDGE: ${bridge}/${rows.length} (${rows.length ? ((100 * bridge) / rows.length).toFixed(1) : 0}%)`,
      )
      console.log(`Relationship retries: ${retries}`)
      console.log('Bridge Q+units pairs:', JSON.stringify(bridgePairs, null, 2))

      if (validation.failed > 0) {
        const sample = validation.rows.filter((r) => !r.ok).slice(0, 5)
        console.log('Sample validation failures:', JSON.stringify(sample, null, 2))
      }

      expect(rows.length).toBeGreaterThan(0)
    },
    60 * 60 * 1000,
  )
})
