import { useCallback, useEffect, useRef, useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import SubmitPanel from "../components/SubmitPanel";
import AdQueue from "../components/AdQueue";
import type { PendingAd } from "../types";
import { mySubmissions, type SubmissionItem } from "../api";
import { useAuth, type GoogleUser } from "../AuthContext";
import "../App.css";

function itemToAd(item: SubmissionItem): PendingAd {
  return {
    id: item.id,
    name: item.name,
    type: item.type as PendingAd["type"],
    url: item.url,
    durationSec: item.durationSec,
    submittedBy: item.submittedBy,
    submittedAt: item.submittedAt ? new Date(item.submittedAt) : new Date(),
    status: item.status as PendingAd["status"],
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
function ProfileBar({
  user,
  view,
  onToggleView,
}: {
  user: GoogleUser;
  view: "submit" | "history";
  onToggleView: () => void;
}) {
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
      <button
        className={`sub-profile-nav${view === "history" ? " sub-profile-nav--active" : ""}`}
        type="button"
        onClick={onToggleView}
      >
        {view === "history" ? "Submit an Ad" : "My Submissions"}
      </button>
      <button className="sub-profile-signout" type="button" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function Submit() {
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState<PendingAd[]>([]);
  const [view, setView] = useState<"submit" | "history">("submit");
  const pollRef = useRef<number>();

  const fetchSubmissions = useCallback(async (email: string) => {
    try {
      const items = await mySubmissions(email);
      setSubmissions(items.map(itemToAd));
    } catch {
      // Best-effort — ignore network errors
    }
  }, []);

  // Start polling once the user is known
  useEffect(() => {
    if (!user) return;
    fetchSubmissions(user.email);
    pollRef.current = window.setInterval(() => fetchSubmissions(user.email), 5000);
    return () => clearInterval(pollRef.current);
  }, [user, fetchSubmissions]);

  if (!user) return <LoginGate />;

  async function handleSubmit(ad: PendingAd, submittedBy: string) {
    try {
      await fetch("/api/submit-ads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ ...ad, submittedBy }]),
      });
    } catch {
      // Dev mode — launcher not running
    }
    // Refresh immediately after submit so the queue updates
    await fetchSubmissions(user!.email);
  }

  return (
    <div className="page">
      <ProfileBar
        user={user}
        view={view}
        onToggleView={() => setView(view === "submit" ? "history" : "submit")}
      />
      <p className="wordmark">Startup Shell</p>

      {view === "submit" ? (
        <>
          <p className="page-title">Submit an Ad</p>
          <div className="container">
            <SubmitPanel
              submitterName={user.name}
              submitterEmail={user.email}
              onSubmit={handleSubmit}
            />
            <AdQueue ads={submissions} />
          </div>
        </>
      ) : (
        <>
          <p className="page-title">My Submissions</p>
          <div className="container">
            <AdQueue ads={submissions} fullView />
          </div>
        </>
      )}
    </div>
  );
}
