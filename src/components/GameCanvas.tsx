import { useEffect, useRef, useState } from 'react'
import type { GameModule } from '../core/GameModule'
import { TouchManager } from '../core/TouchManager'
import { SessionManager } from '../core/SessionManager'

interface Props {
  game: GameModule
  onBack: () => void
}

export function GameCanvas({ game, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'idle' | 'playing' | 'gameover'>('idle')
  const [score, setScore] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const rafRef = useRef(0)
  const lastRef = useRef(0)
  const touchRef = useRef<TouchManager | null>(null)
  const sessionRef = useRef<SessionManager | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current!
    const touch = new TouchManager(canvas)
    const session = new SessionManager({
      duration: game.meta.duration,
      minPlayers: game.meta.minPlayers,
      maxPlayers: game.meta.maxPlayers,
    })

    touchRef.current = touch
    sessionRef.current = session

    session.subscribe((s, sc) => {
      setState(s)
      setScore(sc)
    })

    game.init(canvas, touch, session)

    const loop = (now: number) => {
      const dt = Math.min((now - lastRef.current) / 1000, 0.1)
      lastRef.current = now
      if (sessionRef.current?.state === 'playing') {
        setElapsed(Math.floor(sessionRef.current.elapsed))
        game.update(dt)
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    lastRef.current = performance.now()
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafRef.current)
      game.destroy()
      touch.destroy()
      session.destroy()
    }
  }, [game])

  const handleStart = () => sessionRef.current?.start()
  const handleRestart = () => {
    sessionRef.current?.reset()
    game.destroy()
    game.init(canvasRef.current!, touchRef.current!, sessionRef.current!)
  }

  const remaining = game.meta.duration > 0 ? Math.max(0, game.meta.duration - elapsed) : null

  return (
    <div style={styles.root}>
      <div style={styles.hud}>
        <button style={styles.back} onClick={onBack}>← voltar</button>
        <span style={{ ...styles.gameTitle, color: game.meta.color }}>{game.meta.emoji} {game.meta.title}</span>
        <span style={styles.score}>
          {remaining !== null ? `${remaining}s` : `${score} pts`}
        </span>
      </div>

      <canvas ref={canvasRef} style={styles.canvas} />

      {state === 'idle' && (
        <div style={styles.overlay}>
          <p style={styles.overlayText}>{game.meta.tagline}</p>
          <p style={styles.overlaySub}>
            {game.meta.minPlayers === game.meta.maxPlayers
              ? `${game.meta.minPlayers} jogadores`
              : `${game.meta.minPlayers}–${game.meta.maxPlayers} jogadores`}
          </p>
          <button style={{ ...styles.btn, background: game.meta.color }} onClick={handleStart}>
            COMEÇAR
          </button>
        </div>
      )}

      {state === 'gameover' && (
        <div style={styles.overlay}>
          <p style={styles.overlayTitle}>FIM DE JOGO</p>
          <p style={styles.overlayScore}>{score} <span style={styles.ptsLabel}>pts</span></p>
          <button style={{ ...styles.btn, background: game.meta.color }} onClick={handleRestart}>
            JOGAR DE NOVO
          </button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    position: 'relative',
  },
  hud: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.6rem 1rem',
    background: '#111',
    borderBottom: '1px solid #222',
    flexShrink: 0,
    zIndex: 10,
  },
  back: {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: '0.85rem',
    cursor: 'pointer',
    padding: '0.3rem 0.5rem',
  },
  gameTitle: {
    fontWeight: 800,
    fontSize: '0.9rem',
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  score: {
    fontWeight: 700,
    fontSize: '1rem',
    color: '#fff',
    minWidth: '3rem',
    textAlign: 'right',
  },
  canvas: {
    flex: 1,
    width: '100%',
    touchAction: 'none',
  },
  overlay: {
    position: 'absolute',
    inset: 0,
    top: '48px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '1rem',
    background: 'rgba(0,0,0,0.85)',
    zIndex: 5,
  },
  overlayText: {
    fontSize: '1.1rem',
    color: '#ccc',
    textAlign: 'center',
    maxWidth: '280px',
    lineHeight: 1.5,
  },
  overlaySub: {
    fontSize: '0.8rem',
    color: '#555',
  },
  overlayTitle: {
    fontSize: '2rem',
    fontWeight: 900,
    letterSpacing: '0.1em',
    color: '#fff',
  },
  overlayScore: {
    fontSize: '4rem',
    fontWeight: 900,
    color: '#fff',
  },
  ptsLabel: {
    fontSize: '1.2rem',
    color: '#888',
  },
  btn: {
    padding: '0.8rem 2.5rem',
    borderRadius: '100px',
    border: 'none',
    fontWeight: 900,
    fontSize: '1rem',
    letterSpacing: '0.1em',
    color: '#000',
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
}
