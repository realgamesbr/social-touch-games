import { TouchManager } from '../../core/TouchManager'
import type { TouchPoint } from '../../core/TouchManager'
import { SessionManager } from '../../core/SessionManager'
import type { GameModule, GameMeta } from '../../core/GameModule'
import { updateCheckin, drawPlayerHalo, drawCheckinHUD, drawEndScreen, drawGrid } from '../../core/helpers'
import type { CheckinPlayer } from '../../core/helpers'

const META: GameMeta = {
  id: 'bomba',
  title: 'Bomba Instável',
  emoji: '💥',
  tagline: 'Contenham a bomba juntos. Se ela escapar, explode.',
  minPlayers: 2,
  maxPlayers: 6,
  duration: 0,
  color: '#ff4444',
}

type Phase = 'checkin' | 'playing' | 'gameover'

export class BombaGame implements GameModule {
  meta = META
  private canvas!: HTMLCanvasElement
  private ctx!: CanvasRenderingContext2D
  private touch!: TouchManager
  private session!: SessionManager

  private phase: Phase = 'checkin'
  private phaseElapsed = 0
  private players: CheckinPlayer[] = []
  private bombX = 0
  private bombY = 0
  private bombVx = 0
  private bombVy = 0
  private bombR = 90
  private gameElapsed = 0
  private scoreAccum = 0
  private heatAngle = 0  // ângulo da zona "quente"
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
    this.heatAngle = 0
    this.failReason = ''
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
    this.bombX = this.canvas.width / 2
    this.bombY = this.canvas.height / 2
  }

  private runCheckin(points: Map<number, TouchPoint>) {
    const r = updateCheckin(this, points, this.meta.minPlayers, this.meta.maxPlayers)
    if (r.done) { this.startPlaying(); return }
    for (const p of this.players) drawPlayerHalo(this.ctx, p.x, p.y, p.color, this.phaseElapsed, { pulsing: true })
    drawCheckinHUD(this.ctx, this.canvas, this, this.meta.minPlayers, this.meta.maxPlayers,
      r.remaining, r.canStart, this.meta.color,
      '2 a 6 jogadores · todos contém a bomba',
      'cada um precisa tocar a bomba')
  }

  private startPlaying() {
    this.phase = 'playing'
    this.phaseElapsed = 0
    this.gameElapsed = 0
    this.bombX = this.canvas.width / 2
    this.bombY = this.canvas.height / 2
    this.bombVx = 0
    this.bombVy = 0
    this.bombR = 90
  }

  private runPlaying(points: Map<number, TouchPoint>, dt: number) {
    this.gameElapsed += dt
    // Quantos dedos tocando a bomba?
    const touchingBomb: { id: number; x: number; y: number; angle: number }[] = []
    for (const [id, pt] of points) {
      if (!pt.active) continue
      const d = Math.hypot(pt.x - this.bombX, pt.y - this.bombY)
      if (d < this.bombR + 30) {
        const angle = Math.atan2(pt.y - this.bombY, pt.x - this.bombX)
        touchingBomb.push({ id, x: pt.x, y: pt.y, angle })
      }
    }

    // A zona "quente" gira lentamente — dedo nela precisa sair
    this.heatAngle += dt * 0.6
    const inHeat = touchingBomb.filter(t => {
      const diff = ((t.angle - this.heatAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
      return diff < Math.PI / 3 || diff > Math.PI * 2 - Math.PI / 3
    })

    // Cálculo de "contenção": precisa de N dedos ao redor (não todos no mesmo lado)
    const need = this.players.length
    const hasEnough = touchingBomb.length >= need

    // Força = soma de vetores de cada toque (puxando pra direção dele)
    let fx = 0
    let fy = 0
    if (touchingBomb.length === 0) {
      // Sem dedos: bomba acelera radialmente saindo
      const dir = Math.atan2(this.bombY - this.canvas.height / 2, this.bombX - this.canvas.width / 2)
      fx += Math.cos(dir) * 80
      fy += Math.sin(dir) * 80
    } else {
      // Sem contenção suficiente: bomba puxada na direção oposta da média dos toques
      if (!hasEnough) {
        const avgAngle = touchingBomb.reduce((s, t) => s + t.angle, 0) / touchingBomb.length
        fx += Math.cos(avgAngle + Math.PI) * 120
        fy += Math.sin(avgAngle + Math.PI) * 120
      } else {
        // Contida — vibrações leves
        fx += (Math.random() - 0.5) * 30
        fy += (Math.random() - 0.5) * 30
      }
      // Penalidade por dedo na zona quente
      if (inHeat.length > 0) {
        fx += (Math.random() - 0.5) * 200
        fy += (Math.random() - 0.5) * 200
      }
    }

    // Aceleração da bomba com o tempo
    const accelMult = 1 + this.gameElapsed * 0.015

    this.bombVx += fx * dt * accelMult
    this.bombVy += fy * dt * accelMult
    // amortecimento
    this.bombVx *= 0.94
    this.bombVy *= 0.94
    this.bombX += this.bombVx * dt
    this.bombY += this.bombVy * dt

    // Cresce com o tempo
    this.bombR = Math.min(150, 90 + this.gameElapsed * 0.5)

    // Verifica saída da tela
    const margin = 20
    if (this.bombX < margin || this.bombX > this.canvas.width - margin ||
        this.bombY < margin || this.bombY > this.canvas.height - margin) {
      this.failReason = `Sobreviveram ${this.gameElapsed.toFixed(1)}s`
      this.phase = 'gameover'
      this.session.end()
      return
    }

    // Pontuação por sobrevivência (com bônus se bem contida)
    const rate = hasEnough ? 25 : 10
    this.scoreAccum += rate * dt
    const whole = Math.floor(this.scoreAccum)
    if (whole > 0) { this.session.addScore(whole); this.scoreAccum -= whole }

    this.drawBomb(hasEnough, touchingBomb.length, inHeat.length > 0)
    this.drawTouches(touchingBomb, inHeat)
    this.drawHUD(touchingBomb.length, hasEnough)
  }

  private drawBomb(contained: boolean, _touchCount: number, anyInHeat: boolean) {
    const { ctx } = this
    const pulse = Math.sin(this.gameElapsed * 8) * 4
    const r = this.bombR + pulse

    // Gradient do núcleo
    const grad = ctx.createRadialGradient(this.bombX, this.bombY, 0, this.bombX, this.bombY, r)
    if (anyInHeat) {
      grad.addColorStop(0, 'rgba(255,200,0,0.9)')
      grad.addColorStop(0.5, 'rgba(255,100,0,0.6)')
      grad.addColorStop(1, 'rgba(255,0,0,0.2)')
    } else if (contained) {
      grad.addColorStop(0, 'rgba(255,80,80,0.9)')
      grad.addColorStop(0.5, 'rgba(180,40,40,0.6)')
      grad.addColorStop(1, 'rgba(120,20,20,0.2)')
    } else {
      grad.addColorStop(0, 'rgba(255,40,40,1)')
      grad.addColorStop(0.5, 'rgba(255,80,0,0.7)')
      grad.addColorStop(1, 'rgba(200,30,0,0.3)')
    }
    ctx.beginPath()
    ctx.arc(this.bombX, this.bombY, r, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()
    ctx.strokeStyle = contained ? '#ff6666' : '#ff0000'
    ctx.lineWidth = 4
    ctx.shadowBlur = 32
    ctx.shadowColor = '#ff4444'
    ctx.stroke()
    ctx.shadowBlur = 0

    // Zona quente (arco brilhante)
    ctx.beginPath()
    ctx.arc(this.bombX, this.bombY, r + 8, this.heatAngle - Math.PI / 3, this.heatAngle + Math.PI / 3)
    ctx.strokeStyle = '#ffcc00'
    ctx.lineWidth = 6
    ctx.shadowBlur = 24
    ctx.shadowColor = '#ffcc00'
    ctx.stroke()
    ctx.shadowBlur = 0
  }

  private drawTouches(touching: any[], inHeat: any[]) {
    const { ctx } = this
    const heatIds = new Set(inHeat.map(h => h.id))
    for (const t of touching) {
      const burning = heatIds.has(t.id)
      ctx.beginPath()
      ctx.arc(t.x, t.y, burning ? 30 : 22, 0, Math.PI * 2)
      ctx.strokeStyle = burning ? '#ffcc00' : '#fff'
      ctx.lineWidth = 3
      ctx.shadowBlur = burning ? 24 : 12
      ctx.shadowColor = burning ? '#ffcc00' : '#fff'
      ctx.stroke()
      ctx.shadowBlur = 0
      if (burning) {
        ctx.fillStyle = '#ffcc00'
        ctx.font = 'bold 18px system-ui'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('🔥', t.x, t.y)
      }
    }
  }

  private drawHUD(touching: number, contained: boolean) {
    const { ctx, canvas } = this
    ctx.fillStyle = contained ? '#00e676' : '#ff4444'
    ctx.font = `bold ${Math.min(canvas.width * 0.045, 20)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    ctx.fillText(`${touching}/${this.players.length} segurando`, canvas.width / 2, 16)
    ctx.fillStyle = '#888'
    ctx.font = `${Math.min(canvas.width * 0.035, 12)}px system-ui`
    ctx.fillText(`saiam da zona amarela quando aparecer`, canvas.width / 2, 42)
  }
}

export const bombaGame = new BombaGame()
