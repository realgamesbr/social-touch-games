import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { COLORS, updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'
import { drawBackground } from '../../core/background'

const META: GameMeta = {
  id: 'fantasma',
  title: 'Fantasma',
  emoji: '👻',
  tagline: 'Conduzam o fantasma de cima a baixo, um de cada vez. 3 batidas e fim.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#aa55ff',
}

const RUN_TIMEOUT = 35       // s por travessia de cada jogador
const GHOST_R = 22
const WALL_THICK = 26
const MAX_HITS = 3           // batidas (compartilhadas pela equipe na fase)

type Phase = 'checkin' | 'ready' | 'playing' | 'levelcomplete' | 'failed'

interface Wall {
  x: number
  y: number
  w: number
  h: number
  flash: number
}

interface MovingObstacle {
  x: number
  y: number
  r: number
  vx: number
  minX: number
  maxX: number
}

export class FantasmaGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  phase: Phase = 'checkin'
  phaseElapsed = 0
  players: CheckinPlayer[] = []
  private level = 1
  private currentPlayer = 0
  private completed = 0
  private hits = 0
  private walls: Wall[] = []
  private startZone = { x: 0, y: 0, r: 46 }
  private goalZone = { x: 0, y: 0, r: 46 }
  private obstacle: MovingObstacle | null = null
  private ghostX = 0
  private ghostY = 0
  private ghostPointerId: number | null = null
  private runElapsed = 0
  private wasInWall = false
  private wasInObstacle = false
  private failReason = ''

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'checkin'
    this.phaseElapsed = 0
    this.players = []
    this.level = 1
    this.currentPlayer = 0
    this.completed = 0
    this.hits = 0
    this.ghostPointerId = null
    this.failReason = ''
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    drawBackground(ctx, canvas, '#aa55ff')
    const points = this.touch.getPoints()
    switch (this.phase) {
      case 'checkin': this.runCheckin(points); break
      case 'ready': this.runReady(points); break
      case 'playing': this.runPlaying(points, dt); break
      case 'levelcomplete':
        this.drawLevel()
        drawEndScreen(ctx, canvas, true, `NÍVEL ${this.level} ✓`, `${this.players.length} atravessaram · ${this.hits}/${MAX_HITS} batidas`)
        if (this.phaseElapsed >= 2.5) {
          this.level++
          this.startLevel()
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

  // ─── CHECK-IN ───────────────────────────────────────────────────
  private runCheckin(points: Map<number, TouchPoint>) {
    const r = updateCheckin(this, points, this.meta.minPlayers, this.meta.maxPlayers)
    if (r.done) { this.startLevel(); return }
    for (const p of this.players) drawPlayerHalo(this.ctx, p.x, p.y, p.color, this.phaseElapsed, { pulsing: true })
    drawCheckinHUD(this.ctx, this.canvas, this, this.meta.minPlayers, this.meta.maxPlayers,
      r.remaining, r.canStart, this.meta.color,
      '2 a 6 jogadores · revezem a travessia',
      'cada um vai atravessar o labirinto na sua vez')
  }

  // ─── NÍVEL ──────────────────────────────────────────────────────
  private startLevel() {
    this.currentPlayer = 0
    this.completed = 0
    this.hits = 0
    this.generateLevel()
    this.toReady()
  }

  private generateLevel() {
    const w = this.canvas.width
    const h = this.canvas.height
    // Trajeto no sentido MAIOR (vertical): topo → base
    this.startZone = { x: w / 2, y: 54, r: 46 }
    this.goalZone = { x: w / 2, y: h - 54, r: 46 }

    // Paredes horizontais alternando o lado preso (esquerda/direita) com um vão
    // no lado oposto → fecham as laterais e obrigam um zigue-zague vertical.
    this.walls = []
    const rows = 2 + this.level
    const y0 = this.startZone.y + 90
    const y1 = this.goalZone.y - 90
    const gap = Math.max(110, 240 - this.level * 12)
    for (let i = 0; i < rows; i++) {
      const ry = y0 + ((i + 1) / (rows + 1)) * (y1 - y0)
      const leftAttached = i % 2 === 0
      const wx = leftAttached ? 0 : gap
      this.walls.push({ x: wx, y: ry - WALL_THICK / 2, w: w - gap, h: WALL_THICK, flash: 0 })
    }

    // Obstáculo móvel a partir da fase 3: corre na horizontal num corredor
    this.obstacle = null
    if (this.level >= 3) {
      // posiciona num corredor ENTRE duas paredes (nunca em cima de uma)
      const yRow = (k: number) => y0 + ((k + 1) / (rows + 1)) * (y1 - y0)
      const ri = Math.floor((rows - 1) / 2)
      const midY = (yRow(ri) + yRow(ri + 1)) / 2
      const speed = 90 + this.level * 14
      this.obstacle = {
        x: w / 2, y: midY, r: 26,
        vx: Math.random() < 0.5 ? speed : -speed,
        minX: 40, maxX: w - 40,
      }
    }
  }

  private toReady() {
    this.phase = 'ready'
    this.phaseElapsed = 0
    this.ghostPointerId = null
    this.ghostX = this.startZone.x
    this.ghostY = this.startZone.y
  }

  private currentColor(): string {
    return this.players[this.currentPlayer]?.color ?? COLORS[0]
  }

  // ─── READY (jogador da vez encosta no topo) ─────────────────────
  private runReady(points: Map<number, TouchPoint>) {
    this.drawLevel()
    const { ctx, canvas } = this
    const cx = canvas.width / 2

    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 24)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`NÍVEL ${this.level} · Jogador ${this.currentPlayer + 1}/${this.players.length}`, cx, 14)
    ctx.fillStyle = this.currentColor()
    ctx.font = `bold ${Math.min(canvas.width * 0.04, 17)}px system-ui`
    ctx.fillText('toque na bolinha do topo e desça até a base', cx, 46)

    // bolinha de partida na cor do jogador da vez
    drawPlayerHalo(ctx, this.startZone.x, this.startZone.y, this.currentColor(), this.phaseElapsed, { pulsing: true })

    for (const [id, pt] of points) {
      if (!pt.active) continue
      if (Math.hypot(pt.x - this.startZone.x, pt.y - this.startZone.y) < this.startZone.r) {
        this.ghostPointerId = id
        this.phase = 'playing'
        this.phaseElapsed = 0
        this.runElapsed = 0
        this.wasInWall = false
        this.wasInObstacle = false
        this.ghostX = pt.x
        this.ghostY = pt.y
        break
      }
    }
  }

  // ─── PLAYING ────────────────────────────────────────────────────
  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.runElapsed += dt
    // anima paredes/obstáculo
    for (const wall of this.walls) wall.flash = Math.max(0, wall.flash - dt * 2)
    this.moveObstacle(dt)

    if (this.runElapsed >= RUN_TIMEOUT) {
      this.fail(`Jogador ${this.currentPlayer + 1} demorou demais`)
      return
    }
    if (this.ghostPointerId === null || !points.get(this.ghostPointerId)?.active) {
      this.fail('Soltou o dedo no meio da travessia')
      return
    }

    const pt = points.get(this.ghostPointerId)!
    this.ghostX = pt.x
    this.ghostY = pt.y

    // Batida em parede (conta 1 por ENTRADA, não por frame)
    let inWall: Wall | null = null
    for (const wall of this.walls) {
      if (this.circleRect(this.ghostX, this.ghostY, GHOST_R, wall.x, wall.y, wall.w, wall.h)) { inWall = wall; break }
    }
    if (inWall && !this.wasInWall) { this.registerHit(); inWall.flash = 1 }
    this.wasInWall = !!inWall

    // Batida no obstáculo móvel
    let inObs = false
    if (this.obstacle) {
      inObs = Math.hypot(this.ghostX - this.obstacle.x, this.ghostY - this.obstacle.y) < this.obstacle.r + GHOST_R
    }
    if (inObs && !this.wasInObstacle) this.registerHit()
    this.wasInObstacle = inObs

    if (this.hits >= MAX_HITS) {
      this.fail('3 batidas — o fantasma desfez')
      return
    }

    // Chegou na base?
    if (Math.hypot(this.ghostX - this.goalZone.x, this.ghostY - this.goalZone.y) < this.goalZone.r) {
      this.completed++
      const bonus = Math.max(40, 260 - this.hits * 40 - Math.floor(this.runElapsed) * 3) * this.level
      this.session.addScore(bonus)
      if (this.completed >= this.players.length) {
        this.phase = 'levelcomplete'
        this.phaseElapsed = 0
      } else {
        this.currentPlayer = this.completed
        this.toReady()
      }
      return
    }

    this.drawLevel()
    this.drawGhost()
    this.drawPlayingHUD()
  }

  private moveObstacle(dt: number) {
    const o = this.obstacle
    if (!o) return
    o.x += o.vx * dt
    if (o.x - o.r < o.minX) { o.x = o.minX + o.r; o.vx = Math.abs(o.vx) }
    if (o.x + o.r > o.maxX) { o.x = o.maxX - o.r; o.vx = -Math.abs(o.vx) }
  }

  private registerHit() {
    this.hits++
    this.session.addScore(-25)
  }

  private fail(reason: string) {
    this.failReason = reason
    this.phase = 'failed'
    this.session.end()
  }

  private circleRect(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number): boolean {
    const nx = Math.max(rx, Math.min(cx, rx + rw))
    const ny = Math.max(ry, Math.min(cy, ry + rh))
    return Math.hypot(cx - nx, cy - ny) < r
  }

  // ─── DESENHO ────────────────────────────────────────────────────
  private drawLevel() {
    const { ctx } = this
    // Partida (verde, topo) e chegada (laranja, base)
    this.drawZone(this.startZone, '#00e676')
    this.drawZone(this.goalZone, '#ffab40')

    for (const wall of this.walls) {
      const hot = wall.flash
      ctx.fillStyle = hot > 0 ? `rgba(255,${Math.floor(80 - hot * 80)},${Math.floor(80 - hot * 80)},0.95)` : '#aa55ff'
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h)
      ctx.strokeStyle = hot > 0 ? '#ff4444' : '#cc88ff'
      ctx.lineWidth = 2
      ctx.shadowBlur = hot > 0 ? 24 : 8
      ctx.shadowColor = hot > 0 ? '#ff4444' : '#aa55ff'
      ctx.strokeRect(wall.x, wall.y, wall.w, wall.h)
      ctx.shadowBlur = 0
    }

    if (this.obstacle) this.drawObstacle()
  }

  private drawZone(zone: { x: number; y: number; r: number }, color: string) {
    const { ctx } = this
    ctx.beginPath()
    ctx.arc(zone.x, zone.y, zone.r, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.shadowBlur = 24
    ctx.shadowColor = color
    ctx.stroke()
    ctx.shadowBlur = 0
    ctx.fillStyle = color + '30'
    ctx.fill()
  }

  private drawObstacle() {
    const { ctx } = this
    const o = this.obstacle!
    ctx.beginPath()
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2)
    const g = ctx.createRadialGradient(o.x, o.y, o.r * 0.2, o.x, o.y, o.r)
    g.addColorStop(0, 'rgba(255,90,90,0.95)')
    g.addColorStop(1, 'rgba(120,0,0,0.7)')
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = '#ff4444'
    ctx.lineWidth = 3
    ctx.setLineDash([6, 6])
    ctx.lineDashOffset = -this.runElapsed * 30
    ctx.shadowBlur = 18
    ctx.shadowColor = '#ff4444'
    ctx.stroke()
    ctx.setLineDash([])
    ctx.shadowBlur = 0
  }

  private drawGhost() {
    const { ctx } = this
    const color = this.currentColor()
    const pulse = 6 + Math.sin(this.phaseElapsed * 6) * 6
    ctx.beginPath()
    ctx.arc(this.ghostX, this.ghostY, GHOST_R + 20 + pulse, 0, Math.PI * 2)
    ctx.fillStyle = color + '20'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(this.ghostX, this.ghostY, GHOST_R + 6 + pulse * 0.4, 0, Math.PI * 2)
    ctx.fillStyle = color + '50'
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.shadowBlur = 28
    ctx.shadowColor = color
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
    const remaining = Math.ceil(RUN_TIMEOUT - this.runElapsed)
    ctx.fillStyle = '#888'
    ctx.font = `bold ${Math.min(canvas.width * 0.035, 14)}px system-ui`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`NÍVEL ${this.level}`, 16, 16)
    ctx.fillStyle = remaining < 10 ? '#ff4444' : '#888'
    ctx.fillText(`${remaining}s`, 16, 36)

    // Jogador da vez (centro)
    ctx.fillStyle = this.currentColor()
    ctx.font = `bold ${Math.min(canvas.width * 0.045, 18)}px system-ui`
    ctx.textAlign = 'center'
    ctx.fillText(`Jogador ${this.currentPlayer + 1}/${this.players.length} · ${this.completed} ok`, canvas.width / 2, 16)

    // Batidas restantes (corações)
    ctx.fillStyle = '#ff4444'
    ctx.font = `bold ${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.textAlign = 'right'
    ctx.textBaseline = 'top'
    ctx.fillText(`${MAX_HITS - this.hits} ♥`, canvas.width - 16, 16)
  }
}

export const fantasmaGame = new FantasmaGame()
