# Shell Ads Kiosk

A fullscreen, frameless digital signage player for clubs and venues built with **Go** (Wails) + **React + TypeScript**. Cycles through image, video, and custom HTML creatives on a TV display with smooth animations, automatic asset caching, and comprehensive dev tooling.

## Features

### Core Playback
- **Three creative types**: Image, Video, and Custom HTML
- **Per-slide durations**: Each creative displays for a configurable time (in milliseconds)
- **Smooth transitions**: Fade, slide-left, slide-up, zoom animations for enter/exit
- **Auto-looping videos**: Videos shorter than their slot duration loop seamlessly
- **Remote playlist fetching**: Pull JSON playlists from a server or use a demo fallback
- **Automatic refresh**: Playlists reload every 60 seconds (configurable)

### Media Layout & Positioning
- **Flexible fit modes**: `contain`, `cover`, `fill`, `stretch`, `center`, `none`
- **Padding & background**: Add letterboxing with custom background colors
- **Custom sizing**: Override width/height on a per-creative basis
- **Aspect ratio control**: Define how content scales on non-matching aspect ratios

### Asset Management
- **Automatic caching**: Downloads image/video assets to disk for offline playback and faster reuse
- **Atomic writes**: Uses temp files + rename to prevent partial/corrupted cache entries
- **Cleanup on rotation**: Removes cached assets no longer in the active playlist
- **Fallback to remote**: If cache misses, falls back to remote URLs seamlessly

### Sandboxing & Security
- **Custom HTML sandboxing**: User-submitted HTML is rendered in an iframe with strict `sandbox` attributes
- **DOMPurify sanitization**: Dangerous tags and attributes are stripped before rendering
- **No host access**: Custom HTML cannot access `window.parent`, Wails runtime, localStorage, cookies, or the outer DOM
- **Lifecycle isolation**: One creative cannot interfere with the carousel or other ads

### Developer Tools
- **Dev mode overlay** (`KIOSK_DEV=1`): Shows per-slide:
  - Countdown timer + progress bar
  - Current slide number & total
  - Ad ID, type, duration, transitions
  - Layout breakdown (fit, padding, background, size overrides)
  - Cache status (local disk vs. downloading)
  - Playlist sync status & last refresh time
  - Performance metrics
- **Automatic TypeScript bindings**: Wails generates Go↔JS bridges automatically
- **Hot reload**: Changes to frontend code instantly reflect in the dev server

---

## Project Structure

```
.
├── app.go                    # Core logic: playlist fetch, asset download/cleanup, dev mode
├── main.go                   # Wails app init, window config, asset server setup
├── go.mod, go.sum            # Go dependencies
├── wails.json                # Wails config (name, scripts, author)
├── README.md                 # This file
├── build/                    # Build artifacts & icons
├── frontend/
│   ├── src/
│   │   ├── App.tsx           # Main carousel controller, state, asset mgmt
│   │   ├── App.css           # Fullscreen layout, transitions, dev overlay styles
│   │   ├── types.ts          # TypeScript interfaces (Ad, Transition, AdLayout, etc.)
│   │   ├── style.css         # Global styles
│   │   ├── main.tsx          # React entry point
│   │   ├── components/
│   │   │   ├── AdRenderer.tsx         # Routes ad to correct renderer
│   │   │   ├── DevOverlay.tsx         # Dev mode stats panel
│   │   │   └── ads/
│   │   │       ├── ImageAd.tsx        # Image + layout wrapper
│   │   │       ├── VideoAd.tsx        # Video + imperative play() + loop
│   │   │       └── HtmlAd.tsx         # Sandboxed iframe + DOMPurify
│   │   ├── assets/
│   │   │   ├── fonts/
│   │   │   └── images/
│   │   └── vite-env.d.ts
│   ├── wailsjs/
│   │   ├── go/
│   │   │   ├── main/
│   │   │   │   ├── App.d.ts  # TypeScript bindings (generated)
│   │   │   │   └── App.js    # JS bindings (generated)
│   │   │   └── models.ts      # Go struct models (generated)
│   │   └── runtime/
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── index.html
└── .gitignore
```

---

## Quick Start

### Prerequisites
- **Go** 1.23+ ([download](https://golang.org/dl/))
- **Node.js** 16+ ([download](https://nodejs.org/))
- **Wails CLI** ([install](https://wails.io/docs/gettingstarted/installation))

### Development

1. **Clone and navigate:**
   ```bash
   cd shell-ads-kiosk
   ```

2. **Install dependencies:**
   ```bash
   npm install --prefix frontend
   ```

3. **Run in dev mode (with debug overlay):**
   ```bash
   KIOSK_DEV=1 wails dev
   ```
   - Opens fullscreen frameless window
   - Debug overlay in top-left shows countdown, slide info, cache status
   - Hot reload on code changes

4. **Run in production mode:**
   ```bash
   wails dev
   ```
   - Debug overlay hidden
   - Compact status bar bottom-right

### Building

**macOS / Linux / Windows:**
```bash
wails build
```
Output binary: `build/bin/shell-ads-kiosk` (or `.exe` on Windows)

**Clean build:**
```bash
wails build -clean
```

---

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLAYLIST_URL` | *(none)* | Remote URL returning a JSON array of ads. If unset, uses demo playlist. |
| `KIOSK_DEV` | `0` | Set to `1` to enable dev mode overlay. |

**Example:**
```bash
PLAYLIST_URL=https://api.shell.local/ads/playlist.json KIOSK_DEV=1 wails dev
```

### Window Settings

Edit `wails.json` or `main.go`:
- `Width`, `Height` — set to 1920×1080 by default
- `Frameless: true` — removes window decorations
- `DisableResize: true` — locks size (fullscreen on most displays)
- `WindowStartState: Fullscreen` — launches fullscreen

---

## Test Playlist (jsDelivr)

A ready-made test playlist lives at `api/test_playlist.json` in this repo and is served via jsDelivr CDN:

```
https://cdn.jsdelivr.net/gh/meng-jack/shell-ads-kiosk@main/api/test_playlist.json
```

Point the kiosk at it to exercise all ad types (image, video, HTML), multiple transitions, layout modes, and the 30-second duration clamp (the last entry intentionally requests 99 999 ms and will be clamped to 30 000 ms by both the Go sanitizer and the frontend normalizer):

```bash
# Windows (cmd)
set PLAYLIST_URL=https://cdn.jsdelivr.net/gh/meng-jack/shell-ads-kiosk@main/api/test_playlist.json
shell-ads-kiosk-windows-x64.exe

# Windows (PowerShell)
$env:PLAYLIST_URL="https://cdn.jsdelivr.net/gh/meng-jack/shell-ads-kiosk@main/api/test_playlist.json"
.\shell-ads-kiosk-windows-x64.exe

# macOS / Linux (wails dev)
PLAYLIST_URL=https://cdn.jsdelivr.net/gh/meng-jack/shell-ads-kiosk@main/api/test_playlist.json wails dev
```

> **Note:** jsDelivr caches files aggressively. After pushing a change to `api/test_playlist.json`, append `?v=<timestamp>` or switch `@main` to a specific commit SHA to bust the cache immediately.

---

## Playlist JSON Format

### Full Example

```json
[
  {
    "id": "summer-banner",
    "name": "Summer Hero Banner",
    "type": "image",
    "src": "https://cdn.example.com/ads/summer.jpg",
    "durationMs": 20000,
    "transition": {
      "enter": "zoom",
      "exit": "fade"
    },
    "layout": {
      "fit": "contain",
      "paddingPx": 60,
      "background": "#0f172a"
    }
  },
  {
    "id": "promo-video",
    "name": "Club Promo Video",
    "type": "video",
    "src": "https://cdn.example.com/ads/promo.mp4",
    "poster": "https://cdn.example.com/ads/promo-thumb.jpg",
    "durationMs": 30000,
    "transition": {
      "enter": "slide-up",
      "exit": "fade"
    },
    "layout": {
      "fit": "cover"
    }
  },
  {
    "id": "custom-welcome",
    "name": "Welcome Message",
    "type": "html",
    "html": "<style>body{background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;margin:0;font-family:sans-serif;}</style><h1>Welcome to Shell!</h1>",
    "durationMs": 15000,
    "transition": {
      "enter": "fade",
      "exit": "slide-left"
    }
  }
]
```

### Field Reference

#### All Types
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | ✅ | — | Internal opaque identifier generated by offsite system (not displayed) |
| `name` | `string` | ✅ | — | User-friendly name for the creative (shown in dev mode) |
| `type` | `"image" \| "video" \| "html"` | ✅ | — | Creative type |
| `durationMs` | `number` | ✅ | — | Display duration in milliseconds (min ~1150ms) |
| `transition.enter` | `"fade" \| "slide-left" \| "slide-up" \| "zoom"` | — | `"fade"` | Animate-in style |
| `transition.exit` | same | — | `"fade"` | Animate-out style |
| `layout` | `AdLayout` | — | `null` | Size, fit, padding, background overrides |

#### `type: "image"`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `src` | `string` | ✅ | Image URL (JPEG, PNG, WebP, etc.) |

#### `type: "video"`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `src` | `string` | ✅ | Video URL (MP4, WebM, etc.) |
| `poster` | `string` | — | Poster frame URL shown while buffering |

#### `type: "html"`
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `html` | `string` | ✅ | Raw HTML/CSS/JS string (sanitized with DOMPurify) |

#### `AdLayout` (optional)
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fit` | `MediaFit` | `"contain"` | How to scale: `contain`, `cover`, `fill`, `stretch`, `center`, `none` |
| `paddingPx` | `number` | `0` | Uniform padding in pixels |
| `background` | `string` | `"transparent"` | CSS background color (visible with padding) |
| `width` | `string` | `"100%"` | CSS width override (e.g. `"80%"`, `"1280px"`) |
| `height` | `string` | `"100%"` | CSS height override |

---

## Asset Caching & Cleanup

### How It Works

1. When a playlist is fetched, the app begins downloading image/video assets in the background
2. Assets are written to `~/.cache/kiosk-ads/` (Unix) or platform cache dir (Windows/macOS)
3. The **currently-playing ad uses a locked, stable source**:
   - If the cached file is ready → use `/cache/<id>.<ext>`
   - Otherwise → stream from remote URL
4. When the carousel rotates, all non-active assets are purged (except new downloads in progress)
5. If the network fails, cached assets play indefinitely

### Cache Storage

- **Linux/macOS**: `~/.cache/kiosk-ads/`
- **Windows**: `%APPDATA%/Local/Temp/kiosk-ads/` or similar
- **Temp fallback**: System temp dir if cache dir is unavailable

### Manual Cache Cleanup

Remove all cached assets:
```bash
rm -rf ~/.cache/kiosk-ads
```

---

## Development Workflow

### Hot Reload
During `wails dev`, changes to:
- **Frontend code** (React, CSS) → instant browser reload
- **Go code** (app.go) → app restarts automatically

### Debugging

**Frontend:**
- Open browser DevTools: Right-click → Inspect
- Call Go methods from console: `window.go.main.App.FetchPlaylist()`

**Go:**
- Set breakpoints in VS Code
- Check logs in terminal

### Testing Asset Downloads

1. Set `PLAYLIST_URL` to your test server:
   ```bash
   PLAYLIST_URL=http://localhost:3000/playlist.json KIOSK_DEV=1 wails dev
   ```
2. Watch dev overlay to see cache status change as downloads complete

---

## Troubleshooting

### Videos don't autoplay
- Check `muted` attribute (required for autoplay)
- Ensure browser allows autoplay without user interaction
- Try setting `controls={false}` (already done)

### Custom HTML renders blank / "Creative missing"
- Check DOMPurify warnings in console
- Ensure `html` field is valid string
- Inline `<style>` is allowed; external stylesheets need CSP allowlist

### Assets not cached
- Check `~/.cache/kiosk-ads/` exists and is writable
- Verify remote URLs are accessible (`CORS` headers may block downloads)
- Look for errors in terminal logs

### Playlist won't load
- Confirm `PLAYLIST_URL` is accessible: `curl $PLAYLIST_URL`
- Check JSON structure (should be an array of ad objects)
- If fetch fails, the app falls back to demo playlist

### Dev overlay not showing
- Verify `KIOSK_DEV=1` is set: `echo $KIOSK_DEV`
- Fallback: `import.meta.env.DEV` detects Vite dev server

---

## Go Bindings Reference

All Go methods are exposed to JavaScript via Wails. Import from `wailsjs/go/main/App`:

```typescript
import {
  FetchPlaylist,       // Fetch remote or demo playlist
  DownloadAsset,       // Download URL to cache, return /cache/<id>.<ext>
  CleanupAssets,       // Remove cached files not in keepIDs list
  IsDevMode,           // Check if KIOSK_DEV=1
} from '../wailsjs/go/main/App';
```

### Async Methods (return Promises)

- `FetchPlaylist(): Promise<Ad[]>`
- `DownloadAsset(adID: string, url: string): Promise<string>` — returns cache path or empty string
- `CleanupAssets(keepIDs: string[]): Promise<void>`
- `IsDevMode(): Promise<boolean>`

---

## Deployment

### Standalone Binary
1. Build: `wails build`
2. Copy `build/bin/shell-ads-kiosk` to target machine
3. Set environment variables and run:
   ```bash
   PLAYLIST_URL=https://api.shell.local/ads/playlist.json ./shell-ads-kiosk
   ```

### Systemd Service (Linux)
```ini
[Unit]
Description=Shell Ads Kiosk
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kiosk
ExecStart=/opt/shell-ads-kiosk/shell-ads-kiosk
Environment="PLAYLIST_URL=https://api.shell.local/ads/playlist.json"
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

### Docker
```dockerfile
FROM ubuntu:latest
RUN apt-get update && apt-get install -y libgtk-3-0 libwebkit2gtk-4.0-0
COPY build/bin/shell-ads-kiosk /app/shell-ads-kiosk
ENV PLAYLIST_URL=https://api.shell.local/ads/playlist.json
CMD ["/app/shell-ads-kiosk"]
```

---

## Security Considerations

### Input Validation
- Ad IDs are sanitized before cache filename use (alphanumeric + `-_`)
- Playlist JSON is validated: type, duration > 0, valid ad types only
- Remote URLs are checked for HTTP 200 before caching

### Custom HTML Sandbox
```html
<iframe sandbox="allow-scripts allow-forms allow-pointer-lock"
        referrerPolicy="no-referrer"
        srcDoc="sanitized-html"></iframe>
```
- **No** `allow-same-origin` (prevents access to parent context)
- **No** `allow-top-navigation` (prevents navigation)
- DOMPurify strips dangerous attributes (onclick, onerror, etc.)

### Network
- Asset downloads use a 30-second timeout
- Playlist fetch uses a 10-second timeout
- Failed downloads fallback to remote URL (no retry loop)

---

## Contributing

Issues, PRs, and feature requests welcome! Please:
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -am 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Submit a Pull Request

---

## License

MIT License © 2026 Startup Shell

---

## Support

For issues or questions:
- Check the **Troubleshooting** section above
- Review `wails.json` and environment variables
- Run with `KIOSK_DEV=1` to see detailed logs and debug overlay
- Consult [Wails Docs](https://wails.io)

---

**Happy displaying! 📺**
