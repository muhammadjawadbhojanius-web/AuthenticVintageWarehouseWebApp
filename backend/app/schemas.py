from pydantic import BaseModel, field_validator
from typing import List, Optional
from datetime import datetime

# ---------- USER ----------

class UserCreate(BaseModel):
    username: str
    password: str


class UserLogin(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_approved: int

    model_config = {
        "from_attributes": True
    }

class UserApproveRequest(BaseModel):
    role: str

class PasswordResetRequest(BaseModel):
    username: str
    password: str

# ---------- BUNDLE ----------

class BundleCreate(BaseModel):
    bundle_code: str
    bundle_name: Optional[str] = None


class BundleStatusUpdate(BaseModel):
    status: str


class BundlePostedUpdate(BaseModel):
    # 0 = draft, 1 = posted, 2 = sold
    posted: int


class BundleLocationUpdate(BaseModel):
    # Format "AV-NN" / "AVG-NN", or empty string / None to clear.
    location: Optional[str] = None

class BundleImageOut(BaseModel):
    id: int
    image_path: str

    model_config = {
        "from_attributes": True
    }


class BundleOut(BaseModel):
    id: int
    bundle_code: str
    bundle_name: Optional[str] = None
    status: str
    posted: int = 0
    location: Optional[str] = None
    created_at: datetime
    items: List['BundleItemOut'] = []
    images: List[BundleImageOut] = []

    model_config = {
        "from_attributes": True
    }


class BundleUpdate(BaseModel):
    bundle_code: str | None = None
    bundle_name: str | None = None


class BundleCodesIn(BaseModel):
    codes: List[str]


class BundleCodesValidation(BaseModel):
    valid: List[str]
    missing: List[str]

# ---------- BUNDLE ITEM ----------

class BundleItemCreate(BaseModel):
    gender: str
    brand: str
    article: str
    number_of_pieces: int
    gift_pcs: int = 0
    grade: str
    size_variation: str
    comments: Optional[str] = None

    @field_validator("brand", "article", mode="before")
    @classmethod
    def _normalize_comma_list(cls, v: str) -> str:
        """Normalize comma-separated brand/article values: strip whitespace
        around each entry and collapse any double-commas."""
        if not isinstance(v, str):
            return v
        parts = [p.strip() for p in v.split(",")]
        return ", ".join(p for p in parts if p)


class BundleItemOut(BaseModel):
    id: int
    gender: str
    brand: str
    article: str
    number_of_pieces: int
    gift_pcs: int
    grade: str
    size_variation: str
    comments: Optional[str] = None

    model_config = {
        "from_attributes": True
    }


# ---------- CATALOG ----------

class CatalogItemOut(BaseModel):
    id: int
    name: str
    is_approved: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CatalogItemCreate(BaseModel):
    name: str


class CatalogBulkCreate(BaseModel):
    names: List[str]


# ---------- CHUNKED UPLOAD ----------

class UploadInitRequest(BaseModel):
    filename: str
    total_size: int
    total_chunks: int


class UploadInitResponse(BaseModel):
    upload_id: str


class UploadStatusResponse(BaseModel):
    status: str
    progress: float
    error: Optional[str] = None
    image_id: Optional[int] = None
