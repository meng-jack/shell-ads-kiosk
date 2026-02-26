package main

// db.go — JSON-file-backed persistent storage for the ad pipeline.
//
// All ads are stored in a single "ads.json" file next to the launcher binary.
// A sync.RWMutex guards every read and write so concurrent HTTP handlers are safe.
// Writes are atomic: the JSON is marshalled to a ".tmp" file first, then renamed over
// the real file so a crash during write never corrupts the store.

import (
"encoding/json"
"fmt"
"log"
"os"
"path/filepath"
"sort"
"strings"
"sync"
	"time"

// adRecord is the on-disk representation of a single ad.
type adRecord struct {
AdID        string `json:"ad_id"`
Name        string `json:"name"`
AdType      string `json:"ad_type"`
Src         string `json:"src"`
OriginalURL string `json:"original_url"`
DurationMs  int    `json:"duration_ms"`
SubmittedBy string `json:"submitted_by"`
Status      string `json:"status"`
SortOrder   int    `json:"sort_order"`
	SubmittedAt string `json:"submitted_at"` // RFC3339
)

// ─── Bootstrap ────────────────────────────────────────────────────────────────

// initDB loads (or creates) the JSON store. Must be called before any handler.
func initDB() error {
storePath = filepath.Join(exeDirectory(), "ads.json")

storeMu.Lock()
defer storeMu.Unlock()

data, err := os.ReadFile(storePath)
if os.IsNotExist(err) {
store = adStore{Ads: []adRecord{}}
log.Printf("DB: new store at %s", storePath)
return nil
}
if err != nil {
return fmt.Errorf("read store: %w", err)
}
if err := json.Unmarshal(data, &store); err != nil {
return fmt.Errorf("parse store: %w", err)
}
log.Printf("DB: loaded %d ad(s) from %s", len(store.Ads), storePath)
return nil
}

// saveStore persists the in-memory store to disk atomically.
// Caller must hold storeMu (write lock).
func saveStore() {
data, err := json.MarshalIndent(store, "", "  ")
if err != nil {
log.Printf("DB: marshal error: %v", err)
return
}
tmp := storePath + ".tmp"
if err := os.WriteFile(tmp, data, 0o644); err != nil {
log.Printf("DB: write error: %v", err)
return
}
if err := os.Rename(tmp, storePath); err != nil {
log.Printf("DB: rename error: %v", err)
}
}

// ─── Record ↔ kioskAd ─────────────────────────────────────────────────────────

func recToAd(r adRecord) kioskAd {
return kioskAd{
ID:          r.AdID,
Name:        r.Name,
Type:        r.AdType,
DurationMs:  r.DurationMs,
Src:         r.Src,
SubmittedBy: r.SubmittedBy,
Transition:  adTransition{Enter: "fade", Exit: "fade"},
}
}

// ─── Queries ──────────────────────────────────────────────────────────────────

// dbByStatus returns all ads with the given status. Returns an empty (never nil) slice.
func dbByStatus(status string) []kioskAd {
storeMu.RLock()
defer storeMu.RUnlock()
var out []kioskAd
for _, r := range store.Ads {
if r.Status == status {
out = append(out, recToAd(r))
}
}
if out == nil {
return []kioskAd{}
}
return out
}

// dbLiveOrdered returns live ads sorted by sort_order ascending.
func dbLiveOrdered() []kioskAd {
storeMu.RLock()
defer storeMu.RUnlock()
var recs []adRecord
for _, r := range store.Ads {
if r.Status == adStatusLive {
recs = append(recs, r)
}
}
sort.Slice(recs, func(i, j int) bool {
return recs[i].SortOrder < recs[j].SortOrder
})
out := make([]kioskAd, len(recs))
for i, r := range recs {
out[i] = recToAd(r)
}
return out
}

// findIdx returns the index of the ad with the given ad_id, or -1 if not found.
// Caller must hold storeMu.
func findIdx(adID string) int {
for i, r := range store.Ads {
if r.AdID == adID {
return i
}
}
return -1
}

// maxLiveSortOrder returns the highest sort_order among live ads (0 if none).
// Caller must hold storeMu.
func maxLiveSortOrder() int {
max := 0
for _, r := range store.Ads {
if r.Status == adStatusLive && r.SortOrder > max {
max = r.SortOrder
}
}
return max
}

// ─── Mutations ────────────────────────────────────────────────────────────────

// dbSaveAd persists a newly-submitted ad. Idempotent on duplicate ad_id.
func dbSaveAd(ad kioskAd, originalURL string) error {
storeMu.Lock()
defer storeMu.Unlock()
if findIdx(ad.ID) >= 0 {
return nil // already exists
}
store.Ads = append(store.Ads, adRecord{
AdID:        ad.ID,
Name:        ad.Name,
AdType:      ad.Type,
Src:         ad.Src,
OriginalURL: originalURL,
DurationMs:  ad.DurationMs,
SubmittedBy: ad.SubmittedBy,
Status:      adStatusSubmitted,
SortOrder:   0,
})
saveStore()
return nil
}

// dbUpdateSrc updates the src field after a media file has been cached locally.
func dbUpdateSrc(adID, src string) {
storeMu.Lock()
defer storeMu.Unlock()
i := findIdx(adID)
if i < 0 {
return
}
store.Ads[i].Src = src
saveStore()
}

// dbSetStatus transitions an ad to a new status.
// Returns true when the record was found and updated.
func dbSetStatus(adID, newStatus string) bool {
storeMu.Lock()
defer storeMu.Unlock()
i := findIdx(adID)
if i < 0 {
return false
}
store.Ads[i].Status = newStatus
saveStore()
return true
}

// dbMoveToLive sets status to "live" and appends to the end of the sort order.
func dbMoveToLive(adID string) bool {
storeMu.Lock()
defer storeMu.Unlock()
i := findIdx(adID)
if i < 0 {
return false
}
store.Ads[i].Status = adStatusLive
store.Ads[i].SortOrder = maxLiveSortOrder() + 1
saveStore()
return true
}

// dbMoveBackToApproved moves a live ad back to the approved/unused stage.
func dbMoveBackToApproved(adID string) bool {
storeMu.Lock()
defer storeMu.Unlock()
i := findIdx(adID)
if i < 0 {
return false
}
store.Ads[i].Status = adStatusApproved
store.Ads[i].SortOrder = 0
saveStore()
return true
}

// dbDelete permanently removes an ad. Returns the src path and whether it existed.
func dbDelete(adID string) (src string, found bool) {
storeMu.Lock()
defer storeMu.Unlock()
i := findIdx(adID)
if i < 0 {
return "", false
}
src = store.Ads[i].Src
store.Ads = append(store.Ads[:i], store.Ads[i+1:]...)
saveStore()
return src, true
}

// dbReorderLive re-assigns sort_order values for live ads.
func dbReorderLive(orderedIDs []string) error {
storeMu.Lock()
defer storeMu.Unlock()
for pos, id := range orderedIDs {
i := findIdx(id)
if i < 0 {
continue
}
store.Ads[i].SortOrder = pos
}
saveStore()
return nil
}

// dbClearLive deletes every live ad and returns the removed ads and count.
func dbClearLive() ([]kioskAd, int) {
storeMu.Lock()
defer storeMu.Unlock()
var kept []adRecord
var removed []kioskAd
for _, r := range store.Ads {
if r.Status == adStatusLive {
removed = append(removed, recToAd(r))
} else {
kept = append(kept, r)
}
}
store.Ads = kept
if store.Ads == nil {
store.Ads = []adRecord{}
}
saveStore()
return removed, len(removed)
}

// dbMoveApprovedToLive moves every approved ad to live and returns the count.
func dbMoveApprovedToLive() int {
storeMu.Lock()
defer storeMu.Unlock()
base := maxLiveSortOrder()
n := 0
for i, r := range store.Ads {
if r.Status == adStatusApproved {
n++
store.Ads[i].Status = adStatusLive
store.Ads[i].SortOrder = base + n
}
}
if n > 0 {
saveStore()
}
return n
}

// dbBySubmitter returns all ads submitted by the given email, newest first.
func dbBySubmitter(email string) []adRecord {
	storeMu.RLock()
	defer storeMu.RUnlock()
	var out []adRecord
	for _, r := range store.Ads {
		if r.SubmittedBy == email {
			out = append(out, r)
		}
	}
	// Sort newest first (SubmittedAt is RFC3339, so lexicographic order works)
	sort.Slice(out, func(i, j int) bool {
		return out[i].SubmittedAt > out[j].SubmittedAt
	})
	return out
}

// dbBySubmitter returns all ads submitted by the given email, newest first.
func dbBySubmitter(email string) []adRecord {
	storeMu.RLock()
	defer storeMu.RUnlock()
	var out []adRecord
	for _, r := range store.Ads {
		if r.SubmittedBy == email {
			out = append(out, r)
		}
	}
	// Sort newest first (SubmittedAt is RFC3339, so lexicographic order works)
	sort.Slice(out, func(i, j int) bool {
		return out[i].SubmittedAt > out[j].SubmittedAt
	})
	return out
}

// dbAllStatuses returns a map of ad_id → status for every ad in the store.
func dbAllStatuses() map[string]string {
storeMu.RLock()
defer storeMu.RUnlock()
m := make(map[string]string, len(store.Ads))
for _, r := range store.Ads {
m[r.AdID] = r.Status
}
return m
}

// dbCounts returns the number of ads in each status bucket.
func dbCounts() map[string]int {
storeMu.RLock()
defer storeMu.RUnlock()
m := make(map[string]int)
for _, r := range store.Ads {
m[r.Status]++
}
return m
}

// ─── Media file cleanup ───────────────────────────────────────────────────────

// deleteMediaFile removes the cached local file for an ad whose src is a
// /media/ relative path. Safe to call when src is empty or a remote URL.
func deleteMediaFile(src string) {
if mediaDir == "" || !strings.HasPrefix(src, "/media/") {
return
}
rel := strings.TrimPrefix(src, "/media/")
path := filepath.Join(mediaDir, filepath.FromSlash(rel))
if err := os.Remove(path); err == nil {
log.Printf("DB: removed media file %q", path)
} else if !os.IsNotExist(err) {
log.Printf("DB: could not remove media file %q: %v", path, err)
}
}
