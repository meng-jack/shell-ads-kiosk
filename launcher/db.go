package main

// db.go — PocketBase-backed persistent storage for the ad pipeline.
//
// All four pipeline stages (submitted → approved → live → denied) are stored
// in a single SQLite collection ("ads") with a "status" field.  The in-memory
// slices that existed before this file are gone; every handler now reads/writes
// through the helpers below.
//
// PocketBase also exposes a full data-admin UI at http://127.0.0.1:8090/_/
// so operators can browse, edit, and hard-delete any record directly in the
// browser without going through the React dashboard.

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/apis"
	"github.com/pocketbase/pocketbase/daos"
	"github.com/pocketbase/pocketbase/models"
	"github.com/pocketbase/pocketbase/models/schema"
)

var pb *pocketbase.PocketBase

const collAds = "ads"

// Status constants – the only values stored in the "status" field.
const (
	adStatusSubmitted = "submitted"
	adStatusApproved  = "approved"
	adStatusLive      = "live"
	adStatusDenied    = "denied"
)

// ─── Bootstrap ────────────────────────────────────────────────────────────────

// initDB initialises PocketBase (SQLite), ensures the ads collection schema
// exists, then starts the PocketBase admin UI on 127.0.0.1:8090 in the
// background.  Must be called before serveDash().
func initDB() error {
	dataDir := filepath.Join(exeDirectory(), "pb_data")
	pb = pocketbase.NewWithConfig(pocketbase.Config{
		DefaultDataDir:  dataDir,
		HideStartBanner: true,
	})
	if err := pb.Bootstrap(); err != nil {
		return fmt.Errorf("pocketbase bootstrap: %w", err)
	}
	if err := ensureAdsSchema(); err != nil {
		return fmt.Errorf("schema setup: %w", err)
	}

	// PocketBase admin UI on a separate port — operators can visit
	// http://127.0.0.1:8090/_/ to inspect, edit, or hard-delete any record.
	go func() {
		if err := apis.Serve(pb, apis.ServeConfig{
			HttpAddr:        "127.0.0.1:8090",
			ShowStartBanner: false,
		}); err != nil {
			log.Printf("PocketBase admin UI: %v", err)
		}
	}()

	log.Printf("DB: ready (data=%s) | PocketBase admin → http://127.0.0.1:8090/_/", dataDir)
	return nil
}

// ensureAdsSchema creates the "ads" collection when the database is brand-new.
// It is a no-op if the collection already exists, so it is safe to call on
// every startup.
func ensureAdsSchema() error {
	if c, _ := pb.Dao().FindCollectionByNameOrId(collAds); c != nil {
		return nil // already created
	}
	c := &models.Collection{
		Name: collAds,
		Type: models.CollectionTypeBase,
		Schema: schema.NewSchema(
			&schema.SchemaField{Name: "ad_id",        Type: schema.FieldTypeText,   Required: true},
			&schema.SchemaField{Name: "name",         Type: schema.FieldTypeText,   Required: true},
			&schema.SchemaField{Name: "ad_type",      Type: schema.FieldTypeText,   Required: true},
			&schema.SchemaField{Name: "src",          Type: schema.FieldTypeText},
			&schema.SchemaField{Name: "original_url", Type: schema.FieldTypeText},
			&schema.SchemaField{Name: "duration_ms",  Type: schema.FieldTypeNumber, Required: true},
			&schema.SchemaField{Name: "submitted_by", Type: schema.FieldTypeText},
			&schema.SchemaField{Name: "status",       Type: schema.FieldTypeText,   Required: true},
			&schema.SchemaField{Name: "sort_order",   Type: schema.FieldTypeNumber},
		),
	}
	return pb.Dao().SaveCollection(c)
}

// ─── Record ↔ kioskAd ─────────────────────────────────────────────────────────

func recToAd(r *models.Record) kioskAd {
	return kioskAd{
		ID:          r.GetString("ad_id"),
		Name:        r.GetString("name"),
		Type:        r.GetString("ad_type"),
		DurationMs:  r.GetInt("duration_ms"),
		Src:         r.GetString("src"),
		SubmittedBy: r.GetString("submitted_by"),
		Transition:  adTransition{Enter: "fade", Exit: "fade"},
	}
}

// ─── Queries ──────────────────────────────────────────────────────────────────

// dbByStatus returns all ads with the given status, ordered by creation time
// (newest first).  Returns an empty slice (never nil) on error.
func dbByStatus(status string) []kioskAd {
	recs, err := pb.Dao().FindRecordsByFilter(
		collAds,
		"status = '"+status+"'",
		"-created", 1000, 0,
	)
	if err != nil {
		log.Printf("DB query error (status=%s): %v", status, err)
		return []kioskAd{}
	}
	out := make([]kioskAd, len(recs))
	for i, r := range recs {
		out[i] = recToAd(r)
	}
	return out
}

// dbLiveOrdered returns live ads sorted by sort_order ascending.
func dbLiveOrdered() []kioskAd {
	recs, err := pb.Dao().FindRecordsByFilter(
		collAds, "status = 'live'", "sort_order", 1000, 0,
	)
	if err != nil {
		return []kioskAd{}
	}
	out := make([]kioskAd, len(recs))
	for i, r := range recs {
		out[i] = recToAd(r)
	}
	return out
}

// dbFindRec looks up the PocketBase record for a given ad_id.
// Returns nil when not found.
func dbFindRec(adID string) *models.Record {
	r, _ := pb.Dao().FindFirstRecordByData(collAds, "ad_id", adID)
	return r
}

func dbMaxLiveSortOrder() int {
	type row struct {
		Max int `db:"max"`
	}
	var res row
	_ = pb.Dao().DB().
		NewQuery("SELECT COALESCE(MAX(sort_order),0) AS max FROM ads WHERE status = 'live'").
		One(&res)
	return res.Max
}

// ─── Mutations ────────────────────────────────────────────────────────────────

// dbSaveAd persists a newly-submitted ad.  Idempotent — does nothing if the
// ad_id already exists (prevents duplicates on network retries).
func dbSaveAd(ad kioskAd, originalURL string) error {
	if dbFindRec(ad.ID) != nil {
		return nil
	}
	coll, err := pb.Dao().FindCollectionByNameOrId(collAds)
	if err != nil {
		return err
	}
	r := models.NewRecord(coll)
	r.Set("ad_id",        ad.ID)
	r.Set("name",         ad.Name)
	r.Set("ad_type",      ad.Type)
	r.Set("src",          ad.Src)
	r.Set("original_url", originalURL)
	r.Set("duration_ms",  ad.DurationMs)
	r.Set("submitted_by", ad.SubmittedBy)
	r.Set("status",       adStatusSubmitted)
	r.Set("sort_order",   0)
	return pb.Dao().SaveRecord(r)
}

// dbUpdateSrc updates the src field after a file.io URL has been downloaded
// to local /media/ storage.
func dbUpdateSrc(adID, src string) {
	r := dbFindRec(adID)
	if r == nil {
		return
	}
	r.Set("src", src)
	_ = pb.Dao().SaveRecord(r)
}

// dbSetStatus transitions an ad to a new status.
// Returns true when the record was found and updated.
func dbSetStatus(adID, newStatus string) bool {
	r := dbFindRec(adID)
	if r == nil {
		return false
	}
	r.Set("status", newStatus)
	return pb.Dao().SaveRecord(r) == nil
}

// dbMoveToLive sets status to "live" and appends to the end of the sort order.
func dbMoveToLive(adID string) bool {
	r := dbFindRec(adID)
	if r == nil {
		return false
	}
	r.Set("status",     adStatusLive)
	r.Set("sort_order", dbMaxLiveSortOrder()+1)
	return pb.Dao().SaveRecord(r) == nil
}

// dbMoveBackToApproved moves a live ad back to the approved/unused stage.
func dbMoveBackToApproved(adID string) bool {
	r := dbFindRec(adID)
	if r == nil {
		return false
	}
	r.Set("status",     adStatusApproved)
	r.Set("sort_order", 0)
	return pb.Dao().SaveRecord(r) == nil
}

// dbDelete permanently removes an ad from the database.
// Returns the src path (so the caller can clean up the media file) and whether
// the record existed.
func dbDelete(adID string) (src string, found bool) {
	r := dbFindRec(adID)
	if r == nil {
		return "", false
	}
	src = r.GetString("src")
	_ = pb.Dao().DeleteRecord(r)
	return src, true
}

// dbReorderLive re-assigns sort_order values for live ads in a single
// transaction so the kiosk picks up the new order on its next playlist poll.
func dbReorderLive(orderedIDs []string) error {
	return pb.Dao().RunInTransaction(func(txDao *daos.Dao) error {
		for i, id := range orderedIDs {
			r, _ := txDao.FindFirstRecordByData(collAds, "ad_id", id)
			if r == nil {
				continue
			}
			r.Set("sort_order", i)
			if err := txDao.SaveRecord(r); err != nil {
				return err
			}
		}
		return nil
	})
}

// dbClearLive deletes every live ad and returns how many were removed.
// Media files are NOT deleted here — callers must iterate and call
// deleteMediaFile if needed.
func dbClearLive() ([]kioskAd, int) {
	recs, _ := pb.Dao().FindRecordsByFilter(collAds, "status = 'live'", "", 1000, 0)
	ads := make([]kioskAd, len(recs))
	for i, r := range recs {
		ads[i] = recToAd(r)
		_ = pb.Dao().DeleteRecord(r)
	}
	return ads, len(recs)
}

// dbMoveApprovedToLive moves every approved ad to live and returns the count.
func dbMoveApprovedToLive() int {
	recs, _ := pb.Dao().FindRecordsByFilter(
		collAds, "status = 'approved'", "-created", 1000, 0,
	)
	base := dbMaxLiveSortOrder()
	for i, r := range recs {
		r.Set("status",     adStatusLive)
		r.Set("sort_order", base+i+1)
		_ = pb.Dao().SaveRecord(r)
	}
	return len(recs)
}

// dbAllStatuses returns a map of ad_id → status for every ad in the database.
// Used by the public submission-status poll endpoint.
func dbAllStatuses() map[string]string {
	type row struct {
		AdID   string `db:"ad_id"`
		Status string `db:"status"`
	}
	var rows []row
	_ = pb.Dao().DB().NewQuery("SELECT ad_id, status FROM ads").All(&rows)
	m := make(map[string]string, len(rows))
	for _, rw := range rows {
		m[rw.AdID] = rw.Status
	}
	return m
}

// dbCounts returns the number of ads in each status bucket.
func dbCounts() map[string]int {
	type row struct {
		Status string `db:"status"`
		N      int    `db:"n"`
	}
	var rows []row
	_ = pb.Dao().DB().
		NewQuery("SELECT status, COUNT(*) AS n FROM ads GROUP BY status").
		All(&rows)
	m := make(map[string]int)
	for _, rw := range rows {
		m[rw.Status] = rw.N
	}
	return m
}

// ─── Media file cleanup ───────────────────────────────────────────────────────

// deleteMediaFile removes the cached local file for an ad whose src is a
// /media/ relative path.  Safe to call when src is empty or a remote URL.
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
