-- Read-only, last 7 UTC days. Run:
-- npm run ai:usage
-- One request_id = one inbound API request, NOT necessarily one human action.
-- call_index > 1 includes retries, cross-checks and stronger-model opinions.
-- Profiles/source are client-declared diagnostics, not authenticated identities.
-- NULL token counts mean the upstream did not report usage; they are not zero.
SELECT COALESCE(profile_id, '(unattributed)') AS profile, source, feature, model,
  COUNT(*) AS openai_calls, COUNT(DISTINCT request_id) AS inbound_requests,
  SUM(CASE WHEN http_status BETWEEN 200 AND 299 THEN 1 ELSE 0 END) AS http_successes,
  SUM(CASE WHEN http_status IS NULL OR http_status >= 400 THEN 1 ELSE 0 END) AS failures,
  SUM(CASE WHEN call_index > 1 THEN 1 ELSE 0 END) AS followup_calls,
  SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens,
  SUM(cached_input_tokens) AS cached_input_tokens, SUM(cache_write_tokens) AS cache_write_tokens,
  SUM(CASE WHEN input_tokens IS NULL THEN 1 ELSE 0 END) AS calls_without_token_usage
FROM ai_request_usage
WHERE created_at >= (unixepoch('now') - 7 * 86400) * 1000
GROUP BY profile_id, source, feature, model
ORDER BY openai_calls DESC;
