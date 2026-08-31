import { OPENAI_MODELS } from './openaiModels'
import type { JsonSchemaFormat } from '../src/features/macro/macroAiSchemas'

export function openAiResponseFormat(schema?: JsonSchemaFormat | null): { type: 'json_object' } | {
  type: 'json_schema'
  json_schema: { name: string; strict: boolean; schema: Record<string, unknown> }
} {
  if (schema) {
    return {
      type: 'json_schema',
      json_schema: {
        name: schema.name,
        strict: schema.strict ?? true,
        schema: schema.schema,
      },
    }
  }
  return { type: 'json_object' }
}

/** OpenAI `json_object` rejects requests unless some message contains the word "json". */
export function ensureJsonObjectUser(system: string, user: string): string {
  if (/\bjson\b/i.test(system) || /\bjson\b/i.test(user)) return user
  return `${user}\n\nRespond with JSON.`
}

export async function callOpenAiJson(
  apiKey: string,
  system: string,
  user: string,
  model = OPENAI_MODELS.chatFast,
  schema?: JsonSchemaFormat | null,
): Promise<unknown> {
  const format = openAiResponseFormat(schema)
  const userMsg = format.type === 'json_object' ? ensureJsonObjectUser(system, user) : user
  const payload: Record<string, unknown> = {
    model,
    response_format: format,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ],
  }
  // gpt-5-nano only supports the default temperature (1).
  if (!model.includes('gpt-5')) {
    payload.temperature = 0.2
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenAI chat failed: ${errText.slice(0, 300)}`)
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const raw = data.choices?.[0]?.message?.content || '{}'
  return JSON.parse(raw) as unknown
}

const DEFAULT_MAX_ATTEMPTS = 3

/** Call OpenAI JSON with validation-based retries (V6). */
export async function callOpenAiJsonWithRetry(
  apiKey: string,
  system: string,
  user: string,
  options: {
    model?: string
    schema?: JsonSchemaFormat | null
    validate: (raw: unknown) => boolean
    validationHint?: (raw: unknown) => string
    maxAttempts?: number
  },
): Promise<unknown> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  let lastError = 'validation failed'
  let promptUser = user

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const raw = await callOpenAiJson(apiKey, system, promptUser, options.model, options.schema)
    if (options.validate(raw)) return raw
    lastError = options.validationHint?.(raw) ?? 'response failed validation'
    if (attempt < maxAttempts) {
      promptUser = `${user}\n\nYour previous response was invalid (${lastError}). Return a corrected JSON object that satisfies the schema.`
    }
  }

  throw new Error(`AI response invalid after ${maxAttempts} attempts: ${lastError}`)
}
