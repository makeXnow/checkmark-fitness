import { useEffect, useState } from 'react'

export type VisualViewportBox = {
  top: number
  left: number
  width: number
  height: number
}

function readVisualViewportBox(): VisualViewportBox {
  if (typeof window === 'undefined') {
    return { top: 0, left: 0, width: 0, height: 0 }
  }
  const vv = window.visualViewport
  if (vv) {
    return {
      top: vv.offsetTop,
      left: vv.offsetLeft,
      width: vv.width,
      height: vv.height,
    }
  }
  return {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  }
}

/** Visible viewport box — shrinks/moves when the on-screen keyboard is open. */
export function useVisualViewportBox(): VisualViewportBox {
  const [box, setBox] = useState(readVisualViewportBox)

  useEffect(() => {
    const update = () => setBox(readVisualViewportBox())
    update()
    const vv = window.visualViewport
    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return box
}
