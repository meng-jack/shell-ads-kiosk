import { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import {
  CleanupAssets,
  DownloadAsset,
  FetchPlaylist,
  GetBuildNumber,
  IsDevMode,
} from "../wailsjs/go/main/App";
import { EventsOn } from "../wailsjs/runtime/runtime";
import type { Ad, AdLayout, TransitionName } from "./types";
import type { main } from "../wailsjs/go/models";
import AdRenderer from "./components/AdRenderer";
import DevOverlay from "./components/DevOverlay";

const DEFAULT_DURATION_MS = 25000;
const EXIT_ANIMATION_MS = 650;
const PLAYLIST_REFRESH_MS = 60_000;

const fallbackAds: Ad[] = [
  {
    id: "fallback-image",
    name: "Fallback Image",
    type: "image",
    src: "https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=1600&q=80",
    durationMs: 20000,
    transition: { enter: "fade", exit: "fade" },
    layout: { fit: "contain", paddingPx: 60, background: "#0f172a" },
  },
  {
    id: "fallback-video",
    name: "Fallback Video",
    type: "video",
    src: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
    poster:
      "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80",
    durationMs: 24000,
    transition: { enter: "slide-left", exit: "fade" },
    layout: { fit: "cover" },
  },
  {
    id: "fallback-html",
    name: "Fallback HTML",
    type: "html",
    html: '<style>body{margin:0;display:flex;align-items:center;justify-content:center;background:#0b132b;color:#fff;font-family:sans-serif;} .card{padding:28px 34px;border-radius:14px;background:linear-gradient(135deg,#1dd3b0,#6c63ff);box-shadow:0 18px 42px rgba(0,0,0,0.45);} .card h1{margin:0;font-size:32px;} .card p{margin:8px 0 0;font-size:18px;opacity:.92;}</style><div class="card"><h1>Tonight at the Club</h1><p>Stay hydrated and enjoy!</p></div>',
    durationMs: 16000,
    transition: { enter: "zoom", exit: "fade" },
  },
];

const normalizeAds = (raw: unknown[]): Ad[] => {
  const result: Ad[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof (item as any).type !== "string") return;
    const type = (item as any).type.toLowerCase() as string;
    if (type !== "image" && type !== "video" && type !== "html") return;

    const rawLayout = (item as any).layout;
    const layout: AdLayout | undefined = rawLayout
      ? {
          fit: rawLayout.fit || undefined,
          paddingPx: rawLayout.paddingPx || 0,
          background: rawLayout.background || undefined,
          width: rawLayout.width || undefined,
          height: rawLayout.height || undefined,
        }
      : undefined;

    result.push({
      id: (item as any).id || `ad-${index}`,
      name: (item as any).name || `Ad ${index + 1}`,
      type: type as Ad["type"],
      src: (item as any).src,
      poster: (item as any).poster,
      html: (item as any).html,
      transition: {
        enter: (item as any).transition?.enter ?? "fade",
        exit: (item as any).transition?.exit ?? "fade",
      },
      durationMs: Math.max(
        (item as any).durationMs ?? DEFAULT_DURATION_MS,
        EXIT_ANIMATION_MS + 500,
      ),
      layout,
    });
  });
  return result;
};

function App() {
  const [ads, setAds] = useState<Ad[]>(normalizeAds(fallbackAds));
  const [activeIndex, setActiveIndex] = useState(0);
  const [isExiting, setIsExiting] = useState(false);
  const [status, setStatus] = useState("Loading playlist…");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Dev mode
  const [devMode, setDevMode] = useState(false);
  const [buildNumber, setBuildNumber] = useState("dev");
  const [msLeft, setMsLeft] = useState(0);
  const [updateInfo, setUpdateInfo] = useState<main.UpdateInfo | null>(null);

  // Asset caching: localSrcs is a ref so updates don't trigger mid-play re-renders.
  // activeSrc is committed once per slot change so the currently-playing ad is stable.
  const localSrcsRef = useRef<Record<string, string>>({});
  const [activeSrc, setActiveSrc] = useState<string | undefined>(undefined);

  const exitTimer = useRef<number>();
  const advanceTimer = useRef<number>();
  const slotStartRef = useRef(Date.now());

  // ── One-time init ──────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([IsDevMode(), GetBuildNumber()])
      .then(([isDev, build]) => {
        setDevMode(isDev);
        setBuildNumber(build);
      })
      .catch(() => {
        // Fallback: treat Vite dev server as dev mode
        setDevMode(import.meta.env.DEV);
      });

    // Listen for the background updater events (emitted from updater.go).
    const unsubAvailable = EventsOn(
      "update:available",
      (info: main.UpdateInfo) => {
        setUpdateInfo(info);
      },
    );
    const unsubError = EventsOn("update:error", (msg: string) => {
      console.warn("[updater] error:", msg);
    });

    return () => {
      unsubAvailable();
      unsubError();
    };
  }, []);

  // ── Asset download helper (fire-and-forget) ────────────────────────────────
  const downloadAssetsInBackground = useCallback((loadedAds: Ad[]) => {
    const targets = loadedAds.filter(
      (ad) => ad.src && (ad.type === "image" || ad.type === "video"),
    );

    Promise.allSettled(
      targets.map(async (ad) => {
        try {
          const local = await DownloadAsset(ad.id, ad.src!);
          if (local) {
            localSrcsRef.current[ad.id] = local;
          }
        } catch {
          /* ignore individual download failures */
        }
      }),
    ).then(() => {
      // After all downloads attempted, purge stale cache entries.
      CleanupAssets(loadedAds.map((a) => a.id)).catch(() => {});
    });
  }, []);

  // ── Playlist refresh loop ──────────────────────────────────────────────────
  const refreshPlaylist = useCallback(async () => {
    try {
      const payload = await FetchPlaylist();
      if (Array.isArray(payload) && payload.length) {
        const normalized = normalizeAds(payload);
        setAds(normalized);
        setActiveIndex(0);
        setStatus("Playing live playlist");
        setLastRefresh(new Date());
        downloadAssetsInBackground(normalized);
        return;
      }
      setStatus("Playlist empty — showing fallback content");
      setAds(normalizeAds(fallbackAds));
    } catch {
      setStatus("Offline / fetch failed — showing cached playlist");
    }
  }, [downloadAssetsInBackground]);

  useEffect(() => {
    refreshPlaylist();
    const id = window.setInterval(refreshPlaylist, PLAYLIST_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [refreshPlaylist]);

  // ── Carousel advance ───────────────────────────────────────────────────────
  useEffect(() => {
    window.clearTimeout(exitTimer.current);
    window.clearTimeout(advanceTimer.current);

    if (!ads.length) return;

    setIsExiting(false);
    slotStartRef.current = Date.now();

    const ad = ads[activeIndex % ads.length];
    const duration = ad.durationMs ?? DEFAULT_DURATION_MS;

    // Lock in the src for this slot (local cache if ready, otherwise remote).
    setActiveSrc(localSrcsRef.current[ad.id] ?? ad.src);

    exitTimer.current = window.setTimeout(
      () => setIsExiting(true),
      Math.max(duration - EXIT_ANIMATION_MS, 500),
    );
    advanceTimer.current = window.setTimeout(
      // Wrap back to 0 instead of letting the index grow forever so it stays
      // within bounds even when the playlist length changes on the next refresh.
      () => setActiveIndex((i) => (i + 1) % ads.length),
      duration,
    );

    return () => {
      window.clearTimeout(exitTimer.current);
      window.clearTimeout(advanceTimer.current);
    };
  }, [ads, activeIndex]);

  // ── Dev-mode keyboard navigation (← prev, → next) ─────────────────────────
  // Immediately cancels the running timers and jumps to the adjacent ad with a
  // short exit flash so the transition still plays.
  const navigate = useCallback(
    (delta: 1 | -1) => {
      if (!ads.length) return;
      window.clearTimeout(exitTimer.current);
      window.clearTimeout(advanceTimer.current);
      setIsExiting(true);
      advanceTimer.current = window.setTimeout(() => {
        setActiveIndex((i) => (i + delta + ads.length) % ads.length);
      }, EXIT_ANIMATION_MS);
    },
    [ads.length],
  );

  useEffect(() => {
    if (!devMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") navigate(1);
      if (e.key === "ArrowLeft") navigate(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [devMode, navigate]);

  // ── Dev-mode countdown ticker ──────────────────────────────────────────────
  useEffect(() => {
    if (!devMode || !ads.length) return;
    const id = window.setInterval(() => {
      const dur =
        ads[activeIndex % ads.length]?.durationMs ?? DEFAULT_DURATION_MS;
      setMsLeft(Math.max(0, dur - (Date.now() - slotStartRef.current)));
    }, 100);
    return () => window.clearInterval(id);
  }, [devMode, ads, activeIndex]);

  const activeAd = ads.length ? ads[activeIndex % ads.length] : undefined;
  const enterName: TransitionName = activeAd?.transition?.enter ?? "fade";
  const exitName: TransitionName = activeAd?.transition?.exit ?? "fade";

  return (
    <div className="app-shell">
      <div className="ad-viewport">
        {activeAd ? (
          <div
            key={`${activeAd.id}-${activeIndex}`}
            className={`ad-card enter-${enterName} ${isExiting ? `exit-${exitName}` : ""}`.trim()}
          >
            <AdRenderer ad={activeAd} overrideSrc={activeSrc} />
          </div>
        ) : (
          <div className="placeholder">Waiting for playlist…</div>
        )}
      </div>

      {devMode && activeAd ? (
        <DevOverlay
          ad={activeAd}
          index={activeIndex % ads.length}
          total={ads.length}
          msLeft={msLeft}
          status={status}
          lastRefresh={lastRefresh}
          isExiting={isExiting}
          isCached={Boolean(localSrcsRef.current[activeAd.id])}
          activeSrc={activeSrc}
          buildNumber={buildNumber}
          updateInfo={updateInfo}
        />
      ) : (
        <div className="status-bar">
          <span className="status-text">{status}</span>
          <span className="status-count">
            {ads.length
              ? `${(activeIndex % ads.length) + 1} / ${ads.length}`
              : "0 / 0"}
          </span>
        </div>
      )}

      {/* Production: unobtrusive update toast shown briefly while applying */}
      {!devMode && updateInfo?.available && (
        <div className="update-toast">
          Updating to build {updateInfo.latestBuild}…
        </div>
      )}
    </div>
  );
}

export default App;
