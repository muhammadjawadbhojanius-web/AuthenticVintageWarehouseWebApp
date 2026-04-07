from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from fastapi.security import OAuth2PasswordRequestForm

from .. import schemas, crud, auth
from ..database import get_db  # use the centralized get_db

router = APIRouter(prefix="/users", tags=["Users"])

# ---------- REGISTER ----------
@router.post("/register", response_model=schemas.UserOut)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    return crud.create_user(db, user.username, user.password)

# ---------- LOGIN ----------
@router.post("/login")
def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = auth.authenticate_user(db, form_data.username, form_data.password)

    if not user:
        raise HTTPException(
            status_code=400,
            detail="Incorrect username or password"
        )

    access_token = auth.create_access_token(
        data={
            "sub": user.username,
            "role": user.role,
            "user_id": user.id
        }
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "username": user.username,
        "role": user.role
    }

# ---------- GET ALL USERS (Admin) ----------
@router.get("/", response_model=list[schemas.UserOut])
def read_users(db: Session = Depends(get_db)):
    return crud.get_users(db)

@router.patch("/{user_id}/approve", response_model=schemas.UserOut)
def approve_user(user_id: int, request: schemas.UserApproveRequest, db: Session = Depends(get_db)):
    user = crud.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_approved = 1
    user.role = request.role
    db.commit()
    db.refresh(user)
    return user

@router.patch("/{user_id}/role", response_model=schemas.UserOut)
def update_user_role(user_id: int, request: schemas.UserApproveRequest, db: Session = Depends(get_db)):
    user = crud.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.role = request.role
    db.commit()
    db.refresh(user)
    return user

@router.patch("/{user_id}/reject", response_model=schemas.UserOut)
def reject_user(user_id: int, db: Session = Depends(get_db)):
    user = crud.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user.is_approved = -1
    db.commit()
    db.refresh(user)
    return user

@router.post("/reset-password", response_model=schemas.UserOut)
def reset_password(
    request: schemas.PasswordResetRequest,
    db: Session = Depends(get_db),
):
    """
    Self-service password reset (no auth — user is on the login screen).

    Rules enforced here:
      - Admin accounts are locked: their password can never be changed by anyone,
        not even the admin themselves. Returns 403.
      - Any other user can reset their own password by username, but is then
        moved back to pending approval (is_approved = 0) and must be re-approved
        in person by an admin before they can log in again.
    """
    if not request.password or len(request.password) < 1:
        raise HTTPException(status_code=400, detail="Password cannot be empty")

    user = crud.get_user_by_username(db, request.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == "Admin":
        raise HTTPException(
            status_code=403,
            detail="Admin password cannot be reset.",
        )

    user.password = crud.pwd_context.hash(request.password)
    user.is_approved = 0  # back to pending — must be re-approved in person
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", response_model=dict)
def delete_user(user_id: int, db: Session = Depends(get_db)):
    user = crud.get_user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db.delete(user)
    db.commit()
    return {"detail": "User deleted"}
