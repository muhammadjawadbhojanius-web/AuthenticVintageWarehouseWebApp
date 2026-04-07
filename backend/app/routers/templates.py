"""
Serves user-editable templates that the frontend renders at runtime.

The template files live under `backend/app/templates/` and are bind-mounted
into the container in docker-compose.yml so the user can edit them on the
host without rebuilding the image. Each request re-reads the file from
disk — there is no caching — so edits take effect immediately on the next
request.
"""

import json
import os

from fastapi import APIRouter, HTTPException

router = APIRouter(prefix="/templates", tags=["Templates"])

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "templates")


@router.get("/clipboard")
def get_clipboard_template():
    """
    Returns the bundle clipboard template as a JSON object.

    Shape:
        {
          "header": str,        # printf-style template with {placeholder} tokens
          "item": str,          # template applied per item
          "item_separator": str # joins items
          "footer": str
        }

    The frontend substitutes the placeholders using bundle and item data
    and writes the resulting string to the user's clipboard.
    """
    path = os.path.join(TEMPLATES_DIR, "clipboard.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Clipboard template not found")
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Clipboard template is not valid JSON: {e}",
        )
    return data
