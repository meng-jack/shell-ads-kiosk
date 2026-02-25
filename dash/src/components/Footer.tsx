import { useClock } from '../hooks/useClock'
import './Footer.css'

export default function Footer() {
  const now = useClock()
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

  return (
    <footer className="footer">
      <span>Startup Shell Dashboard</span>
      <span className="sep">·</span>
      <span>shellnews.exoad.net</span>
      <span className="sep">·</span>
      <span>UMD College Park</span>
      <span className="sep">·</span>
      <span>{time}</span>
    </footer>
  )
}
