import {
  ArrowUp,
  Camera,
  Check,
  Loader2,
  Mic,
  NotebookText,
  Plus,
  RefreshCw,
  ScanText,
  Trash2,
  X,
  Pencil,
  BicepsFlexed,
  Flame,
  AlertCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { aiJson, aiVisionJson, transcribeAudio } from '../../core/api'
import type { MacroCustomFood, MacroDayItem } from '../../types/domain'
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

function MacroMiniCard({
  value,
  label,
  color,
  suffix = '',
}: {
  value: number
  label: string
  color: string
  suffix?: string
}) {
  return (
    <div className="bg-white/[0.03] border border-white/[0.05] p-1.5 rounded-lg min-w-[48px] flex flex-col items-center justify-center">
      <span className={`text-[10px] font-black leading-none ${color} opacity-90`}>
        {value}
        {suffix}
      </span>
      <span className="text-[6px] font-black opacity-15 uppercase tracking-widest mt-0.5 text-white">{label}</span>
    </div>
  )
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
  goals: { calorieGoal: number; proteinPctGoal: number }
  logs: Record<string, MacroDayItem[]>
  customFoods: MacroCustomFood[]
  onSaveLogs: (logs: Record<string, MacroDayItem[]>) => void
  onSaveFoods: (foods: MacroCustomFood[]) => void
}) {
  const items = logs[dateKey] || []
  const logsRef = useRef(logs)
  logsRef.current = logs
  const customFoodsRef = useRef(customFoods)
  customFoodsRef.current = customFoods

  const [inputText, setInputText] = useState('')
  const [recording, setRecording] = useState(false)
  const [volume, setVolume] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioCtxRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number>(0)
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

  const [dbModal, setDbModal] = useState<'closed' | 'scan' | 'manual'>('closed')

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
      onSaveLogs({ ...prevAll, [key]: nextDay })
    },
    [dateKey, onSaveLogs],
  )

  const customFoodCtxForAi = useMemo(
    () =>
      customFoods.length > 0
        ? `\n\nUSER CUSTOM FOODS DATABASE:\n${JSON.stringify(
            customFoods.map((f) => ({ name: f.name, emoji: f.emoji, baseAmount: f.baseAmount, calories: f.calories, protein: f.protein, fat: f.fat, carbs: f.carbs })),
          )}`
        : '',
    [customFoods],
  )

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`
  }, [inputText, recording])

  const removeItem = useCallback(
    (id: string) => {
      replaceDay((prev) => prev.filter((i) => i.id !== id))
    },
    [replaceDay],
  )

  const calculateMacros = useCallback(
    async (id: string, name: string, amount: string, extraCtx = '') => {
      try {
        const json = (await aiJson({
          system: MACRO_PROMPTS.MACROS,
          user: `Calculate macros for ${amount} of ${name}.${customFoodCtxForAi}${extraCtx}`,
        })) as { calories?: number; protein?: number; fat?: number; carbs?: number }
        replaceDay((prev) =>
          prev.map((i) =>
            i.id === id && i.status === 'pending'
              ? {
                  ...i,
                  calories: json.calories ?? 0,
                  protein: json.protein ?? 0,
                  fat: json.fat ?? 0,
                  carbs: json.carbs ?? 0,
                  status: 'ready',
                }
              : i,
          ),
        )
      } catch {
        replaceDay((prev) =>
          prev.map((i) => (i.id === id ? { ...i, status: 'editing_raw', rawText: `${name} ${amount}` } : i)),
        )
      }
    },
    [customFoodCtxForAi, replaceDay],
  )

  const startParsingFlow = useCallback(
    async (id: string, rawText: string, baseFood?: Record<string, unknown> | null) => {
      const controller = new AbortController()
      processingRefs.current[id] = controller
      try {
        let promptInput = `Input: ${rawText}`
        let ctx = customFoodCtxForAi
        if (baseFood && baseFood.name) {
          ctx += `\n\nContext: The user scanned "${String(baseFood.name)}".`
          const nf = await aiJson({
            system: MACRO_PROMPTS.PARSER,
            user: `${promptInput}${ctx}`,
          }).catch(() => null)
          if (!nf || typeof nf !== 'object') throw new Error('parse')
          const data = nf as { items?: { emoji?: string; name?: string; amount?: string }[] }
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
            const newItems: MacroDayItem[] = data.items.map((it) => ({
              id: crypto.randomUUID(),
              emoji: it.emoji,
              name: it.name || '',
              amount: it.amount || '',
              status: 'pending',
              timestamp: Date.now(),
              calories: 0,
              protein: 0,
              fat: 0,
              carbs: 0,
            }))
            replaceDay((prev) => [...prev.filter((i) => i.id !== id), ...newItems])
            newItems.forEach((it) => void calculateMacros(it.id, it.name, it.amount, `\nScanned base: ${JSON.stringify(baseFood)}`))
          }
          return
        }
        const parsed = await aiJson({
          system: MACRO_PROMPTS.PARSER,
          user: `${promptInput}${ctx}`,
        })
        const data = parsed as { items?: { emoji?: string; name?: string; amount?: string }[] }
        replaceDay((prev) => prev.filter((i) => i.id !== id))
        if (data.items?.length) {
          const newItems: MacroDayItem[] = data.items.map((it) => ({
            id: crypto.randomUUID(),
            emoji: it.emoji,
            name: it.name || '',
            amount: it.amount || '',
            status: 'pending',
            timestamp: Date.now(),
            calories: 0,
            protein: 0,
            fat: 0,
            carbs: 0,
          }))
          replaceDay((prev) => [...prev.filter((i) => i.id !== id), ...newItems])
          newItems.forEach((it) => void calculateMacros(it.id, it.name, it.amount))
        }
      } catch {
        replaceDay((prev) => prev.map((i) => (i.id === id ? { ...i, status: 'editing_raw', rawText } : i)))
      } finally {
        delete processingRefs.current[id]
      }
    },
    [calculateMacros, customFoodCtxForAi, onSaveFoods, replaceDay],
  )

  const handleMicToggle = useCallback(async () => {
    if (recording) {
      setRecording(false)
      mediaRecorderRef.current?.stop()
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
      const rec = new MediaRecorder(stream)
      mediaRecorderRef.current = rec
      audioChunksRef.current = []
      rec.ondataavailable = (e) => audioChunksRef.current.push(e.data)
      rec.onstop = async () => {
        cancelAnimationFrame(rafRef.current)
        await audioCtx.close()
        if (audioChunksRef.current.length === 0) return
        const tempId = crypto.randomUUID()
        replaceDay((prev) => [...prev, { id: tempId, status: 'transcribing', timestamp: Date.now(), name: '', amount: '' }])
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], 'audio.webm', { type: 'audio/webm' })
        abortRef.current = new AbortController()
        try {
          const text = await transcribeAudio(file)
          if (text?.trim()) {
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
          } else {
            removeItem(tempId)
          }
        } catch {
          removeItem(tempId)
        }
        stream.getTracks().forEach((t) => t.stop())
      }
      rec.start()
      setRecording(true)
    } catch {
      /* mic denied */
    }
  }, [recording, removeItem, replaceDay, startParsingFlow])

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
    (id: string, name: string, amount: string) => {
      replaceDay((prev) =>
        prev.map((i) => (i.id === id ? { ...i, name, amount, status: 'pending', calories: 0, protein: 0, fat: 0, carbs: 0 } : i)),
      )
      void calculateMacros(id, name, amount)
    },
    [calculateMacros, replaceDay],
  )

  return (
    <div className="flex flex-col gap-6 pb-44">
      <StatusDashboard
        consumed={totals.cal}
        goal={goals.calorieGoal}
        proteinPct={proteinPct}
        proteinGoal={goals.proteinPctGoal}
      />

      <section className="space-y-3">
        {items.length === 0 ? (
          <div className="bg-white/5 rounded-[var(--radius-card)] border border-white/5 p-10 text-center">
            <p className="opacity-30 font-bold text-[10px] uppercase tracking-widest text-white">No entries yet</p>
          </div>
        ) : (
          [...items]
            .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
            .map((item) => (
              <FoodRow
                key={item.id}
                item={item}
                onRemove={() => removeItem(item.id)}
                onRefresh={() => item.status === 'ready' && calculateMacros(item.id, item.name, item.amount)}
                onUpdate={(n, a) => updateItem(item.id, n, a)}
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

      <section className="bg-[var(--color-surface)] rounded-[var(--radius-card)] border border-[var(--color-border)] overflow-hidden">
        <div className="flex justify-between items-center p-5 border-b border-white/5 bg-black/20">
          <h2 className="text-sm font-black text-white tracking-widest uppercase flex items-center gap-2">
            <NotebookText size={16} className="text-emerald-400" /> Food Library
          </h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setDbModal('scan')}
              className="p-2 bg-white/5 rounded-xl text-emerald-400 hover:bg-white/10"
            >
              <ScanText size={16} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={() => setDbModal('manual')}
              className="p-2 bg-white/5 rounded-xl text-emerald-400 hover:bg-white/10"
            >
              <Plus size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>
        <div className="p-4 space-y-3 max-h-52 overflow-y-auto">
          {customFoods.length === 0 ? (
            <p className="text-center text-[10px] font-bold uppercase tracking-widest text-neutral-500 py-4">Library is empty</p>
          ) : (
            customFoods.map((food) => (
              <button
                key={food.id}
                type="button"
                className="flex items-center justify-between bg-black/40 p-3 rounded-xl border border-white/5 w-full text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-lg">{food.emoji || '🍱'}</span>
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-white truncate">{food.name}</p>
                    <p className="text-[10px] font-black opacity-40 uppercase tracking-widest text-white truncate">
                      {food.baseAmount} • {food.calories} cal
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

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

      {dbModal !== 'closed' && (
        <DatabaseModal
          mode={dbModal === 'manual' ? 'manual' : 'scan'}
          onClose={() => setDbModal('closed')}
          onSave={(entry) => {
            onSaveFoods([...customFoods, { ...entry, id: crypto.randomUUID(), createdAt: Date.now() }])
            setDbModal('closed')
          }}
        />
      )}
    </div>
  )
}

function FoodRow({
  item,
  onRemove,
  onRefresh,
  onUpdate,
  onCancelProcessing,
  onReprocess,
  onCancelTranscription,
}: {
  item: MacroDayItem
  onRemove: () => void
  onRefresh: () => void
  onUpdate: (n: string, a: string) => void
  onCancelProcessing: () => void
  onReprocess: (raw: string) => void
  onCancelTranscription: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [tempName, setTempName] = useState(item.name)
  const [tempAmount, setTempAmount] = useState(item.amount)
  const [tempRaw, setTempRaw] = useState(item.rawText || '')

  useEffect(() => {
    setTempName(item.name)
    setTempAmount(item.amount)
    setTempRaw(item.rawText || '')
  }, [item.name, item.amount, item.rawText])

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

  if (item.status === 'editing_raw') {
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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !editing && setEditing(true)}
      onKeyDown={(e) => e.key === 'Enter' && !editing && setEditing(true)}
      className={`relative bg-white/5 p-4 rounded-[var(--radius-card)] border border-white/5 transition-all ${item.status === 'pending' ? 'opacity-80' : ''}`}
    >
      {item.status === 'pending' && (
        <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-[var(--radius-card)]">
          <Loader2 className="animate-spin text-emerald-500 opacity-60" size={20} />
        </div>
      )}
      <div className="relative flex items-center gap-3 w-full">
        <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-xl shrink-0 border border-white/5">{item.emoji || '🍱'}</div>
        <div className="flex flex-1 items-center justify-between min-w-0">
          <div className="flex flex-col min-w-0 flex-grow">
            {editing ? (
              <div className="flex flex-col gap-1 pr-2" onClick={(e) => e.stopPropagation()}>
                <input
                  value={tempName}
                  onChange={(e) => setTempName(e.target.value)}
                  className="bg-white/5 text-white font-bold text-sm w-full py-1 px-2 rounded-lg"
                />
                <input
                  value={tempAmount}
                  onChange={(e) => setTempAmount(e.target.value)}
                  className="bg-white/5 text-white/40 font-black text-[10px] uppercase w-full py-1 px-2 rounded-lg"
                />
              </div>
            ) : (
              <>
                <h3 className="font-bold text-white/90 text-sm leading-tight truncate">{item.name}</h3>
                <p className="text-[10px] font-black opacity-30 uppercase tracking-tight truncate">{item.amount}</p>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-2">
            <div className="flex gap-1.5">
              <MacroMiniCard value={Math.round(item.calories || 0)} label="Cal" color="text-emerald-400" />
              <MacroMiniCard value={Math.round(item.protein || 0)} label="Pro" color="text-blue-400" suffix="g" />
            </div>
            {editing && (
              <div className="flex flex-col gap-1.5 ml-1">
                <button type="button" onClick={(e) => { e.stopPropagation(); onRefresh() }} className="p-1.5 bg-emerald-500/10 rounded-lg text-emerald-400">
                  <RefreshCw size={14} strokeWidth={3} />
                </button>
                <button type="button" onClick={(e) => { e.stopPropagation(); onRemove() }} className="p-1.5 bg-red-500/10 rounded-lg text-red-400">
                  <Trash2 size={14} strokeWidth={3} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onUpdate(tempName, tempAmount)
                    setEditing(false)
                  }}
                  className="p-1.5 bg-emerald-500 rounded-lg text-white"
                >
                  <Check size={14} strokeWidth={3} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
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
  const canSend = Boolean(inputText.trim() || isQuickReady || recording)

  return (
    <div className="fixed bottom-[calc(88px+env(safe-area-inset-bottom))] left-0 right-0 z-20 pointer-events-none">
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/95 to-transparent pointer-events-none" />
      <div className="max-w-md mx-auto flex flex-col gap-3 p-6 relative pointer-events-auto">
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
              canSend && !recording ? 'bg-emerald-600 text-white' : 'bg-[var(--color-surface)] text-white hover:bg-white/10'
            }`}
          >
            {canSend && !recording ? <ArrowUp size={22} strokeWidth={3} /> : <Mic size={22} className="opacity-40" strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  )
}

function DatabaseModal({
  mode,
  onClose,
  onSave,
}: {
  mode: 'scan' | 'manual'
  onClose: () => void
  onSave: (entry: Omit<MacroCustomFood, 'id' | 'createdAt'>) => void
}) {
  const [frontImage, setFrontImage] = useState<{ data: string; mimeType: string; preview: string } | null>(null)
  const [nutritionImage, setNutritionImage] = useState<{ data: string; mimeType: string; preview: string } | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [activeEntry, setActiveEntry] = useState<Omit<MacroCustomFood, 'id' | 'createdAt'> | null>(
    mode === 'manual' ? { name: '', emoji: '🍱', baseAmount: '', calories: 0, protein: 0, fat: 0, carbs: 0 } : null,
  )

  useEffect(() => {
    if (frontImage && nutritionImage && !analyzing && !activeEntry && mode === 'scan') void runAnalyze()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional run when images ready
  }, [frontImage, nutritionImage])

  const runAnalyze = async () => {
    if (!frontImage || !nutritionImage) return
    setAnalyzing(true)
    try {
      const frontData = (await aiVisionJson({
        system: MACRO_PROMPTS.ANALYZE_FRONT,
        user: 'Analyze front label.',
        images: [{ mimeType: frontImage.mimeType, base64: frontImage.data }],
        model: 'gpt-4o',
      })) as { name?: string; emoji?: string }
      const nutData = (await aiVisionJson({
        system: MACRO_PROMPTS.ANALYZE_NUTRITION,
        user: 'Analyze nutrition label.',
        images: [{ mimeType: nutritionImage.mimeType, base64: nutritionImage.data }],
        model: 'gpt-4o',
      })) as { baseAmount?: string; calories?: number; protein?: number; fat?: number; carbs?: number }
      setActiveEntry({
        name: frontData.name || '',
        emoji: frontData.emoji || '🍱',
        baseAmount: nutData.baseAmount || '',
        calories: nutData.calories ?? 0,
        protein: nutData.protein ?? 0,
        fat: nutData.fat ?? 0,
        carbs: nutData.carbs ?? 0,
      })
    } finally {
      setAnalyzing(false)
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

  if (!activeEntry) {
    return (
      <div className="fixed inset-0 bg-black/90 z-[60] flex flex-col items-center p-4 backdrop-blur-md overflow-y-auto">
        <div className="w-full max-w-md mt-6 flex justify-between items-center mb-6 shrink-0">
          <h2 className="text-xl font-black text-emerald-400 flex items-center gap-2">
            <Plus size={24} /> Add Food
          </h2>
          <button type="button" onClick={onClose} className="p-2 bg-white/5 rounded-full opacity-40 hover:opacity-100">
            <X size={20} />
          </button>
        </div>
        <div className="w-full max-w-md space-y-4 pb-10">
          {mode === 'scan' ? (
            <>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <label className="relative flex flex-col items-center justify-center h-32 bg-white/5 border-2 border-dashed border-white/10 rounded-[2rem] cursor-pointer overflow-hidden">
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e, setNutritionImage)} />
                  {nutritionImage ? <img src={nutritionImage.preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" /> : <Camera size={28} className="opacity-30 mb-2" />}
                  <span className="relative z-10 text-[10px] font-black uppercase text-center text-white">{nutritionImage ? 'Nutrition OK' : '1. Nutrition'}</span>
                </label>
                <label className="relative flex flex-col items-center justify-center h-32 bg-white/5 border-2 border-dashed border-white/10 rounded-[2rem] cursor-pointer overflow-hidden">
                  <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFile(e, setFrontImage)} />
                  {frontImage ? <img src={frontImage.preview} alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" /> : <Camera size={28} className="opacity-30 mb-2" />}
                  <span className="relative z-10 text-[10px] font-black uppercase text-center text-white">{frontImage ? 'Front OK' : '2. Front'}</span>
                </label>
              </div>
              {analyzing && (
                <div className="bg-white/5 rounded-2xl p-4 flex items-center justify-center gap-3 text-emerald-400 font-bold mb-4">
                  <Loader2 size={20} className="animate-spin" /> Analyzing…
                </div>
              )}
              <button
                type="button"
                onClick={() => setActiveEntry({ name: '', emoji: '🍱', baseAmount: '', calories: 0, protein: 0, fat: 0, carbs: 0 })}
                className="w-full py-4 bg-white/5 hover:bg-white/10 text-white rounded-[1.5rem] font-bold flex items-center justify-center gap-2"
              >
                <Plus size={20} /> Add Manually
              </button>
            </>
          ) : null}
        </div>
      </div>
    )
  }

  const e = activeEntry
  return (
    <div className="fixed inset-0 bg-black/90 z-[60] flex flex-col items-center p-4 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-md mt-6 flex justify-between items-center mb-6 shrink-0">
        <h2 className="text-xl font-black text-emerald-400">Edit & Save</h2>
        <button type="button" onClick={onClose} className="p-2 bg-white/5 rounded-full opacity-40 hover:opacity-100">
          <X size={20} />
        </button>
      </div>
      <div className="w-full max-w-md bg-[var(--color-surface)] p-6 rounded-[2rem] border border-[var(--color-border)] space-y-4">
        <input
          className="w-full p-3 bg-white/5 rounded-xl text-white font-bold"
          placeholder="Name"
          value={e.name}
          onChange={(ev) => setActiveEntry({ ...e, name: ev.target.value })}
        />
        <input
          className="w-full p-3 bg-white/5 rounded-xl text-white font-bold"
          placeholder="Emoji"
          value={e.emoji}
          onChange={(ev) => setActiveEntry({ ...e, emoji: ev.target.value })}
        />
        <input
          className="w-full p-3 bg-white/5 rounded-xl text-white font-bold"
          placeholder="Base serving"
          value={e.baseAmount}
          onChange={(ev) => setActiveEntry({ ...e, baseAmount: ev.target.value })}
        />
        <div className="grid grid-cols-2 gap-3">
          {(['calories', 'protein', 'fat', 'carbs'] as const).map((k) => (
            <input
              key={k}
              type="number"
              className="w-full p-3 bg-white/5 rounded-xl text-white font-bold"
              placeholder={k}
              value={e[k] === 0 ? '' : e[k]}
              onChange={(ev) => setActiveEntry({ ...e, [k]: parseFloat(ev.target.value) || 0 })}
            />
          ))}
        </div>
        <div className="flex gap-3 mt-6">
          <button type="button" onClick={onClose} className="flex-1 py-3 bg-white/5 text-white rounded-xl font-bold">
            Cancel
          </button>
          <button
            type="button"
            disabled={!e.name.trim()}
            onClick={() => onSave(e)}
            className="flex-[2] py-3 bg-emerald-600 disabled:opacity-50 text-white rounded-xl font-black"
          >
            Save Food
          </button>
        </div>
      </div>
    </div>
  )
}
