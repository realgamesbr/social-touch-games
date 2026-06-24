import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen, alphaHex } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'
import { drawBackground } from '../../core/background'

const META: GameMeta = {
  id: 'bomba',
  title: 'Bomba Instável',
  emoji: '💥',
  tagline: 'Cada um prende uma alça viva. Sigam o núcleo — ele não para quieto.',
  minPlayers: 2,
  maxPlayers: 6,
  color: '#ff4444',
  duration: 0,
}

const COVER_RADIUS = 64        // distância pra considerar a alça "presa"
const ROT_SPEED_BASE = 0.5     // rad/s das alças orbitando o núcleo
const INSTAB_RISE = 0.20       // instabilidade ganha por alça solta / s
const INSTAB_DECAY = 0.28      // recuperação quando tudo preso / s

type Phase = 'checkin' | 'playing' | 'gameover'

interface Handle {
  ang: number        // ângulo orbital ao redor do núcleo
  baseR: number      // raio orbital base
  phase: number      // defasagem da respiração do raio
  covered: boolean
}

export class BombaGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  private players: CheckinPlayer[] = []
  private coreX = 0
  private coreY = 0
  private coreR = 64
  private gameElapsed = 0
  private scoreAccum = 0
  private instability = 0
  private handles: Handle[] = []
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
    this.scoreAccum = 0
    this.instability = 0
    this.handles = []
    this.failReason = ''
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    drawBackground(ctx, canvas, '#ff4444')
    const points = this.touch.getPoints()
    switch (this.phase) {
      case 'checkin': this.runCheckin(points); break
      case 'playing': this.runPlaying(points, dt); break
      case 'gameover': drawEndScreen(ctx, canvas, false, '💥 EXPLODIU', this.failReason); break
    }
  }

  destroy() {
    window.removeEventListener('resize', this.resize)
  }

  private resize = () => {
    this.canvas.width = this.canvas.offsetWidth
    this.canvas.height = this.canvas.offsetHeight
    if (this.phase !== 'playing') {
      this.coreX = this.canvas.width / 2
      this.coreY = this.canvas.height / 2
    }
  }

  private runCheckin(points: Map<number, TouchPoint>) {
    const r = updateCheckin(this, points, this.meta.minPlayers, this.meta.maxPlayers)
    if (r.done) { this.startPlaying(); return }
    for (const p of this.players) drawPlayerHalo(this.ctx, p.x, p.y, p.color, this.phaseElapsed, { pulsing: true })
    drawCheckinHUD(this.ctx, this.canvas, this, this.meta.minPlayers, this.meta.maxPlayers,
      r.remaining, r.canStart, this.meta.color,
      '2 a 6 jogadores · cada um cuida de uma alça',
      'as alças se movem — vão precisar segui-las')
  }

  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.gameElapsed = 0
    this.instability = 0
    this.scoreAccum = 0
    this.coreX = this.canvas.width / 2
    this.coreY = this.canvas.height / 2
    this.coreR = Math.min(this.canvas.width, this.canvas.height) * 0.11
    const n = this.players.length
    const orbit = this.coreR + Math.min(this.canvas.width, this.canvas.height) * 0.12
    this.handles = []
    for (let i = 0; i < n; i++) {
      this.handles.push({
        ang: (i / n) * Math.PI * 2,
        baseR: orbit,
        phase: Math.random() * Math.PI * 2,
        covered: false,
      })
    }
  }

  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.gameElapsed += dt
    const t = this.gameElapsed
    const w = this.canvas.width
    const h = this.canvas.height

    // O núcleo vagueia numa trajetória de Lissajous que se amplia com o tempo
    // → obriga os jogadores a se deslocarem ao redor da mesa.
    const driftX = Math.min(w * 0.32, 60 + t * 4)
    const driftY = Math.min(h * 0.32, 50 + t * 3.5)
    // Alças orbitam e "respiram" (raio oscila), cada vez mais rápido/amplo
    const rotSpeed = ROT_SPEED_BASE + t * 0.02
    const breatheAmp = Math.min(this.coreR * 0.9, 18 + t * 1.2)

    this.coreX = w / 2 + Math.sin(t * 0.34) * driftX
    this.coreY = h / 2 + Math.sin(t * 0.27 + 1.1) * driftY
    // Mantém núcleo + alças dentro da tela (nada inalcançável)
    const orbit = this.handles[0] ? this.handles[0].baseR : this.coreR * 2
    const reach = orbit + breatheAmp + 28
    this.coreX = Math.max(reach, Math.min(w - reach, this.coreX))
    this.coreY = Math.max(reach, Math.min(h - reach, this.coreY))

    const activeTouches: { x: number; y: number }[] = []
    for (const [, pt] of points) if (pt.active) activeTouches.push({ x: pt.x, y: pt.y })

    let uncovered = 0
    for (const handle of this.handles) {
      handle.ang += rotSpeed * dt
      const curR = handle.baseR + Math.sin(t * 1.4 + handle.phase) * breatheAmp
      const hx = this.coreX + Math.cos(handle.ang) * curR
      const hy = this.coreY + Math.sin(handle.ang) * curR
      let covered = false
      for (const a of activeTouches) {
        if (Math.hypot(a.x - hx, a.y - hy) < COVER_RADIUS) { covered = true; break }
      }
      handle.covered = covered
      if (!covered) uncovered++
    }

    // Instabilidade sobe com alças soltas, recupera quando tudo preso
    if (uncovered > 0) this.instability += uncovered * INSTAB_RISE * dt
    else this.instability -= INSTAB_DECAY * dt
    this.instability = Math.max(0, Math.min(1, this.instability))

    if (this.instability >= 1) {
      this.failReason = `Contiveram por ${t.toFixed(1)}s`
      this.phase = 'gameover'
      this.session.end()
      return
    }

    // Score: prêmio por manter tudo preso
    const allCovered = uncovered === 0
    this.scoreAccum += (allCovered ? 30 : 8) * dt
    const whole = Math.floor(this.scoreAccum)
    if (whole > 0) { this.session.addScore(whole); this.scoreAccum -= whole }

    this.drawCore(t)
    this.drawHandles(t)
    this.drawInstabilityMeter()
    this.drawHUD(uncovered)
  }

  // Núcleo como blob pulsante e mutante (polígono radial ondulado)
  private drawCore(t: number) {
    const { ctx } = this
    const danger = this.instability
    const lobes = 5 + this.players.length
    ctx.beginPath()
    const steps = 64
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2
      const wobble =
        Math.sin(a * lobes + t * 2.4) * (6 + danger * 14) +
        Math.sin(a * 3 - t * 1.7) * 8
      const rr = this.coreR + wobble + Math.sin(t * 5) * (2 + danger * 6)
      const x = this.coreX + Math.cos(a) * rr
      const y = this.coreY + Math.sin(a) * rr
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.closePath()
    const grad = ctx.createRadialGradient(this.coreX, this.coreY, this.coreR * 0.2, this.coreX, this.coreY, this.coreR * 1.4)
    // mais quente/branco conforme a instabilidade
    grad.addColorStop(0, `rgba(255,${Math.floor(220 - danger * 180)},${Math.floor(160 - danger * 160)},0.95)`)
    grad.addColorStop(0.55, `rgba(255,${Math.floor(110 - danger * 80)},30,0.7)`)
    grad.addColorStop(1, 'rgba(150,20,0,0.15)')
    ctx.fillStyle = grad
    ctx.shadowBlur = 30 + danger * 50
    ctx.shadowColor = danger > 0.5 ? '#ffaa00' : '#ff4444'
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = danger > 0.6 ? '#ffcc00' : '#ff6644'
    ctx.lineWidth = 3
    ctx.stroke()
  }

  private drawHandles(t: number) {
    const { ctx } = this
    const breatheAmp = Math.min(this.coreR * 0.9, 18 + t * 1.2)
    for (const handle of this.handles) {
      const curR = handle.baseR + Math.sin(t * 1.4 + handle.phase) * breatheAmp
      const hx = this.coreX + Math.cos(handle.ang) * curR
      const hy = this.coreY + Math.sin(handle.ang) * curR
      const col = handle.covered ? '#00e676' : '#ff4444'

      // Tendão ligando o núcleo à alça (mostra que ela faz parte do núcleo)
      ctx.beginPath()
      ctx.moveTo(this.coreX + Math.cos(handle.ang) * this.coreR * 0.7, this.coreY + Math.sin(handle.ang) * this.coreR * 0.7)
      ctx.lineTo(hx, hy)
      ctx.strokeStyle = col + alphaHex(handle.covered ? 0.5 : 0.3)
      ctx.lineWidth = handle.covered ? 5 : 3
      ctx.shadowBlur = handle.covered ? 16 : 6
      ctx.shadowColor = col
      ctx.stroke()
      ctx.shadowBlur = 0

      // Botão da alça
      const pulse = handle.covered ? 0 : 4 + Math.sin(t * 8 + handle.phase) * 4
      ctx.beginPath()
      ctx.arc(hx, hy, 26 + pulse, 0, Math.PI * 2)
      ctx.fillStyle = col + alphaHex(0.18)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(hx, hy, 18, 0, Math.PI * 2)
      ctx.fillStyle = col + alphaHex(0.4)
      ctx.fill()
      ctx.strokeStyle = col
      ctx.lineWidth = 3
      ctx.shadowBlur = 18
      ctx.shadowColor = col
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }

  private drawInstabilityMeter() {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const barW = Math.min(canvas.width * 0.6, 360)
    const barX = cx - barW / 2
    const y = canvas.height - 26
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.fillRect(barX, y, barW, 10)
    const danger = this.instability
    ctx.fillStyle = `rgba(255,${Math.floor(180 - danger * 180)},40,0.95)`
    ctx.fillRect(barX, y, barW * danger, 10)
    ctx.fillStyle = danger > 0.7 ? '#ffcc00' : '#888'
    ctx.font = `bold ${Math.min(canvas.width * 0.032, 13)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'bottom'
    ctx.fillText('INSTABILIDADE', cx, y - 4)
  }

  private drawHUD(uncovered: number) {
    const { ctx, canvas } = this
    ctx.fillStyle = uncovered === 0 ? '#00e676' : '#ff4444'
    ctx.font = `bold ${Math.min(canvas.width * 0.045, 20)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(
      uncovered === 0 ? '✓ núcleo contido' : `${uncovered} alça${uncovered > 1 ? 's' : ''} solta${uncovered > 1 ? 's' : ''}!`,
      canvas.width / 2, 16,
    )
  }
}

export const bombaGame = new BombaGame()
