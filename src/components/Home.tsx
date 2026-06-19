import type { GameMeta } from '../core/GameModule'

interface Props {
  games: GameMeta[]
  onSelect: (id: string) => void
}

export function Home({ games, onSelect }: Props) {
  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <h1 style={styles.title}>SOCIAL TOUCH</h1>
        <p style={styles.sub}>Compartilhe a tela. Mova o corpo. Joguem juntos.</p>
      </div>
      <div style={styles.grid}>
        {games.map(g => (
          <button key={g.id} style={{ ...styles.card, borderColor: g.color }} onClick={() => onSelect(g.id)}>
            <span style={styles.emoji}>{g.emoji}</span>
            <span style={{ ...styles.cardTitle, color: g.color }}>{g.title}</span>
            <span style={styles.tagline}>{g.tagline}</span>
            <span style={styles.players}>
              {g.minPlayers === g.maxPlayers ? `${g.minPlayers}` : `${g.minPlayers}–${g.maxPlayers}`} jogadores
              {g.duration > 0 ? ` · ${g.duration}s` : ' · survival'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '2rem 1rem',
    gap: '2rem',
    overflowY: 'auto',
  },
  header: {
    textAlign: 'center',
  },
  title: {
    fontSize: 'clamp(1.8rem, 6vw, 3rem)',
    fontWeight: 900,
    letterSpacing: '0.12em',
    color: '#00e5ff',
    textShadow: '0 0 30px rgba(0,229,255,0.4)',
  },
  sub: {
    marginTop: '0.5rem',
    fontSize: '0.9rem',
    color: '#888',
    letterSpacing: '0.04em',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '1rem',
    width: '100%',
    maxWidth: '900px',
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '0.4rem',
    background: '#1a1a1a',
    border: '2px solid',
    borderRadius: '16px',
    padding: '1.4rem 1.2rem',
    cursor: 'pointer',
    transition: 'transform 0.1s, background 0.1s',
    textAlign: 'left',
  },
  emoji: {
    fontSize: '2rem',
    lineHeight: 1,
  },
  cardTitle: {
    fontSize: '1.1rem',
    fontWeight: 800,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  tagline: {
    fontSize: '0.82rem',
    color: '#aaa',
    lineHeight: 1.4,
  },
  players: {
    marginTop: '0.4rem',
    fontSize: '0.72rem',
    color: '#555',
    letterSpacing: '0.03em',
  },
}
