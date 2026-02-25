import type { PendingAd, AdStatus } from "../types";
import "./AdQueue.css";

interface Props {
  ads: PendingAd[];
}

const STATUS: Record<AdStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export default function AdQueue({ ads }: Props) {
  if (ads.length === 0) return null;

  return (
    <div className="aq">
      <p className="aq-heading">Submitted this session</p>

      {[...ads].reverse().map((ad) => (
        <div key={ad.id} className="aq-row">
          <div className="aq-left">
            <span className="aq-name">{ad.name}</span>
            <span className="aq-url">{truncate(ad.url, 42)}</span>
          </div>
          <span className={`aq-status aq-status--${ad.status}`}>
            {STATUS[ad.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
