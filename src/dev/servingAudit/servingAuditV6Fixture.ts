import type { ServingAuditV6Row } from './servingAuditLib'
import type { V6ValidationReport } from './validateServingAuditV6Rows'
import { getBasename } from '../../lib/getBasename'

/** Public asset — must be root-absolute (not `./`) so nested dev routes resolve correctly. */
export function servingAuditV6FixtureUrl(): string {
  const base = getBasename().replace(/\/$/, '')
  const path = '/dev/serving-audit-v6-latest.json'
  return !base || base === '/' ? path : `${base}${path}`
}

export const SERVING_AUDIT_V6_FIXTURE_URL = servingAuditV6FixtureUrl()

export type ServingAuditV6Fixture = {
  auditVersion: 'v6'
  generatedAt: string
  workerOrigin: string
  profile: string
  inputCount: number
  rowCount: number
  validation: V6ValidationReport
  rows: ServingAuditV6Row[]
}

export async function loadServingAuditV6Fixture(
  url = servingAuditV6FixtureUrl(),
): Promise<ServingAuditV6Fixture> {
  const res = await fetch(url, { cache: 'no-store' })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`V6 fixture not found (${res.status}).`)
  }
  if (text.trimStart().startsWith('<')) {
    throw new Error(`V6 fixture URL returned HTML instead of JSON (${url}).`)
  }
  const data = JSON.parse(text) as ServingAuditV6Fixture
  if (data.auditVersion !== 'v6' || !Array.isArray(data.rows)) {
    throw new Error('Invalid V6 fixture file')
  }
  return data
}
