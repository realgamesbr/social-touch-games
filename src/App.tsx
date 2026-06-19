import { useState, useMemo } from 'react'
import { Home } from './components/Home'
import { GameCanvas } from './components/GameCanvas'
import type { GameModule } from './core/GameModule'
import { vazamentoGame } from './games/vazamento'
import { raiosGame } from './games/raios'
import { pulsoGame } from './games/pulso'
import { constelacaoGame } from './games/constelacao'
import { bombaGame } from './games/bomba'
import { dancaOrbitalGame } from './games/dancaorbital'
import { engrenagensGame } from './games/engrenagens'
import { fantasmaGame } from './games/fantasma'
import { correnteGame } from './games/corrente'
import { labirintoGame } from './games/labirinto'
import { followLineGame } from './games/followline'

const ALL_GAMES: GameModule[] = [
  raiosGame,
  vazamentoGame,
  pulsoGame,
  constelacaoGame,
  bombaGame,
  dancaOrbitalGame,
  engrenagensGame,
  fantasmaGame,
  correnteGame,
  labirintoGame,
  followLineGame,
]

export default function App() {
  const [activeId, setActiveId] = useState<string | null>(null)

  const active = useMemo(
    () => ALL_GAMES.find(g => g.meta.id === activeId) ?? null,
    [activeId]
  )

  if (active) {
    return <GameCanvas game={active} onBack={() => setActiveId(null)} />
  }

  return <Home games={ALL_GAMES.map(g => g.meta)} onSelect={setActiveId} />
}
