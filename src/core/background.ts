import galaxyUrl from '../assets/galaxy-bg.jpg'

// Fundo galáxia/buraco negro compartilhado por TODOS os jogos.
// Substitui o antigo grid quadriculado. A imagem carrega uma vez e fica
// em cache; até carregar, usamos um preto profundo como fallback.
const img = new Image()
let loaded = false
img.decoding = 'async'
img.onload = () => { loaded = true }
img.src = galaxyUrl

// Véu escuro por cima da galáxia — "tira um pouco do brilho" para que os
// elementos de jogo (halos, linhas, partículas) mantenham alto contraste.
const DIM = 0.5

/**
 * Desenha o fundo galáxia em "cover" (preenche a tela mantendo proporção)
 * e escurecido. Opcionalmente sobrepõe um leve clima de cor temático.
 *
 * @param tint cor hex opcional para dar identidade ao desafio (bem sutil)
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  tint?: string,
) {
  const w = canvas.width
  const h = canvas.height

  // Base preta (fallback enquanto a imagem não carregou)
  ctx.fillStyle = '#04050a'
  ctx.fillRect(0, 0, w, h)

  if (loaded && img.width > 0) {
    // cover-fit: cobre toda a tela sem distorcer
    const ir = img.width / img.height
    const cr = w / h
    let dw: number, dh: number
    if (cr > ir) { dw = w; dh = w / ir }
    else { dh = h; dw = h * ir }
    const dx = (w - dw) / 2
    const dy = (h - dh) / 2
    ctx.drawImage(img, dx, dy, dw, dh)

    // Escurece para tirar o brilho
    ctx.fillStyle = `rgba(4,5,12,${DIM})`
    ctx.fillRect(0, 0, w, h)
  }

  if (tint) {
    ctx.save()
    ctx.globalAlpha = 0.1
    ctx.fillStyle = tint
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }
}
