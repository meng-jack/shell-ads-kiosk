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

// ─── Preview panel ────────────────────────────────────────────────────────────

function Preview({ ad, onClose }: { ad: KioskAd; onClose: () => void }) {
  return (
    <div className="adm-preview-overlay" onClick={onClose}>
      <div className="adm-preview-box" onClick={(e) => e.stopPropagation()}>
        <div className="adm-preview-header">
          <span className="adm-preview-title">{ad.name}</span>
          <button className="adm-icon-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="adm-preview-stage">
          {ad.type === "image" && ad.src && (
            <img src={ad.src} alt={ad.name} className="adm-preview-img" />
          )}
          {ad.type === "video" && ad.src && (
            <video
              src={ad.src}
              className="adm-preview-video"
              autoPlay
              muted
              loop
              playsInline
              controls={false}
            />
          )}
          {ad.type === "html" && ad.src && (
            <iframe
              src={ad.src}
              className="adm-preview-iframe"
              sandbox="allow-scripts allow-same-origin"
              title={ad.name}
            />
          )}
        </div>
        <div className="adm-preview-meta">
          <span className={`adm-type adm-type--${ad.type}`}>{ad.type}</span>
          <span className="adm-row-dur">
            {(ad.durationMs / 1000).toFixed(0)}s
          </span>
          {ad.src && (
            <a
              href={ad.src}
              target="_blank"
              rel="noreferrer"
              className="adm-row-url"
              title={ad.src}
            >
              {truncate(ad.src, 52)}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Ad row (generic) ─────────────────────────────────────────────────────────

interface AdRowProps {
  ad: KioskAd;
  index?: number;
  total?: number;
  stage: "active" | "approved" | "submitted";
  onPreview: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
  onApprove?: () => void; // submitted → approved
  onActivate?: () => void; // approved → active (one at a time) or active=push
}

function AdRow({
  ad,
  index,
  total,
  stage,
  onPreview,
  onMoveUp,
  onMoveDown,
  onDelete,
  onApprove,
  onActivate,
}: AdRowProps) {
  return (
    <div className="adm-row">
      {stage === "active" ? (
        <span className="adm-row-num">{(index ?? 0) + 1}</span>
      ) : (
        <span className={`adm-row-num adm-row-num--${stage}`}>•</span>
      )}
      <div className="adm-row-info">
        <span className="adm-row-name">{ad.name}</span>
        <span className="adm-row-meta">
          <span className={`adm-type adm-type--${ad.type}`}>{ad.type}</span>
          <span className="adm-row-dur">
            {(ad.durationMs / 1000).toFixed(0)}s
          </span>
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
          onClick={onPreview}
          title="Preview"
        >
          ⊙
        </button>
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
            title="Push live now"
          >
            ▶
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

  if (!stats)
    return (
      <div className="adm-stats-bar adm-stats-bar--loading">Loading stats…</div>
    );

  const k = stats.kiosk;
  const liveUptime =
    k.running && baseTimeRef.current ? k.uptimeSec + extraSec : k.uptimeSec;

  return (
    <div className="adm-stats-bar">
      <div className="adm-stat">
        <span className="adm-stat-label">Kiosk</span>
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
        <span className="adm-stat-label">Build</span>
        <span className="adm-stat-val">{stats.build}</span>
      </div>
      {stats.updating && (
        <div className="adm-stat">
          <span className="adm-stat-label">Update</span>
          <span className="adm-stat-val adm-stat-val--yellow">In progress</span>
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
          Restart kiosk
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
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<KioskAd | null>(null);
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

  async function clearAll() {
    if (!confirm("Remove all live ads?")) return;
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

  // ── Kiosk ──────────────────────────────────────────────────────────────────
  async function restartKiosk() {
    if (!confirm("Restart the kiosk process?")) return;
    try {
      await adminApi.restartKiosk();
      showToast("Kiosk restarting…");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Error");
    }
  }

  async function kioskNext() {
    try {
      await adminApi.kioskNext();
    } catch {
      showToast("Could not reach kiosk.");
    }
  }

  async function kioskPrev() {
    try {
      await adminApi.kioskPrev();
    } catch {
      showToast("Could not reach kiosk.");
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

      {/* ── Section 1: Submitted (needs review) ─────────────────────────── */}
      <section className="adm-section">
        <div className="adm-section-header">
          <span className="adm-section-title">Submitted</span>
          <span className="adm-section-sub">Awaiting admin approval</span>
          <span className="adm-count">{submitted.length}</span>
          {submitted.length > 0 && (
            <button
              className="adm-btn adm-btn--ghost adm-btn--sm"
              onClick={approveAllSubmitted}
            >
              Approve all
            </button>
          )}
        </div>
        {submitted.length === 0 ? (
          <p className="adm-empty">No pending submissions.</p>
        ) : (
          <div className="adm-list">
            {submitted.map((ad) => (
              <AdRow
                key={ad.id}
                ad={ad}
                stage="submitted"
                onPreview={() => setPreview(ad)}
                onApprove={() => approveSubmitted(ad.id)}
                onDelete={() => deleteSubmitted(ad.id)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="adm-rule" />

      {/* ── Section 2: Approved (ready to go live) ──────────────────────── */}
      <section className="adm-section">
        <div className="adm-section-header">
          <span className="adm-section-title">Approved</span>
          <span className="adm-section-sub">
            Ready — push live via Reload or Z key
          </span>
          <span className="adm-count">{approved.length}</span>
          {approved.length > 0 && (
            <button className="adm-btn adm-btn--sm" onClick={reloadAll}>
              Push all live
            </button>
          )}
        </div>
        {approved.length === 0 ? (
          <p className="adm-empty">
            No approved ads. Approve items from Submitted above.
          </p>
        ) : (
          <div className="adm-list">
            {approved.map((ad) => (
              <AdRow
                key={ad.id}
                ad={ad}
                stage="approved"
                onPreview={() => setPreview(ad)}
                onActivate={() => activateApproved(ad.id)}
                onDelete={() => deleteApproved(ad.id)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="adm-rule" />

      {/* ── Section 3: Live playlist ─────────────────────────────────────── */}
      <section className="adm-section">
        <div className="adm-section-header">
          <span className="adm-section-title">Live Playlist</span>
          <span className="adm-section-sub">Currently shown on kiosk</span>
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
            Nothing live. Approve and push ads from the sections above.
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
                onPreview={() => setPreview(ad)}
                onMoveUp={() => move(i, -1)}
                onMoveDown={() => move(i, 1)}
                onDelete={() => deleteActive(ad.id)}
              />
            ))}
          </div>
        )}
      </section>

      {preview && <Preview ad={preview} onClose={() => setPreview(null)} />}
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
