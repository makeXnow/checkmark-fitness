/** Default OpenAI models — override via request body or query where supported. */
export const OPENAI_MODELS = {
  /** Audio transcription API — no gpt-5-nano transcribe model exists. */
  transcribeDefault: 'gpt-4o-transcribe',
  transcribeQuality: 'gpt-4o-transcribe',
  chatFast: 'gpt-5.6-luna',
  /** Escalation for picks that fail plausibility checks or disagree with the cross-check. */
  chatStrong: 'gpt-5.6-sol',
  chatVision: 'gpt-5.6-luna',
} as const
