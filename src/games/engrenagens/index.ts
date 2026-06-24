import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { COLORS, updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen, alphaHex } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'
import { drawBackground } from '../../core/background'

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
const BASE_TANGENTIAL = 175    // velocidade tangencial alvo (px/s) — compartilhada
const SPEED_TOLERANCE = 1.6    // rad/s tolerância (maior pois cada raio pede uma velocidade)
const DIRECTION_TOLERANCE = 0.3
const TOUCH_RADIUS = 80
const SIZE_INTERVAL = 5        // engrenagens trocam de tamanho a cada 5s
const SIZE_MULTS = [0.55, 0.72, 0.9, 1.1, 1.3, 1.5]  // tamanhos distintos
const GEAR_GAP = 26

type Phase = 'checkin' | 'playing' | 'gameover'

interface Gear {
  playerIdx: number
  color: string
  cx: number
  cy: number
  r: number
  targetR: number       // raio-alvo (animado a cada troca de tamanho)
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
  private baseR = 60
  private sizeTimer = 0

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
    drawBackground(ctx, canvas, '#ffab40')
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
    this.sizeTimer = 0
    const n = this.players.length
    const w = this.canvas.width
    const h = this.canvas.height

    // Multiplicadores distintos (uma permutação) → tamanhos diferentes.
    // Como é permutação, a soma é constante e a fileira sempre cabe na tela.
    const mults = SIZE_MULTS.slice(0, n)
    const sumMult = mults.reduce((s, m) => s + m, 0)
    // raio-base de modo que a fileira (com folgas) caiba na largura e na altura
    const availW = w - 40 - GEAR_GAP * (n - 1)
    this.baseR = Math.max(20, Math.min(availW / (2 * sumMult), h / 2.6, 95))

    this.shuffleArray(mults)
    this.gears = []
    for (let i = 0; i < n; i++) {
      const r = this.baseR * mults[i]
      this.gears.push({
        playerIdx: i,
        color: COLORS[i],
        cx: 0,
        cy: h / 2,
        r,
        targetR: r,
        direction: i % 2 === 0 ? 1 : -1,
        lastAngle: 0,
        measuredSpeed: 0,
        inSyncTime: 0,
        pointerId: null,
      })
    }
    this.layoutGears()
  }

  // Velocidade angular alvo de cada engrenagem: menor gira mais rápido
  // (mesma velocidade tangencial → razão de marcha real).
  private targetSpeedFor(g: Gear): number {
    return (BASE_TANGENTIAL / g.r) * g.direction
  }

  private shuffleArray<T>(arr: T[]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
  }

  // Reembaralha os tamanhos entre as engrenagens (permutação → soma constante).
  private shuffleSizes() {
    const mults = this.gears.map(g => g.targetR / this.baseR)
    this.shuffleArray(mults)
    this.gears.forEach((g, i) => { g.targetR = this.baseR * mults[i] })
  }

  // Posiciona a fileira centralizada a partir dos raios atuais.
  private layoutGears() {
    const n = this.gears.length
    if (!n) return
    let totalW = GEAR_GAP * (n - 1)
    for (const g of this.gears) totalW += g.r * 2
    let x = (this.canvas.width - totalW) / 2
    const cy = this.canvas.height / 2
    for (const g of this.gears) {
      g.cx = x + g.r
      g.cy = cy
      x += g.r * 2 + GEAR_GAP
    }
  }

  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.gameElapsed += dt
    if (this.gameElapsed >= GAME_DURATION) {
      this.phase = 'gameover'
      this.session.end()
      return
    }

    // Troca de tamanhos a cada 5s + animação suave dos raios
    this.sizeTimer += dt
    if (this.sizeTimer >= SIZE_INTERVAL) {
      this.sizeTimer -= SIZE_INTERVAL
      this.shuffleSizes()
    }
    for (const g of this.gears) g.r += (g.targetR - g.r) * Math.min(1, dt * 4)
    this.layoutGears()

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

          // Calcula erro vs alvo (alvo depende do tamanho atual da engrenagem)
          const targetSpeed = this.targetSpeedFor(g)
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
      const targetSpeed = this.targetSpeedFor(g)
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
