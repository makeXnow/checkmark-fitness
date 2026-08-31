import type { ServingAuditV7Row } from './servingAuditLib'
import { UNIT_FAMILIES, V7_SERVING_RELATIONSHIPS } from '../../features/macro/macroAiSchemas'

export type V7RowValidation = {
  rowId: string
  userInput: string
  parsedName: string
  ok: boolean
  issues: string[]
}

export type V7ValidationReport = {
  total: number
  passed: number
  failed: number
  rows: V7RowValidation[]
}

const GENERIC_UNITS = new Set(['serving', 'servings', 'portion', 'portions'])

export function validateServingAuditV7Row(row: ServingAuditV7Row): V7RowValidation {
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
      const unit = typeof p.unit === 'string' ? p.unit.trim() : ''
      const family = typeof p.unitFamily === 'string' ? p.unitFamily : ''
      if (!(UNIT_FAMILIES as readonly string[]).includes(family)) {
        issues.push(`parser unitFamily missing or invalid: "${family}"`)
      }
      if (!unit) {
        issues.push('parser unit missing')
      } else if (GENERIC_UNITS.has(unit.toLowerCase()) && family !== 'serving') {
        issues.push(`parser unit generic without serving family: "${unit}"`)
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
        if (typeof rel !== 'string' || !(V7_SERVING_RELATIONSHIPS as readonly string[]).includes(rel)) {
          issues.push(`macros relationshipV7 missing or invalid: "${String(rel)}"`)
        }
        const mult = m.multiplier
        if (typeof mult !== 'number' || !Number.isFinite(mult) || mult <= 0) {
          issues.push('FatSecret/library match missing positive code-computed multiplier')
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

  return {
    rowId: row.id,
    userInput: row.userInput,
    parsedName: row.parsedName,
    ok: issues.length === 0,
    issues,
  }
}

export function validateServingAuditV7Rows(rows: ServingAuditV7Row[]): V7ValidationReport {
  const validated = rows.map(validateServingAuditV7Row)
  const passed = validated.filter((r) => r.ok).length
  return {
    total: rows.length,
    passed,
    failed: rows.length - passed,
    rows: validated,
  }
}
