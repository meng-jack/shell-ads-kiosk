package main

import (
	"archive/zip"
	"embed"
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
	kioskMu     sync.Mutex
	activeKiosk *exec.Cmd

	// pauses the kiosk monitor loop while an update is in flight
	updateMu sync.RWMutex
	updating bool

	// forced playlist — populated when the kiosk Z-key calls /api/activate
	playlistMu sync.RWMutex
	pendingAds []kioskAd // submitted by dashboard, waiting for Z on kiosk
	forcedAds  []kioskAd // activated by kiosk Z-key, served to kiosk
)

// ─── Entry point ──────────────────────────────────────────────────────────────

func main() {
	log.SetFlags(log.Ltime | log.Lshortfile)
	log.Printf("Shell Ads Launcher — build=%s", BuildNumber)

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

func serveDash() {
	sub, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatalf("Dashboard: embed FS error: %v", err)
	}

	mux := http.NewServeMux()

	// API — must be registered before the catch-all file server
	mux.HandleFunc("POST /api/submit-ads", handleSubmitAds) // dashboard → pending
	mux.HandleFunc("POST /api/activate", handleActivate)    // kiosk Z-key → active
	mux.HandleFunc("GET /api/playlist", handlePlaylist)     // kiosk polls this

	// Everything else → embedded React app
	mux.Handle("/", http.FileServer(http.FS(sub)))

	log.Printf("Dashboard: http://localhost%s", dashPort)
	if err := http.ListenAndServe(dashPort, mux); err != nil {
		log.Fatalf("Dashboard server: %v", err)
	}
}

// handleSubmitAds accepts a JSON array of dashAd from the dashboard on every
// form submit, converts them to kioskAd, and queues them as pending.
// They are NOT served to the kiosk until the operator presses Z on the kiosk.
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
			Transition: adTransition{Enter: "fade", Exit: "fade"},
		}
		switch d.Type {
		case "html":
			// Use Src so the kiosk renders it as a native <iframe src="…">.
			// Putting it in HTML would require DOMPurify to allow iframes, which
			// it strips by default. The src path bypasses sanitization entirely.
			ad.Src = d.URL
		default: // image, video
			ad.Src = d.URL
		}
		ads = append(ads, ad)
	}

	playlistMu.Lock()
	pendingAds = append(pendingAds, ads...)
	playlistMu.Unlock()

	log.Printf("Submit: %d ad(s) queued as pending (total pending: %d)", len(ads), len(pendingAds))

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "pending": len(pendingAds)})
}

// handleActivate is called by the kiosk when the operator presses Z.
// It moves all pending ads into the active playlist and clears the pending queue.
func handleActivate(w http.ResponseWriter, r *http.Request) {
	playlistMu.Lock()
	forcedAds = append(forcedAds, pendingAds...)
	activated := len(pendingAds)
	pendingAds = nil
	playlistMu.Unlock()

	log.Printf("Activate: %d pending ad(s) moved to active playlist (total active: %d)", activated, len(forcedAds))

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
		log.Printf("Kiosk: started (pid %d)", cmd.Process.Pid)

		_ = cmd.Wait()
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
