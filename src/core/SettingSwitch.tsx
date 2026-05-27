type ToggleSwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}

export function ToggleSwitch({ checked, onCheckedChange, ariaLabel, disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`inline-flex h-7 w-12 shrink-0 items-center overflow-hidden rounded-full border-0 p-0.5 transition-colors disabled:opacity-40 ${
        checked ? 'bg-emerald-400' : 'bg-neutral-700'
      }`}
    >
      <span
        aria-hidden
        className={`block size-6 shrink-0 rounded-full bg-white shadow-sm transition-transform duration-200 ease-in-out ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

type SettingSwitchProps = ToggleSwitchProps & {
  label: string
  description?: string
}

export function SettingSwitch({ label, description, ...switchProps }: SettingSwitchProps) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">{label}</span>
        <ToggleSwitch {...switchProps} />
      </div>
      {description ? <p className="mt-1 text-xs text-neutral-500">{description}</p> : null}
    </div>
  )
}
