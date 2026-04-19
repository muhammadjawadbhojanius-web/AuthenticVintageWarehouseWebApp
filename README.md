# Authentic Vintage Warehouse

Internal warehouse management app for vintage clothing bundles. Runs on a
single host and needs **no internet at runtime** — all fonts, packages,
ffmpeg and Swagger UI assets are bundled at build time.

- **Frontend** — Next.js 14 (App Router, standalone) + TypeScript + Tailwind
- **Backend** — FastAPI + SQLite + bcrypt/JWT + ffmpeg (chunked resumable uploads)
- **Reverse proxy** — nginx, the only process that binds a host port

---

## Deployment paths

Both paths live in the same tree. Pick one per machine.

| Path | Host requirements | Start command | Nginx config |
|---|---|---|---|
| **Docker** (recommended) | Docker Desktop + Docker Compose v2 | `docker compose up --build -d` | `nginx/default.conf` |
| **Windows native** | Python 3.12+, Node 20 LTS, ffmpeg (auto-installed via winget) | `setup.bat` → `run.bat` | `nginx/windows.conf` |

The app listens on **`http://localhost:8082`** in both cases (see
Troubleshooting if that port is taken).

---

## Quick start — Docker

```bash
docker compose up --build -d        # first time; builds and runs
docker compose logs -f              # tail all services
docker compose down                 # stop
```

Open `http://localhost:8082`. On the LAN, replace `localhost` with the
host's IP (`http://192.168.1.50:8082`).

The very first user who registers becomes **Admin** and is auto-approved.
Subsequent registrations land in *pending* until an admin approves them.

### Offline guarantee

Everything required at runtime is baked into the Docker images on the
first `--build`:

| Asset | Where it lives |
|---|---|
| Inter font (woff2) | `frontend/public/fonts/` → baked into the image |
| shadcn UI components | copied source under `frontend/src/components/ui/` |
| All npm packages | `npm ci` against `package-lock.json` at build time |
| All pip packages | `pip install -r requirements.txt` at build time |
| ffmpeg binary | `apt-get install ffmpeg` during backend build |
| Swagger UI | local copy at `backend/app/static/` (no CDN) |
| Base images | `node:20-alpine`, `nginx:alpine`, `python:3.12-slim` cached locally after first pull |

Verify offline rebuild:

```bash
docker compose down
# disconnect / pull the ethernet / turn wifi off
docker compose up --build -d        # must succeed using cached layers
```

---

## Quick start — Windows native

If Docker isn't available on the target machine, the stack runs directly
as three console processes: uvicorn, `next start`, and a bundled nginx.

### First-time setup

Double-click or from `cmd`:

```cmd
setup.bat
```

The script pulls latest code (if it's a git clone), downloads
nginx 1.26.2 into `nginx-bin\`, creates `backend\.venv\`, installs all
backend + frontend dependencies, and produces the Next.js standalone
build. Re-run it to update after a `git pull`.

If ffmpeg isn't on `PATH`, `setup.bat` auto-installs it via `winget`.

### Start / stop

```cmd
run.bat          # spawns backend, frontend, and nginx in separate windows
stop.bat         # kills all three by port (8080, 3000, 8082)
```

Windows Firewall must allow inbound **TCP 8082** for LAN devices to
reach the app.

---

## Common operations

### Rebuild after a code change (Docker)

```bash
docker compose up --build -d
```

### Health check

```bash
curl http://localhost:8082/api/health      # → {"status":"ok"}
```

### Inspect the SQLite database

```bash
docker compose exec backend python -c "import sqlite3; \
  c=sqlite3.connect('/app/data/warehouse.db'); \
  print(list(c.execute('SELECT id, username, role, is_approved FROM users')))"
```

### Back up all persistent state

Two named Docker volumes hold everything:

| Volume | Contents |
|---|---|
| `warehouse-db` | the SQLite file |
| `uploads` | every uploaded image and video |

```bash
docker run --rm \
  -v authenticvintagewarehousewebapp_warehouse-db:/db \
  -v authenticvintagewarehousewebapp_uploads:/uploads \
  -v "$PWD":/backup \
  alpine tar czf /backup/warehouse-backup-$(date +%Y%m%d).tar.gz /db /uploads
```

Restore: `docker run --rm -v ...:/db -v ...:/uploads -v "$PWD":/backup alpine tar xzf /backup/<file>.tar.gz -C /`

---

## Architecture

```
                        ┌─────────────────────────────┐
                        │           nginx             │
                        │  :8082 (only open port)     │
                        └──────────────┬──────────────┘
                                       │
              /_next/* & /fonts/*      │         /api/*
              ───────────────────┐     │     ┌─────────────
                                 ▼     ▼     ▼
                     ┌─────────────────┐   ┌────────────────┐
                     │  Next.js (3000) │   │ FastAPI (8080) │
                     │   standalone    │   │    uvicorn     │
                     └─────────────────┘   └────────┬───────┘
                                                    │
                                   ┌────────────────┴──────────┐
                                   ▼                           ▼
                           ┌──────────────┐          ┌──────────────┐
                           │  warehouse-  │          │   uploads/   │
                           │   db volume  │          │    volume    │
                           │   (sqlite)   │          │    (media)   │
                           └──────────────┘          └──────────────┘
```

- Nginx terminates HTTP, gzips text payloads, caches `_next/static` and
  `/fonts/` for a year, and proxies `/api/*` to FastAPI.
- The frontend talks to the backend under the same origin at `/api`,
  so there are **no CORS surprises** in production.
- Uploads are chunked (10 MB per request, up to 3 parallel), resumable,
  and reassembled server-side; ffmpeg remuxes web-ready H.264 / ≤720p /
  ≤30 fps input (fast) or transcodes anything else.
- Video **compression runs on the client** when the source exceeds the
  remux window (>720p or >30 fps), so the server only stream-copies.

---

## Roles & access

| Role | Can | Cannot |
|---|---|---|
| Admin | Everything — create / edit / delete bundles, approve / reject / remove users, change roles, bulk delete | — |
| Content Creators | Create new bundles, edit items & media, copy bundle details | Delete a whole bundle, manage users |
| Listing Executives | View bundles, download media, copy details | Create or modify bundles |

The **first registered user** is auto-approved as Admin. Subsequent
users land in *pending* until an admin approves them.

### Password reset

Users can self-reset from the **Forgot password?** link on the login
page. After a reset the account is moved back to *pending* and has to
be re-approved in person by an admin — that's the security model.

The Admin account's password is locked at the backend. `/users/reset-password`
returns 403 for any user whose role is `Admin`.

---

## Download behaviour per device

The app is used mostly from phones. Downloads are routed through the
platform's native capabilities so files actually land where users
expect:

| Device | Path | File lands in |
|---|---|---|
| **iOS** (Safari, Chrome, Firefox — all WebKit) | Pre-fetches the blobs → dialog with **Save** buttons → `navigator.share({ files })` under a real user tap | Photos (via iOS share sheet) |
| **Android** (Chrome / Samsung / Firefox) | Direct URL with `Content-Disposition: attachment` → browser's DownloadManager | `/Download/` → indexed by MediaStore → shows up in Gallery / Google Photos |
| **Desktop** (any) | Same direct URL path | User's Downloads folder |

Android and desktop don't buffer bytes in page memory — the browser's
native download UI handles streaming and notifications. iOS is the
only platform that has to hold the blob in RAM because that's the only
way `navigator.share` reaches Photos on iOS.

---

## Editing the clipboard template

The format used by the **Copy** button on bundles lives in a single JSON
file that is **bind-mounted** into the backend container, so edits take
effect on the next click — no rebuild, no restart.

```bash
nano backend/app/templates/clipboard.json
```

Available placeholders (documented inline in the file):

- **Header / footer**: `{bundle_code}`, `{bundle_name}`, `{status}`,
  `{created_at}`, `{item_count}`, `{total_pieces}`, `{image_count}`
- **Per-item**: `{n}`, `{gender}`, `{brand}`, `{article}`,
  `{number_of_pieces}`, `{gift_pcs}`, `{grade}`, `{size_variation}`,
  `{comments}`

---

## Troubleshooting

### Port 8082 is already in use

Drop a local **Compose override** in the project root — the `!override`
tag replaces the base `ports` list instead of appending:

```yaml
# compose.port-override.yml
services:
  nginx:
    ports: !override
      - "8085:80"      # or any free port
```

Bring the stack up with both files:

```bash
docker compose -f docker-compose.yml -f compose.port-override.yml up -d
```

This file is gitignored (per-host setting, not something to commit).

On the Windows native path, edit `listen 8082;` in
`nginx/windows.conf` instead, and re-run `run.bat`.

### Very large uploads feel slow

Uploads are chunked at 10 MB, up to 3 in flight. Two things to check:

1. Is the video outside the backend remux window (>720p or >30 fps)?
   The client should be compressing it first — watch the browser
   console for `[video-compressor] …` logs.
2. `client_max_body_size` in `nginx/default.conf` is **per chunk**
   (20 MB headroom over the 10 MB chunk). Don't touch it unless you
   change the chunk size in `frontend/src/lib/chunked-upload.ts`.

Tail backend logs during an upload:

```bash
docker compose logs -f backend nginx
```

### "Admin password cannot be reset"

By design. Re-read the **Password reset** section above.

### Stack won't start after a reboot

Containers are `restart: unless-stopped` and should come up
automatically. If they don't:

```bash
docker compose up -d
```

### No media downloads on my phone

Verify the browser actually supports the native download route:

- Android Chrome/Samsung — should trigger a DownloadManager notification
  at the top. If nothing happens, check in `chrome://downloads`.
- iOS Safari — you must tap the **Save** button inside the app's
  download dialog; the share sheet is OS-level.

---

## Data surfaces

| Where | What |
|---|---|
| SQLite `data/warehouse.db` | users, bundles, items, image rows, upload-job tracking |
| `uploads/{bundle_code}/` | every uploaded image (`bundle-X_img_N.jpg`) and processed video (`bundle-X_vid_N.mp4`) |
| `backend/app/templates/clipboard.json` | user-editable clipboard format (bind-mounted, hot-reload) |
| Docker volumes `warehouse-db`, `uploads` | persistent state; back these up |

---

## Key files for future readers

- [backend/app/main.py](backend/app/main.py) — FastAPI entry, router wiring, CORS, inline index migration
- [backend/app/routers/bundles.py](backend/app/routers/bundles.py) — CRUD + chunked-upload lifecycle (`init` → `chunk` → `finalize` → `status`)
- [backend/app/utils/media_processor.py](backend/app/utils/media_processor.py) — probe → remux (stream-copy) or transcode
- [frontend/src/lib/download.ts](frontend/src/lib/download.ts) — device-aware download module
- [frontend/src/lib/video-compressor.ts](frontend/src/lib/video-compressor.ts) — WebCodecs / MediaRecorder client-side compression
- [frontend/src/components/bundle-card.tsx](frontend/src/components/bundle-card.tsx) — the list card (thumbnail + metadata + action footer)
- [nginx/default.conf](nginx/default.conf) — proxy, caching, gzip, byte-range passthrough
