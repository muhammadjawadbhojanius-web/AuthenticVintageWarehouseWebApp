from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload
from . import models
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


# ---------- USER ----------

def create_user(db: Session, username: str, password: str):
    hashed_password = pwd_context.hash(password)
    
    # Check if any users exist
    user_count = db.query(models.User).count()
    is_first_user = user_count == 0
    
    role = "Admin" if is_first_user else "Content Creators"
    is_approved = 1 if is_first_user else 0
    
    user = models.User(
        username=username, 
        password=hashed_password,
        role=role,
        is_approved=is_approved
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_user_by_username(db: Session, username: str):
    return db.query(models.User).filter(models.User.username == username).first()


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_users(db: Session):
    return db.query(models.User).all()


# ---------- BUNDLE ----------

from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException

def create_bundle(db: Session, bundle_code: str, bundle_name: str = None):
    bundle = models.Bundle(bundle_code=bundle_code, bundle_name=bundle_name)
    db.add(bundle)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Bundle code already exists")
    db.refresh(bundle)
    return bundle



def get_bundle(db: Session, bundle_id: int):
    return (
        db.query(models.Bundle)
        .options(selectinload(models.Bundle.items), selectinload(models.Bundle.images))
        .filter(models.Bundle.id == bundle_id)
        .first()
    )


def get_bundle_by_code(db: Session, bundle_code: str):
    return (
        db.query(models.Bundle)
        .options(selectinload(models.Bundle.items), selectinload(models.Bundle.images))
        .filter(models.Bundle.bundle_code == bundle_code)
        .first()
    )



# ---------- BUNDLE ITEM ----------

def add_bundle_item(db: Session, bundle_code: str, item_data):
    bundle = get_bundle_by_code(db, bundle_code)

    if not bundle:
        return None

    db_item = models.BundleItem(
        bundle_id=bundle.id,
        gender=item_data.gender,
        brand=item_data.brand,
        article=item_data.article,
        number_of_pieces=item_data.number_of_pieces,
        gift_pcs=item_data.gift_pcs,
        grade=item_data.grade,
        size_variation=item_data.size_variation,
        comments=item_data.comments
    )

    db.add(db_item)
    db.commit()
    db.refresh(db_item)

    return db_item


def get_bundles(db: Session, search: str = None):
    # selectinload issues exactly two extra queries (one for all items,
    # one for all images) regardless of bundle count, instead of N+1.
    query = (
        db.query(models.Bundle)
        .options(selectinload(models.Bundle.items), selectinload(models.Bundle.images))
    )

    if search:
        search_filter = f"%{search}%"
        query = query.outerjoin(models.BundleItem).filter(
            or_(
                models.Bundle.bundle_code.ilike(search_filter),
                models.Bundle.bundle_name.ilike(search_filter),
                models.BundleItem.article.ilike(search_filter),
                models.BundleItem.brand.ilike(search_filter),
            )
        ).distinct()

    return query.order_by(models.Bundle.created_at.desc()).all()


def update_bundle_status(db: Session, bundle_code: str, new_status: str):
    bundle = get_bundle_by_code(db, bundle_code)

    if not bundle:
        return None

    bundle.status = new_status
    db.commit()
    db.refresh(bundle)

    return bundle

def get_user_by_id(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()


def delete_bundle_image(db: Session, image_id: int):
    image = db.query(models.BundleImage).filter(models.BundleImage.id == image_id).first()
    if image:
        db.delete(image)
        db.commit()
    return image


def delete_bundle_item(db: Session, item_id: int):
    item = db.query(models.BundleItem).filter(models.BundleItem.id == item_id).first()
    if item:
        db.delete(item)
        db.commit()
    return item


def update_bundle_item(db: Session, item_id: int, item_data):
    item = db.query(models.BundleItem).filter(models.BundleItem.id == item_id).first()
    if not item:
        return None
    item.gender = item_data.gender
    item.brand = item_data.brand
    item.article = item_data.article
    item.number_of_pieces = item_data.number_of_pieces
    item.gift_pcs = item_data.gift_pcs
    item.grade = item_data.grade
    item.size_variation = item_data.size_variation
    item.comments = item_data.comments
    db.commit()
    db.refresh(item)
    return item


def update_bundle_code(db: Session, old_code: str, new_code: str):
    bundle = get_bundle_by_code(db, old_code)
    if not bundle:
        return None
    
    try:
        bundle.bundle_code = new_code
        db.commit()
        db.refresh(bundle)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="New bundle code already exists")
    
    return bundle


def delete_bundle(db: Session, bundle_code: str):
    bundle = get_bundle_by_code(db, bundle_code)
    if not bundle:
        return None
    
    # Delete related items and images explicitly
    db.query(models.BundleItem).filter(models.BundleItem.bundle_id == bundle.id).delete()
    db.query(models.BundleImage).filter(models.BundleImage.bundle_id == bundle.id).delete()
    
    db.delete(bundle)
    db.commit()
    return bundle
