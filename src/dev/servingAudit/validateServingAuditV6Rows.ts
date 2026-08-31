import type { ServingAuditV6Row } from './servingAuditLib'

export type V6RowValidation = {
  rowId: string
  userInput: string
  parsedName: string
  ok: boolean
  issues: string[]
}

export type V6ValidationReport = {
  total: number
  passed: number
  failed: number
  rows: V6RowValidation[]
}

const GENERIC_UNITS = new Set(['serving', 'servings', 'portion', 'portions'])

export function validateServingAuditV6Row(row: ServingAuditV6Row): V6RowValidation {
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
      if (!unit || GENERIC_UNITS.has(unit.toLowerCase())) {
        issues.push(`parser unit missing or generic: "${unit}"`)
      }
      if ('consumption' in p) issues.push('parser still returns V4 consumption object')
      if ('amountText' in p) issues.push('parser still returns V4 amountText')
    } catch {
      issues.push('raw parser json is not valid JSON')
    }
  }

  if (!row.rawMacrosJson?.trim() && !row.error?.trim()) {
    issues.push('missing raw macros json')
  } else if (row.rawMacrosJson?.trim()) {
    try {
      const m = JSON.parse(row.rawMacrosJson) as Record<string, unknown>
      if ('relationship' in m && m.relationship != null && m.relationship !== '') {
        issues.push(`macros still has legacy relationship: ${String(m.relationship)}`)
      }
      if ('normalizedEstimate' in m && m.normalizedEstimate != null) {
        issues.push('macros still has normalizedEstimate')
      }
      const fsIdx = m.fatSecretIndex
      const hasFs = typeof fsIdx === 'number' && fsIdx >= 1
      if (hasFs) {
        const mult = m.multiplier
        if (typeof mult !== 'number' || !Number.isFinite(mult) || mult <= 0) {
          issues.push('FatSecret match missing positive multiplier')
        }
      }
    } catch {
      issues.push('raw macros json is not valid JSON')
    }
  }

  const qty = Number(row.consumptionQty)
  if (!row.error?.trim() && (!Number.isFinite(qty) || qty <= 0)) {
    issues.push('row parser quantity missing')
  }
  if (!row.error?.trim() && (!row.consumptionUnit?.trim() || GENERIC_UNITS.has(row.consumptionUnit.toLowerCase()))) {
    issues.push(`row parser unit invalid: "${row.consumptionUnit}"`)
  }

  return {
    rowId: row.id,
    userInput: row.userInput,
    parsedName: row.parsedName,
    ok: issues.length === 0,
    issues,
  }
}

export function validateServingAuditV6Rows(rows: ServingAuditV6Row[]): V6ValidationReport {
  const validated = rows.map(validateServingAuditV6Row)
  const passed = validated.filter((r) => r.ok).length
  return {
    total: rows.length,
    passed,
    failed: rows.length - passed,
    rows: validated,
  }
}
