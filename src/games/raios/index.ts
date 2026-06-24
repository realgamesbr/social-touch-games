import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { drawBackground } from '../../core/background'

const META: GameMeta = {
  id: 'raios',
  title: 'Não Cruzem os Raios',
  emoji: '⚡',
  tagline: 'Cada um segura 2 dedos. Desemaranhem sem soltar.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#ffab40',
}

const COLORS = ['#ff4444', '#00e676', '#ffab40', '#aa55ff', '#00e5ff', '#ff44ff']
const CHECKIN_DURATION = 5
const SECOND_TOUCH_TIMEOUT = 20
const STABLE_REQUIRED = 1.5
const ANCHOR_RADIUS = 50

// Dificuldade por nível
const levelTimeout = (level: number) => Math.max(20, 50 - level * 4)
const obstacleCount = (level: number) => Math.min(Math.max(0, level - 2), 5)
const extraEdgeCount = (level: number) => Math.min(Math.max(0, Math.floor((level - 2) / 2)), 4)
const obstaclesMove = (level: number) => level >= 6

type Phase = 'checkin' | 'secondTouch' | 'playing' | 'gameover'

interface NodeRef {
  pointerId: number | null
  color: string
  x: number
  y: number
  anchorX: number
  anchorY: number
}

interface Player {
  index: number
  color: string
  a: NodeRef
  b: NodeRef
}

interface Edge {
  from: NodeRef
  to: NodeRef
}

interface Obstacle {
  x: number
  y: number
  r: number
  vx: number
  vy: number
}

export class RaiosGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  private players: Player[] = []
  private edges: Edge[] = []
  private obstacles: Obstacle[] = []
  private stableTime = 0
  private level = 1
  private levelElapsed = 0
  private levelFlash = 0
  private failReason = ''

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'checkin'
    this.phaseElapsed = 0
    this.players = []
    this.edges = []
    this.obstacles = []
    this.stableTime = 0
    this.level = 1
    this.levelElapsed = 0
    this.levelFlash = 0
    this.failReason = ''
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    const { ctx, canvas } = this
    drawBackground(ctx, canvas)

    const points = this.touch.getPoints()

    switch (this.phase) {
      case 'checkin':
        this.updateCheckin(points)
        break
      case 'secondTouch':
        this.updateSecondTouch(points)
        break
      case 'playing':
        this.updatePlaying(points, dt)
        break
      case 'gameover':
        this.drawGameover()
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
  private updateCheckin(points: Map<number, TouchPoint>) {
    const activeIds = new Set<number>()
    for (const [id, pt] of points) {
      if (!pt.active) continue
      activeIds.add(id)
      const player = this.players.find(p => p.a.pointerId === id)
      if (player) {
        player.a.x = pt.x
        player.a.y = pt.y
      } else if (this.players.length < this.meta.maxPlayers) {
        const idx = this.players.length
        const color = COLORS[idx]
        this.players.push({
          index: idx,
          color,
          a: { pointerId: id, color, x: pt.x, y: pt.y, anchorX: pt.x, anchorY: pt.y },
          b: { pointerId: null, color, x: 0, y: 0, anchorX: 0, anchorY: 0 },
        })
      }
    }
    this.players = this.players.filter(p => p.a.pointerId !== null && activeIds.has(p.a.pointerId))

    const canStart = this.players.length >= this.meta.minPlayers
    if (!canStart) this.phaseElapsed = 0

    const remaining = Math.max(0, CHECKIN_DURATION - this.phaseElapsed)
    if (canStart && remaining <= 0) {
      this.startSecondTouch()
      return
    }

    this.drawNodes([], true)
    for (const p of this.players) this.drawNode(p.a, true, false)
    this.drawCheckinHUD(remaining, canStart)
  }

  // ─── SECOND TOUCH ───────────────────────────────────────────────
  private startSecondTouch() {
    this.phase = 'secondTouch'
    this.phaseElapsed = 0
    this.generateSecondAnchors()
  }

  private generateSecondAnchors() {
    const n = this.players.length
    const cx = this.players.reduce((s, p) => s + p.a.x, 0) / n
    const cy = this.players.reduce((s, p) => s + p.a.y, 0) / n
    const margin = 80

    for (const p of this.players) {
      let x = 2 * cx - p.a.x
      let y = 2 * cy - p.a.y
      // ruído pra evitar sobreposição
      x += (Math.random() - 0.5) * 80
      y += (Math.random() - 0.5) * 80
      // clamp dentro da tela
      x = Math.max(margin, Math.min(this.canvas.width - margin, x))
      y = Math.max(margin, Math.min(this.canvas.height - margin, y))
      // garante distância mínima das outras anchors e dos nodeA
      for (let tries = 0; tries < 10; tries++) {
        let ok = true
        for (const other of this.players) {
          if (other === p) continue
          if (other.b.anchorX !== 0 && Math.hypot(other.b.anchorX - x, other.b.anchorY - y) < 100) { ok = false; break }
          if (Math.hypot(other.a.x - x, other.a.y - y) < 100) { ok = false; break }
        }
        if (Math.hypot(p.a.x - x, p.a.y - y) < 150) ok = false
        if (ok) break
        x += (Math.random() - 0.5) * 60
        y += (Math.random() - 0.5) * 60
        x = Math.max(margin, Math.min(this.canvas.width - margin, x))
        y = Math.max(margin, Math.min(this.canvas.height - margin, y))
      }
      p.b.anchorX = x
      p.b.anchorY = y
      p.b.x = x
      p.b.y = y
    }
  }

  private updateSecondTouch(points: Map<number, TouchPoint>) {
    // Player A pointers ainda devem estar ativos
    if (!this.players.every(p => p.a.pointerId !== null && points.get(p.a.pointerId)?.active === true)) {
      this.fail('Alguém soltou o primeiro dedo')
      return
    }
    // Atualiza posição dos primeiros dedos
    for (const p of this.players) {
      const pt = points.get(p.a.pointerId!)
      if (pt) { p.a.x = pt.x; p.a.y = pt.y }
    }

    // Detecta novos toques (pointer IDs novos) próximos às anchors
    const playerAIds = new Set(this.players.map(p => p.a.pointerId))
    const playerBIds = new Set(this.players.map(p => p.b.pointerId).filter(id => id !== null))
    for (const [id, pt] of points) {
      if (!pt.active) continue
      if (playerAIds.has(id) || playerBIds.has(id)) continue
      // É um pointer novo — verifica qual anchor B está próxima
      let best: Player | null = null
      let bestD = ANCHOR_RADIUS
      for (const p of this.players) {
        if (p.b.pointerId !== null) continue
        const d = Math.hypot(p.b.anchorX - pt.x, p.b.anchorY - pt.y)
        if (d < bestD) { bestD = d; best = p }
      }
      if (best) {
        best.b.pointerId = id
        best.b.x = pt.x
        best.b.y = pt.y
      }
    }

    // Atualiza posição dos segundos dedos
    for (const p of this.players) {
      if (p.b.pointerId !== null) {
        const pt = points.get(p.b.pointerId)
        if (pt?.active) { p.b.x = pt.x; p.b.y = pt.y }
        else p.b.pointerId = null
      }
    }

    const allReady = this.players.every(p => p.b.pointerId !== null)
    if (allReady) {
      this.startPlaying()
      return
    }

    // Timeout
    if (this.phaseElapsed >= SECOND_TOUCH_TIMEOUT) {
      this.fail('Tempo esgotado no segundo toque')
      return
    }

    // Desenha primeiros dedos e anchors da bolinha B pulsando
    for (const p of this.players) {
      this.drawNode(p.a, false, false)
      if (p.b.pointerId === null) this.drawAnchor(p.b, this.phaseElapsed)
      else this.drawNode(p.b, false, false)
    }
    this.drawSecondTouchHUD()
  }

  // ─── PLAYING ────────────────────────────────────────────────────
  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.levelElapsed = 0
    this.level = 1
    this.generateEdges()
    this.generateObstacles()
    this.stableTime = 0
    this.levelFlash = 1
  }

  private advanceLevel() {
    const speedFactor = Math.max(0.3, 1 - this.levelElapsed / levelTimeout(this.level))
    const score = Math.floor(100 * this.players.length * this.level * speedFactor)
    this.session.addScore(score)
    this.level++
    this.levelElapsed = 0
    this.stableTime = 0
    this.levelFlash = 1
    this.generateEdges()
    this.generateObstacles()
  }

  private updatePlaying(points: Map<number, TouchPoint>, dt: number) {
    // Todos os 2N dedos precisam estar ativos
    for (const p of this.players) {
      if (p.a.pointerId === null || !points.get(p.a.pointerId)?.active) {
        this.fail('Alguém soltou o dedo!')
        return
      }
      if (p.b.pointerId === null || !points.get(p.b.pointerId)?.active) {
        this.fail('Alguém soltou o dedo!')
        return
      }
    }
    // Sync positions
    for (const p of this.players) {
      const pa = points.get(p.a.pointerId!)
      const pb = points.get(p.b.pointerId!)
      if (pa) { p.a.x = pa.x; p.a.y = pa.y }
      if (pb) { p.b.x = pb.x; p.b.y = pb.y }
    }

    this.levelElapsed += dt
    this.levelFlash = Math.max(0, this.levelFlash - dt * 1.2)
    this.updateObstacles(dt)

    if (this.levelElapsed >= levelTimeout(this.level)) {
      this.fail(`Nível ${this.level}: tempo esgotado`)
      return
    }

    const crossings = this.countCrossings()
    if (crossings === 0) {
      this.stableTime += dt
      if (this.stableTime >= STABLE_REQUIRED) {
        this.advanceLevel()
      }
    } else {
      this.stableTime = 0
    }

    this.drawObstacles()
    this.drawEdges(crossings > 0)
    for (const p of this.players) {
      this.drawNode(p.a, false, false)
      this.drawNode(p.b, false, false)
    }
    this.drawPlayingHUD(crossings)
    this.drawLevelFlash()
  }

  // ─── GERAÇÃO ────────────────────────────────────────────────────
  private generateEdges() {
    const n = this.players.length
    this.edges = []
    // Liga cada A a um B de COR DIFERENTE (permutação), escolhendo a que MAIS
    // cruza nas posições atuais dos dedos — inclusive no nível 1. Assim toda
    // troca de fase muda as conexões e SEMPRE exige mover os dedos para
    // desemaranhar (antes, nível 1 e algumas transições não pediam movimento).
    const required = Math.max(1, Math.floor(n / 2))
    let baseEdges: Edge[] = []
    let bestCross = -1
    for (let attempts = 0; attempts < 300; attempts++) {
      const bShuffled = this.players.map(p => p.b)
      this.shuffle(bShuffled)
      const candidate: Edge[] = []
      let allDifferent = true
      for (let i = 0; i < n; i++) {
        if (this.players[i].a.color === bShuffled[i].color) {
          allDifferent = false
          break
        }
        candidate.push({ from: this.players[i].a, to: bShuffled[i] })
      }
      if (!allDifferent) continue
      const crossings = this.countCrossingsFor(candidate)
      if (crossings > bestCross) { bestCross = crossings; baseEdges = candidate }
      // aceita cedo de vez em quando p/ variar a topologia entre as fases
      if (crossings >= required && Math.random() < 0.3) break
    }
    if (baseEdges.length === 0) {
      for (const p of this.players) baseEdges.push({ from: p.a, to: p.b })
    }
    this.edges = baseEdges

    // Arestas extras em níveis altos: conecta pares aleatórios não já conectados
    const extras = extraEdgeCount(this.level)
    const allNodes: NodeRef[] = this.players.flatMap(p => [p.a, p.b])
    const tryAddRandomEdge = (): boolean => {
      for (let attempts = 0; attempts < 50; attempts++) {
        const a = allNodes[Math.floor(Math.random() * allNodes.length)]
        const b = allNodes[Math.floor(Math.random() * allNodes.length)]
        if (a === b || a.color === b.color) continue
        const exists = this.edges.some(e =>
          (e.from === a && e.to === b) || (e.from === b && e.to === a)
        )
        if (exists) continue
        this.edges.push({ from: a, to: b })
        return true
      }
      return false
    }
    for (let i = 0; i < extras; i++) tryAddRandomEdge()

    // GARANTE cruzamentos suficientes nas posições atuais dos dedos: se os
    // jogadores deixaram tudo parado, força arestas até haver o mínimo exigido,
    // obrigando reorganização física a cada fase.
    let safety = 14
    while (this.countCrossingsFor(this.edges) < required && safety-- > 0) {
      if (!tryAddRandomEdge()) break
    }
  }

  private generateObstacles() {
    this.obstacles = []
    const count = obstacleCount(this.level)
    const margin = 100
    // Obstáculos crescem com o nível
    const rBase = 35 + Math.min(this.level - 3, 4) * 4
    for (let i = 0; i < count; i++) {
      for (let t = 0; t < 20; t++) {
        const x = margin + Math.random() * (this.canvas.width - margin * 2)
        const y = margin + Math.random() * (this.canvas.height - margin * 2)
        const r = rBase + Math.random() * 18
        let ok = true
        for (const p of this.players) {
          if (Math.hypot(p.a.x - x, p.a.y - y) < r + 60) { ok = false; break }
          if (Math.hypot(p.b.x - x, p.b.y - y) < r + 60) { ok = false; break }
        }
        for (const ob of this.obstacles) {
          if (Math.hypot(ob.x - x, ob.y - y) < ob.r + r + 30) { ok = false; break }
        }
        if (!ok) continue
        const moves = obstaclesMove(this.level)
        const speed = moves ? 30 + Math.random() * 20 : 0
        const angle = Math.random() * Math.PI * 2
        this.obstacles.push({
          x, y, r,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
        })
        break
      }
    }
  }

  private updateObstacles(dt: number) {
    if (!obstaclesMove(this.level)) return
    const margin = 40
    for (const ob of this.obstacles) {
      ob.x += ob.vx * dt
      ob.y += ob.vy * dt
      if (ob.x - ob.r < margin) { ob.x = margin + ob.r; ob.vx = Math.abs(ob.vx) }
      if (ob.x + ob.r > this.canvas.width - margin) { ob.x = this.canvas.width - margin - ob.r; ob.vx = -Math.abs(ob.vx) }
      if (ob.y - ob.r < margin) { ob.y = margin + ob.r; ob.vy = Math.abs(ob.vy) }
      if (ob.y + ob.r > this.canvas.height - margin) { ob.y = this.canvas.height - margin - ob.r; ob.vy = -Math.abs(ob.vy) }
    }
  }

  private shuffle<T>(arr: T[]) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
  }

  // ─── COLISÕES ────────────────────────────────────────────────────
  private countCrossings(): number {
    return this.countCrossingsFor(this.edges)
  }

  private countCrossingsFor(edges: Edge[]): number {
    let count = 0
    for (let i = 0; i < edges.length; i++) {
      for (let j = i + 1; j < edges.length; j++) {
        if (this.edgesIntersect(edges[i], edges[j])) count++
      }
    }
    for (const e of edges) {
      for (const ob of this.obstacles) {
        if (this.segIntersectsCircle(e, ob)) count++
      }
    }
    return count
  }

  private edgesIntersect(a: Edge, b: Edge): boolean {
    const { x: x1, y: y1 } = a.from; const { x: x2, y: y2 } = a.to
    const { x: x3, y: y3 } = b.from; const { x: x4, y: y4 } = b.to
    const d1x = x2 - x1, d1y = y2 - y1
    const d2x = x4 - x3, d2y = y4 - y3
    const cross = d1x * d2y - d1y * d2x
    if (Math.abs(cross) < 1e-10) return false
    const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / cross
    const u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / cross
    return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98
  }

  private segIntersectsCircle(edge: Edge, c: Obstacle): boolean {
    const { x: x1, y: y1 } = edge.from
    const { x: x2, y: y2 } = edge.to
    const dx = x2 - x1, dy = y2 - y1
    const lenSq = dx * dx + dy * dy
    if (lenSq < 1) return Math.hypot(x1 - c.x, y1 - c.y) < c.r
    let t = ((c.x - x1) * dx + (c.y - y1) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    const px = x1 + t * dx
    const py = y1 + t * dy
    return Math.hypot(px - c.x, py - c.y) < c.r
  }

  private fail(reason: string) {
    this.phase = 'gameover'
    this.failReason = reason
    this.session.end()
  }

  // ─── DESENHO ────────────────────────────────────────────────────
  private drawNode(node: NodeRef, pulse: boolean, isAnchor: boolean) {
    const { ctx } = this
    const t = this.phaseElapsed
    const pulseR = pulse ? 6 + Math.sin(t * 6) * 6 : 0
    // Halo grande externo (visível mesmo com dedo em cima)
    ctx.beginPath()
    ctx.arc(node.x, node.y, 58 + pulseR, 0, Math.PI * 2)
    ctx.fillStyle = node.color + '15'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(node.x, node.y, 42 + pulseR, 0, Math.PI * 2)
    ctx.fillStyle = node.color + '28'
    ctx.fill()
    // Anel externo brilhante
    ctx.beginPath()
    ctx.arc(node.x, node.y, 38 + pulseR, 0, Math.PI * 2)
    ctx.strokeStyle = node.color
    ctx.lineWidth = 3
    ctx.shadowBlur = 28
    ctx.shadowColor = node.color
    ctx.stroke()
    ctx.shadowBlur = 0
    // Núcleo
    ctx.beginPath()
    ctx.arc(node.x, node.y, 22, 0, Math.PI * 2)
    ctx.fillStyle = isAnchor ? 'transparent' : node.color + '55'
    ctx.fill()
    ctx.strokeStyle = node.color
    ctx.lineWidth = 4
    ctx.shadowBlur = 24
    ctx.shadowColor = node.color
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  private drawAnchor(node: NodeRef, time: number) {
    const { ctx } = this
    const pulse = (Math.sin(time * 4) + 1) / 2
    const r = 30 + pulse * 12
    // Halo
    ctx.beginPath()
    ctx.arc(node.anchorX, node.anchorY, 70, 0, Math.PI * 2)
    ctx.fillStyle = node.color + '15'
    ctx.fill()
    // Anel tracejado animado
    ctx.beginPath()
    ctx.arc(node.anchorX, node.anchorY, r, 0, Math.PI * 2)
    ctx.strokeStyle = node.color
    ctx.lineWidth = 3
    ctx.setLineDash([8, 8])
    ctx.lineDashOffset = -time * 20
    ctx.shadowBlur = 28
    ctx.shadowColor = node.color
    ctx.stroke()
    ctx.setLineDash([])
    ctx.shadowBlur = 0
    // Sinal "+"
    ctx.fillStyle = node.color
    ctx.font = 'bold 28px system-ui'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('+', node.anchorX, node.anchorY)
  }

  private drawNodes(_extras: NodeRef[], _pulse: boolean) {
    // no-op: kept for compatibility
  }

  private drawEdges(anyCrossing: boolean) {
    const { ctx } = this
    for (const e of this.edges) {
      ctx.beginPath()
      ctx.moveTo(e.from.x, e.from.y)
      ctx.lineTo(e.to.x, e.to.y)
      const grad = ctx.createLinearGradient(e.from.x, e.from.y, e.to.x, e.to.y)
      grad.addColorStop(0, e.from.color)
      grad.addColorStop(1, e.to.color)
      ctx.strokeStyle = grad
      ctx.lineWidth = 4
      ctx.shadowBlur = 20
      ctx.shadowColor = anyCrossing ? '#ff4444' : e.from.color
      ctx.stroke()
      ctx.shadowBlur = 0
    }

    if (anyCrossing) {
      for (let i = 0; i < this.edges.length; i++) {
        for (let j = i + 1; j < this.edges.length; j++) {
          const pt = this.intersectionPoint(this.edges[i], this.edges[j])
          if (!pt) continue
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, 14, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255,68,68,0.7)'
          ctx.fill()
          ctx.strokeStyle = '#ff4444'
          ctx.lineWidth = 2
          ctx.shadowBlur = 18
          ctx.shadowColor = '#ff4444'
          ctx.stroke()
          ctx.shadowBlur = 0
        }
      }
    }
  }

  private drawObstacles() {
    const { ctx } = this
    for (const ob of this.obstacles) {
      ctx.beginPath()
      ctx.arc(ob.x, ob.y, ob.r, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(80,40,40,0.6)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,80,80,0.5)'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 6])
      ctx.stroke()
      ctx.setLineDash([])
    }
  }

  private intersectionPoint(a: Edge, b: Edge): { x: number; y: number } | null {
    const { x: x1, y: y1 } = a.from; const { x: x2, y: y2 } = a.to
    const { x: x3, y: y3 } = b.from; const { x: x4, y: y4 } = b.to
    const d1x = x2 - x1, d1y = y2 - y1
    const d2x = x4 - x3, d2y = y4 - y3
    const cross = d1x * d2y - d1y * d2x
    if (Math.abs(cross) < 1e-10) return null
    const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / cross
    const u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / cross
    if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) {
      return { x: x1 + t * d1x, y: y1 + t * d1y }
    }
    return null
  }

  // ─── HUDs ───────────────────────────────────────────────────────
  private drawCheckinHUD(remaining: number, canStart: boolean) {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    if (this.players.length === 0) {
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.min(canvas.width * 0.07, 32)}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('TOQUEM E SEGUREM', cx, cy - 20)
      ctx.fillStyle = '#888'
      ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
      ctx.fillText('um dedo por jogador · 2 a 6 pessoas', cx, cy + 20)
      return
    }
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${this.players.length} / ${this.meta.maxPlayers} jogadores`, cx, 20)
    if (canStart) {
      ctx.fillStyle = '#ffab40'
      ctx.font = `bold ${Math.min(canvas.width * 0.18, 80)}px system-ui`
      ctx.textBaseline = 'middle'
      ctx.shadowBlur = 32
      ctx.shadowColor = '#ffab40'
      ctx.fillText(Math.ceil(remaining).toString(), cx, cy)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#888'
      ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
      ctx.textBaseline = 'top'
      ctx.fillText('logo precisarão de um 2º dedo', cx, cy + 60)
    } else {
      ctx.fillStyle = '#888'
      ctx.font = `${Math.min(canvas.width * 0.045, 18)}px system-ui`
      ctx.textBaseline = 'middle'
      ctx.fillText(`aguardando mais ${this.meta.minPlayers - this.players.length} jogador(es)…`, cx, cy)
    }
  }

  private drawSecondTouchHUD() {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const ready = this.players.filter(p => p.b.pointerId !== null).length
    ctx.fillStyle = '#00e676'
    ctx.font = `bold ${Math.min(canvas.width * 0.07, 28)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.shadowBlur = 24
    ctx.shadowColor = '#00e676'
    ctx.fillText('AGORA O 2º DEDO', cx, 20)
    ctx.shadowBlur = 0
    ctx.fillStyle = '#888'
    ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.fillText(`toquem na bolinha pulsante da sua cor — ${ready}/${this.players.length} prontos`, cx, 60)
  }

  private drawPlayingHUD(crossings: number) {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const remaining = Math.max(0, levelTimeout(this.level) - this.levelElapsed)
    // canto esq: nível e timer
    ctx.fillStyle = '#888'
    ctx.font = `bold ${Math.min(canvas.width * 0.035, 14)}px system-ui`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`NÍVEL ${this.level}`, 16, 16)
    ctx.fillStyle = remaining < 10 ? '#ff4444' : '#888'
    ctx.fillText(`${Math.ceil(remaining)}s`, 16, 36)

    if (crossings > 0) {
      ctx.fillStyle = '#ff4444'
      ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(`⚡ ${crossings} cruzamento${crossings > 1 ? 's' : ''}`, cx, 16)
    } else {
      const progress = this.stableTime / STABLE_REQUIRED
      ctx.fillStyle = '#00e676'
      ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(`✓ segurem... ${(STABLE_REQUIRED - this.stableTime).toFixed(1)}s`, cx, 16)
      const barW = Math.min(canvas.width * 0.6, 300)
      const barX = cx - barW / 2
      ctx.fillStyle = 'rgba(0,230,118,0.2)'
      ctx.fillRect(barX, 48, barW, 6)
      ctx.fillStyle = '#00e676'
      ctx.fillRect(barX, 48, barW * progress, 6)
    }
  }

  private drawLevelFlash() {
    if (this.levelFlash <= 0) return
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    ctx.fillStyle = `rgba(0,230,118,${this.levelFlash * 0.15})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = `rgba(0,230,118,${this.levelFlash})`
    ctx.font = `bold ${Math.min(canvas.width * 0.13, 60)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 36
    ctx.shadowColor = '#00e676'
    ctx.fillText(`NÍVEL ${this.level}`, cx, cy)
    ctx.shadowBlur = 0
  }

  private drawGameover() {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    ctx.fillStyle = 'rgba(255,68,68,0.1)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ff4444'
    ctx.font = `bold ${Math.min(canvas.width * 0.12, 56)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 36
    ctx.shadowColor = '#ff4444'
    ctx.fillText('FIM', cx, cy - 40)
    ctx.shadowBlur = 0
    ctx.fillStyle = '#ccc'
    ctx.font = `${Math.min(canvas.width * 0.045, 18)}px system-ui`
    ctx.fillText(this.failReason, cx, cy + 10)
    ctx.fillStyle = '#888'
    ctx.font = `${Math.min(canvas.width * 0.04, 14)}px system-ui`
    ctx.fillText(`Chegaram ao nível ${this.level}`, cx, cy + 40)
  }
}

export const raiosGame = new RaiosGame()
