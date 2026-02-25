import { useState } from "react";
import SubmitPanel from "../components/SubmitPanel";
import UserAds from "../components/UserAds";
import SignIn from "../components/SignIn";
import { useGoogleAuth } from "../hooks/useGoogleAuth";
import type { PendingAd } from "../types";
import "../App.css";
import "./Submit.css";

export default function Submit() {
  const { user, signOut, handleCredential } = useGoogleAuth();
  // Bump to force UserAds to refetch after a new submission
  const [refreshKey, setRefreshKey] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function handleSubmit(ad: PendingAd) {
    if (!user) return;
    setSubmitError(null);
    try {
      const res = await fetch("/api/submit-ads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Google-Token": user.idToken,
        },
        body: JSON.stringify([ad]),
      });
      if (res.status === 401) {
        signOut();
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setSubmitError(body.error ?? `Submission failed (${res.status}).`);
        return;
      }
      // Trigger UserAds refresh so the new item appears immediately
      setRefreshKey((k) => k + 1);
    } catch {
      setSubmitError("Could not reach the server. Check your connection.");
    }
  }

  if (!user) return <SignIn onCredential={handleCredential} />;

  return (
    <div className="page">
      <p className="wordmark">Startup Shell</p>
      <p className="page-title">Submit an Ad</p>

      {/* User account bar */}
      <div className="sub-user-bar">
        {user.picture && (
          <img
            className="sub-user-avatar"
            src={user.picture}
            alt={user.name}
            referrerPolicy="no-referrer"
          />
        )}
        <div className="sub-user-info">
          <span className="sub-user-name">{user.name}</span>
          <span className="sub-user-email">{user.email}</span>
        </div>
        <button className="sub-signout" onClick={signOut}>
          Sign out
        </button>
      </div>

      {submitError && <p className="sub-submit-error">⚠ {submitError}</p>}

      <div className="container">
        <SubmitPanel onSubmit={handleSubmit} />
        <UserAds
          user={user}
          refreshKey={refreshKey}
          onSessionExpired={signOut}
        />
      </div>
    </div>
  );
}
