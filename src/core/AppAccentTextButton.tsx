import type { ButtonHTMLAttributes } from 'react'

export const appAccentTextButtonClass =
  'shrink-0 font-black text-[10px] uppercase tracking-[0.2em] text-emerald-400 transition-colors hover:text-emerald-300'

export function AppAccentTextButton({
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={className ? `${appAccentTextButtonClass} ${className}` : appAccentTextButtonClass}
      {...props}
    />
  )
}
