import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'

const META: GameMeta = {
  id: 'labirinto',
  title: 'Labirinto Rotacional',
  emoji: '🌀',
  tagline: 'Defendam a bola com os dedos. O tabuleiro gira.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#ff44ff',
}

interface Ball {
  x: number
  y: number
  vx: number
  vy: number
  r: number
}

interface Hole {
  // Em coordenadas locais (relativas ao centro, antes da rotação)
  lx: number
  ly: number
  r: number
}

type Phase = 'checkin' | 'playing' | 'gameover'

export class LabirintoGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  phase: Phase = 'checkin'
  phaseElapsed = 0
  players: CheckinPlayer[] = []
  private ball: Ball = { x: 0, y: 0, vx: 0, vy: 0, r: 28 }
  private holes: Hole[] = []
  private gameElapsed = 0
  private rotation = 0
  private rotationSpeed = 0.15
  private scoreAccum = 0
  private failReason = ''

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'checkin'
    this.phaseElapsed = 0
    this.players = []
    this.gameElapsed = 0
    this.rotation = 0
    this.rotationSpeed = 0.15
    this.scoreAccum = 0
    this.failReason = ''
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    ctx.fillStyle = '#0d0a14'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const points = this.touch.getPoints()
    switch (this.phase) {
      case 'checkin': this.runCheckin(points); break
      case 'playing': this.runPlaying(points, dt); break
      case 'gameover':
        drawEndScreen(ctx, canvas, false, 'BOLA PERDIDA', this.failReason)
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
      '2 a 6 jogadores · arena rotativa',
      'a bola não pode cair nos buracos')
  }

  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.gameElapsed = 0
    this.rotation = 0
    this.ball.x = this.canvas.width / 2
    this.ball.y = this.canvas.height / 2
    const angle = Math.random() * Math.PI * 2
    const speed = 180
    this.ball.vx = Math.cos(angle) * speed
    this.ball.vy = Math.sin(angle) * speed
    this.generateHoles()
  }

  private generateHoles() {
    this.holes = []
    const arenaR = this.arenaRadius()
    const count = 3 + this.players.length
    for (let i = 0; i < count; i++) {
      for (let attempts = 0; attempts < 20; attempts++) {
        const a = Math.random() * Math.PI * 2
        const dist = arenaR * (0.3 + Math.random() * 0.55)
        const lx = Math.cos(a) * dist
        const ly = Math.sin(a) * dist
        let ok = true
        for (const h of this.holes) {
          if (Math.hypot(h.lx - lx, h.ly - ly) < 80) { ok = false; break }
        }
        if (Math.hypot(lx, ly) < 60) ok = false // não no centro
        if (ok) {
          this.holes.push({ lx, ly, r: 26 + Math.random() * 12 })
          break
        }
      }
    }
  }

  private arenaRadius() {
    return Math.min(this.canvas.width, this.canvas.height) / 2 - 30
  }

  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.gameElapsed += dt
    this.rotation += this.rotationSpeed * dt
    this.rotationSpeed = 0.15 + this.gameElapsed * 0.008

    // Move ball
    this.ball.x += this.ball.vx * dt
    this.ball.y += this.ball.vy * dt
    // Acelera levemente com tempo
    const accel = 1 + this.gameElapsed * 0.003
    this.ball.vx *= accel
    this.ball.vy *= accel

    // Colisão com bordas da arena (círculo)
    const cx = this.canvas.width / 2
    const cy = this.canvas.height / 2
    const arenaR = this.arenaRadius()
    const dx = this.ball.x - cx
    const dy = this.ball.y - cy
    const distFromCenter = Math.hypot(dx, dy)
    if (distFromCenter + this.ball.r > arenaR) {
      const nx = dx / distFromCenter
      const ny = dy / distFromCenter
      // posiciona dentro
      this.ball.x = cx + nx * (arenaR - this.ball.r)
      this.ball.y = cy + ny * (arenaR - this.ball.r)
      // reflete velocidade
      const dot = this.ball.vx * nx + this.ball.vy * ny
      this.ball.vx -= 2 * dot * nx
      this.ball.vy -= 2 * dot * ny
    }

    // Colisão com dedos (reflexão)
    for (const [, pt] of points) {
      if (!pt.active) continue
      const fx = pt.x - this.ball.x
      const fy = pt.y - this.ball.y
      const d = Math.hypot(fx, fy)
      const fingerR = 30
      if (d < this.ball.r + fingerR && d > 0) {
        const nx = -fx / d
        const ny = -fy / d
        // empurra a bola pra fora
        this.ball.x = pt.x + nx * (this.ball.r + fingerR)
        this.ball.y = pt.y + ny * (this.ball.r + fingerR)
        const dot = this.ball.vx * nx + this.ball.vy * ny
        if (dot < 0) {
          this.ball.vx -= 2 * dot * nx
          this.ball.vy -= 2 * dot * ny
        }
        // bônus por defesa
        this.scoreAccum += 1
      }
    }

    // Colisão com buracos (rotacionados)
    for (const hole of this.holes) {
      const c = Math.cos(this.rotation)
      const s = Math.sin(this.rotation)
      const hx = cx + hole.lx * c - hole.ly * s
      const hy = cy + hole.lx * s + hole.ly * c
      if (Math.hypot(this.ball.x - hx, this.ball.y - hy) < hole.r + this.ball.r * 0.5) {
        this.failReason = `Sobreviveram ${this.gameElapsed.toFixed(1)}s`
        this.phase = 'gameover'
        this.session.end()
        return
      }
    }

    // Score por sobrevivência
    this.scoreAccum += 8 * dt
    const whole = Math.floor(this.scoreAccum)
    if (whole > 0) { this.session.addScore(whole); this.scoreAccum -= whole }

    this.drawArena()
    this.drawHoles(cx, cy)
    this.drawBall()
    this.drawTouches(points)
    this.drawPlayingHUD()
  }

  private drawArena() {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const r = this.arenaRadius()
    // Linhas radiais rotacionando
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(this.rotation)
    ctx.strokeStyle = 'rgba(255,68,255,0.07)'
    ctx.lineWidth = 1
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      ctx.stroke()
    }
    ctx.restore()
    // Borda
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = '#ff44ff'
    ctx.lineWidth = 3
    ctx.shadowBlur = 20
    ctx.shadowColor = '#ff44ff'
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  private drawHoles(cx: number, cy: number) {
    const { ctx } = this
    const c = Math.cos(this.rotation)
    const s = Math.sin(this.rotation)
    for (const hole of this.holes) {
      const hx = cx + hole.lx * c - hole.ly * s
      const hy = cy + hole.lx * s + hole.ly * c
      ctx.beginPath()
      ctx.arc(hx, hy, hole.r, 0, Math.PI * 2)
      ctx.fillStyle = '#000'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,68,68,0.6)'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  private drawBall() {
    const { ctx, ball } = this
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, ball.r + 8, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255,255,255,0.15)'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.shadowBlur = 24
    ctx.shadowColor = '#fff'
    ctx.fill()
    ctx.shadowBlur = 0
  }

  private drawTouches(points: Map<number, TouchPoint>) {
    const { ctx } = this
    for (const p of this.players) {
      const pt = points.get(p.pointerId)
      if (!pt?.active) continue
      drawPlayerHalo(ctx, pt.x, pt.y, p.color, this.phaseElapsed, { pulsing: false, size: 0.85 })
    }
  }

  private drawPlayingHUD() {
    const { ctx, canvas } = this
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${this.gameElapsed.toFixed(1)}s`, canvas.width / 2, 16)
  }
}

export const labirintoGame = new LabirintoGame()
