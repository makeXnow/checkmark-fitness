import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Play, Trash2 } from 'lucide-react'
import { apiFetchForProfile } from '../../core/apiPaths'
import type { BootstrapResponse } from '../../types/domain'
import { devServingAuditHref, devServingAuditVersion } from '../../lib/devRoutes'
import { FatSecretMatchPicker, ServingCell } from './ServingAuditComponents'
import {
  buildServingAuditRows,
  collectUniqueTestUserInputs,
  downloadServingAuditCsv,
  downloadServingAuditV2Csv,
  downloadServingAuditV3Csv,
  downloadServingAuditV4Csv,
  fatSecretFoodLabel,
  SERVING_AUDIT_PROFILE,
  type ServingAuditRow,
  type ServingAuditV2Row,
  type ServingAuditV3Row,
  type ServingAuditV4Row,
} from './servingAuditLib'
import {
  clearV2Cache,
  loadV2Cache,
  rerunServingAuditV2,
  type V2RunProgress,
} from './servingAuditV2Runner'
import {
  clearV3Cache,
  loadV3Cache,
  rerunServingAuditV3,
  type V3RunProgress,
} from './servingAuditV3Runner'
import {
  clearV4Cache,
  loadV4Cache,
  rerunServingAuditV4,
  type V4RunProgress,
} from './servingAuditV4Runner'
import {
  clearV5Cache,
  downloadServingAuditV5Csv,
  loadV5Cache,
  rebuildV5FromV4Cache,
  type ServingAuditV5Row,
} from './servingAuditV5Runner'
import {
  downloadServingAuditV6Csv,
} from './servingAuditV6Runner'
import {
  loadServingAuditV6Fixture,
  type ServingAuditV6Fixture,
} from './servingAuditV6Fixture'
import {
  downloadServingAuditV7Csv,
} from './servingAuditV7Runner'
import {
  loadServingAuditV7Fixture,
  type ServingAuditV7Fixture,
} from './servingAuditV7Fixture'
import {
  downloadServingAuditV8Csv,
} from './servingAuditV8Runner'
import {
  loadServingAuditV8Fixture,
  type ServingAuditV8Fixture,
} from './servingAuditV8Fixture'
import {
  downloadServingAuditV9Csv,
} from './servingAuditV9Runner'
import {
  loadServingAuditV9Fixture,
  type ServingAuditV9Fixture,
} from './servingAuditV9Fixture'

type AuditVersion = 'v1' | 'v2' | 'v3' | 'v4' | 'v5' | 'v6' | 'v7' | 'v8' | 'v9'

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) {
    throw new Error(text.trim().slice(0, 400) || res.statusText)
  }
  return JSON.parse(text) as T
}

function AuditNav({ version }: { version: AuditVersion }) {
  const linkClass = (v: AuditVersion) =>
    `rounded-lg px-3 py-1.5 text-sm font-bold transition-colors ${
      version === v
        ? 'bg-emerald-400/15 text-emerald-300'
        : 'text-white/50 hover:text-white/80 hover:bg-white/5'
    }`

  return (
    <nav className="flex items-center gap-2">
      <a href={devServingAuditHref('v1')} className={linkClass('v1')}>
        V1 — historical
      </a>
      <a href={devServingAuditHref('v2')} className={linkClass('v2')}>
        V2 — pipeline
      </a>
      <a href={devServingAuditHref('v3')} className={linkClass('v3')}>
        V3 — trace (legacy)
      </a>
      <a href={devServingAuditHref('v4')} className={linkClass('v4')}>
        V4 — original
      </a>
      <a href={devServingAuditHref('v5')} className={linkClass('v5')}>
        V5 — fixed
      </a>
      <a href={devServingAuditHref('v6')} className={linkClass('v6')}>
        V6
      </a>
      <a href={devServingAuditHref('v7')} className={linkClass('v7')}>
        V7
      </a>
      <a href={devServingAuditHref('v8')} className={linkClass('v8')}>
        V8
      </a>
      <a href={devServingAuditHref('v9')} className={linkClass('v9')}>
        V9 — current
      </a>
    </nav>
  )
}

function V1Table({ rows }: { rows: ServingAuditRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [onlyEdited, setOnlyEdited] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((row) => {
      if (onlyEdited && !row.manuallyEdited) return false
      if (!q) return true
      return [
        row.userInput,
        row.parsedName,
        row.parsedAmount,
        fatSecretFoodLabel(row.selectedFood),
        row.fsOriginalServing,
        row.firstShot?.display,
        row.current?.display,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [onlyEdited, query, rows])

  const editedCount = rows.filter((row) => row.manuallyEdited).length

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          className="min-w-[14rem] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-emerald-400/40"
        />
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={onlyEdited}
            onChange={(e) => setOnlyEdited(e.target.checked)}
            className="rounded border-white/20"
          />
          Only manually edited ({editedCount})
        </label>
        <p className="text-sm text-white/45">
          Showing {filtered.length} of {rows.length}
        </p>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadServingAuditCsv(filtered, 'serving-audit-v1.csv')}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Download className="size-4" />
          Export CSV
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-[1100px] w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
            <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-white/45">
              <th className="px-3 py-3 w-28">Date</th>
              <th className="px-3 py-3 min-w-[12rem]">User said</th>
              <th className="px-3 py-3 min-w-[8rem]">AI parsed</th>
              <th className="px-3 py-3 min-w-[12rem]">FatSecret match</th>
              <th className="px-3 py-3 min-w-[7rem]">FS serving</th>
              <th className="px-3 py-3 min-w-[8rem]">First shot</th>
              <th className="px-3 py-3 min-w-[8rem]">Current</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className={`border-b border-white/5 align-top ${
                  row.manuallyEdited ? 'bg-amber-400/[0.04]' : 'hover:bg-white/[0.02]'
                }`}
              >
                <td className="px-3 py-3 text-xs text-white/55 whitespace-nowrap">{row.date}</td>
                <td className="px-3 py-3 text-xs text-white/75 max-w-[18rem]">
                  <p className="line-clamp-4" title={row.userInput}>
                    {row.userInput}
                  </p>
                </td>
                <td className="px-3 py-3 text-xs text-white/80">
                  <p className="font-semibold">{row.parsedName}</p>
                  <p className="text-white/45 mt-0.5">{row.parsedAmount}</p>
                </td>
                <td className="px-3 py-3">
                  <FatSecretMatchPicker
                    selectedFood={row.selectedFood}
                    selectedFoodIndex={row.selectedFoodIndex}
                    selectedServing={row.selectedServing}
                    selectedServingIndex={row.selectedServingIndex}
                    fatSecretResults={row.fatSecretResults}
                    expanded={expandedId === row.id}
                    onToggle={() => setExpandedId((prev) => (prev === row.id ? null : row.id))}
                  />
                </td>
                <td className="px-3 py-3 text-xs text-white/75">{row.fsOriginalServing}</td>
                <td className="px-3 py-3 text-xs">
                  <ServingCell fields={row.firstShot} baseLabel="First shot" />
                </td>
                <td className="px-3 py-3 text-xs">
                  {row.manuallyEdited ? (
                    <div className="space-y-1">
                      <span className="inline-block rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-300/90">
                        Edited
                      </span>
                      <ServingCell fields={row.current} baseLabel="Current" />
                    </div>
                  ) : (
                    <span className="text-white/35">Same as first shot</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function V2Table({
  rows,
  uniqueInputCount,
  onRun,
  onClear,
  running,
  progress,
}: {
  rows: ServingAuditV2Row[]
  uniqueInputCount: number
  onRun: () => void
  onClear: () => void
  running: boolean
  progress: V2RunProgress | null
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [row.userInput, row.parsedName, row.parsedAmount, row.result?.display, row.error]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, rows])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={running || uniqueInputCount === 0}
          onClick={onRun}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {running ? 'Running…' : `Run ${uniqueInputCount} unique inputs`}
        </button>
        <button
          type="button"
          disabled={running || rows.length === 0}
          onClick={onClear}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/60 hover:bg-white/10 disabled:opacity-40"
        >
          <Trash2 className="size-4" />
          Clear cache
        </button>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          className="min-w-[14rem] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-emerald-400/40"
        />
        <p className="text-sm text-white/45">
          {rows.length} result rows · {uniqueInputCount} test inputs
        </p>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadServingAuditV2Csv(filtered)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40"
        >
          <Download className="size-4" />
          Export CSV
        </button>
      </div>

      {progress ? (
        <p className="text-xs text-white/45 truncate">
          {progress.done}/{progress.total}
          {progress.current ? ` — ${progress.current}` : ''}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-[1000px] w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
            <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-white/45">
              <th className="px-3 py-3 min-w-[12rem]">User said</th>
              <th className="px-3 py-3 min-w-[8rem]">AI parsed</th>
              <th className="px-3 py-3 min-w-[12rem]">FatSecret match</th>
              <th className="px-3 py-3 min-w-[7rem]">FS serving</th>
              <th className="px-3 py-3 min-w-[8rem]">V2 result</th>
              <th className="px-3 py-3 min-w-[6rem]">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-white/40">
                  {rows.length === 0
                    ? 'Click Run to re-process unique user inputs through the new pipeline.'
                    : 'No rows match your filter.'}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.id} className="border-b border-white/5 align-top hover:bg-white/[0.02]">
                  <td className="px-3 py-3 text-xs text-white/75 max-w-[18rem]">
                    <p className="line-clamp-4" title={row.userInput}>
                      {row.userInput}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-xs text-white/80">
                    <p className="font-semibold">{row.parsedName}</p>
                    <p className="text-white/45 mt-0.5">{row.parsedAmount}</p>
                  </td>
                  <td className="px-3 py-3">
                    <FatSecretMatchPicker
                      selectedFood={row.selectedFood}
                      selectedFoodIndex={row.selectedFoodIndex}
                      selectedServing={row.selectedServing}
                      selectedServingIndex={row.selectedServingIndex}
                      fatSecretResults={row.fatSecretResults}
                      expanded={expandedId === row.id}
                      onToggle={() => setExpandedId((prev) => (prev === row.id ? null : row.id))}
                    />
                  </td>
                  <td className="px-3 py-3 text-xs text-white/75">{row.fsOriginalServing}</td>
                  <td className="px-3 py-3 text-xs">
                    <ServingCell fields={row.result} baseLabel="Result" />
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {row.error ? (
                      <span className="text-red-300/90">{row.error}</span>
                    ) : (
                      <span className="text-emerald-400/80">OK</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function V6FixturePanel() {
  const [fixture, setFixture] = useState<ServingAuditV6Fixture | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await loadServingAuditV6Fixture()
        if (!cancelled) {
          setFixture(data)
          setLoadError('')
        }
      } catch (e) {
        if (!cancelled) {
          setFixture(null)
          setLoadError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const rows = fixture?.rows ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [
        row.userInput,
        row.parsedName,
        row.parsedAmount,
        row.consumptionQty,
        row.consumptionUnit,
        row.computedMultiplier,
        row.result?.display,
        row.error,
        row.rawParserJson,
        row.rawMacrosJson,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, rows])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-white/50">
        <Loader2 className="size-5 animate-spin" />
        Loading verified V6 fixture…
      </div>
    )
  }

  if (loadError || !fixture) {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        {loadError || 'V6 fixture missing.'}
      </div>
    )
  }

  const generated = new Date(fixture.generatedAt)
  const generatedLabel = Number.isFinite(generated.getTime())
    ? generated.toLocaleString()
    : fixture.generatedAt

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100/90">
        <p>
          Verified fixture · generated {generatedLabel} · {fixture.rowCount} rows from {fixture.inputCount}{' '}
          inputs · validation {fixture.validation.passed}/{fixture.validation.total} passed
        </p>
        <p className="mt-1 text-xs text-white/45">
          Source: {fixture.workerOrigin} · profile {fixture.profile} · audit v6
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          className="min-w-[14rem] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-emerald-400/40"
        />
        <p className="text-sm text-white/45">
          {filtered.length} shown · {rows.length} total
        </p>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadServingAuditV6Csv(filtered, 'serving-audit-v6-latest.csv')}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"
        >
          <Download className="size-4" />
          Download CSV
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-[1500px] w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
            <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-white/45">
              <th className="px-3 py-3 min-w-[10rem]">User said</th>
              <th className="px-3 py-3 min-w-[7rem]">Parsed</th>
              <th className="px-3 py-3 min-w-[6rem]">Parser qty</th>
              <th className="px-3 py-3 min-w-[6rem]">Parser unit</th>
              <th className="px-3 py-3 min-w-[8rem]">FS match</th>
              <th className="px-3 py-3 min-w-[6rem]">FS serving</th>
              <th className="px-3 py-3 min-w-[5rem]">AI mult</th>
              <th className="px-3 py-3 min-w-[7rem]">Card display</th>
              <th className="px-3 py-3 min-w-[5rem]">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-white/40">
                  No rows match filter.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const rowOk = fixture.validation.rows.find((v) => v.rowId === row.id)?.ok ?? !row.error
                const expanded = expandedId === row.id
                return (
                  <tr key={row.id} className="border-b border-white/5 align-top text-xs text-white/80">
                    <td className="px-3 py-2 max-w-[14rem]">
                      <button
                        type="button"
                        className="text-left hover:text-white"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        {row.userInput}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-white/90">{row.parsedName}</div>
                      <div className="text-white/45">{row.parsedAmount}</div>
                    </td>
                    <td className="px-3 py-2">{row.consumptionQty || '—'}</td>
                    <td className="px-3 py-2">{row.consumptionUnit || '—'}</td>
                    <td className="px-3 py-2">{row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '—'}</td>
                    <td className="px-3 py-2">{row.fsOriginalServing || '—'}</td>
                    <td className="px-3 py-2">{row.computedMultiplier || '—'}</td>
                    <td className="px-3 py-2">{row.result?.display ?? '—'}</td>
                    <td className="px-3 py-2">
                      {row.error ? (
                        <span className="text-red-300">error</span>
                      ) : rowOk ? (
                        <span className="text-emerald-300">ok</span>
                      ) : (
                        <span className="text-amber-300">check</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {expandedId ? (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-white/70">
          {(() => {
            const row = rows.find((r) => r.id === expandedId)
            if (!row) return null
            const validation = fixture.validation.rows.find((v) => v.rowId === row.id)
            return (
              <div className="space-y-3">
                {validation && validation.issues.length > 0 ? (
                  <p className="text-amber-200">Validation: {validation.issues.join(' · ')}</p>
                ) : null}
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw parser JSON</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawParserJson || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw macros JSON</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawMacrosJson || '—'}
                  </pre>
                </div>
              </div>
            )
          })()}
        </div>
      ) : null}
    </div>
  )
}

function V7FixturePanel() {
  const [fixture, setFixture] = useState<ServingAuditV7Fixture | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await loadServingAuditV7Fixture()
        if (!cancelled) {
          setFixture(data)
          setLoadError('')
        }
      } catch (e) {
        if (!cancelled) {
          setFixture(null)
          setLoadError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const rows = fixture?.rows ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [
        row.userInput,
        row.parsedName,
        row.parsedAmount,
        row.consumptionQty,
        row.consumptionUnit,
        row.unitFamily,
        row.estimated,
        row.originalPortion,
        row.relationshipV7,
        row.computedMultiplier,
        row.result?.display,
        row.error,
        row.rawParserJson,
        row.rawMacrosJson,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, rows])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-white/50">
        <Loader2 className="size-5 animate-spin" />
        Loading verified V7 fixture…
      </div>
    )
  }

  if (loadError || !fixture) {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        {loadError || 'V7 fixture missing.'}
      </div>
    )
  }

  const generated = new Date(fixture.generatedAt)
  const generatedLabel = Number.isFinite(generated.getTime())
    ? generated.toLocaleString()
    : fixture.generatedAt

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100/90">
        <p>
          Verified fixture · generated {generatedLabel} · {fixture.rowCount} rows from {fixture.inputCount}{' '}
          inputs · validation {fixture.validation.passed}/{fixture.validation.total} passed
        </p>
        <p className="mt-1 text-xs text-white/45">
          Source: {fixture.workerOrigin} · profile {fixture.profile} · audit v7
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          className="min-w-[14rem] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-emerald-400/40"
        />
        <p className="text-sm text-white/45">
          {filtered.length} shown · {rows.length} total
        </p>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadServingAuditV7Csv(filtered, 'serving-audit-v7-latest.csv')}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"
        >
          <Download className="size-4" />
          Download CSV
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-[1800px] w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
            <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-white/45">
              <th className="px-3 py-3 min-w-[10rem]">User said</th>
              <th className="px-3 py-3 min-w-[7rem]">Parsed</th>
              <th className="px-3 py-3 min-w-[5rem]">Qty</th>
              <th className="px-3 py-3 min-w-[5rem]">Unit</th>
              <th className="px-3 py-3 min-w-[5rem]">Family</th>
              <th className="px-3 py-3 min-w-[5rem]">Est.</th>
              <th className="px-3 py-3 min-w-[8rem]">FS match</th>
              <th className="px-3 py-3 min-w-[6rem]">FS serving</th>
              <th className="px-3 py-3 min-w-[7rem]">Relationship</th>
              <th className="px-3 py-3 min-w-[5rem]">Mult</th>
              <th className="px-3 py-3 min-w-[7rem]">Card</th>
              <th className="px-3 py-3 min-w-[5rem]">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-3 py-8 text-center text-sm text-white/40">
                  No rows match filter.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const rowOk = fixture.validation.rows.find((v) => v.rowId === row.id)?.ok ?? !row.error
                const expanded = expandedId === row.id
                return (
                  <tr key={row.id} className="border-b border-white/5 align-top text-xs text-white/80">
                    <td className="px-3 py-2 max-w-[14rem]">
                      <button
                        type="button"
                        className="text-left hover:text-white"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        {row.userInput}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-white/90">{row.parsedName}</div>
                      <div className="text-white/45">{row.parsedAmount}</div>
                    </td>
                    <td className="px-3 py-2">{row.consumptionQty || '—'}</td>
                    <td className="px-3 py-2">{row.consumptionUnit || '—'}</td>
                    <td className="px-3 py-2">{row.unitFamily || '—'}</td>
                    <td className="px-3 py-2">{row.estimated || '—'}</td>
                    <td className="px-3 py-2">{row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '—'}</td>
                    <td className="px-3 py-2">{row.fsOriginalServing || '—'}</td>
                    <td className="px-3 py-2">{row.relationshipV7 || '—'}</td>
                    <td className="px-3 py-2">{row.computedMultiplier || '—'}</td>
                    <td className="px-3 py-2">{row.result?.display ?? '—'}</td>
                    <td className="px-3 py-2">
                      {row.error ? (
                        <span className="text-red-300">error</span>
                      ) : rowOk ? (
                        <span className="text-emerald-300">ok</span>
                      ) : (
                        <span className="text-amber-300">check</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {expandedId ? (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-white/70">
          {(() => {
            const row = rows.find((r) => r.id === expandedId)
            if (!row) return null
            const validation = fixture.validation.rows.find((v) => v.rowId === row.id)
            return (
              <div className="space-y-3">
                {validation && validation.issues.length > 0 ? (
                  <p className="text-amber-200">Validation: {validation.issues.join(' · ')}</p>
                ) : null}
                <p className="text-white/50">
                  original portion: {row.originalPortion || '—'} · cache: {row.cacheHit || '—'} · FS
                  results: {row.fatSecretResultCount || '—'}
                </p>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw parser JSON</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawParserJson || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw macros JSON</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawMacrosJson || '—'}
                  </pre>
                </div>
              </div>
            )
          })()}
        </div>
      ) : null}
    </div>
  )
}

function V8FixturePanel() {
  const [fixture, setFixture] = useState<ServingAuditV8Fixture | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await loadServingAuditV8Fixture()
        if (!cancelled) {
          setFixture(data)
          setLoadError('')
        }
      } catch (e) {
        if (!cancelled) {
          setFixture(null)
          setLoadError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const rows = fixture?.rows ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [
        row.userInput,
        row.parsedName,
        row.parsedAmount,
        row.consumptionQty,
        row.unitSingular,
        row.unitPlural,
        row.unitFamily,
        row.estimated,
        row.originalPortion,
        row.relationshipV7,
        row.deterministicOk,
        row.unitBridgeRan,
        row.unitBridgeQuestion,
        row.unitsPerServing,
        row.computedMultiplier,
        row.resultCalories,
        row.resultProtein,
        row.result?.display,
        row.error,
        row.rawParserJson,
        row.rawMacrosJson,
        row.rawUnitBridgeJson,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, rows])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-white/50">
        <Loader2 className="size-5 animate-spin" />
        Loading verified V8 fixture…
      </div>
    )
  }

  if (loadError || !fixture) {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        {loadError || 'V8 fixture missing. Run npm run audit:v8 with a local V8 worker.'}
      </div>
    )
  }

  const generated = new Date(fixture.generatedAt)
  const generatedLabel = Number.isFinite(generated.getTime())
    ? generated.toLocaleString()
    : fixture.generatedAt

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100/90">
        <p>
          Verified fixture · generated {generatedLabel} · {fixture.rowCount} rows from {fixture.inputCount}{' '}
          inputs · validation {fixture.validation.passed}/{fixture.validation.total} passed
        </p>
        <p className="mt-1 text-xs text-white/45">
          Source: {fixture.workerOrigin} · profile {fixture.profile} · audit v8
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          className="min-w-[14rem] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-emerald-400/40"
        />
        <p className="text-sm text-white/45">
          {filtered.length} shown · {rows.length} total
        </p>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadServingAuditV8Csv(filtered, 'serving-audit-v8-latest.csv')}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"
        >
          <Download className="size-4" />
          Download CSV
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-[2200px] w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
            <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-white/45">
              <th className="px-3 py-3 min-w-[10rem]">User said</th>
              <th className="px-3 py-3 min-w-[7rem]">Parsed</th>
              <th className="px-3 py-3 min-w-[4rem]">Qty</th>
              <th className="px-3 py-3 min-w-[5rem]">Singular</th>
              <th className="px-3 py-3 min-w-[5rem]">Plural</th>
              <th className="px-3 py-3 min-w-[5rem]">Family</th>
              <th className="px-3 py-3 min-w-[4rem]">Est.</th>
              <th className="px-3 py-3 min-w-[8rem]">FS match</th>
              <th className="px-3 py-3 min-w-[6rem]">FS serving</th>
              <th className="px-3 py-3 min-w-[7rem]">Relationship</th>
              <th className="px-3 py-3 min-w-[4rem]">Det.</th>
              <th className="px-3 py-3 min-w-[4rem]">Bridge</th>
              <th className="px-3 py-3 min-w-[5rem]">u/serv</th>
              <th className="px-3 py-3 min-w-[5rem]">Mult</th>
              <th className="px-3 py-3 min-w-[5rem]">Cal</th>
              <th className="px-3 py-3 min-w-[5rem]">Pro</th>
              <th className="px-3 py-3 min-w-[5rem]">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={17} className="px-3 py-8 text-center text-sm text-white/40">
                  No rows match filter.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const rowOk = fixture.validation.rows.find((v) => v.rowId === row.id)?.ok ?? !row.error
                const expanded = expandedId === row.id
                return (
                  <tr key={row.id} className="border-b border-white/5 align-top text-xs text-white/80">
                    <td className="px-3 py-2 max-w-[14rem]">
                      <button
                        type="button"
                        className="text-left hover:text-white"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        {row.userInput}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-white/90">{row.parsedName}</div>
                      <div className="text-white/45">{row.parsedAmount}</div>
                    </td>
                    <td className="px-3 py-2">{row.consumptionQty || '—'}</td>
                    <td className="px-3 py-2">{row.unitSingular || '—'}</td>
                    <td className="px-3 py-2">{row.unitPlural || '—'}</td>
                    <td className="px-3 py-2">{row.unitFamily || '—'}</td>
                    <td className="px-3 py-2">{row.estimated || '—'}</td>
                    <td className="px-3 py-2">{row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '—'}</td>
                    <td className="px-3 py-2">{row.fsOriginalServing || '—'}</td>
                    <td className="px-3 py-2">{row.relationshipV7 || '—'}</td>
                    <td className="px-3 py-2">{row.deterministicOk || '—'}</td>
                    <td className="px-3 py-2">{row.unitBridgeRan || '—'}</td>
                    <td className="px-3 py-2">{row.unitsPerServing || '—'}</td>
                    <td className="px-3 py-2">{row.computedMultiplier || '—'}</td>
                    <td className="px-3 py-2">{row.resultCalories || '—'}</td>
                    <td className="px-3 py-2">{row.resultProtein || '—'}</td>
                    <td className="px-3 py-2">
                      {row.error ? (
                        <span className="text-red-300">error</span>
                      ) : rowOk ? (
                        <span className="text-emerald-300">ok</span>
                      ) : (
                        <span className="text-amber-300">check</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {expandedId ? (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-white/70">
          {(() => {
            const row = rows.find((r) => r.id === expandedId)
            if (!row) return null
            const validation = fixture.validation.rows.find((v) => v.rowId === row.id)
            return (
              <div className="space-y-3">
                {validation && validation.issues.length > 0 ? (
                  <p className="text-amber-200">Validation: {validation.issues.join(' · ')}</p>
                ) : null}
                <p className="text-white/50">
                  original portion: {row.originalPortion || '—'} · cache: {row.cacheHit || '—'} · FS
                  results: {row.fatSecretResultCount || '—'} · bridge Q: {row.unitBridgeQuestion || '—'}
                </p>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw parser JSON</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawParserJson || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw macros JSON (AI #2)</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawMacrosJson || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw unit bridge JSON (AI #3)</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawUnitBridgeJson || '—'}
                  </pre>
                </div>
              </div>
            )
          })()}
        </div>
      ) : null}
    </div>
  )
}

function V9FixturePanel() {
  const [fixture, setFixture] = useState<ServingAuditV9Fixture | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await loadServingAuditV9Fixture()
        if (!cancelled) {
          setFixture(data)
          setLoadError('')
        }
      } catch (e) {
        if (!cancelled) {
          setFixture(null)
          setLoadError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const rows = fixture?.rows ?? []
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [
        row.userInput,
        row.parsedName,
        row.parsedAmount,
        row.consumptionQty,
        row.unitSingular,
        row.unitPlural,
        row.unitFamily,
        row.estimated,
        row.originalPortion,
        row.relationshipV7,
        row.deterministicOk,
        row.unitBridgeRan,
        row.unitBridgeQuestion,
        row.unitsPerServing,
        row.computedMultiplier,
        row.resultCalories,
        row.resultProtein,
        row.result?.display,
        row.error,
        row.rawParserJson,
        row.rawMacrosJson,
        row.rawMacrosPass1Json,
        row.rawMacrosPass2Json,
        row.rawMacrosRetryJson,
        row.relationshipRetryRan,
        row.candidateAnnotationsJson,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, rows])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-white/50">
        <Loader2 className="size-5 animate-spin" />
        Loading verified V9 fixture…
      </div>
    )
  }

  if (loadError || !fixture) {
    return (
      <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
        {loadError || 'V9 fixture missing. Run npm run audit:v9 with a local V9 worker.'}
      </div>
    )
  }

  const generated = new Date(fixture.generatedAt)
  const generatedLabel = Number.isFinite(generated.getTime())
    ? generated.toLocaleString()
    : fixture.generatedAt

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100/90">
        <p>
          Verified fixture · generated {generatedLabel} · {fixture.rowCount} rows from {fixture.inputCount}{' '}
          inputs · validation {fixture.validation.passed}/{fixture.validation.total} passed
        </p>
        <p className="mt-1 text-xs text-white/45">
          Source: {fixture.workerOrigin} · profile {fixture.profile} · audit v9
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          className="min-w-[14rem] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-emerald-400/40"
        />
        <p className="text-sm text-white/45">
          {filtered.length} shown · {rows.length} total
        </p>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => downloadServingAuditV9Csv(filtered, 'serving-audit-v9-latest.csv')}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-40"
        >
          <Download className="size-4" />
          Download CSV
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-[2200px] w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
            <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-white/45">
              <th className="px-3 py-3 min-w-[10rem]">User said</th>
              <th className="px-3 py-3 min-w-[7rem]">Parsed</th>
              <th className="px-3 py-3 min-w-[4rem]">Qty</th>
              <th className="px-3 py-3 min-w-[5rem]">Singular</th>
              <th className="px-3 py-3 min-w-[5rem]">Plural</th>
              <th className="px-3 py-3 min-w-[5rem]">Family</th>
              <th className="px-3 py-3 min-w-[4rem]">Est.</th>
              <th className="px-3 py-3 min-w-[8rem]">FS match</th>
              <th className="px-3 py-3 min-w-[6rem]">FS serving</th>
              <th className="px-3 py-3 min-w-[7rem]">Relationship</th>
              <th className="px-3 py-3 min-w-[4rem]">Det.</th>
              <th className="px-3 py-3 min-w-[4rem]">Bridge</th>
              <th className="px-3 py-3 min-w-[5rem]">u/serv</th>
              <th className="px-3 py-3 min-w-[5rem]">Mult</th>
              <th className="px-3 py-3 min-w-[5rem]">Cal</th>
              <th className="px-3 py-3 min-w-[5rem]">Pro</th>
              <th className="px-3 py-3 min-w-[5rem]">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={17} className="px-3 py-8 text-center text-sm text-white/40">
                  No rows match filter.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const rowOk = fixture.validation.rows.find((v) => v.rowId === row.id)?.ok ?? !row.error
                const expanded = expandedId === row.id
                return (
                  <tr key={row.id} className="border-b border-white/5 align-top text-xs text-white/80">
                    <td className="px-3 py-2 max-w-[14rem]">
                      <button
                        type="button"
                        className="text-left hover:text-white"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                      >
                        {row.userInput}
                      </button>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-white/90">{row.parsedName}</div>
                      <div className="text-white/45">{row.parsedAmount}</div>
                    </td>
                    <td className="px-3 py-2">{row.consumptionQty || '—'}</td>
                    <td className="px-3 py-2">{row.unitSingular || '—'}</td>
                    <td className="px-3 py-2">{row.unitPlural || '—'}</td>
                    <td className="px-3 py-2">{row.unitFamily || '—'}</td>
                    <td className="px-3 py-2">{row.estimated || '—'}</td>
                    <td className="px-3 py-2">{row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '—'}</td>
                    <td className="px-3 py-2">{row.fsOriginalServing || '—'}</td>
                    <td className="px-3 py-2">{row.relationshipV7 || '—'}</td>
                    <td className="px-3 py-2">{row.deterministicOk || '—'}</td>
                    <td className="px-3 py-2">{row.unitBridgeRan || '—'}</td>
                    <td className="px-3 py-2">{row.unitsPerServing || '—'}</td>
                    <td className="px-3 py-2">{row.computedMultiplier || '—'}</td>
                    <td className="px-3 py-2">{row.resultCalories || '—'}</td>
                    <td className="px-3 py-2">{row.resultProtein || '—'}</td>
                    <td className="px-3 py-2">
                      {row.error ? (
                        <span className="text-red-300">error</span>
                      ) : rowOk ? (
                        <span className="text-emerald-300">ok</span>
                      ) : (
                        <span className="text-amber-300">check</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {expandedId ? (
        <div className="rounded-2xl border border-white/10 bg-black/40 p-4 text-xs text-white/70">
          {(() => {
            const row = rows.find((r) => r.id === expandedId)
            if (!row) return null
            const validation = fixture.validation.rows.find((v) => v.rowId === row.id)
            return (
              <div className="space-y-3">
                {validation && validation.issues.length > 0 ? (
                  <p className="text-amber-200">Validation: {validation.issues.join(' · ')}</p>
                ) : null}
                <p className="text-white/50">
                  original portion: {row.originalPortion || '—'} · cache: {row.cacheHit || '—'} · FS
                  results: {row.fatSecretResultCount || '—'} · bridge Q: {row.unitBridgeQuestion || '—'} ·
                  retry: {row.relationshipRetryRan || '—'} · libIdx: {row.libraryIndex || '—'} · fsIdx:{' '}
                  {row.fatSecretIndex || '—'} · servIdx: {row.servingIndex || '—'}
                </p>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw parser JSON (AI #1)</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawParserJson || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw AI #2 PASS 1 JSON</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawMacrosPass1Json || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw AI #2 PASS 2 JSON</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawMacrosPass2Json || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-bold text-white/50">Raw AI #2 retry JSON</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawMacrosRetryJson || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-bold text-white/50">Candidate annotations</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.candidateAnnotationsJson || '—'}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 font-bold text-white/50">Merged macros snapshot</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-black/50 p-2">
                    {row.rawMacrosJson || '—'}
                  </pre>
                </div>
              </div>
            )
          })()}
        </div>
      ) : null}
    </div>
  )
}

function TraceTable({
  rows,
  uniqueInputCount,
  onRun,
  onClear,
  running,
  progress,
  onExportCsv,
  emptyHint,
  primaryLabel,
  runDisabled,
  statusNote,
}: {
  rows: ServingAuditV3Row[]
  uniqueInputCount: number
  onRun: () => void
  onClear: () => void
  running: boolean
  progress: { done: number; total: number; current?: string } | null
  onExportCsv: (rows: ServingAuditV3Row[]) => void
  emptyHint: string
  primaryLabel?: string
  runDisabled?: boolean
  statusNote?: string
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) =>
      [
        row.userInput,
        row.parsedName,
        row.parsedAmount,
        row.consumptionUnit,
        row.relationship,
        row.result?.display,
        row.error,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, rows])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={running || runDisabled || (!primaryLabel && uniqueInputCount === 0)}
          onClick={onRun}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-semibold text-emerald-200 transition-colors hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          {running ? 'Running…' : primaryLabel ?? `Run ${uniqueInputCount} unique inputs`}
        </button>
        <button
          type="button"
          disabled={running || rows.length === 0}
          onClick={onClear}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/60 hover:bg-white/10 disabled:opacity-40"
        >
          <Trash2 className="size-4" />
          Clear cache
        </button>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter rows…"
          className="min-w-[14rem] flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/35 outline-none focus:border-emerald-400/40"
        />
        <p className="text-sm text-white/45">
          {rows.length} result rows
          {uniqueInputCount > 0 ? ` · ${uniqueInputCount} test inputs` : ''}
        </p>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => onExportCsv(filtered)}
          className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 disabled:opacity-40"
        >
          <Download className="size-4" />
          Export CSV
        </button>
      </div>

      {statusNote ? <p className="text-xs text-emerald-300/90">{statusNote}</p> : null}

      {progress ? (
        <p className="text-xs text-white/45 truncate">
          {progress.done}/{progress.total}
          {progress.current ? ` — ${progress.current}` : ''}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-2xl border border-white/10">
        <table className="min-w-[1600px] w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-[#0a0a0a]">
            <tr className="border-b border-white/10 text-[10px] font-black uppercase tracking-widest text-white/45">
              <th className="px-3 py-3 min-w-[10rem]">User said</th>
              <th className="px-3 py-3 min-w-[7rem]">Parsed</th>
              <th className="px-3 py-3 min-w-[7rem]">Consumption</th>
              <th className="px-3 py-3 min-w-[8rem]">FS match</th>
              <th className="px-3 py-3 min-w-[6rem]">FS serving</th>
              <th className="px-3 py-3 min-w-[5rem]">DB qty</th>
              <th className="px-3 py-3 min-w-[6rem]">Relationship</th>
              <th className="px-3 py-3 min-w-[5rem]">Mult</th>
              <th className="px-3 py-3 min-w-[7rem]">Display</th>
              <th className="px-3 py-3 min-w-[5rem]">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-sm text-white/40">
                  {rows.length === 0 ? emptyHint : 'No rows match your filter.'}
                </td>
              </tr>
            ) : (
              filtered.map((row) => (
                <tr key={row.id} className="border-b border-white/5 align-top hover:bg-white/[0.02]">
                  <td className="px-3 py-3 text-xs text-white/75 max-w-[14rem]">
                    <p className="line-clamp-3" title={row.userInput}>
                      {row.userInput}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-xs text-white/80">
                    <p className="font-semibold">{row.parsedName}</p>
                    <p className="text-white/45 mt-0.5">{row.parsedAmount}</p>
                  </td>
                  <td className="px-3 py-3 text-xs text-white/70">
                    {row.consumptionQty || row.consumptionUnit ? (
                      <>
                        <p>
                          {row.consumptionQty} {row.consumptionUnit}
                        </p>
                        <p className="text-white/40">{row.consumptionKind}</p>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <FatSecretMatchPicker
                      selectedFood={row.selectedFood}
                      selectedFoodIndex={row.selectedFoodIndex}
                      selectedServing={row.selectedServing}
                      selectedServingIndex={row.selectedServingIndex}
                      fatSecretResults={row.fatSecretResults}
                      expanded={expandedId === row.id}
                      onToggle={() => setExpandedId((prev) => (prev === row.id ? null : row.id))}
                    />
                  </td>
                  <td className="px-3 py-3 text-xs text-white/75">{row.fsOriginalServing}</td>
                  <td className="px-3 py-3 text-xs text-white/60">
                    {row.dbServingQty ? `${row.dbServingQty} ${row.dbServingUnit}` : '—'}
                  </td>
                  <td className="px-3 py-3 text-xs text-white/60">{row.relationship || '—'}</td>
                  <td className="px-3 py-3 text-xs text-white/70">{row.computedMultiplier || '—'}</td>
                  <td className="px-3 py-3 text-xs">
                    <ServingCell fields={row.result} baseLabel="Display" />
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {row.error ? (
                      <span className="text-red-300/90">{row.error}</span>
                    ) : (
                      <span className="text-emerald-400/80">OK</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Local-only dashboard for reviewing FatSecret serving-size conversions. */
export function ServingAuditPage() {
  const version = devServingAuditVersion()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [v1Rows, setV1Rows] = useState<ServingAuditRow[]>([])
  const [v2Rows, setV2Rows] = useState<ServingAuditV2Row[]>(() => loadV2Cache() ?? [])
  const [v3Rows, setV3Rows] = useState<ServingAuditV3Row[]>(() => loadV3Cache() ?? [])
  const [v4Rows, setV4Rows] = useState<ServingAuditV4Row[]>(() => loadV4Cache() ?? [])
  const [v5Rows, setV5Rows] = useState<ServingAuditV5Row[]>(() => loadV5Cache() ?? [])
  const [uniqueInputs, setUniqueInputs] = useState<string[]>([])
  const [customFoods, setCustomFoods] = useState<BootstrapResponse['macro']['customFoods']>([])
  const [v2Running, setV2Running] = useState(false)
  const [v3Running, setV3Running] = useState(false)
  const [v4Running, setV4Running] = useState(false)
  const [v2Progress, setV2Progress] = useState<V2RunProgress | null>(null)
  const [v3Progress, setV3Progress] = useState<V3RunProgress | null>(null)
  const [v4Progress, setV4Progress] = useState<V4RunProgress | null>(null)
  const [v5Status, setV5Status] = useState('')
  const v4CacheCount = loadV4Cache()?.length ?? v4Rows.length

  useEffect(() => {
    if (version === 'v6' || version === 'v7' || version === 'v8' || version === 'v9') {
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await apiFetchForProfile(SERVING_AUDIT_PROFILE, '/bootstrap')
        const data = await parseJson<BootstrapResponse>(res)
        if (!cancelled) {
          setV1Rows(buildServingAuditRows(data.macro.logs || {}, data.macro.customFoods || []))
          setUniqueInputs(collectUniqueTestUserInputs(data.macro.logs || {}))
          setCustomFoods(data.macro.customFoods || [])
          setError('')
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [version])

  const runV2 = async () => {
    if (uniqueInputs.length === 0) return
    setV2Running(true)
    setV2Progress({ done: 0, total: uniqueInputs.length })
    try {
      const next = await rerunServingAuditV2(uniqueInputs, customFoods, setV2Progress)
      setV2Rows(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setV2Running(false)
      setV2Progress(null)
    }
  }

  const clearV2 = () => {
    clearV2Cache()
    setV2Rows([])
  }

  const runV3 = async () => {
    if (uniqueInputs.length === 0) return
    setV3Running(true)
    setV3Progress({ done: 0, total: uniqueInputs.length })
    try {
      const next = await rerunServingAuditV3(uniqueInputs, customFoods, setV3Progress)
      setV3Rows(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setV3Running(false)
      setV3Progress(null)
    }
  }

  const clearV3 = () => {
    clearV3Cache()
    setV3Rows([])
  }

  const runV4 = async () => {
    if (uniqueInputs.length === 0) return
    setV4Running(true)
    setV4Progress({ done: 0, total: uniqueInputs.length })
    try {
      const next = await rerunServingAuditV4(uniqueInputs, customFoods, setV4Progress)
      setV4Rows(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setV4Running(false)
      setV4Progress(null)
    }
  }

  const clearV4 = () => {
    clearV4Cache()
    setV4Rows([])
  }

  const runV5 = () => {
    const { rows, sourceCount } = rebuildV5FromV4Cache(customFoods)
    if (sourceCount === 0) {
      setV5Status('No V4 cache found. Open V4 and Run once first, then come back here.')
      setError('')
      return
    }
    setV5Rows(rows)
    setV5Status(`Rebuilt ${rows.length} rows from V4 cache with fixed serving math (no GPT / FatSecret).`)
    setError('')
  }

  const clearV5 = () => {
    clearV5Cache()
    setV5Rows([])
    setV5Status('')
  }

  return (
    <div className="flex h-dvh flex-col bg-black text-white">
      <header className="shrink-0 border-b border-white/10 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400/80">Dev only</p>
            <h1 className="mt-1 text-xl font-black tracking-tight">Serving size audit</h1>
          </div>
          <AuditNav version={version} />
        </div>
        <p className="mt-2 max-w-3xl text-sm text-white/50 leading-relaxed">
          {version === 'v1' ? (
            <>
              <span className="text-white/70">V1</span> — historical first shots reconstructed from saved snapshots
              for <span className="text-white/70">{SERVING_AUDIT_PROFILE}</span> ({v1Rows.length} FatSecret-linked
              rows).
            </>
          ) : version === 'v2' ? (
            <>
              <span className="text-white/70">V2</span> — re-runs {uniqueInputs.length} unique &quot;user said&quot;
              inputs through parser + macro pipeline.
            </>
          ) : version === 'v3' ? (
            <>
              <span className="text-white/70">V3</span> — first trace attempt (legacy; architecture columns may be
              blank). {v3Rows.length} cached rows.
            </>
          ) : version === 'v4' ? (
            <>
              <span className="text-white/70">V4</span> — original live audit cache ({v4Rows.length} rows). Keep as
              baseline; use V5 to apply the fix.
            </>
          ) : version === 'v5' ? (
            <>
              <span className="text-white/70">V5</span> — one click rebuilds your V4 cache with fixed serving math.
              No file picker, no GPT, no FatSecret. ({v5Rows.length} rows
              {v4CacheCount ? ` · ${v4CacheCount} available from V4` : ''})
            </>
          ) : version === 'v6' ? (
            <>
              <span className="text-white/70">V6</span> — verified live PARSER + MACROS audit (quantity + unit +
              AI multiplier). Pre-generated fixture; download CSV below.
            </>
          ) : version === 'v7' ? (
            <>
              <span className="text-white/70">V7</span> — verified live PARSER + MACROS audit (unitFamily,
              relationship classification, code-computed multiplier). Pre-generated fixture; download CSV
              below.
            </>
          ) : version === 'v8' ? (
            <>
              <span className="text-white/70">V8</span> — verified live PARSER + MACROS audit (singular/plural
              units, AI #3 unit bridge, code-computed multiplier). Pre-generated fixture; download CSV below.
            </>
          ) : (
            <>
              <span className="text-white/70">V9</span> — verified live PARSER + MACROS audit (annotated units,
              AI #2 optional bridge, no AI #3, code-computed multiplier). Pre-generated fixture; download CSV
              below.
            </>
          )}
        </p>
      </header>

      <main className="flex min-h-0 flex-1 flex-col px-6 py-4">
        {version === 'v9' ? (
          <V9FixturePanel />
        ) : version === 'v8' ? (
          <V8FixturePanel />
        ) : version === 'v7' ? (
          <V7FixturePanel />
        ) : version === 'v6' ? (
          <V6FixturePanel />
        ) : loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-white/50">
            <Loader2 className="size-5 animate-spin" />
            Loading diary data…
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>
        ) : version === 'v1' ? (
          v1Rows.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
              No FatSecret-linked entries found.
            </div>
          ) : (
            <V1Table rows={v1Rows} />
          )
        ) : version === 'v2' ? (
          <V2Table
            rows={v2Rows}
            uniqueInputCount={uniqueInputs.length}
            onRun={() => void runV2()}
            onClear={clearV2}
            running={v2Running}
            progress={v2Progress}
          />
        ) : version === 'v3' ? (
          <TraceTable
            rows={v3Rows}
            uniqueInputCount={uniqueInputs.length}
            onRun={() => void runV3()}
            onClear={clearV3}
            running={v3Running}
            progress={v3Progress}
            onExportCsv={downloadServingAuditV3Csv}
            emptyHint="Click Run to re-run V3 (legacy trace; columns may be blank)."
          />
        ) : version === 'v4' ? (
          <TraceTable
            rows={v4Rows}
            uniqueInputCount={uniqueInputs.length}
            onRun={() => void runV4()}
            onClear={clearV4}
            running={v4Running}
            progress={v4Progress}
            onExportCsv={downloadServingAuditV4Csv}
            emptyHint="V4 baseline. Click Run only if you need a fresh live audit; otherwise open V5."
          />
        ) : version === 'v5' ? (
          <TraceTable
            rows={v5Rows}
            uniqueInputCount={v4CacheCount}
            onRun={runV5}
            onClear={clearV5}
            running={false}
            progress={null}
            onExportCsv={downloadServingAuditV5Csv}
            primaryLabel={
              v4CacheCount > 0
                ? `Rebuild from V4 cache (${v4CacheCount} rows)`
                : 'Rebuild from V4 cache'
            }
            runDisabled={v4CacheCount === 0}
            statusNote={v5Status}
            emptyHint={
              v4CacheCount === 0
                ? 'No V4 cache in this browser yet. Open V4, click Run once, then return here.'
                : 'Click the green button to rebuild with fixed serving math.'
            }
          />
        ) : null}
      </main>
    </div>
  )
}
