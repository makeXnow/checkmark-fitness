import type { FatSecretRoute } from '../../types/domain'

export function fatSecretRouteChipMeta(route: FatSecretRoute): {
  label: string
  title: string
  className: string
} {
  switch (route) {
    case 'computer':
      return {
        label: 'Your computer',
        title: 'FatSecret search ran on your machine (local dev API)',
        className: 'bg-amber-500/15 text-amber-200 border-amber-400/35',
      }
    case 'cloud':
      return {
        label: 'Phone / cloud',
        title: 'FatSecret search ran on the deployed Worker (direct, no home relay)',
        className: 'bg-sky-500/15 text-sky-200 border-sky-400/35',
      }
    case 'relay':
      return {
        label: 'Home relay',
        title: 'FatSecret search was proxied through your computer via tunnel',
        className: 'bg-violet-500/15 text-violet-200 border-violet-400/35',
      }
  }
}

export function FatSecretRouteChip({ route }: { route: FatSecretRoute }) {
  const meta = fatSecretRouteChipMeta(route)
  return (
    <span
      title={meta.title}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${meta.className}`}
    >
      {meta.label}
    </span>
  )
}
