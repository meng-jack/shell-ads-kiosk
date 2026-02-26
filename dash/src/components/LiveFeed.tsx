import { useEffect, useRef, useState } from "react";
import { liveFeed, type KioskAd } from "../api";
import PreviewModal from "./PreviewModal";
import "./LiveFeed.css";

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function fmtDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  return `${sec}s`;
}

export default function LiveFeed() {
  const [ads, setAds] = useState<KioskAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewAd, setPreviewAd] = useState<KioskAd | null>(null);
  const pollRef = useRef<number>();

  async function fetch_() {
    try {
      const data = await liveFeed();
      setAds(data);
    } catch {
      // Best-effort
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch_();
    pollRef.current = window.setInterval(fetch_, 8000);
    return () => clearInterval(pollRef.current);
  }, []);

  return (
    <>
      {previewAd && (
        <PreviewModal
          item={{
            name: previewAd.name,
            type: previewAd.type,
            src: previewAd.src ?? "",
          }}
          onClose={() => setPreviewAd(null)}
        />
      )}

      <div className="lf">
        {loading ? (
          <p className="lf-empty">Loading…</p>
        ) : ads.length === 0 ? (
          <p className="lf-empty">No news is currently live on Bernard.</p>
        ) : (
          <>
            <p className="lf-count">{ads.length} item{ads.length !== 1 ? "s" : ""} currently live</p>
            <div className="lf-list">
              {ads.map((ad, i) => (
                <div key={ad.id} className="lf-row">
                  <span className="lf-num">{i + 1}</span>
                  <div className="lf-info">
                    <span className="lf-name">{ad.name}</span>
                    <span className="lf-meta">
                      <span className={`lf-type lf-type--${ad.type}`}>{ad.type}</span>
                      <span className="lf-dur">{fmtDuration(ad.durationMs)}</span>
                      {ad.submittedAt && (
                        <span className="lf-date">{fmtDate(ad.submittedAt)}</span>
                      )}
                    </span>
                  </div>
                  <button
                    className="lf-preview-btn"
                    type="button"
                    onClick={() => setPreviewAd(ad)}
                    disabled={!ad.src}
                    title={ad.src ? "Preview" : "No preview available"}
                  >
                    Preview
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
