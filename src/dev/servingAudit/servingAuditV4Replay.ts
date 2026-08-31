/**
 * Replay a saved v4 serving-audit CSV through updated deterministic logic
 * without calling GPT or FatSecret.
 */
import { ensureConsumption } from '../../features/macro/consumptionNormalize'
import type { ConsumptionKind, ConsumptionPortion } from '../../features/macro/macroAiSchemas'
import type { FatSecretFoodRef, FatSecretServingRef, MacroCustomFood } from '../../types/domain'
import { buildServingPipelineTrace } from './servingAuditTrace'
import {
  buildV3RowFromTrace,
  type ServingAuditV4Row,
} from './servingAuditLib'

export type V4CsvReplayRow = {
  userInput: string
  parsedName: string
  parsedAmount: string
  consumptionQty: string
  consumptionUnit: string
  consumptionKind: string
  fatSecretSearch: string
  fatSecretFood: string
  fsServing: string
  dbServingQty: string
  dbServingUnit: string
  relationship: string
  computedMultiplier: string
  resultDisplay: string
  resultMultiplier: string
  error: string
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      cells.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur)
  return cells
}

export function parseServingAuditV4Csv(csvText: string): V4CsvReplayRow[] {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0]!).map((h) => h.trim().toLowerCase())
  const idx = (name: string) => headers.indexOf(name)

  const rows: V4CsvReplayRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!)
    const get = (name: string) => {
      const j = idx(name)
      return j >= 0 ? (cells[j] ?? '').trim() : ''
    }
    rows.push({
      userInput: get('user said'),
      parsedName: get('parsed name'),
      parsedAmount: get('parsed amount'),
      consumptionQty: get('consumption qty'),
      consumptionUnit: get('consumption unit'),
      consumptionKind: get('consumption kind'),
      fatSecretSearch: get('fatsecret search'),
      fatSecretFood: get('fatsecret food'),
      fsServing: get('fs serving'),
      dbServingQty: get('db serving qty'),
      dbServingUnit: get('db serving unit'),
      relationship: get('relationship'),
      computedMultiplier: get('computed multiplier'),
      resultDisplay: get('result display'),
      resultMultiplier: get('result multiplier'),
      error: get('error'),
    })
  }
  return rows
}

function stubFatSecret(
  foodLabel: string,
  servingDescription: string,
): { food: FatSecretFoodRef; serving: FatSecretServingRef } | null {
  if (!foodLabel || foodLabel === '—' || !servingDescription || servingDescription === '—') {
    return null
  }
  const serving: FatSecretServingRef = {
    servingId: '1',
    description: servingDescription,
    calories: 100,
    protein: 1,
    isDefault: true,
  }
  const food: FatSecretFoodRef = {
    foodId: 'replay',
    name: foodLabel,
    servings: [serving],
  }
  return { food, serving }
}

function savedConsumption(row: V4CsvReplayRow): ConsumptionPortion | null {
  const qtyRaw = row.consumptionQty.trim()
  const unit = row.consumptionUnit.trim()
  const kind = row.consumptionKind.trim() as ConsumptionKind
  if (!unit && !qtyRaw) return null
  const quantity = qtyRaw === '' ? null : Number(qtyRaw)
  return {
    quantity: quantity != null && Number.isFinite(quantity) ? quantity : null,
    unit: unit || 'serving',
    kind: kind || 'count',
  }
}

export type V4ReplayComparison = {
  before: V4CsvReplayRow
  after: ServingAuditV4Row
  changed: boolean
}

/** Reprocess CSV rows with current deterministic code; stub FS from saved labels. */
export function replayServingAuditV4Csv(
  csvText: string,
  customFoods: MacroCustomFood[] = [],
): V4ReplayComparison[] {
  const saved = parseServingAuditV4Csv(csvText)
  return saved.map((row) => {
    const stub = stubFatSecret(row.fatSecretFood, row.fsServing)
    const foods = stub ? [stub.food] : []
    const savedCons = savedConsumption(row)
    const ensuredCons =
      ensureConsumption(row.parsedAmount || row.userInput, savedCons, {
        name: row.parsedName,
        userInput: row.userInput,
      }) ?? savedCons

    const csvMult = Number(row.computedMultiplier.trim())
    const portionQty = ensuredCons?.quantity ?? (Number(row.consumptionQty) || undefined)
    const portionUnit = ensuredCons?.unit || row.consumptionUnit

    const macroSnap = stub
      ? {
          fatSecretIndex: 1,
          servingIndex: 1,
          multiplier:
            Number.isFinite(csvMult) && csvMult > 0
              ? csvMult
              : 1,
          libraryIndex: null,
          calories: 0,
          protein: 0,
          servingType: '',
          relationship: (row.relationship || null) as
            | 'same_unit'
            | 'unit_conversion'
            | 'count_equivalent'
            | 'fraction_of_whole'
            | 'estimate_required'
            | 'unresolved'
            | null,
        }
      : null

    const trace = buildServingPipelineTrace({
      quantity: typeof portionQty === 'number' && portionQty > 0 ? portionQty : undefined,
      unit: portionUnit,
      consumption: ensuredCons,
      userAmount: row.parsedAmount || row.userInput,
      foodName: row.parsedName,
      userInput: row.userInput,
      macroSnap,
      selectedFood: stub?.food ?? null,
      selectedServing: stub?.serving ?? null,
      customFoods,
      fatSecretResults: foods,
    })

    const after = buildV3RowFromTrace({
      id: crypto.randomUUID(),
      userInput: row.userInput,
      parsedName: row.parsedName,
      parsedAmount: row.parsedAmount,
      consumption: trace.consumption ?? undefined,
      fatSecretSearch: row.fatSecretSearch,
      selectedFood: stub?.food ?? null,
      selectedFoodIndex: stub ? 1 : null,
      selectedServing: stub?.serving ?? null,
      selectedServingIndex: stub ? 1 : null,
      fatSecretResults: foods,
      macroSnap: {
        relationship: trace.relationship,
        normalizedEstimate: trace.normalizedEstimate,
      },
      dbServingQty: trace.dbServingQty ?? undefined,
      dbServingUnit: trace.dbServingUnit,
      computedMultiplier: trace.computedMultiplier,
      result: trace.result
        ? {
            servingSize: trace.result.servingSize,
            servingUnit: trace.result.servingUnit,
            servingMultiplier: trace.result.servingMultiplier,
          }
        : undefined,
      error: row.error || undefined,
    })
    // Prefer estimate-needed label when applicable
    if (trace.normalizedEstimatedLabel === 'needed') {
      after.normalizedEstimated = 'needed'
    }

    const changed =
      after.consumptionUnit !== row.consumptionUnit ||
      after.consumptionKind !== row.consumptionKind ||
      after.computedMultiplier !== row.computedMultiplier ||
      after.relationship !== row.relationship ||
      (after.result?.display ?? '') !== row.resultDisplay

    return { before: row, after, changed }
  })
}

export function replayComparisonsToCsv(comparisons: V4ReplayComparison[]): string {
  const headers = [
    'user said',
    'parsed name',
    'parsed amount',
    'before consumption',
    'after consumption',
    'before relationship',
    'after relationship',
    'before multiplier',
    'after multiplier',
    'before display',
    'after display',
    'changed',
    'fs serving',
    'fatsecret food',
  ]
  const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = comparisons.map(({ before, after, changed }) => {
    const beforeCons = [before.consumptionQty, before.consumptionUnit, before.consumptionKind]
      .filter(Boolean)
      .join(' ')
    const afterCons = [after.consumptionQty, after.consumptionUnit, after.consumptionKind]
      .filter(Boolean)
      .join(' ')
    return [
      before.userInput,
      before.parsedName,
      before.parsedAmount,
      beforeCons,
      afterCons,
      before.relationship,
      after.relationship,
      before.computedMultiplier,
      after.computedMultiplier,
      before.resultDisplay,
      after.result?.display ?? '',
      changed ? 'yes' : 'no',
      before.fsServing,
      before.fatSecretFood,
    ]
      .map((c) => esc(String(c)))
      .join(',')
  })
  return [headers.map(esc).join(','), ...lines].join('\n')
}
