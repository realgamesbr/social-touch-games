import { TouchManager } from './TouchManager'
import { SessionManager } from './SessionManager'

export interface GameMeta {
  id: string
  title: string
  emoji: string
  tagline: string
  minPlayers: number
  maxPlayers: number
  duration: number // 0 = endless/survival
  color: string   // accent color for card
  zen?: boolean   // experiência sem HUD/score/overlays; auto-start, dona da tela inteira
}

export interface GameModule {
  meta: GameMeta
  // Called once when the game canvas is ready
  init(canvas: HTMLCanvasElement, touch: TouchManager, session: SessionManager): void
  // Called on each animation frame while playing
  update(dt: number): void
  // Called when game ends or user navigates away
  destroy(): void
}
