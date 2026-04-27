import os
import re
import uuid
import shutil
import logging

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    UploadFile,
    File,
    BackgroundTasks,
)
from sqlalchemy.orm import Session

from .. import schemas, crud, models
from ..database import get_db, SessionLocal
from ..utils import media_processor

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bundles", tags=["Bundles"])

UPLOADS_DIR = "uploads"
TEMP_ROOT = os.path.join(UPLOADS_DIR, ".tmp")
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".wmv", ".webm", ".m4v", ".3gp"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}


# ---------------------------------------------------------------------------
# Bundle-code rename / swap helpers.
#
# The uploads layout encodes the bundle code in three places that all have
# to move together when a code changes:
#   - folder name:   uploads/{code}/
#   - file prefix:   bundle-{code}_img_1.jpg
#   - DB path:       BundleImage.image_path = "uploads/{code}/bundle-{code}_..."
#
# All of these helpers keep them in sync and leave the filesystem in a
# known-good state on any failure (either fully done or fully rolled back).
# ---------------------------------------------------------------------------


def _rewrite_image_path(path: str, old_code: str, new_code: str) -> str:
    """Rewrite an image_path string so the folder segment AND the file
    prefix both track a code rename. Handles both / (Linux) and \\ (Windows)
    separators so it works in Docker and in the Windows-native setup."""
    old = re.escape(old_code)
    pattern = rf"(uploads[\\/]){old}([\\/]bundle-){old}(_)"
    return re.sub(pattern, rf"\g<1>{new_code}\g<2>{new_code}\g<3>", path)


def _rename_bundle_on_disk(old_code: str, new_code: str):
    """Atomically rename uploads/{old_code}/ → uploads/{new_code}/ and
    every bundle-{old_code}_* file inside it to bundle-{new_code}_*.

    On any filesystem error the function reverses what it has already
    done before re-raising, so the caller is guaranteed to see either
    a full rename or the original state.

    Does NOT touch the DB — call sites update image_path afterwards.
    """
    old_dir = os.path.join(UPLOADS_DIR, old_code)
    new_dir = os.path.join(UPLOADS_DIR, new_code)

    if not os.path.exists(old_dir):
        # Bundle has no uploads yet. Nothing on disk to rename.
        return
    if os.path.exists(new_dir):
        raise FileExistsError(
            f"Upload directory for {new_code} already exists on disk"
        )

    os.rename(old_dir, new_dir)
    renamed = []
    try:
        for fn in os.listdir(new_dir):
            prefix = f"bundle-{old_code}_"
            if not fn.startswith(prefix):
                # File name that doesn't encode the bundle code — leave it
                # untouched (users might name files themselves one day).
                continue
            new_name = f"bundle-{new_code}_" + fn[len(prefix):]
            src = os.path.join(new_dir, fn)
            dst = os.path.join(new_dir, new_name)
            os.rename(src, dst)
            renamed.append((src, dst))
    except OSError:
        # Reverse file renames in LIFO order, then put the folder back.
        for src, dst in reversed(renamed):
            try:
                os.rename(dst, src)
            except OSError:
                pass
        try:
            os.rename(new_dir, old_dir)
        except OSError:
            pass
        raise


def _swap_bundles_on_disk(code_a: str, code_b: str):
    """Swap uploads/{code_a}/ and uploads/{code_b}/ including all file
    names inside. Uses a temp folder so the two source dirs never try to
    occupy the same name at once. Rolls back on any failure.
    """
    dir_a = os.path.join(UPLOADS_DIR, code_a)
    dir_b = os.path.join(UPLOADS_DIR, code_b)
    tmp_dir = os.path.join(UPLOADS_DIR, f".__swap_{uuid.uuid4().hex[:8]}__")

    a_exists = os.path.exists(dir_a)
    b_exists = os.path.exists(dir_b)

    # Stage of progress so we know how far to rewind on exception.
    # 0 = nothing done; 1 = A moved to tmp; 2 = B moved to A; 3 = tmp
    # moved to B; 4 = files in A renamed; 5 = files in B renamed.
    stage = 0
    try:
        if a_exists:
            os.rename(dir_a, tmp_dir)
            stage = 1
        if b_exists:
            os.rename(dir_b, dir_a)
            stage = 2
        if a_exists:
            os.rename(tmp_dir, dir_b)
            stage = 3
        if b_exists:
            _rename_files_in_folder(dir_a, code_b, code_a)
            stage = 4
        if a_exists:
            _rename_files_in_folder(dir_b, code_a, code_b)
            stage = 5
    except Exception:
        try:
            if stage >= 5:
                _rename_files_in_folder(dir_b, code_b, code_a)
            if stage >= 4:
                _rename_files_in_folder(dir_a, code_a, code_b)
            if stage >= 3:
                os.rename(dir_b, tmp_dir)
            if stage >= 2:
                os.rename(dir_a, dir_b)
            if stage >= 1:
                os.rename(tmp_dir, dir_a)
        except Exception:
            logger.exception(
                "Swap rollback also failed — FS may be inconsistent. "
                "code_a=%s code_b=%s stage=%d",
                code_a,
                code_b,
                stage,
            )
        raise


def _rename_files_in_folder(folder: str, old_code: str, new_code: str):
    """Rename every bundle-{old_code}_* file in `folder` to bundle-{new_code}_*.
    Used by _swap_bundles_on_disk. No rollback — the caller tracks stages.
    """
    prefix = f"bundle-{old_code}_"
    new_prefix = f"bundle-{new_code}_"
    for fn in os.listdir(folder):
        if fn.startswith(prefix):
            os.rename(
                os.path.join(folder, fn),
                os.path.join(folder, new_prefix + fn[len(prefix):]),
            )


def _delete_bundle_and_uploads(db: Session, code: str):
    """Delete a bundle (DB + uploads folder) in one go. Used by the
    overwrite path in create_bundle."""
    crud.delete_bundle(db, code)
    upload_folder = os.path.join(UPLOADS_DIR, code)
    if os.path.exists(upload_folder):
        shutil.rmtree(upload_folder, ignore_errors=True)


# ---------- CREATE BUNDLE ----------
@router.post("/", response_model=schemas.BundleOut)
def create_bundle(
    bundle_in: schemas.BundleCreate,
    overwrite: bool = False,
    db: Session = Depends(get_db),
):
    """Create a new bundle. If `bundle_code` is already in use:
      - `overwrite=false` (default): return 409 so the UI can prompt.
      - `overwrite=true`: delete the existing bundle (DB row + items +
        images + uploads folder), then create the new one.
    """
    existing = crud.get_bundle_by_code(db, bundle_in.bundle_code)
    if existing and not overwrite:
        # Structured detail so the frontend can surface a clear prompt
        # and summarise what the admin is about to blow away.
        raise HTTPException(
            status_code=409,
            detail={
                "code": "bundle_code_exists",
                "message": f"Bundle {bundle_in.bundle_code} already exists",
                "bundle_code": existing.bundle_code,
                "bundle_name": existing.bundle_name,
                "item_count": len(existing.items),
                "image_count": len(existing.images),
            },
        )
    if existing and overwrite:
        _delete_bundle_and_uploads(db, existing.bundle_code)
    return crud.create_bundle(db, bundle_in.bundle_code, bundle_in.bundle_name)


# ---------- GET ALL BUNDLES ----------
@router.get("/", response_model=list[schemas.BundleOut])
def read_bundles(
    search: str = None,
    # 0=draft, 1=posted, 2=sold. Omit for "all".
    posted: int = None,
    # Bundle-code prefix (e.g. "AV" or "AVG"); matches "{prefix}-%". Omit for "all".
    prefix: str = None,
    # True = only bundles with media, False = only bundles without. Omit for "all".
    has_media: bool = None,
    db: Session = Depends(get_db),
):
    return crud.get_bundles(db, search=search, posted=posted, prefix=prefix, has_media=has_media)


# ---------- STOCK REPORT ----------
# Aggregates items across every non-sold bundle (posted != 2) into three
# views: by brand, by article, and the brand × article cross-tab. Items
# whose brand / article field contains a comma are split into separate
# values and the sellable + gift pieces are divided equally across the
# split values, so a brand="Nike, Adidas" / pieces=10 item contributes
# 5 to each brand instead of 10.
#
# Aggregation is case-insensitive: "T-Shirts" and "T-shirts" collapse to
# a single row. The label uses whichever casing was seen first.
@router.get("/stock")
def stock_report(
    prefix: str = None,
    db: Session = Depends(get_db),
):
    from collections import defaultdict
    from sqlalchemy.orm import selectinload as _selectinload

    query = (
        db.query(models.Bundle)
        .options(_selectinload(models.Bundle.items))
        .filter(models.Bundle.posted != 2)
    )

    if prefix:
        import re as _re
        safe_prefix = _re.sub(r"[^A-Za-z0-9]", "", prefix)
        if safe_prefix:
            query = query.filter(models.Bundle.bundle_code.like(f"{safe_prefix}-%"))

    bundles = query.all()

    # Three aggregation buckets. Keys are casefolded for case-insensitive
    # matching; `display` holds the first-seen casing for the label.
    # Value is {"display": str, "pieces": float, "gift": float,
    # "bundles": set[str]}.
    def _bucket():
        return {"display": "", "pieces": 0.0, "gift": 0.0, "bundles": set()}

    def _combo_bucket():
        return {"brand": "", "article": "", "pieces": 0.0, "gift": 0.0, "bundles": set()}

    by_brand: "defaultdict[str, dict]" = defaultdict(_bucket)
    by_article: "defaultdict[str, dict]" = defaultdict(_bucket)
    by_combo: "defaultdict[tuple[str, str], dict]" = defaultdict(_combo_bucket)

    # Grand totals computed from the raw item values so they aren't
    # affected by rounding on the splits.
    grand_pieces = 0
    grand_gift = 0

    for bundle in bundles:
        for item in bundle.items:
            pieces = int(item.number_of_pieces or 0)
            gift = int(item.gift_pcs or 0)
            grand_pieces += pieces
            grand_gift += gift

            brands = [b.strip() for b in (item.brand or "").split(",") if b.strip()]
            articles = [a.strip() for a in (item.article or "").split(",") if a.strip()]
            if not brands:
                brands = ["(Unlabeled)"]
            if not articles:
                articles = ["(Unlabeled)"]

            brand_pieces_share = pieces / len(brands)
            brand_gift_share = gift / len(brands)
            article_pieces_share = pieces / len(articles)
            article_gift_share = gift / len(articles)
            combo_pieces_share = pieces / (len(brands) * len(articles))
            combo_gift_share = gift / (len(brands) * len(articles))

            for b in brands:
                key = b.casefold()
                bucket = by_brand[key]
                if not bucket["display"]:
                    bucket["display"] = b
                bucket["pieces"] += brand_pieces_share
                bucket["gift"] += brand_gift_share
                bucket["bundles"].add(bundle.bundle_code)
            for a in articles:
                key = a.casefold()
                bucket = by_article[key]
                if not bucket["display"]:
                    bucket["display"] = a
                bucket["pieces"] += article_pieces_share
                bucket["gift"] += article_gift_share
                bucket["bundles"].add(bundle.bundle_code)
            for b in brands:
                for a in articles:
                    key = (b.casefold(), a.casefold())
                    bucket = by_combo[key]
                    if not bucket["brand"]:
                        bucket["brand"] = b
                    if not bucket["article"]:
                        bucket["article"] = a
                    bucket["pieces"] += combo_pieces_share
                    bucket["gift"] += combo_gift_share
                    bucket["bundles"].add(bundle.bundle_code)

    def _row_extra(data):
        pieces = round(data["pieces"], 2)
        gift = round(data["gift"], 2)
        # Ship the actual bundle codes so the UI can union across the
        # currently-visible rows and show a true unique-bundle count that
        # reacts to search. `bundle_count` stays for any caller that only
        # needs the number.
        codes = sorted(data["bundles"])
        return {
            "pieces": pieces,
            "gift": gift,
            "total": round(pieces + gift, 2),
            "bundle_count": len(codes),
            "bundle_codes": codes,
        }

    return {
        "by_brand": [{"brand": v["display"], **_row_extra(v)} for v in by_brand.values()],
        "by_article": [{"article": v["display"], **_row_extra(v)} for v in by_article.values()],
        "combined": [
            {"brand": v["brand"], "article": v["article"], **_row_extra(v)}
            for v in by_combo.values()
        ],
        "totals": {
            "bundles": len(bundles),
            "pieces": grand_pieces,
            "gift": grand_gift,
            "total": grand_pieces + grand_gift,
        },
    }


# ---------- VALIDATE BUNDLE CODES ----------
# Used by the "Bulk Action By List" dialog: the client sends pasted codes,
# we report which ones actually exist so the destructive action endpoints
# never get called with bad input. Read-only and idempotent. Capped at
# 1000 codes per request — far above any realistic warehouse list.
@router.post("/validate-codes", response_model=schemas.BundleCodesValidation)
def validate_bundle_codes(
    payload: schemas.BundleCodesIn,
    db: Session = Depends(get_db),
):
    if len(payload.codes) > 1000:
        raise HTTPException(status_code=400, detail="Too many codes (max 1000)")

    # Uppercase + dedupe to match the rename flow's normalization. Empty
    # strings are filtered so an accidental trailing comma doesn't poison
    # the IN-list with `''`.
    cleaned = {c.strip().upper() for c in payload.codes if c and c.strip()}
    if not cleaned:
        return {"valid": [], "missing": []}

    rows = (
        db.query(models.Bundle.bundle_code)
        .filter(models.Bundle.bundle_code.in_(cleaned))
        .all()
    )
    existing = {r[0] for r in rows}
    missing = sorted(cleaned - existing)
    valid = sorted(existing)
    return {"valid": valid, "missing": missing}


# ---------- GET SINGLE BUNDLE ----------
@router.get("/{bundle_code}", response_model=schemas.BundleOut)
def read_bundle(bundle_code: str, db: Session = Depends(get_db)):
    bundle = crud.get_bundle_by_code(db, bundle_code)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return bundle


# ---------- UPDATE STATUS ----------
@router.patch("/{bundle_code}/status", response_model=schemas.BundleOut)
def change_bundle_status(
    bundle_code: str,
    status_update: schemas.BundleStatusUpdate,
    db: Session = Depends(get_db),
):
    bundle = crud.update_bundle_status(db, bundle_code, status_update.status)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return bundle


# ---------- UPDATE POSTED (draft ↔ posted toggle) ----------
@router.patch("/{bundle_code}/posted", response_model=schemas.BundleOut)
def change_bundle_posted(
    bundle_code: str,
    payload: schemas.BundlePostedUpdate,
    db: Session = Depends(get_db),
):
    bundle = crud.update_bundle_posted(db, bundle_code, payload.posted)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return bundle


# ---------- ADD ITEM ----------
@router.post("/{bundle_code}/items", response_model=schemas.BundleItemOut)
def add_item(bundle_code: str, item: schemas.BundleItemCreate, db: Session = Depends(get_db)):
    db_item = crud.add_bundle_item(db, bundle_code, item)
    if not db_item:
        raise HTTPException(status_code=404, detail="Bundle not found")
    return db_item


# ---------- CHUNKED UPLOAD: INIT ----------
@router.post("/{bundle_code}/uploads/init", response_model=schemas.UploadInitResponse)
def upload_init(
    bundle_code: str,
    init: schemas.UploadInitRequest,
    db: Session = Depends(get_db),
):
    bundle = crud.get_bundle_by_code(db, bundle_code)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    upload_id = uuid.uuid4().hex
    chunk_dir = os.path.join(TEMP_ROOT, upload_id)
    os.makedirs(chunk_dir, exist_ok=True)

    job = models.UploadJob(
        upload_id=upload_id,
        bundle_id=bundle.id,
        filename=init.filename,
        total_size=init.total_size,
        total_chunks=init.total_chunks,
        received_chunks=0,
        status="pending",
        progress=0.0,
    )
    db.add(job)
    db.commit()
    return schemas.UploadInitResponse(upload_id=upload_id)


# ---------- CHUNKED UPLOAD: CHUNK ----------
@router.put("/{bundle_code}/uploads/{upload_id}/chunk")
async def upload_chunk(
    bundle_code: str,
    upload_id: str,
    index: int,
    chunk: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    job = db.query(models.UploadJob).filter(models.UploadJob.upload_id == upload_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload not found")
    if job.status not in ("pending", "uploading"):
        raise HTTPException(status_code=409, detail=f"Upload is in state {job.status}")

    chunk_dir = os.path.join(TEMP_ROOT, upload_id)
    os.makedirs(chunk_dir, exist_ok=True)
    chunk_path = os.path.join(chunk_dir, f"{index:08d}.part")

    # Stream the chunk straight to disk
    with open(chunk_path, "wb") as f:
        while True:
            data = await chunk.read(1024 * 1024)
            if not data:
                break
            f.write(data)

    # Bump received_chunks (we just count distinct files in the dir to be safe
    # against retried/duplicate chunks)
    received = sum(1 for _ in os.scandir(chunk_dir))
    job.received_chunks = received
    job.status = "uploading"
    db.commit()
    return {"received": received, "total": job.total_chunks}


# ---------- CHUNKED UPLOAD: FINALIZE ----------
@router.post("/{bundle_code}/uploads/{upload_id}/finalize")
def upload_finalize(
    bundle_code: str,
    upload_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    job = db.query(models.UploadJob).filter(models.UploadJob.upload_id == upload_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload not found")

    # Count actual chunk files on disk rather than trusting job.received_chunks.
    # When chunks arrive in parallel each request gets its own DB session and
    # they race on the received_chunks column (lost-update). The disk is the
    # source of truth.
    chunk_dir = os.path.join(TEMP_ROOT, upload_id)
    if not os.path.isdir(chunk_dir):
        raise HTTPException(status_code=400, detail="No chunks received")
    received = sum(
        1 for entry in os.scandir(chunk_dir) if entry.name.endswith(".part")
    )
    if received < job.total_chunks:
        raise HTTPException(
            status_code=400,
            detail=f"Missing chunks: have {received}/{job.total_chunks}",
        )

    # Backfill the column to the correct value before kicking off processing
    job.received_chunks = received
    job.status = "processing"
    job.progress = 0.0
    db.commit()

    # Hand off to background task. The HTTP request returns immediately.
    background_tasks.add_task(_process_upload_job, upload_id, bundle_code)
    return {"status": "processing"}


# ---------- CHUNKED UPLOAD: STATUS ----------
@router.get("/{bundle_code}/uploads/{upload_id}/status", response_model=schemas.UploadStatusResponse)
def upload_status(bundle_code: str, upload_id: str, db: Session = Depends(get_db)):
    job = db.query(models.UploadJob).filter(models.UploadJob.upload_id == upload_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Upload not found")
    return schemas.UploadStatusResponse(
        status=job.status,
        progress=job.progress or 0.0,
        error=job.error,
        image_id=job.image_id,
    )


# ---------- CHUNKED UPLOAD: CANCEL ----------
# Used by the in-progress upload indicator's per-row X / Retry. Idempotent:
# always returns ok so the client doesn't need to special-case "already
# gone". Cleans up whatever exists at call time:
#   * marks the job row as cancelled (so a still-queued background task
#     can early-exit on its next status check at the top of _process_upload_job)
#   * removes the chunk dir on disk if any chunks landed
#   * if finalize already ran and a BundleImage row was inserted, deletes
#     the image row + the file from disk so the bundle no longer shows it
@router.post("/{bundle_code}/uploads/{upload_id}/cancel")
def upload_cancel(bundle_code: str, upload_id: str, db: Session = Depends(get_db)):
    job = db.query(models.UploadJob).filter(models.UploadJob.upload_id == upload_id).first()
    chunk_dir = os.path.join(TEMP_ROOT, upload_id)
    assembled_path = os.path.join(TEMP_ROOT, f"{upload_id}.assembled")

    image_id = job.image_id if job else None
    if job is not None:
        job.status = "cancelled"
        try:
            db.commit()
        except Exception:
            db.rollback()

    # On-disk temp artefacts — best-effort.
    try:
        if os.path.exists(chunk_dir):
            shutil.rmtree(chunk_dir, ignore_errors=True)
    except Exception:
        pass
    try:
        if os.path.exists(assembled_path):
            os.remove(assembled_path)
    except Exception:
        pass

    # If the background task already inserted the image row, pull it back
    # out so the bundle no longer references the cancelled upload.
    if image_id is not None:
        image = db.query(models.BundleImage).filter(models.BundleImage.id == image_id).first()
        if image is not None:
            try:
                if image.image_path and os.path.exists(image.image_path):
                    os.remove(image.image_path)
            except Exception:
                pass
            db.delete(image)
            try:
                db.commit()
            except Exception:
                db.rollback()

    return {"status": "ok"}


def _next_available_path(db, bundle_id: int, bundle_code: str, kind: str, ext: str, folder: str) -> str:
    """
    Compute the next free `bundle-{code}_{kind}_{n}.{ext}` filename for a
    given bundle. Counts existing BundleImage rows of the same kind to
    pick the starting n, then probes the filesystem in case a parallel
    upload already grabbed it. Returns the absolute path to use.
    """
    # Existing rows of this type — match the marker token in image_path
    marker = f"_{kind}_"
    existing = (
        db.query(models.BundleImage)
        .filter(models.BundleImage.bundle_id == bundle_id)
        .filter(models.BundleImage.image_path.like(f"%{marker}%"))
        .count()
    )
    n = existing + 1
    for _ in range(20):
        candidate = os.path.join(folder, f"bundle-{bundle_code}_{kind}_{n}.{ext}")
        if not os.path.exists(candidate):
            return candidate
        n += 1
    # Pathological case — fall back to a timestamp suffix
    import time as _t
    return os.path.join(folder, f"bundle-{bundle_code}_{kind}_{int(_t.time() * 1000)}.{ext}")


def _process_upload_job(upload_id: str, bundle_code: str):
    """
    Background task: reassemble the chunked file, run image/video processing,
    insert the BundleImage row, and update the UploadJob status.
    Uses its own DB session because BackgroundTasks runs after the request
    closes.
    """
    db = SessionLocal()
    chunk_dir = os.path.join(TEMP_ROOT, upload_id)
    assembled_path = os.path.join(TEMP_ROOT, f"{upload_id}.assembled")
    job = None
    try:
        job = db.query(models.UploadJob).filter(models.UploadJob.upload_id == upload_id).first()
        if not job:
            return
        # User cancelled between finalize and the background task starting.
        # Skip processing — the cancel endpoint already cleaned up the chunk
        # dir, but it may race with us so the finally block still tries.
        if job.status == "cancelled":
            return
        bundle = db.query(models.Bundle).filter(models.Bundle.id == job.bundle_id).first()
        if not bundle:
            job.status = "failed"
            job.error = "Bundle no longer exists"
            db.commit()
            return

        # 1. Concatenate chunks
        chunks = sorted(os.listdir(chunk_dir))
        with open(assembled_path, "wb") as out:
            for i, name in enumerate(chunks):
                with open(os.path.join(chunk_dir, name), "rb") as part:
                    shutil.copyfileobj(part, out)
                # 0..0.2 of overall progress while reassembling
                job.progress = 0.2 * ((i + 1) / max(1, len(chunks)))
                db.commit()

        # 2. Decide on the final destination based on extension
        upload_folder = os.path.join(UPLOADS_DIR, bundle_code)
        os.makedirs(upload_folder, exist_ok=True)

        ext = os.path.splitext(job.filename)[1].lower()
        is_video = ext in VIDEO_EXTS
        is_image = ext in IMAGE_EXTS

        # Pick the final filename: bundle-{code}_{img|vid}_{n}.{ext}
        # Sequence number is per-bundle, computed from existing rows.
        # If two parallel uploads land on the same n the os.rename will
        # collide; we retry with the next n up to a few times.
        if is_video:
            kind = "vid"
            out_ext = "mp4"
        elif is_image:
            kind = "img"
            # Normalize jpeg/jpg/png/webp — drop the leading dot
            out_ext = ext.lstrip(".") or "jpg"
        else:
            kind = "file"
            out_ext = ext.lstrip(".") or "bin"

        final_path = _next_available_path(db, bundle.id, bundle_code, kind, out_ext, upload_folder)
        # Atomically claim the filename by renaming the assembled temp file
        # into place. os.rename is atomic on POSIX same-fs and will fail if
        # the target unexpectedly exists between our pick and the rename.
        if is_video:
            try:
                media_processor.process_video(assembled_path, final_path)
                os.remove(assembled_path)
            except Exception as e:
                logger.warning("Video processing failed for %s: %s — keeping original", final_path, e)
                os.rename(assembled_path, final_path)
        else:
            os.rename(assembled_path, final_path)
            if is_image:
                try:
                    media_processor.process_image(final_path)
                except Exception as e:
                    logger.warning("Image processing failed for %s: %s", final_path, e)
        job.progress = 0.95
        db.commit()

        # 3. Insert DB row
        db_image = models.BundleImage(bundle_id=bundle.id, image_path=final_path)
        db.add(db_image)
        db.commit()
        db.refresh(db_image)

        job.image_id = db_image.id
        job.status = "completed"
        job.progress = 1.0
        db.commit()
    except Exception as e:
        logger.exception("Upload processing failed for %s", upload_id)
        if job is not None:
            job.status = "failed"
            job.error = str(e)
            try:
                db.commit()
            except Exception:
                pass
    finally:
        # Cleanup chunk dir + assembled temp file
        try:
            if os.path.exists(chunk_dir):
                shutil.rmtree(chunk_dir, ignore_errors=True)
        except Exception:
            pass
        try:
            if os.path.exists(assembled_path):
                os.remove(assembled_path)
        except Exception:
            pass
        db.close()


# ---------- LEGACY UPLOAD-IMAGE (kept for backward compat) ----------
@router.post("/{bundle_code}/upload-image")
def upload_image(
    bundle_code: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Legacy single-shot upload kept for callers that don't use chunked upload.
    Streams the file to disk, processes synchronously, then inserts the row.
    """
    bundle = crud.get_bundle_by_code(db, bundle_code)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    upload_folder = os.path.join(UPLOADS_DIR, bundle_code)
    os.makedirs(upload_folder, exist_ok=True)
    os.makedirs(TEMP_ROOT, exist_ok=True)

    filename = file.filename or "upload.bin"
    ext = os.path.splitext(filename)[1].lower()
    temp_path = os.path.join(TEMP_ROOT, f"legacy_{uuid.uuid4().hex}_{filename}")

    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        if ext in IMAGE_EXTS:
            kind, out_ext = "img", ext.lstrip(".") or "jpg"
            file_location = _next_available_path(db, bundle.id, bundle_code, kind, out_ext, upload_folder)
            shutil.move(temp_path, file_location)
            try:
                media_processor.process_image(file_location)
            except Exception as e:
                logger.warning("Image processing failed: %s", e)
        elif ext in VIDEO_EXTS:
            file_location = _next_available_path(db, bundle.id, bundle_code, "vid", "mp4", upload_folder)
            media_processor.process_video(temp_path, file_location)
            os.remove(temp_path)
        else:
            file_location = _next_available_path(db, bundle.id, bundle_code, "file", ext.lstrip(".") or "bin", upload_folder)
            shutil.move(temp_path, file_location)
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        raise HTTPException(status_code=500, detail=f"Media processing failed: {str(e)}")

    db_image = models.BundleImage(bundle_id=bundle.id, image_path=file_location)
    db.add(db_image)
    db.commit()
    return {"message": "Media uploaded and processed"}


# ---------- EDIT BUNDLE ----------
@router.patch("/{old_code}", response_model=schemas.BundleOut)
def update_bundle(
    old_code: str,
    bundle_update: schemas.BundleUpdate,
    db: Session = Depends(get_db),
):
    """Edit a bundle's name and/or code.

    Code change strategy:
      1. Short-circuit no-ops (code unchanged or empty).
      2. Pre-check that the new code isn't already taken in the DB or on
         disk. On collision, return 409 with a structured detail so the
         UI can offer a Swap dialog.
      3. Rename folder + files on disk first (has its own rollback).
      4. Write bundle_code + every image_path to the DB as one commit.
         If that commit fails, reverse the filesystem rename.
    """
    bundle = crud.get_bundle_by_code(db, old_code)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    # Update name if provided (independent of the code change).
    if bundle_update.bundle_name is not None:
        bundle.bundle_name = bundle_update.bundle_name or None
        db.commit()
        db.refresh(bundle)

    new_code = bundle_update.bundle_code
    if not new_code or new_code == old_code:
        return bundle

    # Collision check — DB.
    existing = crud.get_bundle_by_code(db, new_code)
    if existing:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "bundle_code_exists",
                "message": f"Bundle {new_code} already exists",
                "old_code": old_code,
                "new_code": new_code,
                "existing_bundle_code": existing.bundle_code,
                "existing_bundle_name": existing.bundle_name,
                "existing_item_count": len(existing.items),
                "existing_image_count": len(existing.images),
            },
        )
    # Collision check — filesystem. Shouldn't happen if DB is consistent,
    # but defensive: a leftover folder with the target code must not be
    # silently merged into.
    new_dir = os.path.join(UPLOADS_DIR, new_code)
    if os.path.exists(new_dir):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "upload_dir_exists",
                "message": f"An upload directory for {new_code} exists on disk",
            },
        )

    # Filesystem first (has rollback); then DB.
    try:
        _rename_bundle_on_disk(old_code, new_code)
    except OSError as e:
        logger.exception("Bundle rename FS step failed")
        raise HTTPException(status_code=500, detail=f"Filesystem rename failed: {e}")

    try:
        bundle.bundle_code = new_code
        for img in bundle.images:
            img.image_path = _rewrite_image_path(img.image_path, old_code, new_code)
        db.commit()
        db.refresh(bundle)
    except Exception:
        # DB failed — reverse the rename so we don't drift.
        try:
            _rename_bundle_on_disk(new_code, old_code)
        except Exception:
            logger.exception(
                "Rename rollback failed after DB error — FS may be inconsistent"
            )
        db.rollback()
        raise

    return bundle


# ---------- SWAP TWO BUNDLE CODES ----------
@router.post("/{code_a}/swap/{code_b}", response_model=list[schemas.BundleOut])
def swap_bundles(
    code_a: str,
    code_b: str,
    db: Session = Depends(get_db),
):
    """Swap the bundle codes of two existing bundles. Moves folders and
    renames files in one transaction-ish block; rolls everything back on
    any failure so the DB and disk never diverge.

    Returns both bundles in their post-swap state.
    """
    if code_a == code_b:
        raise HTTPException(
            status_code=400,
            detail="Cannot swap a bundle with itself",
        )

    bundle_a = crud.get_bundle_by_code(db, code_a)
    bundle_b = crud.get_bundle_by_code(db, code_b)
    if not bundle_a or not bundle_b:
        raise HTTPException(
            status_code=404,
            detail="One or both bundles not found",
        )

    # Step 1: swap folders + inside-file names.
    try:
        _swap_bundles_on_disk(code_a, code_b)
    except OSError as e:
        logger.exception("Bundle swap FS step failed")
        raise HTTPException(status_code=500, detail=f"Filesystem swap failed: {e}")

    # Step 2: swap codes in DB + rewrite image_paths, all in one commit.
    # Use a temp sentinel code so the UNIQUE index is never violated
    # mid-transaction.
    temp_code = f"__swap_{uuid.uuid4().hex[:8]}__"
    try:
        bundle_a.bundle_code = temp_code
        db.flush()
        bundle_b.bundle_code = code_a
        db.flush()
        bundle_a.bundle_code = code_b
        db.flush()
        for img in bundle_a.images:
            img.image_path = _rewrite_image_path(img.image_path, code_a, code_b)
        for img in bundle_b.images:
            img.image_path = _rewrite_image_path(img.image_path, code_b, code_a)
        db.commit()
        db.refresh(bundle_a)
        db.refresh(bundle_b)
    except Exception as e:
        db.rollback()
        # Put the filesystem back.
        try:
            _swap_bundles_on_disk(code_a, code_b)
        except Exception:
            logger.exception(
                "Swap FS rollback failed — FS may be inconsistent"
            )
        logger.exception("Bundle swap DB step failed")
        raise HTTPException(status_code=500, detail=f"Database swap failed: {e}")

    return [bundle_a, bundle_b]


# ---------- UPDATE ITEM ----------
@router.patch("/{bundle_code}/items/{item_id}", response_model=schemas.BundleItemOut)
def update_bundle_item(
    bundle_code: str,
    item_id: int,
    item: schemas.BundleItemCreate,
    db: Session = Depends(get_db),
):
    updated = crud.update_bundle_item(db, item_id, item)
    if not updated:
        raise HTTPException(status_code=404, detail="Item not found")
    return updated


# ---------- DELETE ITEM ----------
@router.delete("/{bundle_code}/items/{item_id}")
def delete_bundle_item(bundle_code: str, item_id: int, db: Session = Depends(get_db)):
    item = crud.delete_bundle_item(db, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"message": "Item deleted"}


# ---------- DELETE IMAGE ----------
@router.delete("/{bundle_code}/images/{image_id}")
def delete_bundle_image(bundle_code: str, image_id: int, db: Session = Depends(get_db)):
    image = crud.delete_bundle_image(db, image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    if os.path.exists(image.image_path):
        os.remove(image.image_path)
    return {"message": "Image deleted"}


# ---------- DELETE BUNDLE ----------
@router.delete("/{bundle_code}")
def delete_bundle(bundle_code: str, db: Session = Depends(get_db)):
    bundle = crud.delete_bundle(db, bundle_code)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    upload_folder = os.path.join(UPLOADS_DIR, bundle_code)
    if os.path.exists(upload_folder):
        shutil.rmtree(upload_folder)
    return {"message": "Bundle and all associated data deleted"}
