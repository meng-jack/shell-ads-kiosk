package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"

	"github.com/minio/selfupdate"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	githubOwner = "meng-jack"
	githubRepo  = "shell-ads-kiosk"
	assetName = "shell-ads-kiosk-windows-x64.exe"
)

// UpdateInfo is returned to the frontend when checking for updates.
type UpdateInfo struct {
	Available    bool   `json:"available"`
	LatestBuild  int    `json:"latestBuild"`
	CurrentBuild int    `json:"currentBuild"`
	ReleaseURL   string `json:"releaseUrl"`
}

// ghRelease is the subset of the GitHub releases API we need.
type ghRelease struct {
	TagName string    `json:"tag_name"`
	HTMLURL string    `json:"html_url"`
	Assets  []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

// currentBuildInt converts the BuildNumber ldflags string to an integer.
// Returns 0 when running without a build stamp (local dev).
func currentBuildInt() int {
	n, _ := strconv.Atoi(strings.TrimSpace(BuildNumber))
	return n
}

// fetchLatestRelease queries the GitHub releases API and returns the latest release.
func (a *App) fetchLatestRelease() (*ghRelease, error) {
	url := fmt.Sprintf(
		"https://api.github.com/repos/%s/%s/releases/latest",
		githubOwner, githubRepo,
	)
	req, err := http.NewRequestWithContext(a.context(), http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "shell-ads-kiosk-updater")

	resp, err := a.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	// 404 means the repo exists but has no releases yet.
	if resp.StatusCode == http.StatusNotFound {
		return nil, nil
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github API: %s", resp.Status)
	}

	var release ghRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}
	return &release, nil
}

// CheckForUpdate queries GitHub for the latest release and reports whether a
// newer build is available. It is safe to call from the frontend at any time.
func (a *App) CheckForUpdate() (*UpdateInfo, error) {
	current := currentBuildInt()

	release, err := a.fetchLatestRelease()
	if err != nil {
		return nil, err
	}
	if release == nil {
		return &UpdateInfo{CurrentBuild: current}, nil
	}

	// Tag format: "build-42"
	latest := 0
	if after, ok :=strings.CutPrefix(release.TagName, "build-"); ok  {
		latest, _ = strconv.Atoi(after)
	}

	return &UpdateInfo{
		Available:    latest > current,
		LatestBuild:  latest,
		CurrentBuild: current,
		ReleaseURL:   release.HTMLURL,
	}, nil
}

// ApplyUpdate downloads the latest release binary from GitHub, replaces the
// running executable on disk using minio/selfupdate, and then restarts the
// process. It returns an error if the update cannot be applied; in the success
// path the current process exits before this function returns.
func (a *App) ApplyUpdate() error {
	release, err := a.fetchLatestRelease()
	if err != nil {
		return fmt.Errorf("fetch release: %w", err)
	}
	if release == nil {
		return fmt.Errorf("no releases found")
	}

	// Find the asset with the expected fixed name.
	var downloadURL string
	for _, asset := range release.Assets {
		if asset.Name == assetName {
			downloadURL = asset.BrowserDownloadURL
			break
		}
	}
	if downloadURL == "" {
		return fmt.Errorf("asset %q not found in release %s", assetName, release.TagName)
	}

	// Download the new binary. GitHub redirects to their CDN; the default
	// http.Client follows up to 10 redirects automatically.
	dlReq, err := http.NewRequestWithContext(a.context(), http.MethodGet, downloadURL, nil)
	if err != nil {
		return fmt.Errorf("create download request: %w", err)
	}
	dlReq.Header.Set("User-Agent", "shell-ads-kiosk-updater")

	dlResp, err := a.client.Do(dlReq)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}
	defer dlResp.Body.Close()

	if dlResp.StatusCode != http.StatusOK {
		return fmt.Errorf("download HTTP %s", dlResp.Status)
	}

	// Replace the running binary on disk.
	// On Windows, minio/selfupdate renames the current exe to <name>.old and
	// writes the new one in its place so the swap is atomic.
	if err := selfupdate.Apply(dlResp.Body, selfupdate.Options{}); err != nil {
		return fmt.Errorf("apply update: %w", err)
	}

	// Restart by launching the (now-updated) binary and exiting the old process.
	cmd := exec.Command(os.Args[0], os.Args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if startErr := cmd.Start(); startErr == nil {
		os.Exit(0)
	}

	return nil
}

// startAutoUpdate is called once from App.startup. It runs a background
// goroutine that silently checks for, downloads, and applies an update.
// It is a no-op when IS_DEV is true or when BuildNumber has not been stamped.
func (a *App) startAutoUpdate() {
	// Never auto-update in dev mode or unstamped local builds.
	if IS_DEV || BuildNumber == "dev" {
		return
	}

	go func() {
		info, err := a.CheckForUpdate()
		if err != nil || info == nil || !info.Available {
			return
		}

		// Notify the frontend that an update is being applied (optional UI hook).
		wailsRuntime.EventsEmit(a.ctx, "update:available", info)

		if applyErr := a.ApplyUpdate(); applyErr != nil {
			wailsRuntime.EventsEmit(a.ctx, "update:error", applyErr.Error())
		}
		// On success ApplyUpdate() calls os.Exit(0), so nothing below runs.
	}()
}
