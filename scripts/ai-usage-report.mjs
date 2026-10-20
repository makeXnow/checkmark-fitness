import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url))
const query = readFileSync(new URL('./ai-usage-summary.sql', import.meta.url), 'utf8').split('\n').filter(line => !line.trimStart().startsWith('--')).join('\n').trim()
const result = spawnSync(process.execPath, [cli, 'd1', 'execute', 'checkmark-fitness', '--remote', '--command', query], { stdio: 'inherit' })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
