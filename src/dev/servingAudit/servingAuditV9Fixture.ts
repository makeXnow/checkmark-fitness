import type { ServingAuditV9Row } from './servingAuditLib'
import type { V9ValidationReport } from './validateServingAuditV9Rows'
import { getBasename } from '../../lib/getBasename'

export function servingAuditV9FixtureUrl(): string {
  const base = getBasename().replace(/\/$/, '')
  const path = '/dev/serving-audit-v9-latest.json'
  return !base || base === '/' ? path : `${base}${path}`
}

export type ServingAuditV9Fixture = {
  auditVersion: 'v9'
  generatedAt: string
  workerOrigin: string
  profile: string
  inputCount: number
  rowCount: number
  validation: V9ValidationReport
  rows: ServingAuditV9Row[]
}

export async function loadServingAuditV9Fixture(
  url = servingAuditV9FixtureUrl(),
): Promise<ServingAuditV9Fixture> {
  const res = await fetch(url, { cache: 'no-store' })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`V9 fixture not found (${res.status}).`)
  }
  if (text.trimStart().startsWith('<')) {
    throw new Error(`V9 fixture URL returned HTML instead of JSON (${url}).`)
  }
  const data = JSON.parse(text) as ServingAuditV9Fixture
  if (data.auditVersion !== 'v9' || !Array.isArray(data.rows)) {
    throw new Error('Invalid V9 fixture file')
  }
  return data
}
