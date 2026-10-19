import { useEffect, useRef } from 'react'
import { useReducedMotion } from '../hooks/useReducedMotion'

/**
 * "Connected intelligence" ambient visual: a quiet constellation of drifting
 * nodes with thin connection lines. Static frame when reduced motion is set;
 * pauses when the tab is hidden. Purely decorative (aria-hidden).
 */
export function NodeField(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null) return
    const ctx = canvas.getContext('2d')
    if (ctx === null) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = 0
    let height = 0
    let raf = 0

    interface Node {
      x: number
      y: number
      vx: number
      vy: number
      r: number
      violet: boolean
    }
    let nodes: Node[] = []

    const seed = () => {
      const count = Math.min(46, Math.max(16, Math.round((width * height) / 26000)))
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
        r: 1.2 + Math.random() * 1.8,
        violet: Math.random() < 0.3,
      }))
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      seed()
    }

    const cyan = 'rgba(62, 224, 230, 0.5)'
    const violet = 'rgba(143, 123, 247, 0.45)'

    const draw = (move: boolean) => {
      ctx.clearRect(0, 0, width, height)
      if (move) {
        for (const n of nodes) {
          n.x += n.vx
          n.y += n.vy
          if (n.x <= 0 || n.x >= width) n.vx *= -1
          if (n.y <= 0 || n.y >= height) n.vy *= -1
        }
      }
      const maxDist = Math.min(170, Math.max(90, width / 3.4))
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i]!
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!
          const dx = a.x - b.x
          const dy = a.y - b.y
          const d2 = dx * dx + dy * dy
          if (d2 < maxDist * maxDist) {
            const alpha = (1 - Math.sqrt(d2) / maxDist) * 0.15
            ctx.strokeStyle = `rgba(120, 150, 200, ${alpha.toFixed(3)})`
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
      }
      for (const n of nodes) {
        ctx.fillStyle = n.violet ? violet : cyan
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const step = () => {
      draw(true)
      raf = window.requestAnimationFrame(step)
    }

    resize()
    draw(false)

    const ro = new ResizeObserver(() => {
      resize()
      if (reduced) draw(false)
    })
    ro.observe(canvas)

    if (!reduced) raf = window.requestAnimationFrame(step)

    const onVisibility = () => {
      window.cancelAnimationFrame(raf)
      if (!reduced && !document.hidden) raf = window.requestAnimationFrame(step)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reduced])

  return <canvas ref={canvasRef} className="node-field" aria-hidden="true" />
}
