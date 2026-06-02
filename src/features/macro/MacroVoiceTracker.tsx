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
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { fireConfettiFromElement } from '../../lib/confetti'
import { createPortal } from 'react-dom'
import { aiJson, aiVisionJson, fatSecretBarcodeLookup, MacroEstimateError, macroEstimateItem, transcribeAudio } from '../../core/api'
import {
  scheduleScrollContainerToTop,
  useScrollIntoViewWithin,
} from '../../lib/scrollIntoViewWithin'
import { proteinGramsFromPct } from './macroCalculator'
import type { MacroCustomFood, MacroDayItem, MacroGoals, ProteinTrackMode } from '../../types/domain'
import {
  buildDayItemServingFields,
  formatServingDisplay,
  isBarcodeFatSecretItem,
  macroEstimateFatSecretIndex,
  macroItemDisplayEmoji,
  macroItemDisplayName,
  macroItemServingFields,
  mergeMacroLogs,
  normalizeDiaryLabel,
  parsedItemsToDayItems,
  macrosForServingCount,
  parseServingDefinition,
  resolveCanonicalBaseMacros,
  scaleFatSecretServing,
  sortCustomFoodsByUsage,
  type ParsedFoodItem,
} from './macroLib'
import {
  MacroFoodEditCard,
  MacroFoodViewCard,
  applyDayMacroEditChange,
  itemToEditFields,
  libraryFoodToEditFields,
  macroItemAuditTrail,
  MACRO_FIELD_AUTOSAVE_MS,
  shouldAutosaveMacroFields,
  type MacroFoodEditFields,
} from './MacroFoodCard'
import { useDebouncedCallback } from '../../lib/useDebouncedCallback'
import { QuickScanPanel, prewarmCameraStream } from './QuickScanPanel'

type QuickScanState = {
  isOpen: boolean
  frontPreview: string | null
  nutritionPreview: string | null
  frontStatus: 'idle' | 'processing' | 'done' | 'error'
  nutritionStatus: 'idle' | 'processing' | 'done' | 'error'
  frontData: Record<string, unknown> | null
  nutritionData: Record<string, unknown> | null
  addToDatabase: boolean
}

const EMPTY_QUICK_SCAN: QuickScanState = {
  isOpen: false,
  frontPreview: null,
  nutritionPreview: null,
  frontStatus: 'idle',
  nutritionStatus: 'idle',
  frontData: null,
  nutritionData: null,
  addToDatabase: true,
}

const MAX_RECORDING_MS = 3 * 60 * 1000

/** Safari often records mp4/aac; Chrome uses webm. OpenAI needs the real container type. */
function preferredRecorderMimeType(): string {
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''
}

const MIC_WAVE_BAR_COUNT = 20
const MIC_WAVE_CALIBRATION_FRAMES = 24
const MIC_WAVE_LEVEL_MAX = 165
const MIC_WAVE_SHIFT_MS = 48

function createMicWaveHistory(): number[] {
  return Array(MIC_WAVE_BAR_COUNT).fill(0)
}

function advanceMicWaveHistory(history: number[], nextLevel: number): number[] {
  return [...history.slice(1), nextLevel]
}

type MicWaveMeter = {
  noiseFloor: number
  calibrationFrames: number
  speechPeak: number
}

function createMicWaveMeter(): MicWaveMeter {
  return { noiseFloor: 0, calibrationFrames: 0, speechPeak: 72 }
}

/** UI-only mic level for the recording waveform (not used for transcription). */
function measureMicWaveLevel(analyser: AnalyserNode, sampleRate: number, meter: MicWaveMeter): number {
  const freqBuffer = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(freqBuffer)

  const binHz = sampleRate / analyser.fftSize
  const lowBin = Math.max(1, Math.floor(140 / binHz))
  const highBin = Math.min(freqBuffer.length - 1, Math.ceil(3200 / binHz))

  let sum = 0
  let peak = 0
  for (let i = lowBin; i <= highBin; i++) {
    sum += freqBuffer[i]
    peak = Math.max(peak, freqBuffer[i])
  }
  const bandCount = Math.max(1, highBin - lowBin + 1)
  const avg = sum / bandCount
  const speechEnergy = peak * 0.15 + avg * 0.85

  if (meter.calibrationFrames < MIC_WAVE_CALIBRATION_FRAMES) {
    meter.calibrationFrames += 1
    meter.noiseFloor =
      meter.calibrationFrames === 1 ? speechEnergy : meter.noiseFloor * 0.8 + speechEnergy * 0.2
    return 0
  }

  if (speechEnergy < meter.noiseFloor * 1.15) {
    meter.noiseFloor = meter.noiseFloor * 0.994 + speechEnergy * 0.006
  }

  const gate = meter.noiseFloor * 1.5
  const voiceEnergy = Math.max(0, speechEnergy - gate)
  if (voiceEnergy <= 0) return 0

  if (voiceEnergy > meter.speechPeak) {
    meter.speechPeak = meter.speechPeak * 0.996 + voiceEnergy * 0.004
  } else {
    meter.speechPeak = Math.max(56, meter.speechPeak * 0.9992)
  }

  const normalized = Math.min(1, voiceEnergy / meter.speechPeak)
  const curved = Math.pow(normalized, 2.4)
  return Math.round(curved * MIC_WAVE_LEVEL_MAX)
}

function micWaveBarHeight(level: number): number {
  if (level < 6) return 6
  const normalized = level / MIC_WAVE_LEVEL_MAX
  return Math.max(6, Math.min(32, 6 + normalized * 26))
}

function StatusDashboard({
  consumed,
  goal,
  proteinConsumed,
  proteinGoal,
  proteinTrackMode,
  proteinCardRef,
}: {
  consumed: number
  goal: number
  proteinConsumed: number
  proteinGoal: number
  proteinTrackMode: ProteinTrackMode
  proteinCardRef: RefObject<HTMLDivElement>
}) {
  const isOver = consumed > goal
  const trackByGrams = proteinTrackMode === 'grams'
  const proteinProgress = proteinGoal > 0 ? Math.min((proteinConsumed / proteinGoal) * 100, 100) : 0

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
      <div
        ref={proteinCardRef}
        className="bg-[var(--color-surface)] p-4 rounded-[var(--radius-card)] border border-[var(--color-border)]"
      >
        <div className="flex items-center gap-2 mb-2 text-[10px] font-black opacity-40 uppercase tracking-widest text-white">
          <div className="text-blue-400 opacity-60">
            <BicepsFlexed size={12} strokeWidth={3} />
          </div>
          {trackByGrams ? 'Protein (g)' : 'Protein %'}
        </div>
        <div className="flex items-end justify-between pr-1">
          <span className="text-3xl font-black text-white leading-none">
            {trackByGrams ? `${Math.round(proteinConsumed)}g` : `${proteinConsumed}%`}
          </span>
          <span className="text-[11px] font-bold opacity-20 text-white leading-none mb-1">
            / {trackByGrams ? `${proteinGoal}g` : `${proteinGoal}%`}
          </span>
        </div>
        <div className="w-full bg-white/10 h-1 rounded-full mt-4 overflow-hidden">
          <div
            className="h-full bg-blue-500 transition-all duration-700"
            style={{ width: `${proteinProgress}%` }}
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
  const [databasePickLoadingIds, setDatabasePickLoadingIds] = useState<Set<string>>(() => new Set())

  const setDatabasePickLoading = useCallback((id: string, loading: boolean) => {
    setDatabasePickLoadingIds((prev) => {
      const next = new Set(prev)
      if (loading) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  const [inputText, setInputText] = useState('')
  const [recording, setRecording] = useState(false)
  const [waveHistory, setWaveHistory] = useState<number[]>(() => createMicWaveHistory())
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)
  const micWaveMeterRef = useRef<MicWaveMeter>(createMicWaveMeter())
  const micWaveShiftAtRef = useRef(0)
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
    addToDatabase: true,
  })
  const frontPromiseRef = useRef<Promise<unknown> | null>(null)
  const nutritionPromiseRef = useRef<Promise<unknown> | null>(null)
  const quickScanRef = useRef(quickScan)
  quickScanRef.current = quickScan
  const scanPreviewsRef = useRef<Map<string, { front: string; nutrition: string }>>(new Map())

  const [dbModalOpen, setDbModalOpen] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingLibraryFoodId, setEditingLibraryFoodId] = useState<string | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const scrollDietListToTop = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return
    scheduleScrollContainerToTop(container)
  }, [])

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
  const proteinTrackMode = goals.proteinTrackMode ?? 'percent'
  const proteinGramsGoal =
    goals.proteinGramsGoal ?? proteinGramsFromPct(goals.calorieGoal, goals.proteinPctGoal)
  const proteinCardRef = useRef<HTMLDivElement>(null)
  const prevProteinGramsRef = useRef(totals.pro)

  useEffect(() => {
    prevProteinGramsRef.current = totals.pro
  }, [dateKey])

  useEffect(() => {
    const goalGrams = proteinGramsGoal
    if (goalGrams <= 0) {
      prevProteinGramsRef.current = totals.pro
      return
    }

    const wasBelow = prevProteinGramsRef.current < goalGrams
    const nowAtOrAbove = totals.pro >= goalGrams
    if (wasBelow && nowAtOrAbove && proteinCardRef.current) {
      fireConfettiFromElement(proteinCardRef.current)
    }

    prevProteinGramsRef.current = totals.pro
  }, [totals.pro, proteinGramsGoal])

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
    const stuck = items.filter(
      (i) => i.status === 'processing_cancellable' && i.barcodeLookup && i.name?.trim(),
    )
    if (stuck.length === 0) return
    replaceDay((prev) =>
      prev.map((i) =>
        i.status === 'processing_cancellable' && i.barcodeLookup && i.name?.trim()
          ? { ...i, status: 'ready', barcodeLookup: undefined }
          : i,
      ),
    )
  }, [items, replaceDay])

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
      options?: {
        skipFatSecretFetch?: boolean
        aiFatSecretResults?: MacroDayItem['fatSecretResults']
        fatSecretSelectedIndex?: number
        skipFatSecretForAi?: boolean
        userDatabasePick?: boolean
      },
    ) => {
      estimatingIdsRef.current.add(id)
      try {
        const result = await macroEstimateItem({
          name: item.name,
          amount: item.amount,
          notes: item.notes,
          fatSecretSearch: item.fatSecretSearch,
          fatSecretResults: item.fatSecretResults,
          aiFatSecretResults: options?.aiFatSecretResults,
          fatSecretSelectedIndex: options?.fatSecretSelectedIndex,
          skipFatSecretForAi: options?.skipFatSecretForAi,
          userDatabasePick: options?.userDatabasePick,
          parseSnapshot: item.parseSnapshot,
          userInput: item.userInput ?? item.rawText,
          skipFatSecretFetch: options?.skipFatSecretFetch ?? Boolean(options?.aiFatSecretResults?.length),
          customFoods: customFoodsRef.current,
          extraCtx,
        })
        replaceDay((prev) =>
          prev.map((i) => {
            if (i.id !== id) return i
            const libraryFood = result.libraryFoodId
              ? customFoodsRef.current.find((f) => f.id === result.libraryFoodId)
              : undefined
            return {
              ...i,
              ...(libraryFood
                ? normalizeDiaryLabel({
                    name: libraryFood.name,
                    emoji: libraryFood.emoji,
                    fallbackName: libraryFood.name,
                    fallbackEmoji: libraryFood.emoji,
                  })
                : {}),
              calories: result.calories,
              protein: result.protein,
              libraryFoodId: result.libraryFoodId,
              servingType: result.servingType,
              servingSize: result.servingSize,
              servingUnit: result.servingUnit,
              servingMultiplier: result.servingMultiplier,
              baseCalories: result.baseCalories,
              baseProtein: result.baseProtein,
              amount:
                result.servingType != null
                  ? formatServingDisplay(result.servingMultiplier ?? 1, result.servingType)
                  : i.amount,
              fatSecretResults: result.fatSecretResults,
              macroEstimateSnapshot: result.macroEstimateSnapshot ?? i.macroEstimateSnapshot,
              status: 'ready',
            }
          }),
        )
      } catch (e) {
        console.error('[macro] database match re-estimate failed', e)
        const fs = e instanceof MacroEstimateError ? e.fatSecretResults : undefined
        replaceDay((prev) =>
          prev.map((i) => {
            if (i.id !== id) return i
            if (i.name?.trim()) {
              return {
                ...i,
                status: 'pending' as const,
                ...(fs?.length ? { fatSecretResults: fs } : {}),
              }
            }
            return {
              ...i,
              status: 'editing_raw' as const,
              rawText: [item.name, item.amount].filter(Boolean).join(' '),
              ...(fs?.length ? { fatSecretResults: fs } : {}),
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
    (
      item: MacroDayItem,
      extraCtx = '',
      options?: {
        skipFatSecretFetch?: boolean
        aiFatSecretResults?: MacroDayItem['fatSecretResults']
        fatSecretSelectedIndex?: number
        skipFatSecretForAi?: boolean
        userDatabasePick?: boolean
      },
    ) => {
      if (estimatingIdsRef.current.has(item.id)) return
      const day = logsRef.current[dateKey] || []
      const latest = day.find((i) => i.id === item.id) ?? item
      void calculateMacros(latest.id, latest, extraCtx, options)
    },
    [calculateMacros, dateKey],
  )

  const reestimateWithDatabaseMatch = useCallback(
    (item: MacroDayItem, foodIndex: number | null) => {
      const foods = item.fatSecretResults
      if (!foods?.length) return
      if (estimatingIdsRef.current.has(item.id)) return
      const currentFs = macroEstimateFatSecretIndex(item.macroEstimateSnapshot)
      if (foodIndex === null && currentFs === null) return
      if (foodIndex !== null && currentFs === foodIndex) return
      if (foodIndex !== null && (foodIndex < 1 || foodIndex > foods.length)) return

      const nextSnapshot =
        foodIndex === null
          ? { libraryIndex: null, fatSecretIndex: null }
          : { libraryIndex: null, fatSecretIndex: foodIndex }

      const estimateItem: MacroDayItem = {
        ...item,
        macroEstimateSnapshot: nextSnapshot,
      }

      replaceDay((prev) => prev.map((i) => (i.id === item.id ? estimateItem : i)))

      void (async () => {
        setDatabasePickLoading(item.id, true)
        try {
          if (foodIndex === null) {
            await calculateMacros(estimateItem.id, estimateItem, '', {
              skipFatSecretFetch: true,
              skipFatSecretForAi: true,
              userDatabasePick: true,
            })
            return
          }
          await calculateMacros(estimateItem.id, estimateItem, '', {
            aiFatSecretResults: [foods[foodIndex - 1]!],
            fatSecretSelectedIndex: foodIndex,
            userDatabasePick: true,
          })
        } finally {
          setDatabasePickLoading(item.id, false)
        }
      })()
    },
    [calculateMacros, replaceDay, setDatabasePickLoading],
  )

  const startParsingFlow = useCallback(
    async (id: string, rawText: string, baseFood?: Record<string, unknown> | null, addToDatabase = false) => {
      const controller = new AbortController()
      processingRefs.current[id] = controller
      try {
        let promptInput = `Input: ${rawText}`
        if (baseFood && baseFood.name) {
          promptInput += `\n\nContext: The user scanned "${String(baseFood.name)}".`
          const nf = await aiJson({
            promptKey: 'PARSER',
            user: promptInput,
          }).catch(() => null)
          if (!nf || typeof nf !== 'object') throw new Error('parse')
          const data = nf as { items?: ParsedFoodItem[] }
          if (addToDatabase) {
            const scanLabel = normalizeDiaryLabel({
              name: baseFood.name,
              emoji: baseFood.emoji,
              fallbackName: String(baseFood.name || 'Food'),
            })
            const libItem: MacroCustomFood = {
              id: crypto.randomUUID(),
              name: scanLabel.name,
              emoji: scanLabel.emoji,
              baseAmount: String(baseFood.baseAmount || '1 serving'),
              calories: Number(baseFood.calories) || 0,
              protein: Number(baseFood.protein) || 0,
              fat: Number(baseFood.fat) || 0,
              carbs: Number(baseFood.carbs) || 0,
              createdAt: Date.now(),
            }
            onSaveFoods([...customFoodsRef.current, libItem])
          }
          replaceDay((prev) => prev.filter((i) => i.id !== id))
          if (data.items?.length) {
            const newItems = parsedItemsToDayItems(data.items, { userInput: rawText })
            replaceDay((prev) => [...prev.filter((i) => i.id !== id), ...newItems])
            scrollDietListToTop()
            newItems.forEach((it) =>
              void estimateMacrosForItem(it, `\n\nScanned base: ${JSON.stringify(baseFood)}`),
            )
          }
          return
        }
        const parsed = await aiJson({
          promptKey: 'PARSER',
          user: promptInput,
        })
        const data = parsed as { items?: ParsedFoodItem[] }
        replaceDay((prev) => prev.filter((i) => i.id !== id))
        if (data.items?.length) {
          const newItems = parsedItemsToDayItems(data.items, { userInput: rawText })
          replaceDay((prev) => [...prev.filter((i) => i.id !== id), ...newItems])
          scrollDietListToTop()
          newItems.forEach((it) => void estimateMacrosForItem(it))
        }
      } catch {
        replaceDay((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'editing_raw', rawText } : i)))
      } finally {
        delete processingRefs.current[id]
      }
    },
    [estimateMacrosForItem, onSaveFoods, replaceDay, scrollDietListToTop],
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
                fatSecretResults: undefined,
                macroEstimateSnapshot: undefined,
              }
            : i,
        ),
      )
      const day = logsRef.current[dateKey] || []
      const latest = day.find((i) => i.id === item.id) ?? item
      void calculateMacros(latest.id, latest, '', { skipFatSecretFetch: false })
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

  const handleMicToggle = useCallback(async () => {
    if (recording) {
      stopRecording()
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx
      micWaveMeterRef.current = createMicWaveMeter()
      micWaveShiftAtRef.current = 0
      setWaveHistory(createMicWaveHistory())

      const source = audioCtx.createMediaStreamSource(stream)
      const highpass = audioCtx.createBiquadFilter()
      highpass.type = 'highpass'
      highpass.frequency.value = 140
      highpass.Q.value = 0.75
      const lowpass = audioCtx.createBiquadFilter()
      lowpass.type = 'lowpass'
      lowpass.frequency.value = 3200
      lowpass.Q.value = 0.75

      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.68
      source.connect(highpass)
      highpass.connect(lowpass)
      lowpass.connect(analyser)

      const tick = () => {
        const now = performance.now()
        const level = measureMicWaveLevel(analyser, audioCtx.sampleRate, micWaveMeterRef.current)
        if (now - micWaveShiftAtRef.current >= MIC_WAVE_SHIFT_MS) {
          micWaveShiftAtRef.current = now
          setWaveHistory((prev) => advanceMicWaveHistory(prev, level))
        }
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
        setWaveHistory(createMicWaveHistory())
        await audioCtx.close()
        if (audioChunksRef.current.length === 0) return
        const mime = rec.mimeType || recorderMime || 'audio/webm'
        const ext = mime.includes('mp4') || mime.includes('aac') ? 'm4a' : 'webm'
        const blob = new Blob(audioChunksRef.current, { type: mime })
        const file = new File([blob], `audio.${ext}`, { type: mime })
        abortRef.current = new AbortController()
        try {
          const text = await transcribeAudio(file)
          const tempId = crypto.randomUUID()
          replaceDay((prev) => [
            ...prev,
            {
              id: tempId,
              status: 'processing_cancellable',
              rawText: text.trim(),
              timestamp: Date.now(),
              name: '',
              amount: '',
            },
          ])
          scrollDietListToTop()
          void startParsingFlow(tempId, text.trim(), null)
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Transcription failed'
          if (msg.startsWith('No speech detected')) return
          const tempId = crypto.randomUUID()
          replaceDay((prev) => [
            ...prev,
            { id: tempId, status: 'editing_raw', rawText: msg, timestamp: Date.now(), name: '', amount: '' },
          ])
          scrollDietListToTop()
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
  }, [clearRecordingLimitTimer, recording, replaceDay, scrollDietListToTop, startParsingFlow, stopRecording])

  const handleSend = useCallback(async () => {
    const isQuickReady = quickScan.isOpen && quickScan.frontPreview && quickScan.nutritionPreview
    if (!inputText.trim() && !isQuickReady) return
    const text = inputText.trim() || '1 serving'
    const quickWasOpen = quickScan.isOpen
    const hadQuickMedia = Boolean(quickScan.frontPreview || quickScan.nutritionPreview)
    const addToDatabase = quickScan.addToDatabase
    const capturedFrontPreview = quickScan.frontPreview
    const capturedNutritionPreview = quickScan.nutritionPreview
    setInputText('')
    const fp = frontPromiseRef.current
    const np = nutritionPromiseRef.current
    if (quickWasOpen && hadQuickMedia) {
      setQuickScan({
        ...EMPTY_QUICK_SCAN,
        addToDatabase,
      })
      frontPromiseRef.current = null
      nutritionPromiseRef.current = null
    }
    const tempId = crypto.randomUUID()
    if (capturedFrontPreview && capturedNutritionPreview) {
      scanPreviewsRef.current.set(tempId, { front: capturedFrontPreview, nutrition: capturedNutritionPreview })
    }
    const logText = quickWasOpen || fp || np ? `Scanning: ${text}` : text
    replaceDay((prev) => [...prev, { id: tempId, status: 'processing_cancellable', rawText: logText, timestamp: Date.now(), name: '', amount: '' }])
    scrollDietListToTop()
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
    void startParsingFlow(tempId, logText, baseFood, addToDatabase)
  }, [inputText, quickScan, replaceDay, scrollDietListToTop, startParsingFlow])

  const handleQuickCapture = useCallback((kind: 'front' | 'nutrition', dataUrl: string) => {
    const base64 = dataUrl.split(',')[1]
    const payload = { mimeType: 'image/jpeg', base64 }
    if (kind === 'front') {
      setQuickScan((p) => ({ ...p, frontPreview: dataUrl, frontStatus: 'processing' }))
      const p = aiVisionJson({
        promptKey: 'ANALYZE_FRONT',
        user: 'Analyze this image.',
        images: [payload],
        model: 'gpt-4o',
      }).then((r) => r as Record<string, unknown>)
      frontPromiseRef.current = p
      p.then((data) => setQuickScan((q) => ({ ...q, frontStatus: 'done', frontData: data }))).catch(() =>
        setQuickScan((q) => ({ ...q, frontStatus: 'error' })),
      )
    } else {
      setQuickScan((p) => ({ ...p, nutritionPreview: dataUrl, nutritionStatus: 'processing' }))
      const p = aiVisionJson({
        promptKey: 'ANALYZE_NUTRITION',
        user: 'Analyze this nutrition facts panel.',
        images: [payload],
        model: 'gpt-4o',
      }).then((r) => r as Record<string, unknown>)
      nutritionPromiseRef.current = p
      p.then((data) => setQuickScan((q) => ({ ...q, nutritionStatus: 'done', nutritionData: data }))).catch(() =>
        setQuickScan((q) => ({ ...q, nutritionStatus: 'error' })),
      )
    }
  }, [])

  const handleClearQuickCapture = useCallback((kind: 'front' | 'nutrition') => {
    if (kind === 'front') {
      frontPromiseRef.current = null
      setQuickScan((p) => ({ ...p, frontPreview: null, frontStatus: 'idle', frontData: null }))
    } else {
      nutritionPromiseRef.current = null
      setQuickScan((p) => ({ ...p, nutritionPreview: null, nutritionStatus: 'idle', nutritionData: null }))
    }
  }, [])

  const handleBarcodeDetected = useCallback(
    (rawBarcode: string) => {
      const amount = inputText.trim() || '1 serving'
      const addToDatabase = quickScanRef.current.addToDatabase
      setInputText('')
      setQuickScan({ ...EMPTY_QUICK_SCAN, addToDatabase })
      frontPromiseRef.current = null
      nutritionPromiseRef.current = null

      const tempId = crypto.randomUUID()
      const controller = new AbortController()
      processingRefs.current[tempId] = controller

      replaceDay((prev) => [
        ...prev,
        {
          id: tempId,
          status: 'processing_cancellable',
          barcodeLookup: true,
          name: '',
          amount,
          rawText: '',
          timestamp: Date.now(),
        },
      ])
      scrollDietListToTop()

      void (async () => {
        try {
          const { food, name: barcodeName, emoji: barcodeEmoji } = await fatSecretBarcodeLookup(rawBarcode)
          if (controller.signal.aborted) return

          const defaultServing = food.servings.find((s) => s.isDefault) ?? food.servings[0]
          if (!defaultServing) throw new Error('Product not found')

          const servingIndex = food.servings.indexOf(defaultServing) + 1
          const mult = 1
          const scaled = scaleFatSecretServing(defaultServing, mult)
          const def = parseServingDefinition(defaultServing.description)
          const fatSecretName = food.brandName ? `${food.brandName} ${food.name}`.trim() : food.name
          const barcodeLabel = normalizeDiaryLabel({
            name: barcodeName,
            emoji: barcodeEmoji,
            fallbackName: fatSecretName,
          })
          const displayName = barcodeLabel.name
          const emoji = barcodeLabel.emoji

          let libraryFoodId: string | undefined
          if (addToDatabase) {
            const libItem: MacroCustomFood = {
              id: crypto.randomUUID(),
              name: displayName,
              emoji,
              baseAmount: defaultServing.description,
              calories: defaultServing.calories,
              protein: defaultServing.protein,
              fat: 0,
              carbs: 0,
              createdAt: Date.now(),
            }
            onSaveFoods([...customFoodsRef.current, libItem])
            libraryFoodId = libItem.id
          }

          replaceDay((prev) =>
            prev.map((i) =>
              i.id !== tempId
                ? i
                : {
                    id: tempId,
                    status: 'ready',
                    name: displayName,
                    emoji,
                    amount,
                    calories: scaled.calories,
                    protein: scaled.protein,
                    servingType: def.label,
                    servingSize: def.servingSize,
                    servingUnit: def.servingUnit,
                    servingMultiplier: mult,
                    baseCalories: defaultServing.calories,
                    baseProtein: defaultServing.protein,
                    fatSecretResults: [food],
                    fromBarcode: true,
                    macroEstimateSnapshot: {
                      fatSecretIndex: 1,
                      servingIndex,
                      multiplier: mult,
                    },
                    libraryFoodId,
                    timestamp: Date.now(),
                  },
            ),
          )
        } catch (e) {
          if (controller.signal.aborted) return
          const msg = e instanceof Error ? e.message : 'Barcode lookup failed'
          const notFound = /product not found|\berror 211\b|\b211:/i.test(msg)
          replaceDay((prev) =>
            prev.map((i) =>
              i.id !== tempId
                ? i
                : {
                    ...i,
                    status: 'editing_raw',
                    barcodeLookup: undefined,
                    rawText: notFound ? 'Product not found' : msg,
                    name: '',
                  },
            ),
          )
        } finally {
          delete processingRefs.current[tempId]
        }
      })()
    },
    [inputText, onSaveFoods, replaceDay, scrollDietListToTop],
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
          const serving = buildDayItemServingFields(mult, {
            servingType: fields.servingType ?? i.servingType,
            servingSize: fields.servingSize ?? i.servingSize,
            servingUnit: fields.servingUnit ?? i.servingUnit,
          })
          const prevMult = i.servingMultiplier ?? 1
          const servingChanged = mult !== prevMult
          let calories = fields.calories
          let protein = fields.protein
          const canonical = resolveCanonicalBaseMacros(i, customFoodsRef.current)
          let baseCalories = canonical?.baseCalories ?? i.baseCalories
          let baseProtein = canonical?.baseProtein ?? i.baseProtein
          if (baseCalories != null && baseProtein != null) {
            if (servingChanged) {
              const synced = macrosForServingCount(baseCalories, baseProtein, mult)
              calories = synced.calories
              protein = synced.protein
            } else {
              baseCalories = mult > 0 ? Math.round(fields.calories / mult) : fields.calories
              baseProtein = mult > 0 ? Math.round((fields.protein / mult) * 10) / 10 : fields.protein
            }
          }
          return {
            ...i,
            emoji: fields.emoji || '🍱',
            name: fields.name,
            ...serving,
            calories,
            protein,
            baseCalories,
            baseProtein,
            status: 'ready',
          }
        }),
      )
    },
    [replaceDay],
  )

  const updateLibraryFood = useCallback(
    (id: string, fields: MacroFoodEditFields) => {
      const label = normalizeDiaryLabel({
        name: fields.name,
        emoji: fields.emoji,
        fallbackName: fields.name,
        fallbackEmoji: fields.emoji,
      })
      onSaveFoods(
        customFoodsRef.current.map((f) =>
          f.id === id
            ? {
                ...f,
                emoji: label.emoji,
                name: label.name,
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
      const baseLabel = fields.amount.trim() || '1 serving'
      const mult =
        typeof fields.servingMultiplier === 'number' && fields.servingMultiplier > 0 ? fields.servingMultiplier : 1
      const scaled = scaleFatSecretServing({ calories: fields.calories, protein: fields.protein }, mult)
      const serving = buildDayItemServingFields(mult, { servingType: baseLabel })
      replaceDay((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          emoji: fields.emoji || '🍱',
          name: fields.name,
          ...serving,
          baseCalories: fields.calories,
          baseProtein: fields.protein,
          calories: scaled.calories,
          protein: scaled.protein,
          libraryFoodId,
          status: 'ready',
          timestamp: Date.now(),
        },
      ])
      setEditingLibraryFoodId(null)
      scrollDietListToTop()
    },
    [replaceDay, scrollDietListToTop],
  )

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_auto]" data-macro-diet-page>
      <div ref={scrollContainerRef} className="macro-diet-scroll flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-y-contain">
      <StatusDashboard
        consumed={totals.cal}
        goal={goals.calorieGoal}
        proteinConsumed={proteinTrackMode === 'grams' ? totals.pro : proteinPct}
        proteinGoal={proteinTrackMode === 'grams' ? proteinGramsGoal : goals.proteinPctGoal}
        proteinTrackMode={proteinTrackMode}
        proteinCardRef={proteinCardRef}
      />

      <section className="space-y-3">
        {items.length === 0 ? (
          <div className="bg-white/5 rounded-[var(--radius-card)] border border-white/5 p-8 text-center">
            <p className="opacity-30 font-bold text-[10px] uppercase tracking-widest text-white">No entries yet</p>
          </div>
        ) : (
          [...items].reverse().map((item) => (
              <FoodRow
                key={item.id}
                item={item}
                customFoods={customFoods}
                scrollContainerRef={scrollContainerRef}
                isEditing={editingItemId === item.id}
                onStartEdit={() => {
                  setEditingLibraryFoodId(null)
                  setEditingItemId(item.id)
                }}
                onEndEdit={() => setEditingItemId(null)}
                onRemove={() => removeItem(item.id)}
                onUpdate={(fields) => updateItem(item.id, fields)}
                onReestimate={() => refreshItemMacros(item)}
                onSelectFatSecret={(foodIndex) => {
                  const latest = logsRef.current[dateKey]?.find((i) => i.id === item.id) ?? item
                  reestimateWithDatabaseMatch(latest, foodIndex)
                }}
                databasePickLoading={databasePickLoadingIds.has(item.id)}
                scanPreviews={scanPreviewsRef.current.get(item.id)}
                onCancelProcessing={() => {
                  scanPreviewsRef.current.delete(item.id)
                  cancelProcessing(item.id)
                }}
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

      <section>
        <div className="macro-diet-library-header">
          <div className="macro-diet-library-header-card flex justify-between items-center p-4">
            <h2 className="text-sm font-black text-white tracking-widest uppercase flex items-center gap-2">
              <NotebookText size={16} className="text-emerald-400" /> Food Library
            </h2>
            <button
              type="button"
              onClick={() => setDbModalOpen(true)}
              className="p-2 bg-white/5 rounded-xl text-emerald-400 hover:bg-white/10"
              aria-label="Add food"
            >
              <Plus size={16} strokeWidth={2.5} />
            </button>
          </div>
          <div className="macro-diet-library-bridge" aria-hidden />
        </div>
        <div className="macro-diet-library-body">
          <div className="space-y-3 p-4 pb-6">
          {customFoods.length === 0 ? (
            <p className="text-center text-[10px] font-bold uppercase tracking-widest text-neutral-500 py-4">Library is empty</p>
          ) : (
            sortedCustomFoods.map((food) => (
              <LibraryFoodRow
                key={food.id}
                food={food}
                scrollContainerRef={scrollContainerRef}
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
        </div>
      </section>
      <div className="h-2 shrink-0" aria-hidden />
      </div>{/* end scrollable list */}

      <InteractionDock
        inputRef={inputRef}
        inputText={inputText}
        setInputText={setInputText}
        recording={recording}
        waveHistory={waveHistory}
        quickScan={quickScan}
        setQuickScan={setQuickScan}
        onMic={handleMicToggle}
        onSend={handleSend}
        onQuickCapture={handleQuickCapture}
        onClearQuickCapture={handleClearQuickCapture}
        onBarcodeDetected={handleBarcodeDetected}
      />

      {dbModalOpen ? (
        <AppPortal>
          <DatabaseModal
            onClose={() => setDbModalOpen(false)}
            onSave={(entry) => {
              onSaveFoods([...customFoods, { ...entry, id: crypto.randomUUID(), createdAt: Date.now() }])
              setDbModalOpen(false)
              scrollDietListToTop()
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
  scrollContainerRef,
  isEditing,
  onStartEdit,
  onEndEdit,
  onSave,
  onDelete,
  onLog,
}: {
  food: MacroCustomFood
  scrollContainerRef: RefObject<HTMLDivElement | null>
  isEditing: boolean
  onStartEdit: () => void
  onEndEdit: () => void
  onSave: (fields: MacroFoodEditFields) => void
  onDelete: () => void
  onLog: (fields: MacroFoodEditFields) => void
}) {
  const [editData, setEditData] = useState<MacroFoodEditFields>(() => libraryFoodToEditFields(food))
  const editDataRef = useRef(editData)
  const cardRef = useRef<HTMLDivElement>(null)
  const { run: scheduleMacroAutosave, cancel: cancelMacroAutosave } = useDebouncedCallback(
    (fields: MacroFoodEditFields) => onSave(fields),
    MACRO_FIELD_AUTOSAVE_MS,
  )

  useScrollIntoViewWithin(isEditing, cardRef, scrollContainerRef)

  useEffect(() => {
    if (!isEditing) {
      cancelMacroAutosave()
      const fields = libraryFoodToEditFields(food)
      editDataRef.current = fields
      setEditData(fields)
    }
  }, [food, isEditing, cancelMacroAutosave])

  useEffect(() => {
    if (!isEditing) return
    const fields = libraryFoodToEditFields(food)
    editDataRef.current = fields
    setEditData(fields)
  }, [isEditing, food.id])

  const handleEditChange = (fields: MacroFoodEditFields) => {
    const macroChanged = shouldAutosaveMacroFields(editDataRef.current, fields, 'library')
    editDataRef.current = fields
    setEditData(fields)
    if (macroChanged) scheduleMacroAutosave(fields)
  }

  if (isEditing) {
    return (
      <div ref={cardRef}>
        <MacroFoodEditCard
        fieldId={`library-${food.id}`}
        toolbar="library"
        data={editData}
        onChange={handleEditChange}
        onReset={() => {
          const fields = libraryFoodToEditFields(food)
          editDataRef.current = fields
          setEditData(fields)
        }}
        onDelete={() => {
          onDelete()
          onEndEdit()
        }}
        onSave={() => {
          cancelMacroAutosave()
          onSave(editDataRef.current)
          onEndEdit()
        }}
        onLog={() => onLog(editDataRef.current)}
        saveDisabled={!editData.name.trim()}
      />
      </div>
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
  scrollContainerRef,
  isEditing,
  onStartEdit,
  onEndEdit,
  onRemove,
  onUpdate,
  onReestimate,
  onSelectFatSecret,
  databasePickLoading = false,
  scanPreviews,
  onCancelProcessing,
  onReprocess,
  onCancelTranscription,
}: {
  item: MacroDayItem
  customFoods: MacroCustomFood[]
  scrollContainerRef: RefObject<HTMLDivElement | null>
  isEditing: boolean
  onStartEdit: () => void
  onEndEdit: () => void
  onRemove: () => void
  onUpdate: (fields: MacroFoodEditFields) => void
  onReestimate: () => void
  onSelectFatSecret: (foodIndex: number | null) => void
  databasePickLoading?: boolean
  scanPreviews?: { front: string; nutrition: string }
  onCancelProcessing: () => void
  onReprocess: (raw: string) => void
  onCancelTranscription: () => void
}) {
  const [editData, setEditData] = useState<MacroFoodEditFields>(() => itemToEditFields(item, customFoods))
  const editDataRef = useRef(editData)
  const [tempRaw, setTempRaw] = useState(item.rawText || '')
  const [infoExpanded, setInfoExpanded] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const { run: scheduleMacroAutosave, cancel: cancelMacroAutosave } = useDebouncedCallback(
    (fields: MacroFoodEditFields) => onUpdate(fields),
    MACRO_FIELD_AUTOSAVE_MS,
  )

  useScrollIntoViewWithin(isEditing, cardRef, scrollContainerRef, [infoExpanded])

  useEffect(() => {
    if (!isEditing) {
      cancelMacroAutosave()
      const fields = itemToEditFields(item, customFoods)
      editDataRef.current = fields
      setEditData(fields)
      setInfoExpanded(false)
    }
    setTempRaw(item.rawText || '')
  }, [item, isEditing, cancelMacroAutosave, customFoods])

  useEffect(() => {
    if (!isEditing) return
    const fields = itemToEditFields(item, customFoods)
    editDataRef.current = fields
    setEditData(fields)
  }, [isEditing, item.id, customFoods])

  const wasPendingRef = useRef(item.status === 'pending')
  const wasDatabasePickRef = useRef(databasePickLoading)
  useEffect(() => {
    if (!isEditing) {
      wasPendingRef.current = item.status === 'pending'
      wasDatabasePickRef.current = databasePickLoading
      return
    }
    const wasPending = wasPendingRef.current
    wasPendingRef.current = item.status === 'pending'
    const wasDatabasePick = wasDatabasePickRef.current
    wasDatabasePickRef.current = databasePickLoading
    if ((wasPending && item.status === 'ready') || (wasDatabasePick && !databasePickLoading)) {
      const fields = itemToEditFields(item, customFoods)
      editDataRef.current = fields
      setEditData(fields)
    }
  }, [
    isEditing,
    databasePickLoading,
    customFoods,
    item.status,
    item.calories,
    item.protein,
    item.servingType,
    item.servingSize,
    item.servingUnit,
    item.servingMultiplier,
    item.amount,
    item.macroEstimateSnapshot,
  ])

  useEffect(() => {
    if (databasePickLoading) cancelMacroAutosave()
  }, [databasePickLoading, cancelMacroAutosave])

  const endEdit = () => {
    setInfoExpanded(false)
    onEndEdit()
  }

  if (item.status === 'transcribing') {
    return (
      <div className="bg-white/5 p-4 rounded-[var(--radius-card)] border border-white/5 flex items-center gap-4 animate-pulse">
        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0 opacity-60">
          <Mic className="text-emerald-500" size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white/50 text-sm truncate">Transcribing...</p>
        </div>
        <button type="button" onClick={onCancelTranscription} className="p-2 text-white opacity-40 hover:opacity-100 hover:text-red-400 shrink-0 transition-opacity">
          <X size={18} strokeWidth={2.5} />
        </button>
      </div>
    )
  }

  if (item.status === 'processing_cancellable') {
    const isBarcode = Boolean(item.barcodeLookup)
    const barcodeComplete = isBarcode && Boolean(item.name?.trim())
    if (!barcodeComplete) {
      return (
        <button
          type="button"
          onClick={onCancelProcessing}
          className="bg-white/5 p-4 rounded-[var(--radius-card)] border border-emerald-500/30 w-full text-left flex items-center gap-4"
        >
          {scanPreviews ? (
            <div className="flex gap-1.5 shrink-0">
              <img src={scanPreviews.front} alt="" className="w-12 h-12 rounded-xl object-cover opacity-80" />
              <img src={scanPreviews.nutrition} alt="" className="w-12 h-12 rounded-xl object-cover opacity-80" />
            </div>
          ) : (
            <Loader2 className="animate-spin text-emerald-500 shrink-0" size={20} />
          )}
          <div className="flex-1 min-w-0">
            {isBarcode ? (
              <>
                <p className="font-bold text-white text-sm">Looking up product…</p>
                <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mt-1">
                  Tap to cancel
                </p>
              </>
            ) : (
              <>
                <p className="font-bold text-white text-sm line-clamp-2">&quot;{item.rawText}&quot;</p>
                <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mt-1">
                  {scanPreviews ? (
                    <span className="flex items-center gap-1">
                      <Loader2 className="animate-spin inline-block" size={9} />
                      Analyzing… Tap to edit
                    </span>
                  ) : (
                    'Processing… Tap to edit'
                  )}
                </p>
              </>
            )}
          </div>
          <span className="text-white opacity-50 shrink-0">
            <Pencil size={12} />
          </span>
        </button>
      )
    }
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
    const next = applyDayMacroEditChange(item, editDataRef.current, fields, customFoods)
    const macroChanged = shouldAutosaveMacroFields(editDataRef.current, next, 'day')
    editDataRef.current = next
    setEditData(next)
    if (macroChanged) scheduleMacroAutosave(next)
  }

  if (isEditing) {
    return (
      <div ref={cardRef}>
        <MacroFoodEditCard
          fieldId={item.id}
          toolbar="day"
          data={editData}
          onChange={handleEditChange}
          showAudit
          infoExpanded={infoExpanded}
          onInfoToggle={() => setInfoExpanded((v) => !v)}
          audit={macroItemAuditTrail(item)}
          auditCustomFoods={customFoods}
          fatSecretResults={item.fatSecretResults}
          selectedFatSecretIndex={macroEstimateFatSecretIndex(item.macroEstimateSnapshot)}
          fatSecretSelecting={databasePickLoading}
          onSelectFatSecret={isBarcodeFatSecretItem(item) ? undefined : onSelectFatSecret}
          scrollContainerRef={scrollContainerRef}
          onReset={() => {
            endEdit()
            onReestimate()
          }}
          onDelete={() => {
            onRemove()
            endEdit()
          }}
          onSave={() => {
            cancelMacroAutosave()
            onUpdate(editDataRef.current)
            endEdit()
          }}
          saveDisabled={!editData.name.trim()}
        />
      </div>
    )
  }

  return (
    <MacroFoodViewCard
      emoji={macroItemDisplayEmoji(item, customFoods)}
      name={macroItemDisplayName(item, customFoods)}
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
  waveHistory,
  quickScan,
  setQuickScan,
  onMic,
  onSend,
  onQuickCapture,
  onClearQuickCapture,
  onBarcodeDetected,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement>
  inputText: string
  setInputText: (s: string) => void
  recording: boolean
  waveHistory: number[]
  quickScan: QuickScanState
  setQuickScan: React.Dispatch<React.SetStateAction<QuickScanState>>
  onMic: () => void
  onSend: () => void
  onQuickCapture: (kind: 'front' | 'nutrition', dataUrl: string) => void
  onClearQuickCapture: (kind: 'front' | 'nutrition') => void
  onBarcodeDetected: (barcode: string) => void
}) {
  const isQuickReady = quickScan.isOpen && quickScan.frontPreview && quickScan.nutritionPreview
  /** Mic when idle; send (arrow) when there is text, quick-scan is ready, or actively recording — tap send to stop mic and transcribe. */
  const showSend = Boolean(inputText.trim() || isQuickReady || recording)

  return (
    <div
      data-macro-diet-dock
      className="relative z-20 shrink-0 pointer-events-none pb-[calc(var(--app-nav-offset)+0.5rem)]"
    >
      <div
        data-macro-diet-gradient
        className="pointer-events-none absolute inset-x-0 bottom-full h-6 bg-gradient-to-t from-black/80 to-transparent"
        aria-hidden
      />
      <div className="relative flex w-full flex-col gap-3 pt-2 pointer-events-auto">
        {quickScan.isOpen && (
          <QuickScanPanel
            addToDatabase={quickScan.addToDatabase}
            frontPreview={quickScan.frontPreview}
            nutritionPreview={quickScan.nutritionPreview}
            frontStatus={quickScan.frontStatus}
            nutritionStatus={quickScan.nutritionStatus}
            onToggleLibrary={() => setQuickScan((p) => ({ ...p, addToDatabase: !p.addToDatabase }))}
            onCapture={onQuickCapture}
            onClearCapture={onClearQuickCapture}
            onBarcodeDetected={onBarcodeDetected}
          />
        )}
        <div className="flex items-end gap-3 w-full">
          <button
            type="button"
            onPointerDown={() => {
              if (!quickScan.isOpen) prewarmCameraStream()
            }}
            onClick={() =>
              setQuickScan((p) =>
                p.isOpen
                  ? { ...EMPTY_QUICK_SCAN, addToDatabase: p.addToDatabase }
                  : { ...p, isOpen: true },
              )
            }
            className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center shadow-xl active:scale-95 transition-opacity ${
              quickScan.isOpen
                ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/50'
                : 'bg-[var(--color-surface)] text-white opacity-40 hover:opacity-100 hover:bg-white/10'
            }`}
          >
            <ScanText size={22} strokeWidth={2.5} />
          </button>
          <div
            className="flex-grow bg-[var(--color-surface)] min-h-[3.5rem] rounded-[var(--radius-card)] flex flex-col justify-center px-4 relative border border-[var(--color-border)] shadow-xl cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {recording ? (
              <div className="flex items-center justify-around h-[3.5rem] w-full px-2">
                {waveHistory.map((level, i) => {
                  const height = micWaveBarHeight(level)
                  return (
                    <div
                      key={i}
                      className="w-[3px] bg-white rounded-full transition-[height,opacity] duration-100 ease-linear"
                      style={{
                        height: `${height}px`,
                        opacity: level < 6 ? 0.28 : 0.3 + (level / MIC_WAVE_LEVEL_MAX) * 0.45,
                      }}
                    />
                  )
                })}
              </div>
            ) : (
              <textarea
                ref={inputRef}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || e.shiftKey) return
                  e.preventDefault()
                  if (recording) onMic()
                  else if (inputText.trim() || isQuickReady) onSend()
                  else onMic()
                }}
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
            className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center shadow-xl active:scale-95 transition-opacity ${
              showSend
                ? 'bg-emerald-600 text-white'
                : 'bg-[var(--color-surface)] text-white opacity-40 hover:opacity-100 hover:bg-white/10'
            }`}
          >
            {showSend ? <ArrowUp size={22} strokeWidth={3} /> : <Mic size={22} strokeWidth={2.5} />}
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
          promptKey: 'ANALYZE_NUTRITION',
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
          promptKey: 'ANALYZE_FRONT',
          user: 'Analyze front label.',
          images: [{ mimeType: frontImage.mimeType, base64: frontImage.data }],
          model: 'gpt-4o',
        })) as { name?: string; emoji?: string }
        if (cancelled) return
        setEntry((prev) => {
          const label = normalizeDiaryLabel({
            name: frontData.name,
            emoji: frontData.emoji,
            fallbackName: prev.name || 'Food',
            fallbackEmoji: prev.emoji,
          })
          return { ...prev, name: label.name, emoji: label.emoji }
        })
      } finally {
        if (!cancelled) setAnalyzingFront(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [frontImage])

  const buildEntry = (): Omit<MacroCustomFood, 'id' | 'createdAt'> => {
    const label = normalizeDiaryLabel({
      name: entry.name,
      emoji: entry.emoji,
      fallbackName: entry.name || 'Food',
      fallbackEmoji: entry.emoji,
    })
    return {
      ...entry,
      name: label.name,
      emoji: label.emoji,
      fat: 0,
      carbs: 0,
    }
  }

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
            {nutritionImage ? <img src={nutritionImage.preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" /> : (
              <span className="mb-2 flex text-white opacity-30">
                <Camera size={28} />
              </span>
            )}
            <span className="relative z-10 text-[10px] font-black uppercase text-center text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] flex items-center gap-1.5">
              Nutrition
              {analyzingNutrition && <Loader2 size={12} className="animate-spin text-emerald-400" />}
            </span>
          </label>
          <label className="relative flex flex-col items-center justify-center h-32 bg-white/5 border-2 border-dashed border-white/10 rounded-[2rem] cursor-pointer overflow-hidden">
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e, setFrontImage)} />
            {frontImage ? <img src={frontImage.preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" /> : (
              <span className="mb-2 flex text-white opacity-30">
                <Camera size={28} />
              </span>
            )}
            <span className="relative z-10 text-[10px] font-black uppercase text-center text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] flex items-center gap-1.5">
              Front
              {analyzingFront && <Loader2 size={12} className="animate-spin text-emerald-400" />}
            </span>
          </label>
        </div>
        <MacroFoodEditCard
          fieldId="library-add"
          toolbar="library-add"
          data={{
            emoji: entry.emoji || '🍱',
            name: entry.name,
            amount: entry.baseAmount || '',
            servingMultiplier: 1,
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
