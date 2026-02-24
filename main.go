package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

// BuildNumber is stamped at compile time via -ldflags "-X main.BuildNumber=<n>".
// It is used by the self-updater to compare against the latest GitHub release;
// it is never displayed in the UI.
var BuildNumber string = "dev"

func main() {
	app := NewApp()
	err := wails.Run(&options.App{
		Title:            "Shell Ads Kiosk",
		Width:            1920,
		Height:           1080,
		Frameless:        true,
		DisableResize:    true,
		WindowStartState: options.Fullscreen,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: newCacheHandler(app.cacheDir),
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 1},
		OnStartup:        app.startup,
		Bind: []any{
			app,
		},
	})
	if err != nil {
		println("Error:", err.Error())
	}
}
