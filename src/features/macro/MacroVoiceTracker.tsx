import {
  ArrowUp,
  Camera,
  Loader2,
  Mic,
  NotebookText,
  Plus,
  ScanText,
  Trash2,
  X,
  Pencil,
  BicepsFlexed,
  Flame,
  AlertCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { aiJson, aiVisionJson, MacroEstimateError, macroEstimateItem, transcribeAudio } from '../../core/api'
import type { MacroCustomFood, MacroDayItem, MacroGoals } from '../../types/domain'
import {
  formatServingDisplay,
  macroItemDisplayEmoji,
  macroItemDisplayName,
  macroItemServingFields,
  mergeMacroLogs,
  parsedItemToDayItem,
  scaleFatSecretServing,
  sortCustomFoodsByUsage,
  type ParsedFoodItem,
} from './macroLib'
import {
  MacroFoodEditCard,
  MacroFoodViewCard,
  itemToEditFields,
  libraryFoodToEditFields,
  macroItemAuditTrail,
  type MacroFoodEditFields,
} from './MacroFoodCard'
import { MACRO_PROMPTS } from './prompts'

type QuickScanState = {
  isOpen: boolean
  frontPreview: string | null
  nutritionPreview: string | null
  frontStatus: 'idle' | 'processing' | 'done' | 'error'
  nutritionStatus: 'idle' | 'processing' | 'done' | 'error'
  frontData: Record<string, unknown> | null
  nutritionData: Record<string, unknown> | null
}

const MAX_RECORDING_MS = 3 * 60 * 1000

/** Safari often records mp4/aac; Chrome uses webm. OpenAI needs the real container type. */
function preferredRecorderMimeType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

function StatusDashboard({
  consumed,
  goal,
  proteinPct,
  proteinGoal,
}: {
  consumed: number
  goal: number
  proteinPct: number
  proteinGoal: number
}) {
  const isOver = consumed > goal
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="bg-[var(--color-surface)] p-4 rounded-[var(--radius-card)] border border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-2 text-[10px] font-black opacity-40 uppercase tracking-widest text-white">
          <div className={isOver ? 'text-red-400 opacity-60' : 'text-emerald-400 opacity-60'}>
            {isOver ? <AlertCircle size={12} strokeWidth={3} /> : <Flame size={12} strokeWidth={3} />}
          </div>
          Calories
        </div>
        <div className="flex items-end justify-between pr-1">
          <span className="text-3xl font-black text-white leading-none">{Math.round(consumed)}</span>
          <span className="text-[11px] font-bold opacity-20 text-white leading-none mb-1">/ {goal}</span>
        </div>
        <div className="w-full bg-white/10 h-1 rounded-full mt-4 overflow-hidden">
          <div
            className={`h-full transition-all duration-700 ${isOver ? 'bg-red-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.min((consumed / goal) * 100, 100)}%` }}
          />
        </div>
      </div>
      <div className="bg-[var(--color-surface)] p-4 rounded-[var(--radius-card)] border border-[var(--color-border)]">
        <div className="flex items-center gap-2 mb-2 text-[10px] font-black opacity-40 uppercase tracking-widest text-white">
          <div className="text-blue-400 opacity-60">
            <BicepsFlexed size={12} strokeWidth={3} />
          </div>
          Protein %
        </div>
        <div className="flex items-end justify-between pr-1">
          <span className="text-3xl font-black text-white leading-none">{proteinPct}%</span>
          <span className="text-[11px] font-bold opacity-20 text-white leading-none mb-1">/ {proteinGoal}%</span>
        </div>
        <div className="w-full bg-white/10 h-1 rounded-full mt-4 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-700"
            style={{ width: `${Math.min((proteinPct / proteinGoal) * 100, 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}

export function MacroVoiceTracker({
  dateKey,
  goals,
  logs,
  customFoods,
  onSaveLogs,
  onSaveFoods,
}: {
  dateKey: string
  goals: MacroGoals
  logs: Record<string, MacroDayItem[]>
  customFoods: MacroCustomFood[]
  onSaveLogs: (logs: Record<string, MacroDayItem[]>) => void
  onSaveFoods: (foods: MacroCustomFood[]) => void
}) {
  const items = logs[dateKey] || []
  const sortedCustomFoods = useMemo(
    () => sortCustomFoodsByUsage(customFoods, logs),
    [customFoods, logs],
  )
  const logsRef = useRef(logs)
  logsRef.current = mergeMacroLogs(logs, logsRef.current)
  const customFoodsRef = useRef(customFoods)
  customFoodsRef.current = customFoods
  const estimatingIdsRef = useRef(new Set<string>())

  const [inputText, setInputText] = useState('')
  const [recording, setRecording] = useState(false)
  const [volume, setVolume] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)
  const recordingLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const processingRefs = useRef<Record<string, AbortController>>({})

  const [quickScan, setQuickScan] = useState<QuickScanState>({
    isOpen: false,
    frontPreview: null,
    nutritionPreview: null,
    frontStatus: 'idle',
    nutritionStatus: 'idle',
    frontData: null,
    nutritionData: null,
  })
  const frontPromiseRef = useRef<Promise<unknown> | null>(null)
  const nutritionPromiseRef = useRef<Promise<unknown> | null>(null)

  const [dbModalOpen, setDbModalOpen] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingLibraryFoodId, setEditingLibraryFoodId] = useState<string | null>(null)

  useEffect(() => {
    setEditingItemId(null)
    setEditingLibraryFoodId(null)
  }, [dateKey])

  const clearRecordingLimitTimer = useCallback(() => {
    if (recordingLimitTimerRef.current) {
      clearTimeout(recordingLimitTimerRef.current)
      recordingLimitTimerRef.current = null
    }
  }, [])

  const stopRecording = useCallback(() => {
    clearRecordingLimitTimer()
    setRecording(false)
    mediaRecorderRef.current?.stop()
  }, [clearRecordingLimitTimer])

  useEffect(() => () => clearRecordingLimitTimer(), [clearRecordingLimitTimer])

  const totals = useMemo(() => {
    return items.reduce(
      (acc, i) => ({
        cal: acc.cal + (i.calories || 0),
        pro: acc.pro + (i.protein || 0),
      }),
      { cal: 0, pro: 0 },
    )
  }, [items])

  const proteinPct = totals.cal > 0 ? Math.round(((totals.pro * 4) / totals.cal) * 100) : 0

  const replaceDay = useCallback(
    (fn: (prev: MacroDayItem[]) => MacroDayItem[]) => {
      const key = dateKey
      const prevAll = logsRef.current
      const nextDay = fn(prevAll[key] || [])
      const nextAll = { ...prevAll, [key]: nextDay }
      logsRef.current = nextAll
      onSaveLogs(nextAll)
    },
    [dateKey, onSaveLogs],
  )

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`
  }, [inputText, recording])

  const removeItem = useCallback(
    (id: string) => {
      setEditingItemId((cur) => (cur === id ? null : cur))
      replaceDay((prev) => prev.filter((i) => i.id !== id))
    },
    [replaceDay],
  )

  const calculateMacros = useCallback(
    async (
      id: string,
      item: MacroDayItem,
      extraCtx = '',
      options?: { skipFatSecretFetch?: boolean },
    ) => {
      estimatingIdsRef.current.add(id)
      try {
        const result = await macroEstimateItem({
          name: item.name,
          amount: item.amount,
          notes: item.notes,
          fatSecretSearch: item.fatSecretSearch,
          fatSecretResults: item.fatSecretResults,
          fatSecretRoute: item.fatSecretRoute,
          skipFatSecretFetch: options?.skipFatSecretFetch,
          customFoods: customFoodsRef.current,
          extraCtx,
        })
        replaceDay((prev) =>
          prev.map((i) => {
            if (i.id !== id) return i
            return {
              ...i,
              calories: result.calories,
              protein: result.protein,
              libraryFoodId: result.libraryFoodId,
              servingType: result.servingType,
              servingMultiplier: result.servingMultiplier,
              baseCalories: result.baseCalories,
              baseProtein: result.baseProtein,
              amount:
                result.servingType != null
                  ? formatServingDisplay(result.servingMultiplier ?? 1, result.servingType)
                  : i.amount,
              fatSecretResults: result.fatSecretResults,
              fatSecretRoute: result.fatSecretRoute ?? i.fatSecretRoute,
              macroEstimateSnapshot: result.macroEstimateSnapshot ?? i.macroEstimateSnapshot,
              status: 'ready',
            }
          }),
        )
      } catch (e) {
        const fs = e instanceof MacroEstimateError ? e.fatSecretResults : undefined
        const route = e instanceof MacroEstimateError ? e.fatSecretRoute : undefined
        replaceDay((prev) =>
          prev.map((i) => {
            if (i.id !== id) return i
            if (i.name?.trim()) {
              return {
                ...i,
                status: 'pending' as const,
                ...(fs?.length ? { fatSecretResults: fs, fatSecretRoute: route } : {}),
              }
            }
            return {
              ...i,
              status: 'editing_raw' as const,
              rawText: [item.name, item.amount].filter(Boolean).join(' '),
              ...(fs?.length ? { fatSecretResults: fs, fatSecretRoute: route } : {}),
            }
          }),
        )
      } finally {
        estimatingIdsRef.current.delete(id)
      }
    },
    [replaceDay],
  )

  const estimateMacrosForItem = useCallback(
    (item: MacroDayItem, extraCtx = '', options?: { skipFatSecretFetch?: boolean }) => {
      if (estimatingIdsRef.current.has(item.id)) return
      const day = logsRef.current[dateKey] || []
      const latest = day.find((i) => i.id === item.id) ?? item
      void calculateMacros(latest.id, latest, extraCtx, options)
    },
    [calculateMacros, dateKey],
  )

  const refreshItemMacros = useCallback(
    (item: MacroDayItem) => {
      replaceDay((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: 'pending',
                calories: 0,
                protein: 0,
                libraryFoodId: undefined,
                servingType: undefined,
                servingMultiplier: undefined,
                baseCalories: undefined,
                baseProtein: undefined,
              }
            : i,
        ),
      )
      const day = logsRef.current[dateKey] || []
      const latest = day.find((i) => i.id === item.id) ?? item
      void calculateMacros(latest.id, latest, '', { skipFatSecretFetch: true })
    },
    [calculateMacros, dateKey, replaceDay],
  )

  const stuckParsedKey = useMemo(
    () =>
      items
        .filter((i) => i.status === 'editing_raw' && i.name?.trim())
        .map((i) => i.id)
        .sort()
        .join(','),
    [items],
  )

  useEffect(() => {
    if (!stuckParsedKey) return
    replaceDay((prev) =>
      prev.map((i) =>
        i.status === 'editing_raw' && i.name?.trim() ? { ...i, status: 'pending' as const } : i,
      ),
    )
  }, [stuckParsedKey, replaceDay])

  const pendingEstimateKey = useMemo(
    () =>
      items
        .filter((i) => i.status === 'pending' && i.name?.trim())
        .map((i) => i.id)
        .sort()
        .join(','),
    [items],
  )

  useEffect(() => {
    if (!pendingEstimateKey) return
    for (const id of pendingEstimateKey.split(',')) {
      const item = items.find((i) => i.id === id)
      if (!item) continue
      void estimateMacrosForItem(item)
    }
  }, [pendingEstimateKey, items, estimateMacrosForItem])

  const startParsingFlow = useCallback(
    async (id: string, rawText: string, baseFood?: Record<string, unknown> | null) => {
      const controller = new AbortController()
      processingRefs.current[id] = controller
      try {
        let promptInput = `Input: ${rawText}`
        if (baseFood && baseFood.name) {
          promptInput += `\n\nContext: The user scanned "${String(baseFood.name)}".`
          const nf = await aiJson({
            system: MACRO_PROMPTS.PARSER,
            user: promptInput,
          }).catch(() => null)
          if (!nf || typeof nf !== 'object') throw new Error('parse')
          const data = nf as { items?: ParsedFoodItem[] }
          const libItem: MacroCustomFood = {
            id: crypto.randomUUID(),
            name: String(baseFood.name || ''),
            emoji: String(baseFood.emoji || '🍱'),
            baseAmount: String(baseFood.baseAmount || '1 serving'),
            calories: Number(baseFood.calories) || 0,
            protein: Number(baseFood.protein) || 0,
            fat: Number(baseFood.fat) || 0,
            carbs: Number(baseFood.carbs) || 0,
            createdAt: Date.now(),
          }
          onSaveFoods([...customFoodsRef.current, libItem])
          replaceDay((prev) => prev.filter((i) => i.id !== id))
          if (data.items?.length) {
            const newItems = data.items.map((it) => parsedItemToDayItem(it, { userInput: rawText }))
            replaceDay((prev) => [...prev.filter((i) => i.id !== id), ...newItems])
            newItems.forEach((it) =>
              void estimateMacrosForItem(it, `\n\nScanned base: ${JSON.stringify(baseFood)}`),
            )
          }
          return
        }
        const parsed = await aiJson({
          system: MACRO_PROMPTS.PARSER,
          user: promptInput,
        })
        const data = parsed as { items?: ParsedFoodItem[] }
        replaceDay((prev) => prev.filter((i) => i.id !== id))
        if (data.items?.length) {
          const newItems = data.items.map((it) => parsedItemToDayItem(it, { userInput: rawText }))
          replaceDay((prev) => [...prev.filter((i) => i.id !== id), ...newItems])
          newItems.forEach((it) => void estimateMacrosForItem(it))
        }
      } catch {
        replaceDay((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'editing_raw', rawText } : i)))
      } finally {
        delete processingRefs.current[id]
      }
    },
    [estimateMacrosForItem, onSaveFoods, replaceDay],
  )

  const handleMicToggle = useCallback(async () => {
    if (recording) {
      stopRecording()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      const analyser = audioCtx.createAnalyser()
      audioCtx.createMediaStreamSource(stream).connect(analyser)
      analyser.fftSize = 256
      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const tick = () => {
        analyser.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        setVolume(avg)
        rafRef.current = requestAnimationFrame(tick)
      }
      tick()
      const recorderMime = preferredRecorderMimeType()
      const rec = recorderMime ? new MediaRecorder(stream, { mimeType: recorderMime }) : new MediaRecorder(stream)
      mediaRecorderRef.current = rec
      audioChunksRef.current = []
      rec.ondataavailable = (e) => audioChunksRef.current.push(e.data)
      rec.onstop = async () => {
        cancelAnimationFrame(rafRef.current)
        await audioCtx.close()
        if (audioChunksRef.current.length === 0) return
        const tempId = crypto.randomUUID()
        replaceDay((prev) => [...prev, { id: tempId, status: 'transcribing', timestamp: Date.now(), name: '', amount: '' }])
        const mime = rec.mimeType || recorderMime || 'audio/webm'
        const ext = mime.includes('mp4') || mime.includes('aac') ? 'm4a' : 'webm'
        const blob = new Blob(audioChunksRef.current, { type: mime })
        const file = new File([blob], `audio.${ext}`, { type: mime })
        abortRef.current = new AbortController()
        try {
          const text = await transcribeAudio(file)
          replaceDay((prev) =>
            prev
              .filter((i) => i.id !== tempId)
              .concat({
                id: tempId,
                status: 'processing_cancellable',
                rawText: text.trim(),
                timestamp: Date.now(),
                name: '',
                amount: '',
              }),
          )
          void startParsingFlow(tempId, text.trim(), null)
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Transcription failed'
          replaceDay((prev) =>
            prev.map((i) => (i.id === tempId ? { ...i, status: 'editing_raw', rawText: msg } : i)),
          )
        }
        stream.getTracks().forEach((t) => t.stop())
      }
      rec.start()
      setRecording(true)
      clearRecordingLimitTimer()
      recordingLimitTimerRef.current = setTimeout(() => stopRecording(), MAX_RECORDING_MS)
    } catch {
      /* mic denied */
    }
  }, [clearRecordingLimitTimer, recording, replaceDay, startParsingFlow, stopRecording])

  const handleSend = useCallback(async () => {
    const isQuickReady =
      quickScan.isOpen && quickScan.frontPreview && quickScan.nutritionPreview && quickScan.frontStatus === 'done' && quickScan.nutritionStatus === 'done'
    if (!inputText.trim() && !isQuickReady) return
    const text = inputText.trim() || '1 serving'
    const quickWasOpen = quickScan.isOpen
    const hadQuickMedia = Boolean(quickScan.frontPreview || quickScan.nutritionPreview)
    setInputText('')
    const fp = frontPromiseRef.current
    const np = nutritionPromiseRef.current
    if (quickWasOpen && hadQuickMedia) {
      setQuickScan({
        isOpen: false,
        frontPreview: null,
        nutritionPreview: null,
        frontStatus: 'idle',
        nutritionStatus: 'idle',
        frontData: null,
        nutritionData: null,
      })
      frontPromiseRef.current = null
      nutritionPromiseRef.current = null
    }
    const tempId = crypto.randomUUID()
    const logText = quickWasOpen || fp || np ? `Scanning: ${text}` : text
    replaceDay((prev) => [...prev, { id: tempId, status: 'processing_cancellable', rawText: logText, timestamp: Date.now(), name: '', amount: '' }])
    let baseFood: Record<string, unknown> | null = null
    if (fp && np) {
      try {
        const fData = (await fp) as Record<string, unknown>
        const nData = (await np) as Record<string, unknown>
        baseFood = { ...fData, ...nData }
      } catch {
        baseFood = null
      }
    }
    void startParsingFlow(tempId, logText, baseFood)
  }, [inputText, quickScan, replaceDay, startParsingFlow])

  const handleQuickFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>, kind: 'front' | 'nutrition') => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        const base64 = result.split(',')[1]
        const mime = file.type
        const payload = { mimeType: mime, base64 }
        if (kind === 'front') {
          setQuickScan((p) => ({ ...p, frontPreview: result, frontStatus: 'processing' }))
          const p = aiVisionJson({
            system: MACRO_PROMPTS.ANALYZE_FRONT,
            user: 'Analyze this image.',
            images: [payload],
            model: 'gpt-4o',
          }).then((r) => r as Record<string, unknown>)
          frontPromiseRef.current = p
          p.then((data) => setQuickScan((q) => ({ ...q, frontStatus: 'done', frontData: data }))).catch(() =>
            setQuickScan((q) => ({ ...q, frontStatus: 'error' })),
          )
        } else {
          setQuickScan((p) => ({ ...p, nutritionPreview: result, nutritionStatus: 'processing' }))
          const p = aiVisionJson({
            system: MACRO_PROMPTS.ANALYZE_NUTRITION,
            user: 'Analyze this nutrition facts panel.',
            images: [payload],
            model: 'gpt-4o',
          }).then((r) => r as Record<string, unknown>)
          nutritionPromiseRef.current = p
          p.then((data) => setQuickScan((q) => ({ ...q, nutritionStatus: 'done', nutritionData: data }))).catch(() =>
            setQuickScan((q) => ({ ...q, nutritionStatus: 'error' })),
          )
        }
      }
      reader.readAsDataURL(file)
    },
    [],
  )

  const cancelProcessing = useCallback(
    (id: string) => {
      processingRefs.current[id]?.abort()
      delete processingRefs.current[id]
      replaceDay((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'editing_raw', rawText: i.rawText || '' } : i)))
    },
    [replaceDay],
  )

  const updateItem = useCallback(
    (id: string, fields: MacroFoodEditFields) => {
      replaceDay((prev) =>
        prev.map((i) => {
          if (i.id !== id) return i
          const mult =
            typeof fields.servingMultiplier === 'number' && fields.servingMultiplier > 0
              ? fields.servingMultiplier
              : (i.servingMultiplier ?? 1)
          const servingType = fields.servingType ?? i.servingType ?? 'serving'
          let calories = fields.calories
          let protein = fields.protein
          if (i.baseCalories != null && i.baseProtein != null && fields.servingMultiplier != null) {
            const scaled = scaleFatSecretServing({ calories: i.baseCalories, protein: i.baseProtein }, mult)
            calories = scaled.calories
            protein = scaled.protein
          }
          return {
            ...i,
            emoji: fields.emoji || '🍱',
            name: fields.name,
            amount: formatServingDisplay(mult, servingType),
            servingType,
            servingMultiplier: mult,
            calories,
            protein,
            status: 'ready',
          }
        }),
      )
    },
    [replaceDay],
  )

  const updateLibraryFood = useCallback(
    (id: string, fields: MacroFoodEditFields) => {
      onSaveFoods(
        customFoodsRef.current.map((f) =>
          f.id === id
            ? {
                ...f,
                emoji: fields.emoji || '🍱',
                name: fields.name,
                baseAmount: fields.amount,
                calories: fields.calories,
                protein: fields.protein,
              }
            : f,
        ),
      )
    },
    [onSaveFoods],
  )

  const removeLibraryFood = useCallback(
    (id: string) => {
      setEditingLibraryFoodId((cur) => (cur === id ? null : cur))
      onSaveFoods(customFoodsRef.current.filter((f) => f.id !== id))
    },
    [onSaveFoods],
  )

  const logLibraryFood = useCallback(
    (libraryFoodId: string, fields: MacroFoodEditFields) => {
      if (!fields.name.trim()) return
      const servingType = fields.amount.trim() || '1 serving'
      replaceDay((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          emoji: fields.emoji || '🍱',
          name: fields.name,
          amount: formatServingDisplay(1, servingType),
          servingType,
          servingMultiplier: 1,
          baseCalories: fields.calories,
          baseProtein: fields.protein,
          calories: fields.calories,
          protein: fields.protein,
          libraryFoodId,
          status: 'ready',
          timestamp: Date.now(),
        },
      ])
      setEditingLibraryFoodId(null)
    },
    [replaceDay],
  )

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto]" data-macro-diet-page>
      <div className="macro-diet-scroll flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-y-contain">
      <StatusDashboard
        consumed={totals.cal}
        goal={goals.calorieGoal}
        proteinPct={proteinPct}
        proteinGoal={goals.proteinPctGoal}
      />

      <section className="space-y-3">
        {items.length === 0 ? (
          <div className="bg-white/5 rounded-[var(--radius-card)] border border-white/5 p-8 text-center">
            <p className="opacity-30 font-bold text-[10px] uppercase tracking-widest text-white">No entries yet</p>
          </div>
        ) : (
          [...items]
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .map((item) => (
              <FoodRow
                key={item.id}
                item={item}
                customFoods={customFoods}
                isEditing={editingItemId === item.id}
                onStartEdit={() => {
                  setEditingLibraryFoodId(null)
                  setEditingItemId(item.id)
                }}
                onEndEdit={() => setEditingItemId(null)}
                onRemove={() => removeItem(item.id)}
                onUpdate={(fields) => updateItem(item.id, fields)}
                onReestimate={() => refreshItemMacros(item)}
                onCancelProcessing={() => cancelProcessing(item.id)}
                onReprocess={(raw) => {
                  replaceDay((prev) =>
                    prev.map((i) => (i.id === item.id ? { ...i, status: 'processing_cancellable', rawText: raw } : i)),
                  )
                  void startParsingFlow(item.id, raw, null)
                }}
                onCancelTranscription={() => {
                  abortRef.current?.abort()
                  removeItem(item.id)
                }}
              />
            ))
        )}
      </section>

      <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="relative z-10 flex justify-between items-center p-4 border-b border-white/5 bg-black/20">
          <h2 className="text-sm font-black text-white tracking-widest uppercase flex items-center gap-2">
            <NotebookText size={16} className="text-emerald-400" /> Food Library
          </h2>
          <button
            type="button"
            onClick={() => setDbModalOpen(true)}
            className="relative z-10 p-2 bg-white/5 rounded-xl text-emerald-400 hover:bg-white/10"
            aria-label="Add food"
          >
            <Plus size={16} strokeWidth={2.5} />
          </button>
        </div>
        <div className="space-y-3 p-4 pb-6">
          {customFoods.length === 0 ? (
            <p className="text-center text-[10px] font-bold uppercase tracking-widest text-neutral-500 py-4">Library is empty</p>
          ) : (
            sortedCustomFoods.map((food) => (
              <LibraryFoodRow
                key={food.id}
                food={food}
                isEditing={editingLibraryFoodId === food.id}
                onStartEdit={() => {
                  setEditingItemId(null)
                  setEditingLibraryFoodId(food.id)
                }}
                onEndEdit={() => setEditingLibraryFoodId(null)}
                onSave={(fields) => {
                  updateLibraryFood(food.id, fields)
                  setEditingLibraryFoodId(null)
                }}
                onDelete={() => removeLibraryFood(food.id)}
                onLog={(fields) => logLibraryFood(food.id, fields)}
              />
            ))
          )}
        </div>
      </section>
      <div className="h-2 shrink-0" aria-hidden />
      </div>{/* end scrollable list */}

      <InteractionDock
        inputRef={inputRef}
        inputText={inputText}
        setInputText={setInputText}
        recording={recording}
        volume={volume}
        quickScan={quickScan}
        setQuickScan={setQuickScan}
        onMic={handleMicToggle}
        onSend={handleSend}
        onQuickFile={handleQuickFile}
      />

      {dbModalOpen ? (
        <AppPortal>
          <DatabaseModal
            onClose={() => setDbModalOpen(false)}
            onSave={(entry) => {
              onSaveFoods([...customFoods, { ...entry, id: crypto.randomUUID(), createdAt: Date.now() }])
              setDbModalOpen(false)
            }}
            onSaveAndLog={(entry) => {
              const food: MacroCustomFood = { ...entry, id: crypto.randomUUID(), createdAt: Date.now() }
              onSaveFoods([...customFoods, food])
              logLibraryFood(food.id, libraryFoodToEditFields(food))
              setDbModalOpen(false)
            }}
          />
        </AppPortal>
      ) : null}
    </div>
  )
}

function LibraryFoodRow({
  food,
  isEditing,
  onStartEdit,
  onEndEdit,
  onSave,
  onDelete,
  onLog,
}: {
  food: MacroCustomFood
  isEditing: boolean
  onStartEdit: () => void
  onEndEdit: () => void
  onSave: (fields: MacroFoodEditFields) => void
  onDelete: () => void
  onLog: (fields: MacroFoodEditFields) => void
}) {
  const [editData, setEditData] = useState<MacroFoodEditFields>(() => libraryFoodToEditFields(food))

  useEffect(() => {
    if (!isEditing) setEditData(libraryFoodToEditFields(food))
  }, [food, isEditing])

  if (isEditing) {
    return (
      <MacroFoodEditCard
        fieldId={`library-${food.id}`}
        toolbar="library"
        amountMode="text"
        data={editData}
        onChange={setEditData}
        onReset={() => setEditData(libraryFoodToEditFields(food))}
        onDelete={() => {
          onDelete()
          onEndEdit()
        }}
        onSave={() => {
          onSave(editData)
          onEndEdit()
        }}
        onLog={() => onLog(editData)}
        saveDisabled={!editData.name.trim()}
      />
    )
  }

  return (
    <MacroFoodViewCard
      emoji={food.emoji}
      name={food.name}
      amount={food.baseAmount || ''}
      calories={food.calories}
      protein={food.protein}
      onClick={onStartEdit}
    />
  )
}

function FoodRow({
  item,
  customFoods,
  isEditing,
  onStartEdit,
  onEndEdit,
  onRemove,
  onUpdate,
  onReestimate,
  onCancelProcessing,
  onReprocess,
  onCancelTranscription,
}: {
  item: MacroDayItem
  customFoods: MacroCustomFood[]
  isEditing: boolean
  onStartEdit: () => void
  onEndEdit: () => void
  onRemove: () => void
  onUpdate: (fields: MacroFoodEditFields) => void
  onReestimate: () => void
  onCancelProcessing: () => void
  onReprocess: (raw: string) => void
  onCancelTranscription: () => void
}) {
  const [editData, setEditData] = useState<MacroFoodEditFields>(() => itemToEditFields(item))
  const [tempRaw, setTempRaw] = useState(item.rawText || '')
  const [infoExpanded, setInfoExpanded] = useState(false)

  useEffect(() => {
    if (!isEditing) {
      setEditData(itemToEditFields(item))
      setInfoExpanded(false)
    }
    setTempRaw(item.rawText || '')
  }, [item, isEditing])

  const endEdit = () => {
    setInfoExpanded(false)
    onEndEdit()
  }

  if (item.status === 'transcribing') {
    return (
      <div className="bg-white/5 p-4 rounded-[var(--radius-card)] border border-white/5 flex items-center gap-4 animate-pulse">
        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
          <Mic className="text-emerald-500 opacity-60" size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white/50 text-sm truncate">Transcribing...</p>
        </div>
        <button type="button" onClick={onCancelTranscription} className="p-2 text-white/40 hover:text-red-400 shrink-0">
          <X size={18} strokeWidth={2.5} />
        </button>
      </div>
    )
  }

  if (item.status === 'processing_cancellable') {
    return (
      <button
        type="button"
        onClick={onCancelProcessing}
        className="bg-white/5 p-4 rounded-[var(--radius-card)] border border-emerald-500/30 w-full text-left flex items-center gap-4"
      >
        <Loader2 className="animate-spin text-emerald-500 shrink-0" size={20} />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-sm line-clamp-2">&quot;{item.rawText}&quot;</p>
          <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mt-1">Processing… Tap to edit</p>
        </div>
        <Pencil size={12} className="text-white/50 shrink-0" />
      </button>
    )
  }

  if (item.status === 'editing_raw' && !item.name?.trim()) {
    return (
      <div className="bg-white/5 p-4 rounded-[var(--radius-card)] border border-white/20 flex flex-col gap-3">
        <textarea
          value={tempRaw}
          onChange={(e) => setTempRaw(e.target.value)}
          className="w-full bg-black/50 text-white font-medium text-sm p-3 rounded-xl resize-none outline-none focus:ring-1 focus:ring-emerald-500"
          rows={2}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onRemove} className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg">
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            disabled={!tempRaw.trim()}
            onClick={() => onReprocess(tempRaw.trim())}
            className="px-4 py-2 bg-emerald-600 text-white text-xs font-black uppercase rounded-lg disabled:opacity-50"
          >
            Process
          </button>
        </div>
      </div>
    )
  }
  const handleEditChange = (fields: MacroFoodEditFields) => {
    if (
      item.baseCalories != null &&
      item.baseProtein != null &&
      fields.servingMultiplier != null &&
      fields.servingMultiplier !== editData.servingMultiplier
    ) {
      const mult = fields.servingMultiplier > 0 ? fields.servingMultiplier : 1
      const scaled = scaleFatSecretServing({ calories: item.baseCalories, protein: item.baseProtein }, mult)
      fields = { ...fields, calories: scaled.calories, protein: scaled.protein }
    }
    setEditData(fields)
  }

  if (isEditing) {
    return (
      <MacroFoodEditCard
        fieldId={item.id}
        data={editData}
        onChange={handleEditChange}
        showAudit
        infoExpanded={infoExpanded}
        onInfoToggle={() => setInfoExpanded((v) => !v)}
        audit={macroItemAuditTrail(item)}
        auditCustomFoods={customFoods}
        onReset={() => {
          endEdit()
          onReestimate()
        }}
        onDelete={() => {
          onRemove()
          endEdit()
        }}
        onSave={() => {
          onUpdate(editData)
          endEdit()
        }}
        saveDisabled={!editData.name.trim()}
      />
    )
  }

  return (
    <MacroFoodViewCard
      emoji={macroItemDisplayEmoji(item)}
      name={macroItemDisplayName(item)}
      amount={macroItemServingFields(item).amount}
      calories={item.calories || 0}
      protein={item.protein || 0}
      pending={item.status === 'pending'}
      onClick={() => item.status !== 'pending' && onStartEdit()}
    />
  )
}

function InteractionDock({
  inputRef,
  inputText,
  setInputText,
  recording,
  volume,
  quickScan,
  setQuickScan,
  onMic,
  onSend,
  onQuickFile,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement>
  inputText: string
  setInputText: (s: string) => void
  recording: boolean
  volume: number
  quickScan: QuickScanState
  setQuickScan: React.Dispatch<React.SetStateAction<QuickScanState>>
  onMic: () => void
  onSend: () => void
  onQuickFile: (e: React.ChangeEvent<HTMLInputElement>, kind: 'front' | 'nutrition') => void
}) {
  const isQuickReady =
    quickScan.isOpen && quickScan.frontPreview && quickScan.nutritionPreview && quickScan.frontStatus === 'done' && quickScan.nutritionStatus === 'done'
  /** Mic when idle; send (arrow) when there is text, quick-scan is ready, or actively recording — tap send to stop mic and transcribe. */
  const showSend = Boolean(inputText.trim() || isQuickReady || recording)

  return (
    <div className="relative z-20 shrink-0 pointer-events-none pb-[calc(var(--app-nav-offset)+0.5rem)]">
      <div
        className="pointer-events-none absolute inset-x-0 bottom-full h-6 bg-gradient-to-t from-black/80 to-transparent"
        aria-hidden
      />
      <div className="relative flex w-full flex-col gap-3 pt-2 pointer-events-auto">
        {quickScan.isOpen && (
          <div className="flex gap-3 bg-[var(--color-surface)] p-3 rounded-[var(--radius-card)] border border-[var(--color-border)] shadow-2xl">
            <label className="relative flex-1 flex flex-col items-center justify-center h-28 bg-white/5 border border-dashed border-white/10 rounded-[1.2rem] cursor-pointer overflow-hidden">
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onQuickFile(e, 'nutrition')} />
              {quickScan.nutritionPreview ? (
                <img src={quickScan.nutritionPreview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
              ) : (
                <Camera size={24} className="opacity-30 mb-2" />
              )}
              {quickScan.nutritionStatus === 'processing' && (
                <Loader2 size={24} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-400 animate-spin z-20" />
              )}
              <span className="relative z-10 text-[9px] font-black uppercase text-white text-center px-2">
                {quickScan.nutritionStatus === 'done' ? 'Nutrition OK' : '1. Nutrition'}
              </span>
            </label>
            <label className="relative flex-1 flex flex-col items-center justify-center h-28 bg-white/5 border border-dashed border-white/10 rounded-[1.2rem] cursor-pointer overflow-hidden">
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onQuickFile(e, 'front')} />
              {quickScan.frontPreview ? (
                <img src={quickScan.frontPreview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
              ) : (
                <Camera size={24} className="opacity-30 mb-2" />
              )}
              {quickScan.frontStatus === 'processing' && (
                <Loader2 size={24} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-emerald-400 animate-spin z-20" />
              )}
              <span className="relative z-10 text-[9px] font-black uppercase text-white text-center px-2">
                {quickScan.frontStatus === 'done' ? 'Front OK' : '2. Front'}
              </span>
            </label>
          </div>
        )}
        <div className="flex items-end gap-3 w-full">
          <button
            type="button"
            onClick={() =>
              setQuickScan((p) =>
                p.isOpen
                  ? { ...p, isOpen: false, frontPreview: null, nutritionPreview: null, frontStatus: 'idle', nutritionStatus: 'idle', frontData: null, nutritionData: null }
                  : { ...p, isOpen: true },
              )
            }
            className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center shadow-xl active:scale-95 ${
              quickScan.isOpen ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50' : 'bg-[var(--color-surface)] text-white hover:bg-white/10'
            }`}
          >
            <ScanText size={22} className={quickScan.isOpen ? '' : 'opacity-40'} strokeWidth={2.5} />
          </button>
          <div
            className="flex-grow bg-[var(--color-surface)] min-h-[3.5rem] rounded-[var(--radius-card)] flex flex-col justify-center px-4 relative border border-[var(--color-border)] shadow-xl cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {recording ? (
              <div className="flex items-center justify-around h-[3.5rem] w-full px-2">
                {[...Array(20)].map((_, i) => (
                  <div
                    key={i}
                    className="w-[3px] bg-white opacity-40 rounded-full"
                    style={{ height: `${Math.max(4, (volume / 255) * 44 * (0.6 + Math.random() * 0.4))}px` }}
                  />
                ))}
              </div>
            ) : (
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={quickScan.isOpen ? 'How much?' : 'What did you eat today?'}
                className="w-full bg-transparent text-white font-medium text-base resize-none placeholder:opacity-30 leading-snug outline-none py-3"
                rows={1}
              />
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (recording) onMic()
              else if (inputText.trim() || isQuickReady) onSend()
              else onMic()
            }}
            className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center shadow-xl active:scale-95 ${
              showSend ? 'bg-emerald-600 text-white' : 'bg-[var(--color-surface)] text-white hover:bg-white/10'
            }`}
          >
            {showSend ? <ArrowUp size={22} strokeWidth={3} /> : <Mic size={22} className="opacity-40" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  )
}

function AppPortal({ children }: { children: React.ReactNode }) {
  const root = typeof document !== 'undefined' ? document.getElementById('app-root') : null
  return root ? createPortal(children, root) : <>{children}</>
}

const EMPTY_FOOD_ENTRY: Omit<MacroCustomFood, 'id' | 'createdAt'> = {
  name: '',
  emoji: '🍱',
  baseAmount: '',
  calories: 0,
  protein: 0,
  fat: 0,
  carbs: 0,
}

function DatabaseModal({
  onClose,
  onSave,
  onSaveAndLog,
}: {
  onClose: () => void
  onSave: (entry: Omit<MacroCustomFood, 'id' | 'createdAt'>) => void
  onSaveAndLog: (entry: Omit<MacroCustomFood, 'id' | 'createdAt'>) => void
}) {
  const [frontImage, setFrontImage] = useState<{ data: string; mimeType: string; preview: string } | null>(null)
  const [nutritionImage, setNutritionImage] = useState<{ data: string; mimeType: string; preview: string } | null>(null)
  const [analyzingFront, setAnalyzingFront] = useState(false)
  const [analyzingNutrition, setAnalyzingNutrition] = useState(false)
  const [entry, setEntry] = useState<Omit<MacroCustomFood, 'id' | 'createdAt'>>(EMPTY_FOOD_ENTRY)

  useEffect(() => {
    if (!nutritionImage) return
    let cancelled = false
    setAnalyzingNutrition(true)
    void (async () => {
      try {
        const nutData = (await aiVisionJson({
          system: MACRO_PROMPTS.ANALYZE_NUTRITION,
          user: 'Analyze nutrition label.',
          images: [{ mimeType: nutritionImage.mimeType, base64: nutritionImage.data }],
          model: 'gpt-4o',
        })) as { baseAmount?: string; calories?: number; protein?: number; fat?: number; carbs?: number }
        if (cancelled) return
        setEntry((prev) => ({
          ...prev,
          baseAmount: nutData.baseAmount || prev.baseAmount,
          calories: nutData.calories ?? prev.calories,
          protein: nutData.protein ?? prev.protein,
          fat: nutData.fat ?? prev.fat,
          carbs: nutData.carbs ?? prev.carbs,
        }))
      } finally {
        if (!cancelled) setAnalyzingNutrition(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [nutritionImage])

  useEffect(() => {
    if (!frontImage) return
    let cancelled = false
    setAnalyzingFront(true)
    void (async () => {
      try {
        const frontData = (await aiVisionJson({
          system: MACRO_PROMPTS.ANALYZE_FRONT,
          user: 'Analyze front label.',
          images: [{ mimeType: frontImage.mimeType, base64: frontImage.data }],
          model: 'gpt-4o',
        })) as { name?: string; emoji?: string }
        if (cancelled) return
        setEntry((prev) => ({
          ...prev,
          name: frontData.name || prev.name,
          emoji: frontData.emoji || prev.emoji,
        }))
      } finally {
        if (!cancelled) setAnalyzingFront(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [frontImage])

  const buildEntry = (): Omit<MacroCustomFood, 'id' | 'createdAt'> => ({
    ...entry,
    emoji: entry.emoji || '🍱',
    fat: 0,
    carbs: 0,
  })

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: { data: string; mimeType: string; preview: string } | null) => void) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const r = new FileReader()
    r.onloadend = () => {
      const result = r.result as string
      setter({ data: result.split(',')[1], mimeType: f.type, preview: result })
    }
    r.readAsDataURL(f)
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center bg-black/90 p-4 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-md mt-6 flex justify-between items-center mb-6 shrink-0">
        <h2 className="text-xl font-black text-emerald-400 flex items-center gap-2">
          <Plus size={24} /> Add Food
        </h2>
        <button type="button" onClick={onClose} className="p-2 bg-white/5 rounded-full opacity-40 hover:opacity-100">
          <X size={20} />
        </button>
      </div>
      <div className="w-full max-w-md space-y-4 pb-10">
        <div className="grid grid-cols-2 gap-4">
          <label className="relative flex flex-col items-center justify-center h-32 bg-white/5 border-2 border-dashed border-white/10 rounded-[2rem] cursor-pointer overflow-hidden">
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e, setNutritionImage)} />
            {nutritionImage ? <img src={nutritionImage.preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" /> : <Camera size={28} className="opacity-30 mb-2" />}
            <span className="relative z-10 text-[10px] font-black uppercase text-center text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] flex items-center gap-1.5">
              Nutrition
              {analyzingNutrition && <Loader2 size={12} className="animate-spin text-emerald-400" />}
            </span>
          </label>
          <label className="relative flex flex-col items-center justify-center h-32 bg-white/5 border-2 border-dashed border-white/10 rounded-[2rem] cursor-pointer overflow-hidden">
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e, setFrontImage)} />
            {frontImage ? <img src={frontImage.preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" /> : <Camera size={28} className="opacity-30 mb-2" />}
            <span className="relative z-10 text-[10px] font-black uppercase text-center text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] flex items-center gap-1.5">
              Front
              {analyzingFront && <Loader2 size={12} className="animate-spin text-emerald-400" />}
            </span>
          </label>
        </div>
        <MacroFoodEditCard
          fieldId="library-add"
          toolbar="library-add"
          amountMode="text"
          data={{
            emoji: entry.emoji || '🍱',
            name: entry.name,
            amount: entry.baseAmount || '',
            calories: entry.calories,
            protein: entry.protein,
          }}
          onChange={(data) =>
            setEntry({
              ...entry,
              emoji: data.emoji,
              name: data.name,
              baseAmount: data.amount,
              calories: data.calories,
              protein: data.protein,
              fat: 0,
              carbs: 0,
            })
          }
          onReset={() => {}}
          onDelete={() => {}}
          onSave={() => onSave(buildEntry())}
          onLog={() => onSaveAndLog(buildEntry())}
          saveDisabled={!entry.name.trim()}
        />
      </div>
    </div>
  )
}
