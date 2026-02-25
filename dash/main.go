package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"time"
)

//go:embed static
var staticFiles embed.FS

var startTime = time.Now()

func main() {
	subFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(subFS)))
	mux.HandleFunc("/api/status", handleStatus)

	fmt.Println("┌─────────────────────────────────────────┐")
	fmt.Println("│     Startup Shell Dashboard             │")
	fmt.Println("├─────────────────────────────────────────┤")
	fmt.Println("│  Local:   http://localhost:6969         │")
	fmt.Println("│  Tunnel:  https://shellnews.exoad.net   │")
	fmt.Println("└─────────────────────────────────────────┘")

	log.Fatal(http.ListenAndServe(":6969", mux))
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	uptime := time.Since(startTime)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":         "online",
		"uptime_seconds": int(uptime.Seconds()),
		"uptime":         formatUptime(uptime),
		"started_at":     startTime.Format(time.RFC3339),
		"server_time":    time.Now().Format(time.RFC3339),
	})
}

func formatUptime(d time.Duration) string {
	h := int(d.Hours())
	m := int(d.Minutes()) % 60
	s := int(d.Seconds()) % 60
	if h > 0 {
		return fmt.Sprintf("%dh %dm %ds", h, m, s)
	}
	if m > 0 {
		return fmt.Sprintf("%dm %ds", m, s)
	}
	return fmt.Sprintf("%ds", s)
}
