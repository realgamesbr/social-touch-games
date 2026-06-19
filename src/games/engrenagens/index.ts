import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { COLORS, updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen, alphaHex } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'

const META: GameMeta = {
  id: 'engrenagens',
  title: 'Engrenagens',
  emoji: '⚙️',
  tagline: 'Girem juntos. Cada engrenagem alterna o sentido.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#ffab40',
}

const GAME_DURATION = 60
const TARGET_ANGULAR_SPEED = Math.PI * 2 / 3   // 1 volta a cada 3s
const SPEED_TOLERANCE = 1.4                    // rad/s tolerância
const DIRECTION_TOLERANCE = 0.3
const TOUCH_RADIUS = 80

type Phase = 'checkin' | 'playing' | 'gameover'

interface Gear {
  playerIdx: number
  color: string
  cx: number
  cy: number
  r: number
  direction: 1 | -1     // CW (+1) ou CCW (-1)
  lastAngle: number
  measuredSpeed: number
  inSyncTime: number
  pointerId: number | null
}

export class EngrenagensGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  private players: CheckinPlayer[] = []
  private gears: Gear[] = []
  private gameElapsed = 0
  private scoreAccum = 0

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'checkin'
    this.phaseElapsed = 0
    this.players = []
    this.gears = []
    this.gameElapsed = 0
    this.scoreAccum = 0
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    ctx.fillStyle = '#16100a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const points = this.touch.getPoints()
    switch (this.phase) {
      case 'checkin': this.runCheckin(points); break
      case 'playing': this.runPlaying(points, dt); break
      case 'gameover':
        drawEndScreen(ctx, canvas, true, 'MÁQUINA PARADA',
          `Sincronia média: ${this.gears.length > 0 ? (this.gears.reduce((s, g) => s + g.inSyncTime, 0) / this.gears.length).toFixed(1) : 0}s`)
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

  private runCheckin(points: Map<number, TouchPoint>) {
    const r = updateCheckin(this, points, this.meta.minPlayers, this.meta.maxPlayers)
    if (r.done) { this.startPlaying(); return }
    for (const p of this.players) drawPlayerHalo(this.ctx, p.x, p.y, p.color, this.phaseElapsed, { pulsing: true })
    drawCheckinHUD(this.ctx, this.canvas, this, this.meta.minPlayers, this.meta.maxPlayers,
      r.remaining, r.canStart, this.meta.color,
      '2 a 6 jogadores · máquina de precisão',
      'cada um vai girar uma engrenagem')
  }

  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.gameElapsed = 0
    const n = this.players.length
    const w = this.canvas.width
    const h = this.canvas.height
    const gearR = Math.min(w / (n + 1), h / 2, 100)
    const totalWidth = n * gearR * 2.4
    const startX = (w - totalWidth) / 2 + gearR
    const cy = h / 2
    this.gears = []
    for (let i = 0; i < n; i++) {
      this.gears.push({
        playerIdx: i,
        color: COLORS[i],
        cx: startX + i * gearR * 2.4,
        cy,
        r: gearR,
        direction: i % 2 === 0 ? 1 : -1,
        lastAngle: 0,
        measuredSpeed: 0,
        inSyncTime: 0,
        pointerId: null,
      })
    }
  }

  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.gameElapsed += dt
    if (this.gameElapsed >= GAME_DURATION) {
      this.phase = 'gameover'
      this.session.end()
      return
    }

    // Associa pointers a engrenagens (1 dedo por engrenagem)
    const usedIds = new Set<number>()
    for (const g of this.gears) {
      if (g.pointerId !== null) {
        const pt = points.get(g.pointerId)
        if (!pt || !pt.active) g.pointerId = null
        else usedIds.add(g.pointerId)
      }
    }
    for (const [id, pt] of points) {
      if (!pt.active || usedIds.has(id)) continue
      let best: Gear | null = null
      let bestD = TOUCH_RADIUS + 40
      for (const g of this.gears) {
        if (g.pointerId !== null) continue
        const d = Math.hypot(pt.x - g.cx, pt.y - g.cy)
        // só se está no anel da engrenagem (não no centro)
        if (d > g.r * 0.4 && d < g.r * 1.2 && d < bestD) { bestD = d; best = g }
      }
      if (best) {
        best.pointerId = id
        best.lastAngle = Math.atan2(pt.y - best.cy, pt.x - best.cx)
        usedIds.add(id)
      }
    }

    let syncCount = 0
    for (const g of this.gears) {
      if (g.pointerId !== null) {
        const pt = points.get(g.pointerId)
        if (pt) {
          const angle = Math.atan2(pt.y - g.cy, pt.x - g.cx)
          let delta = angle - g.lastAngle
          // unwrap
          if (delta > Math.PI) delta -= Math.PI * 2
          if (delta < -Math.PI) delta += Math.PI * 2
          g.measuredSpeed = g.measuredSpeed * 0.7 + (delta / Math.max(dt, 0.001)) * 0.3
          g.lastAngle = angle

          // Calcula erro vs alvo
          const targetSpeed = TARGET_ANGULAR_SPEED * g.direction
          const speedErr = Math.abs(g.measuredSpeed - targetSpeed)
          // direção certa
          const dirOk = Math.sign(g.measuredSpeed) === g.direction || Math.abs(g.measuredSpeed) < DIRECTION_TOLERANCE
          if (speedErr < SPEED_TOLERANCE && dirOk && Math.abs(g.measuredSpeed) > 0.6) {
            g.inSyncTime += dt
            syncCount++
          }
        }
      } else {
        g.measuredSpeed *= 0.9
      }
    }

    // Score
    const rate = syncCount * 10 + (syncCount === this.gears.length ? syncCount * 15 : 0)
    this.scoreAccum += rate * dt
    const whole = Math.floor(this.scoreAccum)
    if (whole > 0) { this.session.addScore(whole); this.scoreAccum -= whole }

    this.drawGears()
    this.drawPlayingHUD(syncCount)
  }

  private drawGears() {
    const { ctx } = this
    for (const g of this.gears) {
      // Dentes
      const teeth = 12
      const innerR = g.r * 0.7
      const outerR = g.r
      const targetSpeed = TARGET_ANGULAR_SPEED * g.direction
      const speedErr = Math.abs(g.measuredSpeed - targetSpeed)
      const dirOk = Math.sign(g.measuredSpeed) === g.direction || Math.abs(g.measuredSpeed) < DIRECTION_TOLERANCE
      const inSync = speedErr < SPEED_TOLERANCE && dirOk && Math.abs(g.measuredSpeed) > 0.6
      const baseAngle = g.lastAngle
      ctx.beginPath()
      for (let i = 0; i <= teeth * 2; i++) {
        const a = baseAngle + (i / (teeth * 2)) * Math.PI * 2
        const r = i % 2 === 0 ? outerR : innerR
        const x = g.cx + Math.cos(a) * r
        const y = g.cy + Math.sin(a) * r
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = g.color + alphaHex(inSync ? 0.4 : 0.18)
      ctx.fill()
      ctx.strokeStyle = g.color
      ctx.lineWidth = 3
      ctx.shadowBlur = inSync ? 28 : 12
      ctx.shadowColor = g.color
      ctx.stroke()
      ctx.shadowBlur = 0
      // Núcleo
      ctx.beginPath()
      ctx.arc(g.cx, g.cy, innerR * 0.4, 0, Math.PI * 2)
      ctx.fillStyle = '#0d0d0d'
      ctx.fill()
      ctx.strokeStyle = g.color
      ctx.lineWidth = 2
      ctx.stroke()
      // Seta de direção
      ctx.fillStyle = g.color
      ctx.font = `bold ${Math.round(g.r * 0.3)}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(g.direction === 1 ? '↻' : '↺', g.cx, g.cy)
    }
  }

  private drawPlayingHUD(syncCount: number) {
    const { ctx, canvas } = this
    const remaining = Math.ceil(GAME_DURATION - this.gameElapsed)
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${remaining}s`, canvas.width / 2, 16)
    ctx.fillStyle = syncCount === this.gears.length ? '#00e676' : this.meta.color
    ctx.font = `bold ${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.fillText(`${syncCount}/${this.gears.length} girando certo`, canvas.width / 2, 44)
  }
}

export const engrenagensGame = new EngrenagensGame()
