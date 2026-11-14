/** Bound the whole operation, including a stalled response body, on older browsers too. */
export async function withRequestTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  message: string,
  parentSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancel: (() => void) | undefined
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => {
      controller.abort()
      reject(new DOMException('Request cancelled', 'AbortError'))
    }
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error(message))
    }, timeoutMs)
    parentSignal?.addEventListener('abort', cancel, { once: true })
    if (parentSignal?.aborted) cancel()
  })
  try {
    return await Promise.race([deadline, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError')
      return run(controller.signal)
    })])
  } finally {
    clearTimeout(timer)
    if (cancel) parentSignal?.removeEventListener('abort', cancel)
  }
}
