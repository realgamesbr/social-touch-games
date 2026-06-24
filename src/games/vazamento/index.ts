import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'

const META: GameMeta = {
  id: 'vazamento',
  title: 'Vazamento',
  emoji: '💧',
  tagline: 'Tampem os buracos. Eles se curam e renascem em outro lugar.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#00e5ff',
}

const COLORS = ['#ff4444', '#00e676', '#ffab40', '#aa55ff', '#00e5ff', '#ff44ff']
const CHECKIN_DURATION = 5
const WATER_RISE_RATE = 0.012   // por buraco aberto / segundo
const POINTS_PER_PLUGGED_SECOND = 5
const LIFESPAN_MIN_BASE = 5     // segundos
const LIFESPAN_MAX_BASE = 9
const SPAWN_INTERVAL_INITIAL = 2.2
const SPAWN_INTERVAL_MIN = 0.7

type Phase = 'checkin' | 'playing' | 'gameover'

interface Hole {
  id: number
  x: number
  y: number
  r: number
  pluggedBy: number | null
  bornAt: number
  lifespan: number
  sprayAngle: number
}

interface Hazard {
  x: number
  y: number
  r: number
  vx: number
  vy: number
}

interface CheckinPlayer {
  pointerId: number
  color: string
  x: number
  y: number
}

export class VazamentoGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  private players: CheckinPlayer[] = []
  private holes: Hole[] = []
  private hazards: Hazard[] = []
  private nextHoleId = 0
  private waterLevel = 0
  private gameElapsed = 0
  private spawnTimer = 0
  private scoreAccum = 0

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'checkin'
    this.phaseElapsed = 0
    this.players = []
    this.holes = []
    this.hazards = []
    this.nextHoleId = 0
    this.waterLevel = 0
    this.gameElapsed = 0
    this.spawnTimer = 0
    this.scoreAccum = 0
    this.resize()
    window.addEventListener('resize', this.resize)
  }

  update(dt: number) {
    this.phaseElapsed += dt
    this.ctx.fillStyle = '#0a1628'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    const points = this.touch.getPoints()

    switch (this.phase) {
      case 'checkin':
        this.updateCheckin(points)
        break
      case 'playing':
        this.updatePlaying(points, dt)
        break
      case 'gameover':
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
      const existing = this.players.find(p => p.pointerId === id)
      if (existing) { existing.x = pt.x; existing.y = pt.y }
      else if (this.players.length < this.meta.maxPlayers) {
        this.players.push({
          pointerId: id,
          color: COLORS[this.players.length],
          x: pt.x, y: pt.y,
        })
      }
    }
    this.players = this.players.filter(p => activeIds.has(p.pointerId))

    const canStart = this.players.length >= this.meta.minPlayers
    if (!canStart) this.phaseElapsed = 0

    const remaining = Math.max(0, CHECKIN_DURATION - this.phaseElapsed)
    if (canStart && remaining <= 0) {
      this.startPlaying()
      return
    }

    this.drawCheckinPlayers()
    this.drawCheckinHUD(remaining, canStart)
  }

  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.gameElapsed = 0
    this.spawnTimer = 0
    this.scoreAccum = 0
    this.holes = []
    this.spawnHazards()
    // Spawn inicial escalonado: começa com 1 buraco
    this.spawnHole()
  }

  private spawnHazards() {
    this.hazards = []
    const count = 2 + Math.floor(this.players.length / 2)
    const w = this.canvas.width
    const h = this.canvas.height
    const margin = 90
    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, tries = 0
      do {
        x = margin + Math.random() * (w - margin * 2)
        y = margin + Math.random() * (h - margin * 2)
        tries++
      } while (tries < 25 && this.players.some(p => Math.hypot(p.x - x, p.y - y) < 150))
      const angle = Math.random() * Math.PI * 2
      const speed = 35 + Math.random() * 35
      this.hazards.push({
        x, y,
        r: 30 + Math.random() * 16,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
      })
    }
  }

  private updateHazards(dt: number) {
    const m = 30
    for (const z of this.hazards) {
      z.x += z.vx * dt
      z.y += z.vy * dt
      if (z.x - z.r < m) { z.x = m + z.r; z.vx = Math.abs(z.vx) }
      if (z.x + z.r > this.canvas.width - m) { z.x = this.canvas.width - m - z.r; z.vx = -Math.abs(z.vx) }
      if (z.y - z.r < m) { z.y = m + z.r; z.vy = Math.abs(z.vy) }
      if (z.y + z.r > this.canvas.height - m) { z.y = this.canvas.height - m - z.r; z.vy = -Math.abs(z.vy) }
    }
  }

  // ─── PLAYING ────────────────────────────────────────────────────
  private updatePlaying(points: Map<number, TouchPoint>, dt: number) {
    this.gameElapsed += dt
    this.spawnTimer += dt
    this.updateHazards(dt)
    this.updatePlugs(points)

    // Perde se um dedo passar por um obstáculo (grace inicial pra reagir).
    if (this.gameElapsed > 0.6) {
      for (const [, pt] of points) {
        if (!pt.active) continue
        for (const z of this.hazards) {
          if (Math.hypot(pt.x - z.x, pt.y - z.y) < z.r + 16) {
            this.phase = 'gameover'
            this.session.end()
            return
          }
        }
      }
    }

    const now = this.gameElapsed
    this.holes = this.holes.filter(h => (now - h.bornAt) < h.lifespan)

    // Target cresce com o tempo: 1N (0-20s) → 1.5N (20-40s) → 2N (40+)
    let mult = 1
    if (this.gameElapsed > 40) mult = 2
    else if (this.gameElapsed > 20) mult = 1.5
    const target = Math.floor(this.players.length * mult)

    // Spawn rate aumenta com o tempo
    const interval = Math.max(SPAWN_INTERVAL_MIN, SPAWN_INTERVAL_INITIAL - this.gameElapsed * 0.025)
    if (this.holes.length < target && this.spawnTimer >= interval) {
      this.spawnHole()
      this.spawnTimer = 0
    }

    const openHoles = this.holes.filter(h => h.pluggedBy === null).length
    const pluggedHoles = this.holes.length - openHoles
    this.waterLevel += openHoles * dt * WATER_RISE_RATE
    this.waterLevel = Math.min(this.waterLevel, 1)

    // Dedos que estão tapando buraco (o resto está em trânsito entre buracos)
    const pluggedPointerIds = new Set(this.holes.filter(h => h.pluggedBy !== null).map(h => h.pluggedBy!))

    // Score: ganha por buraco plugado (não punimos mais o dedo em trânsito —
    // a ideia agora é deslizar sem tirar o dedo da tela)
    this.scoreAccum += pluggedHoles * POINTS_PER_PLUGGED_SECOND * dt
    const whole = Math.trunc(this.scoreAccum)
    if (whole !== 0) {
      this.session.addScore(whole)
      this.scoreAccum -= whole
    }

    this.drawFloor()
    for (const hole of this.holes) this.drawHole(hole)
    this.drawHazards()
    this.drawIdleTouches(points, pluggedPointerIds)
    this.drawWaterFromEdges()
    this.drawHUD(openHoles)

    if (this.waterLevel >= 1) {
      this.phase = 'gameover'
      this.session.end()
    }
  }

  private spawnHole() {
    const margin = 80
    const w = this.canvas.width
    const h = this.canvas.height
    let attempts = 0
    let x: number, y: number
    do {
      x = margin + Math.random() * (w - margin * 2)
      y = margin + Math.random() * (h - margin * 2)
      attempts++
    } while (attempts < 25 && (
      this.holes.some(h => Math.hypot(h.x - x, h.y - y) < 100) ||
      this.hazards.some(z => Math.hypot(z.x - x, z.y - y) < z.r + 55)
    ))
    // Lifespan aleatório por buraco, reduzido com o tempo do jogo
    const lifespanScale = Math.max(0.5, 1 - this.gameElapsed * 0.008)
    const baseLifespan = LIFESPAN_MIN_BASE + Math.random() * (LIFESPAN_MAX_BASE - LIFESPAN_MIN_BASE)
    this.holes.push({
      id: this.nextHoleId++,
      x, y, r: 26,
      pluggedBy: null,
      bornAt: this.gameElapsed,
      lifespan: baseLifespan * lifespanScale,
      sprayAngle: Math.random() * Math.PI * 2,
    })
  }

  private updatePlugs(points: Map<number, TouchPoint>) {
    for (const h of this.holes) {
      if (h.pluggedBy !== null) {
        const pt = points.get(h.pluggedBy)
        if (!pt || !pt.active) h.pluggedBy = null
      }
    }
    for (const [id, pt] of points) {
      if (!pt.active) continue
      for (const h of this.holes) {
        if (h.pluggedBy !== null) continue
        if (Math.hypot(h.x - pt.x, h.y - pt.y) < h.r + 22) h.pluggedBy = id
      }
    }
  }

  // ─── DESENHO ────────────────────────────────────────────────────
  private drawFloor() {
    const { ctx, canvas } = this
    // Padrão de "chão" da mesa visto de cima
    ctx.fillStyle = '#1e3a5f'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // textura sutil
    ctx.strokeStyle = 'rgba(255,255,255,0.025)'
    ctx.lineWidth = 1
    for (let x = 0; x < canvas.width; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
    }
    for (let y = 0; y < canvas.height; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke()
    }
  }

  private drawWaterFromEdges() {
    if (this.waterLevel <= 0) return
    const { ctx, canvas } = this
    const w = canvas.width
    const h = canvas.height
    // Espessura da água por borda
    const maxMargin = Math.min(w, h) / 2
    const margin = this.waterLevel * maxMargin

    // 4 retângulos formando a moldura
    const grad = (x0: number, y0: number, x1: number, y1: number) => {
      const g = ctx.createLinearGradient(x0, y0, x1, y1)
      g.addColorStop(0, 'rgba(0,80,200,0.95)')
      g.addColorStop(1, 'rgba(0,150,255,0.55)')
      return g
    }
    ctx.fillStyle = grad(0, 0, 0, margin)
    ctx.fillRect(0, 0, w, margin)              // top
    ctx.fillStyle = grad(0, h, 0, h - margin)
    ctx.fillRect(0, h - margin, w, margin)     // bottom
    ctx.fillStyle = grad(0, 0, margin, 0)
    ctx.fillRect(0, 0, margin, h)              // left
    ctx.fillStyle = grad(w, 0, w - margin, 0)
    ctx.fillRect(w - margin, 0, margin, h)     // right

    // Wavefronts nas bordas internas
    const t = this.gameElapsed
    ctx.strokeStyle = 'rgba(150,220,255,0.6)'
    ctx.lineWidth = 2
    const waveAmp = 4
    // top
    ctx.beginPath()
    for (let x = 0; x <= w; x += 6) {
      const y = margin + Math.sin(x * 0.04 + t * 3) * waveAmp
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
    // bottom
    ctx.beginPath()
    for (let x = 0; x <= w; x += 6) {
      const y = h - margin + Math.sin(x * 0.04 + t * 3 + 1) * waveAmp
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
    // left
    ctx.beginPath()
    for (let y = 0; y <= h; y += 6) {
      const x = margin + Math.sin(y * 0.04 + t * 3 + 2) * waveAmp
      y === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()
    // right
    ctx.beginPath()
    for (let y = 0; y <= h; y += 6) {
      const x = w - margin + Math.sin(y * 0.04 + t * 3 + 3) * waveAmp
      y === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    }
    ctx.stroke()

    // Barra global de perigo na borda inferior
    ctx.fillStyle = `rgba(255,${Math.floor(68 - this.waterLevel * 68)},68,0.9)`
    ctx.fillRect(w / 4, h - 4, (w / 2) * this.waterLevel, 4)
  }

  private drawCheckinPlayers() {
    const time = this.phaseElapsed
    for (const p of this.players) this.drawPlayerHalo(p.x, p.y, p.color, time)
  }

  private drawPlayerHalo(x: number, y: number, color: string, time: number) {
    const { ctx } = this
    const pulse = 6 + Math.sin(time * 6) * 6
    ctx.beginPath()
    ctx.arc(x, y, 58 + pulse, 0, Math.PI * 2)
    ctx.fillStyle = color + '15'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, 42 + pulse, 0, Math.PI * 2)
    ctx.fillStyle = color + '28'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x, y, 38 + pulse, 0, Math.PI * 2)
    ctx.strokeStyle = color
    ctx.lineWidth = 3
    ctx.shadowBlur = 28
    ctx.shadowColor = color
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, 22, 0, Math.PI * 2)
    ctx.fillStyle = color + '55'
    ctx.fill()
    ctx.strokeStyle = color
    ctx.lineWidth = 4
    ctx.stroke()
    ctx.shadowBlur = 0
  }

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
      ctx.fillStyle = '#aac'
      ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
      ctx.fillText('2 a 6 jogadores · deslizem sem tirar o dedo e desviem dos ⚠', cx, cy + 20)
      return
    }
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${this.players.length} / ${this.meta.maxPlayers} jogadores`, cx, 20)
    if (canStart) {
      ctx.fillStyle = '#00e5ff'
      ctx.font = `bold ${Math.min(canvas.width * 0.18, 80)}px system-ui`
      ctx.textBaseline = 'middle'
      ctx.shadowBlur = 32
      ctx.shadowColor = '#00e5ff'
      ctx.fillText(Math.ceil(remaining).toString(), cx, cy)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#aac'
      ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
      ctx.textBaseline = 'top'
      ctx.fillText('o vazamento começa em segundos…', cx, cy + 60)
    } else {
      ctx.fillStyle = '#aac'
      ctx.font = `${Math.min(canvas.width * 0.045, 18)}px system-ui`
      ctx.textBaseline = 'middle'
      ctx.fillText(`aguardando mais ${this.meta.minPlayers - this.players.length} jogador(es)…`, cx, cy)
    }
  }

  private drawHole(hole: Hole) {
    const { ctx } = this
    const plugged = hole.pluggedBy !== null
    const age = this.gameElapsed - hole.bornAt
    const lifeRatio = Math.max(0, 1 - age / hole.lifespan)

    // Halo grande (visível mesmo com dedo em cima)
    if (plugged) {
      ctx.beginPath()
      ctx.arc(hole.x, hole.y, 58, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,229,255,0.12)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(hole.x, hole.y, 44, 0, Math.PI * 2)
      ctx.strokeStyle = '#00e5ff'
      ctx.lineWidth = 3
      ctx.shadowBlur = 28
      ctx.shadowColor = '#00e5ff'
      ctx.stroke()
      ctx.shadowBlur = 0
    } else {
      ctx.beginPath()
      ctx.arc(hole.x, hole.y, 52, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,80,80,0.12)'
      ctx.fill()
    }

    // Anel de "vida" do buraco
    ctx.beginPath()
    ctx.arc(hole.x, hole.y, hole.r + 10, -Math.PI / 2, -Math.PI / 2 + lifeRatio * Math.PI * 2)
    ctx.strokeStyle = plugged ? 'rgba(0,229,255,0.5)' : 'rgba(255,200,100,0.6)'
    ctx.lineWidth = 2.5
    ctx.stroke()

    // Buraco
    ctx.beginPath()
    ctx.arc(hole.x, hole.y, hole.r, 0, Math.PI * 2)
    ctx.fillStyle = plugged ? '#0a2a4a' : '#000'
    ctx.fill()
    ctx.strokeStyle = plugged ? '#00e5ff' : '#ff4444'
    ctx.lineWidth = plugged ? 4 : 3
    ctx.shadowBlur = plugged ? 24 : 20
    ctx.shadowColor = plugged ? '#00e5ff' : '#ff4444'
    ctx.stroke()
    ctx.shadowBlur = 0

    if (!plugged) {
      // Jato de água
      const spray = this.gameElapsed * 3 + hole.id
      for (let i = 0; i < 6; i++) {
        const a = hole.sprayAngle + (i / 6) * Math.PI * 2 + spray * 0.3
        const len = 22 + Math.sin(spray + i) * 8
        const x2 = hole.x + Math.cos(a) * len
        const y2 = hole.y + Math.sin(a) * len
        ctx.beginPath()
        ctx.moveTo(hole.x, hole.y)
        ctx.lineTo(x2, y2)
        ctx.strokeStyle = `rgba(100,180,255,${0.5 + Math.sin(spray + i) * 0.3})`
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
  }

  private drawHazards() {
    const { ctx } = this
    const t = this.gameElapsed
    for (const z of this.hazards) {
      const pulse = 4 + Math.sin(t * 5 + z.x) * 4
      ctx.beginPath()
      ctx.arc(z.x, z.y, z.r + 14 + pulse, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,60,60,0.10)'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2)
      const g = ctx.createRadialGradient(z.x, z.y, z.r * 0.2, z.x, z.y, z.r)
      g.addColorStop(0, 'rgba(140,24,24,0.95)')
      g.addColorStop(1, 'rgba(60,0,0,0.85)')
      ctx.fillStyle = g
      ctx.fill()
      ctx.strokeStyle = '#ff4444'
      ctx.lineWidth = 3
      ctx.setLineDash([6, 6])
      ctx.lineDashOffset = -t * 30
      ctx.shadowBlur = 18
      ctx.shadowColor = '#ff4444'
      ctx.stroke()
      ctx.setLineDash([])
      ctx.shadowBlur = 0
      ctx.fillStyle = '#ffcc44'
      ctx.font = `bold ${Math.round(z.r * 0.9)}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('⚠', z.x, z.y)
    }
  }

  // Dedos em trânsito (deslizando entre buracos) — marcador neutro, sem punição.
  private drawIdleTouches(points: Map<number, TouchPoint>, plugged: Set<number>) {
    const { ctx } = this
    for (const [id, pt] of points) {
      if (!pt.active || plugged.has(id)) continue
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, 24, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(120,200,255,0.75)'
      ctx.lineWidth = 3
      ctx.shadowBlur = 12
      ctx.shadowColor = '#66ccff'
      ctx.stroke()
      ctx.shadowBlur = 0
    }
  }

  private drawHUD(openCount: number) {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    ctx.fillStyle = openCount > 0 ? '#ff4444' : '#00e676'
    ctx.font = `bold ${Math.min(canvas.width * 0.045, 20)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(
      openCount > 0 ? `${openCount} buraco${openCount > 1 ? 's' : ''} aberto${openCount > 1 ? 's' : ''}` : '✓ todos tapados',
      cx, 16
    )
  }
}

export const vazamentoGame = new VazamentoGame()
