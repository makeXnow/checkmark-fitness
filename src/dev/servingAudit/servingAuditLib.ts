import {
  formatServingTotal,
  resolveMacroEstimate,
  type MacroEstimateResponse,
} from '../../features/macro/macroLib'
import type {
  FatSecretFoodRef,
  FatSecretServingRef,
  MacroCustomFood,
  MacroDayItem,
} from '../../types/domain'

const SERVING_AUDIT_PROFILE = 'alexander'

function parseIndex(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw)
  if (typeof raw === 'string' && raw.trim()) {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) return n
  }
  return null
}

function isNutritionLabelScan(item: MacroDayItem): boolean {
  const input = item.userInput?.trim() || item.rawText?.trim() || ''
  return input.startsWith('Scanning:')
}

/** Diary entries that picked a FatSecret match (voice/text path, not nutrition-label scans). */
export function isServingAuditEntry(item: MacroDayItem): boolean {
  if (isNutritionLabelScan(item)) return false
  if (!item.macroEstimateSnapshot) return false

  const fsIdx = parseIndex(item.macroEstimateSnapshot.fatSecretIndex)
  if (fsIdx === null || fsIdx < 1) return false

  const libIdx = parseIndex(item.macroEstimateSnapshot.libraryIndex)
  if (libIdx !== null && libIdx >= 1 && (fsIdx === null || fsIdx < 1)) return false

  return Boolean(item.fatSecretResults?.length)
}

export function fatSecretFoodLabel(food: FatSecretFoodRef): string {
  return food.brandName ? `${food.brandName} ${food.name}`.trim() : food.name
}

export function getSelectedFatSecretFood(
  item: MacroDayItem,
): { food: FatSecretFoodRef; foodIndex: number; serving: FatSecretServingRef; servingIndex: number } | null {
  const foods = item.fatSecretResults
  const snap = item.macroEstimateSnapshot
  if (!foods?.length || !snap) return null

  const fsIdx = parseIndex(snap.fatSecretIndex)
  if (fsIdx === null || fsIdx < 1 || fsIdx > foods.length) return null

  const food = foods[fsIdx - 1]!
  const servIdx = parseIndex(snap.servingIndex)
  const serving =
    servIdx !== null && servIdx >= 1 && servIdx <= food.servings.length
      ? food.servings[servIdx - 1]!
      : food.servings.find((s) => s.isDefault) ?? food.servings[0]

  if (!serving) return null

  return {
    food,
    foodIndex: fsIdx,
    serving,
    servingIndex: servIdx ?? food.servings.indexOf(serving) + 1,
  }
}

export type ServingFields = {
  servingSize: number
  servingUnit: string
  servingMultiplier: number
  display: string
}

export function servingFieldsFromItem(item: {
  servingSize?: number
  servingUnit?: string
  servingMultiplier?: number
}): ServingFields | null {
  const servingSize = item.servingSize
  const servingUnit = item.servingUnit?.trim()
  const servingMultiplier = item.servingMultiplier
  if (
    typeof servingSize !== 'number' ||
    servingSize <= 0 ||
    !servingUnit ||
    typeof servingMultiplier !== 'number' ||
    servingMultiplier <= 0
  ) {
    return null
  }
  return {
    servingSize,
    servingUnit,
    servingMultiplier,
    display: formatServingTotal(servingMultiplier, servingSize, servingUnit),
  }
}

export function reconstructFirstShotServing(
  item: MacroDayItem,
  customFoods: MacroCustomFood[],
): ServingFields | null {
  const snap = item.macroEstimateSnapshot
  if (!snap) return null

  const resolved = resolveMacroEstimate(
    snap as MacroEstimateResponse,
    customFoods,
    item.fatSecretResults ?? [],
    {
      userAmount: item.parseSnapshot?.amount ?? item.amount,
      consumption: item.parseSnapshot?.consumption,
    },
  )

  return servingFieldsFromItem(resolved)
}

export type ServingAuditRow = {
  id: string
  date: string
  userInput: string
  parsedName: string
  parsedAmount: string
  selectedFood: FatSecretFoodRef
  selectedFoodIndex: number
  selectedServing: FatSecretServingRef
  selectedServingIndex: number
  fatSecretResults: FatSecretFoodRef[]
  fsOriginalServing: string
  firstShot: ServingFields | null
  current: ServingFields | null
  manuallyEdited: boolean
}

function servingFieldsEqual(a: ServingFields | null, b: ServingFields | null): boolean {
  if (!a || !b) return a === b
  return (
    a.servingSize === b.servingSize &&
    a.servingUnit === b.servingUnit &&
    Math.abs(a.servingMultiplier - b.servingMultiplier) < 0.0001
  )
}

export function buildServingAuditRows(
  logs: Record<string, MacroDayItem[]>,
  customFoods: MacroCustomFood[],
): ServingAuditRow[] {
  const rows: ServingAuditRow[] = []

  for (const [date, items] of Object.entries(logs)) {
    for (const item of items) {
      if (!isServingAuditEntry(item)) continue

      const selection = getSelectedFatSecretFood(item)
      if (!selection) continue

      const userInput = item.userInput?.trim() || item.rawText?.trim() || '—'
      const parsed = item.parseSnapshot
      const firstShot = reconstructFirstShotServing(item, customFoods)
      const current = servingFieldsFromItem(item)
      const manuallyEdited = !servingFieldsEqual(firstShot, current)

      rows.push({
        id: item.id,
        date,
        userInput,
        parsedName: parsed?.name?.trim() || item.name?.trim() || '—',
        parsedAmount: parsed?.amount?.trim() || item.amount?.trim() || '—',
        selectedFood: selection.food,
        selectedFoodIndex: selection.foodIndex,
        selectedServing: selection.serving,
        selectedServingIndex: selection.servingIndex,
        fatSecretResults: item.fatSecretResults ?? [],
        fsOriginalServing: selection.serving.description,
        firstShot,
        current,
        manuallyEdited,
      })
    }
  }

  return rows.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    return b.id.localeCompare(a.id)
  })
}

function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value == null ? '' : String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function servingFieldsCsv(prefix: string, fields: ServingFields | null): Record<string, string> {
  return {
    [`${prefix} display`]: fields?.display ?? '',
    [`${prefix} multiplier`]: fields != null ? String(fields.servingMultiplier) : '',
    [`${prefix} size`]: fields != null ? String(fields.servingSize) : '',
    [`${prefix} unit`]: fields?.servingUnit ?? '',
  }
}

export function servingAuditRowsToCsv(rows: ServingAuditRow[]): string {
  const headers = [
    'date',
    'id',
    'user said',
    'parsed name',
    'parsed amount',
    'fatsecret food',
    'fatsecret food index',
    'fs serving',
    'fs serving calories',
    'fs serving protein',
    'first shot display',
    'first shot multiplier',
    'first shot size',
    'first shot unit',
    'current display',
    'current multiplier',
    'current size',
    'current unit',
    'manually edited',
    'fatsecret alternatives',
  ]

  const lines = rows.map((row) => {
    const firstShot = servingFieldsCsv('first shot', row.firstShot)
    const current = servingFieldsCsv('current', row.current)
    const alternatives = row.fatSecretResults
      .map((food, foodIdx) => {
        const label = fatSecretFoodLabel(food)
        const servings = food.servings
          .map((s, servingIdx) => `${servingIdx + 1}. ${s.description}`)
          .join('; ')
        const selected = foodIdx + 1 === row.selectedFoodIndex ? ' [selected]' : ''
        return `${foodIdx + 1}. ${label}${selected}: ${servings}`
      })
      .join(' | ')

    const values: Record<string, string> = {
      date: row.date,
      id: row.id,
      'user said': row.userInput,
      'parsed name': row.parsedName,
      'parsed amount': row.parsedAmount,
      'fatsecret food': fatSecretFoodLabel(row.selectedFood),
      'fatsecret food index': String(row.selectedFoodIndex),
      'fs serving': row.fsOriginalServing,
      'fs serving calories': String(row.selectedServing.calories),
      'fs serving protein': String(row.selectedServing.protein),
      'first shot display': firstShot['first shot display'] ?? '',
      'first shot multiplier': firstShot['first shot multiplier'] ?? '',
      'first shot size': firstShot['first shot size'] ?? '',
      'first shot unit': firstShot['first shot unit'] ?? '',
      'current display': current['current display'] ?? '',
      'current multiplier': current['current multiplier'] ?? '',
      'current size': current['current size'] ?? '',
      'current unit': current['current unit'] ?? '',
      'manually edited': row.manuallyEdited ? 'yes' : 'no',
      'fatsecret alternatives': alternatives,
    }

    return headers.map((header) => csvCell(values[header])).join(',')
  })

  return [headers.map((h) => csvCell(h)).join(','), ...lines].join('\n')
}

export function downloadServingAuditCsv(rows: ServingAuditRow[], filename?: string): void {
  const csv = servingAuditRowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? `serving-audit-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function collectUniqueTestUserInputs(logs: Record<string, MacroDayItem[]>): string[] {
  const seen = new Set<string>()
  const inputs: string[] = []
  for (const items of Object.values(logs)) {
    for (const item of items) {
      if (!isServingAuditEntry(item)) continue
      const input = item.userInput?.trim() || item.rawText?.trim()
      if (!input || input.startsWith('Scanning:') || seen.has(input)) continue
      seen.add(input)
      inputs.push(input)
    }
  }
  return inputs
}

export type ServingAuditV2Row = {
  id: string
  userInput: string
  parsedName: string
  parsedAmount: string
  selectedFood: FatSecretFoodRef | null
  selectedFoodIndex: number | null
  selectedServing: FatSecretServingRef | null
  selectedServingIndex: number | null
  fatSecretResults: FatSecretFoodRef[]
  fsOriginalServing: string
  result: ServingFields | null
  error?: string
}

export function buildV2RowFromEstimate(
  userInput: string,
  parsedName: string,
  parsedAmount: string,
  estimate: {
    servingSize?: number
    servingUnit?: string
    servingMultiplier?: number
    fatSecretResults?: FatSecretFoodRef[]
    macroEstimateSnapshot?: { fatSecretIndex?: number | null; servingIndex?: number | null }
  },
  rowId: string,
): ServingAuditV2Row {
  const fatSecretResults = estimate.fatSecretResults ?? []
  const snap = estimate.macroEstimateSnapshot
  const fsIdx = typeof snap?.fatSecretIndex === 'number' ? snap.fatSecretIndex : null
  let selectedFood: FatSecretFoodRef | null = null
  let selectedServing: FatSecretServingRef | null = null
  let selectedFoodIndex: number | null = null
  let selectedServingIndex: number | null = null

  if (fsIdx != null && fsIdx >= 1 && fsIdx <= fatSecretResults.length) {
    selectedFood = fatSecretResults[fsIdx - 1]!
    selectedFoodIndex = fsIdx
    const servIdx = typeof snap?.servingIndex === 'number' ? snap.servingIndex : null
    if (servIdx != null && servIdx >= 1 && servIdx <= selectedFood.servings.length) {
      selectedServing = selectedFood.servings[servIdx - 1]!
      selectedServingIndex = servIdx
    } else {
      selectedServing = selectedFood.servings.find((s) => s.isDefault) ?? selectedFood.servings[0] ?? null
      selectedServingIndex = selectedServing ? selectedFood.servings.indexOf(selectedServing) + 1 : null
    }
  }

  return {
    id: rowId,
    userInput,
    parsedName,
    parsedAmount,
    selectedFood,
    selectedFoodIndex,
    selectedServing,
    selectedServingIndex,
    fatSecretResults,
    fsOriginalServing: selectedServing?.description ?? '—',
    result: servingFieldsFromItem(estimate),
  }
}

export function servingAuditV2RowsToCsv(rows: ServingAuditV2Row[]): string {
  const headers = [
    'user said',
    'parsed name',
    'parsed amount',
    'fatsecret food',
    'fs serving',
    'result display',
    'result multiplier',
    'result size',
    'result unit',
    'error',
  ]
  const lines = rows.map((row) => {
    const values = [
      row.userInput,
      row.parsedName,
      row.parsedAmount,
      row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '',
      row.fsOriginalServing,
      row.result?.display ?? '',
      row.result != null ? String(row.result.servingMultiplier) : '',
      row.result != null ? String(row.result.servingSize) : '',
      row.result?.servingUnit ?? '',
      row.error ?? '',
    ]
    return values.map((v) => csvCell(v)).join(',')
  })
  return [headers.map((h) => csvCell(h)).join(','), ...lines].join('\n')
}

export function downloadServingAuditV2Csv(rows: ServingAuditV2Row[], filename?: string): void {
  const csv = servingAuditV2RowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? `serving-audit-v2-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export type ServingAuditV3Row = {
  id: string
  userInput: string
  parsedName: string
  parsedAmount: string
  consumptionQty: string
  consumptionUnit: string
  consumptionKind: string
  fatSecretSearch: string
  selectedFood: FatSecretFoodRef | null
  selectedFoodIndex: number | null
  selectedServing: FatSecretServingRef | null
  selectedServingIndex: number | null
  fatSecretResults: FatSecretFoodRef[]
  fsOriginalServing: string
  dbServingQty: string
  dbServingUnit: string
  relationship: string
  normalizedQty: string
  normalizedUnit: string
  normalizedEstimated: string
  computedMultiplier: string
  result: ServingFields | null
  /** Raw PARSER model JSON before ensureConsumption (future audits). */
  rawParserJson?: string
  /** Raw MACROS model JSON before resolveMacroEstimate (future audits). */
  rawMacrosJson?: string
  error?: string
}

export function buildV3RowFromTrace(input: {
  id: string
  userInput: string
  parsedName?: string
  parsedAmount?: string
  consumption?: import('../../features/macro/macroAiSchemas').ConsumptionPortion
  fatSecretSearch?: string
  selectedFood?: FatSecretFoodRef | null
  selectedFoodIndex?: number | null
  selectedServing?: FatSecretServingRef | null
  selectedServingIndex?: number | null
  fatSecretResults?: FatSecretFoodRef[]
  macroSnap?: {
    relationship?: string | null
    normalizedEstimate?: { quantity: number; unit: string; estimated: boolean } | null
  }
  dbServingQty?: number
  dbServingUnit?: string
  computedMultiplier?: number | null
  result?: {
    servingSize?: number
    servingUnit?: string
    servingMultiplier?: number
  }
  rawParserJson?: string
  rawMacrosJson?: string
  normalizedEstimatedLabel?: string
  error?: string
}): ServingAuditV3Row {
  const c = input.consumption
  const norm = input.macroSnap?.normalizedEstimate
  let normalizedEstimated = ''
  if (input.normalizedEstimatedLabel) {
    normalizedEstimated = input.normalizedEstimatedLabel
  } else if (norm) {
    normalizedEstimated = norm.estimated ? 'yes' : 'no'
  }
  return {
    id: input.id,
    userInput: input.userInput,
    parsedName: input.parsedName ?? '—',
    parsedAmount: input.parsedAmount ?? '—',
    consumptionQty: c?.quantity != null ? String(c.quantity) : '',
    consumptionUnit: c?.unit ?? '',
    consumptionKind: c?.kind ?? '',
    fatSecretSearch: input.fatSecretSearch ?? '',
    selectedFood: input.selectedFood ?? null,
    selectedFoodIndex: input.selectedFoodIndex ?? null,
    selectedServing: input.selectedServing ?? null,
    selectedServingIndex: input.selectedServingIndex ?? null,
    fatSecretResults: input.fatSecretResults ?? [],
    fsOriginalServing: input.selectedServing?.description ?? '—',
    dbServingQty: input.dbServingQty != null ? String(input.dbServingQty) : '',
    dbServingUnit: input.dbServingUnit ?? '',
    relationship: input.macroSnap?.relationship ?? '',
    normalizedQty: norm?.quantity != null ? String(norm.quantity) : '',
    normalizedUnit: norm?.unit ?? '',
    normalizedEstimated,
    computedMultiplier:
      input.computedMultiplier != null ? String(input.computedMultiplier) : '',
    result: input.result ? servingFieldsFromItem(input.result) : null,
    rawParserJson: input.rawParserJson,
    rawMacrosJson: input.rawMacrosJson,
    error: input.error,
  }
}

export function servingAuditV3RowsToCsv(rows: ServingAuditV3Row[]): string {
  const headers = [
    'user said',
    'parsed name',
    'parsed amount',
    'consumption qty',
    'consumption unit',
    'consumption kind',
    'fatsecret search',
    'fatsecret food',
    'fs serving',
    'db serving qty',
    'db serving unit',
    'relationship',
    'normalized qty',
    'normalized unit',
    'normalized estimated',
    'computed multiplier',
    'result display',
    'result multiplier',
    'raw parser json',
    'raw macros json',
    'error',
  ]
  const lines = rows.map((row) => {
    const values = [
      row.userInput,
      row.parsedName,
      row.parsedAmount,
      row.consumptionQty,
      row.consumptionUnit,
      row.consumptionKind,
      row.fatSecretSearch,
      row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '',
      row.fsOriginalServing,
      row.dbServingQty,
      row.dbServingUnit,
      row.relationship,
      row.normalizedQty,
      row.normalizedUnit,
      row.normalizedEstimated,
      row.computedMultiplier,
      row.result?.display ?? '',
      row.result != null ? String(row.result.servingMultiplier) : '',
      row.rawParserJson ?? '',
      row.rawMacrosJson ?? '',
      row.error ?? '',
    ]
    return values.map((v) => csvCell(v)).join(',')
  })
  return [headers.map((h) => csvCell(h)).join(','), ...lines].join('\n')
}

export function downloadServingAuditV3Csv(rows: ServingAuditV3Row[], filename?: string): void {
  const csv = servingAuditV3RowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? `serving-audit-v3-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export type ServingAuditV4Row = ServingAuditV3Row

export const buildV4RowFromTrace = buildV3RowFromTrace
export const servingAuditV4RowsToCsv = servingAuditV3RowsToCsv

export function downloadServingAuditV4Csv(rows: ServingAuditV4Row[], filename?: string): void {
  downloadServingAuditV3Csv(rows, filename ?? `serving-audit-v4-${new Date().toISOString().slice(0, 10)}.csv`)
}

export type ServingAuditV6Row = ServingAuditV3Row

/** V6 export — parser quantity/unit + AI multiplier columns (not legacy relationship/consumption kind). */
export function servingAuditV6RowsToCsv(rows: ServingAuditV6Row[]): string {
  const headers = [
    'audit version',
    'user said',
    'parsed name',
    'parsed amount',
    'parser quantity',
    'parser unit',
    'fatsecret search',
    'fatsecret food',
    'fs serving',
    'db serving qty',
    'db serving unit',
    'ai multiplier',
    'result display',
    'result multiplier',
    'raw parser json',
    'raw macros json',
    'error',
  ]
  const lines = rows.map((row) => {
    const values = [
      'v6',
      row.userInput,
      row.parsedName,
      row.parsedAmount,
      row.consumptionQty,
      row.consumptionUnit,
      row.fatSecretSearch,
      row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '',
      row.fsOriginalServing,
      row.dbServingQty,
      row.dbServingUnit,
      row.computedMultiplier,
      row.result?.display ?? '',
      row.result != null ? String(row.result.servingMultiplier) : '',
      row.rawParserJson ?? '',
      row.rawMacrosJson ?? '',
      row.error ?? '',
    ]
    return values.map((v) => csvCell(v)).join(',')
  })
  return [headers.map((h) => csvCell(h)).join(','), ...lines].join('\n')
}

export function downloadServingAuditV6Csv(rows: ServingAuditV6Row[], filename?: string): void {
  const csv = servingAuditV6RowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? `serving-audit-v6-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export type ServingAuditV7Row = ServingAuditV3Row & {
  unitFamily: string
  estimated: string
  originalPortion: string
  relationshipV7: string
  cacheHit: string
  fatSecretResultCount: string
}

/** V7 export — unitFamily, estimated, relationship classification, code multiplier. */
export function servingAuditV7RowsToCsv(rows: ServingAuditV7Row[]): string {
  const headers = [
    'audit version',
    'user said',
    'parsed name',
    'parsed amount',
    'parser quantity',
    'parser unit',
    'unit family',
    'estimated',
    'original portion',
    'fatsecret search',
    'cache hit',
    'fs result count',
    'fatsecret food',
    'fs serving',
    'relationship',
    'code multiplier',
    'result display',
    'result multiplier',
    'raw parser json',
    'raw macros json',
    'error',
  ]
  const lines = rows.map((row) => {
    const values = [
      'v7',
      row.userInput,
      row.parsedName,
      row.parsedAmount,
      row.consumptionQty,
      row.consumptionUnit,
      row.unitFamily,
      row.estimated,
      row.originalPortion,
      row.fatSecretSearch,
      row.cacheHit,
      row.fatSecretResultCount,
      row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '',
      row.fsOriginalServing,
      row.relationshipV7,
      row.computedMultiplier,
      row.result?.display ?? '',
      row.result != null ? String(row.result.servingMultiplier) : '',
      row.rawParserJson ?? '',
      row.rawMacrosJson ?? '',
      row.error ?? '',
    ]
    return values.map((v) => csvCell(v)).join(',')
  })
  return [headers.map((h) => csvCell(h)).join(','), ...lines].join('\n')
}

export function downloadServingAuditV7Csv(rows: ServingAuditV7Row[], filename?: string): void {
  const csv = servingAuditV7RowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? `serving-audit-v7-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export type ServingAuditV8Row = ServingAuditV3Row & {
  unitSingular: string
  unitPlural: string
  unitFamily: string
  estimated: string
  originalPortion: string
  relationshipV7: string
  deterministicOk: string
  unitBridgeRan: string
  unitBridgeQuestion: string
  unitsPerServing: string
  rawUnitBridgeJson: string
  resultCalories: string
  resultProtein: string
  cacheHit: string
  fatSecretResultCount: string
}

/** V8 export — singular/plural units, AI #3 bridge fields, code multiplier, result macros. */
export function servingAuditV8RowsToCsv(rows: ServingAuditV8Row[]): string {
  const headers = [
    'audit version',
    'user said',
    'parsed name',
    'parsed amount',
    'parser quantity',
    'unit singular',
    'unit plural',
    'unit family',
    'estimated',
    'original portion',
    'fatsecret search',
    'cache hit',
    'fs result count',
    'fatsecret food',
    'fs serving',
    'relationship',
    'deterministic ok',
    'unit bridge ran',
    'unit bridge question',
    'units per serving',
    'code multiplier',
    'result calories',
    'result protein',
    'result display',
    'result multiplier',
    'raw parser json',
    'raw macros json',
    'raw unit bridge json',
    'error',
  ]
  const lines = rows.map((row) => {
    const values = [
      'v8',
      row.userInput,
      row.parsedName,
      row.parsedAmount,
      row.consumptionQty,
      row.unitSingular,
      row.unitPlural,
      row.unitFamily,
      row.estimated,
      row.originalPortion,
      row.fatSecretSearch,
      row.cacheHit,
      row.fatSecretResultCount,
      row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '',
      row.fsOriginalServing,
      row.relationshipV7,
      row.deterministicOk,
      row.unitBridgeRan,
      row.unitBridgeQuestion,
      row.unitsPerServing,
      row.computedMultiplier,
      row.resultCalories,
      row.resultProtein,
      row.result?.display ?? '',
      row.result != null ? String(row.result.servingMultiplier) : '',
      row.rawParserJson ?? '',
      row.rawMacrosJson ?? '',
      row.rawUnitBridgeJson ?? '',
      row.error ?? '',
    ]
    return values.map((v) => csvCell(v)).join(',')
  })
  return [headers.map((h) => csvCell(h)).join(','), ...lines].join('\n')
}

export function downloadServingAuditV8Csv(rows: ServingAuditV8Row[], filename?: string): void {
  const csv = servingAuditV8RowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? `serving-audit-v8-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export type ServingAuditV9Row = ServingAuditV3Row & {
  unitSingular: string
  unitPlural: string
  unitFamily: string
  estimated: string
  originalPortion: string
  relationshipV7: string
  deterministicOk: string
  unitBridgeRan: string
  unitBridgeQuestion: string
  unitsPerServing: string
  relationshipRetryRan: string
  rawMacrosPass1Json: string
  rawMacrosPass2Json: string
  rawMacrosRetryJson: string
  candidateAnnotationsJson: string
  libraryIndex: string
  fatSecretIndex: string
  servingIndex: string
  resultCalories: string
  resultProtein: string
  cacheHit: string
  fatSecretResultCount: string
}

/** V9 export — AI #2 bridge fields, pass/retry JSON preserved separately. */
export function servingAuditV9RowsToCsv(rows: ServingAuditV9Row[]): string {
  const headers = [
    'audit version',
    'user said',
    'parsed name',
    'parsed amount',
    'parser quantity',
    'unit singular',
    'unit plural',
    'unit family',
    'estimated',
    'original portion',
    'fatsecret search',
    'cache hit',
    'fs result count',
    'candidate annotations',
    'library index',
    'fatsecret index',
    'serving index',
    'fatsecret food',
    'fs serving',
    'relationship',
    'deterministic ok',
    'unit bridge ran',
    'unit bridge question',
    'units per serving',
    'relationship retry ran',
    'code multiplier',
    'result calories',
    'result protein',
    'result display',
    'result multiplier',
    'raw parser json',
    'raw macros json',
    'raw ai2 pass1 json',
    'raw ai2 pass2 json',
    'raw ai2 retry json',
    'error',
  ]
  const lines = rows.map((row) => {
    const values = [
      'v9',
      row.userInput,
      row.parsedName,
      row.parsedAmount,
      row.consumptionQty,
      row.unitSingular,
      row.unitPlural,
      row.unitFamily,
      row.estimated,
      row.originalPortion,
      row.fatSecretSearch,
      row.cacheHit,
      row.fatSecretResultCount,
      row.candidateAnnotationsJson,
      row.libraryIndex,
      row.fatSecretIndex,
      row.servingIndex,
      row.selectedFood ? fatSecretFoodLabel(row.selectedFood) : '',
      row.fsOriginalServing,
      row.relationshipV7,
      row.deterministicOk,
      row.unitBridgeRan,
      row.unitBridgeQuestion,
      row.unitsPerServing,
      row.relationshipRetryRan,
      row.computedMultiplier,
      row.resultCalories,
      row.resultProtein,
      row.result?.display ?? '',
      row.result != null ? String(row.result.servingMultiplier) : '',
      row.rawParserJson ?? '',
      row.rawMacrosJson ?? '',
      row.rawMacrosPass1Json ?? '',
      row.rawMacrosPass2Json ?? '',
      row.rawMacrosRetryJson ?? '',
      row.error ?? '',
    ]
    return values.map((v) => csvCell(v)).join(',')
  })
  return [headers.map((h) => csvCell(h)).join(','), ...lines].join('\n')
}

export function downloadServingAuditV9Csv(rows: ServingAuditV9Row[], filename?: string): void {
  const csv = servingAuditV9RowsToCsv(rows)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? `serving-audit-v9-${new Date().toISOString().slice(0, 10)}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function downloadServingAuditV5Csv(rows: ServingAuditV4Row[], filename?: string): void {
  downloadServingAuditV3Csv(rows, filename ?? `serving-audit-v5-${new Date().toISOString().slice(0, 10)}.csv`)
}

export { SERVING_AUDIT_PROFILE }
