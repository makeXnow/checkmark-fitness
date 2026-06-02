import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Apple,
  ChevronDown,
  ChevronLeft,
  ClipboardList,
  Dumbbell,
  Menu,
  Notebook,
  Settings as SettingsIcon,
  Settings2,
  Target,
} from 'lucide-react'
import { AppAccentTextButton } from './core/AppAccentTextButton'
import { AppLoadingAnimation } from './core/AppLoadingAnimation'
import { TabPager } from './core/TabPager'
import { applyAppStatePatch, clearLiftAssumption, dismissLiftAssumption, fetchBootstrap, patchAppState, putHabits, putLift, putMacro } from './core/api'
import { normalizeMacroGoals } from './features/macro/macroCalculator'
import {
  mergeMacroLogs,
  normalizeMacroCustomFoodsOnLoad,
  normalizeMacroLogsOnLoad,
} from './features/macro/macroLib'
import {
  cementHabitsSnapshots,
  cementMacroSnapshots,
  recordHabitsGoalChange,
  recordMacroGoalChange,
  resolveHabitsWeekGoals,
  resolveMacroDayTargets,
  type HabitsGoalsBundleData,
  type MacroGoalsBundleData,
} from './lib/goalSnapshots'
import {
  normalizeLiftHistoryOnLoad,
  reconcileWorkoutMainWeightsFromHistory,
} from './features/lift/liftHistory'
import { LiftTimerHeaderControl } from './features/lift/LiftTimerHeaderControl'
import { useLiftTimer } from './features/lift/useLiftTimer'
import { workoutWithSessionWeight } from './features/lift/plates'
import { computeWeekPercentageRange, getWeekDatesFor } from './features/habits/habitsUi'
import { localDateISO } from './lib/localDate'
import { scrollAppMainToTop } from './lib/scrollAppMain'
import type {
  AppStateRow,
  BootstrapResponse,
  BottomTab,
  HabitsGoals,
  LiftAssumptionPrompt,
  LiftPayload,
  LiftSubRoute,
  MacroCustomFood,
  MacroDayItem,
  SettingsSection,
} from './types/domain'
import type { DayLog } from './types/domain'

const HabitsScreen = lazy(() => import('./features/habits/HabitsScreen').then((m) => ({ default: m.HabitsScreen })))
const MacroScreen = lazy(() => import('./features/macro/MacroScreen').then((m) => ({ default: m.MacroScreen })))
const LiftScreen = lazy(() => import('./features/lift/LiftScreen').then((m) => ({ default: m.LiftScreen })))
const LiftAssumptionModal = lazy(() =>
  import('./features/lift/LiftAssumptionModal').then((m) => ({ default: m.LiftAssumptionModal })),
)

function TabFallback() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <AppLoadingAnimation />
    </div>
  )
}

function parseISODateOnly(iso: string): Date {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10))
  return new Date(y, m - 1, d)
}

/** Set to `true` to show the slide-out menu (hamburger) trigger in the header again. */
const SHOW_HAMBURGER_MENU = false

function bottomNavButtonClass(active: boolean): string {
  return `p-2.5 rounded-xl transition-colors duration-200 active:scale-95 ${
    active
      ? 'text-emerald-400 bg-emerald-500/10'
      : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50'
  }`
}

export default function App() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null)
  const bootRef = useRef<BootstrapResponse | null>(null)
  bootRef.current = boot
  const [shellReady, setShellReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [liftAssumptionPrompt, setLiftAssumptionPrompt] = useState<LiftAssumptionPrompt | null>(null)
  const [liftAssumptionBusy, setLiftAssumptionBusy] = useState(false)

  const resyncFromServer = useCallback(async () => {
    try {
      const data = await fetchBootstrap()
      bootRef.current = data
      setBoot(data)
    } catch {
      /* ignore — user can reload if sync is critical */
    }
  }, [])

  const load = useCallback(async () => {
    try {
      setError(null)
      const data = await fetchBootstrap()
      const todayISO = localDateISO(new Date())
      const firstDayOfWeek = data.habits.appSettings?.firstDayOfWeek ?? 0

      const macroCurrent = normalizeMacroGoals(data.macro.goals)
      let macroBundle: MacroGoalsBundleData = {
        current: macroCurrent,
        snapshotsByDay: data.macro.goalsSnapshotsByDay ?? {},
        goalHistory: data.macro.goalsHistory ?? [],
      }
      const macroCement = cementMacroSnapshots(macroBundle, Object.keys(data.macro.logs || {}), todayISO)
      if (macroCement.changed) macroBundle = macroCement.bundle

      const habitsBundle: HabitsGoalsBundleData = {
        current: data.habits.goals as HabitsGoals,
        snapshotsByWeek: data.habits.goalsSnapshotsByWeek ?? {},
        goalHistory: data.habits.goalsHistory ?? [],
      }
      const habitsCement = cementHabitsSnapshots(
        habitsBundle,
        Object.keys(data.habits.logs || {}),
        new Date(),
        firstDayOfWeek,
        todayISO,
      )
      const cementedHabitsBundle = habitsCement.changed ? habitsCement.bundle : habitsBundle

      const customFoodsNorm = normalizeMacroCustomFoodsOnLoad(data.macro.customFoods || [])
      const logs = normalizeMacroLogsOnLoad(data.macro.logs || {}, customFoodsNorm.foods)
      const logsChanged = logs !== data.macro.logs
      const foodsChanged = customFoodsNorm.changed
      if (foodsChanged) data.macro.customFoods = customFoodsNorm.foods

      const liftPayload = data.lift.payload as LiftPayload
      const liftHistoryNorm = normalizeLiftHistoryOnLoad(liftPayload.history)
      const liftReconcile = reconcileWorkoutMainWeightsFromHistory(
        liftPayload.workouts,
        liftHistoryNorm.history,
      )
      const liftHistoryChanged = liftHistoryNorm.changed || liftReconcile.changed
      if (liftHistoryChanged) {
        data.lift.payload = {
          ...liftPayload,
          history: liftHistoryNorm.history,
          workouts: liftReconcile.workouts,
        }
      }

      if (logsChanged || foodsChanged || macroCement.changed || habitsCement.changed || liftHistoryChanged) {
        data.macro.logs = logs
        data.macro.goals = macroBundle.current
        data.macro.goalsSnapshotsByDay = macroBundle.snapshotsByDay
        data.macro.goalsHistory = macroBundle.goalHistory
        data.habits.goals = cementedHabitsBundle.current
        data.habits.goalsSnapshotsByWeek = cementedHabitsBundle.snapshotsByWeek
        data.habits.goalsHistory = cementedHabitsBundle.goalHistory
        const persistTasks: Promise<unknown>[] = [
          putMacro({
            goals: macroBundle.current,
            goalsSnapshotsByDay: macroBundle.snapshotsByDay,
            goalsHistory: macroBundle.goalHistory,
            customFoods: data.macro.customFoods || [],
            logs,
          }),
          putHabits({
            goals: cementedHabitsBundle.current,
            goalsSnapshotsByWeek: cementedHabitsBundle.snapshotsByWeek,
            goalsHistory: cementedHabitsBundle.goalHistory,
            logs: data.habits.logs,
            appSettings: data.habits.appSettings,
          }),
        ]
        if (liftHistoryChanged) {
          persistTasks.push(putLift(data.lift.payload as LiftPayload))
        }
        await Promise.all(persistTasks)
      }
      setBoot(data)
      bootRef.current = data
      setLiftAssumptionPrompt(data.liftAssumption?.pendingPrompt ?? null)
    } catch (e) {
      const base = e instanceof Error ? e.message : 'Failed to load'
      const apiDown =
        base === 'Internal Server Error' ||
        base === 'Failed to fetch' ||
        base.includes('NetworkError') ||
        base.includes('ECONNREFUSED') ||
        base.includes('no such table') ||
        base.includes('auth token') ||
        base.includes('remote proxy')
      const notFound = base === 'Not Found' || base.includes('404')
      const hint = notFound
        ? ' Deploy the Worker (`npm run deploy`) or restart dev with `npm run dev` (local API on :8787).'
        : apiDown
          ? ' Check your internet connection and run `npm run dev` (Vite on 9024 + local Worker, live D1).'
          : ''
      setError(base + hint)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const appState = boot?.appState
  const selectedTab = (appState?.selected_tab as BottomTab) || 'habits'
  const settingsOpen = Boolean(appState?.settings_open)
  const settingsSection = (appState?.settings_section as SettingsSection) || 'habits'
  const liftSubRoute = (appState?.lift_sub_route as LiftSubRoute) || 'workout'
  const rawLiftDayIndex = Number(appState?.lift_current_day_index ?? 0)

  const selectedDateStr = appState?.selected_date || new Date().toISOString().slice(0, 10)
  const currentDate = useMemo(() => parseISODateOnly(selectedDateStr), [selectedDateStr])
  const todayDateStr = localDateISO(new Date())

  const habitsGoals = boot?.habits.goals as HabitsGoals
  const habitsLogs = boot?.habits.logs || {}
  const habitsSettings = boot?.habits.appSettings || { firstDayOfWeek: 0 }

  const habitsGoalsBundle = useMemo<HabitsGoalsBundleData>(
    () => ({
      current: habitsGoals,
      snapshotsByWeek: boot?.habits.goalsSnapshotsByWeek ?? {},
      goalHistory: boot?.habits.goalsHistory ?? [],
    }),
    [habitsGoals, boot?.habits.goalsSnapshotsByWeek, boot?.habits.goalsHistory],
  )

  const macroGoals = useMemo(
    () => normalizeMacroGoals(boot?.macro.goals),
    [boot?.macro.goals],
  )

  const macroGoalsBundle = useMemo<MacroGoalsBundleData>(
    () => ({
      current: macroGoals,
      snapshotsByDay: boot?.macro.goalsSnapshotsByDay ?? {},
      goalHistory: boot?.macro.goalsHistory ?? [],
    }),
    [macroGoals, boot?.macro.goalsSnapshotsByDay, boot?.macro.goalsHistory],
  )

  const macroGoalsForDate = useMemo(() => {
    const targets = resolveMacroDayTargets(selectedDateStr, macroGoalsBundle, todayDateStr)
    return { ...macroGoals, ...targets }
  }, [macroGoals, macroGoalsBundle, selectedDateStr, todayDateStr])

  const macroLogs = boot?.macro.logs || {}
  const macroFoods = boot?.macro.customFoods || []

  const liftPayload: LiftPayload = (boot?.lift.payload || {
    days: [],
    workouts: [],
    statuses: [],
    history: [],
    availablePlates: [],
    weightUnit: 'lbs',
    plateUnit: 'lbs',
  }) as LiftPayload

  const sortedLiftDays = useMemo(
    () => [...liftPayload.days].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [liftPayload.days],
  )

  const safeLiftDayIndex = useMemo(() => {
    const len = sortedLiftDays.length
    if (len === 0) return 0
    const n = Number.isFinite(rawLiftDayIndex) ? Math.floor(rawLiftDayIndex) : 0
    return Math.max(0, Math.min(len - 1, n))
  }, [sortedLiftDays.length, rawLiftDayIndex])

  const currentLiftDayId = sortedLiftDays[safeLiftDayIndex]?.id

  const liftDayWorkouts = useMemo(() => {
    if (!currentLiftDayId) return []
    const plates = liftPayload.availablePlates || []
    return liftPayload.workouts
      .filter((w) => w.dayId === currentLiftDayId)
      .map((w) => workoutWithSessionWeight(w, liftPayload.history, plates))
  }, [currentLiftDayId, liftPayload.availablePlates, liftPayload.history, liftPayload.workouts])

  const mergeAppState = useCallback((row: AppStateRow) => {
    setBoot((prev) => (prev ? { ...prev, appState: row as AppStateRow } : prev))
  }, [])

  const persistAppState = useCallback(
    (patch: Parameters<typeof patchAppState>[0]) => {
      let rollback: AppStateRow | null = null
      setBoot((prev) => {
        if (!prev?.appState) return prev
        rollback = prev.appState
        return { ...prev, appState: applyAppStatePatch(prev.appState, patch) }
      })
      void patchAppState(patch)
        .then((res) => mergeAppState(res.appState))
        .catch(() => {
          if (rollback) mergeAppState(rollback)
        })
    },
    [mergeAppState],
  )

  const changeDate = useCallback(
    (delta: number) => {
      const next = new Date(currentDate)
      next.setDate(next.getDate() + delta)
      persistAppState({ selected_date: localDateISO(next) })
    },
    [currentDate, persistAppState],
  )

  const isTodaySelected = selectedDateStr === todayDateStr

  const habitsWeekPercentRange = useMemo(() => {
    if (!boot || !isTodaySelected || !habitsGoals) return null
    const weekDates = getWeekDatesFor(currentDate, habitsSettings.firstDayOfWeek)
    const weekGoals = resolveHabitsWeekGoals(
      weekDates[0]!,
      habitsGoalsBundle,
      habitsSettings.firstDayOfWeek,
      todayDateStr,
    )
    return computeWeekPercentageRange(weekDates, habitsLogs, weekGoals, todayDateStr)
  }, [
    boot,
    currentDate,
    habitsGoals,
    habitsGoalsBundle,
    habitsLogs,
    habitsSettings.firstDayOfWeek,
    isTodaySelected,
    todayDateStr,
  ])

  const goToToday = useCallback(() => {
    persistAppState({ selected_date: todayDateStr })
  }, [persistAppState, todayDateStr])

  const setTab = useCallback(
    (tab: BottomTab) => {
      persistAppState({ selected_tab: tab })
    },
    [persistAppState],
  )

  const openSettings = useCallback(() => {
    persistAppState({ settings_open: true, settings_section: selectedTab as unknown as SettingsSection })
  }, [persistAppState, selectedTab])

  const closeSettings = useCallback(() => {
    persistAppState({ settings_open: false })
  }, [persistAppState])

  /** Bottom nav: in settings, same icon closes settings; another icon switches settings section; otherwise switches tracker tab. */
  const selectBottomTab = useCallback(
    (tab: BottomTab) => {
      if (settingsOpen) {
        if (tab === settingsSection) {
          closeSettings()
        } else {
          persistAppState({
            selected_tab: tab,
            settings_section: tab as SettingsSection,
            settings_open: true,
          })
        }
      } else if (tab === 'lift') {
        persistAppState({ selected_tab: tab, lift_sub_route: 'workout' })
      } else {
        setTab(tab)
      }
    },
    [closeSettings, persistAppState, setTab, settingsOpen, settingsSection],
  )

  const navActiveTab: BottomTab = settingsOpen ? (settingsSection as BottomTab) : selectedTab

  const swipeTrackerTab = useCallback(
    (tab: BottomTab) => {
      if (tab === 'lift') {
        persistAppState({ selected_tab: tab, lift_sub_route: 'workout' })
      } else {
        setTab(tab)
      }
    },
    [persistAppState, setTab],
  )

  const swipeSettingsTab = useCallback(
    (tab: BottomTab) => {
      persistAppState({
        selected_tab: tab,
        settings_section: tab as SettingsSection,
        settings_open: true,
      })
    },
    [persistAppState],
  )

  const setLiftDayIndex = useCallback(
    (idx: number) => {
      persistAppState({ lift_current_day_index: idx })
    },
    [persistAppState],
  )

  useEffect(() => {
    if (!boot) {
      setShellReady(false)
      return
    }
    let cancelled = false
    void Promise.all([
      import('./features/habits/HabitsScreen'),
      import('./features/macro/MacroScreen'),
      import('./features/lift/LiftScreen'),
    ])
      .then(() => {
        if (!cancelled) setShellReady(true)
      })
      .catch(() => {
        if (!cancelled) setShellReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [boot])

  useEffect(() => {
    if (sortedLiftDays.length === 0) return
    if (safeLiftDayIndex !== rawLiftDayIndex) {
      void setLiftDayIndex(safeLiftDayIndex)
    }
  }, [rawLiftDayIndex, safeLiftDayIndex, setLiftDayIndex, sortedLiftDays.length])

  const habitsSaveSeq = useRef(Promise.resolve())

  const saveHabitsBundle = useCallback(
    (next: { goals?: HabitsGoals; logs?: Record<string, DayLog>; appSettings?: { firstDayOfWeek: number } }) => {
      habitsSaveSeq.current = habitsSaveSeq.current
        .then(async () => {
          const prev = bootRef.current
          if (!prev) return

          const appSettings = next.appSettings ?? prev.habits.appSettings ?? { firstDayOfWeek: 0 }
          const logs = next.logs ?? prev.habits.logs ?? {}
          let bundle: HabitsGoalsBundleData = {
            current: prev.habits.goals as HabitsGoals,
            snapshotsByWeek: prev.habits.goalsSnapshotsByWeek ?? {},
            goalHistory: prev.habits.goalsHistory ?? [],
          }
          if (next.goals) {
            bundle = recordHabitsGoalChange(bundle, next.goals, appSettings.firstDayOfWeek, todayDateStr)
            const cemented = cementHabitsSnapshots(
              bundle,
              Object.keys(logs),
              currentDate,
              appSettings.firstDayOfWeek,
              todayDateStr,
            )
            if (cemented.changed) bundle = cemented.bundle
          }

          const habits = {
            goals: bundle.current,
            goalsSnapshotsByWeek: bundle.snapshotsByWeek,
            goalsHistory: bundle.goalHistory,
            logs,
            appSettings,
            updatedAt: Date.now(),
          }
          const nextBoot = { ...prev, habits }
          bootRef.current = nextBoot
          setBoot(nextBoot)

          await putHabits({
            goals: habits.goals,
            goalsSnapshotsByWeek: habits.goalsSnapshotsByWeek,
            goalsHistory: habits.goalsHistory,
            logs: habits.logs,
            appSettings: habits.appSettings,
          })
        })
        .catch(() => resyncFromServer())
      return habitsSaveSeq.current
    },
    [currentDate, resyncFromServer, todayDateStr],
  )

  const macroSaveSeq = useRef(Promise.resolve())

  const saveMacroBundle = useCallback(
    (next: {
      goals?: typeof macroGoals
      logs?: Record<string, MacroDayItem[]>
      customFoods?: MacroCustomFood[]
    }) => {
      macroSaveSeq.current = macroSaveSeq.current
        .then(async () => {
          const prev = bootRef.current
          if (!prev) return

          let bundle: MacroGoalsBundleData = {
            current: normalizeMacroGoals(prev.macro.goals),
            snapshotsByDay: prev.macro.goalsSnapshotsByDay ?? {},
            goalHistory: prev.macro.goalsHistory ?? [],
          }
          if (next.goals) {
            bundle = recordMacroGoalChange(bundle, next.goals, todayDateStr)
            const cemented = cementMacroSnapshots(
              bundle,
              Object.keys(prev.macro.logs || {}),
              todayDateStr,
            )
            if (cemented.changed) bundle = cemented.bundle
          }
          const logs = next.logs ? mergeMacroLogs(prev.macro.logs, next.logs) : prev.macro.logs
          const customFoods = next.customFoods ?? prev.macro.customFoods

          const macro = {
            goals: bundle.current,
            goalsSnapshotsByDay: bundle.snapshotsByDay,
            goalsHistory: bundle.goalHistory,
            customFoods,
            logs,
            updatedAt: Date.now(),
          }
          const nextBoot = { ...prev, macro }
          bootRef.current = nextBoot
          setBoot(nextBoot)

          await putMacro({
            goals: macro.goals,
            goalsSnapshotsByDay: macro.goalsSnapshotsByDay,
            goalsHistory: macro.goalsHistory,
            customFoods: macro.customFoods,
            logs: macro.logs,
          })
        })
        .catch(() => resyncFromServer())
      return macroSaveSeq.current
    },
    [resyncFromServer, todayDateStr],
  )

  const liftSaveSeq = useRef(Promise.resolve())

  const saveLiftBundle = useCallback((next: LiftPayload) => {
    setBoot((prev) => {
      if (!prev) return prev
      const nextBoot = { ...prev, lift: { payload: next, updatedAt: Date.now() } }
      bootRef.current = nextBoot
      return nextBoot
    })

    liftSaveSeq.current = liftSaveSeq.current
      .then(async () => {
        await putLift(next)
      })
      .catch(() => resyncFromServer())
    return liftSaveSeq.current
  }, [resyncFromServer])

  const liftTimerEnabled =
    selectedTab === 'lift' && !settingsOpen && liftSubRoute === 'workout'

  const liftTimer = useLiftTimer({
    payload: liftPayload,
    dayId: currentLiftDayId,
    dayWorkouts: liftDayWorkouts,
    enabled: liftTimerEnabled,
    onPersist: (next) => void saveLiftBundle(next),
  })

  useEffect(() => {
    if (settingsOpen && liftTimer.isPlaying) {
      liftTimer.pause()
    }
  }, [settingsOpen, liftTimer.isPlaying, liftTimer.pause])

  const markLiftHabitIfNeeded = useCallback(
    (localDate: string) => {
      const prev = bootRef.current
      if (!prev) return
      const logs = prev.habits.logs ?? {}
      const dayLog = logs[localDate] ?? {}
      if (dayLog.lift) return
      void saveHabitsBundle({
        logs: {
          ...logs,
          [localDate]: { ...dayLog, lift: true },
        },
      })
    },
    [saveHabitsBundle],
  )

  const handleLiftWorkoutSubmitted = useCallback(
    (dayId: string, localDate: string) => {
      markLiftHabitIfNeeded(localDate)
      void clearLiftAssumption({ dayId, localDate }).catch(() => {})
      setLiftAssumptionPrompt((prev) =>
        prev && prev.dayId === dayId && prev.localDate === localDate ? null : prev,
      )
    },
    [markLiftHabitIfNeeded],
  )

  const dismissLiftAssumptionPrompt = useCallback(async () => {
    const prompt = liftAssumptionPrompt
    if (!prompt || liftAssumptionBusy) return
    setLiftAssumptionBusy(true)
    try {
      await dismissLiftAssumption({ dayId: prompt.dayId, localDate: prompt.localDate })
      setLiftAssumptionPrompt(null)
    } finally {
      setLiftAssumptionBusy(false)
    }
  }, [liftAssumptionBusy, liftAssumptionPrompt])

  const submitLiftAssumptionPrompt = useCallback(async () => {
    const prompt = liftAssumptionPrompt
    const prev = bootRef.current
    if (!prompt || !prev || liftAssumptionBusy) return
    setLiftAssumptionBusy(true)
    try {
      const { buildSubmitWorkoutDayPayload } = await import('./features/lift/submitWorkoutDay')
      const payload = prev.lift.payload as LiftPayload
      const { nextPayload } = buildSubmitWorkoutDayPayload(payload, prompt.dayId, {
        localDate: prompt.localDate,
        advanceDayIndex: false,
      })
      await saveLiftBundle(nextPayload)
      handleLiftWorkoutSubmitted(prompt.dayId, prompt.localDate)
    } finally {
      setLiftAssumptionBusy(false)
    }
  }, [handleLiftWorkoutSubmitted, liftAssumptionBusy, liftAssumptionPrompt, saveLiftBundle])

  const [sidebarOpen, setSidebarOpen] = useState(false)

  const headerTitle = settingsOpen
    ? settingsSection === 'habits'
      ? 'Goals · Settings'
      : settingsSection === 'macro'
        ? 'Diet · Settings'
        : 'Lift · Settings'
    : selectedTab === 'lift'
      ? liftSubRoute === 'workout'
        ? ''
        : liftSubRoute === 'plan'
          ? 'Plan'
          : 'Log'
      : currentDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  useEffect(() => {
    if (selectedTab !== 'lift' || liftSubRoute !== 'log') return
    scrollAppMainToTop()
  }, [selectedTab, liftSubRoute])

  useEffect(() => {
    scrollAppMainToTop()
  }, [settingsOpen])

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8 gap-4">
        <p className="text-sm text-red-400 text-center max-w-md">{error}</p>
        <button type="button" onClick={() => void load()} className="px-4 py-2 rounded-xl bg-emerald-400 text-black font-black">
          Retry
        </button>
      </div>
    )
  }

  if (!boot || !appState || !shellReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <AppLoadingAnimation />
      </div>
    )
  }

  return (
    <div
      id="app-root"
      className="flex h-dvh max-h-dvh flex-col overflow-hidden bg-black font-sans antialiased text-white selection:bg-emerald-400/30 relative"
    >
      <header className="fixed top-0 left-0 right-0 z-40 w-full bg-black pt-[calc(env(safe-area-inset-top,0px)+var(--app-header-pad-top))] pb-[var(--app-header-pad-bottom)]">
        <div className="mx-auto grid min-h-[var(--app-header-row-height)] w-full max-w-[var(--app-max-width)] grid-cols-[1fr_auto_1fr] items-center gap-2 px-[var(--app-pad-x)]">
          <div className="flex min-w-0 items-center gap-1 justify-self-start justify-start">
            <button
              type="button"
              aria-label={settingsOpen ? 'Close settings' : 'Open settings'}
              aria-pressed={settingsOpen}
              onClick={() => void (settingsOpen ? closeSettings() : openSettings())}
              className={`p-3 rounded-2xl transition-all duration-300 active:scale-95 ${
                settingsOpen
                  ? 'text-emerald-400 bg-black/50'
                  : 'text-neutral-500 hover:text-white hover:bg-neutral-800/50'
              }`}
            >
              <Settings2 className="h-6 w-6" />
            </button>
            {selectedTab === 'lift' && !settingsOpen && liftSubRoute === 'log' ? (
              <button
                type="button"
                aria-label="Back to workout"
                onClick={() => void persistAppState({ lift_sub_route: 'workout' })}
                className="p-2 text-white hover:text-emerald-400 rounded-full hover:bg-neutral-900"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            ) : SHOW_HAMBURGER_MENU ? (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="p-2 text-white hover:text-emerald-400 rounded-full hover:bg-neutral-900"
              >
                <Menu className="w-6 h-6" />
              </button>
            ) : null}
          </div>

          <div className="flex min-w-0 max-w-[min(100%,calc(100vw-10rem))] flex-col items-center justify-center gap-1 text-center">
            {settingsOpen ? (
              <h1 className="text-sm font-black text-white tracking-widest uppercase">{headerTitle}</h1>
            ) : selectedTab === 'habits' || selectedTab === 'macro' ? (
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void changeDate(-1)}
                  className="p-2 text-neutral-500 hover:text-white rounded-full hover:bg-neutral-900"
                >
                  ‹
                </button>
                <h1 className="text-sm font-black text-white tracking-widest uppercase">{headerTitle}</h1>
                <button
                  type="button"
                  onClick={() => void changeDate(1)}
                  className="p-2 text-neutral-500 hover:text-white rounded-full hover:bg-neutral-900"
                >
                  ›
                </button>
              </div>
            ) : selectedTab === 'lift' && liftSubRoute === 'workout' && sortedLiftDays.length > 0 ? (
              <details className="group relative w-max max-w-[min(200px,calc(100vw-8rem))] shrink-0 rounded-full border border-emerald-500/40 bg-neutral-900/60">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 py-1.5 pl-3 pr-2 text-left [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 truncate font-black text-xs uppercase tracking-widest text-white">
                    {sortedLiftDays[safeLiftDayIndex]?.name ?? ''}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-emerald-400 transition-transform group-open:rotate-180" />
                </summary>
                <div className="absolute left-1/2 top-[calc(100%+6px)] z-50 min-w-[10rem] max-w-[min(calc(100vw-2rem),220px)] -translate-x-1/2 overflow-hidden rounded-xl border border-emerald-500/40 bg-neutral-900 py-1 shadow-xl">
                  {sortedLiftDays.map((d, idx) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`block w-full truncate px-4 py-2.5 text-left font-black text-xs uppercase tracking-widest transition-colors ${
                        idx === safeLiftDayIndex
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'text-white hover:bg-neutral-800'
                      }`}
                      onClick={(ev) => {
                        void setLiftDayIndex(idx)
                        ev.currentTarget.closest('details')?.removeAttribute('open')
                      }}
                    >
                      {d.name}
                    </button>
                  ))}
                  <div className="my-1 border-t border-neutral-700" role="separator" />
                  <button
                    type="button"
                    className="block w-full px-4 py-3 text-left text-sm font-semibold tracking-tight text-neutral-400 transition-colors hover:bg-neutral-800/80 hover:text-emerald-400"
                    onClick={(ev) => {
                      void persistAppState({ lift_sub_route: 'plan' })
                      ev.currentTarget.closest('details')?.removeAttribute('open')
                    }}
                  >
                    Edit Workouts
                  </button>
                </div>
              </details>
            ) : headerTitle ? (
              <h1 className="text-sm font-black text-white tracking-widest uppercase">{headerTitle}</h1>
            ) : (
              <span className="sr-only">Lift</span>
            )}
          </div>

          <div className="flex min-w-0 items-center justify-self-end justify-end">
            {!settingsOpen && selectedTab === 'lift' && liftSubRoute === 'workout' ? (
              <LiftTimerHeaderControl timer={liftTimer} />
            ) : !settingsOpen && selectedTab === 'habits' && isTodaySelected && habitsWeekPercentRange ? (
              <span className="shrink-0 font-black text-[10px] uppercase tracking-[0.2em] text-neutral-500">
                {habitsWeekPercentRange.min === habitsWeekPercentRange.max
                  ? `${habitsWeekPercentRange.min}%`
                  : `${habitsWeekPercentRange.min}-${habitsWeekPercentRange.max}%`}
              </span>
            ) : !settingsOpen &&
              (selectedTab === 'habits' || selectedTab === 'macro') &&
              !isTodaySelected ? (
              <AppAccentTextButton onClick={() => void goToToday()}>Today</AppAccentTextButton>
            ) : (
              <div className="h-10 w-12 shrink-0" aria-hidden />
            )}
          </div>
        </div>
      </header>

      <main
        id="app-main"
        className="mx-auto flex min-h-0 w-full max-w-[var(--app-max-width)] flex-1 flex-col overflow-hidden pt-[var(--app-main-pad-top)]"
      >
        {settingsOpen ? (
          <TabPager
            activeTab={settingsSection as BottomTab}
            onTabChange={swipeSettingsTab}
            className="animate-in fade-in duration-300"
            pages={{
              habits: (
                <Suspense fallback={<TabFallback />}>
                  <HabitsScreen
                    currentDate={currentDate}
                    goals={habitsGoals}
                    goalsBundle={habitsGoalsBundle}
                    logs={habitsLogs}
                    appSettings={habitsSettings}
                    view="settings"
                    onSaveGoals={(g) => void saveHabitsBundle({ goals: g })}
                    onSaveLogs={(l) => void saveHabitsBundle({ logs: l })}
                    onSaveAppSettings={(s) => void saveHabitsBundle({ appSettings: s })}
                  />
                </Suspense>
              ),
              macro: (
                <Suspense fallback={<TabFallback />}>
                  <MacroScreen
                    currentDate={currentDate}
                    goals={macroGoals}
                    logs={macroLogs}
                    customFoods={macroFoods}
                    view="settings"
                    onSaveGoals={(g) => void saveMacroBundle({ goals: g })}
                  />
                </Suspense>
              ),
              lift: (
                <Suspense fallback={<TabFallback />}>
                  <LiftScreen
                    payload={liftPayload}
                    subRoute={liftSubRoute}
                    currentDayIndex={safeLiftDayIndex}
                    onDayIndexChange={(i) => void setLiftDayIndex(i)}
                    view="settings"
                    onPersist={(next) => void saveLiftBundle(next)}
                    onWorkoutSubmitted={handleLiftWorkoutSubmitted}
                  />
                </Suspense>
              ),
            }}
          />
        ) : (
          <TabPager
            activeTab={selectedTab}
            onTabChange={swipeTrackerTab}
            pages={{
              habits: (
                <Suspense fallback={<TabFallback />}>
                  <HabitsScreen
                    currentDate={currentDate}
                    goals={habitsGoals}
                    goalsBundle={habitsGoalsBundle}
                    logs={habitsLogs}
                    appSettings={habitsSettings}
                    view="tracker"
                    onSaveGoals={(g) => void saveHabitsBundle({ goals: g })}
                    onSaveLogs={(l) => void saveHabitsBundle({ logs: l })}
                    onSaveAppSettings={(s) => void saveHabitsBundle({ appSettings: s })}
                  />
                </Suspense>
              ),
              macro: (
                <Suspense fallback={<TabFallback />}>
                  <MacroScreen
                    currentDate={currentDate}
                    goals={macroGoalsForDate}
                    logs={macroLogs}
                    customFoods={macroFoods}
                    view="tracker"
                    onSaveGoals={(g) => void saveMacroBundle({ goals: g })}
                    onSaveLogs={(l) => void saveMacroBundle({ logs: l })}
                    onSaveFoods={(foods) => void saveMacroBundle({ customFoods: foods })}
                  />
                </Suspense>
              ),
              lift: (
                <Suspense fallback={<TabFallback />}>
                  <LiftScreen
                    payload={liftPayload}
                    subRoute={liftSubRoute}
                    currentDayIndex={safeLiftDayIndex}
                    onDayIndexChange={(i) => void setLiftDayIndex(i)}
                    view="tracker"
                    trackOpenSession={selectedTab === 'lift' && !settingsOpen && liftSubRoute === 'workout'}
                    onPersist={(next) => void saveLiftBundle(next)}
                    onSeeAllLog={() => void persistAppState({ lift_sub_route: 'log' })}
                    onWorkoutSubmitted={handleLiftWorkoutSubmitted}
                    liftTimer={{
                      session: liftTimer.session,
                      liveElapsedMs: liftTimer.liveElapsedMs,
                      activeWorkoutId: liftTimer.activeWorkoutId,
                      displayStatus: liftTimer.displayStatus,
                    }}
                  />
                </Suspense>
              ),
            }}
          />
        )}
      </main>

      <nav
        className="fixed bottom-0 left-0 right-0 z-30 w-full border-t border-neutral-800/80 bg-neutral-900/95 backdrop-blur-md rounded-t-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)', boxShadow: 'var(--shadow-nav)' }}
      >
        <div className="mx-auto flex h-[var(--app-nav-bar-height)] w-full max-w-[var(--app-max-width)] items-center justify-center gap-12 px-6">
          <button
            type="button"
            aria-label="Habits"
            aria-current={navActiveTab === 'habits' ? 'page' : undefined}
            onClick={() => void selectBottomTab('habits')}
            className={bottomNavButtonClass(navActiveTab === 'habits')}
          >
            <Target size={22} strokeWidth={navActiveTab === 'habits' ? 2.5 : 2} />
          </button>
          <button
            type="button"
            aria-label="Macro"
            aria-current={navActiveTab === 'macro' ? 'page' : undefined}
            onClick={() => void selectBottomTab('macro')}
            className={bottomNavButtonClass(navActiveTab === 'macro')}
          >
            <Apple size={22} strokeWidth={navActiveTab === 'macro' ? 2.5 : 2} />
          </button>
          <button
            type="button"
            aria-label="Lift"
            aria-current={navActiveTab === 'lift' ? 'page' : undefined}
            onClick={() => void selectBottomTab('lift')}
            className={bottomNavButtonClass(navActiveTab === 'lift')}
          >
            <Dumbbell size={22} strokeWidth={navActiveTab === 'lift' ? 2.5 : 2} />
          </button>
        </div>
      </nav>

      <div
        className={`fixed inset-0 z-50 flex transition-all duration-300 ${
          sidebarOpen ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
      >
        <button
          type="button"
          aria-label="Close menu"
          className={`absolute inset-0 bg-black/60 transition-all duration-300 border-0 cursor-default ${
            sidebarOpen ? 'opacity-100 backdrop-blur-sm' : 'opacity-0'
          }`}
          onClick={() => setSidebarOpen(false)}
        />
        <div
          className={`relative w-[220px] bg-neutral-900 h-full border-r border-neutral-800 flex flex-col shadow-2xl transition-transform duration-300 ease-out ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex flex-col p-3 pt-8 space-y-4 flex-1 overflow-y-auto">
            <button
              type="button"
              onClick={() => {
                void setTab('habits')
                setSidebarOpen(false)
              }}
              className="flex items-center gap-3 px-3 py-3 w-full text-left font-black uppercase tracking-widest text-xs text-white hover:bg-neutral-800 rounded-xl"
            >
              <Target className="w-4 h-4 text-emerald-400" /> Goals
            </button>
            <button
              type="button"
              onClick={() => {
                void setTab('macro')
                setSidebarOpen(false)
              }}
              className="flex items-center gap-3 px-3 py-3 w-full text-left font-black uppercase tracking-widest text-xs text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl"
            >
              <Apple className="w-4 h-4 text-emerald-400" /> Diet
            </button>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => {
                  void persistAppState({ selected_tab: 'lift', lift_sub_route: 'workout' })
                  setSidebarOpen(false)
                }}
                className="flex items-center gap-3 px-3 py-3 w-full text-left font-black uppercase tracking-widest text-xs text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl"
              >
                <Dumbbell className="w-4 h-4 text-emerald-400" /> Lift
              </button>
              <button
                type="button"
                onClick={() => {
                  void persistAppState({ selected_tab: 'lift', lift_sub_route: 'plan' })
                  setSidebarOpen(false)
                }}
                className="flex items-center gap-3 pl-8 pr-3 py-2 w-full text-left font-black uppercase tracking-widest text-xs text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-xl"
              >
                <ClipboardList className="w-3.5 h-3.5" /> Plan
              </button>
              <button
                type="button"
                onClick={() => {
                  void persistAppState({ selected_tab: 'lift', lift_sub_route: 'log' })
                  setSidebarOpen(false)
                }}
                className="flex items-center gap-3 pl-8 pr-3 py-2 w-full text-left font-black uppercase tracking-widest text-xs text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 rounded-xl"
              >
                <Notebook className="w-3.5 h-3.5" /> Log
              </button>
            </div>
          </div>
          <div className="mt-auto p-3 border-t border-neutral-800">
            <button
              type="button"
              onClick={() => {
                void openSettings()
                setSidebarOpen(false)
              }}
              className="flex items-center gap-3 px-3 py-4 w-full text-left font-black uppercase tracking-widest text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white rounded-xl"
            >
              <SettingsIcon className="w-4 h-4" /> Settings
            </button>
          </div>
        </div>
      </div>

      {liftAssumptionPrompt ? (
        <Suspense fallback={null}>
          <LiftAssumptionModal
            dayName={liftAssumptionPrompt.dayName}
            localDate={liftAssumptionPrompt.localDate}
            busy={liftAssumptionBusy}
            onNo={() => void dismissLiftAssumptionPrompt()}
            onSubmit={() => void submitLiftAssumptionPrompt()}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
