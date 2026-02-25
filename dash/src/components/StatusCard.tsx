import type { CardData } from '../types'
import './StatusCard.css'

interface Props {
  card: CardData
}

export default function StatusCard({ card }: Props) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">{card.title}</span>
        <span className={`badge badge--${card.badge.variant}`}>
          ● {card.badge.text}
        </span>
      </div>

      <div className="card-rows">
        {card.rows.map((row) => (
          <div key={row.label} className="card-row">
            <span className="card-row-label">{row.label}</span>
            <span className="card-row-value">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
