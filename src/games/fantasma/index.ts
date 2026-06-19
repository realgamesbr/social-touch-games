import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { drawEndScreen } from '../../core/helpers'

const META: GameMeta = {
  id: 'fantasma',
  title: 'Fantasma',
  emoji: '👻',
  tagline: 'Um joga de olhos fechados. Os outros guiam por voz.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#aa55ff',
}

const LEVEL_TIMEOUT = 45

type Phase = 'intro' | 'playing' | 'won' | 'failed'

interface Wall {
  x: number
  y: number
  w: number
  h: number
}

export class FantasmaGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'intro'
  private phaseElapsed = 0
  private walls: Wall[] = []
  private startZone = { x: 0, y: 0, r: 50 }
  private goalZone = { x: 0, y: 0, r: 50 }
  private ghostX = 0
  private ghostY = 0
  private ghostPointerId: number | null = null
  private level = 1
  private hits = 0
  private levelElapsed = 0
  private failReason = ''

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'intro'
    this.phaseElapsed = 0
    this.walls = []
    this.level = 1
    this.hits = 0
    this.levelElapsed = 0
    this.ghostPointerId = null
    this.resize()
    window.addEventListener('resize', this.resize)
    this.generateLevel()
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const points = this.touch.getPoints()
    switch (this.phase) {
      case 'intro': this.runIntro(points); break
      case 'playing': this.runPlaying(points, dt); break
      case 'won':
        drawEndScreen(ctx, canvas, true, `NÍVEL ${this.level} ✓`, `${this.hits} batidas em paredes`)
        if (this.phaseElapsed >= 2.5) {
          this.level++
          this.hits = 0
          this.generateLevel()
          this.phase = 'intro'
          this.phaseElapsed = 0
        }
        break
      case 'failed':
        drawEndScreen(ctx, canvas, false, 'FIM', this.failReason)
        break
    }
  }

  destroy() {
    window.removeEventListener('resize', this.resize)
  }

  private resize = () => {
    this.canvas.width = this.canvas.offsetWidth
    this.canvas.height = this.canvas.offsetHeight
  }

  private generateLevel() {
    const w = this.canvas.width
    const h = this.canvas.height
    const margin = 50
    this.startZone = { x: margin + 30, y: h / 2, r: 50 }
    this.goalZone = { x: w - margin - 30, y: h / 2, r: 50 }
    this.ghostX = this.startZone.x
    this.ghostY = this.startZone.y
    this.walls = []
    // Paredes verticais aleatórias
    const wallCount = 2 + this.level
    for (let i = 0; i < wallCount; i++) {
      for (let attempts = 0; attempts < 30; attempts++) {
        const x = margin + 120 + Math.random() * (w - margin * 2 - 240) - 15
        const wallH = 80 + Math.random() * (h * 0.5 - Math.min(this.level * 10, 80))
        const y = Math.random() * (h - wallH)
        const wall: Wall = { x, y, w: 24, h: wallH }
        // não pode bloquear totalmente o caminho
        let ok = true
        // não sobreposto com outras
        for (const other of this.walls) {
          if (this.rectOverlap(wall, other, 30)) { ok = false; break }
        }
        if (ok) { this.walls.push(wall); break }
      }
    }
  }

  private rectOverlap(a: Wall, b: Wall, pad: number) {
    return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x ||
             a.y + a.h + pad < b.y || b.y + b.h + pad < a.y)
  }

  private runIntro(_points: Map<number, TouchPoint>) {
    const { ctx, canvas } = this
    this.drawLevel()
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.06, 26)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(`NÍVEL ${this.level}`, cx, cy - 30)
    ctx.fillStyle = '#aa55ff'
    ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.fillText('Um fecha os olhos, os outros falam', cx, cy + 5)
    ctx.fillStyle = '#888'
    ctx.fillText('Toque na bolinha verde pra começar', cx, cy + 30)

    // Detecta toque na startZone
    for (const [id, pt] of _points) {
      if (!pt.active) continue
      if (Math.hypot(pt.x - this.startZone.x, pt.y - this.startZone.y) < this.startZone.r) {
        this.ghostPointerId = id
        this.phase = 'playing'
        this.phaseElapsed = 0
        this.levelElapsed = 0
        break
      }
    }
  }

  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.levelElapsed += dt
    if (this.levelElapsed >= LEVEL_TIMEOUT) {
      this.failReason = 'Tempo esgotado'
      this.phase = 'failed'
      this.session.end()
      return
    }
    if (this.ghostPointerId === null || !points.get(this.ghostPointerId)?.active) {
      this.failReason = 'Soltou o dedo'
      this.phase = 'failed'
      this.session.end()
      return
    }

    const pt = points.get(this.ghostPointerId)!
    this.ghostX = pt.x
    this.ghostY = pt.y

    // Colisão com parede
    for (const wall of this.walls) {
      if (this.ghostX > wall.x && this.ghostX < wall.x + wall.w &&
          this.ghostY > wall.y && this.ghostY < wall.y + wall.h) {
        this.hits++
        this.session.addScore(-20)
      }
    }

    // Chegou no goal?
    if (Math.hypot(this.ghostX - this.goalZone.x, this.ghostY - this.goalZone.y) < this.goalZone.r) {
      const bonus = Math.max(50, 300 - this.hits * 20 - Math.floor(this.levelElapsed) * 3) * this.level
      this.session.addScore(bonus)
      this.phase = 'won'
      this.phaseElapsed = 0
      return
    }

    this.drawLevel()
    this.drawGhost()
    this.drawPlayingHUD()
  }

  private drawLevel() {
    const { ctx } = this
    // Start
    ctx.beginPath()
    ctx.arc(this.startZone.x, this.startZone.y, this.startZone.r, 0, Math.PI * 2)
    ctx.strokeStyle = '#00e676'
    ctx.lineWidth = 3
    ctx.shadowBlur = 24
    ctx.shadowColor = '#00e676'
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#00e67630'
    ctx.fill()
    // Goal
    ctx.beginPath()
    ctx.arc(this.goalZone.x, this.goalZone.y, this.goalZone.r, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffab40'
    ctx.lineWidth = 3
    ctx.shadowBlur = 24
    ctx.shadowColor = '#ffab40'
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#ffab4030'
    ctx.fill()
    // Walls
    for (const wall of this.walls) {
      ctx.fillStyle = '#aa55ff'
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h)
      ctx.strokeStyle = '#cc88ff'
      ctx.lineWidth = 1
      ctx.strokeRect(wall.x, wall.y, wall.w, wall.h)
    }
  }

  private drawGhost() {
    const { ctx } = this
    const pulse = 6 + Math.sin(this.phaseElapsed * 6) * 6
    ctx.beginPath()
    ctx.arc(this.ghostX, this.ghostY, 42 + pulse, 0, Math.PI * 2)
    ctx.fillStyle = '#aa55ff20'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(this.ghostX, this.ghostY, 28 + pulse, 0, Math.PI * 2)
    ctx.fillStyle = '#aa55ff50'
    ctx.fill()
    ctx.strokeStyle = '#aa55ff'
    ctx.lineWidth = 3
    ctx.shadowBlur = 28
    ctx.shadowColor = '#aa55ff'
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = '#fff'
    ctx.font = 'bold 26px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('👻', this.ghostX, this.ghostY)
  }

  private drawPlayingHUD() {
    const { ctx, canvas } = this
    const remaining = Math.ceil(LEVEL_TIMEOUT - this.levelElapsed)
    ctx.fillStyle = '#888'
    ctx.font = `bold ${Math.min(canvas.width * 0.035, 14)}px system-ui`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`NÍVEL ${this.level}`, 16, 16)
    ctx.fillStyle = remaining < 10 ? '#ff4444' : '#888'
    ctx.fillText(`${remaining}s`, 16, 36)
    ctx.fillStyle = '#ff4444'
    ctx.font = `bold ${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.textAlign = 'right'
    ctx.fillText(`${this.hits} batidas`, canvas.width - 16, 16)
  }
}

export const fantasmaGame = new FantasmaGame()
