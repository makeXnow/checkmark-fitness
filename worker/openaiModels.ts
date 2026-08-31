/** Default OpenAI models — override via request body or query where supported. */
export const OPENAI_MODELS = {
  /** Audio transcription API — no gpt-5-nano transcribe model exists. */
  transcribeDefault: 'gpt-4o-mini-transcribe',
  transcribeQuality: 'gpt-4o-transcribe',
  chatFast: 'gpt-5-nano',
  chatVision: 'gpt-5-nano',
} as const
