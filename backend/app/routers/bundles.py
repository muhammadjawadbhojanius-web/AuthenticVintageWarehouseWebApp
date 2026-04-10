import os
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


# ---------- CREATE BUNDLE ----------
@router.post("/", response_model=schemas.BundleOut)
def create_bundle(bundle_in: schemas.BundleCreate, db: Session = Depends(get_db)):
    return crud.create_bundle(db, bundle_in.bundle_code, bundle_in.bundle_name)


# ---------- GET ALL BUNDLES ----------
@router.get("/", response_model=list[schemas.BundleOut])
def read_bundles(search: str = None, db: Session = Depends(get_db)):
    return crud.get_bundles(db, search=search)


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


# ---------- EDIT BUNDLE CODE ----------
@router.patch("/{old_code}", response_model=schemas.BundleOut)
def update_bundle_code(
    old_code: str,
    bundle_update: schemas.BundleUpdate,
    db: Session = Depends(get_db),
):
    new_code = bundle_update.bundle_code
    if old_code == new_code:
        return crud.get_bundle_by_code(db, old_code)

    updated_bundle = crud.update_bundle_code(db, old_code, new_code)
    if not updated_bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")

    old_dir = os.path.join(UPLOADS_DIR, old_code)
    new_dir = os.path.join(UPLOADS_DIR, new_code)
    if os.path.exists(old_dir):
        os.rename(old_dir, new_dir)
        for img in updated_bundle.images:
            img.image_path = img.image_path.replace(old_dir, new_dir)
        db.commit()

    return updated_bundle


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
