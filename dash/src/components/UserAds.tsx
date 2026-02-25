import { useCallback, useEffect, useState } from "react";
import type { GoogleUser, UserAd, SubmissionStage } from "../types";
import "./UserAds.css";

interface Props {
  user: GoogleUser;
  /** Bump this counter to force a refresh after a new submission */
  refreshKey: number;
  /** Called when the server returns 401 — token expired, user must re-authenticate */
  onSessionExpired: () => void;
}

const STAGE_LABEL: Record<SubmissionStage, string> = {
  submitted: "Pending review",
  approved: "Approved",
  active: "Live on kiosk",
  removed: "Removed",
};

const STAGE_CLASS: Record<SubmissionStage, string> = {
  submitted: "ua-badge--pending",
  approved: "ua-badge--approved",
  active: "ua-badge--active",
  removed: "ua-badge--removed",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UserAds({ user, refreshKey, onSessionExpired }: Props) {
  const [ads, setAds] = useState<UserAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [retractErr, setRetractErr] = useState<Record<string, string>>({});

  const fetch_ = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/my-ads", {
        headers: { "X-Google-Token": user.idToken },
      });
      if (res.status === 401) {
        onSessionExpired();
        return;
      }
      if (!res.ok) {
        setFetchError(`Could not load submissions (${res.status}).`);
        return;
      }
      setAds((await res.json()) as UserAd[]);
    } catch {
      setFetchError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }, [user.idToken, onSessionExpired]);

  useEffect(() => {
    fetch_();
  }, [fetch_, refreshKey]);

  async function retract(id: string) {
    setRetractErr((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/my-ads/${id}`, {
      method: "DELETE",
      headers: { "X-Google-Token": user.idToken },
    });
    if (res.status === 401) {
      onSessionExpired();
      return;
    }
    if (res.ok) {
      setAds((a) =>
        a.map((x) => (x.id === id ? { ...x, stage: "removed" } : x)),
      );
    } else {
      const body = (await res
        .json()
        .catch(() => ({ error: "Request failed." }))) as { error?: string };
      setRetractErr((e) => ({
        ...e,
        [id]: body.error ?? "Could not retract.",
      }));
    }
  }

  if (loading)
    return <div className="ua-loading">Loading your submissions…</div>;

  if (fetchError) {
    return (
      <div className="ua">
        <p className="ua-heading">Your submissions</p>
        <p className="ua-fetch-error">{fetchError}</p>
      </div>
    );
  }

  if (ads.length === 0) {
    return (
      <div className="ua">
        <p className="ua-heading">Your submissions</p>
        <p className="ua-empty">
          Nothing submitted yet — fill out the form above to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="ua">
      <p className="ua-heading">Your submissions</p>
      {ads.map((ad) => (
        <div key={ad.id} className={`ua-row ua-row--${ad.stage}`}>
          <div className="ua-left">
            <span className="ua-name">{ad.name}</span>
            <span className="ua-meta">
              <span className={`ua-type ua-type--${ad.type}`}>{ad.type}</span>
              <span className="ua-dur">
                {(ad.durationMs / 1000).toFixed(0)}s
              </span>
              <span className="ua-date">{fmtDate(ad.submittedAt)}</span>
            </span>
          </div>
          <div className="ua-right">
            <span className={`ua-badge ${STAGE_CLASS[ad.stage]}`}>
              {STAGE_LABEL[ad.stage]}
            </span>
            {ad.shownOnKiosk && (
              <span
                className="ua-shown"
                title="This ad has been displayed on the kiosk screen"
              >
                ⊙ shown
              </span>
            )}
            {(ad.stage === "submitted" || ad.stage === "approved") && (
              <button
                className="ua-retract"
                onClick={() => retract(ad.id)}
                title="Retract this submission"
              >
                Retract
              </button>
            )}
            {retractErr[ad.id] && (
              <span className="ua-retract-err">{retractErr[ad.id]}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
