export interface TouchPoint {
  id: number
  x: number
  y: number
  startX: number
  startY: number
  startTime: number
  active: boolean
}

type TouchHandler = (points: Map<number, TouchPoint>) => void

const GRACE_PERIOD_MS = 180

export class TouchManager {
  private points = new Map<number, TouchPoint>()
  private graceTimers = new Map<number, ReturnType<typeof setTimeout>>()
  private handlers = new Set<TouchHandler>()
  private el: HTMLElement

  constructor(el: HTMLElement) {
    this.el = el
    el.addEventListener('pointerdown', this.onDown)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerup', this.onUp)
    el.addEventListener('pointercancel', this.onUp)
    el.style.touchAction = 'none'
  }

  subscribe(fn: TouchHandler) {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  getPoints() {
    return this.points
  }

  destroy() {
    this.el.removeEventListener('pointerdown', this.onDown)
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerup', this.onUp)
    this.el.removeEventListener('pointercancel', this.onUp)
    this.graceTimers.forEach(clearTimeout)
  }

  private emit() {
    this.handlers.forEach(fn => fn(this.points))
  }

  private onDown = (e: PointerEvent) => {
    e.preventDefault()
    this.el.setPointerCapture(e.pointerId)
    if (this.graceTimers.has(e.pointerId)) {
      clearTimeout(this.graceTimers.get(e.pointerId))
      this.graceTimers.delete(e.pointerId)
    }
    const rect = this.el.getBoundingClientRect()
    const pt: TouchPoint = {
      id: e.pointerId,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      startX: e.clientX - rect.left,
      startY: e.clientY - rect.top,
      startTime: Date.now(),
      active: true,
    }
    this.points.set(e.pointerId, pt)
    this.emit()
  }

  private onMove = (e: PointerEvent) => {
    const pt = this.points.get(e.pointerId)
    if (!pt) return
    const rect = this.el.getBoundingClientRect()
    pt.x = e.clientX - rect.left
    pt.y = e.clientY - rect.top
    this.emit()
  }

  private onUp = (e: PointerEvent) => {
    const pt = this.points.get(e.pointerId)
    if (!pt) return
    pt.active = false
    const timer = setTimeout(() => {
      this.points.delete(e.pointerId)
      this.graceTimers.delete(e.pointerId)
      this.emit()
    }, GRACE_PERIOD_MS)
    this.graceTimers.set(e.pointerId, timer)
    this.emit()
  }
}
