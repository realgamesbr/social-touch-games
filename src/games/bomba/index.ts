import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen, alphaHex, segmentsIntersect, segmentIntersectionPoint } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'
import { drawBackground } from '../../core/background'

const META: GameMeta = {
  id: 'bomba',
  title: 'Bomba Instável',
  emoji: '💥',
  tagline: 'Cortem os elásticos na ordem certa. Cada dedo é uma tesoura.',
  minPlayers: 2,
  maxPlayers: 6,
  color: '#ff4444',
  duration: 0,
}

// Mecânica cut-the-rope: a bomba fica parada no centro presa por elásticos
// numerados. Cada dedo é uma TESOURA que precisa ARRASTAR (não tap) atravessando
// um elástico pra cortá-lo. Cortar na ordem libera a bomba; cortar fora da
// ordem três vezes consecutivas faz ela explodir.

const MAX_WRONG = 3
const MIN_SWIPE_DIST = 8            // pra evitar tap parado em cima do elástico
const VIBRATE_RESET_TIME = 1.8      // s sem erro pra resetar wrongCount
const PARTICLE_COUNT = 28
const RUN_TIMEOUT = 60              // s pra cortar tudo

type Phase = 'checkin' | 'playing' | 'escaping' | 'gameover'

interface Rope {
  order: number
  cut: boolean
  anchorAng: number    // ângulo do anchor na bomba
  anchorX: number      // ponto fixo na borda
  anchorY: number
  bombX: number        // origem na bomba (calculado pelo raio)
  bombY: number
  vibration: number    // 0..1, decai — pinta vermelho ao errar
  cutAnim: number      // 0..1, animação pós-corte
  color: string        // cor base do elástico (gradiente sutil)
}

interface Particle {
  x: number; y: number; vx: number; vy: number
  life: number; maxLife: number; size: number; color: string
}

const ROPE_PALETTE = ['#ffd740', '#4dd0e1', '#aa55ff', '#00e676', '#ffab40', '#ff44ff', '#80cbc4', '#ffe082']

export class BombaGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  players: CheckinPlayer[] = []
  private gameElapsed = 0
  private failReason = ''

  private bombX = 0
  private bombY = 0
  private bombR = 60
  private ropes: Rope[] = []
  private nextOrder = 0
  private wrongCount = 0
  private wrongCooldown = 0
  private hitFlash = 0
  private particles: Particle[] = []
  // Posição anterior de cada dedo, pra detectar swipe (dedo arrastando)
  private scissorPrev: Map<number, { x: number; y: number }> = new Map()
  // Vetor de fuga da bomba quando ela escapa
  private escapeVx = 0
  private escapeVy = 0

  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.touch = touch
    this.session = session
    this.phase = 'checkin'
    this.phaseElapsed = 0
    this.players = []
    this.gameElapsed = 0
    this.ropes = []
    this.nextOrder = 0
    this.wrongCount = 0
    this.wrongCooldown = 0
    this.hitFlash = 0
    this.particles = []
    this.scissorPrev.clear()
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
      case 'escaping': this.runEscaping(points, dt); break
      case 'gameover':
        drawEndScreen(ctx, canvas, false, '💥 EXPLODIU', this.failReason)
        break
    }
  }

  destroy() {
    window.removeEventListener('resize', this.resize)
  }

  private resize = () => {
    this.canvas.width = this.canvas.offsetWidth
    this.canvas.height = this.canvas.offsetHeight
    if (this.phase !== 'playing' && this.phase !== 'escaping') {
      this.bombX = this.canvas.width / 2
      this.bombY = this.canvas.height / 2
    }
  }

  private runCheckin(points: Map<number, TouchPoint>) {
    const r = updateCheckin(this, points, this.meta.minPlayers, this.meta.maxPlayers)
    if (r.done) { this.startPlaying(); return }
    for (const p of this.players) drawPlayerHalo(this.ctx, p.x, p.y, p.color, this.phaseElapsed, { pulsing: true })
    drawCheckinHUD(this.ctx, this.canvas, this, this.meta.minPlayers, this.meta.maxPlayers,
      r.remaining, r.canStart, this.meta.color,
      '2 a 6 jogadores · cortem na ordem certa',
      'arrastem o dedo sobre o elástico — não basta tocar')
  }

  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.gameElapsed = 0
    this.bombX = this.canvas.width / 2
    this.bombY = this.canvas.height / 2
    this.bombR = Math.min(this.canvas.width, this.canvas.height) * 0.09
    this.nextOrder = 0
    this.wrongCount = 0
    this.wrongCooldown = 0
    this.hitFlash = 0
    this.particles = []
    this.scissorPrev.clear()
    this.generateRopes()
  }

  // Quantidade de elásticos cresce com o nº de jogadores (mais gente = mais
  // pra cortar). Mínimo 4 pra valer a pena.
  private generateRopes() {
    const n = Math.max(4, this.players.length + 3)
    const margin = 40
    const w = this.canvas.width, h = this.canvas.height
    // Embaralha a ordem dos ângulos pra que números próximos não fiquem
    // necessariamente em ângulos próximos — exige movimento ao redor da mesa.
    const indices = Array.from({ length: n }, (_, i) => i)
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[indices[i], indices[j]] = [indices[j], indices[i]]
    }
    this.ropes = []
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.12 - 0.06
      // Anchor projetado na borda mais próxima ao longo da direção `ang`
      const dx = Math.cos(ang), dy = Math.sin(ang)
      // Distância até o retângulo das bordas (com margem)
      const tx = dx !== 0 ? (dx > 0 ? (w - margin) - this.bombX : margin - this.bombX) / dx : Infinity
      const ty = dy !== 0 ? (dy > 0 ? (h - margin) - this.bombY : margin - this.bombY) / dy : Infinity
      const t = Math.min(tx, ty)
      const ax = this.bombX + dx * t
      const ay = this.bombY + dy * t
      this.ropes.push({
        order: indices[i],
        cut: false,
        anchorAng: ang,
        anchorX: ax, anchorY: ay,
        bombX: this.bombX + dx * this.bombR,
        bombY: this.bombY + dy * this.bombR,
        vibration: 0,
        cutAnim: 0,
        color: ROPE_PALETTE[indices[i] % ROPE_PALETTE.length],
      })
    }
  }

  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.gameElapsed += dt
    this.hitFlash = Math.max(0, this.hitFlash - dt * 1.6)
    for (const r of this.ropes) {
      if (r.vibration > 0) r.vibration = Math.max(0, r.vibration - dt * 1.4)
      if (r.cut && r.cutAnim < 1) r.cutAnim = Math.min(1, r.cutAnim + dt * 1.5)
    }
    // Sem erro por VIBRATE_RESET_TIME → zera contador (acolhe quem acertou de novo)
    if (this.wrongCount > 0) {
      this.wrongCooldown += dt
      if (this.wrongCooldown >= VIBRATE_RESET_TIME) {
        this.wrongCount = 0
        this.wrongCooldown = 0
      }
    }

    // Tempo limite (preventivo — evita partida eterna)
    if (this.gameElapsed >= RUN_TIMEOUT) {
      this.failReason = 'O tempo se esgotou'
      this.phase = 'gameover'
      this.session.end()
      return
    }

    // Processa cada toque ativo como "tesoura": detecta intersecção do
    // segmento (posPrev → posAtual) com cada elástico ainda intacto.
    const seenIds = new Set<number>()
    for (const [id, pt] of points) {
      if (!pt.active) continue
      seenIds.add(id)
      const prev = this.scissorPrev.get(id)
      const cur = { x: pt.x, y: pt.y }
      if (prev) {
        const moved = Math.hypot(cur.x - prev.x, cur.y - prev.y)
        if (moved >= MIN_SWIPE_DIST) this.checkScissor(prev, cur)
      }
      this.scissorPrev.set(id, cur)
    }
    // Limpa dedos que sumiram
    for (const id of [...this.scissorPrev.keys()]) {
      if (!seenIds.has(id)) this.scissorPrev.delete(id)
    }

    // Partículas
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt
      p.vx *= 0.96; p.vy *= 0.96
      p.life -= dt
    }
    this.particles = this.particles.filter(p => p.life > 0)

    // Render
    this.drawRopes()
    this.drawBomb()
    this.drawScissors(points)
    this.drawParticles()
    this.drawHUD()

    // Todos os elásticos cortados? Vitória → fase escaping
    if (this.ropes.every(r => r.cut)) this.beginEscape()
  }

  // Procura o elástico intacto cuja linha foi cruzada pelo movimento do dedo.
  // Se acerta a ordem certa: corta. Se erra: vibração + contador de erros.
  private checkScissor(prev: { x: number; y: number }, cur: { x: number; y: number }) {
    for (const r of this.ropes) {
      if (r.cut) continue
      if (!segmentsIntersect(prev.x, prev.y, cur.x, cur.y, r.bombX, r.bombY, r.anchorX, r.anchorY)) continue
      const ip = segmentIntersectionPoint(prev.x, prev.y, cur.x, cur.y, r.bombX, r.bombY, r.anchorX, r.anchorY)
      if (r.order === this.nextOrder) {
        r.cut = true
        this.nextOrder++
        this.wrongCount = 0
        this.wrongCooldown = 0
        this.session.addScore(80 + this.ropes.length * 10)
        if (ip) this.spawnParticles(ip.x, ip.y, r.color)
      } else {
        r.vibration = 1
        this.hitFlash = 1
        this.wrongCount++
        this.wrongCooldown = 0
        if (this.wrongCount >= MAX_WRONG) {
          this.failReason = `Cortaram fora da ordem ${MAX_WRONG} vezes`
          this.phase = 'gameover'
          this.session.end()
        }
      }
      return  // só um corte por movimento — evita combo acidental
    }
  }

  private spawnParticles(x: number, y: number, color: string) {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = 60 + Math.random() * 220
      const life = 0.5 + Math.random() * 0.6
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life, maxLife: life,
        size: 2 + Math.random() * 3,
        color,
      })
    }
  }

  private beginEscape() {
    this.phase = 'escaping'
    this.phaseElapsed = 0
    // Direção: pra borda mais próxima
    const w = this.canvas.width, h = this.canvas.height
    const targets = [
      { x: -100, y: this.bombY }, { x: w + 100, y: this.bombY },
      { x: this.bombX, y: -100 }, { x: this.bombX, y: h + 100 },
    ]
    targets.sort((a, b) => Math.hypot(a.x - this.bombX, a.y - this.bombY) - Math.hypot(b.x - this.bombX, b.y - this.bombY))
    const t = targets[0]
    const d = Math.hypot(t.x - this.bombX, t.y - this.bombY) || 1
    const speed = 320
    this.escapeVx = ((t.x - this.bombX) / d) * speed
    this.escapeVy = ((t.y - this.bombY) / d) * speed
    // Score grande por completar
    this.session.addScore(400 * this.players.length)
  }

  private runEscaping(points: Map<number, TouchPoint>, dt: number) {
    this.phaseElapsed += dt
    this.bombX += this.escapeVx * dt
    this.bombY += this.escapeVy * dt
    // Partículas conforme escapa
    if (Math.random() < 0.4) this.spawnParticles(this.bombX, this.bombY, '#fff5b0')
    for (const p of this.particles) {
      p.x += p.vx * dt; p.y += p.vy * dt
      p.vx *= 0.96; p.vy *= 0.96
      p.life -= dt
    }
    this.particles = this.particles.filter(p => p.life > 0)

    this.drawRopes()
    this.drawBomb()
    this.drawScissors(points)
    this.drawParticles()
    this.drawEscapeHUD()

    // Saiu da tela: vitória
    const w = this.canvas.width, h = this.canvas.height
    if (this.bombX < -80 || this.bombX > w + 80 || this.bombY < -80 || this.bombY > h + 80) {
      this.session.end()
      this.phase = 'gameover'
      this.failReason = 'BOMBA NEUTRALIZADA · ' + this.gameElapsed.toFixed(1) + 's'
    }
  }

  // ─── Desenho ────────────────────────────────────────────────────
  private drawRopes() {
    const { ctx } = this
    for (const r of this.ropes) {
      if (r.cut && r.cutAnim >= 1) continue
      if (r.cut) {
        // Ainda animando o corte: dois cotos retraindo
        const t = r.cutAnim
        const midX = (r.bombX + r.anchorX) / 2
        const midY = (r.bombY + r.anchorY) / 2
        const retract = (1 - t) * 0.5
        // Coto da bomba
        const bx2 = r.bombX + (midX - r.bombX) * retract
        const by2 = r.bombY + (midY - r.bombY) * retract
        ctx.beginPath()
        ctx.moveTo(r.bombX, r.bombY); ctx.lineTo(bx2, by2)
        ctx.strokeStyle = r.color + alphaHex(0.6 * (1 - t))
        ctx.lineWidth = 4
        ctx.stroke()
        // Coto da âncora
        const ax2 = r.anchorX + (midX - r.anchorX) * retract
        const ay2 = r.anchorY + (midY - r.anchorY) * retract
        ctx.beginPath()
        ctx.moveTo(r.anchorX, r.anchorY); ctx.lineTo(ax2, ay2)
        ctx.strokeStyle = r.color + alphaHex(0.6 * (1 - t))
        ctx.stroke()
        // Anchor "morto"
        ctx.beginPath()
        ctx.arc(r.anchorX, r.anchorY, 6, 0, Math.PI * 2)
        ctx.fillStyle = '#444'
        ctx.fill()
        continue
      }
      // Vibração em vermelho ao errar
      const wrong = r.vibration
      const dxv = wrong ? (Math.random() - 0.5) * 6 * wrong : 0
      const dyv = wrong ? (Math.random() - 0.5) * 6 * wrong : 0
      ctx.beginPath()
      ctx.moveTo(r.bombX + dxv, r.bombY + dyv)
      // Curva leve (corda elástica) com um wave sutil baseado no tempo
      const dx = r.anchorX - r.bombX
      const dy = r.anchorY - r.bombY
      const nx = -dy
      const ny = dx
      const len = Math.hypot(dx, dy) || 1
      const wave = Math.sin(this.phaseElapsed * 3 + r.order) * 4
      const cpx = r.bombX + dx * 0.5 + (nx / len) * wave
      const cpy = r.bombY + dy * 0.5 + (ny / len) * wave
      ctx.quadraticCurveTo(cpx + dxv, cpy + dyv, r.anchorX, r.anchorY)
      ctx.strokeStyle = wrong ? '#ff4444' : r.color
      ctx.lineWidth = wrong ? 5 : 4
      ctx.shadowBlur = wrong ? 18 : 10
      ctx.shadowColor = wrong ? '#ff4444' : r.color
      ctx.stroke()
      ctx.shadowBlur = 0

      // Anchor na borda
      ctx.beginPath()
      ctx.arc(r.anchorX, r.anchorY, 10, 0, Math.PI * 2)
      ctx.fillStyle = r.color
      ctx.shadowBlur = 14
      ctx.shadowColor = r.color
      ctx.fill()
      ctx.shadowBlur = 0

      // Número da ordem desenhado no meio do elástico
      const labelX = (r.bombX + r.anchorX) / 2
      const labelY = (r.bombY + r.anchorY) / 2
      const isNext = r.order === this.nextOrder
      const labelR = isNext ? 22 + Math.sin(this.phaseElapsed * 5) * 3 : 18
      ctx.beginPath()
      ctx.arc(labelX, labelY, labelR, 0, Math.PI * 2)
      ctx.fillStyle = isNext ? r.color : '#1a1a2a'
      ctx.strokeStyle = isNext ? '#ffffff' : r.color
      ctx.lineWidth = 2
      ctx.shadowBlur = isNext ? 20 : 0
      ctx.shadowColor = r.color
      ctx.fill()
      ctx.stroke()
      ctx.shadowBlur = 0
      ctx.fillStyle = isNext ? '#1a1a2a' : '#fff'
      ctx.font = `bold ${Math.min(this.canvas.width * 0.04, 18)}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText((r.order + 1).toString(), labelX, labelY)
    }
  }

  private drawBomb() {
    const { ctx } = this
    const t = this.phaseElapsed
    const danger = this.hitFlash
    // halo externo
    ctx.beginPath()
    ctx.arc(this.bombX, this.bombY, this.bombR * 1.9, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255,${Math.floor(80 - danger * 70)},40,${0.08 + danger * 0.15})`
    ctx.fill()
    // núcleo
    const grad = ctx.createRadialGradient(this.bombX, this.bombY, this.bombR * 0.2, this.bombX, this.bombY, this.bombR)
    grad.addColorStop(0, `rgba(255,${Math.floor(220 - danger * 180)},${Math.floor(160 - danger * 160)},0.95)`)
    grad.addColorStop(0.55, `rgba(255,${Math.floor(110 - danger * 80)},30,0.7)`)
    grad.addColorStop(1, 'rgba(150,20,0,0.3)')
    ctx.beginPath()
    ctx.arc(this.bombX, this.bombY, this.bombR + Math.sin(t * 4) * 3, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.shadowBlur = 30 + danger * 40
    ctx.shadowColor = danger > 0.5 ? '#ffaa00' : '#ff4444'
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.strokeStyle = danger > 0.6 ? '#ffcc00' : '#ff6644'
    ctx.lineWidth = 3
    ctx.stroke()
    // Mecha no topo
    const mx = this.bombX
    const my = this.bombY - this.bombR - 8
    ctx.beginPath()
    ctx.moveTo(this.bombX, this.bombY - this.bombR + 2)
    ctx.quadraticCurveTo(this.bombX - 8, my - 6, mx, my - 14)
    ctx.strokeStyle = '#888'
    ctx.lineWidth = 3
    ctx.stroke()
    // Centelha
    ctx.beginPath()
    ctx.arc(mx, my - 14, 4 + Math.sin(t * 18) * 2, 0, Math.PI * 2)
    ctx.fillStyle = '#ffd740'
    ctx.shadowBlur = 18
    ctx.shadowColor = '#ffd740'
    ctx.fill()
    ctx.shadowBlur = 0
  }

  private drawScissors(points: Map<number, TouchPoint>) {
    const { ctx } = this
    for (const p of this.players) {
      const pt = points.get(p.pointerId)
      if (!pt?.active) continue
      // Cursor da tesoura — usa cor do player, tamanho menor que o halo padrão
      drawPlayerHalo(ctx, pt.x, pt.y, p.color, this.phaseElapsed, { pulsing: false, size: 0.6 })
      // Ícone tesoura discreto
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 14px system-ui'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('✂', pt.x, pt.y)
    }
  }

  private drawParticles() {
    const { ctx } = this
    for (const p of this.particles) {
      const a = p.life / p.maxLife
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2)
      ctx.fillStyle = p.color + alphaHex(a * 0.9)
      ctx.fill()
    }
  }

  private drawHUD() {
    const { ctx, canvas } = this
    const remaining = Math.max(0, RUN_TIMEOUT - this.gameElapsed)
    ctx.fillStyle = remaining < 15 ? '#ff4444' : '#888'
    ctx.font = `bold ${Math.min(canvas.width * 0.035, 14)}px system-ui`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(`${Math.ceil(remaining)}s`, 16, 16)

    // Próximo número a cortar
    const next = Math.min(this.nextOrder + 1, this.ropes.length)
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.045, 20)}px system-ui`
    ctx.textAlign = 'center'
    ctx.fillText(`Cortem na ordem · próximo: ${next}`, canvas.width / 2, 16)

    // Erros (3 pontos vermelhos)
    const cx = canvas.width / 2
    const y = canvas.height - 26
    for (let i = 0; i < MAX_WRONG; i++) {
      ctx.beginPath()
      ctx.arc(cx - 22 + i * 22, y, 8, 0, Math.PI * 2)
      ctx.fillStyle = i < this.wrongCount ? '#ff4444' : 'rgba(255,255,255,0.15)'
      ctx.fill()
    }
    ctx.fillStyle = '#888'
    ctx.font = `bold ${Math.min(canvas.width * 0.032, 13)}px system-ui`
    ctx.textBaseline = 'bottom'
    ctx.fillText('erros antes da explosão', cx, y - 14)
  }

  private drawEscapeHUD() {
    const { ctx, canvas } = this
    ctx.fillStyle = '#00e676'
    ctx.font = `bold ${Math.min(canvas.width * 0.06, 28)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.shadowBlur = 24
    ctx.shadowColor = '#00e676'
    ctx.fillText('✓ NEUTRALIZADA', canvas.width / 2, 24)
    ctx.shadowBlur = 0
  }
}

export const bombaGame = new BombaGame()
