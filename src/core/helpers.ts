import type { TouchPoint } from './TouchManager'

// Índices 0–5 usados pelos jogos com até 6 players; 6–7 só pela Sinergia (8 players).
// Estender é backward-safe: os demais jogos nunca passam de COLORS[5].
export const COLORS = ['#ff4444', '#00e676', '#ffab40', '#aa55ff', '#00e5ff', '#ff44ff', '#ffd740', '#448aff']
export const CHECKIN_DURATION = 5

export interface CheckinPlayer {
  pointerId: number
  color: string
  x: number
  y: number
}

/**
 * Reusable check-in update.
 * Returns { canStart, remaining, done } where done=true means the timer elapsed
 * with enough players and the caller should transition to the playing phase.
 */
export function updateCheckin(
  state: any,
  points: Map<number, TouchPoint>,
  minPlayers: number,
  maxPlayers: number
): { canStart: boolean; remaining: number; done: boolean } {
  const activeIds = new Set<number>()
  for (const [id, pt] of points) {
    if (!pt.active) continue
    activeIds.add(id)
    const existing = state.players.find((p: CheckinPlayer) => p.pointerId === id)
    if (existing) { existing.x = pt.x; existing.y = pt.y }
    else if (state.players.length < maxPlayers) {
      state.players.push({
        pointerId: id,
        color: COLORS[state.players.length],
        x: pt.x, y: pt.y,
      })
    }
  }
  state.players = state.players.filter((p: CheckinPlayer) => activeIds.has(p.pointerId))
  const canStart = state.players.length >= minPlayers
  if (!canStart) state.phaseElapsed = 0
  const remaining = Math.max(0, CHECKIN_DURATION - state.phaseElapsed)
  return { canStart, remaining, done: canStart && remaining <= 0 }
}

export function drawPlayerHalo(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, color: string, time: number,
  opts: { pulsing?: boolean; size?: number; alpha?: number } = {}
) {
  const pulse = opts.pulsing ? 6 + Math.sin(time * 6) * 6 : 0
  const size = opts.size ?? 1
  const a = opts.alpha ?? 1
  ctx.beginPath()
  ctx.arc(x, y, (58 + pulse) * size, 0, Math.PI * 2)
  ctx.fillStyle = color + alphaHex(0.08 * a)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, (42 + pulse) * size, 0, Math.PI * 2)
  ctx.fillStyle = color + alphaHex(0.16 * a)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, (38 + pulse) * size, 0, Math.PI * 2)
  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.shadowBlur = 28
  ctx.shadowColor = color
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(x, y, 22 * size, 0, Math.PI * 2)
  ctx.fillStyle = color + alphaHex(0.33 * a)
  ctx.fill()
  ctx.strokeStyle = color
  ctx.lineWidth = 4
  ctx.stroke()
  ctx.shadowBlur = 0
}

export function drawCheckinHUD(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  state: any,
  minPlayers: number, maxPlayers: number,
  remaining: number, canStart: boolean,
  accent: string,
  tagline: string,
  subTagline: string
) {
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  if (state.players.length === 0) {
    ctx.fillStyle = '#fff'
    ctx.font = `bold ${Math.min(canvas.width * 0.07, 32)}px system-ui`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('TOQUEM E SEGUREM', cx, cy - 20)
    ctx.fillStyle = '#888'
    ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.fillText(tagline, cx, cy + 20)
    return
  }
  ctx.fillStyle = '#fff'
  ctx.font = `bold ${Math.min(canvas.width * 0.05, 22)}px system-ui`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(`${state.players.length} / ${maxPlayers} jogadores`, cx, 20)
  if (canStart) {
    ctx.fillStyle = accent
    ctx.font = `bold ${Math.min(canvas.width * 0.18, 80)}px system-ui`
    ctx.textBaseline = 'middle'
    ctx.shadowBlur = 32
    ctx.shadowColor = accent
    ctx.fillText(Math.ceil(remaining).toString(), cx, cy)
    ctx.shadowBlur = 0
    ctx.fillStyle = '#888'
    ctx.font = `${Math.min(canvas.width * 0.04, 16)}px system-ui`
    ctx.textBaseline = 'top'
    ctx.fillText(subTagline, cx, cy + 60)
  } else {
    ctx.fillStyle = '#888'
    ctx.font = `${Math.min(canvas.width * 0.045, 18)}px system-ui`
    ctx.textBaseline = 'middle'
    ctx.fillText(`aguardando mais ${minPlayers - state.players.length} jogador(es)…`, cx, cy)
  }
}

export function drawEndScreen(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  won: boolean,
  mainText: string,
  subText: string
) {
  const cx = canvas.width / 2
  const cy = canvas.height / 2
  ctx.fillStyle = won ? 'rgba(0,230,118,0.12)' : 'rgba(255,68,68,0.12)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = won ? '#00e676' : '#ff4444'
  ctx.font = `bold ${Math.min(canvas.width * 0.12, 56)}px system-ui`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowBlur = 36
  ctx.shadowColor = won ? '#00e676' : '#ff4444'
  ctx.fillText(mainText, cx, cy - 30)
  ctx.shadowBlur = 0
  ctx.fillStyle = '#ccc'
  ctx.font = `${Math.min(canvas.width * 0.045, 18)}px system-ui`
  ctx.fillText(subText, cx, cy + 20)
}

export function alphaHex(a: number): string {
  const v = Math.max(0, Math.min(255, Math.floor(a * 255)))
  return v.toString(16).padStart(2, '0')
}

export function drawGrid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, alpha = 0.03) {
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`
  ctx.lineWidth = 1
  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke()
  }
  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke()
  }
}

// Geometria paramétrica de segmentos (mesma matemática do untangle de Raios).
// Genérica para reuso — Raios mantém suas versões privadas; Sinergia usa estas.
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): boolean {
  const d1x = bx - ax, d1y = by - ay
  const d2x = dx - cx, d2y = dy - cy
  const cross = d1x * d2y - d1y * d2x
  if (Math.abs(cross) < 1e-10) return false
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98
}

export function segmentIntersectionPoint(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number
): { x: number; y: number } | null {
  const d1x = bx - ax, d1y = by - ay
  const d2x = dx - cx, d2y = dy - cy
  const cross = d1x * d2y - d1y * d2x
  if (Math.abs(cross) < 1e-10) return null
  const t = ((cx - ax) * d2y - (cy - ay) * d2x) / cross
  const u = ((cx - ax) * d1y - (cy - ay) * d1x) / cross
  if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) {
    return { x: ax + t * d1x, y: ay + t * d1y }
  }
  return null
}
