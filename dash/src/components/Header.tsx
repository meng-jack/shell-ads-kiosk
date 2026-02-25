import { useClock } from '../hooks/useClock'
import './Header.css'

export default function Header() {
  const now = useClock()

  const time = now.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const date = now.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <header className="header">
      <div className="header-brand">
        <h1 className="header-title">Startup Shell</h1>
        <p className="header-tagline">UMD's Home for Creators &amp; Entrepreneurs</p>
      </div>
      <div className="header-clock">
        <div className="clock-time">{time}</div>
        <div className="clock-date">{date}</div>
      </div>
    </header>
  )
}
