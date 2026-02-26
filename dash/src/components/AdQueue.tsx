import { useState } from "react";
import type { PendingAd, AdStatus } from "../types";
import PreviewModal from "./PreviewModal";
import "./AdQueue.css";

interface Props {
  ads: PendingAd[];
  /** When true, renders as a standalone full submissions list (no heading, wider cards) */
  fullView?: boolean;
  /** Called when the user retracts (deletes) a submission. */
  onRetract?: (id: string) => void;
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
// (shared PreviewModal component handles rendering at 16:9 aspect ratio)

export default function AdQueue({ ads, fullView = false, onRetract }: Props) {
  const [previewAd, setPreviewAd] = useState<PendingAd | null>(null);

  function handleRetract(ad: PendingAd) {
    if (!window.confirm(`Remove "${ad.name}"?\n\nThis will permanently delete the submission and any uploaded media file, even if it is currently live.`)) return;
    onRetract?.(ad.id);
  }

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
          <PreviewModal
            item={{ name: previewAd.name, type: previewAd.type, src: previewAd.url }}
            onClose={() => setPreviewAd(null)}
          />
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
                  {onRetract && (
                    <button
                      className="aq-retract-btn"
                      type="button"
                      onClick={() => handleRetract(ad)}
                      title="Retract submission"
                    >
                      Retract
                    </button>
                  )}
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
    <>
      {previewAd && (
        <PreviewModal
          item={{ name: previewAd.name, type: previewAd.type, src: previewAd.url }}
          onClose={() => setPreviewAd(null)}
        />
      )}
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
          <div className="aq-row-right">
            <span className={`aq-status aq-status--${ad.status}`}>
              {STATUS_LABEL[ad.status]}
            </span>
            <div className="aq-row-actions">
              <button
                className="aq-preview-btn"
                type="button"
                onClick={() => setPreviewAd(ad)}
                title="Preview"
              >
                Preview
              </button>
              {onRetract && (
                <button
                  className="aq-retract-btn"
                  type="button"
                  onClick={() => handleRetract(ad)}
                  title="Retract"
                >
                  Retract
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>    </>  );
}
