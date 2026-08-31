import type { ServingAuditV8Row } from './servingAuditLib'
import { UNIT_FAMILIES, V8_SERVING_RELATIONSHIPS } from '../../features/macro/macroAiSchemas'

export type V8RowValidation = {
  rowId: string
  userInput: string
  parsedName: string
  ok: boolean
  issues: string[]
}

export type V8ValidationReport = {
  total: number
  passed: number
  failed: number
  rows: V8RowValidation[]
}

const GENERIC_UNITS = new Set(['serving', 'servings', 'portion', 'portions'])

export function validateServingAuditV8Row(row: ServingAuditV8Row): V8RowValidation {
  const issues: string[] = []

  if (row.error?.trim()) {
    issues.push(`pipeline error: ${row.error.trim()}`)
  }

  if (!row.rawParserJson?.trim()) {
    issues.push('missing raw parser json')
  } else {
    try {
      const p = JSON.parse(row.rawParserJson) as Record<string, unknown>
      if (typeof p.quantity !== 'number' || !Number.isFinite(p.quantity) || p.quantity <= 0) {
        issues.push('parser quantity missing or invalid')
      }
      const unitSingular =
        typeof p.unitSingular === 'string'
          ? p.unitSingular.trim()
          : typeof p.unit === 'string'
            ? p.unit.trim()
            : ''
      const unitPlural = typeof p.unitPlural === 'string' ? p.unitPlural.trim() : ''
      const family = typeof p.unitFamily === 'string' ? p.unitFamily : ''
      if (!(UNIT_FAMILIES as readonly string[]).includes(family)) {
        issues.push(`parser unitFamily missing or invalid: "${family}"`)
      }
      if (!unitSingular) {
        issues.push('parser unitSingular missing')
      } else if (GENERIC_UNITS.has(unitSingular.toLowerCase()) && family !== 'serving') {
        issues.push(`parser unitSingular generic without serving family: "${unitSingular}"`)
      }
      if (!unitPlural) {
        issues.push('parser unitPlural missing')
      }
      if (typeof p.estimated !== 'boolean') issues.push('parser estimated missing')
      if (typeof p.originalPortion !== 'string') issues.push('parser originalPortion missing')
      if (p.estimated === true && !(typeof p.originalPortion === 'string' && p.originalPortion.trim())) {
        issues.push('parser originalPortion required when estimated')
      }
      if ('consumption' in p) issues.push('parser still returns V4 consumption object')
      if ('multiplier' in p) issues.push('parser should not return multiplier')
    } catch {
      issues.push('raw parser json is not valid JSON')
    }
  }

  if (!row.rawMacrosJson?.trim() && !row.error?.trim()) {
    issues.push('missing raw macros json')
  } else if (row.rawMacrosJson?.trim()) {
    try {
      const m = JSON.parse(row.rawMacrosJson) as Record<string, unknown>
      if ('normalizedEstimate' in m && m.normalizedEstimate != null) {
        issues.push('macros still has normalizedEstimate')
      }
      const rel = m.relationshipV7 ?? m.relationship
      const fsIdx = m.fatSecretIndex
      const hasFs = typeof fsIdx === 'number' && fsIdx >= 1
      const hasLib = typeof m.libraryIndex === 'number' && m.libraryIndex >= 1
      const hasDirect =
        !hasFs && !hasLib && typeof m.calories === 'number' && m.calories > 0

      if (hasFs || hasLib) {
        if (typeof rel !== 'string' || !(V8_SERVING_RELATIONSHIPS as readonly string[]).includes(rel)) {
          issues.push(`macros relationship missing or invalid: "${String(rel)}"`)
        }
        const mult = m.multiplier
        const bridgeNeeded = rel === 'NEEDS_UNIT_BRIDGE'
        const bridgeRan = m.unitBridgeRan === true
        const ups = m.unitsPerServing
        const hasUps = typeof ups === 'number' && Number.isFinite(ups) && ups > 0

        if (bridgeNeeded && bridgeRan && !hasUps && !row.error?.trim()) {
          issues.push('NEEDS_UNIT_BRIDGE ran but unitsPerServing missing')
        }
        if (bridgeNeeded && bridgeRan && hasUps && !row.rawUnitBridgeJson?.trim()) {
          issues.push('AI #3 ran but rawUnitBridgeJson missing')
        }
        if (
          typeof mult !== 'number' ||
          !Number.isFinite(mult) ||
          mult <= 0
        ) {
          // Allowed when bridge failed or wrong match — still flag if relationship expects math
          if (rel === 'DIRECT' || rel === 'EQUIVALENT_COUNT' || rel === 'WHOLE_ITEM') {
            issues.push('FatSecret/library match missing positive code-computed multiplier')
          } else if (bridgeNeeded && hasUps) {
            issues.push('unit bridge has unitsPerServing but code multiplier missing')
          }
        }
      } else if (!hasDirect && !row.error?.trim()) {
        issues.push('macros has no FatSecret, library, or direct estimate path')
      }
    } catch {
      issues.push('raw macros json is not valid JSON')
    }
  }

  const qty = Number(row.consumptionQty)
  if (!row.error?.trim() && (!Number.isFinite(qty) || qty <= 0)) {
    issues.push('row parser quantity missing')
  }

  if (!row.error?.trim() && !row.unitSingular?.trim()) {
    issues.push('row unitSingular missing')
  }

  return {
    rowId: row.id,
    userInput: row.userInput,
    parsedName: row.parsedName,
    ok: issues.length === 0,
    issues,
  }
}

export function validateServingAuditV8Rows(rows: ServingAuditV8Row[]): V8ValidationReport {
  const validated = rows.map(validateServingAuditV8Row)
  const passed = validated.filter((r) => r.ok).length
  return {
    total: rows.length,
    passed,
    failed: rows.length - passed,
    rows: validated,
  }
}
