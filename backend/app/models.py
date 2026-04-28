from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Float
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True)
    password = Column(String)
    role = Column(String, default="worker")
    is_approved = Column(Integer, default=0)  # 0 = not approved, 1 = approved


class Bundle(Base):
    __tablename__ = "bundles"

    id = Column(Integer, primary_key=True, index=True)
    bundle_code = Column(String, unique=True)
    bundle_name = Column(String, nullable=True)
    status = Column(String, default="pending")
    # 0 = draft (default), 1 = posted. Togglable by Admins and Listing
    # Executives from the bundle card. An idempotent ALTER TABLE in
    # main.py adds this column to pre-existing databases.
    posted = Column(Integer, default=0, nullable=False)
    # Physical warehouse rack location, format "AV-NN" or "AVG-NN".
    # Distinct from bundle_code (which is "AV-NNNN" / "AVG-NNNN").
    # Multiple bundles can share a location. Admin-managed.
    location = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.now)

    items = relationship("BundleItem", back_populates="bundle")
    images = relationship("BundleImage", back_populates="bundle")


class BundleItem(Base):
    __tablename__ = "bundle_items"

    id = Column(Integer, primary_key=True)
    bundle_id = Column(Integer, ForeignKey("bundles.id"), index=True)
    gender = Column(String) # Men, Women, Unisex, Kids
    brand = Column(String)  # Can store comma separated
    article = Column(String) # Can store comma separated
    number_of_pieces = Column(Integer)
    gift_pcs = Column(Integer, default=0)
    grade = Column(String) # A, B, C, A/B, B/C, A/B/C
    size_variation = Column(String)
    comments = Column(String, nullable=True)

    bundle = relationship("Bundle", back_populates="items")


class BundleImage(Base):
    __tablename__ = "bundle_images"

    id = Column(Integer, primary_key=True)
    bundle_id = Column(Integer, ForeignKey("bundles.id"), index=True)
    image_path = Column(String)

    bundle = relationship("Bundle", back_populates="images")


class Brand(Base):
    __tablename__ = "brands"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    is_approved = Column(Integer, default=0)  # 0 = pending, 1 = approved
    created_at = Column(DateTime, default=datetime.now)


class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True)
    is_approved = Column(Integer, default=0)  # 0 = pending, 1 = approved
    created_at = Column(DateTime, default=datetime.now)


class UploadJob(Base):
    """Tracks a chunked upload from init through processing."""
    __tablename__ = "upload_jobs"

    id = Column(Integer, primary_key=True, index=True)
    upload_id = Column(String, unique=True, index=True)
    bundle_id = Column(Integer, ForeignKey("bundles.id"))
    filename = Column(String)
    total_size = Column(Integer, default=0)
    total_chunks = Column(Integer, default=0)
    received_chunks = Column(Integer, default=0)
    status = Column(String, default="pending")  # pending|processing|completed|failed
    progress = Column(Float, default=0.0)        # 0..1 (processing progress)
    error = Column(String, nullable=True)
    image_id = Column(Integer, nullable=True)    # set on completion
    created_at = Column(DateTime, default=datetime.now)
