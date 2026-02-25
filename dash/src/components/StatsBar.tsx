import './StatsBar.css'

const STATS = [
  { num: '600+',  label: 'Members' },
  { num: '300+',  label: 'Ventures' },
  { num: '$2B+',  label: 'Venture Value' },
]

export default function StatsBar() {
  return (
    <div className="statsbar">
      {STATS.map(({ num, label }, i) => (
        <div key={label} className="statsbar-group">
          {i > 0 && <div className="statsbar-divider" />}
          <div className="statsbar-stat">
            <span className="statsbar-num">{num}</span>
            <span className="statsbar-label">{label}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
