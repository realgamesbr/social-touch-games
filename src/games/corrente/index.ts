import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'
import { drawBackground } from '../../core/background'

const META: GameMeta = {
  id: 'corrente',
  title: 'Corrente',
  emoji: '🔗',
  tagline: 'Formem uma cadeia entre os pólos. Se desconecta, fim.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#00e5ff',
}

const TOTAL_PHASES = 5
const PHASE_TIME = 12   // segundos conectados para completar cada fase

type Phase = 'checkin' | 'playing' | 'gameover'

interface Obstacle {
  x: number
  y: number
  r: number
  vx: number
  vy: number
}

export class CorrenteGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  private players: CheckinPlayer[] = []
  private gameElapsed = 0
  private scoreAccum = 0
  private obstacles: Obstacle[] = []
  private connectedTime = 0
  private failReason = ''
  private poleA = { x: 0, y: 0 }
  private poleB = { x: 0, y: 0 }
  // Transição animada entre orientações ao subir de fase
  private poleFromA = { x: 0, y: 0 }
  private poleFromB = { x: 0, y: 0 }
  private poleToA = { x: 0, y: 0 }
  private poleToB = { x: 0, y: 0 }
  private poleTrans = 1     // 0..1, 1 = posição final atingida
  private level = 1
  private phaseProgress = 0   // segundos conectados na fase atual
  private levelFlash = 0
  private won = false

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
    this.obstacles = []
    this.connectedTime = 0
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    drawBackground(ctx, canvas, '#00e5ff')
    const points = this.touch.getPoints()
    switch (this.phase) {
      case 'checkin': this.runCheckin(points); break
      case 'playing': this.runPlaying(points, dt); break
      case 'gameover': drawEndScreen(ctx, canvas, this.won, this.won ? 'CIRCUITO COMPLETO' : 'CIRCUITO ABERTO', this.failReason); break
    }
  }

  destroy() {
    window.removeEventListener('resize', this.resize)
  }

  private resize = () => {
    this.canvas.width = this.canvas.offsetWidth
    this.canvas.height = this.canvas.offsetHeight
    // Em checkin os pólos ficam horizontais (orientação previsível pra todos
    // posicionarem ao redor da mesa). No jogo cada fase muda a orientação.
    if (this.phase === 'checkin') {
      this.poleA = { x: 60, y: this.canvas.height / 2 }
      this.poleB = { x: this.canvas.width - 60, y: this.canvas.height / 2 }
    }
  }

  // Sorteia novas posições pros pólos em bordas opostas. A cada fase muda a
  // orientação — força o grupo a se reorganizar fisicamente ao redor da mesa.
  // animate=true faz transição suave; false teleporta (início do jogo).
  private shufflePoles(animate: boolean) {
    const w = this.canvas.width, h = this.canvas.height
    const m = 60
    const orientations: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
      [{ x: m, y: h / 2 }, { x: w - m, y: h / 2 }],               // horizontal
      [{ x: w / 2, y: m }, { x: w / 2, y: h - m }],               // vertical
      [{ x: m, y: h - m }, { x: w - m, y: m }],                   // diagonal /
      [{ x: m, y: m }, { x: w - m, y: h - m }],                   // diagonal \
      [{ x: m, y: h * 0.3 }, { x: w - m, y: h * 0.7 }],
      [{ x: m, y: h * 0.7 }, { x: w - m, y: h * 0.3 }],
    ]
    // Evita repetir a mesma orientação por acaso
    let pick = orientations[Math.floor(Math.random() * orientations.length)]
    for (let i = 0; i < 5; i++) {
      const sameA = pick[0].x === this.poleA.x && pick[0].y === this.poleA.y
      const sameB = pick[1].x === this.poleB.x && pick[1].y === this.poleB.y
      if (!sameA || !sameB) break
      pick = orientations[Math.floor(Math.random() * orientations.length)]
    }
    if (animate) {
      this.poleFromA = { ...this.poleA }
      this.poleFromB = { ...this.poleB }
      this.poleToA = pick[0]
      this.poleToB = pick[1]
      this.poleTrans = 0
    } else {
      this.poleA = pick[0]
      this.poleB = pick[1]
      this.poleFromA = { ...this.poleA }
      this.poleFromB = { ...this.poleB }
      this.poleToA = { ...this.poleA }
      this.poleToB = { ...this.poleB }
      this.poleTrans = 1
    }
  }

  private runCheckin(points: Map<number, TouchPoint>) {
    const r = updateCheckin(this, points, this.meta.minPlayers, this.meta.maxPlayers)
    if (r.done) { this.startPlaying(); return }
    for (const p of this.players) drawPlayerHalo(this.ctx, p.x, p.y, p.color, this.phaseElapsed, { pulsing: true })
    // Mostra os pólos
    this.drawPole(this.poleA, '#00e676')
    this.drawPole(this.poleB, '#ffab40')
    drawCheckinHUD(this.ctx, this.canvas, this, this.meta.minPlayers, this.meta.maxPlayers,
      r.remaining, r.canStart, this.meta.color,
      '2 a 6 jogadores · cadeia humana de energia',
      'formem uma linha entre as bolinhas verde e laranja')
  }

  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.gameElapsed = 0
    this.scoreAccum = 0
    this.connectedTime = 0
    this.level = 1
    this.phaseProgress = 0
    this.levelFlash = 0
    this.won = false
    this.obstacles = []
    this.shufflePoles(false)
    this.spawnObstacles()
  }

  // Distância máxima de cada elo, adaptada ao vão entre os pólos e ao nº de
  // jogadores — garante que 2+ pessoas sempre consigam fechar a corrente,
  // mas ainda exige formar uma linha razoavelmente esticada.
  private linkMax(): number {
    const span = Math.hypot(this.poleB.x - this.poleA.x, this.poleB.y - this.poleA.y)
    const gaps = this.players.length + 1
    return Math.max(200, (span / gaps) * 1.35)
  }

  // Posição do toque projetada sobre o eixo poleA→poleB (0 = poleA, 1 = poleB).
  // Permite ordenar a corrente independente da orientação dos pólos.
  private poleProjection(x: number, y: number): number {
    const dx = this.poleB.x - this.poleA.x
    const dy = this.poleB.y - this.poleA.y
    const len2 = dx * dx + dy * dy
    if (len2 < 1) return 0
    return ((x - this.poleA.x) * dx + (y - this.poleA.y) * dy) / len2
  }

  private addObstacle() {
    const x = 200 + Math.random() * (this.canvas.width - 400)
    const y = 100 + Math.random() * (this.canvas.height - 200)
    const angle = Math.random() * Math.PI * 2
    const speed = 45 + Math.random() * 40 + this.level * 6
    this.obstacles.push({
      x, y, r: 30 + Math.random() * 20,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
    })
  }

  private spawnObstacles() {
    const count = 2 + Math.floor(this.players.length / 2)
    for (let i = 0; i < count; i++) {
      const x = 200 + Math.random() * (this.canvas.width - 400)
      const y = 100 + Math.random() * (this.canvas.height - 200)
      const angle = Math.random() * Math.PI * 2
      const speed = 40 + Math.random() * 40
      this.obstacles.push({
        x, y, r: 30 + Math.random() * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      })
    }
  }

  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.gameElapsed += dt
    this.levelFlash = Math.max(0, this.levelFlash - dt * 1.5)

    // Transição dos pólos: ~1.2s pra deslizar entre as orientações
    if (this.poleTrans < 1) {
      this.poleTrans = Math.min(1, this.poleTrans + dt / 1.2)
      const e = 1 - Math.pow(1 - this.poleTrans, 3)  // easeOutCubic
      this.poleA.x = this.poleFromA.x + (this.poleToA.x - this.poleFromA.x) * e
      this.poleA.y = this.poleFromA.y + (this.poleToA.y - this.poleFromA.y) * e
      this.poleB.x = this.poleFromB.x + (this.poleToB.x - this.poleFromB.x) * e
      this.poleB.y = this.poleFromB.y + (this.poleToB.y - this.poleFromB.y) * e
    }

    // Atualiza obstáculos
    for (const ob of this.obstacles) {
      ob.x += ob.vx * dt
      ob.y += ob.vy * dt
      const m = 30
      if (ob.x - ob.r < m) { ob.x = m + ob.r; ob.vx = Math.abs(ob.vx) }
      if (ob.x + ob.r > this.canvas.width - m) { ob.x = this.canvas.width - m - ob.r; ob.vx = -Math.abs(ob.vx) }
      if (ob.y - ob.r < m) { ob.y = m + ob.r; ob.vy = Math.abs(ob.vy) }
      if (ob.y + ob.r > this.canvas.height - m) { ob.y = this.canvas.height - m - ob.r; ob.vy = -Math.abs(ob.vy) }
    }

    // Coleta toques ativos com pos
    const activeTouches: { id: number; x: number; y: number; color: string }[] = []
    for (const p of this.players) {
      const pt = points.get(p.pointerId)
      if (pt?.active) activeTouches.push({ id: p.pointerId, x: pt.x, y: pt.y, color: p.color })
      else {
        this.phase = 'gameover'
        this.failReason = 'Alguém soltou o dedo'
        this.session.end()
        return
      }
    }

    // Toques tocando obstáculo = penalty
    for (const t of activeTouches) {
      for (const ob of this.obstacles) {
        if (Math.hypot(t.x - ob.x, t.y - ob.y) < ob.r + 20) {
          this.phase = 'gameover'
          this.failReason = 'Tocaram um obstáculo'
          this.session.end()
          return
        }
      }
    }

    // Ordena pela projeção sobre o eixo A→B (funciona em qualquer orientação)
    activeTouches.sort((a, b) => this.poleProjection(a.x, a.y) - this.poleProjection(b.x, b.y))

    // Verifica se a cadeia conecta os pólos
    const linkMax = this.linkMax()
    const chain = [this.poleA, ...activeTouches, this.poleB]
    let connected = true
    for (let i = 0; i < chain.length - 1; i++) {
      if (Math.hypot(chain[i].x - chain[i + 1].x, chain[i].y - chain[i + 1].y) > linkMax) {
        connected = false
        break
      }
    }

    if (connected) {
      this.connectedTime += dt
      this.phaseProgress += dt
      this.scoreAccum += (10 + this.level * 4) * dt
      const whole = Math.floor(this.scoreAccum)
      if (whole > 0) { this.session.addScore(whole); this.scoreAccum -= whole }

      // Completou a fase?
      if (this.phaseProgress >= PHASE_TIME) {
        this.level++
        this.phaseProgress = 0
        this.levelFlash = 1
        if (this.level > TOTAL_PHASES) {
          this.won = true
          this.failReason = `Completaram as ${TOTAL_PHASES} fases!`
          this.phase = 'gameover'
          this.session.end()
          return
        }
        this.addObstacle()       // cada fase sobe a dificuldade
        this.shufflePoles(true)  // e os pólos viajam suavemente pra nova orientação
      }
    }

    this.drawObstacles()
    this.drawPole(this.poleA, '#00e676')
    this.drawPole(this.poleB, '#ffab40')
    this.drawChain(chain, connected, activeTouches, linkMax)
    this.drawPlayingHUD(connected)
    this.drawLevelFlash()
  }

  private drawObstacles() {
    const { ctx } = this
    for (const ob of this.obstacles) {
      ctx.beginPath()
      ctx.arc(ob.x, ob.y, ob.r, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(80,40,40,0.7)'
      ctx.fill()
      ctx.strokeStyle = '#ff4444'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 6])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  private drawPole(pole: { x: number; y: number }, color: string) {
    const { ctx } = this
    const pulse = 6 + Math.sin(this.phaseElapsed * 5) * 4
    ctx.beginPath()
    ctx.arc(pole.x, pole.y, 38 + pulse, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.shadowBlur = 28
    ctx.shadowColor = color
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(pole.x, pole.y, 20, 0, Math.PI * 2)
    ctx.fillStyle = color + '88'
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  private drawChain(chain: { x: number; y: number }[], connected: boolean, activeTouches: any[], linkMax: number) {
    const { ctx } = this
    // Linhas conectando
    for (let i = 0; i < chain.length - 1; i++) {
      const a = chain[i]
      const b = chain[i + 1]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      const broken = d > linkMax
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = broken ? '#ff4444' : (connected ? '#00e5ff' : '#888')
      ctx.lineWidth = 4
      ctx.shadowBlur = 24
      ctx.shadowColor = broken ? '#ff4444' : '#00e5ff'
      if (broken) ctx.setLineDash([6, 6])
      ctx.stroke()
      ctx.setLineDash([])
      ctx.shadowBlur = 0
    }
    // Toques dos jogadores
    for (const t of activeTouches) {
      drawPlayerHalo(ctx, t.x, t.y, t.color, this.phaseElapsed, { pulsing: false, size: 0.9 })
    }
  }

  private drawPlayingHUD(connected: boolean) {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`FASE ${this.level}/${TOTAL_PHASES}`, cx, 14)

    // Barra de progresso da fase atual (só enche enquanto conectados)
    const barW = Math.min(canvas.width * 0.5, 320)
    const barX = cx - barW / 2
    ctx.fillStyle = 'rgba(0,229,255,0.18)'
    ctx.fillRect(barX, 42, barW, 6)
    ctx.fillStyle = '#00e5ff'
    ctx.fillRect(barX, 42, barW * (this.phaseProgress / PHASE_TIME), 6)

    ctx.fillStyle = connected ? '#00e5ff' : '#ff4444'
    ctx.font = `bold ${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.fillText(connected ? '⚡ segurem a corrente para completar a fase' : 'circuito aberto — reconectem', cx, 56)
  }

  private drawLevelFlash() {
    if (this.levelFlash <= 0) return
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    ctx.fillStyle = `rgba(0,229,255,${this.levelFlash * 0.12})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = `rgba(0,229,255,${this.levelFlash})`
    ctx.font = `bold ${Math.min(canvas.width * 0.13, 60)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 36
    ctx.shadowColor = '#00e5ff'
    ctx.fillText(`FASE ${this.level}`, cx, cy)
    ctx.shadowBlur = 0
  }
}

export const correnteGame = new CorrenteGame()
