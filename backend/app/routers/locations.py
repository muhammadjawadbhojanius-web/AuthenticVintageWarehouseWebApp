from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from .. import models
from ..database import get_db
from ..constants import LOCATION_RE

router = APIRouter(prefix="/locations", tags=["Locations"])


class LocationEntryOut(BaseModel):
    bundle_code: str
    location: str

    model_config = {"from_attributes": True}


class LocationUpsert(BaseModel):
    location: str


class BulkLocationItem(BaseModel):
    bundle_code: str
    location: str


class BulkLocationRequest(BaseModel):
    entries: list[BulkLocationItem]


class BulkLocationResult(BaseModel):
    saved: list[LocationEntryOut]
    errors: list[dict]


@router.get("/", response_model=list[LocationEntryOut])
def list_locations(db: Session = Depends(get_db)):
    """Return all location entries (DB and phantom bundle codes alike)."""
    return db.query(models.LocationEntry).order_by(
        models.LocationEntry.location,
        models.LocationEntry.bundle_code,
    ).all()


@router.put("/{bundle_code}", response_model=LocationEntryOut)
def upsert_location(
    bundle_code: str,
    payload: LocationUpsert,
    db: Session = Depends(get_db),
):
    """Assign or update a rack location for any bundle code (in-DB or not)."""
    loc = payload.location.strip().upper()
    if not LOCATION_RE.match(loc):
        raise HTTPException(
            status_code=400,
            detail="Location must look like 'AV-01' or 'AVG-12'",
        )
    code = bundle_code.strip().upper()

    entry = db.get(models.LocationEntry, code)
    if entry:
        entry.location = loc
    else:
        entry = models.LocationEntry(bundle_code=code, location=loc)
        db.add(entry)

    # Keep Bundle.location in sync if this code exists in the DB.
    bundle = db.query(models.Bundle).filter(
        models.Bundle.bundle_code == code
    ).first()
    if bundle:
        bundle.location = loc

    db.commit()
    db.refresh(entry)
    return entry


@router.post("/bulk", response_model=BulkLocationResult)
def bulk_upsert_locations(
    payload: BulkLocationRequest,
    db: Session = Depends(get_db),
):
    """
    Upsert multiple location entries in one call.
    Each item is validated independently; errors are collected and returned
    rather than aborting the whole batch.
    """
    saved: list[models.LocationEntry] = []
    errors: list[dict] = []

    for item in payload.entries:
        code = item.bundle_code.strip().upper()
        loc = item.location.strip().upper()
        if not LOCATION_RE.match(loc):
            errors.append({
                "bundle_code": code,
                "error": f"Invalid location '{loc}'",
            })
            continue

        entry = db.get(models.LocationEntry, code)
        if entry:
            entry.location = loc
        else:
            entry = models.LocationEntry(bundle_code=code, location=loc)
            db.add(entry)

        bundle = db.query(models.Bundle).filter(
            models.Bundle.bundle_code == code
        ).first()
        if bundle:
            bundle.location = loc

        db.flush()
        saved.append(entry)

    db.commit()
    for e in saved:
        db.refresh(e)

    return BulkLocationResult(saved=saved, errors=errors)


@router.delete("/{bundle_code}", response_model=dict)
def delete_location(bundle_code: str, db: Session = Depends(get_db)):
    """Clear the location for a bundle code."""
    code = bundle_code.strip().upper()
    entry = db.get(models.LocationEntry, code)
    if entry:
        db.delete(entry)
    bundle = db.query(models.Bundle).filter(
        models.Bundle.bundle_code == code
    ).first()
    if bundle:
        bundle.location = None
    db.commit()
    return {"detail": "Location cleared"}
