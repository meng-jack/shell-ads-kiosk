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
	"sort"
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

//go:embed admin_template.html
var adminTemplateHTML []byte

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

// ─── Google auth ──────────────────────────────────────────────────────────────

const googleClientID = "753871561934-ruse0p8a2k763umnkuj9slq9tlemim9o.apps.googleusercontent.com"

type googleTokenInfo struct {
	Sub     string `json:"sub"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
	Aud     string `json:"aud"`
	Exp     string `json:"exp"`
}

type cachedToken struct {
	info   *googleTokenInfo
	expiry time.Time
}

var tokenCache sync.Map // string → *cachedToken

// submissionRecord tracks every submitted ad across its full lifecycle so the
// submitter can see status updates on the dashboard.
type submissionRecord struct {
	Ad           kioskAd   `json:"ad"`
	OwnerSub     string    `json:"ownerSub"`
	OwnerEmail   string    `json:"ownerEmail"`
	OwnerName    string    `json:"ownerName"`
	Stage        string    `json:"stage"` // submitted|approved|active|removed
	ShownOnKiosk bool      `json:"shownOnKiosk"`
	SubmittedAt  time.Time `json:"submittedAt"`
	ApprovedAt   time.Time `json:"approvedAt,omitempty"`
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

	// Three-stage ad pipeline
	playlistMu   sync.RWMutex
	submittedAds []kioskAd
	approvedAds  []kioskAd
	forcedAds    []kioskAd

	// submissions tracks the full lifecycle of every ad submitted through the
	// dashboard. Protected by playlistMu (same lock as the three stage slices).
	submissions = map[string]*submissionRecord{}

	// navCmdCh carries "next" or "prev" commands from the admin dashboard.
	navCmdCh = make(chan string, 8)

	// currentKioskAd tracks what ad is currently being displayed on the kiosk
	currentKioskAdMu sync.RWMutex
	currentKioskAd   *kioskAd

	// kioskScreenshot stores the latest screenshot from the kiosk (JPEG bytes)
	kioskScreenshotMu   sync.RWMutex
	kioskScreenshotData []byte
	kioskScreenshotTime time.Time
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

// cleanupTokens purges expired tokens every 15 minutes so the sync.Maps
// don't grow unboundedly when many admins/users log in over a long run.
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
		tokenCache.Range(func(k, v any) bool {
			if now.After(v.(*cachedToken).expiry) {
				tokenCache.Delete(k)
			}
			return true
		})
	}
}

// verifyGoogleToken validates an ID token via Google's tokeninfo endpoint and
// caches the result until the token's own expiry so polls don't hammer Google.
func verifyGoogleToken(token string) (*googleTokenInfo, error) {
	if token == "" {
		return nil, fmt.Errorf("missing token")
	}
	if v, ok := tokenCache.Load(token); ok {
		ct := v.(*cachedToken)
		if time.Now().Before(ct.expiry) {
			return ct.info, nil
		}
		tokenCache.Delete(token)
	}
	resp, err := httpClient.Get("https://oauth2.googleapis.com/tokeninfo?id_token=" + token)
	if err != nil {
		return nil, fmt.Errorf("tokeninfo request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("tokeninfo: HTTP %d", resp.StatusCode)
	}
	var info googleTokenInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		return nil, fmt.Errorf("tokeninfo decode: %w", err)
	}
	if info.Aud != googleClientID {
		return nil, fmt.Errorf("token audience mismatch")
	}
	if info.Sub == "" {
		return nil, fmt.Errorf("empty sub in token")
	}
	expiry := time.Now().Add(5 * time.Minute)
	if expSec, err2 := strconv.ParseInt(info.Exp, 10, 64); err2 == nil {
		expiry = time.Unix(expSec, 0)
	}
	tokenCache.Store(token, &cachedToken{info: &info, expiry: expiry})
	return &info, nil
}

// updateSubmissionStage marks a submission record's stage in-place.
// Must be called while playlistMu is held (write lock).
func updateSubmissionStage(id, stage string) {
	if rec, ok := submissions[id]; ok {
		rec.Stage = stage
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

	// 2. Periodically purge expired admin tokens (prevents unbounded growth
	//    when many admins log in and out over a long run).
	go cleanupTokens()

	// 3. Launch the kiosk and restart it if it ever exits unexpectedly
	go monitorKiosk(filepath.Join(exeDir, kioskBin))

	// 4. Periodically check GitHub for a newer build and apply it
	go updateLoop(exeDir)

	// Block main goroutine forever
	select {}
}

// ─── Dashboard server ─────────────────────────────────────────────────────────

// spaHandler wraps a file server so any path that doesn't match a real file
// falls back to index.html — required for React Router client-side routing.
// SECURITY: The /admin path is completely blocked from the SPA to prevent
// reverse engineering. Admin functionality must be accessed only after proper
// authentication and should not be included in the client-side bundle.
func spaHandler(fsys fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(fsys))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// SECURITY: Block /admin/* entirely from static file serving.
		// The admin dashboard should be served separately or via API only.
		if strings.HasPrefix(r.URL.Path, "/admin") {
			http.Error(w, "Forbidden", http.StatusForbidden)
			return
		}

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
		// (but admin paths are already blocked above)
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
	mux.HandleFunc("GET /api/kiosk/nav-poll", handleNavPoll)
	mux.HandleFunc("POST /api/kiosk/report-shown", handleReportShown)
	mux.HandleFunc("POST /api/kiosk/screenshot", handleKioskScreenshot)
	mux.HandleFunc("POST /api/kiosk/current-ad", handleKioskCurrentAd)

	// ── User API (Google token required) ─────────────────────────────────────
	mux.HandleFunc("GET /api/my-ads", handleGetMyAds)
	mux.HandleFunc("DELETE /api/my-ads/{id}", handleRetractAd)

	// ── Admin auth ────────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/admin/auth", handleAdminAuth)

	// ── Admin protected ───────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/admin/state", requireAdmin(handleAdminState))
	mux.HandleFunc("GET /api/admin/stats", requireAdmin(handleAdminStats))
	mux.HandleFunc("GET /api/admin/screenshot", requireAdmin(handleAdminScreenshot))
	mux.HandleFunc("PUT /api/admin/reorder", requireAdmin(handleAdminReorder))
	mux.HandleFunc("DELETE /api/admin/active/{id}", requireAdmin(handleAdminDeleteActive))
	mux.HandleFunc("DELETE /api/admin/submitted/{id}", requireAdmin(handleAdminDeleteSubmitted))
	mux.HandleFunc("DELETE /api/admin/approved/{id}", requireAdmin(handleAdminDeleteApproved))
	mux.HandleFunc("POST /api/admin/submitted/{id}/approve", requireAdmin(handleAdminApproveSubmitted))
	mux.HandleFunc("POST /api/admin/approved/{id}/activate", requireAdmin(handleAdminActivateApproved))
	mux.HandleFunc("POST /api/admin/clear", requireAdmin(handleAdminClearActive))
	mux.HandleFunc("POST /api/admin/reload", requireAdmin(handleAdminReload))
	mux.HandleFunc("PUT /api/admin/playlist", requireAdmin(handleAdminSetPlaylist))
	mux.HandleFunc("POST /api/admin/restart-kiosk", requireAdmin(handleAdminRestartKiosk))
	mux.HandleFunc("POST /api/admin/kiosk/next", requireAdmin(handleAdminKioskNext))
	mux.HandleFunc("POST /api/admin/kiosk/prev", requireAdmin(handleAdminKioskPrev))
	mux.HandleFunc("POST /api/admin/trigger-update", requireAdmin(handleAdminTriggerUpdate))
	mux.HandleFunc("GET /api/admin/update-status", requireAdmin(handleAdminUpdateStatus))
	mux.HandleFunc("DELETE /api/admin/logout", requireAdmin(handleAdminLogout))

	// ── Admin page (server-side rendered, no client bundle exposure) ──────────
	mux.HandleFunc("GET /admin", handleAdminPage)
	mux.HandleFunc("GET /admin/", handleAdminPage)

	// ── SPA fallback ──────────────────────────────────────────────────────────
	mux.Handle("/", spaHandler(sub))

	log.Printf("Dashboard: http://localhost%s  |  Admin: http://localhost%s/admin", dashPort, dashPort)
	if err := http.ListenAndServe(dashPort, mux); err != nil {
		log.Fatalf("Dashboard server: %v", err)
	}
}

// handleSubmitAds queues incoming ads as "submitted" — not visible to the kiosk
// until an admin approves them AND either the Z key is pressed or reload is called.
// Requires a valid Google ID token in the X-Google-Token header.
func handleSubmitAds(w http.ResponseWriter, r *http.Request) {
	userInfo, err := verifyGoogleToken(r.Header.Get("X-Google-Token"))
	if err != nil {
		http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
		return
	}

	var incoming []dashAd
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, "bad JSON", http.StatusBadRequest)
		return
	}

	now := time.Now()
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
	for _, ad := range ads {
		submissions[ad.ID] = &submissionRecord{
			Ad:          ad,
			OwnerSub:    userInfo.Sub,
			OwnerEmail:  userInfo.Email,
			OwnerName:   userInfo.Name,
			Stage:       "submitted",
			SubmittedAt: now,
		}
	}
	total := len(submittedAds)
	playlistMu.Unlock()

	log.Printf("Submit [%s]: %d ad(s) queued for review (total: %d)", userInfo.Email, len(ads), total)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "submitted": total})
}

// handleActivate is called by the kiosk Z-key.
// It moves ONLY admin-approved ads into the live playlist.
// Submitted-but-not-approved ads are never touched here.
func handleActivate(w http.ResponseWriter, r *http.Request) {
	playlistMu.Lock()
	for _, ad := range approvedAds {
		updateSubmissionStage(ad.ID, "active")
	}
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

// handleAdminPage serves the server-side rendered admin dashboard.
// SECURITY: This is served as a standalone HTML page, NOT bundled with the
// public React app, to prevent reverse engineering of admin functionality.
func handleAdminPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	// Add security headers
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Write(adminTemplateHTML)
}

// adminAd enriches a kioskAd with submitter information for the admin view.
type adminAd struct {
	kioskAd
	SubmitterName  string `json:"submitterName,omitempty"`
	SubmitterEmail string `json:"submitterEmail,omitempty"`
	SubmittedAt    string `json:"submittedAt,omitempty"`
	ApprovedAt     string `json:"approvedAt,omitempty"`
}

func enrichAds(ads []kioskAd) []adminAd {
	out := make([]adminAd, len(ads))
	for i, a := range ads {
		aa := adminAd{kioskAd: a}
		if rec, ok := submissions[a.ID]; ok {
			aa.SubmitterName = rec.OwnerName
			aa.SubmitterEmail = rec.OwnerEmail
			aa.SubmittedAt = rec.SubmittedAt.Format(time.RFC3339)
			if !rec.ApprovedAt.IsZero() {
				aa.ApprovedAt = rec.ApprovedAt.Format(time.RFC3339)
			}
		}
		out[i] = aa
	}
	return out
}

func handleAdminState(w http.ResponseWriter, r *http.Request) {
	playlistMu.RLock()
	active := enrichAds(forcedAds)
	approved := enrichAds(approvedAds)
	submitted := enrichAds(submittedAds)
	playlistMu.RUnlock()

	if active == nil {
		active = []adminAd{}
	}
	if approved == nil {
		approved = []adminAd{}
	}
	if submitted == nil {
		submitted = []adminAd{}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"active":    active,
		"approved":  approved,
		"submitted": submitted,
	})
}

// handleAdminSetPlaylist atomically replaces the live playlist with an ordered
// selection of IDs drawn from the approved+live pool.
// Items removed from the selection are returned to the approved (holding) queue.
func handleAdminSetPlaylist(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad JSON", http.StatusBadRequest)
		return
	}

	playlistMu.Lock()
	// Build a unified pool from both approved and currently live.
	pool := make(map[string]kioskAd)
	for _, a := range approvedAds {
		pool[a.ID] = a
	}
	for _, a := range forcedAds {
		pool[a.ID] = a
	}

	// Build new live playlist in the given order.
	inSelection := make(map[string]bool, len(body.IDs))
	newForced := make([]kioskAd, 0, len(body.IDs))
	for _, id := range body.IDs {
		if a, ok := pool[id]; ok {
			newForced = append(newForced, a)
			inSelection[id] = true
			updateSubmissionStage(id, "active")
		}
	}

	// Everything NOT in selection returns to / stays in approved (holding).
	newApproved := make([]kioskAd, 0)
	for _, a := range approvedAds {
		if !inSelection[a.ID] {
			newApproved = append(newApproved, a)
		}
	}
	for _, a := range forcedAds {
		if !inSelection[a.ID] {
			newApproved = append(newApproved, a)
			if rec, ok := submissions[a.ID]; ok && rec.Stage == "active" {
				rec.Stage = "approved"
			}
		}
	}

	forcedAds = newForced
	approvedAds = newApproved
	playlistMu.Unlock()

	log.Printf("Admin: playlist updated — %d live, %d returned to holding", len(newForced), len(newApproved))
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
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
	found := false
	n := forcedAds[:0:0]
	for _, a := range forcedAds {
		if a.ID == id {
			found = true
		} else {
			n = append(n, a)
		}
	}
	if found {
		forcedAds = n
		updateSubmissionStage(id, "removed")
	}
	playlistMu.Unlock()
	if !found {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	log.Printf("Admin: removed active %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminDeleteSubmitted(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	playlistMu.Lock()
	found := false
	n := submittedAds[:0:0]
	for _, a := range submittedAds {
		if a.ID == id {
			found = true
		} else {
			n = append(n, a)
		}
	}
	if found {
		submittedAds = n
		updateSubmissionStage(id, "removed")
	}
	playlistMu.Unlock()
	if !found {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	log.Printf("Admin: rejected submitted %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminDeleteApproved(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	playlistMu.Lock()
	found := false
	n := approvedAds[:0:0]
	for _, a := range approvedAds {
		if a.ID == id {
			found = true
		} else {
			n = append(n, a)
		}
	}
	if found {
		approvedAds = n
		updateSubmissionStage(id, "removed")
	}
	playlistMu.Unlock()
	if !found {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	log.Printf("Admin: removed approved %q", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminApproveSubmitted(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	playlistMu.Lock()
	found := false
	remaining := submittedAds[:0:0]
	for _, a := range submittedAds {
		if a.ID == id {
			approvedAds = append(approvedAds, a)
			found = true
		} else {
			remaining = append(remaining, a)
		}
	}
	if found {
		submittedAds = remaining
		updateSubmissionStage(id, "approved")
		if rec, ok := submissions[id]; ok {
			rec.ApprovedAt = time.Now()
		}
	}
	playlistMu.Unlock()
	if !found {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	log.Printf("Admin: approved submitted %q → approved queue", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminActivateApproved(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	playlistMu.Lock()
	found := false
	remaining := approvedAds[:0:0]
	for _, a := range approvedAds {
		if a.ID == id {
			forcedAds = append(forcedAds, a)
			found = true
		} else {
			remaining = append(remaining, a)
		}
	}
	if found {
		approvedAds = remaining
		updateSubmissionStage(id, "active")
	}
	playlistMu.Unlock()
	if !found {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	log.Printf("Admin: activated approved %q → live", id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

func handleAdminClearActive(w http.ResponseWriter, r *http.Request) {
	playlistMu.Lock()
	n := len(forcedAds)
	for _, ad := range forcedAds {
		updateSubmissionStage(ad.ID, "removed")
	}
	forcedAds = nil
	playlistMu.Unlock()
	log.Printf("Admin: cleared %d active ad(s)", n)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true, "cleared": n})
}

func handleAdminReload(w http.ResponseWriter, r *http.Request) {
	playlistMu.Lock()
	for _, ad := range approvedAds {
		updateSubmissionStage(ad.ID, "active")
	}
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

// ─── User-facing handlers ────────────────────────────────────────────────────

func handleReportShown(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ID == "" {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	playlistMu.Lock()
	if rec, ok := submissions[body.ID]; ok {
		rec.ShownOnKiosk = true
	}
	playlistMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// handleKioskScreenshot accepts JPEG screenshot uploads from the kiosk.
// POST body should be raw JPEG bytes with Content-Type: image/jpeg
func handleKioskScreenshot(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Content-Type") != "image/jpeg" {
		http.Error(w, "expected image/jpeg", http.StatusBadRequest)
		return
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, 10<<20)) // 10 MB max
	if err != nil {
		http.Error(w, "read failed", http.StatusBadRequest)
		return
	}
	kioskScreenshotMu.Lock()
	kioskScreenshotData = data
	kioskScreenshotTime = time.Now()
	kioskScreenshotMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// handleKioskCurrentAd accepts updates about which ad is currently showing.
func handleKioskCurrentAd(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ID string `json:"id,omitempty"` // empty = transitioning or idle
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad JSON", http.StatusBadRequest)
		return
	}
	currentKioskAdMu.Lock()
	if body.ID == "" {
		currentKioskAd = nil
	} else {
		playlistMu.RLock()
		for _, ad := range forcedAds {
			if ad.ID == body.ID {
				currentKioskAd = &ad
				break
			}
		}
		playlistMu.RUnlock()
	}
	currentKioskAdMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
}

// handleAdminScreenshot returns the latest kiosk screenshot plus metadata about
// the currently-displayed ad.
func handleAdminScreenshot(w http.ResponseWriter, r *http.Request) {
	kioskScreenshotMu.RLock()
	data := kioskScreenshotData
	screenshotTime := kioskScreenshotTime
	kioskScreenshotMu.RUnlock()

	currentKioskAdMu.RLock()
	currentAd := currentKioskAd
	currentKioskAdMu.RUnlock()

	if len(data) == 0 {
		// No screenshot yet
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"hasScreenshot": false,
			"message":       "No screenshot available yet",
		})
		return
	}

	var adInfo *adminAd
	if currentAd != nil {
		playlistMu.RLock()
		enriched := enrichAds([]kioskAd{*currentAd})
		playlistMu.RUnlock()
		if len(enriched) > 0 {
			adInfo = &enriched[0]
		}
	}

	// Return JSON with base64-encoded image and ad metadata
	w.Header().Set("Content-Type", "application/json")
	resp := map[string]any{
		"hasScreenshot":  true,
		"screenshot":     data, // Will be base64-encoded by json.Encoder
		"screenshotTime": screenshotTime.Format(time.RFC3339),
		"currentAd":      adInfo,
	}
	_ = json.NewEncoder(w).Encode(resp)
}

func handleGetMyAds(w http.ResponseWriter, r *http.Request) {
	userInfo, err := verifyGoogleToken(r.Header.Get("X-Google-Token"))
	if err != nil {
		http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
		return
	}
	type userAdResp struct {
		ID           string    `json:"id"`
		Name         string    `json:"name"`
		Type         string    `json:"type"`
		Src          string    `json:"src"`
		DurationMs   int       `json:"durationMs"`
		Stage        string    `json:"stage"`
		ShownOnKiosk bool      `json:"shownOnKiosk"`
		SubmittedAt  time.Time `json:"submittedAt"`
	}
	playlistMu.RLock()
	var result []userAdResp
	for _, rec := range submissions {
		if rec.OwnerSub != userInfo.Sub {
			continue
		}
		result = append(result, userAdResp{
			ID: rec.Ad.ID, Name: rec.Ad.Name, Type: rec.Ad.Type,
			Src: rec.Ad.Src, DurationMs: rec.Ad.DurationMs,
			Stage: rec.Stage, ShownOnKiosk: rec.ShownOnKiosk,
			SubmittedAt: rec.SubmittedAt,
		})
	}
	playlistMu.RUnlock()
	if result == nil {
		result = []userAdResp{}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].SubmittedAt.After(result[j].SubmittedAt)
	})
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(result)
}

func handleRetractAd(w http.ResponseWriter, r *http.Request) {
	userInfo, err := verifyGoogleToken(r.Header.Get("X-Google-Token"))
	if err != nil {
		http.Error(w, `{"error":"unauthenticated"}`, http.StatusUnauthorized)
		return
	}
	id := r.PathValue("id")
	playlistMu.Lock()
	rec, exists := submissions[id]
	if !exists || rec.OwnerSub != userInfo.Sub {
		playlistMu.Unlock()
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	if rec.Stage == "active" {
		playlistMu.Unlock()
		http.Error(w, `{"error":"ad is already live — ask an admin to remove it"}`, http.StatusConflict)
		return
	}
	if rec.Stage == "removed" {
		playlistMu.Unlock()
		http.Error(w, `{"error":"already removed"}`, http.StatusGone)
		return
	}
	ns := submittedAds[:0:0]
	for _, a := range submittedAds {
		if a.ID != id {
			ns = append(ns, a)
		}
	}
	submittedAds = ns
	na := approvedAds[:0:0]
	for _, a := range approvedAds {
		if a.ID != id {
			na = append(na, a)
		}
	}
	approvedAds = na
	rec.Stage = "removed"
	playlistMu.Unlock()
	log.Printf("User retract [%s]: removed %q", userInfo.Email, id)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]bool{"ok": true})
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
