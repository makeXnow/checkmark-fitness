/**
 * Single source for habit accent `bg-*-500` values, done-card chrome, empty-dot borders, and settings dropdown.
 * Keep class names as string literals so Tailwind includes them.
 */
const HABIT_COLOR_PRESETS = [
  ['bg-emerald-500', 'bg-emerald-950', 'border-emerald-900/50', 'Emerald', 'border-emerald-700/55', 'border-emerald-800/35'],
  ['bg-green-500', 'bg-green-950', 'border-green-900/50', 'Green', 'border-green-700/55', 'border-green-800/35'],
  ['bg-lime-500', 'bg-lime-950', 'border-lime-900/50', 'Lime', 'border-lime-700/55', 'border-lime-800/35'],
  ['bg-teal-500', 'bg-teal-950', 'border-teal-900/50', 'Teal', 'border-teal-700/55', 'border-teal-800/35'],
  ['bg-cyan-500', 'bg-cyan-950', 'border-cyan-900/50', 'Cyan', 'border-cyan-700/55', 'border-cyan-800/35'],
  ['bg-sky-500', 'bg-sky-950', 'border-sky-900/50', 'Sky', 'border-sky-700/55', 'border-sky-800/35'],
  ['bg-blue-500', 'bg-blue-950', 'border-blue-900/50', 'Blue', 'border-blue-700/55', 'border-blue-800/35'],
  ['bg-indigo-500', 'bg-indigo-950', 'border-indigo-900/50', 'Indigo', 'border-indigo-700/55', 'border-indigo-800/35'],
  ['bg-violet-500', 'bg-violet-950', 'border-violet-900/50', 'Violet', 'border-violet-700/55', 'border-violet-800/35'],
  ['bg-purple-500', 'bg-purple-950', 'border-purple-900/50', 'Purple', 'border-purple-700/55', 'border-purple-800/35'],
  ['bg-fuchsia-500', 'bg-fuchsia-950', 'border-fuchsia-900/50', 'Fuchsia', 'border-fuchsia-700/55', 'border-fuchsia-800/35'],
  ['bg-pink-500', 'bg-pink-950', 'border-pink-900/50', 'Pink', 'border-pink-700/55', 'border-pink-800/35'],
  ['bg-rose-500', 'bg-rose-950', 'border-rose-900/50', 'Rose', 'border-rose-700/55', 'border-rose-800/35'],
  ['bg-red-500', 'bg-red-950', 'border-red-900/50', 'Red', 'border-red-700/55', 'border-red-800/35'],
  ['bg-orange-500', 'bg-orange-950', 'border-orange-900/50', 'Orange', 'border-orange-700/55', 'border-orange-800/35'],
  ['bg-amber-500', 'bg-amber-950', 'border-amber-900/50', 'Amber', 'border-amber-700/55', 'border-amber-800/35'],
  ['bg-yellow-500', 'bg-yellow-950', 'border-yellow-900/50', 'Yellow', 'border-yellow-700/55', 'border-yellow-800/35'],
  ['bg-slate-500', 'bg-slate-950', 'border-slate-900/50', 'Slate', 'border-slate-600/50', 'border-slate-700/35'],
  ['bg-gray-500', 'bg-gray-950', 'border-gray-900/50', 'Gray', 'border-gray-600/50', 'border-gray-700/35'],
  ['bg-zinc-500', 'bg-zinc-950', 'border-zinc-900/50', 'Zinc', 'border-zinc-600/50', 'border-zinc-700/35'],
  ['bg-neutral-500', 'bg-neutral-950', 'border-neutral-900/50', 'Neutral', 'border-neutral-600/50', 'border-neutral-700/35'],
  ['bg-stone-500', 'bg-stone-950', 'border-stone-900/50', 'Stone', 'border-stone-600/50', 'border-stone-700/35'],
] as const

export type HabitAccentBg = (typeof HABIT_COLOR_PRESETS)[number][0]

export const HABIT_COLOR_SELECT_OPTIONS: { value: HabitAccentBg; label: string }[] = HABIT_COLOR_PRESETS.map(
  ([value, , , label]) => ({ value, label }),
)

/** Neutrals excluded from the settings color picker (still valid for saved goals / styling). */
const HABIT_COLOR_PICKER_EXCLUDED = new Set<HabitAccentBg>([
  'bg-slate-500',
  'bg-gray-500',
  'bg-zinc-500',
  'bg-neutral-500',
  'bg-stone-500',
])

export const HABIT_COLOR_SWATCH_OPTIONS = HABIT_COLOR_SELECT_OPTIONS.filter((o) => !HABIT_COLOR_PICKER_EXCLUDED.has(o.value))

const PRESET_BG_SET = new Set<string>(HABIT_COLOR_PRESETS.map((p) => p[0]))

export function isHabitAccentBg(value: string): value is HabitAccentBg {
  return PRESET_BG_SET.has(value)
}

export function habitDoneCardClasses(bgClass: string): { surface: string; border: string } {
  const row = HABIT_COLOR_PRESETS.find((p) => p[0] === bgClass)
  if (!row) return { surface: 'bg-neutral-800', border: 'border-neutral-700' }
  return { surface: row[1], border: row[2] }
}

/** Muted habit-colored ring for unfilled dots when the goal card is “active” (done today or water in progress). */
export function habitEmptyDotBorderClass(bgClass: string, optional: boolean): string {
  const row = HABIT_COLOR_PRESETS.find((p) => p[0] === bgClass)
  if (!row) return optional ? 'border-neutral-700 opacity-30' : 'border-neutral-700'
  return optional ? row[5] : row[4]
}

/** Tailwind default `*-500` hex for inline conic gradients (opaque stops; avoids `transparent` glitches). */
const HABIT_ACCENT_FILL_HEX: Record<HabitAccentBg, string> = {
  'bg-emerald-500': '#10b981',
  'bg-green-500': '#22c55e',
  'bg-lime-500': '#84cc16',
  'bg-teal-500': '#14b8a6',
  'bg-cyan-500': '#06b6d4',
  'bg-sky-500': '#0ea5e9',
  'bg-blue-500': '#3b82f6',
  'bg-indigo-500': '#6366f1',
  'bg-violet-500': '#8b5cf6',
  'bg-purple-500': '#a855f7',
  'bg-fuchsia-500': '#d946ef',
  'bg-pink-500': '#ec4899',
  'bg-rose-500': '#f43f5e',
  'bg-red-500': '#ef4444',
  'bg-orange-500': '#f97316',
  'bg-amber-500': '#f59e0b',
  'bg-yellow-500': '#eab308',
  'bg-slate-500': '#64748b',
  'bg-gray-500': '#6b7280',
  'bg-zinc-500': '#71717a',
  'bg-neutral-500': '#737373',
  'bg-stone-500': '#78716c',
}

export function habitAccentFillHex(bgClass: string): string {
  return HABIT_ACCENT_FILL_HEX[bgClass as HabitAccentBg] ?? '#3b82f6'
}
