import { useState } from "react";
import type { PendingAd, AdStatus } from "../types";
import "./AdQueue.css";

interface Props {
  ads: PendingAd[];
  /** When true, renders as a standalone full submissions list (no heading, wider cards) */
  fullView?: boolean;
}

const STATUS_LABEL: Record<AdStatus, string> = {
  submitted: "Pending review",
  approved: "Approved",
  live: "Live on Bernard",
  denied: "Denied",
  unknown: "Unknown",
};

const STATUS_DESC: Record<AdStatus, string> = {
  submitted: "Waiting for an admin to review your submission.",
  approved: "Approved and ready to go live when the playlist is next updated.",
  live: "Currently playing on Bernard.",
  denied: "This submission was not approved.",
  unknown: "Status could not be determined.",
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

// ── Preview modal ──────────────────────────────────────────────────────────────
function PreviewModal({ ad, onClose }: { ad: PendingAd; onClose: () => void }) {
  function handleBackdrop(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="aq-modal-backdrop" onClick={handleBackdrop}>
      <div className="aq-modal">
        <div className="aq-modal-header">
          <div className="aq-modal-title">
            <span className="aq-modal-name">{ad.name}</span>
            <span className={`aq-type aq-type--${ad.type}`}>{ad.type}</span>
          </div>
          <button className="aq-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="aq-modal-body">
          {ad.type === "image" && (
            <img className="aq-preview-img" src={ad.url} alt={ad.name} />
          )}
          {ad.type === "video" && (
            <video
              className="aq-preview-video"
              src={ad.url}
              controls
              autoPlay
              loop
              playsInline
            />
          )}
          {ad.type === "html" && (
            <iframe
              className="aq-preview-iframe"
              src={ad.url}
              title={ad.name}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdQueue({ ads, fullView = false }: Props) {
  const [previewAd, setPreviewAd] = useState<PendingAd | null>(null);

  if (ads.length === 0) {
    if (fullView) {
      return (
        <div className="aq aq--full">
          <p className="aq-empty">You haven't submitted any news yet.</p>
        </div>
      );
    }
    return null;
  }

  if (fullView) {
    return (
      <>
        {previewAd && (
          <PreviewModal ad={previewAd} onClose={() => setPreviewAd(null)} />
        )}
        <div className="aq aq--full">
          {ads.map((ad) => (
            <div key={ad.id} className={`aq-card aq-card--${ad.status}`}>
              <div className="aq-card-top">
                <div className="aq-card-info">
                  <span className="aq-name">{ad.name}</span>
                  <span className={`aq-type aq-type--${ad.type}`}>{ad.type}</span>
                </div>
                <div className="aq-card-actions">
                  <button
                    className="aq-preview-btn"
                    type="button"
                    onClick={() => setPreviewAd(ad)}
                    title="Preview"
                  >
                    Preview
                  </button>
                  <span className={`aq-status aq-status--${ad.status}`}>
                    {STATUS_LABEL[ad.status]}
                  </span>
                </div>
              </div>
              <p className="aq-card-desc">{STATUS_DESC[ad.status]}</p>
              <div className="aq-card-meta">
                {ad.url && (
                  <span className="aq-url" title={ad.url}>
                    {truncate(ad.url, 55)}
                  </span>
                )}
                <span className="aq-date">{fmtDate(ad.submittedAt)}</span>
                <span className="aq-dur">{ad.durationSec}s</span>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }

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
