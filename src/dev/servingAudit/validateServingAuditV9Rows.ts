import type { ServingAuditV9Row } from './servingAuditLib'

export type V9RowValidation = {
  ok: boolean
  issues: string[]
  rowId: string
  row: ServingAuditV9Row
}

export type V9ValidationReport = {
  total: number
  passed: number
  failed: number
  rows: V9RowValidation[]
}

export function validateServingAuditV9Row(row: ServingAuditV9Row): V9RowValidation {
  const issues: string[] = []
  if (row.error?.trim()) {
    return { ok: false, issues: [row.error], row }
  }
  if (!row.parsedName?.trim()) issues.push('missing parsed name')
  if (!row.unitSingular?.trim()) issues.push('missing unitSingular')
  if (!row.unitPlural?.trim()) issues.push('missing unitPlural')
  if (!row.unitFamily?.trim()) issues.push('missing unitFamily')

  const rel = row.relationshipV7
  if (rel) {
    const okRels = new Set([
      'DIRECT',
      'EQUIVALENT_COUNT',
      'WHOLE_ITEM',
      'NEEDS_UNIT_BRIDGE',
      'WRONG_MATCH',
      'NEED_MORE_CANDIDATES',
    ])
    if (!okRels.has(rel)) issues.push(`unknown relationship: ${rel}`)

    if (rel === 'NEEDS_UNIT_BRIDGE') {
      if (!row.unitsPerServing.trim()) {
        issues.push('NEEDS_UNIT_BRIDGE missing unitsPerServing')
      } else {
        const n = Number(row.unitsPerServing)
        if (!Number.isFinite(n) || n <= 0) issues.push('unitsPerServing must be positive')
      }
      if (!row.unitBridgeQuestion.trim()) {
        issues.push('NEEDS_UNIT_BRIDGE missing bridgeQuestion')
      }
    }

    if (
      rel === 'DIRECT' ||
      rel === 'EQUIVALENT_COUNT' ||
      rel === 'WHOLE_ITEM' ||
      rel === 'NEEDS_UNIT_BRIDGE'
    ) {
      if (!row.computedMultiplier?.trim() && !row.resultCalories?.trim()) {
        issues.push('matched row missing multiplier/calories')
      }
    }
  }

  return { ok: issues.length === 0, issues, rowId: row.id, row }
}

export function validateServingAuditV9Rows(rows: ServingAuditV9Row[]): V9ValidationReport {
  const validated = rows.map(validateServingAuditV9Row)
  const passed = validated.filter((v) => v.ok).length
  return {
    total: validated.length,
    passed,
    failed: validated.length - passed,
    rows: validated,
  }
}
