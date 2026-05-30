import { useCallback, useEffect, useState } from 'react'
import { fetchMacroPrompts, saveMacroPrompts } from '../../core/api'
import {
  DEFAULT_MACRO_PROMPTS,
  MACRO_PROMPT_DESCRIPTIONS,
  MACRO_PROMPT_KEYS,
  MACRO_PROMPT_LABELS,
  type MacroPromptKey,
  type MacroPrompts,
} from './prompts'

const fieldLabelClass = 'block text-[10px] font-black text-neutral-500 uppercase tracking-widest mb-2'

export function MacroPromptSettings() {
  const [draft, setDraft] = useState<MacroPrompts>(DEFAULT_MACRO_PROMPTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setNotice(null)
    void fetchMacroPrompts()
      .then((prompts) => {
        if (!cancelled) setDraft(prompts)
      })
      .catch((e) => {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : 'Failed to load prompts'
        if (msg.includes('404')) {
          setDraft({ ...DEFAULT_MACRO_PROMPTS })
          setNotice('Showing built-in defaults — deploy the Worker to load and save custom prompts.')
          return
        }
        setError(msg)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updatePrompt = useCallback((key: MacroPromptKey, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSavedAt(null)
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      const saved = await saveMacroPrompts(draft)
      setDraft(saved)
      setSavedAt(Date.now())
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save prompts'
      setError(
        msg.includes('404')
          ? 'Save failed — deploy the Worker first (`npm run deploy`).'
          : msg,
      )
    } finally {
      setSaving(false)
    }
  }, [draft])

  const handleResetAll = useCallback(() => {
    setDraft({ ...DEFAULT_MACRO_PROMPTS })
    setSavedAt(null)
  }, [])

  const handleResetOne = useCallback((key: MacroPromptKey) => {
    setDraft((prev) => ({ ...prev, [key]: DEFAULT_MACRO_PROMPTS[key] }))
    setSavedAt(null)
  }, [])

  return (
    <div className="bg-neutral-900 border border-neutral-800 p-4 rounded-[var(--radius-card)] space-y-4">
      <div>
        <h3 className="text-sm font-black text-white uppercase tracking-wide">Diet AI prompts</h3>
        <p className="text-xs text-neutral-500 mt-1">
          Single source of truth for all diet-related OpenAI calls. Changes apply for every profile.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-neutral-500 text-center py-4">Loading prompts…</p>
      ) : (
        <div className="space-y-5">
          {MACRO_PROMPT_KEYS.map((key) => (
            <div key={key} className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <label htmlFor={`macro-prompt-${key}`} className={fieldLabelClass}>
                    {MACRO_PROMPT_LABELS[key]}
                  </label>
                  <p className="text-[11px] text-neutral-600">{MACRO_PROMPT_DESCRIPTIONS[key]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleResetOne(key)}
                  className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 hover:text-emerald-400 transition-colors"
                >
                  Reset
                </button>
              </div>
              <textarea
                id={`macro-prompt-${key}`}
                value={draft[key]}
                onChange={(e) => updatePrompt(key, e.target.value)}
                rows={key === 'MACROS' || key === 'PARSER' ? 12 : key === 'BARCODE_SCAN' ? 10 : 6}
                className="w-full p-3 bg-black border border-neutral-700 rounded-xl text-white text-sm font-mono leading-relaxed outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all resize-y min-h-[6rem]"
                spellCheck={false}
              />
            </div>
          ))}
        </div>
      )}

      {notice ? (
        <p className="text-sm text-amber-400/90 text-center">{notice}</p>
      ) : null}

      {error ? (
        <p className="text-sm text-red-400 text-center" role="alert">
          {error}
        </p>
      ) : null}

      {savedAt ? (
        <p className="text-xs text-emerald-400/90 text-center">Saved — updates apply on the next AI call.</p>
      ) : null}

      <div className="flex flex-wrap gap-2 justify-end pt-1">
        <button
          type="button"
          onClick={handleResetAll}
          disabled={loading || saving}
          className="px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wide bg-black text-neutral-400 border border-neutral-800 hover:border-neutral-600 hover:text-neutral-200 disabled:opacity-50 transition-all"
        >
          Reset all
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={loading || saving}
          className="px-4 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-wide bg-emerald-400 text-black hover:bg-emerald-300 disabled:opacity-50 transition-all"
        >
          {saving ? 'Saving…' : 'Save prompts'}
        </button>
      </div>
    </div>
  )
}
