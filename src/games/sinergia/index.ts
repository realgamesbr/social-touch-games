import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { COLORS, alphaHex, segmentsIntersect, segmentIntersectionPoint } from '../../core/helpers'

const META: GameMeta = {
  id: 'sinergia',
  title: 'Sinergia',
  emoji: '✺',
  tagline: 'Toquem os pontos. Sigam. Descubram juntos.',
  minPlayers: 4,
  maxPlayers: 8,
  duration: 0,
  color: '#aa55ff',
  zen: true,
}

// ─── Tuning ─────────────────────────────────────────────────────
const POOL = 8
const MIN_PLAYERS = 4
const CLAIM_RADIUS = 78
const BOND_RADIUS = 98
const ENERGY_RISE = 0.5          // s para encher
const ENERGY_DECAY = 1.5         // s para esvair
const ENERGY_FREEZE = 0.25       // abaixo disto o ponto congela (desconectado)
const COLLECTIVE_EXTRA_DECAY = 1.2
const IGNITE_TIME = 3.0
const AGENCY_RISE = 6.0          // s de coerência alta até agency=1
const UNTANGLE_ARM_AGENCY = 0.85
const UNTANGLE_ARM_TIME = 2.0
const UNTANGLE_STABLE = 1.5
const POST_BLOOM_CALM = 6.0
const FALLBACK_TIME = 2.0

const PENTA = [261.63, 329.63, 392.0, 523.25, 659.25] // dó maior pentatônica

type Phase = 'gathering' | 'following' | 'untangling' | 'bloom'
type BloomPhase = 'converge' | 'burst' | 'done'

interface Point {
  id: number
  color: string
  x: number
  y: number
  seedX: number
  seedY: number
  wsx: number
  wsy: number
  bondPointerId: number | null
  energy: number
  near: boolean
  fx: number
  fy: number
  dissolving: boolean
  dissolve: number
  bloomOffX: number
  bloomOffY: number
  trail: { x: number; y: number }[]
}

interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; color: string; size: number
}

interface AudioRig {
  ctx: AudioContext
  master: GainNode
  lp: BiquadFilterNode
}

export class SinergiaGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager

  private phase: Phase = 'gathering'
  private bloomPhase: BloomPhase = 'converge'
  private points: Point[] = []
  private edges: [number, number][] = []
  private particles: Particle[] = []
  private nextId = 0
  private time = 0

  private agency = 0
  private coherence = 0
  private collectiveEbb = false
  private desat = 0

  private igniteTimer = 0
  private armTimer = 0
  private untangleStable = 0
  private fallbackTimer = 0
  private calmTimer = 0
  private bloomTimer = 0
  private lastBondChange = 0

  private pts: Map<number, TouchPoint> = new Map()
  private audio: AudioRig | null = null
  private audioNodes: OscillatorNode[] = []

  init(canvas: HTMLCanvasElement, touch: TouchManager, _session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.phase = 'gathering'
    this.points = []
    this.edges = []
    this.particles = []
    this.nextId = 0
    this.time = 0
    this.agency = 0
    this.coherence = 0
    this.collectiveEbb = false
    this.desat = 0
    this.igniteTimer = 0
    this.armTimer = 0
    this.untangleStable = 0
    this.fallbackTimer = 0
    this.calmTimer = 0
    this.bloomTimer = 0
    this.lastBondChange = 0
    this.resize()
    window.addEventListener('resize', this.resize)
    this.ensurePool()
  }

  update(dt: number) {
    this.time += dt
    this.pts = this.touch.getPoints()

    if (!this.audio && this.hasAnyActive()) this.initAudio()

    this.updateBonds()
    this.updateEnergy(dt)

    switch (this.phase) {
      case 'gathering': this.runGathering(dt); break
      case 'following': this.runFollowing(dt); break
      case 'untangling': this.runUntangling(dt); break
      case 'bloom': this.runBloom(dt); break
    }

    this.advanceDissolve(dt)
    this.movePoints(dt)
    this.updateTrails()
    this.updateParticles(dt)
    this.updateAudioParams(dt)
    this.render()
  }

  destroy() {
    window.removeEventListener('resize', this.resize)
    this.audioNodes.forEach(o => { try { o.stop() } catch { /* já parado */ } })
    this.audio?.ctx.close().catch(() => {})
    this.audio = null
    this.audioNodes = []
  }

  private resize = () => {
    this.canvas.width = this.canvas.offsetWidth
    this.canvas.height = this.canvas.offsetHeight
  }

  // ─── Pool de pontos ───────────────────────────────────────────
  private ensurePool() {
    while (this.points.length < POOL) this.addPoint()
  }

  private addPoint() {
    const w = this.canvas.width
    const h = this.canvas.height
    const cx = w / 2, cy = h / 2
    const idx = this.points.length
    const a = (idx / POOL) * Math.PI * 2 + (Math.sin(this.nextId * 12.9898) * 0.5)
    const r = Math.min(w, h) * 0.32
    this.points.push({
      id: this.nextId++,
      color: this.freeColor(),
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r,
      seedX: (idx * 1.7) % (Math.PI * 2),
      seedY: (idx * 2.9) % (Math.PI * 2),
      wsx: 0.08 + (idx % 3) * 0.04,
      wsy: 0.09 + (idx % 4) * 0.03,
      bondPointerId: null,
      energy: 0,
      near: false,
      fx: 0, fy: 0,
      dissolving: false,
      dissolve: 0,
      bloomOffX: 0, bloomOffY: 0,
      trail: [],
    })
  }

  private freeColor(): string {
    const used = new Set(this.points.map(p => p.color))
    for (const c of COLORS) if (!used.has(c)) return c
    return COLORS[this.points.length % COLORS.length]
  }

  private active(): Point[] {
    return this.points.filter(p => !p.dissolving)
  }

  // ─── Vínculos ─────────────────────────────────────────────────
  private updateBonds() {
    // limpa vínculos cujo pointer sumiu de vez
    for (const p of this.points) {
      if (p.bondPointerId !== null && !this.pts.has(p.bondPointerId)) {
        p.bondPointerId = null
        this.lastBondChange = this.time
      }
    }
    const bound = new Set<number>()
    for (const p of this.points) if (p.bondPointerId !== null) bound.add(p.bondPointerId)

    for (const [id, tp] of this.pts) {
      if (!tp.active || bound.has(id)) continue
      let best: Point | null = null
      let bestD = CLAIM_RADIUS
      for (const p of this.points) {
        if (p.bondPointerId !== null || p.dissolving) continue
        const d = Math.hypot(p.x - tp.x, p.y - tp.y)
        if (d < bestD) { bestD = d; best = p }
      }
      if (best) {
        best.bondPointerId = id
        bound.add(id)
        this.lastBondChange = this.time
      }
    }
  }

  private updateEnergy(dt: number) {
    let broken = 0
    for (const p of this.points) {
      const tp = p.bondPointerId !== null ? this.pts.get(p.bondPointerId) : undefined
      const near = !!(tp && tp.active && Math.hypot(tp.x - p.x, tp.y - p.y) < BOND_RADIUS)
      p.near = near
      if (near && tp) { p.fx = tp.x; p.fy = tp.y }
      if (near) p.energy = Math.min(1, p.energy + dt / ENERGY_RISE)
      else p.energy = Math.max(0, p.energy - dt / ENERGY_DECAY)
      if (this.phase !== 'gathering' && !p.dissolving && !near) broken++
    }

    this.collectiveEbb = broken >= 2
    if (this.collectiveEbb) {
      for (const p of this.points) p.energy = Math.max(0, p.energy - dt / COLLECTIVE_EXTRA_DECAY)
      this.desat = Math.min(1, this.desat + dt * 1.8)
    } else {
      this.desat = Math.max(0, this.desat - dt * 1.4)
    }

    const act = this.active()
    this.coherence = act.length ? act.reduce((s, p) => s + p.energy, 0) / act.length : 0
  }

  // ─── Fases ────────────────────────────────────────────────────
  private runGathering(dt: number) {
    this.ensurePool()
    const bondedNear = this.points.filter(p => p.near).length
    const quiet = (this.time - this.lastBondChange) > 0.8
    if (bondedNear >= MIN_PLAYERS && quiet) this.igniteTimer += dt
    else this.igniteTimer = Math.max(0, this.igniteTimer - dt * 0.5)
    if (this.igniteTimer >= IGNITE_TIME) this.ignite()
  }

  private ignite() {
    for (const p of this.points) {
      if (p.bondPointerId === null) p.dissolving = true
    }
    this.phase = 'following'
    this.agency = 0
    this.igniteTimer = 0
    this.calmTimer = 0
  }

  private runFollowing(dt: number) {
    if (this.coherence > 0.7) this.agency = Math.min(1, this.agency + dt / AGENCY_RISE)
    else this.agency = Math.max(0, this.agency - dt * 0.15)

    if (this.checkFallback(dt)) return

    if (this.calmTimer > 0) this.calmTimer -= dt
    if (this.agency >= UNTANGLE_ARM_AGENCY && this.calmTimer <= 0) this.armTimer += dt
    else this.armTimer = Math.max(0, this.armTimer - dt * 0.5)
    if (this.armTimer >= UNTANGLE_ARM_TIME) this.enterUntangling()
  }

  private runUntangling(dt: number) {
    if (this.checkFallback(dt)) return
    if (this.coherence > 0.6) this.agency = Math.min(1, this.agency + dt / AGENCY_RISE)
    const c = this.countCrossings()
    if (c === 0) {
      this.untangleStable += dt
      if (this.untangleStable >= UNTANGLE_STABLE) this.enterBloom()
    } else {
      this.untangleStable = 0
    }
  }

  private runBloom(dt: number) {
    if (this.bloomPhase === 'converge') {
      const cx = this.canvas.width / 2, cy = this.canvas.height / 2
      let maxd = 0
      for (const p of this.active()) maxd = Math.max(maxd, Math.hypot(p.x - cx, p.y - cy))
      if (maxd < 70) this.burst()
    } else if (this.bloomPhase === 'burst') {
      this.bloomTimer += dt
      if (this.bloomTimer > 2.2) this.scatter()
    }
  }

  private checkFallback(dt: number): boolean {
    const live = this.active().filter(p => p.near).length
    if (live < MIN_PLAYERS) this.fallbackTimer += dt
    else this.fallbackTimer = 0
    if (this.fallbackTimer >= FALLBACK_TIME) {
      this.toGathering()
      return true
    }
    return false
  }

  private toGathering() {
    this.phase = 'gathering'
    this.agency = 0
    this.edges = []
    this.armTimer = 0
    this.fallbackTimer = 0
    this.igniteTimer = 0
    this.untangleStable = 0
  }

  private enterUntangling() {
    this.buildTangle()
    this.phase = 'untangling'
    this.armTimer = 0
    this.untangleStable = 0
  }

  private buildTangle() {
    const act = this.active()
    const n = act.length
    this.edges = []
    if (n < 4) return
    const cx = act.reduce((s, p) => s + p.x, 0) / n
    const cy = act.reduce((s, p) => s + p.y, 0) / n
    // índices (no array global) ordenados por ângulo
    const order = act
      .map(p => ({ i: this.points.indexOf(p), a: Math.atan2(p.y - cy, p.x - cx) }))
      .sort((u, v) => u.a - v.a)
      .map(o => o.i)
    const skip = 2
    const seen = new Set<string>()
    for (let i = 0; i < n; i++) {
      const a = order[i]
      const b = order[(i + skip) % n]
      if (a === b) continue
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (seen.has(key)) continue
      seen.add(key)
      this.edges.push([a, b])
    }
    // garante ao menos 1 cruzamento na config atual
    if (this.countCrossings() === 0 && n >= 4) {
      this.edges = [[order[0], order[2]], [order[1], order[3]]]
    }
  }

  private enterBloom() {
    this.phase = 'bloom'
    this.bloomPhase = 'converge'
    this.bloomTimer = 0
    this.edges = []
    for (const p of this.active()) {
      const a = Math.random() * Math.PI * 2
      p.bloomOffX = Math.cos(a) * 18
      p.bloomOffY = Math.sin(a) * 18
    }
  }

  private burst() {
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2
    const colors = this.active().map(p => p.color)
    for (let i = 0; i < 150; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 80 + Math.random() * 280
      const life = 1.4 + Math.random() * 1.2
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life, maxLife: life,
        color: colors[i % Math.max(1, colors.length)] || '#ffffff',
        size: 2 + Math.random() * 3,
      })
    }
    // acorde de sinos
    this.playBell(PENTA[0]); this.playBell(PENTA[2]); this.playBell(PENTA[4])
    this.bloomPhase = 'burst'
    this.bloomTimer = 0
  }

  private scatter() {
    const w = this.canvas.width, h = this.canvas.height
    const cx = w / 2, cy = h / 2
    const act = this.active()
    const n = act.length
    act.forEach((p, i) => {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.4
      const r = Math.min(w, h) * 0.34
      p.x = cx + Math.cos(a) * r
      p.y = cy + Math.sin(a) * r
      p.trail = []
    })
    this.bloomPhase = 'done'
    this.phase = 'following'
    this.agency = Math.max(0.6, this.agency * 0.85)
    this.calmTimer = POST_BLOOM_CALM
    this.edges = []
  }

  private advanceDissolve(dt: number) {
    let changed = false
    for (const p of this.points) {
      if (p.dissolving) { p.dissolve += dt / 0.8; changed = true }
    }
    if (changed) this.points = this.points.filter(p => p.dissolve < 1)
  }

  // ─── Geometria do emaranhado ──────────────────────────────────
  private countCrossings(): number {
    let c = 0
    for (let i = 0; i < this.edges.length; i++) {
      for (let j = i + 1; j < this.edges.length; j++) {
        if (this.edgesShareVertex(this.edges[i], this.edges[j])) continue
        const a = this.points[this.edges[i][0]]
        const b = this.points[this.edges[i][1]]
        const cc = this.points[this.edges[j][0]]
        const d = this.points[this.edges[j][1]]
        if (!a || !b || !cc || !d) continue
        if (segmentsIntersect(a.x, a.y, b.x, b.y, cc.x, cc.y, d.x, d.y)) c++
      }
    }
    return c
  }

  private edgesShareVertex(e1: [number, number], e2: [number, number]) {
    return e1[0] === e2[0] || e1[0] === e2[1] || e1[1] === e2[0] || e1[1] === e2[1]
  }

  // ─── Movimento ────────────────────────────────────────────────
  private willTarget(p: Point): { x: number; y: number } {
    const w = this.canvas.width, h = this.canvas.height
    const cx = w / 2, cy = h / 2
    const ax = (w / 2 - 90) * 0.85
    const ay = (h / 2 - 90) * 0.85
    return {
      x: cx + ax * Math.sin(this.time * p.wsx + p.seedX),
      y: cy + ay * Math.sin(this.time * p.wsy + p.seedY),
    }
  }

  private movePoints(dt: number) {
    const cx = this.canvas.width / 2, cy = this.canvas.height / 2
    for (const p of this.points) {
      let tx: number, ty: number, k: number
      if (this.phase === 'bloom' && this.bloomPhase === 'converge') {
        tx = cx + p.bloomOffX; ty = cy + p.bloomOffY; k = 1.7
      } else if (this.phase === 'gathering') {
        if (p.near) { tx = p.fx; ty = p.fy; k = 10 }
        else { const w = this.willTarget(p); tx = w.x; ty = w.y; k = 1.6 }
      } else {
        const frozen = (this.phase === 'following' || this.phase === 'untangling')
          && !p.near && p.energy < ENERGY_FREEZE
        if (frozen) continue
        const w = this.willTarget(p)
        if (p.near) {
          tx = w.x + (p.fx - w.x) * this.agency
          ty = w.y + (p.fy - w.y) * this.agency
          k = 2.4
        } else { tx = w.x; ty = w.y; k = 1.4 }
      }
      const step = Math.min(1, k * dt)
      p.x += (tx - p.x) * step
      p.y += (ty - p.y) * step
      p.x = Math.max(20, Math.min(this.canvas.width - 20, p.x))
      p.y = Math.max(20, Math.min(this.canvas.height - 20, p.y))
    }
  }

  private updateTrails() {
    for (const p of this.points) {
      p.trail.push({ x: p.x, y: p.y })
      if (p.trail.length > 14) p.trail.shift()
    }
  }

  private updateParticles(dt: number) {
    for (const pt of this.particles) {
      pt.x += pt.vx * dt
      pt.y += pt.vy * dt
      pt.vx *= 0.96
      pt.vy *= 0.96
      pt.life -= dt
    }
    this.particles = this.particles.filter(p => p.life > 0)
  }

  // ─── Áudio ────────────────────────────────────────────────────
  private hasAnyActive(): boolean {
    for (const [, tp] of this.pts) if (tp.active) return true
    return false
  }

  private initAudio() {
    try {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext
      const ctx: AudioContext = new Ctor()
      const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination)
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240; lp.Q.value = 0.6
      lp.connect(master)
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 100
      lfo.connect(lfoGain).connect(lp.frequency); lfo.start()
      const freqs = [110, 110, 164.81, 164.81, 220]
      const oscs = freqs.map((f, i) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'
        o.frequency.value = f * (1 + (i % 2 ? 0.006 : -0.006))
        const g = ctx.createGain(); g.gain.value = 0.06
        o.connect(g).connect(lp); o.start()
        return o
      })
      this.audio = { ctx, master, lp }
      this.audioNodes = [...oscs, lfo]
    } catch (e) {
      console.warn('AudioContext indisponível', e)
    }
  }

  private playBell(freq: number) {
    if (!this.audio) return
    const ctx = this.audio.ctx
    const t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6)
    o.connect(g).connect(this.audio.master)
    o.start(t); o.stop(t + 2.7)
  }

  private updateAudioParams(dt: number) {
    if (!this.audio) return
    const ebb = this.collectiveEbb ? 0.3 : 1
    const targetMaster = this.phase === 'gathering' ? 0 : 0.16 * (0.35 + 0.65 * this.coherence) * ebb
    const targetCut = (this.phase === 'gathering' ? 200 : 240 + this.coherence * 1500) * ebb
    const sm = Math.min(1, dt * 1.5)
    this.audio.master.gain.value += (targetMaster - this.audio.master.gain.value) * sm
    this.audio.lp.frequency.value += (targetCut - this.audio.lp.frequency.value) * sm
  }

  // ─── Render ───────────────────────────────────────────────────
  private render() {
    const { ctx, canvas } = this
    const cx = canvas.width / 2, cy = canvas.height / 2
    // fundo gradiente, sutilmente mais quente com coerência
    const warm = this.coherence * (1 - this.desat)
    const grad = ctx.createRadialGradient(cx, cy, 40, cx, cy, Math.max(canvas.width, canvas.height) / 2)
    grad.addColorStop(0, `rgb(${Math.floor(20 + warm * 18)},${10},${Math.floor(36 + warm * 10)})`)
    grad.addColorStop(1, '#07070d')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    ctx.globalCompositeOperation = 'lighter'
    this.drawTrails()
    this.drawEdges()
    this.drawAuras()
    this.drawCrossings()
    this.drawParticles()
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawTrails() {
    const { ctx } = this
    for (const p of this.points) {
      const glow = this.pointGlow(p)
      if (glow < 0.05) continue
      for (let i = 0; i < p.trail.length; i++) {
        const t = p.trail[i]
        const f = i / p.trail.length
        ctx.beginPath()
        ctx.arc(t.x, t.y, 5 * f, 0, Math.PI * 2)
        ctx.fillStyle = p.color + alphaHex(0.18 * f * glow)
        ctx.fill()
      }
    }
  }

  private drawEdges() {
    if (!this.edges.length) return
    const { ctx } = this
    for (const [ai, bi] of this.edges) {
      const a = this.points[ai], b = this.points[bi]
      if (!a || !b) continue
      const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y)
      g.addColorStop(0, a.color + alphaHex(0.7))
      g.addColorStop(1, b.color + alphaHex(0.7))
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = g
      ctx.lineWidth = 3
      ctx.stroke()
    }
  }

  private drawCrossings() {
    if (!this.edges.length) return
    const { ctx } = this
    const pulse = 0.4 + 0.3 * Math.sin(this.time * 4)
    for (let i = 0; i < this.edges.length; i++) {
      for (let j = i + 1; j < this.edges.length; j++) {
        if (this.edgesShareVertex(this.edges[i], this.edges[j])) continue
        const a = this.points[this.edges[i][0]], b = this.points[this.edges[i][1]]
        const c = this.points[this.edges[j][0]], d = this.points[this.edges[j][1]]
        if (!a || !b || !c || !d) continue
        const ip = segmentIntersectionPoint(a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y)
        if (!ip) continue
        ctx.beginPath()
        ctx.arc(ip.x, ip.y, 12, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,190,90,${pulse})`
        ctx.fill()
      }
    }
  }

  private pointGlow(p: Point): number {
    const breathe = 0.16 + 0.12 * Math.sin(this.time * 1.5 + p.seedX)
    const base = p.bondPointerId !== null ? Math.max(breathe * 0.5, p.energy) : breathe
    return base * (1 - p.dissolve) * (1 - this.desat * 0.5)
  }

  private drawAuras() {
    const { ctx } = this
    for (const p of this.points) {
      const glow = this.pointGlow(p)
      if (glow < 0.02) continue
      const baseR = 24 + 28 * p.energy
      ctx.beginPath()
      ctx.arc(p.x, p.y, baseR * 2.1, 0, Math.PI * 2)
      ctx.fillStyle = p.color + alphaHex(glow * 0.10)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(p.x, p.y, baseR * 1.3, 0, Math.PI * 2)
      ctx.fillStyle = p.color + alphaHex(glow * 0.18)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(p.x, p.y, baseR, 0, Math.PI * 2)
      ctx.fillStyle = p.color + alphaHex(glow * 0.45)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(p.x, p.y, baseR * 0.5, 0, Math.PI * 2)
      ctx.fillStyle = p.color + alphaHex(glow * 0.9)
      ctx.fill()
    }
  }

  private drawParticles() {
    const { ctx } = this
    for (const pt of this.particles) {
      const a = pt.life / pt.maxLife
      ctx.beginPath()
      ctx.arc(pt.x, pt.y, pt.size * a, 0, Math.PI * 2)
      ctx.fillStyle = pt.color + alphaHex(a * 0.8)
      ctx.fill()
    }
  }
}

export const sinergiaGame = new SinergiaGame()
