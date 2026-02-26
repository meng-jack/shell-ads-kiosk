import { useEffect, useRef, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import SubmitPanel from "../components/SubmitPanel";
import AdQueue from "../components/AdQueue";
import type { PendingAd, SubmissionRecord } from "../types";
import { submissionStatus } from "../api";
import { useAuth, type GoogleUser } from "../AuthContext";
import "../App.css";

const HISTORY_KEY = "shellnews_history";
const MAX_HISTORY = 20;

function loadHistory(): SubmissionRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHistory(h: SubmissionRecord[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY)));
}

function recordToPendingAd(r: SubmissionRecord): PendingAd {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    url: r.url,
    durationSec: r.durationSec,
    submittedBy: r.submittedBy,
    status: r.status,
    submittedAt: new Date(r.submittedAt),
  };
}

// ── JWT decode (no external lib needed — Google credential is a plain JWT) ───
function decodeGoogleJwt(credential: string): GoogleUser | null {
  try {
    const payload = JSON.parse(atob(credential.split(".")[1])) as {
      name?: string;
      email?: string;
      picture?: string;
    };
    if (!payload.name || !payload.email) return null;
    return {
      name: payload.name,
      email: payload.email,
      picture: payload.picture ?? "",
    };
  } catch {
    return null;
  }
}

// ── Login gate ────────────────────────────────────────────────────────────────
function LoginGate() {
  const { signIn } = useAuth();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="sub-login-wrap">
      <div className="sub-login-card">
        <p className="wordmark">Startup Shell</p>
        <p className="sub-login-title">Submit an Ad</p>
        <p className="sub-login-hint">Sign in with your Google account to continue.</p>
        <GoogleLogin
          onSuccess={(cred) => {
            const user = decodeGoogleJwt(cred.credential ?? "");
            if (user) {
              signIn(user);
            } else {
              setErr("Could not read profile from Google. Please try again.");
            }
          }}
          onError={() => setErr("Google sign-in failed. Please try again.")}
          theme="filled_black"
          shape="rectangular"
          size="large"
          text="signin_with"
          useOneTap
        />
        {err && <p className="sub-login-err">{err}</p>}
      </div>
    </div>
  );
}

// ── Profile bar ───────────────────────────────────────────────────────────────
function ProfileBar({ user }: { user: GoogleUser }) {
  const { signOut } = useAuth();
  return (
    <div className="sub-profile-bar">
      {user.picture && (
        <img
          className="sub-profile-avatar"
          src={user.picture}
          alt={user.name}
          referrerPolicy="no-referrer"
        />
      )}
      <div className="sub-profile-info">
        <span className="sub-profile-name">{user.name}</span>
        <span className="sub-profile-email">{user.email}</span>
      </div>
      <button className="sub-profile-signout" type="button" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function Submit() {
  const { user } = useAuth();
  const [history, setHistory] = useState<SubmissionRecord[]>(loadHistory);
  const pollRef = useRef<number>();

  // Poll submission statuses for known ad IDs every 5 seconds
  useEffect(() => {
    async function poll() {
      const current = loadHistory();
      if (current.length === 0) return;
      const ids = current.map((r) => r.id);
      try {
        const updates = await submissionStatus(ids);
        if (updates.length === 0) return;
        const statusMap = new Map(updates.map((u) => [u.id, u.status]));
        const updated = current.map((r) =>
          statusMap.has(r.id) ? { ...r, status: statusMap.get(r.id)! } : r,
        );
        saveHistory(updated);
        setHistory(updated);
      } catch {
        // Best-effort — ignore network errors
      }
    }

    poll();
    pollRef.current = window.setInterval(poll, 5000);
    return () => clearInterval(pollRef.current);
  }, []);

  if (!user) return <LoginGate />;

  async function handleSubmit(ad: PendingAd, submittedBy: string) {
    const record: SubmissionRecord = {
      id: ad.id,
      name: ad.name,
      type: ad.type,
      url: ad.url,
      durationSec: ad.durationSec,
      submittedBy,
      submittedAt: ad.submittedAt.toISOString(),
      status: "pending",
    };

    // Prepend to history, cap at MAX_HISTORY
    const updated = [record, ...history].slice(0, MAX_HISTORY);
    setHistory(updated);
    saveHistory(updated);

    try {
      await fetch("/api/submit-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ ...ad, submittedBy }]),
      });
    } catch {
      // Dev mode — launcher not running
    }
  }

  const pendingAds = history.map(recordToPendingAd);

  return (
    <div className="page">
      <ProfileBar user={user} />
      <p className="wordmark">Startup Shell</p>
      <p className="page-title">Submit an Ad</p>
      <div className="container">
        <SubmitPanel
          submitterName={user.name}
          submitterEmail={user.email}
          onSubmit={handleSubmit}
        />
        <AdQueue ads={pendingAds} />
      </div>
    </div>
  );
}
