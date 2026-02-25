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
	ID         string       `json:"id"`
	Name       string       `json:"name"`
	Type       string       `json:"type"`
	DurationMs int          `json:"durationMs"`
	Src        string       `json:"src,omitempty"`
	HTML       string       `json:"html,omitempty"`
	Transition adTransition `json:"transition"`
}

// dashAd is the shape the React dashboard POSTs to /api/force-ads.
type dashAd struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Type        string `json:"type"` // "image" | "video" | "html"
	URL         string `json:"url"`
	DurationSec int    `json:"durationSec"`
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

	// pauses the kiosk monitor loop while an update is in flight
	updateMu sync.RWMutex
	updating bool

	// Three-stage ad pipeline:
	//   submitted  — just received from dashboard, not yet reviewed
	//   approvedAds — admin has approved, waiting for Z-key / reload to go live
	//   forcedAds  — currently live, served to kiosk via /api/playlist
	playlistMu   sync.RWMutex
	submittedAds []kioskAd
	approvedAds  []kioskAd
	forcedAds    []kioskAd
)

// ─── Admin auth ───────────────────────────────────────────────────────────────

// adminPassword is read from the ADMIN_PASSWORD env var at startup.
// Defaults to "shellnews" — always override in production.
var adminPassword = func() string {
	if p := strings.TrimSpace(os.Getenv("ADMIN_PASSWORD")); p != "" {
		return p
	}
	return "iloveblackrock"
}()

type tokenEntry struct{ expiry time.Time }

var adminTokens sync.Map // string → tokenEntry

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

// ─── Entry point ──────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.Ltime | log.Lshortfile)
	log.Printf("Shell Ads Launcher — build=%s", BuildNumber)
	if adminPassword == "iloveblackrock" {
		log.Printf("Admin: using default password")
	}

	exeDir := exeDirectory()
	log.Printf("Base directory: %s", exeDir)

	// 1. Serve the embedded React dashboard — no Node/npm needed on the machine
	go serveDash()

	// 2. Launch the kiosk and restart it if it ever exits unexpectedly
	go monitorKiosk(filepath.Join(exeDir, kioskBin))

	// 3. Periodically check GitHub for a newer build and apply it
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

	// ── Admin auth ────────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/admin/auth", handleAdminAuth)

	// ── Admin protected ───────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/admin/state", requireAdmin(handleAdminState))
	mux.HandleFunc("GET /api/admin/stats", requireAdmin(handleAdminStats))
	mux.HandleFunc("PUT /api/admin/reorder", requireAdmin(handleAdminReorder))
	mux.HandleFunc("DELETE /api/admin/active/{id}", requireAdmin(handleAdminDeleteActive))
	mux.HandleFunc("DELETE /api/admin/submitted/{id}", requireAdmin(handleAdminDeleteSubmitted))
	mux.HandleFunc("DELETE /api/admin/approved/{id}", requireAdmin(handleAdminDeleteApproved))
	mux.HandleFunc("POST /api/admin/submitted/{id}/approve", requireAdmin(handleAdminApproveSubmitted))
	mux.HandleFunc("POST /api/admin/approved/{id}/activate", requireAdmin(handleAdminActivateApproved))
	mux.HandleFunc("POST /api/admin/clear", requireAdmin(handleAdminClearActive))
	mux.HandleFunc("POST /api/admin/reload", requireAdmin(handleAdminReload))
	mux.HandleFunc("POST /api/admin/restart-kiosk", requireAdmin(handleAdminRestartKiosk))
	mux.HandleFunc("DELETE /api/admin/logout", requireAdmin(handleAdminLogout))

	// ── SPA fallback ──────────────────────────────────────────────────────────
	mux.Handle("/", spaHandler(sub))

	log.Printf("Dashboard: http://localhost%s  |  Admin: http://localhost%s/admin", dashPort, dashPort)
	if err := http.ListenAndServe(dashPort, mux); err != nil {
		log.Fatalf("Dashboard server: %v", err)
	}
}

// handleSubmitAds queues incoming ads as "submitted" — not visible to the kiosk
// until an admin approves them AND either the Z key is pressed or reload is called.
func handleSubmitAds(w http.ResponseWriter, r *http.Request) {
	var incoming []dashAd
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, "bad JSON", http.StatusBadRequest)
		return
	}

	ads := make([]kioskAd, 0, len(incoming))
	for _, d := range incoming {
		ad := kioskAd{
			ID:         d.ID,
			Name:       d.Name,
			Type:       d.Type,
			DurationMs: d.DurationSec * 1000,
			Src:        d.URL,
			Transition: adTransition{Enter: "fade", Exit: "fade"},
		}
		ads = append(ads, ad)
	}

	playlistMu.Lock()
	submittedAds = append(submittedAds, ads...)
	playlistMu.Unlock()

	log.Printf("Submit: %d ad(s) queued for admin review (total submitted: %d)", len(ads), len(submittedAds))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "submitted": len(submittedAds)})
}

// handleActivate is called by the kiosk Z-key.
// It moves ONLY admin-approved ads into the live playlist.
// Submitted-but-not-approved ads are never touched here.
func handleActivate(w http.ResponseWriter, r *http.Request) {
	playlistMu.Lock()
	forcedAds = append(forcedAds, approvedAds...)
	activated := len(approvedAds)
	approvedAds = nil
	playlistMu.Unlock()

	log.Printf("Activate (Z-key): %d approved ad(s) → live (total live: %d)", activated, len(forcedAds))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "activated": activated, "total": len(forcedAds)})
}

// handlePlaylist serves the current active playlist as JSON.
// The kiosk's PLAYLIST_URL points at this endpoint.
func handlePlaylist(w http.ResponseWriter, r *http.Request) {
	playlistMu.RLock()
	ads := forcedAds
	playlistMu.RUnlock()

	if ads == nil {
		ads = []kioskAd{}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(ads)
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
	playlistMu.RLock()
	active := forcedAds
	approved := approvedAds
	submitted := submittedAds
	playlistMu.RUnlock()

	if active == nil {
		active = []kioskAd{}
	}
	if approved == nil {
		approved = []kioskAd{}
	}
	if submitted == nil {
		submitted = []kioskAd{}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"active":    active,
		"approved":  approved,
		"submitted": submitted,
	})
}

func handleAdminStats(w http.ResponseWriter, r *http.Request) {
	kioskMu.Lock()
	pid := kioskPID
	startedAt := kioskStartedAt
	restarts := kioskRestarts
	running := activeKiosk != nil && activeKiosk.Process != nil
	kioskMu.Unlock()

	playlistMu.RLock()
	nActive := len(forcedAds)
	nApproved := len(approvedAds)
	nSubmitted := len(submittedAds)
	playlistMu.RUnlock()

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
			"active":    nActive,
			"approved":  nApproved,
			"submitted": nSubmitted,
		},
		"build": BuildNumber,
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
	playlistMu.Lock()
	adMap := make(map[string]kioskAd, len(forcedAds))
	for _, a := range forcedAds {
		adMap[a.ID] = a
	}
	newOrder := make([]kioskAd, 0, len(forcedAds))
	seen := make(map[string]bool)
	for _, id := range body.IDs {
		if a, ok := adMap[id]; ok {
			newOrder = append(newOrder, a)
			seen[id] = true
		}
	}
	for _, a := range forcedAds {
		if !seen[a.ID] {
			newOrder = append(newOrder, a)
		}
	}
	forcedAds = newOrder
	playlistMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminDeleteActive(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	playlistMu.Lock()
	n := forcedAds[:0:0]
	for _, a := range forcedAds {
		if a.ID != id {
			n = append(n, a)
		}
	}
	forcedAds = n
	playlistMu.Unlock()
	log.Printf("Admin: removed active %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminDeleteSubmitted(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	playlistMu.Lock()
	n := submittedAds[:0:0]
	for _, a := range submittedAds {
		if a.ID != id {
			n = append(n, a)
		}
	}
	submittedAds = n
	playlistMu.Unlock()
	log.Printf("Admin: rejected submitted %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminDeleteApproved(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	playlistMu.Lock()
	n := approvedAds[:0:0]
	for _, a := range approvedAds {
		if a.ID != id {
			n = append(n, a)
		}
	}
	approvedAds = n
	playlistMu.Unlock()
	log.Printf("Admin: removed approved %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminApproveSubmitted(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	playlistMu.Lock()
	remaining := submittedAds[:0:0]
	for _, a := range submittedAds {
		if a.ID == id {
			approvedAds = append(approvedAds, a)
		} else {
			remaining = append(remaining, a)
		}
	}
	submittedAds = remaining
	playlistMu.Unlock()
	log.Printf("Admin: approved submitted %q → approved queue", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminActivateApproved(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	playlistMu.Lock()
	remaining := approvedAds[:0:0]
	for _, a := range approvedAds {
		if a.ID == id {
			forcedAds = append(forcedAds, a)
		} else {
			remaining = append(remaining, a)
		}
	}
	approvedAds = remaining
	playlistMu.Unlock()
	log.Printf("Admin: activated approved %q → live", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminClearActive(w http.ResponseWriter, r *http.Request) {
	playlistMu.Lock()
	n := len(forcedAds)
	forcedAds = nil
	playlistMu.Unlock()
	log.Printf("Admin: cleared %d active ad(s)", n)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "cleared": n})
}

// handleAdminReload moves all approved ads → live (same as Z-key) then signals
// the kiosk. The kiosk will pick up the new playlist on its next poll (≤60s).
func handleAdminReload(w http.ResponseWriter, r *http.Request) {
	playlistMu.Lock()
	forcedAds = append(forcedAds, approvedAds...)
	activated := len(approvedAds)
	approvedAds = nil
	playlistMu.Unlock()
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

// ─── Kiosk process management ─────────────────────────────────────────────────

func monitorKiosk(path string) {
	for {
		// Stand down while an update is replacing binaries
		updateMu.RLock()
		busy := updating
		updateMu.RUnlock()
		if busy {
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
	release, err := fetchLatestRelease()
	if err != nil {
		return fmt.Errorf("fetch release: %w", err)
	}
	if release == nil {
		log.Printf("Updater: no releases found")
		return nil
	}

	// Tag format: "build-42"
	latestBuild := 0
	if after, ok := strings.CutPrefix(release.TagName, "build-"); ok {
		latestBuild, _ = strconv.Atoi(after)
	}

	currentBuild := currentBuildInt()
	if latestBuild <= currentBuild {
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
		return fmt.Errorf("asset %q not found in release %s", bundleAsset, release.TagName)
	}

	return applyUpdate(exeDir, downloadURL)
}

func applyUpdate(exeDir, downloadURL string) error {
	updateMu.Lock()
	updating = true
	updateMu.Unlock()
	defer func() {
		updateMu.Lock()
		updating = false
		updateMu.Unlock()
	}()

	// ── 1. Download bundle zip ───────────────────────────────────────────────
	log.Printf("Updater: downloading %s", downloadURL)

	tmpZip, err := os.CreateTemp("", "shell-ads-bundle-*.zip")
	if err != nil {
		return fmt.Errorf("create temp file: %w", err)
	}
	defer os.Remove(tmpZip.Name())

	req, _ := http.NewRequest(http.MethodGet, downloadURL, nil)
	req.Header.Set("User-Agent", "ShellNews-Bernard-launcher/"+BuildNumber)

	resp, err := httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("download HTTP %s", resp.Status)
	}

	if _, err := io.Copy(tmpZip, resp.Body); err != nil {
		return fmt.Errorf("write zip: %w", err)
	}
	tmpZip.Close()
	log.Printf("Updater: download complete")

	// ── 2. Extract to temp dir ───────────────────────────────────────────────
	tmpDir, err := os.MkdirTemp("", "shell-ads-update-*")
	if err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	if err := extractZip(tmpZip.Name(), tmpDir); err != nil {
		return fmt.Errorf("extract zip: %w", err)
	}
	log.Printf("Updater: extracted bundle")

	// ── 3. Stop kiosk, replace kiosk.exe ────────────────────────────────────
	stopKiosk()
	time.Sleep(postKillDelay)

	newKiosk := filepath.Join(tmpDir, "kiosk.exe")
	if _, err := os.Stat(newKiosk); err == nil {
		if err := copyFile(newKiosk, filepath.Join(exeDir, "kiosk.exe")); err != nil {
			return fmt.Errorf("replace kiosk.exe: %w", err)
		}
		log.Printf("Updater: kiosk.exe replaced")
	}

	// ── 4. Self-update launcher.exe (dashboard is embedded inside it) ────────
	// The new launcher.exe already has the updated dashboard baked in —
	// no separate dash/ folder to manage.
	newLauncher := filepath.Join(tmpDir, "launcher.exe")
	launcherFile, err := os.Open(newLauncher)
	if err != nil {
		log.Printf("Updater: launcher.exe not in bundle — skipping self-update")
		return nil
	}
	defer launcherFile.Close()

	log.Printf("Updater: applying self-update to launcher.exe (contains embedded dashboard)...")
	if err := selfupdate.Apply(launcherFile, selfupdate.Options{}); err != nil {
		log.Printf("Updater: self-update failed: %v — continuing with current launcher", err)
		return nil
	}

	// Restart the now-updated binary
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
