import type { PendingAd, AdStatus } from "../types";
import "./AdQueue.css";

interface Props {
  ads: PendingAd[];
}

const STATUS_LABEL: Record<AdStatus, string> = {
  submitted: "Pending",
  approved: "Approved",
  live: "Live",
  denied: "Denied",
  unknown: "Unknown",
};

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdQueue({ ads }: Props) {
  if (ads.length === 0) return null;

  return (
    <div className="aq">
      <p className="aq-heading">Submission history</p>

      {[...ads].map((ad) => (
        <div key={ad.id} className="aq-row">
          <div className="aq-left">
            <span className="aq-name">{ad.name}</span>
            <span className="aq-url">{truncate(ad.url, 42)}</span>
            <span className="aq-meta">
              {ad.submittedBy && (
                <span className="aq-by">by {ad.submittedBy}</span>
              )}
              <span className="aq-date">{fmtDate(ad.submittedAt)}</span>
            </span>
          </div>
          <span className={`aq-status aq-status--${ad.status}`}>
            {STATUS_LABEL[ad.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
