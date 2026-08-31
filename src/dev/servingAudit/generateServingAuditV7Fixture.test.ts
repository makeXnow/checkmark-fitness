/**
 * Generate verified V7 serving audit fixture (live PARSER + MACROS).
 * Run: npm run audit:v7
 * Quick sample: AUDIT_LIMIT=5 npm run audit:v7
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  collectUniqueTestUserInputs,
  servingAuditV7RowsToCsv,
  type ServingAuditV7Row,
} from './servingAuditLib'
import { runServingAuditV7Core } from './servingAuditV7Core'
import type { ServingAuditV7Fixture } from './servingAuditV7Fixture'
import { validateServingAuditV7Rows } from './validateServingAuditV7Rows'
import type { BootstrapResponse } from '../../types/domain'
import type { ParsedFoodItem } from '../../features/macro/macroLib'
import { parseSnapshotFromItem } from '../../features/macro/macroLib'

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
const publicFixturePath = join(rootDir, 'public/dev/serving-audit-v7-latest.json')
const publicCsvPath = join(rootDir, 'public/dev/serving-audit-v7-latest.csv')

async function fetchJsonAt<T>(worker: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${worker.replace(/\/$/, '')}${path}`, init)
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} failed: ${text.slice(0, 400)}`)
  return JSON.parse(text) as T
}

/** Prefer a worker that returns V7 parser shape (quantity + unit + unitFamily). */
async function resolveV7WorkerOrigin(): Promise<string> {
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
            user: 'Input: 2 Oreo cookies',
          }),
        },
      )
      const item = data.result?.items?.[0]
      if (
        item &&
        typeof item.quantity === 'number' &&
        typeof item.unit === 'string' &&
        typeof item.unitFamily === 'string' &&
        typeof item.estimated === 'boolean'
      ) {
        return origin
      }
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    'No V7-capable worker found. Start local API (npx wrangler dev --port 8787 --ip 127.0.0.1), then rerun npm run audit:v7.',
  )
}

describe.runIf(SHOULD_RUN)('generate V7 serving audit fixture', () => {
  it(
    'runs live PARSER + MACROS and writes public fixture',
    async () => {
      const WORKER = await resolveV7WorkerOrigin()
      console.log(`Using worker: ${WORKER}`)

      const bootstrap = await fetchJsonAt<BootstrapResponse>(
        WORKER,
        `/api/u/${encodeURIComponent(PROFILE)}/bootstrap`,
      )
      const allInputs = collectUniqueTestUserInputs(bootstrap.macro.logs || {})
      const userInputs = LIMIT ? allInputs.slice(0, LIMIT) : allInputs
      expect(userInputs.length).toBeGreaterThan(0)

      const customFoods = bootstrap.macro.customFoods || []
      const rows: ServingAuditV7Row[] = await runServingAuditV7Core(userInputs, customFoods, {
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

      const validation = validateServingAuditV7Rows(rows)
      const fixture: ServingAuditV7Fixture = {
        auditVersion: 'v7',
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
      writeFileSync(publicCsvPath, `${servingAuditV7RowsToCsv(rows)}\n`, 'utf8')

      console.log(
        `Wrote ${rows.length} rows (${validation.passed}/${validation.total} passed validation) → public/dev/serving-audit-v7-latest.json`,
      )

      if (validation.failed > 0) {
        const sample = validation.rows.filter((r) => !r.ok).slice(0, 5)
        console.log('Sample validation failures:', JSON.stringify(sample, null, 2))
      }

      expect(validation.passed).toBeGreaterThan(0)
      expect(validation.passed / Math.max(validation.total, 1)).toBeGreaterThan(0.7)

      const okRow = rows.find((r) => r.rawParserJson && !r.error)
      expect(okRow).toBeTruthy()
      const parser = JSON.parse(okRow!.rawParserJson!) as Record<string, unknown>
      expect(typeof parser.quantity).toBe('number')
      expect(typeof parser.unit).toBe('string')
      expect(typeof parser.unitFamily).toBe('string')
      expect(typeof parser.estimated).toBe('boolean')
      expect(parseSnapshotFromItem(parser as ParsedFoodItem).quantity).toBeGreaterThan(0)
    },
    7_200_000,
  )
})
