import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { COLORS, updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen, alphaHex } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'

const META: GameMeta = {
  id: 'dancaorbital',
  title: 'Dança Orbital',
  emoji: '🪐',
  tagline: 'Sigam o ponto guia em órbita. Sincronia coletiva.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#4dd0e1',
}

const GAME_DURATION = 90
const GUIDE_RADIUS = 50  // tolerância pra "seguir"
const ANGULAR_SPEED = 0.6  // rad/s

type Phase = 'checkin' | 'playing' | 'gameover'

interface Orbit {
  playerIdx: number
  color: string
  radius: number
  guideAngle: number
  inSyncTime: number   // tempo total acompanhando
}

export class DancaOrbitalGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  private players: CheckinPlayer[] = []
  private orbits: Orbit[] = []
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
    this.orbits = []
    this.gameElapsed = 0
    this.scoreAccum = 0
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    // gradient de fundo synthwave
    const grad = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 50, canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) / 2)
    grad.addColorStop(0, '#1a0d2e')
    grad.addColorStop(1, '#0d0d0d')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const points = this.touch.getPoints()
    switch (this.phase) {
      case 'checkin': this.runCheckin(points); break
      case 'playing': this.runPlaying(points, dt); break
      case 'gameover':
        drawEndScreen(ctx, canvas, true, 'DANÇA',
          this.orbits.length > 0 ? `Sincronia total: ${(this.orbits.reduce((s, o) => s + o.inSyncTime, 0) / this.orbits.length).toFixed(1)}s` : '')
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
      '2 a 6 jogadores · dança em órbita',
      'sigam o ponto guia da sua cor')
  }

  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.gameElapsed = 0
    this.scoreAccum = 0
    const n = this.players.length
    const maxR = Math.min(this.canvas.width, this.canvas.height) / 2 - 60
    this.orbits = []
    for (let i = 0; i < n; i++) {
      this.orbits.push({
        playerIdx: i,
        color: COLORS[i],
        radius: maxR * (0.35 + 0.6 * (i / Math.max(1, n - 1))),
        guideAngle: (i / n) * Math.PI * 2,
        inSyncTime: 0,
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

    const cx = this.canvas.width / 2
    const cy = this.canvas.height / 2
    // gravidade: velocidade angular aumenta com o tempo
    const speed = ANGULAR_SPEED + this.gameElapsed * 0.005

    let syncCount = 0
    for (const orbit of this.orbits) {
      orbit.guideAngle += speed * dt
      // posição do guia
      const gx = cx + Math.cos(orbit.guideAngle) * orbit.radius
      const gy = cy + Math.sin(orbit.guideAngle) * orbit.radius
      // tem dedo perto?
      let near = false
      for (const [, pt] of points) {
        if (!pt.active) continue
        if (Math.hypot(pt.x - gx, pt.y - gy) < GUIDE_RADIUS) { near = true; break }
      }
      if (near) {
        orbit.inSyncTime += dt
        syncCount++
      }
    }

    // Pontos: cada órbita em sincronia dá pontos; bônus se TODAS estão
    const baseRate = syncCount * 8
    const fullBonus = syncCount === this.orbits.length ? syncCount * 12 : 0
    this.scoreAccum += (baseRate + fullBonus) * dt
    const whole = Math.floor(this.scoreAccum)
    if (whole > 0) { this.session.addScore(whole); this.scoreAccum -= whole }

    this.drawOrbits(cx, cy, syncCount)
    this.drawPlayingHUD(syncCount)
  }

  private drawOrbits(cx: number, cy: number, syncCount: number) {
    const { ctx } = this
    // Anéis sutis
    for (const o of this.orbits) {
      ctx.beginPath()
      ctx.arc(cx, cy, o.radius, 0, Math.PI * 2)
      ctx.strokeStyle = o.color + '22'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }
    // Trilhas (rastro do guia)
    for (const o of this.orbits) {
      for (let i = 0; i < 12; i++) {
        const a = o.guideAngle - i * 0.08
        const x = cx + Math.cos(a) * o.radius
        const y = cy + Math.sin(a) * o.radius
        ctx.beginPath()
        ctx.arc(x, y, 6 * (1 - i / 12), 0, Math.PI * 2)
        ctx.fillStyle = o.color + alphaHex(0.5 * (1 - i / 12))
        ctx.fill()
      }
    }
    // Guias
    for (const o of this.orbits) {
      const gx = cx + Math.cos(o.guideAngle) * o.radius
      const gy = cy + Math.sin(o.guideAngle) * o.radius
      drawPlayerHalo(ctx, gx, gy, o.color, this.phaseElapsed, { pulsing: false, size: 0.85 })
    }
    // Centro - estrela
    const allSync = syncCount === this.orbits.length
    ctx.beginPath()
    ctx.arc(cx, cy, allSync ? 20 + Math.sin(this.gameElapsed * 4) * 6 : 12, 0, Math.PI * 2)
    ctx.fillStyle = allSync ? '#fff' : '#888'
    ctx.shadowBlur = allSync ? 40 : 8
    ctx.shadowColor = allSync ? '#fff' : '#666'
    ctx.fill()
    ctx.shadowBlur = 0
  }

  private drawPlayingHUD(syncCount: number) {
    const { ctx, canvas } = this
    const remaining = Math.ceil(GAME_DURATION - this.gameElapsed)
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${remaining}s`, canvas.width / 2, 16)
    ctx.fillStyle = syncCount === this.orbits.length ? '#00e676' : this.meta.color
    ctx.font = `bold ${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.fillText(`${syncCount}/${this.orbits.length} em sincronia`, canvas.width / 2, 44)
  }
}

export const dancaOrbitalGame = new DancaOrbitalGame()
