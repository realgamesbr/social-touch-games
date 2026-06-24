import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { drawBackground } from '../../core/background'

const META: GameMeta = {
  id: 'pulso',
  title: 'Pulso',
  emoji: '🫀',
  tagline: 'Cada um vira parte de uma bateria coletiva.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#ff4444',
}

const CHECKIN_DURATION = 5
const BPM = 72
const BEAT_MS = 60000 / BPM
const TICKS_PER_BEAT = 2
const BAR_TICKS = 4 * TICKS_PER_BEAT
const TICK_MS = BEAT_MS / TICKS_PER_BEAT
const TOLERANCE_MS = 330
const GAME_DURATION_MS = 60000
const HIT_RADIUS = 95

const COLORS = ['#ff4444', '#00e676', '#ffab40', '#aa55ff', '#00e5ff', '#ff44ff']

interface CellDef {
  name: string
  pattern: number[]
  type: 'kick' | 'snare' | 'hihat' | 'clap' | 'openhat' | 'rim' | 'tom' | 'perc'
  freq?: number
}

const CELL_DEFS: CellDef[] = [
  { name: 'KICK',    pattern: [0, 4],          type: 'kick',    freq: 60 },
  { name: 'SNARE',   pattern: [2, 6],          type: 'snare' },
  { name: 'HIHAT',   pattern: [0, 2, 4, 6],    type: 'hihat' },
  { name: 'CLAP',    pattern: [2, 6],          type: 'clap' },
  { name: 'OPENHAT', pattern: [1, 5],          type: 'openhat' },
  { name: 'RIM',     pattern: [3, 7],          type: 'rim' },
  { name: 'TOM',     pattern: [4],             type: 'tom',     freq: 110 },
  { name: 'PERC',    pattern: [1, 3, 5],       type: 'perc',    freq: 220 },
  { name: 'BASS',    pattern: [0, 6],          type: 'kick',    freq: 45 },
  { name: 'TOM-HI',  pattern: [2],             type: 'tom',     freq: 180 },
  { name: 'CONGA',   pattern: [3, 5, 7],       type: 'perc',    freq: 320 },
  { name: 'COWBELL', pattern: [4, 6],          type: 'rim' },
]

type Phase = 'checkin' | 'playing' | 'gameover'

interface CheckinPlayer {
  pointerId: number
  color: string
  x: number
  y: number
}

interface Cell {
  defIdx: number
  playerIdx: number
  color: string
  x: number
  y: number
  r: number
  flash: number
  lastAccurate: boolean
}

export class PulsoGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager
  private audio: AudioContext | null = null

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  private players: CheckinPlayer[] = []
  private cells: Cell[] = []
  private gameStartTime = 0
  private streak = 0
  private lastPointerIds = new Set<number>()
  private unsub: (() => void) | null = null
  private lastBeatIdx = -1

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'checkin'
    this.phaseElapsed = 0
    this.players = []
    this.cells = []
    this.streak = 0
    this.lastPointerIds = new Set()
    this.resize()
    window.addEventListener('resize', this.resize)
    this.unsub = touch.subscribe(points => this.handleTouchEvent(points))
  }

  update(dt: number) {
    this.phaseElapsed += dt
    drawBackground(this.ctx, this.canvas)
    const points = this.touch.getPoints()

    switch (this.phase) {
      case 'checkin':
        this.updateCheckin(points)
        break
      case 'playing':
        this.updatePlaying()
        break
      case 'gameover':
        break
    }
  }

  destroy() {
    window.removeEventListener('resize', this.resize)
    this.unsub?.()
    this.audio?.close()
  }

  private resize = () => {
    this.canvas.width = this.canvas.offsetWidth
    this.canvas.height = this.canvas.offsetHeight
    this.layoutCells()
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

  // ─── INÍCIO DO JOGO ─────────────────────────────────────────────
  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.gameStartTime = Date.now()
    this.lastBeatIdx = -1
    this.layoutCells()
    try { this.audio = new AudioContext() } catch (e) { console.warn(e) }
  }

  private layoutCells() {
    if (this.players.length === 0) return
    const n = this.players.length
    const w = this.canvas.width
    const h = this.canvas.height
    const cx = w / 2
    const cy = h / 2
    const maxR = Math.min(w, h) / 2 - 30
    const midR = maxR * 0.62              // mesmo raio pras 2 bolinhas
    const bubbleR = Math.min(maxR * 0.13, 42)
    const sliceWidth = (Math.PI * 2) / n
    const angleOffset = sliceWidth * 0.22 // separação angular dentro da fatia

    this.cells = []
    for (let p = 0; p < n; p++) {
      // ângulo central da fatia (0 no topo, sentido horário)
      const centerAngle = -Math.PI / 2 + (p / n) * Math.PI * 2 + (Math.PI / n)
      for (let c = 0; c < 2; c++) {
        // Lado a lado radialmente: ambas no mesmo raio, ângulos diferentes
        const angle = centerAngle + (c === 0 ? -angleOffset : angleOffset)
        const defIdx = (p * 2 + c) % CELL_DEFS.length
        this.cells.push({
          defIdx,
          playerIdx: p,
          color: COLORS[p],
          x: cx + Math.cos(angle) * midR,
          y: cy + Math.sin(angle) * midR,
          r: bubbleR,
          flash: 0,
          lastAccurate: false,
        })
      }
    }
  }

  // ─── PLAYING ────────────────────────────────────────────────────
  private updatePlaying() {
    const nowMs = Date.now() - this.gameStartTime
    if (nowMs >= GAME_DURATION_MS) {
      this.phase = 'gameover'
      this.session.end()
      return
    }

    this.updateMetronome(nowMs)
    this.drawPizzaBackground()
    this.drawMetronome(nowMs)
    this.drawCells(nowMs)
    this.drawPlayingHUD(nowMs)
  }

  // ─── METRÔNOMO ──────────────────────────────────────────────────
  // Luz central pisca a cada batida (downbeat mais forte) + clique sutil,
  // pra todo mundo sentir o tempo mesmo sem conhecer a música.
  private updateMetronome(nowMs: number) {
    const beatIdx = Math.floor(nowMs / BEAT_MS)
    if (beatIdx !== this.lastBeatIdx) {
      this.lastBeatIdx = beatIdx
      this.playTick(beatIdx % 4 === 0)
    }
  }

  private playTick(downbeat: boolean) {
    if (!this.audio) return
    const ctx = this.audio
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = 'square'
    o.frequency.value = downbeat ? 1600 : 1050
    const g = ctx.createGain()
    g.gain.setValueAtTime(downbeat ? 0.1 : 0.045, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05)
    o.connect(g).connect(ctx.destination)
    o.start(t); o.stop(t + 0.06)
  }

  private drawMetronome(nowMs: number) {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const beatIdx = Math.floor(nowMs / BEAT_MS)
    const phase = (nowMs % BEAT_MS) / BEAT_MS       // 0 no início da batida
    const flash = Math.pow(1 - phase, 2)            // decai ao longo da batida
    const downbeat = beatIdx % 4 === 0
    const baseR = Math.min(canvas.width, canvas.height) * 0.045
    const r = baseR * (0.7 + flash * (downbeat ? 0.95 : 0.55))
    const color = downbeat ? '#ff4444' : '#ffffff'

    // halo externo
    ctx.beginPath()
    ctx.arc(cx, cy, r * 2.3, 0, Math.PI * 2)
    ctx.fillStyle = color + this.alphaHex(0.05 + flash * 0.16)
    ctx.fill()
    // núcleo brilhante
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = color + this.alphaHex(0.22 + flash * 0.6)
    ctx.shadowBlur = 18 + flash * 40
    ctx.shadowColor = color
    ctx.fill()
    ctx.shadowBlur = 0

    // 4 pontinhos marcando as batidas da barra (o aceso indica a batida atual)
    const beatInBar = beatIdx % 4
    const dotR = baseR * 0.18
    const ring = baseR * 1.7
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i / 4) * Math.PI * 2
      const dx = cx + Math.cos(a) * ring
      const dy = cy + Math.sin(a) * ring
      const on = i === beatInBar
      ctx.beginPath()
      ctx.arc(dx, dy, dotR, 0, Math.PI * 2)
      ctx.fillStyle = on ? '#ffffff' + this.alphaHex(0.4 + flash * 0.5) : '#ffffff22'
      ctx.fill()
    }
  }

  // ─── DETECÇÃO DE TOQUES ─────────────────────────────────────────
  private handleTouchEvent(points: Map<number, TouchPoint>) {
    if (this.phase !== 'playing') {
      this.lastPointerIds = new Set([...points.keys()])
      return
    }
    const nowMs = Date.now() - this.gameStartTime
    for (const [id, pt] of points) {
      if (!pt.active) continue
      if (this.lastPointerIds.has(id)) continue
      // Novo toque — verifica bolinha mais próxima
      let best: Cell | null = null
      let bestD = HIT_RADIUS
      for (const cell of this.cells) {
        const d = Math.hypot(cell.x - pt.x, cell.y - pt.y)
        if (d < bestD) { bestD = d; best = cell }
      }
      if (best) this.evaluateHit(best, nowMs)
    }
    this.lastPointerIds = new Set()
    for (const [id, pt] of points) if (pt.active) this.lastPointerIds.add(id)
  }

  private evaluateHit(cell: Cell, nowMs: number) {
    const def = CELL_DEFS[cell.defIdx]
    const barLen = TICK_MS * BAR_TICKS
    const barIdx = Math.floor(nowMs / barLen)
    const barStart = barIdx * barLen
    const nextBarStart = (barIdx + 1) * barLen

    let bestDist = Infinity
    for (const t of def.pattern) {
      const tt1 = barStart + t * TICK_MS
      const tt2 = nextBarStart + t * TICK_MS
      bestDist = Math.min(bestDist, Math.abs(nowMs - tt1), Math.abs(nowMs - tt2))
    }

    const accurate = bestDist < TOLERANCE_MS
    cell.flash = 1
    cell.lastAccurate = accurate

    if (accurate) {
      this.streak++
      const perfectBonus = bestDist < 60 ? 2 : 1
      this.session.addScore(10 * perfectBonus + Math.min(this.streak, 10))
      this.playSound(def)
    } else {
      this.streak = 0
    }
  }

  // ─── ÁUDIO ──────────────────────────────────────────────────────
  private playSound(def: CellDef) {
    if (!this.audio) return
    const ctx = this.audio
    const t = ctx.currentTime
    switch (def.type) {
      case 'kick': {
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.setValueAtTime(def.freq ?? 60, t)
        o.frequency.exponentialRampToValueAtTime(30, t + 0.12)
        g.gain.setValueAtTime(0.7, t)
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.18)
        o.connect(g).connect(ctx.destination)
        o.start(t); o.stop(t + 0.2)
        break
      }
      case 'snare': {
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.12)
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 1
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.5, t)
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.12)
        src.connect(bp).connect(g).connect(ctx.destination)
        src.start(t)
        break
      }
      case 'hihat': {
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.04)
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.25, t)
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.04)
        src.connect(hp).connect(g).connect(ctx.destination)
        src.start(t)
        break
      }
      case 'openhat': {
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.2)
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.2, t)
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.2)
        src.connect(hp).connect(g).connect(ctx.destination)
        src.start(t)
        break
      }
      case 'clap': {
        const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer(0.08)
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.8
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.4, t)
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.08)
        src.connect(bp).connect(g).connect(ctx.destination)
        src.start(t)
        break
      }
      case 'rim': {
        const o = ctx.createOscillator(); o.type = 'triangle'
        o.frequency.value = 400
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.4, t)
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.05)
        o.connect(g).connect(ctx.destination)
        o.start(t); o.stop(t + 0.06)
        break
      }
      case 'tom': {
        const o = ctx.createOscillator()
        o.frequency.setValueAtTime(def.freq ?? 110, t)
        o.frequency.exponentialRampToValueAtTime((def.freq ?? 110) * 0.5, t + 0.2)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.5, t)
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.25)
        o.connect(g).connect(ctx.destination)
        o.start(t); o.stop(t + 0.3)
        break
      }
      case 'perc': {
        const o = ctx.createOscillator(); o.type = 'square'
        o.frequency.value = def.freq ?? 220
        const g = ctx.createGain()
        g.gain.setValueAtTime(0.18, t)
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.08)
        o.connect(g).connect(ctx.destination)
        o.start(t); o.stop(t + 0.09)
        break
      }
    }
  }

  private noiseBuffer(duration: number): AudioBuffer {
    const ctx = this.audio!
    const sr = ctx.sampleRate
    const buf = ctx.createBuffer(1, Math.floor(sr * duration), sr)
    const data = buf.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    return buf
  }

  // ─── DESENHO ────────────────────────────────────────────────────
  private drawCheckinPlayers() {
    const time = this.phaseElapsed
    for (const p of this.players) this.drawHalo(p.x, p.y, p.color, time, true)
  }

  private drawHalo(x: number, y: number, color: string, time: number, pulsing: boolean) {
    const { ctx } = this
    const pulse = pulsing ? 6 + Math.sin(time * 6) * 6 : 0
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
      ctx.fillStyle = '#888'
      ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
      ctx.fillText('cada um vira parte da pizza · 2 a 6 jogadores', cx, cy + 20)
      return
    }
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${this.players.length} / ${this.meta.maxPlayers} jogadores`, cx, 20)
    if (canStart) {
      ctx.fillStyle = '#ff4444'
      ctx.font = `bold ${Math.min(canvas.width * 0.18, 80)}px system-ui`
      ctx.textBaseline = 'middle'
      ctx.shadowBlur = 32
      ctx.shadowColor = '#ff4444'
      ctx.fillText(Math.ceil(remaining).toString(), cx, cy)
      ctx.shadowBlur = 0
      ctx.fillStyle = '#888'
      ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
      ctx.textBaseline = 'top'
      ctx.fillText('cada fatia terá 2 instrumentos', cx, cy + 60)
    } else {
      ctx.fillStyle = '#888'
      ctx.font = `${Math.min(canvas.width * 0.045, 18)}px system-ui`
      ctx.textBaseline = 'middle'
      ctx.fillText(`aguardando mais ${this.meta.minPlayers - this.players.length} jogador(es)…`, cx, cy)
    }
  }

  private drawPizzaBackground() {
    const { ctx, canvas } = this
    const n = this.players.length
    if (n === 0) return
    const cx = canvas.width / 2
    const cy = canvas.height / 2
    const r = Math.min(canvas.width, canvas.height) / 2 - 24

    // Círculo externo sutil
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Linhas divisórias das fatias
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r)
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }

  private drawCells(nowMs: number) {
    const { ctx } = this
    const barLen = TICK_MS * BAR_TICKS
    const barStart = Math.floor(nowMs / barLen) * barLen

    for (const cell of this.cells) {
      const def = CELL_DEFS[cell.defIdx]
      // próxima batida programada
      let nextTime = Infinity
      for (const t of def.pattern) {
        const tt1 = barStart + t * TICK_MS
        const tt2 = tt1 + barLen
        const cand = tt1 >= nowMs - 50 ? tt1 : tt2
        if (cand < nextTime) nextTime = cand
      }
      const timeToNext = nextTime - nowMs
      const antic = Math.max(0, 1 - timeToNext / (TICK_MS * 2))
      cell.flash = Math.max(0, cell.flash - 0.045)

      const pulseR = antic * 6 + cell.flash * 8
      // halo externo grande
      ctx.beginPath()
      ctx.arc(cell.x, cell.y, cell.r + 32 + pulseR, 0, Math.PI * 2)
      ctx.fillStyle = cell.color + this.alphaHex(0.08 + antic * 0.2 + cell.flash * 0.3)
      ctx.fill()
      // anel
      ctx.beginPath()
      ctx.arc(cell.x, cell.y, cell.r + 18 + pulseR, 0, Math.PI * 2)
      ctx.strokeStyle = cell.color
      ctx.lineWidth = antic > 0.6 ? 3 : 1.5
      ctx.shadowBlur = antic > 0.5 ? 28 : 12
      ctx.shadowColor = cell.color
      ctx.stroke()
      ctx.shadowBlur = 0

      // núcleo
      ctx.beginPath()
      ctx.arc(cell.x, cell.y, cell.r, 0, Math.PI * 2)
      ctx.fillStyle = cell.color + this.alphaHex(0.25 + antic * 0.25 + cell.flash * 0.4)
      ctx.fill()
      ctx.strokeStyle = cell.color
      ctx.lineWidth = 3
      ctx.stroke()

      // feedback ✓ / ✗
      if (cell.flash > 0.3) {
        ctx.fillStyle = cell.lastAccurate ? '#00e676' : '#ff4444'
        ctx.font = `bold ${cell.r * 1.1}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.globalAlpha = cell.flash
        ctx.fillText(cell.lastAccurate ? '✓' : '✗', cell.x, cell.y)
        ctx.globalAlpha = 1
      }

      // nome do instrumento (abaixo)
      ctx.fillStyle = cell.color + 'cc'
      ctx.font = `bold ${Math.min(cell.r * 0.35, 11)}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillText(def.name, cell.x, cell.y + cell.r + 6)
    }
  }

  private drawPlayingHUD(_nowMs: number) {
    const { ctx, canvas } = this
    const cx = canvas.width / 2
    const elapsedMs = Date.now() - this.gameStartTime
    const remaining = Math.max(0, Math.ceil((GAME_DURATION_MS - elapsedMs) / 1000))
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${remaining}s`, cx, 16)
    if (this.streak > 0) {
      ctx.fillStyle = '#ff4444'
      ctx.font = `bold ${Math.min(canvas.width * 0.045, 18)}px system-ui`
      ctx.textAlign = 'left'
      ctx.fillText(`× ${this.streak}`, 16, 16)
    }
  }

  private alphaHex(a: number): string {
    const v = Math.max(0, Math.min(255, Math.floor(a * 255)))
    return v.toString(16).padStart(2, '0')
  }
}

export const pulsoGame = new PulsoGame()
