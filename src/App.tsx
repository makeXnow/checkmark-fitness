import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
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
import { fetchBootstrap, patchAppState, putHabits, putLift, putMacro } from './core/api'
import { localDateISO } from './lib/localDate'
import type {
  AppStateRow,
  BootstrapResponse,
  BottomTab,
  HabitsGoals,
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

function TabFallback() {
  return (
    <div className="flex-1 flex items-center justify-center py-24">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
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
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const data = await fetchBootstrap()
      setBoot(data)
    } catch (e) {
      const base = e instanceof Error ? e.message : 'Failed to load'
      const apiDown =
        base === 'Internal Server Error' ||
        base === 'Failed to fetch' ||
        base.includes('NetworkError') ||
        base.includes('ECONNREFUSED')
      const hint = apiDown
        ? ' Run `npm run dev` in the project folder — it starts both the web app (9024) and the API worker (8787).'
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

  const habitsGoals = boot?.habits.goals as HabitsGoals
  const habitsLogs = boot?.habits.logs || {}
  const habitsSettings = boot?.habits.appSettings || { firstDayOfWeek: 0 }

  const macroGoals = boot?.macro.goals || { calorieGoal: 2000, proteinPctGoal: 30 }
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

  const mergeAppState = useCallback((row: AppStateRow) => {
    setBoot((prev) => (prev ? { ...prev, appState: row as AppStateRow } : prev))
  }, [])

  const persistAppState = useCallback(
    async (patch: Parameters<typeof patchAppState>[0]) => {
      const res = await patchAppState(patch)
      mergeAppState(res.appState)
    },
    [mergeAppState],
  )

  const changeDate = useCallback(
    async (delta: number) => {
      const next = new Date(currentDate)
      next.setDate(next.getDate() + delta)
      await persistAppState({ selected_date: localDateISO(next) })
    },
    [currentDate, persistAppState],
  )

  const todayDateStr = localDateISO(new Date())
  const isTodaySelected = selectedDateStr === todayDateStr

  const goToToday = useCallback(async () => {
    await persistAppState({ selected_date: todayDateStr })
  }, [persistAppState, todayDateStr])

  const setTab = useCallback(
    async (tab: BottomTab) => {
      await persistAppState({ selected_tab: tab })
    },
    [persistAppState],
  )

  /** Bottom nav: in settings mode, switches which feature’s settings are shown; otherwise switches tracker tab. */
  const selectBottomTab = useCallback(
    async (tab: BottomTab) => {
      if (settingsOpen) {
        await persistAppState({
          selected_tab: tab,
          settings_section: tab as SettingsSection,
          settings_open: true,
        })
      } else if (tab === 'lift') {
        await persistAppState({ selected_tab: tab, lift_sub_route: 'workout' })
      } else {
        await setTab(tab)
      }
    },
    [persistAppState, setTab, settingsOpen],
  )

  const navActiveTab: BottomTab = settingsOpen ? (settingsSection as BottomTab) : selectedTab

  const openSettings = useCallback(async () => {
    await persistAppState({ settings_open: true, settings_section: selectedTab as unknown as SettingsSection })
  }, [persistAppState, selectedTab])

  const closeSettings = useCallback(async () => {
    await persistAppState({ settings_open: false })
  }, [persistAppState])

  const setLiftDayIndex = useCallback(
    async (idx: number) => {
      await persistAppState({ lift_current_day_index: idx })
    },
    [persistAppState],
  )

  useEffect(() => {
    if (sortedLiftDays.length === 0) return
    if (safeLiftDayIndex !== rawLiftDayIndex) {
      void setLiftDayIndex(safeLiftDayIndex)
    }
  }, [rawLiftDayIndex, safeLiftDayIndex, setLiftDayIndex, sortedLiftDays.length])

  const saveHabitsBundle = useCallback(
    async (next: { goals?: HabitsGoals; logs?: Record<string, DayLog>; appSettings?: { firstDayOfWeek: number } }) => {
      if (!boot) return
      const goals = next.goals ?? habitsGoals
      const logs = next.logs ?? habitsLogs
      const appSettings = next.appSettings ?? habitsSettings
      await putHabits({ goals, logs, appSettings })
      setBoot((prev) =>
        prev
          ? {
              ...prev,
              habits: { goals, logs, appSettings, updatedAt: Date.now() },
            }
          : prev,
      )
    },
    [boot, habitsGoals, habitsLogs, habitsSettings],
  )

  const saveMacroBundle = useCallback(
    async (next: {
      goals?: typeof macroGoals
      logs?: Record<string, MacroDayItem[]>
      customFoods?: MacroCustomFood[]
    }) => {
      if (!boot) return
      const goals = next.goals ?? macroGoals
      const logs = next.logs ?? macroLogs
      const customFoods = next.customFoods ?? macroFoods
      await putMacro({ goals, customFoods, logs })
      setBoot((prev) =>
        prev
          ? {
              ...prev,
              macro: { goals, customFoods, logs, updatedAt: Date.now() },
            }
          : prev,
      )
    },
    [boot, macroFoods, macroGoals, macroLogs],
  )

  const saveLiftBundle = useCallback(
    async (next: LiftPayload) => {
      if (!boot) return
      await putLift(next)
      setBoot((prev) =>
        prev
          ? {
              ...prev,
              lift: { payload: next, updatedAt: Date.now() },
            }
          : prev,
      )
    },
    [boot],
  )

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
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [selectedTab, liftSubRoute])

  if (error) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-8 gap-4">
        <p className="text-sm text-neutral-400">{error}</p>
        <button type="button" onClick={() => void load()} className="px-4 py-2 rounded-xl bg-emerald-400 text-black font-black">
          Retry
        </button>
      </div>
    )
  }

  if (!boot || !appState) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    )
  }

  return (
    <div
      id="app-root"
      className="min-h-screen bg-black font-sans antialiased text-white selection:bg-emerald-400/30 overflow-x-hidden flex flex-col relative"
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
            {!settingsOpen &&
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
        className="flex-1 w-full max-w-[var(--app-max-width)] mx-auto px-[var(--app-pad-x)] flex flex-col pt-[var(--app-main-pad-top)] pb-[var(--app-main-pad-bottom)]"
      >
        {settingsOpen ? (
          <div className="flex-1 flex flex-col space-y-6 animate-in fade-in duration-300">
            {settingsSection === 'habits' && (
              <Suspense fallback={<TabFallback />}>
                <HabitsScreen
                  currentDate={currentDate}
                  goals={habitsGoals}
                  logs={habitsLogs}
                  appSettings={habitsSettings}
                  view="settings"
                  onSaveGoals={(g) => void saveHabitsBundle({ goals: g })}
                  onSaveLogs={(l) => void saveHabitsBundle({ logs: l })}
                  onSaveAppSettings={(s) => void saveHabitsBundle({ appSettings: s })}
                />
              </Suspense>
            )}
            {settingsSection === 'macro' && (
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
            )}
            {settingsSection === 'lift' && (
              <Suspense fallback={<TabFallback />}>
                <LiftScreen
                  payload={liftPayload}
                  subRoute={liftSubRoute}
                  currentDayIndex={safeLiftDayIndex}
                  onDayIndexChange={(i) => void setLiftDayIndex(i)}
                  view="settings"
                  onPersist={(next) => void saveLiftBundle(next)}
                />
              </Suspense>
            )}
          </div>
        ) : (
          <>
            {selectedTab === 'habits' && (
              <Suspense fallback={<TabFallback />}>
                <HabitsScreen
                  currentDate={currentDate}
                  goals={habitsGoals}
                  logs={habitsLogs}
                  appSettings={habitsSettings}
                  view="tracker"
                  onSaveGoals={(g) => void saveHabitsBundle({ goals: g })}
                  onSaveLogs={(l) => void saveHabitsBundle({ logs: l })}
                  onSaveAppSettings={(s) => void saveHabitsBundle({ appSettings: s })}
                />
              </Suspense>
            )}
            {selectedTab === 'macro' && (
              <Suspense fallback={<TabFallback />}>
                <MacroScreen
                  currentDate={currentDate}
                  goals={macroGoals}
                  logs={macroLogs}
                  customFoods={macroFoods}
                  view="tracker"
                  onSaveGoals={(g) => void saveMacroBundle({ goals: g })}
                  onSaveLogs={(l) => void saveMacroBundle({ logs: l })}
                  onSaveFoods={(foods) => void saveMacroBundle({ customFoods: foods })}
                />
              </Suspense>
            )}
            {selectedTab === 'lift' && (
              <Suspense fallback={<TabFallback />}>
                <LiftScreen
                  payload={liftPayload}
                  subRoute={liftSubRoute}
                  currentDayIndex={safeLiftDayIndex}
                  onDayIndexChange={(i) => void setLiftDayIndex(i)}
                  view="tracker"
                  onPersist={(next) => void saveLiftBundle(next)}
                  onSeeAllLog={() => void persistAppState({ lift_sub_route: 'log' })}
                />
              </Suspense>
            )}
          </>
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
    </div>
  )
}
