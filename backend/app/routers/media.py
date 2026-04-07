from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import StreamingResponse, FileResponse
import os
import mimetypes

router = APIRouter(prefix="/media", tags=["Media"])

@router.get("/{bundle_code}/{filename}")
async def get_media(
    bundle_code: str,
    filename: str,
    request: Request,
    range: str = Header(None),
    download: bool = False
):
    """
    Serves media files (images and videos).
    Includes a robust Byte-Range Request handler for Safari/iOS compatibility.
    When a Range header is detected (initial probe or seeking), it responds with 
    a 206 Partial Content status to satisfy strict browser requirements.
    """
    path = f"uploads/{bundle_code}/{filename}"
    
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File not found")

    file_size = os.path.getsize(path)
    content_type, _ = mimetypes.guess_type(path)
    if not content_type:
        content_type = "video/mp4" if filename.lower().endswith(".mp4") else "application/octet-stream"

    # 1. Handle Range Requests (Critical for Safari/iOS)
    if range:
        try:
            # Parse Range header: "bytes=start-end"
            range_type, range_val = range.split("=")
            if range_type != "bytes":
                raise ValueError()
            
            parts = range_val.split("-")
            start_str = parts[0].strip()
            end_str = parts[1].strip() if len(parts) > 1 else ""

            # Standard range parsing logic
            if not start_str and not end_str:
                raise ValueError()
                
            if not start_str: # -suffix
                end = file_size - 1
                start = file_size - int(end_str)
            elif not end_str: # start-
                start = int(start_str)
                end = file_size - 1
            else: # start-end
                start = int(start_str)
                end = int(end_str)
            
            # Boundary checks
            if start < 0: start = 0
            if end >= file_size: end = file_size - 1
            if start >= file_size or start > end:
                raise HTTPException(status_code=416, detail="Requested Range Not Satisfiable")

            chunk_size = (end - start) + 1
            
            # File iterator for streaming specific chunks
            def file_iterator(file_path, offset, length):
                with open(file_path, "rb") as f:
                    f.seek(offset)
                    remaining = length
                    while remaining > 0:
                        chunk = f.read(min(remaining, 1024 * 64))
                        if not chunk:
                            break
                        yield chunk
                        remaining -= len(chunk)

            headers = {
                "Content-Range": f"bytes {start}-{end}/{file_size}",
                "Accept-Ranges": "bytes",
                "Content-Length": str(chunk_size),
                "Content-Type": content_type,
            }

            if download:
                headers["Content-Disposition"] = f'attachment; filename="{filename}"'
            
            return StreamingResponse(
                file_iterator(path, start, chunk_size),
                status_code=206,
                headers=headers
            )
        except (ValueError, IndexError):
            # Fallback to full file if range is malformed
            pass

    # 2. For full file requests, use FileResponse but ensure Accept-Ranges is set
    # This helps Safari know it CAN ask for ranges in subsequent requests.
    return FileResponse(
        path, 
        media_type=content_type, 
        filename=filename if download else None,
        content_disposition_type="attachment" if download else "inline",
        headers={"Accept-Ranges": "bytes"}
    )
