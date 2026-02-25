import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, clearToken, getToken, setToken, type KioskAd } from "../api";
import "./Admin.css";

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
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

// ─── Ad row ───────────────────────────────────────────────────────────────────

interface ActiveRowProps {
  ad: KioskAd;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function ActiveRow({
  ad,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onDelete,
}: ActiveRowProps) {
  return (
    <div className="adm-row">
      <span className="adm-row-num">{index + 1}</span>
      <div className="adm-row-info">
        <span className="adm-row-name">{ad.name}</span>
        <span className="adm-row-meta">
          <span className={`adm-type adm-type--${ad.type}`}>{ad.type}</span>
          <span className="adm-row-dur">
            {(ad.durationMs / 1000).toFixed(0)}s
          </span>
          {ad.src && (
            <a
              className="adm-row-url"
              href={ad.src}
              target="_blank"
              rel="noreferrer"
              title={ad.src}
            >
              {truncate(ad.src, 40)}
            </a>
          )}
        </span>
      </div>
      <div className="adm-row-actions">
        <button
          className="adm-icon-btn"
          onClick={onMoveUp}
          disabled={index === 0}
          title="Move up"
        >
          ↑
        </button>
        <button
          className="adm-icon-btn"
          onClick={onMoveDown}
          disabled={index === total - 1}
          title="Move down"
        >
          ↓
        </button>
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

interface PendingRowProps {
  ad: KioskAd;
  onApprove: () => void;
  onDelete: () => void;
}

function PendingRow({ ad, onApprove, onDelete }: PendingRowProps) {
  return (
    <div className="adm-row">
      <span className="adm-row-num adm-row-num--pending">•</span>
      <div className="adm-row-info">
        <span className="adm-row-name">{ad.name}</span>
        <span className="adm-row-meta">
          <span className={`adm-type adm-type--${ad.type}`}>{ad.type}</span>
          <span className="adm-row-dur">
            {(ad.durationMs / 1000).toFixed(0)}s
          </span>
          {ad.src && (
            <a
              className="adm-row-url"
              href={ad.src}
              target="_blank"
              rel="noreferrer"
              title={ad.src}
            >
              {truncate(ad.src, 40)}
            </a>
          )}
        </span>
      </div>
      <div className="adm-row-actions">
        <button
          className="adm-icon-btn adm-icon-btn--approve"
          onClick={onApprove}
          title="Approve → active"
        >
          ✓
        </button>
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [active, setActive] = useState<KioskAd[]>([]);
  const [pending, setPending] = useState<KioskAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  }, []);

  const fetchState = useCallback(async () => {
    try {
      const s = await adminApi.state();
      setActive(s.active);
      setPending(s.pending);
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
    fetchState();
    const id = window.setInterval(fetchState, 5000);
    return () => clearInterval(id);
  }, [fetchState]);

  // ── Active: move up/down ──────────────────────────────────────────────────
  async function move(index: number, dir: -1 | 1) {
    const next = [...active];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    setActive(next);
    try {
      await adminApi.reorder(next.map((a) => a.id));
    } catch {
      await fetchState();
    }
  }

  async function deleteActive(id: string) {
    setActive((a) => a.filter((x) => x.id !== id));
    try {
      await adminApi.deleteActive(id);
      showToast("Deleted.");
    } catch {
      await fetchState();
    }
  }

  async function clearAll() {
    if (!confirm("Clear all active ads from the playlist?")) return;
    setActive([]);
    try {
      const r = await adminApi.clearActive();
      showToast(`Cleared ${r.cleared} ad(s).`);
    } catch {
      await fetchState();
    }
  }

  async function reload() {
    try {
      await adminApi.reload();
      showToast("Reload signal sent — kiosk picks up on next poll.");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Error");
    }
  }

  // ── Pending ───────────────────────────────────────────────────────────────
  async function approvePending(id: string) {
    try {
      await adminApi.approve(id);
      showToast("Approved → active.");
      await fetchState();
    } catch {
      await fetchState();
    }
  }

  async function deletePending(id: string) {
    setPending((p) => p.filter((x) => x.id !== id));
    try {
      await adminApi.deletePending(id);
      showToast("Deleted.");
    } catch {
      await fetchState();
    }
  }

  async function approveAll() {
    for (const ad of pending) {
      await adminApi.approve(ad.id).catch(() => {});
    }
    showToast("All pending approved.");
    await fetchState();
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
          <button className="adm-btn" onClick={reload}>
            Reload kiosk
          </button>
          <button className="adm-btn adm-btn--ghost" onClick={logout}>
            Sign out
          </button>
        </div>
      </div>

      {err && (
        <div className="adm-err-banner">
          {err} <button onClick={fetchState}>Retry</button>
        </div>
      )}

      {/* Active playlist */}
      <section className="adm-section">
        <div className="adm-section-header">
          <span className="adm-section-title">Active Playlist</span>
          <span className="adm-count">{active.length}</span>
          {active.length > 0 && (
            <button
              className="adm-btn adm-btn--ghost adm-btn--sm"
              onClick={clearAll}
            >
              Clear all
            </button>
          )}
        </div>

        {active.length === 0 ? (
          <p className="adm-empty">
            No active ads. Approve pending items or submit via the main page.
          </p>
        ) : (
          <div className="adm-list">
            {active.map((ad, i) => (
              <ActiveRow
                key={ad.id}
                ad={ad}
                index={i}
                total={active.length}
                onMoveUp={() => move(i, -1)}
                onMoveDown={() => move(i, 1)}
                onDelete={() => deleteActive(ad.id)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="adm-rule" />

      {/* Pending queue */}
      <section className="adm-section">
        <div className="adm-section-header">
          <span className="adm-section-title">Pending Queue</span>
          <span className="adm-count">{pending.length}</span>
          {pending.length > 0 && (
            <button
              className="adm-btn adm-btn--ghost adm-btn--sm"
              onClick={approveAll}
            >
              Approve all
            </button>
          )}
        </div>

        {pending.length === 0 ? (
          <p className="adm-empty">No pending submissions.</p>
        ) : (
          <div className="adm-list">
            {pending.map((ad) => (
              <PendingRow
                key={ad.id}
                ad={ad}
                onApprove={() => approvePending(ad.id)}
                onDelete={() => deletePending(ad.id)}
              />
            ))}
          </div>
        )}
      </section>

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
