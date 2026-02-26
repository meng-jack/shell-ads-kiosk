import type { CardData } from '../types'
import StatusCard from './StatusCard'
import './CardGrid.css'

const CARDS: CardData[] = [
  {
    title: 'System Status',
    badge: { text: 'Online', variant: 'green' },
    rows: [
      { label: 'Server',   value: 'localhost:6969' },
      { label: 'Display',  value: 'Mini PC · 1920×1080' },
      { label: 'Sleep',    value: 'Prevented' },
    ],
  },
  {
    title: 'Tunnel',
    badge: { text: 'Active', variant: 'green' },
    rows: [
      { label: 'Provider', value: 'cloudflared' },
      { label: 'Domain',   value: 'shellnews.exoad.net' },
      { label: 'Origin',   value: 'localhost:6969' },
    ],
  },
  {
    title: 'Bernard',
    badge: { text: 'Running', variant: 'green' },
    rows: [
      { label: 'Mode',       value: 'Fullscreen' },
      { label: 'News Source',  value: 'Remote API' },
      { label: 'Cache',      value: 'Local disk' },
    ],
  },
  {
    title: 'News Playlist',
    badge: { text: 'Looping', variant: 'yellow' },
    rows: [
      { label: 'Now Playing', value: '—' },
      { label: 'Refresh',     value: 'Auto' },
      { label: 'Format',      value: 'Image · Video · HTML' },
    ],
  },
]

export default function CardGrid() {
  return (
    <div className="card-grid">
      {CARDS.map((card) => (
        <StatusCard key={card.title} card={card} />
      ))}
    </div>
  )
}
