/** Default OpenAI models — override via request body or query where supported. */
export const OPENAI_MODELS = {
  transcribeDefault: 'gpt-4o-mini-transcribe',
  transcribeQuality: 'gpt-4o-transcribe',
  chatFast: 'gpt-4o-mini',
  chatVision: 'gpt-4o',
} as const
