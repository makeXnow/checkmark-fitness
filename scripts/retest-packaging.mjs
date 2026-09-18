#!/usr/bin/env node
/**
 * Re-run packaging nutrition vision 3× against stored R2 scan photos.
 *
 * Usage:
 *   node scripts/retest-packaging.mjs <frontKey> <nutritionKey> [amountText]
 *
 * Keys come from packagingSnapshot.frontImageKey / nutritionImageKey on a diary item.
 */
const WORKER = process.env.WORKER_ORIGIN || 'https://mxn-checkmark-fitness.alexander-c3a.workers.dev'
const profile = process.env.PROFILE || 'alexander'

const [frontKey, nutritionKey, amountText = 'Whole bag'] = process.argv.slice(2)
if (!frontKey || !nutritionKey) {
  console.error('Usage: node scripts/retest-packaging.mjs <frontKey> <nutritionKey> [amountText]')
  process.exit(1)
}

const url = `${WORKER}/api/u/${encodeURIComponent(profile)}/macro/packaging-retest`
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ frontKey, nutritionKey, amountText, runs: 3 }),
})
const text = await res.text()
if (!res.ok) {
  console.error(res.status, text)
  process.exit(1)
}
const data = JSON.parse(text)
console.log(JSON.stringify(data, null, 2))
