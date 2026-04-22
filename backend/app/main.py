from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.responses import HTMLResponse
from . import models, database
import os
from .routers import users, bundles, media, templates

# Disable default docs so we can serve them locally (no CDN required)
app = FastAPI(title="Authentic Warehouse API", docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False, # Set to False to allow "*" with Authorization header
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Content-Range", "Accept-Ranges"],
)

# Gzip JSON / HTML responses larger than 500 bytes. Saves 70-90% on the
# bundle list payload, especially when there are many bundles. Skips media
# files (already h264/jpeg) thanks to the minimum_size cutoff.
app.add_middleware(GZipMiddleware, minimum_size=500)

# Create database tables
models.Base.metadata.create_all(bind=database.engine)

# SQLAlchemy's create_all() will not add indexes to a pre-existing table,
# so we run a tiny ad-hoc migration here to ensure the FK columns we
# query against (bundle_items.bundle_id, bundle_images.bundle_id) have
# their indexes. CREATE INDEX IF NOT EXISTS is idempotent on SQLite.
with database.engine.connect() as _conn:
    from sqlalchemy import text as _text
    _conn.execute(_text("CREATE INDEX IF NOT EXISTS ix_bundle_items_bundle_id ON bundle_items(bundle_id)"))
    _conn.execute(_text("CREATE INDEX IF NOT EXISTS ix_bundle_images_bundle_id ON bundle_images(bundle_id)"))
    # Idempotent add of the `posted` column on pre-existing databases.
    # SQLite has no "ADD COLUMN IF NOT EXISTS", so we check PRAGMA first.
    _cols = {row[1] for row in _conn.execute(_text("PRAGMA table_info(bundles)")).fetchall()}
    if "posted" not in _cols:
        _conn.execute(_text("ALTER TABLE bundles ADD COLUMN posted INTEGER NOT NULL DEFAULT 0"))
    # Guarantee bundle_code uniqueness at the DB level. declared `unique=True`
    # on the model only applies to tables freshly created by create_all(); a
    # DB from before that annotation won't actually have the constraint,
    # which is how two bundles could ever end up with the same code.
    _conn.execute(_text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_bundles_bundle_code ON bundles(bundle_code)"
    ))
    _conn.commit()

# Create uploads directory if it doesn't exist
os.makedirs("uploads", exist_ok=True)

# Mount uploads
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

# Mount local Swagger UI static assets (no CDN needed)
_static_dir = os.path.join(os.path.dirname(__file__), "static")
app.mount("/static", StaticFiles(directory=_static_dir), name="static")


@app.get("/docs", include_in_schema=False, response_class=HTMLResponse)
async def custom_swagger_ui():
    """Serve Swagger UI using locally-bundled assets (works offline)."""
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="Authentic Warehouse API - Docs",
        swagger_js_url="/static/swagger-ui-bundle.js",
        swagger_css_url="/static/swagger-ui.css",
    )


@app.get("/health")
def health_check():
    return {"status": "ok"}


# Include routers
app.include_router(users.router)
app.include_router(bundles.router)
app.include_router(media.router)
app.include_router(templates.router)
