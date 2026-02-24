import type { Ad } from '../types';

interface Props {
  ad: Ad;
  index: number;
  total: number;
  msLeft: number;
  status: string;
  lastRefresh: Date | null;
  isExiting: boolean;
  isCached: boolean;
  activeSrc?: string;
}

const TYPE_COLORS: Record<string, string> = {
  image: '#4ade80',
  video: '#60a5fa',
  html: '#f97316',
};

function truncate(str: string | undefined, n: number): string {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

export default function DevOverlay({
  ad,
  index,
  total,
  msLeft,
  status,
  lastRefresh,
  isExiting,
  isCached,
  activeSrc,
}: Props) {
  const dur = ad.durationMs ?? 25000;
  const pct = Math.max(0, Math.min(100, (msLeft / dur) * 100));
  const secLeft = (msLeft / 1000).toFixed(1);
  const typeColor = TYPE_COLORS[ad.type] ?? '#94a3b8';

  return (
    <div className="dev-overlay">
      <div className="dev-header">
        <span className="dev-badge">DEV MODE</span>
        <span className="dev-slide-count">
          {index + 1} / {total}
        </span>
      </div>

      <div className="dev-countdown">
        <span className="dev-countdown-num">{secLeft}s</span>
        {isExiting && <span className="dev-exiting-badge">EXITING</span>}
      </div>
      <div className="dev-progress-bar">
        <div className="dev-progress-fill" style={{ width: `${pct}%` }} />
      </div>

      <div className="dev-divider" />

      <DevRow label="ID" value={ad.id} mono />
      <div className="dev-row">
        <span className="dev-label">TYPE</span>
        <span
          className="dev-type-badge"
          style={{ background: typeColor }}
        >
          {ad.type.toUpperCase()}
        </span>
      </div>
      <DevRow
        label="TRANSITION"
        value={`↓ ${ad.transition?.enter ?? 'fade'}  →  ${ad.transition?.exit ?? 'fade'}`}
        mono
      />
      <DevRow label="DURATION" value={`${(dur / 1000).toFixed(1)}s`} />

      {(ad.type === 'image' || ad.type === 'video') && (
        <>
          <DevRow
            label="SRC"
            value={truncate(activeSrc ?? ad.src, 48)}
            mono
          />
          <DevRow
            label="CACHE"
            value={isCached ? '✓ local disk' : '⬇ remote (downloading…)'}
          />
        </>
      )}

      {ad.layout && (
        <>
          <div className="dev-divider" />
          <DevRow label="FIT" value={ad.layout.fit ?? 'contain'} mono />
          {!!ad.layout.paddingPx && (
            <DevRow label="PADDING" value={`${ad.layout.paddingPx}px`} />
          )}
          {ad.layout.background && (
            <div className="dev-row">
              <span className="dev-label">BG</span>
              <span
                className="dev-color-swatch"
                style={{ background: ad.layout.background }}
              />
              <span className="dev-value dev-mono">{ad.layout.background}</span>
            </div>
          )}
          {ad.layout.width && (
            <DevRow label="WIDTH" value={ad.layout.width} mono />
          )}
          {ad.layout.height && (
            <DevRow label="HEIGHT" value={ad.layout.height} mono />
          )}
        </>
      )}

      <div className="dev-divider" />
      <DevRow label="STATUS" value={truncate(status, 44)} />
      {lastRefresh && (
        <DevRow label="REFRESHED" value={lastRefresh.toLocaleTimeString()} />
      )}
    </div>
  );
}

function DevRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="dev-row">
      <span className="dev-label">{label}</span>
      <span className={`dev-value${mono ? ' dev-mono' : ''}`}>{value}</span>
    </div>
  );
}
