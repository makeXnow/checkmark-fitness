import confetti from 'canvas-confetti'

const RAINBOW_COLORS = ['#ff0000', '#ff7f00', '#ffff00', '#00ff00', '#0000ff', '#4b0082', '#9400d3']
const BURST_DURATION_MS = 1000

export function fireConfettiFromElement(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  const x = (rect.left + rect.width / 2) / window.innerWidth
  const y = (rect.top + rect.height / 2) / window.innerHeight

  const animationEnd = Date.now() + BURST_DURATION_MS
  let colorIndex = 0

  const interval = window.setInterval(() => {
    const timeLeft = animationEnd - Date.now()

    if (timeLeft <= 0) {
      window.clearInterval(interval)
      return
    }

    void confetti({
      particleCount: 1,
      spread: 80,
      origin: { x, y },
      colors: [RAINBOW_COLORS[colorIndex % RAINBOW_COLORS.length]],
      ticks: 1000,
      startVelocity: 25 + Math.random() * 15,
    })

    colorIndex++
  }, 1)
}
