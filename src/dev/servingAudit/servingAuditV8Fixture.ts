import type { ServingAuditV8Row } from './servingAuditLib'
import type { V8ValidationReport } from './validateServingAuditV8Rows'
import { getBasename } from '../../lib/getBasename'

export function servingAuditV8FixtureUrl(): string {
  const base = getBasename().replace(/\/$/, '')
  const path = '/dev/serving-audit-v8-latest.json'
  return !base || base === '/' ? path : `${base}${path}`
}

export type ServingAuditV8Fixture = {
  auditVersion: 'v8'
  generatedAt: string
  workerOrigin: string
  profile: string
  inputCount: number
  rowCount: number
  validation: V8ValidationReport
  rows: ServingAuditV8Row[]
}

export async function loadServingAuditV8Fixture(
  url = servingAuditV8FixtureUrl(),
): Promise<ServingAuditV8Fixture> {
  const res = await fetch(url, { cache: 'no-store' })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`V8 fixture not found (${res.status}).`)
  }
  if (text.trimStart().startsWith('<')) {
    throw new Error(`V8 fixture URL returned HTML instead of JSON (${url}).`)
  }
  const data = JSON.parse(text) as ServingAuditV8Fixture
  if (data.auditVersion !== 'v8' || !Array.isArray(data.rows)) {
    throw new Error('Invalid V8 fixture file')
  }
  return data
}
