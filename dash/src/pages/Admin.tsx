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

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Dashboard({ onLogout }: { onLogout: () => void }) {
  // ── Server snapshots (from poll) ──────────────────────────────────────────
  const [serverActive, setServerActive] = useState<KioskAd[]>([]);
  const [serverApproved, setServerApproved] = useState<KioskAd[]>([]);
  const [submitted, setSubmitted] = useState<KioskAd[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // ── Local queue draft ─────────────────────────────────────────────────────
  const [holdingQueue, setHoldingQueue] = useState<KioskAd[]>([]);
  const [selectionQueue, setSelectionQueue] = useState<KioskAd[]>([]);
  const [dirty, setDirty] = useState(false);

  // ── Checkbox selections ───────────────────────────────────────────────────
  const [holdingSel, setHoldingSel] = useState<Set<string>>(new Set());
  const [selectionSel, setSelectionSel] = useState<Set<string>>(new Set());

  // ── Drag state (for reordering selection queue) ───────────────────────────
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // ── Misc ──────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<KioskAd | null>(null);
  const toastTimer = useRef<number>();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(
    async (force = false) => {
      try {
        const [s, st] = await Promise.all([adminApi.state(), adminApi.stats()]);
        setSubmitted(s.submitted);
        setStats(st);
        setServerActive(s.active);
        setServerApproved(s.approved);
        setErr(null);
        // Only sync draft when not dirty (don't stomp user's working changes)
        if (!dirty || force) {
          setHoldingQueue(s.approved);
          setSelectionQueue(s.active);
          if (force) setDirty(false);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "unauthorized") onLogout();
        else setErr(msg);
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [onLogout, dirty],
  );

  useEffect(() => {
    fetchAll(false);
    const id = window.setInterval(() => fetchAll(false), 5000);
    return () => clearInterval(id);
  }, [fetchAll]);

  // ── Queue actions ─────────────────────────────────────────────────────────
  function moveToSelection(ids: Set<string>) {
    if (ids.size === 0) return;
    const toMove = holdingQueue.filter((a) => ids.has(a.id));
    setHoldingQueue((h) => h.filter((a) => !ids.has(a.id)));
    setSelectionQueue((s) => [...s, ...toMove]);
    setHoldingSel(new Set());
    setDirty(true);
  }

  function moveToHolding(ids: Set<string>) {
    if (ids.size === 0) return;
    const toMove = selectionQueue.filter((a) => ids.has(a.id));
    setSelectionQueue((s) => s.filter((a) => !ids.has(a.id)));
    setHoldingQueue((h) => [...h, ...toMove]);
    setSelectionSel(new Set());
    setDirty(true);
  }

  function moveOneToSelection(id: string) {
    moveToSelection(new Set([id]));
  }

  function moveOneToHolding(id: string) {
    moveToHolding(new Set([id]));
  }

  function moveSelectionUp(idx: number) {
    if (idx === 0) return;
    setSelectionQueue((s) => {
      const n = [...s];
      [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
      return n;
    });
    setDirty(true);
  }

  function moveSelectionDown(idx: number) {
    setSelectionQueue((s) => {
      if (idx >= s.length - 1) return s;
      const n = [...s];
      [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]];
      return n;
    });
    setDirty(true);
  }

  function moveAllToSelection() {
    setSelectionQueue((s) => [...s, ...holdingQueue]);
    setHoldingQueue([]);
    setHoldingSel(new Set());
    setDirty(true);
  }

  function moveAllToHolding() {
    setHoldingQueue((h) => [...h, ...selectionQueue]);
    setSelectionQueue([]);
    setSelectionSel(new Set());
    setDirty(true);
  }

  function discardChanges() {
    setHoldingQueue(serverApproved);
    setSelectionQueue(serverActive);
    setHoldingSel(new Set());
    setSelectionSel(new Set());
    setDirty(false);
  }

  async function pushPlaylist() {
    try {
      await adminApi.setPlaylist(selectionQueue.map((a) => a.id));
      showToast("Playlist pushed live.");
      await fetchAll(true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Push failed.");
    }
  }

  // ── Drag reorder ──────────────────────────────────────────────────────────
  function handleDragStart(idx: number) {
    setDragFrom(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    setDragOver(idx);
  }

  function handleDrop(idx: number) {
    if (dragFrom === null || dragFrom === idx) {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    setSelectionQueue((s) => {
      const n = [...s];
      const [item] = n.splice(dragFrom, 1);
      n.splice(idx, 0, item);
      return n;
    });
    setDragFrom(null);
    setDragOver(null);
    setDirty(true);
  }

  function handleDragEnd() {
    setDragFrom(null);
    setDragOver(null);
  }

  // ── Submitted actions ─────────────────────────────────────────────────────
  async function approveSubmitted(id: string) {
    try {
      await adminApi.approveSubmitted(id);
      showToast("Approved → holding queue.");
    } catch (e) {
      if (e instanceof NotFoundError)
        showToast("Already acted on by another admin.");
    } finally {
      await fetchAll(false);
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
      await fetchAll(false);
    }
  }

  async function approveAllSubmitted() {
    let nf = 0;
    for (const ad of submitted) {
      try {
        await adminApi.approveSubmitted(ad.id);
      } catch (e) {
        if (e instanceof NotFoundError) nf++;
      }
    }
    showToast(
      nf
        ? `All approved (${nf} already handled).`
        : "All approved → holding queue.",
    );
    await fetchAll(false);
  }

  // ── Holding: permanent delete ─────────────────────────────────────────────
  async function deleteFromHolding(id: string) {
    setHoldingQueue((h) => h.filter((a) => a.id !== id));
    setHoldingSel((s) => {
      s.delete(id);
      return new Set(s);
    });
    try {
      await adminApi.deleteApproved(id);
      showToast("Permanently removed.");
    } catch (e) {
      if (e instanceof NotFoundError)
        showToast("Already removed by another admin.");
      await fetchAll(false);
    }
  }

  async function deleteSelectedFromHolding() {
    if (!holdingSel.size) return;
    const ids = [...holdingSel];
    setHoldingQueue((h) => h.filter((a) => !holdingSel.has(a.id)));
    setHoldingSel(new Set());
    for (const id of ids) {
      try {
        await adminApi.deleteApproved(id);
      } catch {
        /* ignore individual errors */
      }
    }
    showToast(`Removed ${ids.length}.`);
    await fetchAll(false);
  }

  // ── Kiosk ─────────────────────────────────────────────────────────────────
  async function restartKiosk() {
    if (!confirm("Restart the kiosk process?")) return;
    try {
      await adminApi.restartKiosk();
      showToast("Kiosk restarting…");
    } catch (e) {
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

  // ── Checkbox helpers ──────────────────────────────────────────────────────
  function toggleHolding(id: string) {
    setHoldingSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  function toggleSelection(id: string) {
    setSelectionSel((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
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

      <StatsBar
        stats={stats}
        onRestart={restartKiosk}
        onNext={kioskNext}
        onPrev={kioskPrev}
      />
      <UpdatePanel />

      {err && (
        <div className="adm-err-banner">
          {err} <button onClick={() => fetchAll(false)}>Retry</button>
        </div>
      )}

      {/* ── Submitted ───────────────────────────────────────────────────── */}
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
              <div key={ad.id} className="adm-row">
                <span className="adm-row-num adm-row-num--submitted">•</span>
                <div className="adm-row-info">
                  <span className="adm-row-name">{ad.name}</span>
                  <span className="adm-row-meta">
                    <span className={`adm-type adm-type--${ad.type}`}>
                      {ad.type}
                    </span>
                    <span className="adm-row-dur">
                      {(ad.durationMs / 1000).toFixed(0)}s
                    </span>
                    {ad.src && (
                      <span className="adm-row-url" title={ad.src}>
                        {truncate(ad.src, 32)}
                      </span>
                    )}
                  </span>
                  {(ad.submitterName || ad.submitterEmail) && (
                    <span className="adm-row-submitter">
                      {ad.submitterName && (
                        <span className="adm-submitter-name">
                          {ad.submitterName}
                        </span>
                      )}
                      {ad.submitterEmail && (
                        <span className="adm-submitter-email">
                          {ad.submitterEmail}
                        </span>
                      )}
                      {ad.submittedAt && (
                        <span className="adm-submitter-time">
                          {fmtDate(ad.submittedAt)}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <div className="adm-row-actions">
                  <button
                    className="adm-icon-btn adm-icon-btn--preview"
                    onClick={() => setPreview(ad)}
                    title="Preview"
                  >
                    ⊙
                  </button>
                  <button
                    className="adm-icon-btn adm-icon-btn--approve"
                    onClick={() => approveSubmitted(ad.id)}
                    title="Approve → Holding"
                  >
                    ✓
                  </button>
                  <button
                    className="adm-icon-btn adm-icon-btn--del"
                    onClick={() => deleteSubmitted(ad.id)}
                    title="Reject"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="adm-rule" />

      {/* ── Queue management ────────────────────────────────────────────── */}
      <div className="adm-queue-header">
        <div className="adm-queue-title-row">
          <span className="adm-section-title">Queue Management</span>
          {dirty && <span className="adm-dirty-badge">Unsaved changes</span>}
        </div>
        <div className="adm-queue-actions">
          <button
            className="adm-btn adm-btn--ghost adm-btn--sm"
            onClick={discardChanges}
            disabled={!dirty}
          >
            Discard
          </button>
          <button
            className="adm-btn adm-btn--sm adm-btn--push"
            onClick={pushPlaylist}
            disabled={!dirty}
          >
            Push to kiosk
          </button>
        </div>
      </div>

      <div className="adm-queues">
        {/* ── Holding Queue ──────────────────────────────────────────── */}
        <div className="adm-queue">
          <div className="adm-queue-head">
            <span className="adm-queue-label">Holding Queue</span>
            <span className="adm-count">{holdingQueue.length}</span>
            {holdingSel.size > 0 && (
              <div className="adm-queue-bulk">
                <button
                  className="adm-btn adm-btn--ghost adm-btn--xs"
                  onClick={() => moveToSelection(holdingSel)}
                >
                  → Selection ({holdingSel.size})
                </button>
                <button
                  className="adm-btn adm-btn--xs adm-btn--danger"
                  onClick={deleteSelectedFromHolding}
                >
                  Delete ({holdingSel.size})
                </button>
              </div>
            )}
            {holdingQueue.length > 0 && holdingSel.size === 0 && (
              <button
                className="adm-btn adm-btn--ghost adm-btn--xs"
                onClick={moveAllToSelection}
                title="Move all to selection"
              >
                All →
              </button>
            )}
          </div>

          {holdingQueue.length === 0 ? (
            <p className="adm-queue-empty">
              No approved ads in holding.
              <br />
              Approve submissions above.
            </p>
          ) : (
            <div className="adm-list">
              {holdingQueue.map((ad) => (
                <div
                  key={ad.id}
                  className={`adm-row adm-row--holding${holdingSel.has(ad.id) ? " adm-row--selected" : ""}`}
                >
                  <input
                    type="checkbox"
                    className="adm-checkbox"
                    checked={holdingSel.has(ad.id)}
                    onChange={() => toggleHolding(ad.id)}
                  />
                  <div className="adm-row-info">
                    <span className="adm-row-name">{ad.name}</span>
                    <span className="adm-row-meta">
                      <span className={`adm-type adm-type--${ad.type}`}>
                        {ad.type}
                      </span>
                      <span className="adm-row-dur">
                        {(ad.durationMs / 1000).toFixed(0)}s
                      </span>
                    </span>
                    {(ad.submitterName || ad.submitterEmail) && (
                      <span className="adm-row-submitter">
                        {ad.submitterName && (
                          <span className="adm-submitter-name">
                            {ad.submitterName}
                          </span>
                        )}
                        {ad.submitterEmail && (
                          <span className="adm-submitter-email">
                            {ad.submitterEmail}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="adm-row-actions">
                    <button
                      className="adm-icon-btn adm-icon-btn--preview"
                      onClick={() => setPreview(ad)}
                      title="Preview"
                    >
                      ⊙
                    </button>
                    <button
                      className="adm-icon-btn adm-icon-btn--move"
                      onClick={() => moveOneToSelection(ad.id)}
                      title="Move to selection queue"
                    >
                      →
                    </button>
                    <button
                      className="adm-icon-btn adm-icon-btn--del"
                      onClick={() => deleteFromHolding(ad.id)}
                      title="Permanently delete"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Center controls ────────────────────────────────────────── */}
        <div className="adm-queue-center">
          <button
            className="adm-icon-btn adm-queue-center-btn"
            onClick={moveAllToSelection}
            title="Move all to selection"
            disabled={holdingQueue.length === 0}
          >
            »
          </button>
          <button
            className="adm-icon-btn adm-queue-center-btn"
            onClick={moveAllToHolding}
            title="Move all back to holding"
            disabled={selectionQueue.length === 0}
          >
            «
          </button>
        </div>

        {/* ── Selection Queue ────────────────────────────────────────── */}
        <div className="adm-queue">
          <div className="adm-queue-head">
            <span className="adm-queue-label">Selection Queue</span>
            <span className="adm-count">{selectionQueue.length}</span>
            <span className="adm-queue-sublabel">drag or ↑↓ to reorder</span>
            {selectionSel.size > 0 && (
              <button
                className="adm-btn adm-btn--ghost adm-btn--xs"
                onClick={() => moveToHolding(selectionSel)}
              >
                ← Holding ({selectionSel.size})
              </button>
            )}
            {selectionQueue.length > 0 && selectionSel.size === 0 && (
              <button
                className="adm-btn adm-btn--ghost adm-btn--xs"
                onClick={moveAllToHolding}
                title="Move all back to holding"
              >
                ← All
              </button>
            )}
          </div>

          {selectionQueue.length === 0 ? (
            <p className="adm-queue-empty">
              No ads selected.
              <br />
              Move items here from Holding.
            </p>
          ) : (
            <div className="adm-list">
              {selectionQueue.map((ad, i) => (
                <div
                  key={ad.id}
                  className={`adm-row adm-row--selection${dragOver === i ? " adm-row--dragover" : ""}${dragFrom === i ? " adm-row--dragging" : ""}${selectionSel.has(ad.id) ? " adm-row--selected" : ""}`}
                  draggable
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={(e) => handleDragOver(e, i)}
                  onDrop={() => handleDrop(i)}
                  onDragEnd={handleDragEnd}
                >
                  <span className="adm-drag-handle" title="Drag to reorder">
                    ⋮⋮
                  </span>
                  <span className="adm-row-num">{i + 1}</span>
                  <input
                    type="checkbox"
                    className="adm-checkbox"
                    checked={selectionSel.has(ad.id)}
                    onChange={() => toggleSelection(ad.id)}
                  />
                  <div className="adm-row-info">
                    <span className="adm-row-name">{ad.name}</span>
                    <span className="adm-row-meta">
                      <span className={`adm-type adm-type--${ad.type}`}>
                        {ad.type}
                      </span>
                      <span className="adm-row-dur">
                        {(ad.durationMs / 1000).toFixed(0)}s
                      </span>
                    </span>
                  </div>
                  <div className="adm-row-actions">
                    <button
                      className="adm-icon-btn adm-icon-btn--preview"
                      onClick={() => setPreview(ad)}
                      title="Preview"
                    >
                      ⊙
                    </button>
                    <button
                      className="adm-icon-btn"
                      onClick={() => moveSelectionUp(i)}
                      disabled={i === 0}
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      className="adm-icon-btn"
                      onClick={() => moveSelectionDown(i)}
                      disabled={i === selectionQueue.length - 1}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      className="adm-icon-btn adm-icon-btn--move"
                      onClick={() => moveOneToHolding(ad.id)}
                      title="Return to holding"
                    >
                      ←
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

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
