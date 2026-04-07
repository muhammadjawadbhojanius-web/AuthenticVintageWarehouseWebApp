import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session

# ---------------- DATABASE CONFIG ----------------
# In Docker the /app/data directory is a mounted volume so the DB persists
# across container rebuilds. Locally it falls back to ./warehouse.db.
_DB_DIR = os.environ.get("DB_DIR", "data")
os.makedirs(_DB_DIR, exist_ok=True)
DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{_DB_DIR}/warehouse.db")

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}  # only for SQLite
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

Base = declarative_base()

# ---------------- DB DEPENDENCY ----------------
def get_db() -> Session:
    """
    FastAPI dependency for getting a database session.
    Usage: db: Session = Depends(get_db)
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
