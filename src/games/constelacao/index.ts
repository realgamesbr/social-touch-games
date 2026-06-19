import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { COLORS, updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen, drawGrid } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'

const META: GameMeta = {
  id: 'constelacao',
  title: 'Constelação',
  emoji: '✨',
  tagline: 'Memorizem o desenho e reconstruam com os dedos.',
  minPlayers: 3,
  maxPlayers: 6,
  duration: 0,
  color: '#aa55ff',
}

const SHOW_DURATION = 4
const ANSWER_DURATION = 12
const HIT_RADIUS = 60

type Phase = 'checkin' | 'show' | 'answer' | 'round_end' | 'gameover'

interface Target {
  color: string
  x: number
  y: number
  hitBy: number | null
}

export class ConstelacaoGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  private players: CheckinPlayer[] = []
  private targets: Target[] = []
  private round = 1
  private roundResult: 'success' | 'fail' = 'success'
  private hitsThisRound = 0

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'checkin'
    this.phaseElapsed = 0
    this.players = []
    this.targets = []
    this.round = 1
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    ctx.fillStyle = '#0d0d0d'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    drawGrid(ctx, canvas)
    const points = this.touch.getPoints()

    switch (this.phase) {
      case 'checkin':
        this.runCheckin(points)
        break
      case 'show':
        this.runShow()
        break
      case 'answer':
        this.runAnswer(points)
        break
      case 'round_end':
        this.runRoundEnd()
        break
      case 'gameover':
        drawEndScreen(ctx, canvas, true, `${this.round - 1} rodadas`, `Score final`)
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
    if (r.done) { this.startRound(); return }
    for (const p of this.players) drawPlayerHalo(this.ctx, p.x, p.y, p.color, this.phaseElapsed, { pulsing: true })
    drawCheckinHUD(this.ctx, this.canvas, this, this.meta.minPlayers, this.meta.maxPlayers,
      r.remaining, r.canStart, this.meta.color,
      '3 a 6 jogadores · memorizem padrões juntos',
      'logo aparecerá um desenho de pontos')
  }

  private startRound() {
    this.phase = 'show'
    this.phaseElapsed = 0
    this.hitsThisRound = 0
    this.generateTargets()
  }

  private generateTargets() {
    const n = this.players.length
    const margin = 100
    this.targets = []
    for (let i = 0; i < n; i++) {
      for (let attempts = 0; attempts < 30; attempts++) {
        const x = margin + Math.random() * (this.canvas.width - margin * 2)
        const y = margin + Math.random() * (this.canvas.height - margin * 2)
        let ok = true
        for (const t of this.targets) if (Math.hypot(t.x - x, t.y - y) < 140) { ok = false; break }
        if (ok) {
          this.targets.push({ color: COLORS[i], x, y, hitBy: null })
          break
        }
      }
    }
  }

  private runShow() {
    const { ctx } = this
    for (const t of this.targets) drawPlayerHalo(ctx, t.x, t.y, t.color, this.phaseElapsed, { pulsing: true })
    // Linhas conectando todos os pontos pra criar "constelação"
    for (let i = 0; i < this.targets.length - 1; i++) {
      const a = this.targets[i]
      const b = this.targets[i + 1]
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = '#ffffff44'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 6])
      ctx.stroke()
      ctx.setLineDash([])
    }
    const remaining = Math.ceil(SHOW_DURATION - this.phaseElapsed)
    this.drawTopHUD(`Memorizem · ${remaining}s`, this.meta.color)
    if (this.phaseElapsed >= SHOW_DURATION) {
      this.phase = 'answer'
      this.phaseElapsed = 0
    }
  }

  private runAnswer(points: Map<number, TouchPoint>) {
    // Marca hits: cada toque ativo verifica posição vs targets da mesma cor (por ordem)
    const activeIds = [...points.entries()].filter(([_, pt]) => pt.active)
    for (const target of this.targets) target.hitBy = null
    for (const [id, pt] of activeIds) {
      let best: Target | null = null
      let bestD = HIT_RADIUS
      for (const t of this.targets) {
        if (t.hitBy !== null) continue
        const d = Math.hypot(t.x - pt.x, t.y - pt.y)
        if (d < bestD) { bestD = d; best = t }
      }
      if (best) best.hitBy = id
    }
    this.hitsThisRound = this.targets.filter(t => t.hitBy !== null).length

    // Render alvos como "ghost" e marca os acertados
    const { ctx } = this
    for (const t of this.targets) {
      const hit = t.hitBy !== null
      ctx.beginPath()
      ctx.arc(t.x, t.y, 30, 0, Math.PI * 2)
      ctx.strokeStyle = hit ? t.color : '#ffffff22'
      ctx.lineWidth = 2
      ctx.setLineDash([4, 4])
      ctx.stroke()
      ctx.setLineDash([])
      if (hit) {
        drawPlayerHalo(ctx, t.x, t.y, t.color, this.phaseElapsed, { pulsing: false })
      }
    }

    const remaining = Math.ceil(ANSWER_DURATION - this.phaseElapsed)
    this.drawTopHUD(`Reproduzam · ${this.hitsThisRound}/${this.targets.length} · ${remaining}s`, this.meta.color)

    // Sucesso: todos acertaram
    if (this.hitsThisRound === this.targets.length) {
      this.session.addScore(this.targets.length * 50 * this.round)
      this.roundResult = 'success'
      this.phase = 'round_end'
      this.phaseElapsed = 0
      return
    }
    if (this.phaseElapsed >= ANSWER_DURATION) {
      // Parcial: pontos pelos acertos
      this.session.addScore(this.hitsThisRound * 20 * this.round)
      this.roundResult = 'fail'
      this.phase = 'round_end'
      this.phaseElapsed = 0
    }
  }

  private runRoundEnd() {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const success = this.roundResult === 'success'
    ctx.fillStyle = success ? `rgba(0,230,118,${0.3})` : `rgba(255,68,68,${0.2})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = success ? '#00e676' : '#ff4444'
    ctx.font = `bold ${Math.min(canvas.width * 0.1, 48)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 32
    ctx.shadowColor = success ? '#00e676' : '#ff4444'
    ctx.fillText(success ? `RODADA ${this.round} ✓` : `RODADA ${this.round} ✗`, cx, cy - 20)
    ctx.shadowBlur = 0
    ctx.fillStyle = '#ccc'
    ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.fillText(success ? 'Constelação reconstruída!' : `Acertaram ${this.hitsThisRound} de ${this.targets.length}`, cx, cy + 25)
    if (this.phaseElapsed >= 2.5) {
      if (success) {
        this.round++
        this.startRound()
      } else {
        this.phase = 'gameover'
        this.session.end()
      }
    }
  }

  private drawTopHUD(text: string, color: string) {
    const { ctx, canvas } = this
    ctx.fillStyle = color
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.shadowBlur = 20
    ctx.shadowColor = color
    ctx.fillText(text, canvas.width / 2, 20)
    ctx.shadowBlur = 0
  }
}

export const constelacaoGame = new ConstelacaoGame()
