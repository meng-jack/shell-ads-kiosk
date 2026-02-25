# Startup Shell Dashboard

A React/TypeScript dashboard for the Startup Shell kiosk system, themed to match the kiosk's startup screen.

## Architecture

In production this dashboard is **built once** by the CI workflow and bundled into the release zip.  
It is then served as static files by **`launcher.exe`** on **port 6969** — no Node runtime needed on the mini PC.

```
Release bundle (shell-ads-bundle-windows-x64.zip)
├── kiosk.exe       ← Wails ad-display kiosk
├── launcher.exe    ← START THIS: serves dash/, launches kiosk, auto-updates
└── dash/           ← built React app (served by launcher on :6969)
    ├── index.html
    └── assets/
```

Tunneled externally via `cloudflared` at **https://shellnews.exoad.net**.

---

## Development (local)

```bat
npm install
npm run dev       # or: start.bat
```

Vite dev server starts on [http://localhost:6969](http://localhost:6969) with HMR.

To produce the production build:

```bat
build.bat         # runs: npm run build  →  dist/
```

---

## Project structure

```
dash/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── src/
│   ├── main.tsx
│   ├── App.tsx / App.css
│   ├── style.css
│   ├── types.ts
│   ├── hooks/
│   │   └── useClock.ts
│   └── components/
│       ├── Header.tsx / .css
│       ├── StatsBar.tsx / .css
│       ├── StatusCard.tsx / .css
│       ├── CardGrid.tsx / .css
│       └── Footer.tsx / .css
├── build.bat       ← dev: build to dist/
└── start.bat       ← dev: Vite dev server
```
