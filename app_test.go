package main

import "testing"

func TestSanitizeRemotePlaylist_DurationClamping(t *testing.T) {
	cases := []struct {
		name     string
		inDur    int
		wantDur  int
		wantKeep bool
	}{
		{"negative treated as default", -1, DefaultDurationMs, true},
		{"zero treated as default", 0, DefaultDurationMs, true},
		{"too small clamped up", 200, MinDurationMs, true},
		{"normal preserved", 5000, 5000, true},
		{"too large clamped down", 120000, MaxDurationMs, true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ads := []Ad{{ID: "x", Name: "x", Type: AdTypeImage, DurationMs: c.inDur, Src: "http://a"}}
			out := sanitizeRemotePlaylist(ads)
			if c.wantKeep && len(out) != 1 {
				t.Fatalf("expected to keep ad, got %d", len(out))
			}
			if len(out) == 1 && out[0].DurationMs != c.wantDur {
				t.Fatalf("duration clamped: got %d want %d", out[0].DurationMs, c.wantDur)
			}
		})
	}
}

func TestSanitizeRemotePlaylist_Filtering(t *testing.T) {
	ads := []Ad{
		{ID: "a1", Name: "a1", Type: AdTypeImage, DurationMs: 1000, Src: "http://ok"},
		{ID: "a2", Name: "a2", Type: AdTypeHTML, DurationMs: 1000, HTML: "<p>ok</p>"},
		{ID: "a3", Name: "a3", Type: AdType("unknown"), DurationMs: 1000},
		{ID: "a4", Name: "a4", Type: AdTypeVideo, DurationMs: 1000}, // missing src -> reject
	}
	out := sanitizeRemotePlaylist(ads)
	if len(out) != 2 {
		t.Fatalf("expected 2 valid ads, got %d", len(out))
	}
}
