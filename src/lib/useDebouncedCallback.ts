import { useCallback, useEffect, useRef } from 'react'

export function useDebouncedCallback<T extends (...args: never[]) => void>(
  fn: T,
  delayMs: number,
): { run: (...args: Parameters<T>) => void; cancel: () => void } {
  const fnRef = useRef(fn)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  fnRef.current = fn

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const run = useCallback(
    (...args: Parameters<T>) => {
      cancel()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        fnRef.current(...args)
      }, delayMs)
    },
    [cancel, delayMs],
  )

  useEffect(() => cancel, [cancel])

  return { run, cancel }
}
