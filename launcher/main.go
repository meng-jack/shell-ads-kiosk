package main

import (
	"archive/zip"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/minio/selfupdate"
)

// staticFiles holds the pre-built React dashboard, embedded at compile time
// by CI (which copies dash/dist/ → launcher/static/ before go build).
// No Node.js or npm is needed on the target machine.
//
//go:embed all:static
var staticFiles embed.FS

// ─── Configuration ────────────────────────────────────────────────────────────

const (
	githubOwner = "exoad"
	githubRepo  = "ShellNews-Bernard"
	bundleAsset = "shell-ads-bundle-windows-x64.zip"

	kioskBin = "kiosk.exe"
	dashPort = ":6969"

	// Timing
	updateCheckDelay    = 30 * time.Second
	updateCheckInterval = 1 * time.Hour
	kioskRestartDelay   = 3 * time.Second
	postKillDelay       = 2 * time.Second
)

// BuildNumber is stamped at compile time via -ldflags "-X main.BuildNumber=<n>".
// Stays "dev" for local runs.
var BuildNumber string = "dev"

// ─── GitHub API types ─────────────────────────────────────────────────────────

type ghRelease struct {
	TagName string    `json:"tag_name"`
	HTMLURL string    `json:"html_url"`
	Assets  []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// ─── Kiosk Ad types ───────────────────────────────────────────────────────────
// These mirror the Ad struct in the kiosk's app.go so the playlist endpoint
// returns JSON the kiosk can consume directly.

type adTransition struct {
	Enter string `json:"enter"`
	Exit  string `json:"exit"`
}

type kioskAd struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Type        string       `json:"type"`
	DurationMs  int          `json:"durationMs"`
	Src         string       `json:"src,omitempty"`
	HTML        string       `json:"html,omitempty"`
	Transition  adTransition `json:"transition"`
	SubmittedBy string       `json:"submittedBy,omitempty"`
}

// dashAd is the shape the React dashboard POSTs to /api/force-ads.
type dashAd struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"` // "image" | "video" | "html"
	URL         string `json:"url"`
	DurationSec int    `json:"durationSec"`
	SubmittedBy string `json:"submittedBy"`
}

// ─── Global state ─────────────────────────────────────────────────────────────

var (
	httpClient = &http.Client{Timeout: 60 * time.Second}

	// kiosk process management
	kioskMu        sync.Mutex
	activeKiosk    *exec.Cmd
	kioskPID       int
	kioskStartedAt time.Time
	kioskRestarts  int

	// updating is set to true while a bundle download/apply is in flight.
	// Using atomic.Bool means the check-and-set is a single CPU instruction —
	// no TOCTOU gap where two concurrent callers (two admins, or admin + auto-loop)
	// can both slip past the "already in progress" guard.
	updating atomic.Bool

	// navCmdCh carries "next" or "prev" commands from the admin dashboard.
	navCmdCh = make(chan string, 8)

	// mediaDir is where user-uploaded files are stored and served from.
	mediaDir string

)

// ─── Admin auth ───────────────────────────────────────────────────────────────

// adminPassword is read from the ADMIN_PASSWORD env var at startup.
// Defaults to "shellnews" — always override in production.
var adminPassword = func() string {
	if p := strings.TrimSpace(os.Getenv("ADMIN_PASSWORD")); p != "" {
		return p
	}
	return "theworldstops"
}()

type tokenEntry struct{ expiry time.Time }

var adminTokens sync.Map // string → tokenEntry

// ─── Update status (polled by admin dashboard for live progress) ──────────────

type updateStageInfo struct {
	Stage   string `json:"stage"` // idle|checking|up_to_date|downloading|applying|restarting|error
	Message string `json:"message"`
	Current string `json:"current"` // this binary's build label
	Latest  string `json:"latest"`  // latest GitHub release tag (empty until known)
	ErrMsg  string `json:"error,omitempty"`
}

var (
	updateStatusMu  sync.RWMutex
	updateStatusVal = updateStageInfo{Stage: "idle", Current: BuildNumber}
)

func setUpdateStage(stage, message, latest, errMsg string) {
	updateStatusMu.Lock()
	updateStatusVal = updateStageInfo{
		Stage:   stage,
		Message: message,
		Current: BuildNumber,
		Latest:  latest,
		ErrMsg:  errMsg,
	}
	updateStatusMu.Unlock()
	log.Printf("Update [%s] %s", stage, message)
}

func generateToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func isValidToken(token string) bool {
	if token == "" {
		return false
	}
	v, ok := adminTokens.Load(token)
	if !ok {
		return false
	}
	if time.Now().After(v.(tokenEntry).expiry) {
		adminTokens.Delete(token)
		return false
	}
	return true
}

func requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !isValidToken(token) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}
		next(w, r)
	}
}

// cleanupTokens purges expired tokens every 15 minutes so the sync.Map
// doesn't grow unboundedly when many admins log in over a long run.
func cleanupTokens() {
	for {
		time.Sleep(15 * time.Minute)
		now := time.Now()
		adminTokens.Range(func(k, v any) bool {
			if now.After(v.(tokenEntry).expiry) {
				adminTokens.Delete(k)
			}
			return true
		})
	}
}

// ─── Entry point ──────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.Ltime | log.Lshortfile)
	log.Printf("Shell Ads Launcher — build=%s", BuildNumber)
	if adminPassword == "theworldstops" {
		log.Printf("Admin: using default password")
	}

	exeDir := exeDirectory()
	log.Printf("Base directory: %s", exeDir)

	// 1. Initialise the media cache directory (must happen before initDB and
	//    before any ad handler can call downloadToMedia or deleteMediaFile).
	mediaDir = filepath.Join(exeDir, "media")
	_ = os.MkdirAll(mediaDir, 0o755)

	// 2. Bootstrap PocketBase (SQLite persistence).  This is synchronous —
	//    all handlers are safe to use only after this returns.
	if err := initDB(); err != nil {
		log.Fatalf("Database: %v", err)
	}

	// 3. Serve the embedded React dashboard — no Node/npm needed on the machine
	go serveDash()

	// 4. Periodically purge expired admin tokens (prevents unbounded growth
	//    when many admins log in and out over a long run).
	go cleanupTokens()

	// 5. Launch the kiosk and restart it if it ever exits unexpectedly
	go monitorKiosk(filepath.Join(exeDir, kioskBin))

	// 6. Periodically check GitHub for a newer build and apply it
	go updateLoop(exeDir)

	// Block main goroutine forever
	select {}
}

// ─── Dashboard server ─────────────────────────────────────────────────────────

// spaHandler wraps a file server so any path that doesn't match a real file
// falls back to index.html — required for React Router client-side routing.
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if f, err := fsys.Open(name); err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// Unknown path → serve index.html so React Router handles it
		http.ServeFileFS(w, r, fsys, "index.html")
	})
}

// corsMiddleware adds permissive CORS headers to every response and handles
// pre-flight OPTIONS requests. This is needed because the Wails WebView has a
// different origin than the launcher HTTP server (localhost:6969), so any
// non-simple request (e.g. POST with Content-Type: image/jpeg) would be
// blocked without the correct Access-Control headers.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Expose-Headers", "X-Screenshot-At")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func serveDash() {
	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatalf("Dashboard: embed FS error: %v", err)
	}

	mux := http.NewServeMux()

	// ── Public API ────────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/submit-ads", handleSubmitAds)
	mux.HandleFunc("POST /api/activate", handleActivate)
	mux.HandleFunc("GET /api/playlist", handlePlaylist)
	mux.HandleFunc("GET /api/kiosk/nav-poll", handleNavPoll)    // kiosk long-polls this
	mux.HandleFunc("GET /api/submission-status", handleSubmissionStatus)  // public: poll ad status by IDs

	// ── Serve locally-cached media files ──────────────────────────────────────────
	mux.Handle("/media/", http.StripPrefix("/media/", http.FileServer(http.Dir(mediaDir))))

	// ── Admin auth ────────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/admin/auth", handleAdminAuth)

	// ── Admin protected ───────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/admin/state", requireAdmin(handleAdminState))
	mux.HandleFunc("GET /api/admin/stats", requireAdmin(handleAdminStats))
	mux.HandleFunc("PUT /api/admin/reorder", requireAdmin(handleAdminReorder))
	mux.HandleFunc("DELETE /api/admin/active/{id}", requireAdmin(handleAdminDeleteActive))
	mux.HandleFunc("DELETE /api/admin/submitted/{id}", requireAdmin(handleAdminDeleteSubmitted))
	mux.HandleFunc("DELETE /api/admin/approved/{id}", requireAdmin(handleAdminDeleteApproved))
	mux.HandleFunc("DELETE /api/admin/denied/{id}", requireAdmin(handleAdminDeleteDenied))
	mux.HandleFunc("POST /api/admin/submitted/{id}/approve", requireAdmin(handleAdminApproveSubmitted))
	mux.HandleFunc("POST /api/admin/approved/{id}/activate", requireAdmin(handleAdminActivateApproved))
	mux.HandleFunc("POST /api/admin/active/{id}/deactivate", requireAdmin(handleAdminDeactivateActive))
	mux.HandleFunc("POST /api/admin/clear", requireAdmin(handleAdminClearActive))
	mux.HandleFunc("POST /api/admin/reload", requireAdmin(handleAdminReload))
	mux.HandleFunc("POST /api/admin/restart-kiosk", requireAdmin(handleAdminRestartKiosk))
	mux.HandleFunc("POST /api/admin/kiosk/next", requireAdmin(handleAdminKioskNext))
	mux.HandleFunc("POST /api/admin/kiosk/prev", requireAdmin(handleAdminKioskPrev))
	mux.HandleFunc("POST /api/admin/trigger-update", requireAdmin(handleAdminTriggerUpdate))
	mux.HandleFunc("GET /api/admin/update-status", requireAdmin(handleAdminUpdateStatus))
	mux.HandleFunc("GET /api/admin/kiosk-screenshot", requireAdmin(handleAdminKioskScreenshot))
	mux.HandleFunc("DELETE /api/admin/logout", requireAdmin(handleAdminLogout))

	// ── SPA fallback ──────────────────────────────────────────────────────────
	mux.Handle("/", spaHandler(sub))

	log.Printf("Dashboard: http://localhost%s  |  Admin: http://localhost%s/admin", dashPort, dashPort)
	if err := http.ListenAndServe(dashPort, corsMiddleware(mux)); err != nil {
		log.Fatalf("Dashboard server: %v", err)
	}
}

// downloadToMedia fetches a remote URL and saves it under mediaDir using the
// ad's ID as the base filename, preserving the original extension.
// Returns the "/media/<file>" path on success, or the original URL on failure
// so the ad always has a usable src even if the download fails.
// It is safe to call from multiple goroutines concurrently.
func downloadToMedia(adID, rawURL string) string {
	if mediaDir == "" || rawURL == "" {
		return rawURL
	}
	// Only pull http/https resources.
	if !strings.HasPrefix(rawURL, "http://") && !strings.HasPrefix(rawURL, "https://") {
		return rawURL
	}
	ext := strings.ToLower(filepath.Ext(strings.SplitN(rawURL, "?", 2)[0]))
	allowed := map[string]bool{
		".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".gif": true,
		".mp4": true, ".webm": true,
		".html": true, ".htm": true,
	}
	if !allowed[ext] {
		// Unknown extension — fall back to original URL so the kiosk can still try.
		return rawURL
	}

	safe := func() string {
		var b strings.Builder
		for _, r := range adID {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
				b.WriteRune(r)
			} else {
				b.WriteRune('_')
			}
		}
		return b.String()
	}()

	destPath := filepath.Join(mediaDir, safe+ext)

	// If already cached, return immediately.
	if _, err := os.Stat(destPath); err == nil {
		log.Printf("Media: %s already cached, skipping download", safe+ext)
		return "/media/" + safe + ext
	}

	log.Printf("Media: downloading %s → %s", rawURL, safe+ext)
	req, err := http.NewRequest(http.MethodGet, rawURL, nil)
	if err != nil {
		log.Printf("Media: build request failed: %v", err)
		return rawURL
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		log.Printf("Media: download failed: %v", err)
		return rawURL
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		log.Printf("Media: server returned %s for %s", resp.Status, rawURL)
		return rawURL
	}

	// Write to temp file then atomically rename.
	tmp, err := os.CreateTemp(mediaDir, "dl-*")
	if err != nil {
		log.Printf("Media: create temp: %v", err)
		return rawURL
	}
	tmpName := tmp.Name()
	_, copyErr := io.Copy(tmp, resp.Body)
	tmp.Close()
	if copyErr != nil {
		os.Remove(tmpName)
		log.Printf("Media: write failed: %v", copyErr)
		return rawURL
	}
	if err := os.Rename(tmpName, destPath); err != nil {
		os.Remove(tmpName)
		log.Printf("Media: rename failed: %v", err)
		return rawURL
	}
	log.Printf("Media: cached %s", safe+ext)
	return "/media/" + safe + ext
}

// handleSubmitAds queues incoming ads as "submitted" — not visible to the kiosk
// until an admin approves them AND either the Z key is pressed or reload is called.
func handleSubmitAds(w http.ResponseWriter, r *http.Request) {
	var incoming []dashAd
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, "bad JSON", http.StatusBadRequest)
		return
	}

	for _, d := range incoming {
		ad := kioskAd{
			ID:          d.ID,
			Name:        d.Name,
			Type:        d.Type,
			DurationMs:  d.DurationSec * 1000,
			Src:         d.URL,
			Transition:  adTransition{Enter: "fade", Exit: "fade"},
			SubmittedBy: d.SubmittedBy,
		}
		if err := dbSaveAd(ad, d.URL); err != nil {
			log.Printf("Submit: failed to save ad %q: %v", d.ID, err)
			continue
		}
		// Download remote file to /media/ in the background so the kiosk always
		// plays from local storage and file.io one-time links don’t expire.
		if d.URL != "" && !strings.HasPrefix(d.URL, "/media/") {
			go func(id, src string) {
				newSrc := downloadToMedia(id, src)
				if newSrc != src {
					dbUpdateSrc(id, newSrc)
					log.Printf("Submit: ad %q media cached as %s", id, newSrc)
				}
			}(d.ID, d.URL)
		}
	}

	log.Printf("Submit: %d ad(s) queued for admin review", len(incoming))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

// handleActivate is called by the kiosk Z-key.
// It moves ONLY admin-approved ads into the live playlist.
func handleActivate(w http.ResponseWriter, r *http.Request) {
	activated := dbMoveApprovedToLive()
	log.Printf("Activate (Z-key): %d approved ad(s) → live", activated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "activated": activated})
}

// handlePlaylist serves the current active (live) playlist as JSON.
// The kiosk’s PLAYLIST_URL points at this endpoint.
func handlePlaylist(w http.ResponseWriter, r *http.Request) {
	ads := dbLiveOrdered()

	// Resolve /media/ relative paths to absolute localhost URLs so the kiosk
	// HTTP client can download them.
	resolved := make([]kioskAd, len(ads))
	for i, ad := range ads {
		if strings.HasPrefix(ad.Src, "/media/") {
			ad.Src = "http://localhost" + dashPort + ad.Src
		}
		resolved[i] = ad
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resolved)
}

// ─── Admin API handlers ───────────────────────────────────────────────────────

func handleAdminAuth(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad JSON", http.StatusBadRequest)
		return
	}
	if body.Password != adminPassword {
		http.Error(w, `{"error":"wrong password"}`, http.StatusUnauthorized)
		return
	}
	token := generateToken()
	adminTokens.Store(token, tokenEntry{expiry: time.Now().Add(24 * time.Hour)})
	log.Printf("Admin: login")
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"token": token})
}

func handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	adminTokens.Delete(token)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminState(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"active":    dbLiveOrdered(),
		"approved":  dbByStatus(adStatusApproved),
		"submitted": dbByStatus(adStatusSubmitted),
		"denied":    dbByStatus(adStatusDenied),
	})
}

func handleAdminStats(w http.ResponseWriter, r *http.Request) {
	kioskMu.Lock()
	pid := kioskPID
	startedAt := kioskStartedAt
	restarts := kioskRestarts
	running := activeKiosk != nil && activeKiosk.Process != nil
	kioskMu.Unlock()

	counts := dbCounts()

	var uptimeSec float64
	if running && !startedAt.IsZero() {
		uptimeSec = time.Since(startedAt).Seconds()
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"kiosk": map[string]any{
			"running":   running,
			"pid":       pid,
			"uptimeSec": uptimeSec,
			"restarts":  restarts,
		},
		"playlist": map[string]any{
			"active":    counts[adStatusLive],
			"approved":  counts[adStatusApproved],
			"submitted": counts[adStatusSubmitted],
			"denied":    counts[adStatusDenied],
		},
		"build":    BuildNumber,
		"updating": updating.Load(),
	})
}

func handleAdminReorder(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad JSON", http.StatusBadRequest)
		return
	}
	if err := dbReorderLive(body.IDs); err != nil {
		http.Error(w, "reorder failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminDeleteActive(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	src, found := dbDelete(id)
	if !found {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	deleteMediaFile(src)
	log.Printf("Admin: deleted live ad %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminDeleteSubmitted(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	// Move to denied (keep record for submitter status polling).
	if !dbSetStatus(id, adStatusDenied) {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	log.Printf("Admin: denied submitted ad %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminDeleteApproved(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	src, found := dbDelete(id)
	if !found {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	deleteMediaFile(src)
	log.Printf("Admin: deleted approved ad %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// handleAdminDeleteDenied permanently removes a denied ad from the database
// and deletes its cached media file from disk.
func handleAdminDeleteDenied(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	src, found := dbDelete(id)
	if !found {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	deleteMediaFile(src)
	log.Printf("Admin: permanently deleted denied ad %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// handleSubmissionStatus is a public endpoint that lets submitters poll the
// current status of their ads by ID.
func handleSubmissionStatus(w http.ResponseWriter, r *http.Request) {
	raw := strings.TrimSpace(r.URL.Query().Get("ids"))
	if raw == "" {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]any{})
		return
	}
	ids := strings.Split(raw, ",")
	statusMap := dbAllStatuses()

	type item struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	}
	out := make([]item, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		st, ok := statusMap[id]
		if !ok {
			st = "unknown"
		}
		out = append(out, item{ID: id, Status: st})
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(out)
}

// captureDesktopScreenshot takes a JPEG screenshot of the current desktop by
// trying several common screenshot tools in order. Returns the raw JPEG bytes
// and the time the shot was taken.
func captureDesktopScreenshot() ([]byte, time.Time, error) {
	now := time.Now()
	tmp := filepath.Join(os.TempDir(), fmt.Sprintf("shellnews_shot_%d.jpg", os.Getpid()))
	defer os.Remove(tmp)

	type toolDef struct {
		name string
		args []string
	}
	tools := []toolDef{
		{"scrot", []string{"-q", "70", tmp}},
		{"import", []string{"-window", "root", "-quality", "70", tmp}},
		{"ffmpeg", []string{"-y", "-f", "x11grab", "-i", ":0.0", "-frames:v", "1", "-qscale:v", "8", tmp}},
	}
	for _, t := range tools {
		cmd := exec.Command(t.name, t.args...)
		cmd.Env = os.Environ() // inherit DISPLAY, XAUTHORITY, etc.
		if err := cmd.Run(); err == nil {
			data, err := os.ReadFile(tmp)
			if err == nil && len(data) > 0 {
				return data, now, nil
			}
		}
	}
	return nil, now, fmt.Errorf("no screenshot tool found; tried scrot, import (ImageMagick), ffmpeg")
}

// handleAdminKioskScreenshot captures the current desktop and serves it as a JPEG.
// Returns 204 No Content when no screenshot tool is available.
func handleAdminKioskScreenshot(w http.ResponseWriter, r *http.Request) {
	data, at, err := captureDesktopScreenshot()
	if err != nil {
		log.Printf("Screenshot: %v", err)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("X-Screenshot-At", at.UTC().Format(time.RFC3339))
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func handleAdminApproveSubmitted(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !dbSetStatus(id, adStatusApproved) {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	log.Printf("Admin: approved submitted ad %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminActivateApproved(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !dbMoveToLive(id) {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	log.Printf("Admin: activated approved ad %q → live", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// handleAdminDeactivateActive moves a live ad back to the approved (unused) queue.
func handleAdminDeactivateActive(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !dbMoveBackToApproved(id) {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	log.Printf("Admin: deactivated live ad %q → approved (unused)", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminClearActive(w http.ResponseWriter, r *http.Request) {
	cleared, n := dbClearLive()
	for _, ad := range cleared {
		deleteMediaFile(ad.Src)
	}
	log.Printf("Admin: cleared %d live ad(s) from machine", n)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "cleared": n})
}

// handleAdminReload moves all approved ads → live then signals the kiosk.
func handleAdminReload(w http.ResponseWriter, r *http.Request) {
	activated := dbMoveApprovedToLive()
	log.Printf("Admin: reload — %d approved ad(s) pushed live", activated)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "activated": activated})
}

func handleAdminRestartKiosk(w http.ResponseWriter, r *http.Request) {
	log.Printf("Admin: restart kiosk requested")
	// stopKiosk kills the process; monitorKiosk will restart it automatically.
	stopKiosk()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// handleNavPoll is called by the kiosk frontend every ~1 s.
// It blocks up to 2 s waiting for a nav command, then returns.
// Response: {"cmd":"next"}, {"cmd":"prev"}, or {"cmd":"none"}.
func handleNavPoll(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	select {
	case cmd := <-navCmdCh:
		_ = json.NewEncoder(w).Encode(map[string]string{"cmd": cmd})
	case <-time.After(2 * time.Second):
		_ = json.NewEncoder(w).Encode(map[string]string{"cmd": "none"})
	}
}

func handleAdminKioskNext(w http.ResponseWriter, r *http.Request) {
	select {
	case navCmdCh <- "next":
	default: // channel full — drop silently
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminKioskPrev(w http.ResponseWriter, r *http.Request) {
	select {
	case navCmdCh <- "prev":
	default:
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminTriggerUpdate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if BuildNumber == "dev" {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "reason": "dev build — updates disabled"})
		return
	}
	if updating.Load() {
		_ = json.NewEncoder(w).Encode(map[string]any{"ok": false, "reason": "update already in progress"})
		return
	}
	exeDir := exeDirectory()
	go func() {
		if err := checkAndApply(exeDir); err != nil {
			log.Printf("Admin trigger-update: %v", err)
		}
	}()
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func handleAdminUpdateStatus(w http.ResponseWriter, r *http.Request) {
	updateStatusMu.RLock()
	s := updateStatusVal
	updateStatusMu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(s)
}

func monitorKiosk(path string) {
	for {
		// Stand down while an update is replacing binaries
		if updating.Load() {
			time.Sleep(time.Second)
			continue
		}

		cmd := exec.Command(path)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		// Point the kiosk at the launcher's local playlist endpoint.
		// Force-loaded ads from the dashboard Z-button are served here.
		cmd.Env = append(os.Environ(), "PLAYLIST_URL=http://localhost:6969/api/playlist")

		kioskMu.Lock()
		activeKiosk = cmd
		kioskMu.Unlock()

		if err := cmd.Start(); err != nil {
			log.Printf("Kiosk: failed to start: %v — retry in %s", err, kioskRestartDelay)
			time.Sleep(kioskRestartDelay)
			continue
		}

		kioskMu.Lock()
		kioskPID = cmd.Process.Pid
		kioskStartedAt = time.Now()
		kioskRestarts++
		kioskMu.Unlock()
		log.Printf("Kiosk: started (pid %d, restart #%d)", cmd.Process.Pid, kioskRestarts)

		_ = cmd.Wait()
		kioskMu.Lock()
		kioskPID = 0
		kioskMu.Unlock()
		log.Printf("Kiosk: exited — restarting in %s", kioskRestartDelay)
		time.Sleep(kioskRestartDelay)
	}
}

// stopKiosk kills the running kiosk process and waits for it to fully exit.
func stopKiosk() {
	kioskMu.Lock()
	defer kioskMu.Unlock()
	if activeKiosk != nil && activeKiosk.Process != nil {
		log.Printf("Kiosk: stopping (pid %d) for update", activeKiosk.Process.Pid)
		_ = activeKiosk.Process.Kill()
		_ = activeKiosk.Wait()
		activeKiosk = nil
	}
}

// ─── Update loop ──────────────────────────────────────────────────────────────

func updateLoop(exeDir string) {
	if BuildNumber == "dev" {
		log.Printf("Updater: dev build — auto-update disabled")
		return
	}

	log.Printf("Updater: first check in %s", updateCheckDelay)
	time.Sleep(updateCheckDelay)

	for {
		if err := checkAndApply(exeDir); err != nil {
			log.Printf("Updater: %v", err)
		}
		log.Printf("Updater: next check in %s", updateCheckInterval)
		time.Sleep(updateCheckInterval)
	}
}

func currentBuildInt() int {
	n, _ := strconv.Atoi(strings.TrimSpace(BuildNumber))
	return n
}

// ─── GitHub release helpers ───────────────────────────────────────────────────

func fetchLatestRelease() (*ghRelease, error) {
	url := fmt.Sprintf(
		"https://api.github.com/repos/%s/%s/releases/latest",
		githubOwner, githubRepo,
	)
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "ShellNews-Bernard-launcher/"+BuildNumber)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub API: %s", resp.Status)
	}
	var r ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return nil, err
	}
	return &r, nil
}

// ─── Check & apply update ────────────────────────────────────────────────────

func checkAndApply(exeDir string) error {
	// CompareAndSwap: atomically transitions false→true.
	// If it returns false, another goroutine (another admin, or the auto-loop)
	// already owns the update slot — bail out immediately.
	if !updating.CompareAndSwap(false, true) {
		setUpdateStage("error", "An update is already in progress.", "", "update already in progress")
		return fmt.Errorf("update already in progress")
	}
	defer updating.Store(false)

	setUpdateStage("checking", "Checking GitHub for a newer build…", "", "")

	release, err := fetchLatestRelease()
	if err != nil {
		setUpdateStage("error", "Could not reach GitHub.", "", err.Error())
		return fmt.Errorf("fetch release: %w", err)
	}
	if release == nil {
		setUpdateStage("up_to_date", "No releases found on GitHub.", "", "")
		log.Printf("Updater: no releases found")
		return nil
	}

	latestBuild := 0
	latestTag := release.TagName
	if after, ok := strings.CutPrefix(release.TagName, "build-"); ok {
		latestBuild, _ = strconv.Atoi(after)
	}

	currentBuild := currentBuildInt()
	if latestBuild <= currentBuild {
		setUpdateStage("up_to_date",
			fmt.Sprintf("Already on the latest build (%s).", BuildNumber),
			latestTag, "")
		log.Printf("Updater: up to date (build %d)", currentBuild)
		return nil
	}

	log.Printf("Updater: update available build-%d → build-%d", currentBuild, latestBuild)

	var downloadURL string
	for _, a := range release.Assets {
		if a.Name == bundleAsset {
			downloadURL = a.BrowserDownloadURL
			break
		}
	}
	if downloadURL == "" {
		e := fmt.Errorf("asset %q not found in release %s", bundleAsset, latestTag)
		setUpdateStage("error", e.Error(), latestTag, e.Error())
		return e
	}

	return applyUpdate(exeDir, downloadURL, latestTag)
}

func applyUpdate(exeDir, downloadURL, latestTag string) error {
	// Note: the updating flag is already set by checkAndApply — do not touch it here.

	// ── 1. Download bundle zip ───────────────────────────────────────────────
	setUpdateStage("downloading", fmt.Sprintf("Downloading %s…", latestTag), latestTag, "")
	log.Printf("Updater: downloading %s", downloadURL)

	tmpZip, err := os.CreateTemp("", "shell-ads-bundle-*.zip")
	if err != nil {
		setUpdateStage("error", "Could not create temp file.", latestTag, err.Error())
		return fmt.Errorf("create temp file: %w", err)
	}
	defer os.Remove(tmpZip.Name())

	req, _ := http.NewRequest(http.MethodGet, downloadURL, nil)
	req.Header.Set("User-Agent", "ShellNews-Bernard-launcher/"+BuildNumber)

	resp, err := httpClient.Do(req)
	if err != nil {
		setUpdateStage("error", "Download failed.", latestTag, err.Error())
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		e := fmt.Errorf("download HTTP %s", resp.Status)
		setUpdateStage("error", e.Error(), latestTag, e.Error())
		return e
	}

	if _, err := io.Copy(tmpZip, resp.Body); err != nil {
		setUpdateStage("error", "Failed writing download.", latestTag, err.Error())
		return fmt.Errorf("write zip: %w", err)
	}
	tmpZip.Close()
	log.Printf("Updater: download complete")

	// ── 2. Extract to temp dir ───────────────────────────────────────────────
	setUpdateStage("applying", fmt.Sprintf("Installing %s…", latestTag), latestTag, "")

	tmpDir, err := os.MkdirTemp("", "shell-ads-update-*")
	if err != nil {
		setUpdateStage("error", "Could not create temp dir.", latestTag, err.Error())
		return fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	if err := extractZip(tmpZip.Name(), tmpDir); err != nil {
		setUpdateStage("error", "Failed extracting bundle.", latestTag, err.Error())
		return fmt.Errorf("extract zip: %w", err)
	}
	log.Printf("Updater: extracted bundle")

	// ── 3. Stop kiosk, replace kiosk.exe ────────────────────────────────────
	stopKiosk()
	time.Sleep(postKillDelay)

	newKiosk := filepath.Join(tmpDir, "kiosk.exe")
	if _, err := os.Stat(newKiosk); err == nil {
		if err := copyFile(newKiosk, filepath.Join(exeDir, "kiosk.exe")); err != nil {
			setUpdateStage("error", "Failed replacing kiosk.exe.", latestTag, err.Error())
			return fmt.Errorf("replace kiosk.exe: %w", err)
		}
		log.Printf("Updater: kiosk.exe replaced")
	}

	// ── 4. Self-update launcher.exe ──────────────────────────────────────────
	newLauncher := filepath.Join(tmpDir, "launcher.exe")
	launcherFile, err := os.Open(newLauncher)
	if err != nil {
		log.Printf("Updater: launcher.exe not in bundle — skipping self-update")
		setUpdateStage("up_to_date", fmt.Sprintf("kiosk.exe updated to %s (launcher unchanged).", latestTag), latestTag, "")
		return nil
	}
	defer launcherFile.Close()

	log.Printf("Updater: applying self-update to launcher.exe…")
	if err := selfupdate.Apply(launcherFile, selfupdate.Options{}); err != nil {
		log.Printf("Updater: self-update failed: %v — continuing", err)
		setUpdateStage("error", "Self-update failed: "+err.Error(), latestTag, err.Error())
		return nil
	}

	setUpdateStage("restarting", fmt.Sprintf("Restarting with %s…", latestTag), latestTag, "")
	log.Printf("Updater: restarting launcher…")
	log.Printf("Updater: restarting launcher...")
	newCmd := exec.Command(os.Args[0], os.Args[1:]...)
	newCmd.Stdout = os.Stdout
	newCmd.Stderr = os.Stderr
	if err := newCmd.Start(); err != nil {
		log.Printf("Updater: failed to spawn updated launcher: %v — continuing", err)
		return nil
	}
	os.Exit(0)
	return nil // unreachable
}

// ─── Filesystem helpers ───────────────────────────────────────────────────────

func exeDirectory() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

func extractZip(src, dst string) error {
	r, err := zip.OpenReader(src)
	if err != nil {
		return err
	}
	defer r.Close()

	dstPrefix := filepath.Clean(dst) + string(os.PathSeparator)

	for _, f := range r.File {
		target := filepath.Join(dst, filepath.FromSlash(f.Name))

		// Zip-slip protection
		if !strings.HasPrefix(filepath.Clean(target)+string(os.PathSeparator), dstPrefix) {
			return fmt.Errorf("zip-slip detected for path: %s", f.Name)
		}

		if f.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
			continue
		}

		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}

		if err := func() error {
			rc, err := f.Open()
			if err != nil {
				return err
			}
			defer rc.Close()

			out, err := os.Create(target)
			if err != nil {
				return err
			}
			defer out.Close()

			_, err = io.Copy(out, rc)
			return err
		}(); err != nil {
			return err
		}
	}
	return nil
}
