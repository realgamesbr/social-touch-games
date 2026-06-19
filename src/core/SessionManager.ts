export type GameState = 'idle' | 'playing' | 'gameover'

export interface SessionConfig {
  duration: number // seconds, 0 = endless
  minPlayers: number
  maxPlayers: number
}

type StateHandler = (state: GameState, score: number) => void

export class SessionManager {
  state: GameState = 'idle'
  score = 0
  elapsed = 0
  private config: SessionConfig
  private handlers = new Set<StateHandler>()
  private startTime = 0
  private rafId = 0

  constructor(config: SessionConfig) {
    this.config = config
  }

  subscribe(fn: StateHandler) {
    this.handlers.add(fn)
    return () => this.handlers.delete(fn)
  }

  start() {
    this.state = 'playing'
    this.score = 0
    this.elapsed = 0
    this.startTime = Date.now()
    this.tick()
    this.emit()
  }

  addScore(n: number) {
    this.score += n
    this.emit()
  }

  end() {
    this.state = 'gameover'
    cancelAnimationFrame(this.rafId)
    this.emit()
  }

  reset() {
    cancelAnimationFrame(this.rafId)
    this.state = 'idle'
    this.score = 0
    this.elapsed = 0
    this.emit()
  }

  destroy() {
    cancelAnimationFrame(this.rafId)
  }

  private tick = () => {
    this.elapsed = (Date.now() - this.startTime) / 1000
    if (this.config.duration > 0 && this.elapsed >= this.config.duration) {
      this.end()
      return
    }
    this.rafId = requestAnimationFrame(this.tick)
  }

  private emit() {
    this.handlers.forEach(fn => fn(this.state, this.score))
  }
}
