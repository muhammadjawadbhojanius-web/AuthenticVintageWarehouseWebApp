from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func, text

from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/catalog", tags=["Catalog"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_brand(db: Session, brand_id: int) -> models.Brand:
    b = db.get(models.Brand, brand_id)
    if not b:
        raise HTTPException(status_code=404, detail="Brand not found")
    return b


def _find_article(db: Session, article_id: int) -> models.Article:
    a = db.get(models.Article, article_id)
    if not a:
        raise HTTPException(status_code=404, detail="Article not found")
    return a


# ---------------------------------------------------------------------------
# BRANDS
# ---------------------------------------------------------------------------

@router.get("/brands", response_model=list[schemas.CatalogItemOut])
def list_approved_brands(db: Session = Depends(get_db)):
    """Return only approved brands (used to populate the combobox)."""
    return (
        db.query(models.Brand)
        .filter(models.Brand.is_approved == 1)
        .order_by(func.lower(models.Brand.name))
        .all()
    )


@router.get("/brands/all", response_model=list[schemas.CatalogItemOut])
def list_all_brands(db: Session = Depends(get_db)):
    """Return all brands including pending (Admin only in the UI)."""
    return (
        db.query(models.Brand)
        .order_by(models.Brand.is_approved.desc(), func.lower(models.Brand.name))
        .all()
    )


@router.post("/brands", response_model=schemas.CatalogItemOut, status_code=201)
def create_brand(payload: schemas.CatalogItemCreate, db: Session = Depends(get_db)):
    """Submit a new brand as pending approval (used by the combobox Create flow)."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    existing = db.query(models.Brand).filter(
        func.lower(models.Brand.name) == name.lower()
    ).first()
    if existing:
        return existing
    brand = models.Brand(name=name, is_approved=0)
    db.add(brand)
    db.commit()
    db.refresh(brand)
    return brand


@router.post("/brands/bulk", response_model=list[schemas.CatalogItemOut], status_code=201)
def bulk_create_brands(payload: schemas.CatalogBulkCreate, db: Session = Depends(get_db)):
    """
    Admin bulk-add brands — all created as approved.
    Duplicates (case-insensitive) are silently skipped.
    Returns the full list of created + already-existing entries.
    """
    result = []
    for raw in payload.names:
        name = raw.strip()
        if not name:
            continue
        existing = db.query(models.Brand).filter(
            func.lower(models.Brand.name) == name.lower()
        ).first()
        if existing:
            result.append(existing)
        else:
            brand = models.Brand(name=name, is_approved=1)
            db.add(brand)
            db.flush()
            result.append(brand)
    db.commit()
    for r in result:
        db.refresh(r)
    return result


@router.patch("/brands/{brand_id}/approve", response_model=schemas.CatalogItemOut)
def approve_brand(brand_id: int, db: Session = Depends(get_db)):
    brand = _find_brand(db, brand_id)
    brand.is_approved = 1
    db.commit()
    db.refresh(brand)
    return brand


@router.delete("/brands/{brand_id}", response_model=dict)
def delete_brand(brand_id: int, db: Session = Depends(get_db)):
    brand = _find_brand(db, brand_id)
    db.delete(brand)
    db.commit()
    return {"detail": "Brand deleted"}


# ---------------------------------------------------------------------------
# ARTICLES
# ---------------------------------------------------------------------------

@router.get("/articles", response_model=list[schemas.CatalogItemOut])
def list_approved_articles(db: Session = Depends(get_db)):
    """Return only approved articles (used to populate the combobox)."""
    return (
        db.query(models.Article)
        .filter(models.Article.is_approved == 1)
        .order_by(func.lower(models.Article.name))
        .all()
    )


@router.get("/articles/all", response_model=list[schemas.CatalogItemOut])
def list_all_articles(db: Session = Depends(get_db)):
    """Return all articles including pending (Admin only in the UI)."""
    return (
        db.query(models.Article)
        .order_by(models.Article.is_approved.desc(), func.lower(models.Article.name))
        .all()
    )


@router.post("/articles", response_model=schemas.CatalogItemOut, status_code=201)
def create_article(payload: schemas.CatalogItemCreate, db: Session = Depends(get_db)):
    """Submit a new article as pending approval (used by the combobox Create flow)."""
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name cannot be empty")
    existing = db.query(models.Article).filter(
        func.lower(models.Article.name) == name.lower()
    ).first()
    if existing:
        return existing
    article = models.Article(name=name, is_approved=0)
    db.add(article)
    db.commit()
    db.refresh(article)
    return article


@router.post("/articles/bulk", response_model=list[schemas.CatalogItemOut], status_code=201)
def bulk_create_articles(payload: schemas.CatalogBulkCreate, db: Session = Depends(get_db)):
    """
    Admin bulk-add articles — all created as approved.
    Duplicates (case-insensitive) are silently skipped.
    Returns the full list of created + already-existing entries.
    """
    result = []
    for raw in payload.names:
        name = raw.strip()
        if not name:
            continue
        existing = db.query(models.Article).filter(
            func.lower(models.Article.name) == name.lower()
        ).first()
        if existing:
            result.append(existing)
        else:
            article = models.Article(name=name, is_approved=1)
            db.add(article)
            db.flush()
            result.append(article)
    db.commit()
    for r in result:
        db.refresh(r)
    return result


@router.patch("/articles/{article_id}/approve", response_model=schemas.CatalogItemOut)
def approve_article(article_id: int, db: Session = Depends(get_db)):
    article = _find_article(db, article_id)
    article.is_approved = 1
    db.commit()
    db.refresh(article)
    return article


@router.delete("/articles/{article_id}", response_model=dict)
def delete_article(article_id: int, db: Session = Depends(get_db)):
    article = _find_article(db, article_id)
    db.delete(article)
    db.commit()
    return {"detail": "Article deleted"}


# ---------------------------------------------------------------------------
# MERGE
# ---------------------------------------------------------------------------

@router.post("/brands/verify", response_model=list[schemas.CatalogItemOut])
def verify_brands(db: Session = Depends(get_db)):
    """
    Scan every distinct brand value in bundle_items.
    - Unknown brands: added as pending and bundle_items normalized to stripped name.
    - Known brands (approved or pending): bundle_items normalized to the canonical
      catalog name so whitespace/casing variants don't cause repeated warnings.
    Returns only the newly created entries.
    """
    rows = db.execute(
        text("SELECT DISTINCT brand FROM bundle_items WHERE brand IS NOT NULL AND brand != ''")
    ).fetchall()
    added = []
    for (raw,) in rows:
        name = raw.strip()
        if not name:
            continue
        existing = db.query(models.Brand).filter(
            func.lower(models.Brand.name) == name.lower()
        ).first()
        if not existing:
            brand = models.Brand(name=name, is_approved=0)
            db.add(brand)
            db.flush()
            added.append(brand)
            canonical = name
        else:
            canonical = existing.name
        # Normalize bundle_items to the canonical name so this raw variant
        # never resurfaces on the next Verify run.
        if raw != canonical:
            db.execute(
                text("UPDATE bundle_items SET brand = :canonical WHERE brand = :raw"),
                {"canonical": canonical, "raw": raw},
            )
    db.commit()
    for b in added:
        db.refresh(b)
    return added


@router.post("/articles/verify", response_model=list[schemas.CatalogItemOut])
def verify_articles(db: Session = Depends(get_db)):
    """
    Scan every distinct article value in bundle_items.
    - Unknown articles: added as pending and bundle_items normalized to stripped name.
    - Known articles: bundle_items normalized to the canonical catalog name.
    Returns only the newly created entries.
    """
    rows = db.execute(
        text("SELECT DISTINCT article FROM bundle_items WHERE article IS NOT NULL AND article != ''")
    ).fetchall()
    added = []
    for (raw,) in rows:
        name = raw.strip()
        if not name:
            continue
        existing = db.query(models.Article).filter(
            func.lower(models.Article.name) == name.lower()
        ).first()
        if not existing:
            article = models.Article(name=name, is_approved=0)
            db.add(article)
            db.flush()
            added.append(article)
            canonical = name
        else:
            canonical = existing.name
        if raw != canonical:
            db.execute(
                text("UPDATE bundle_items SET article = :canonical WHERE article = :raw"),
                {"canonical": canonical, "raw": raw},
            )
    db.commit()
    for a in added:
        db.refresh(a)
    return added


@router.patch("/brands/{source_id}/merge/{target_id}", response_model=schemas.CatalogItemOut)
def merge_brand(source_id: int, target_id: int, db: Session = Depends(get_db)):
    """
    Merge source brand into target brand.
    Updates every bundle_item that stored source.name → target.name, then
    deletes the source catalog entry. Works regardless of approval status so
    admins can consolidate any two entries.
    """
    source = _find_brand(db, source_id)
    target = _find_brand(db, target_id)
    if source_id == target_id:
        raise HTTPException(status_code=400, detail="Source and target must be different")
    db.execute(
        text("UPDATE bundle_items SET brand = :target WHERE LOWER(TRIM(brand)) = LOWER(:source)"),
        {"target": target.name, "source": source.name},
    )
    db.delete(source)
    db.commit()
    db.refresh(target)
    return target


@router.patch("/articles/{source_id}/merge/{target_id}", response_model=schemas.CatalogItemOut)
def merge_article(source_id: int, target_id: int, db: Session = Depends(get_db)):
    """
    Merge source article into target article.
    Updates every bundle_item that stored source.name → target.name, then
    deletes the source catalog entry.
    """
    source = _find_article(db, source_id)
    target = _find_article(db, target_id)
    if source_id == target_id:
        raise HTTPException(status_code=400, detail="Source and target must be different")
    db.execute(
        text("UPDATE bundle_items SET article = :target WHERE LOWER(TRIM(article)) = LOWER(:source)"),
        {"target": target.name, "source": source.name},
    )
    db.delete(source)
    db.commit()
    db.refresh(target)
    return target
