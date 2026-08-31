import type { ServingAuditV7Row } from './servingAuditLib'
import type { V7ValidationReport } from './validateServingAuditV7Rows'
import { getBasename } from '../../lib/getBasename'

export function servingAuditV7FixtureUrl(): string {
  const base = getBasename().replace(/\/$/, '')
  const path = '/dev/serving-audit-v7-latest.json'
  return !base || base === '/' ? path : `${base}${path}`
}

export type ServingAuditV7Fixture = {
  auditVersion: 'v7'
  generatedAt: string
  workerOrigin: string
  profile: string
  inputCount: number
  rowCount: number
  validation: V7ValidationReport
  rows: ServingAuditV7Row[]
}

export async function loadServingAuditV7Fixture(
  url = servingAuditV7FixtureUrl(),
): Promise<ServingAuditV7Fixture> {
  const res = await fetch(url, { cache: 'no-store' })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`V7 fixture not found (${res.status}).`)
  }
  if (text.trimStart().startsWith('<')) {
    throw new Error(`V7 fixture URL returned HTML instead of JSON (${url}).`)
  }
  const data = JSON.parse(text) as ServingAuditV7Fixture
  if (data.auditVersion !== 'v7' || !Array.isArray(data.rows)) {
    throw new Error('Invalid V7 fixture file')
  }
  return data
}
