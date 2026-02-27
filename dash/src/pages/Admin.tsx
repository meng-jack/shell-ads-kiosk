import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminApi,
  clearToken,
  getToken,
  setToken,
  NotFoundError,
  type AdminStats,
  type KioskAd,
  type UpdateStatus,
  type UpdateStage,
} from "../api";
import PreviewModal from "../components/PreviewModal";
import "./Admin.css";

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function fmtUptime(sec: number): string {
  if (sec < 60) return `${Math.floor(sec)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${Math.floor(sec % 60)}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

// ─── Login ────────────────────────────────────────────────────────────────────

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const { token } = await adminApi.login(pw);
      setToken(token);
      onSuccess();
    } catch {
      setErr("Wrong password.");
      setPw("");
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="adm-login-wrap">
      <form className="adm-login" onSubmit={handleSubmit}>
        <p className="adm-wordmark">Startup Shell</p>
        <p className="adm-login-label">Admin access</p>
        <input
          ref={inputRef}
          className="adm-input"
          type="password"
          placeholder="Password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="current-password"
        />
        {err && <p className="adm-err">{err}</p>}
        <button
          className="adm-btn adm-btn--primary"
          type="submit"
          disabled={loading}
        >
          {loading ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

// ─── Ad row (generic) ─────────────────────────────────────────────────────────

interface AdRowProps {
  ad: KioskAd;
  index?: number;
  total?: number;
  stage: "active" | "approved" | "submitted";
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
  onApprove?: () => void;    // submitted → approved (stays unused, moves to top)
  onActivate?: () => void;   // approved → live
  onDeactivate?: () => void; // active → back to unused/approved
  onPreview?: () => void;
  onSetDuration?: (newDurationMs: number) => void;
}

function AdRow({
  ad,
  index,
  total,
  stage,
  onMoveUp,
  onMoveDown,
  onDelete,
  onApprove,
  onActivate,
  onDeactivate,
  onPreview,
  onSetDuration,
}: AdRowProps) {
  const durSec = Math.round(ad.durationMs / 1000);
  return (
    <div className={`adm-row adm-row--${stage}`}>
      {stage === "active" ? (
        <span className="adm-row-num">{(index ?? 0) + 1}</span>
      ) : stage === "approved" ? (
        <span className="adm-row-num adm-row-num--approved">✓</span>
      ) : (
        <span className="adm-row-num adm-row-num--submitted">•</span>
      )}
      <div className="adm-row-info">
        <span className="adm-row-name">{ad.name}</span>        {ad.submittedBy && (
          <span className="adm-row-submitted-by">by {ad.submittedBy}</span>
        )}        <span className="adm-row-meta">
          <span className={`adm-type adm-type--${ad.type}`}>{ad.type}</span>
          <span className="adm-row-dur">
            {(ad.durationMs / 1000).toFixed(0)}s
          </span>
          {stage === "approved" && (
            <span className="adm-badge adm-badge--approved">approved</span>
          )}
          {stage === "submitted" && (
            <span className="adm-badge adm-badge--pending">pending</span>
          )}
          {ad.src && (
            <span className="adm-row-url" title={ad.src}>
              {truncate(ad.src, 38)}
            </span>
          )}
        </span>
      </div>
      <div className="adm-row-actions">
        {stage === "active" && (
          <>
            <button
              className="adm-icon-btn"
              onClick={onMoveUp}
              disabled={(index ?? 0) === 0}
              title="Up"
            >
              ↑
            </button>
            <button
              className="adm-icon-btn"
              onClick={onMoveDown}
              disabled={(index ?? 0) === (total ?? 1) - 1}
              title="Down"
            >
              ↓
            </button>
            {onDeactivate && (
              <button
                className="adm-icon-btn adm-icon-btn--deactivate"
                onClick={onDeactivate}
                title="Move back to Unused"
              >
                ←
              </button>
            )}
          </>
        )}
        {stage === "submitted" && onApprove && (
          <button
            className="adm-icon-btn adm-icon-btn--approve"
            onClick={onApprove}
            title="Approve"
          >
            ✓
          </button>
        )}
        {stage === "approved" && onActivate && (
          <button
            className="adm-icon-btn adm-icon-btn--activate"
            onClick={onActivate}
            title="Push live"
          >
            ▶
          </button>
        )}
        {onSetDuration && (
          <span className="adm-dur-ctrl">
            <button
              className="adm-icon-btn adm-icon-btn--dur"
              type="button"
              disabled={durSec <= 1}
              onClick={() => onSetDuration(Math.max(1000, ad.durationMs - 1000))}
              title="Decrease duration by 1 second"
            >
              −
            </button>
            <span className="adm-dur-val">{durSec}s</span>
            <button
              className="adm-icon-btn adm-icon-btn--dur"
              type="button"
              disabled={durSec >= 30}
              onClick={() => onSetDuration(Math.min(30000, ad.durationMs + 1000))}
              title="Increase duration by 1 second"
            >
              +
            </button>
          </span>
        )}
        {onPreview && (
          <button
            className="adm-icon-btn adm-icon-btn--preview"
            onClick={onPreview}
            title="Preview"
          >
            ⊙
          </button>
        )}
        <button
          className="adm-icon-btn adm-icon-btn--del"
          onClick={onDelete}
          title="Delete"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function StatsBar({
  stats,
  onRestart,
  onNext,
  onPrev,
}: {
  stats: AdminStats | null;
  onRestart: () => void;
  onNext: () => void;
  onPrev: () => void;
}) {
  // Tick uptime locally every second so it counts up without waiting for
  // the 5-second poll cycle to refresh the whole stats object.
  const [extraSec, setExtraSec] = useState(0);
  const baseTimeRef = useRef<{ uptimeSec: number; at: number } | null>(null);

  // Do the same for launcher uptime.
  const [launcherExtraSec, setLauncherExtraSec] = useState(0);
  const launcherBaseRef = useRef<{ uptimeSec: number; at: number } | null>(null);

  // Next-restart countdown (ticks down every second).
  const [restartExtraSec, setRestartExtraSec] = useState(0);
  const restartBaseRef = useRef<{ secUntil: number; at: number } | null>(null);

  useEffect(() => {
    if (!stats?.kiosk.running) {
      setExtraSec(0);
      baseTimeRef.current = null;
      return;
    }
    baseTimeRef.current = { uptimeSec: stats.kiosk.uptimeSec, at: Date.now() };
    setExtraSec(0);
    const id = window.setInterval(() => {
      if (baseTimeRef.current) {
        setExtraSec(Math.floor((Date.now() - baseTimeRef.current.at) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [stats]);

  useEffect(() => {
    if (!stats) return;
    launcherBaseRef.current = { uptimeSec: stats.launcherUptimeSec ?? 0, at: Date.now() };
    setLauncherExtraSec(0);
    const id = window.setInterval(() => {
      if (launcherBaseRef.current) {
        setLauncherExtraSec(Math.floor((Date.now() - launcherBaseRef.current.at) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [stats]);

  useEffect(() => {
    if (!stats || !stats.nextAutoRestartSec) return;
    restartBaseRef.current = { secUntil: stats.nextAutoRestartSec, at: Date.now() };
    setRestartExtraSec(0);
    const id = window.setInterval(() => {
      if (restartBaseRef.current) {
        setRestartExtraSec(Math.floor((Date.now() - restartBaseRef.current.at) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [stats]);

  if (!stats)
    return (
      <div className="adm-stats-bar adm-stats-bar--loading">Loading stats…</div>
    );

  const k = stats.kiosk;
  const liveUptime =
    k.running && baseTimeRef.current ? k.uptimeSec + extraSec : k.uptimeSec;

  const launcherUptime = (stats.launcherUptimeSec ?? 0) + launcherExtraSec;

  const rawRestartSec = stats.nextAutoRestartSec ?? 0;
  const remainingRestartSec = Math.max(0, rawRestartSec - restartExtraSec);
  const restartIsImminent = remainingRestartSec > 0 && remainingRestartSec <= 300;

  return (
    <div className="adm-stats-bar">
      <div className="adm-stat">
        <span className="adm-stat-label">Bernard</span>
        <span
          className={`adm-stat-val adm-stat-val--${k.running ? "green" : "red"}`}
        >
          {k.running ? "Running" : "Stopped"}
        </span>
      </div>
      {k.running && (
        <>
          <div className="adm-stat">
            <span className="adm-stat-label">Uptime</span>
            <span className="adm-stat-val">{fmtUptime(liveUptime)}</span>
          </div>
          <div className="adm-stat">
            <span className="adm-stat-label">PID</span>
            <span className="adm-stat-val">{k.pid}</span>
          </div>
        </>
      )}
      <div className="adm-stat">
        <span className="adm-stat-label">Restarts</span>
        <span className="adm-stat-val">{k.restarts}</span>
      </div>
      <div className="adm-stat">
        <span className="adm-stat-label">Launcher uptime</span>
        <span className="adm-stat-val">{fmtUptime(launcherUptime)}</span>
      </div>
      {remainingRestartSec > 0 && (
        <div className="adm-stat">
          <span className="adm-stat-label">Next restart</span>
          <span className={`adm-stat-val${restartIsImminent ? " adm-stat-val--yellow" : ""}`}>
            {fmtUptime(remainingRestartSec)}
          </span>
        </div>
      )}
      <div className="adm-stat">
        <span className="adm-stat-label">Build</span>
        <span className="adm-stat-val">{stats.build}</span>
      </div>
      {stats.updating && (
        <div className="adm-stat">
          <span className="adm-stat-label">Update</span>
          <span className="adm-stat-val adm-stat-val--yellow">In progress</span>
        </div>
      )}
      {restartIsImminent && (
        <div className="adm-stat adm-stat--warn-banner">
          <span className="adm-stat-val adm-stat-val--yellow">
            ⚠ Bernard will restart in ~{fmtUptime(remainingRestartSec)} — any active uploads will finish first.
          </span>
        </div>
      )}
      <div className="adm-stat adm-stat--push adm-stat--controls">
        <div className="adm-nav-btns">
          <button
            className="adm-icon-btn"
            onClick={onPrev}
            title="Previous slide (←)"
          >
            ←
          </button>
          <button
            className="adm-icon-btn"
            onClick={onNext}
            title="Next slide (→)"
          >
            →
          </button>
        </div>
        <button
          className="adm-btn adm-btn--ghost adm-btn--sm adm-btn--danger"
          onClick={onRestart}
        >
          Restart Bernard
        </button>
      </div>
    </div>
  );
}

// ─── Update panel ─────────────────────────────────────────────────────────────

const UPDATE_STAGE_LABEL: Record<UpdateStage, string> = {
  idle: "Idle",
  checking: "Checking…",
  up_to_date: "Up to date",
  downloading: "Downloading…",
  applying: "Installing…",
  restarting: "Restarting…",
  error: "Error",
};

const UPDATE_STAGE_COLOR: Partial<Record<UpdateStage, string>> = {
  up_to_date: "adm-stat-val--green",
  error: "adm-stat-val--red",
  restarting: "adm-stat-val--yellow",
};

const ACTIVE_STAGES: UpdateStage[] = [
  "checking",
  "downloading",
  "applying",
  "restarting",
];

function UpdatePanel() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number>();
  const reloadRef = useRef<number>();

  // Poll update status while an update is active
  const poll = useCallback(async () => {
    try {
      const s = await adminApi.updateStatus();
      setStatus(s);
      if (!ACTIVE_STAGES.includes(s.stage)) {
        setPolling(false);
        setBusy(false);
        clearInterval(pollRef.current);
        if (s.stage === "restarting") {
          reloadRef.current = window.setTimeout(() => attemptReload(0), 3000);
        }
      }
    } catch {
      // Launcher may have briefly gone away during restart — keep polling
    }
  }, []);

  // On mount: fetch status once. If another admin already triggered an update,
  // automatically start polling so this panel reflects the live progress.
  useEffect(() => {
    adminApi
      .updateStatus()
      .then((s) => {
        setStatus(s);
        if (ACTIVE_STAGES.includes(s.stage)) {
          setBusy(true);
          setPolling(true);
        }
      })
      .catch(() => {});
  }, []);

  function attemptReload(attempt: number) {
    // Ping the status endpoint; if the new launcher is back, reload
    adminApi
      .updateStatus()
      .then(() => window.location.reload())
      .catch(() => {
        if (attempt < 20) {
          reloadRef.current = window.setTimeout(
            () => attemptReload(attempt + 1),
            1500,
          );
        }
      });
  }

  useEffect(() => {
    if (polling) {
      pollRef.current = window.setInterval(poll, 1500);
      poll();
    }
    return () => clearInterval(pollRef.current);
  }, [polling, poll]);

  useEffect(
    () => () => {
      clearInterval(pollRef.current);
      clearTimeout(reloadRef.current);
    },
    [],
  );

  async function handleTrigger() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await adminApi.triggerUpdate();
      if (!res.ok) {
        setStatus({
          stage: "error",
          message: res.reason ?? "Could not start update.",
          current: "",
          latest: "",
          error: res.reason,
        });
        setBusy(false);
        return;
      }
      setPolling(true);
    } catch (e: unknown) {
      setStatus({
        stage: "error",
        message: e instanceof Error ? e.message : "Request failed.",
        current: "",
        latest: "",
      });
      setBusy(false);
    }
  }

  const isActive = ACTIVE_STAGES.includes(status?.stage ?? "idle");
  const colorClass = status ? (UPDATE_STAGE_COLOR[status.stage] ?? "") : "";

  return (
    <div className="adm-update-panel">
      <div className="adm-update-left">
        <span className="adm-stat-label">Update</span>
        {status ? (
          <span className={`adm-stat-val ${colorClass}`}>
            {UPDATE_STAGE_LABEL[status.stage]}
          </span>
        ) : (
          <span className="adm-stat-val" style={{ opacity: 0.3 }}>
            —
          </span>
        )}
      </div>

      {status && (
        <p
          className={`adm-update-msg ${status.stage === "error" ? "adm-update-msg--error" : ""}`}
        >
          {status.message}
          {status.stage === "restarting" && (
            <span className="adm-update-reload-note">
              {" "}
              Page will reload automatically…
            </span>
          )}
        </p>
      )}

      <button
        className="adm-btn adm-btn--ghost adm-btn--sm"
        onClick={handleTrigger}
        disabled={busy || isActive}
      >
        {isActive ? UPDATE_STAGE_LABEL[status!.stage] : "Check for update"}
      </button>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [active, setActive] = useState<KioskAd[]>([]);
  const [approved, setApproved] = useState<KioskAd[]>([]);
  const [submitted, setSubmitted] = useState<KioskAd[]>([]);
  const [denied, setDenied] = useState<KioskAd[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [previewAd, setPreviewAd] = useState<KioskAd | null>(null);
  const toastTimer = useRef<number>();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      const [s, st] = await Promise.all([adminApi.state(), adminApi.stats()]);
      setActive(s.active);
      setApproved(s.approved);
      setSubmitted(s.submitted);
      setDenied(s.denied ?? []);
      setStats(st);
      setErr(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg === "unauthorized") onLogout();
      else setErr(msg);
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    fetchAll();
    const id = window.setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // ── Active: reorder ────────────────────────────────────────────────────────
  async function move(index: number, dir: -1 | 1) {
    const next = [...active];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    setActive(next);
    try {
      await adminApi.reorder(next.map((a) => a.id));
    } catch {
      await fetchAll();
    }
  }

  async function deleteActive(id: string) {
    setActive((a) => a.filter((x) => x.id !== id));
    try {
      await adminApi.deleteActive(id);
      showToast("Removed from live.");
    } catch (e) {
      if (e instanceof NotFoundError)
        showToast("Already removed by another admin.");
      await fetchAll();
    }
  }

  async function deactivateActive(id: string) {
    // Optimistically move the ad from active → approved so it appears
    // instantly in the Unused section without flickering.
    const ad = active.find((x) => x.id === id);
    setActive((a) => a.filter((x) => x.id !== id));
    if (ad) setApproved((a) => [ad, ...a]);
    try {
      await adminApi.deactivateActive(id);
      showToast("Moved back to Unused.");
      // Sync to confirm server state (reorder, etc.)
      await fetchAll();
    } catch (e) {
      if (e instanceof NotFoundError)
        showToast("Already removed by another admin.");
      await fetchAll();
    }
  }

  async function clearAll() {
    if (!confirm("Remove all live news?")) return;
    setActive([]);
    try {
      const r = await adminApi.clearActive();
      showToast(`Cleared ${r.cleared}.`);
    } catch {
      await fetchAll();
    }
  }

  // ── Approved ───────────────────────────────────────────────────────────────
  async function deleteApproved(id: string) {
    setApproved((a) => a.filter((x) => x.id !== id));
    try {
      await adminApi.deleteApproved(id);
      showToast("Removed.");
    } catch (e) {
      if (e instanceof NotFoundError)
        showToast("Already removed by another admin.");
      await fetchAll();
    }
  }

  async function activateApproved(id: string) {
    try {
      await adminApi.activateApproved(id);
      showToast("Pushed live.");
    } catch (e) {
      if (e instanceof NotFoundError)
        showToast("Already acted on by another admin.");
    } finally {
      await fetchAll();
    }
  }

  async function reloadAll() {
    try {
      const r = await adminApi.reload();
      showToast(`${r.activated} ad(s) pushed live.`);
      await fetchAll();
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Error");
    }
  }

  // ── Submitted ─────────────────────────────────────────────────────────────
  async function approveSubmitted(id: string) {
    try {
      await adminApi.approveSubmitted(id);
      showToast("Approved → ready queue.");
    } catch (e) {
      if (e instanceof NotFoundError)
        showToast("Already approved or removed by another admin.");
    } finally {
      await fetchAll();
    }
  }

  async function deleteSubmitted(id: string) {
    setSubmitted((s) => s.filter((x) => x.id !== id));
    try {
      await adminApi.deleteSubmitted(id);
      showToast("Rejected.");
    } catch (e) {
      if (e instanceof NotFoundError)
        showToast("Already removed by another admin.");
      await fetchAll();
    }
  }

  async function deleteDenied(id: string) {
    setDenied((d) => d.filter((x) => x.id !== id));
    try {
      await adminApi.deleteDenied(id);
      showToast("Removed from denied.");
    } catch (e) {
      if (e instanceof NotFoundError)
        showToast("Already removed by another admin.");
      await fetchAll();
    }
  }

  async function approveAllSubmitted() {
    let notFound = 0;
    for (const ad of submitted) {
      try {
        await adminApi.approveSubmitted(ad.id);
      } catch (e) {
        if (e instanceof NotFoundError) notFound++;
      }
    }
    if (notFound > 0)
      showToast(
        `All approved (${notFound} already acted on by another admin).`,
      );
    else showToast("All approved → ready queue.");
    await fetchAll();
  }

  // ── Duration ───────────────────────────────────────────────────────────────
  async function setAdDuration(id: string, newMs: number) {
    // Optimistic update across all three lists (only one will match)
    setActive((a) => a.map((x) => (x.id === id ? { ...x, durationMs: newMs } : x)));
    setApproved((a) => a.map((x) => (x.id === id ? { ...x, durationMs: newMs } : x)));
    setSubmitted((a) => a.map((x) => (x.id === id ? { ...x, durationMs: newMs } : x)));
    try {
      await adminApi.setDuration(id, newMs);
    } catch {
      await fetchAll();
    }
  }

  // ── Kiosk ──────────────────────────────────────────────────────────────────
  async function restartKiosk() {
    if (!confirm("Restart Bernard?")) return;
    try {
      await adminApi.restartKiosk();
      showToast("Bernard restarting…");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Error");
    }
  }

  async function kioskNext() {
    try {
      await adminApi.kioskNext();
    } catch {
      showToast("Could not reach Bernard.");
    }
  }

  async function kioskPrev() {
    try {
      await adminApi.kioskPrev();
    } catch {
      showToast("Could not reach Bernard.");
    }
  }

  async function logout() {
    try {
      await adminApi.logout();
    } catch {
      /* ignore */
    }
    clearToken();
    onLogout();
  }

  if (loading) return <div className="adm-loading">Loading…</div>;

  return (
    <div className="adm-wrap">
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
      {/* Header */}
      <div className="adm-header">
        <div>
          <p className="adm-wordmark">Startup Shell</p>
          <p className="adm-header-sub">Admin Dashboard</p>
        </div>
        <div className="adm-header-actions">
          <button className="adm-btn adm-btn--ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>

      {/* Stats */}
      <StatsBar
        stats={stats}
        onRestart={restartKiosk}
        onNext={kioskNext}
        onPrev={kioskPrev}
      />

      {/* Update */}
      <UpdatePanel />

      {err && (
        <div className="adm-err-banner">
          {err} <button onClick={fetchAll}>Retry</button>
        </div>
      )}

      {/* ── Section 1: Unused ads (approved first, then pending) ───────── */}
      <section className="adm-section">
        <div className="adm-section-header">
          <span className="adm-section-title">Unused News</span>
          <span className="adm-section-sub">
            Approved news is ready to push live · Pending news awaits approval
          </span>
          <span className="adm-count">{approved.length + submitted.length}</span>
          {approved.length > 0 && (
            <button className="adm-btn adm-btn--sm" onClick={reloadAll}>
              Push all approved live
            </button>
          )}
          {submitted.length > 0 && (
            <button
              className="adm-btn adm-btn--ghost adm-btn--sm"
              onClick={approveAllSubmitted}
            >
              Approve all pending
            </button>
          )}
        </div>
        {approved.length === 0 && submitted.length === 0 ? (
          <p className="adm-empty">No unused news.</p>
        ) : (
          <div className="adm-list">
            {/* Approved ads shown first */}
            {approved.map((ad) => (
              <AdRow
                key={ad.id}
                ad={ad}
                stage="approved"
                onPreview={() => setPreviewAd(ad)}
                onActivate={() => activateApproved(ad.id)}
                onDelete={() => deleteApproved(ad.id)}
                onSetDuration={(ms) => setAdDuration(ad.id, ms)}
              />
            ))}
            {/* Pending/submitted ads shown below approved */}
            {submitted.map((ad) => (
              <AdRow
                key={ad.id}
                ad={ad}
                stage="submitted"
                onPreview={() => setPreviewAd(ad)}
                onApprove={() => approveSubmitted(ad.id)}
                onDelete={() => deleteSubmitted(ad.id)}
                onSetDuration={(ms) => setAdDuration(ad.id, ms)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="adm-rule" />

      {/* ── Section 2: Live playlist ──────────────────────────────────────── */}
      <section className="adm-section">
        <div className="adm-section-header">
          <span className="adm-section-title">Live News</span>
          <span className="adm-section-sub">Currently shown on Bernard · reorder with ↑↓ · ← moves back to Unused</span>
          <span className="adm-count">{active.length}</span>
          {active.length > 0 && (
            <button
              className="adm-btn adm-btn--ghost adm-btn--sm adm-btn--danger"
              onClick={clearAll}
            >
              Clear all
            </button>
          )}
        </div>
        {active.length === 0 ? (
          <p className="adm-empty">
            Nothing live. Approve news above then push it live.
          </p>
        ) : (
          <div className="adm-list">
            {active.map((ad, i) => (
              <AdRow
                key={ad.id}
                ad={ad}
                index={i}
                total={active.length}
                stage="active"
                onPreview={() => setPreviewAd(ad)}
                onMoveUp={() => move(i, -1)}
                onMoveDown={() => move(i, 1)}
                onDeactivate={() => deactivateActive(ad.id)}
                onDelete={() => deleteActive(ad.id)}
                onSetDuration={(ms) => setAdDuration(ad.id, ms)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3: Denied ads ──────────────────────────────────────────── */}
      {denied.length > 0 && (
        <>
          <div className="adm-rule" />
          <section className="adm-section">
            <div className="adm-section-header">
              <span className="adm-section-title">Denied</span>
              <span className="adm-section-sub">Rejected submissions — kept so submitters can see status</span>
              <span className="adm-count">{denied.length}</span>
            </div>
            <div className="adm-list">
              {denied.map((ad) => (
                <div key={ad.id} className="adm-row adm-row--denied">
                  <span className="adm-row-num adm-row-num--denied">✕</span>
                  <div className="adm-row-info">
                    <span className="adm-row-name">{ad.name}</span>
                    {ad.submittedBy && (
                      <span className="adm-row-submitted-by">by {ad.submittedBy}</span>
                    )}
                    <span className="adm-row-meta">
                      <span className={`adm-type adm-type--${ad.type}`}>{ad.type}</span>
                      <span className="adm-badge adm-badge--denied">denied</span>
                      {ad.src && (
                        <span className="adm-row-url" title={ad.src}>
                          {truncate(ad.src, 38)}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="adm-row-actions">
                    <button
                      className="adm-icon-btn adm-icon-btn--preview"
                      onClick={() => setPreviewAd(ad)}
                      title="Preview"
                    >
                      ⊙
                    </button>
                    <button
                      className="adm-icon-btn adm-icon-btn--del"
                      onClick={() => deleteDenied(ad.id)}
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {toast && <div className="adm-toast">{toast}</div>}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Admin() {
  const [authed, setAuthed] = useState(() => getToken() !== null);
  function handleLogout() {
    clearToken();
    setAuthed(false);
  }
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return <Dashboard onLogout={handleLogout} />;
}
