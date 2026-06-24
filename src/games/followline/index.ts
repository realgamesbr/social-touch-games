import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { COLORS, updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'
import { drawBackground } from '../../core/background'

const META: GameMeta = {
  id: 'followline',
  title: 'Follow the Line',
  emoji: '🧵',
  tagline: 'Cada dedo segue sua linha de A até B. Os caminhos se cruzam.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#00e676',
}

const LEVEL_TIMEOUT = 30
const COLLISION_DIST = 50
const PATH_TOLERANCE = 65

type Phase = 'checkin' | 'ready' | 'playing' | 'won' | 'failed'

interface Path {
  playerIdx: number
  color: string
  // Pontos da curva (bezier interpolada para uma polyline densa)
  poly: { x: number; y: number }[]
  startX: number
  startY: number
  endX: number
  endY: number
  pointerId: number | null
  progress: number  // 0..poly.length-1 (índice do ponto mais avançado)
  finished: boolean
}

export class FollowLineGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  phase: Phase = 'checkin'
  phaseElapsed = 0
  players: CheckinPlayer[] = []
  private paths: Path[] = []
  private level = 1
  private levelElapsed = 0
  private failReason = ''

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'checkin'
    this.phaseElapsed = 0
    this.players = []
    this.paths = []
    this.level = 1
    this.levelElapsed = 0
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    drawBackground(ctx, canvas, this.meta.color)
    const points = this.touch.getPoints()
    switch (this.phase) {
      case 'checkin': this.runCheckin(points); break
      case 'ready': this.runReady(points); break
      case 'playing': this.runPlaying(points, dt); break
      case 'won':
        drawEndScreen(ctx, canvas, true, `NÍVEL ${this.level} ✓`, 'Caminhos completos!')
        if (this.phaseElapsed >= 2) {
          this.level++
          this.generatePaths()
          this.phase = 'ready'
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

  private runCheckin(points: Map<number, TouchPoint>) {
    const r = updateCheckin(this, points, this.meta.minPlayers, this.meta.maxPlayers)
    if (r.done) {
      this.generatePaths()
      this.phase = 'ready'
      this.phaseElapsed = 0
      return
    }
    for (const p of this.players) drawPlayerHalo(this.ctx, p.x, p.y, p.color, this.phaseElapsed, { pulsing: true })
    drawCheckinHUD(this.ctx, this.canvas, this, this.meta.minPlayers, this.meta.maxPlayers,
      r.remaining, r.canStart, this.meta.color,
      '2 a 6 jogadores · siga sua linha',
      'caminhos se cruzam · dedos não podem se tocar')
  }

  private generatePaths() {
    const n = this.players.length
    const w = this.canvas.width
    const h = this.canvas.height
    const margin = 60

    // Distribui pontos de start na esquerda e end na direita, embaralhados verticalmente
    const startYs: number[] = []
    const endYs: number[] = []
    for (let i = 0; i < n; i++) {
      startYs.push(margin + (h - margin * 2) * (i + 0.5) / n)
      endYs.push(margin + (h - margin * 2) * (i + 0.5) / n)
    }
    // Embaralha endYs pra criar cruzamento
    for (let i = endYs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[endYs[i], endYs[j]] = [endYs[j], endYs[i]]
    }

    // Complexidade cresce com o nível: mais waypoints = mais curvas/voltas.
    const waypointCount = 2 + this.level
    const amp = (h / 2 - margin) * Math.min(1, 0.45 + this.level * 0.14)

    this.paths = []
    for (let i = 0; i < n; i++) {
      const startX = margin
      const startY = startYs[i]
      const endX = w - margin
      const endY = endYs[i]
      // Waypoints com X sempre crescente (caminho progride) e Y oscilando forte.
      const wps: { x: number; y: number }[] = [{ x: startX, y: startY }]
      let prevSign = Math.random() < 0.5 ? 1 : -1
      for (let k = 1; k <= waypointCount; k++) {
        const tx = k / (waypointCount + 1)
        const x = startX + (endX - startX) * tx + (Math.random() - 0.5) * 50
        const baseY = startY + (endY - startY) * tx
        // alterna o lado da oscilação pra criar zigue-zagues / Ss reais
        prevSign = -prevSign
        const off = prevSign * amp * (0.5 + Math.random() * 0.5)
        const y = Math.max(margin, Math.min(h - margin, baseY + off))
        wps.push({ x, y })
      }
      wps.push({ x: endX, y: endY })
      const poly = this.catmullRom(wps, 20)
      this.paths.push({
        playerIdx: i,
        color: COLORS[i],
        poly,
        startX, startY, endX, endY,
        pointerId: null,
        progress: 0,
        finished: false,
      })
    }
  }

  // Spline Catmull-Rom suave passando por todos os waypoints → curvas
  // orgânicas e complexas (muito além das 2 beziers quase iguais de antes).
  private catmullRom(pts: { x: number; y: number }[], segPer: number): { x: number; y: number }[] {
    if (pts.length < 2) return pts.slice()
    const out: { x: number; y: number }[] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i]
      const p1 = pts[i]
      const p2 = pts[i + 1]
      const p3 = pts[i + 2] ?? pts[i + 1]
      for (let s = 0; s < segPer; s++) {
        const t = s / segPer
        const t2 = t * t
        const t3 = t2 * t
        const x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
        const y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
        out.push({ x, y })
      }
    }
    out.push(pts[pts.length - 1])
    return out
  }

  private runReady(points: Map<number, TouchPoint>) {
    this.drawPaths()
    // Cada player deve tocar no start da sua cor (qualquer pointer próximo)
    for (const path of this.paths) {
      if (path.pointerId !== null) continue
      for (const [id, pt] of points) {
        if (!pt.active) continue
        const used = this.paths.some(p => p.pointerId === id)
        if (used) continue
        if (Math.hypot(pt.x - path.startX, pt.y - path.startY) < 50) {
          path.pointerId = id
          break
        }
      }
    }
    const allTouching = this.paths.every(p => p.pointerId !== null)
    if (allTouching) {
      this.phase = 'playing'
      this.phaseElapsed = 0
      this.levelElapsed = 0
      return
    }
    // HUD
    const { ctx, canvas } = this
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText('Toquem no início (verde) da sua cor', canvas.width / 2, 16)
    const ready = this.paths.filter(p => p.pointerId !== null).length
    ctx.fillStyle = this.meta.color
    ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.fillText(`${ready}/${this.paths.length} prontos`, canvas.width / 2, 44)
  }

  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.levelElapsed += dt
    if (this.levelElapsed >= LEVEL_TIMEOUT) {
      this.failReason = 'Tempo esgotado'
      this.phase = 'failed'
      this.session.end()
      return
    }
    // Atualiza progresso de cada path
    const activeTouches: { id: number; x: number; y: number }[] = []
    for (const path of this.paths) {
      if (path.finished) continue
      if (path.pointerId === null || !points.get(path.pointerId)?.active) {
        this.failReason = 'Soltou o dedo no meio do caminho'
        this.phase = 'failed'
        this.session.end()
        return
      }
      const pt = points.get(path.pointerId)!
      activeTouches.push({ id: path.pointerId, x: pt.x, y: pt.y })
      // Avança progresso enquanto está próximo da próxima posição do path
      while (path.progress < path.poly.length - 1) {
        const nextP = path.poly[path.progress + 1]
        const d = Math.hypot(pt.x - nextP.x, pt.y - nextP.y)
        if (d < PATH_TOLERANCE) path.progress++
        else break
      }
      // Distância do path atual: se está muito longe, fail
      const currentP = path.poly[Math.min(path.progress, path.poly.length - 1)]
      const distToPath = Math.hypot(pt.x - currentP.x, pt.y - currentP.y)
      if (distToPath > PATH_TOLERANCE * 1.8) {
        this.failReason = `${path.color === '#ff4444' ? 'Vermelho' : 'um jogador'} saiu muito da linha`
        this.phase = 'failed'
        this.session.end()
        return
      }
      // Chegou ao fim?
      if (path.progress >= path.poly.length - 1) path.finished = true
    }

    // Verificar colisões entre dedos
    for (let i = 0; i < activeTouches.length; i++) {
      for (let j = i + 1; j < activeTouches.length; j++) {
        const a = activeTouches[i]
        const b = activeTouches[j]
        if (Math.hypot(a.x - b.x, a.y - b.y) < COLLISION_DIST) {
          this.failReason = 'Dois dedos colidiram'
          this.phase = 'failed'
          this.session.end()
          return
        }
      }
    }

    // Todos terminaram?
    if (this.paths.every(p => p.finished)) {
      const bonus = Math.max(50, Math.floor((LEVEL_TIMEOUT - this.levelElapsed) * 20)) * this.players.length * this.level
      this.session.addScore(bonus)
      this.phase = 'won'
      this.phaseElapsed = 0
      return
    }

    this.drawPaths()
    this.drawTouches(points)
    this.drawPlayingHUD()
  }

  private drawPaths() {
    const { ctx } = this
    for (const path of this.paths) {
      // Linha completa em sombra
      ctx.beginPath()
      for (let i = 0; i < path.poly.length; i++) {
        const p = path.poly[i]
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.strokeStyle = path.color + '33'
      ctx.lineWidth = 10
      ctx.stroke()
      // Linha completa fina
      ctx.beginPath()
      for (let i = 0; i < path.poly.length; i++) {
        const p = path.poly[i]
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.strokeStyle = path.color
      ctx.lineWidth = 2
      ctx.setLineDash([6, 6])
      ctx.stroke()
      ctx.setLineDash([])
      // Trilha completada
      if (path.progress > 0) {
        ctx.beginPath()
        for (let i = 0; i <= path.progress; i++) {
          const p = path.poly[i]
          if (i === 0) ctx.moveTo(p.x, p.y)
          else ctx.lineTo(p.x, p.y)
        }
        ctx.strokeStyle = path.color
        ctx.lineWidth = 5
        ctx.shadowBlur = 20
        ctx.shadowColor = path.color
        ctx.stroke()
        ctx.shadowBlur = 0
      }
      // Start (verde)
      ctx.beginPath()
      ctx.arc(path.startX, path.startY, 18, 0, Math.PI * 2)
      ctx.fillStyle = path.color
      ctx.fill()
      ctx.strokeStyle = '#00e676'
      ctx.lineWidth = 3
      ctx.shadowBlur = 16
      ctx.shadowColor = '#00e676'
      ctx.stroke()
      ctx.shadowBlur = 0
      // End (alvo)
      ctx.beginPath()
      ctx.arc(path.endX, path.endY, 22, 0, Math.PI * 2)
      ctx.strokeStyle = path.color
      ctx.lineWidth = 3
      ctx.setLineDash([5, 5])
      ctx.stroke()
      ctx.setLineDash([])
      if (path.finished) {
        ctx.beginPath()
        ctx.arc(path.endX, path.endY, 22, 0, Math.PI * 2)
        ctx.fillStyle = path.color + '88'
        ctx.fill()
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 20px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('✓', path.endX, path.endY)
      }
    }
  }

  private drawTouches(points: Map<number, TouchPoint>) {
    for (const path of this.paths) {
      if (path.finished) continue
      if (path.pointerId === null) continue
      const pt = points.get(path.pointerId)
      if (!pt?.active) continue
      drawPlayerHalo(this.ctx, pt.x, pt.y, path.color, this.phaseElapsed, { pulsing: false, size: 0.85 })
    }
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
    const done = this.paths.filter(p => p.finished).length
    ctx.fillStyle = '#00e676'
    ctx.font = `bold ${Math.min(canvas.width * 0.045, 18)}px system-ui`
    ctx.textAlign = 'center'
    ctx.fillText(`${done}/${this.paths.length}`, canvas.width / 2, 16)
  }
}

export const followLineGame = new FollowLineGame()
