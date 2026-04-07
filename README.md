# Authentic Vintage Warehouse

Internal warehouse management app for vintage clothing bundles. Runs entirely
on a single host with no internet required after the first build.

- **Frontend** — Next.js 14 + TypeScript + Tailwind, served by `next start`
- **Backend** — FastAPI + SQLite, with chunked resumable uploads and ffmpeg
  installed inside the image
- **Reverse proxy** — nginx, the only container that exposes a port

---

## Quick start

### Prerequisites

You only need **Docker** with Docker Compose v2 (the `docker compose` plugin,
not the old `docker-compose` script). Nothing else needs to be installed
on the host — no Node, no Python, no ffmpeg.

### One-time setup (with internet)

This pulls the base images, downloads the npm and pip packages, and bakes
everything into local Docker layers. After this step the host can be taken
fully offline.

```bash
cd /home/burhan/AuthenticVintageWarehouseWebApp
docker compose up --build -d
```

The first build takes a few minutes. Subsequent rebuilds reuse cached layers.

### Open the app

```
http://localhost:8082
```

On the same LAN, replace `localhost` with the host's IP, e.g.
`http://192.168.1.50:8082`.

### Default admin

The very first user that registers becomes Admin and is auto-approved.

If you want to skip registration, use the smoke-test admin created during
setup:

```
username: admin
password: admin
```

(Change this in the UI by signing up a new admin and removing the default
account, **or** by editing the `users` table directly in the SQLite DB.)

---

## Offline operation

Everything required at runtime is bundled into the Docker images during the
first build:

| Asset | Where it lives |
|---|---|
| Inter font (woff2) | `frontend/public/fonts/` baked into the image |
| shadcn UI components | copied source under `frontend/src/components/ui/` |
| All npm packages | `npm ci` against `package-lock.json` at build time |
| All pip packages | `pip install -r requirements.txt` at build time |
| ffmpeg | installed via `apt-get install ffmpeg` at build time |
| Base images | `node:20-alpine`, `nginx:alpine`, `python:3.12-slim` are cached locally after the first pull |

To verify the host can rebuild offline:

```bash
docker compose down
sudo ip link set <iface> down       # or just unplug
docker compose up --build -d        # should succeed using only cached layers
```

---

## Common operations

### Restart everything

```bash
docker compose restart
```

### Rebuild after changing source code

```bash
docker compose up --build -d
```

### Tail the logs

```bash
docker compose logs -f               # all services
docker compose logs -f backend       # just one
```

### Check health

```bash
curl http://localhost:8082/api/health
```

### Inspect the database

The SQLite file lives in the named volume `warehouse-db`. To poke at it:

```bash
docker compose exec backend python -c "import sqlite3; \
  c=sqlite3.connect('/app/data/warehouse.db'); \
  print(list(c.execute('SELECT id, username, role, is_approved FROM users')))"
```

### Back up the data

Two Docker volumes hold all persistent state:

| Volume | Contains |
|---|---|
| `warehouse-db` | the SQLite file |
| `uploads` | every uploaded image and video |

To dump them to a tarball:

```bash
docker run --rm \
  -v authenticvintagewarehousewebapp_warehouse-db:/db \
  -v authenticvintagewarehousewebapp_uploads:/uploads \
  -v "$PWD":/backup \
  alpine tar czf /backup/warehouse-backup-$(date +%Y%m%d).tar.gz /db /uploads
```

To restore: `docker run --rm -v ... -v ...:/backup alpine tar xzf /backup/<file>.tar.gz -C /`

---

## Editing the clipboard template

The format used by the **Copy** button on bundles lives in a single JSON file
that is **bind-mounted** into the backend container, so edits take effect on
the next click — no rebuild, no restart.

```bash
nano backend/app/templates/clipboard.json
```

The file documents its own placeholders inline. Available tokens:

- **Header / footer**: `{bundle_code}`, `{bundle_name}`, `{status}`,
  `{created_at}`, `{item_count}`, `{image_count}`
- **Item**: `{n}`, `{gender}`, `{brand}`, `{article}`, `{number_of_pieces}`,
  `{gift_pcs}`, `{grade}`, `{size_variation}`, `{comments}`

---

## Roles

| Role | Can | Cannot |
|---|---|---|
| Admin | Everything (create / edit / delete bundles, approve users, change roles) | — |
| Content Creators | Create new bundles, edit existing bundles (items + media), copy details | Delete a whole bundle, manage users |
| Listing Executives | View bundles, download media, copy details | Create or modify bundles |

The very first user who registers becomes Admin and is auto-approved.
Subsequent users land in **pending** until an admin approves them.

### Password reset

Users can self-reset their password from the **Forgot password?** link on
the login page. After a reset they go back to **pending** and have to be
re-approved by an admin in person — that's the security model.

The **admin** account's password is locked at the backend and can never be
reset (`/users/reset-password` returns 403 for any user with role `Admin`).

---

## Troubleshooting

### Port 8082 is taken

Edit `docker-compose.yml` and change the nginx port mapping:

```yaml
nginx:
  ports:
    - "9000:80"      # whatever you like
```

Then `docker compose up -d` to recreate the nginx container.

### Big videos won't upload

Uploads are chunked at 10 MB per request. If your videos are huge and
slow:

1. Check `nginx/default.conf` `client_max_body_size 20M;` (per chunk, not
   per file — leave it alone unless you change the chunk size)
2. Check `Dockerfile` uvicorn timeout flags
3. Look at `docker compose logs -f backend nginx` while uploading

### "Admin password cannot be reset"

That's by design. Re-read the **Roles → Password reset** section.

### Stack won't start after rebooting the host

Containers are configured with `restart: unless-stopped`, so they should
come up automatically on reboot. If they don't:

```bash
docker compose up -d
```

---

## Architecture at a glance

```
                ┌────────────────────────────────────┐
                │              nginx                 │
                │  :8082 (the only published port)   │
                └────────────────┬───────────────────┘
                                 │
                ┌────────────────┴────────────────┐
                │                                 │
                ▼                                 ▼
       ┌─────────────────┐               ┌────────────────┐
       │  Next.js (3000) │               │ FastAPI (8080) │
       │ standalone node │               │    + uvicorn   │
       └─────────────────┘               └────────┬───────┘
                                                  │
                                  ┌───────────────┴───────────────┐
                                  │                               │
                                  ▼                               ▼
                          ┌──────────────┐               ┌─────────────┐
                          │  warehouse-  │               │   uploads/  │
                          │   db volume  │               │   volume    │
                          │  (sqlite)    │               │  (media)    │
                          └──────────────┘               └─────────────┘
```

- nginx terminates HTTP, gzips text payloads, caches `_next/static` and
  `/fonts/` for a year, and proxies API calls under `/api/` to FastAPI.
- The Next.js app talks to FastAPI through the same `/api/` path so there
  are no CORS issues and one address works from any device on the LAN.
- Video compression happens **on the client device** in the browser before
  the file is uploaded — the server just stores bytes.
