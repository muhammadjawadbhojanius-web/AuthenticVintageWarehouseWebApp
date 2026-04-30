import json
import logging
import shutil
import subprocess
from typing import Callable
from PIL import Image, ImageOps

logger = logging.getLogger(__name__)

# We rely on the system ffmpeg/ffprobe installed via apt in the Dockerfile.
# Resolved at module load so any missing-binary error fails loudly at
# startup rather than mid-upload.
FFMPEG_BIN = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
FFPROBE_BIN = shutil.which("ffprobe") or "/usr/bin/ffprobe"

# What counts as "already web-ready" and therefore eligible for a lossless
# stream-copy remux instead of a CPU-heavy re-encode. Audio codec is
# irrelevant because we strip audio from every video regardless.
#
# The window is H.264 ≤1080p ≤30fps — the client compressor's smart-plan
# target. Sources that fit this can be stream-copied (~0% CPU). Anything
# else (rare: non-H.264, >1080p, >30fps) falls through to libx264.
WEB_READY_VIDEO_CODECS = {"h264"}
MAX_REMUX_SHORT_EDGE = 1080  # short edge of 1080p in either orientation
MAX_REMUX_LONG_EDGE = 1920   # long edge of 1080p in either orientation
MAX_REMUX_FPS = 30.5         # small tolerance for 29.97


def process_image(input_path: str):
    """
    Physically rotates the image to match its EXIF Orientation tag, then
    strips all EXIF metadata. iPhones record sensor data in a fixed
    landscape layout and rely on the Orientation tag to tell viewers to
    rotate for display; stripping EXIF without rotating first leaves the
    image sideways.
    """
    with Image.open(input_path) as img:
        rotated = ImageOps.exif_transpose(img)
        # Preserve JPEG quality reasonably and avoid ballooning file size.
        save_kwargs = {}
        fmt = (img.format or "").upper()
        if fmt in ("JPEG", "JPG"):
            save_kwargs = {"format": "JPEG", "quality": 90, "optimize": True}
        elif fmt == "PNG":
            save_kwargs = {"format": "PNG", "optimize": True}
        elif fmt == "WEBP":
            save_kwargs = {"format": "WEBP", "quality": 90}
        rotated.save(input_path, **save_kwargs)


def _probe_video(path: str) -> dict | None:
    """
    Returns dict with keys: vcodec, acodec, width, height, fps. Returns None
    on probe failure (caller should fall back to full transcode).
    """
    try:
        result = subprocess.run(
            [
                FFPROBE_BIN,
                "-v", "error",
                "-print_format", "json",
                "-show_streams",
                "-show_format",
                path,
            ],
            check=True,
            capture_output=True,
            timeout=30,
        )
        data = json.loads(result.stdout)
        streams = data.get("streams", [])

        vstream = next((s for s in streams if s.get("codec_type") == "video"), None)
        astream = next((s for s in streams if s.get("codec_type") == "audio"), None)
        if not vstream:
            return None

        # avg_frame_rate is a rational like "30000/1001". Evaluate it.
        fps = 0.0
        fr = vstream.get("avg_frame_rate") or vstream.get("r_frame_rate") or "0/1"
        try:
            num, den = fr.split("/")
            den_f = float(den)
            if den_f > 0:
                fps = float(num) / den_f
        except (ValueError, ZeroDivisionError):
            pass

        duration_sec = 0.0
        try:
            raw = vstream.get("duration") or data.get("format", {}).get("duration") or "0"
            duration_sec = float(raw)
        except (ValueError, TypeError):
            pass

        return {
            "vcodec": (vstream.get("codec_name") or "").lower(),
            "acodec": (astream.get("codec_name") or "").lower() if astream else "",
            "width": int(vstream.get("width") or 0),
            "height": int(vstream.get("height") or 0),
            "fps": fps,
            "duration_sec": duration_sec,
        }
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError, ValueError) as e:
        logger.warning("ffprobe failed for %s: %s", path, e)
        return None


def _is_web_ready(probe: dict) -> bool:
    """True if the video can be remuxed (stream-copied) instead of re-encoded."""
    # Fit either orientation inside the 1080x1920 box.
    w, h = probe["width"], probe["height"]
    long_edge = max(w, h)
    short_edge = min(w, h)
    fits = long_edge <= MAX_REMUX_LONG_EDGE and short_edge <= MAX_REMUX_SHORT_EDGE
    return (
        probe["vcodec"] in WEB_READY_VIDEO_CODECS
        and fits
        and probe["fps"] <= MAX_REMUX_FPS
    )


def _run_ffmpeg_with_progress(
    command: list,
    on_progress: Callable[[float], None] | None = None,
    duration_sec: float = 0,
):
    """
    Run an ffmpeg command. When on_progress is provided and duration_sec > 0,
    injects -progress pipe:1 so ffmpeg streams out_time_us lines and calls
    on_progress(0..1) in real time. Falls back to subprocess.run otherwise.
    """
    if on_progress and duration_sec > 0:
        cmd = [command[0], "-progress", "pipe:1"] + command[1:]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
        assert proc.stdout is not None
        for line in proc.stdout:
            if line.startswith("out_time_us="):
                try:
                    us = int(line.split("=", 1)[1])
                    if us >= 0:
                        on_progress(min(us / (duration_sec * 1_000_000), 1.0))
                except (ValueError, IndexError):
                    pass
        proc.wait()
        if proc.returncode != 0:
            raise subprocess.CalledProcessError(proc.returncode, cmd)
    else:
        subprocess.run(command, check=True, capture_output=True)


def _remux_video(
    input_path: str,
    output_path: str,
    on_progress: Callable[[float], None] | None = None,
    duration_sec: float = 0,
):
    """
    Stream-copy the video into a clean MP4 container: no re-encode, just
    strip metadata and audio, and move the moov atom to the front for
    progressive playback. Completes in 1–3 seconds and uses ~0% CPU.
    Audio is dropped because it's not used in this workflow.
    """
    command = [
        FFMPEG_BIN,
        "-i", input_path,
        "-c", "copy",
        "-an",  # drop audio
        "-map_metadata", "-1",
        "-movflags", "+faststart",
        "-y",
        output_path,
    ]
    _run_ffmpeg_with_progress(command, on_progress, duration_sec)


def _transcode_video(
    input_path: str,
    output_path: str,
    on_progress: Callable[[float], None] | None = None,
    duration_sec: float = 0,
):
    """
    Full re-encode to H.264 MP4. Used when the input isn't already
    web-ready. Expensive on low-end CPUs; avoid when possible. Targets
    1080p / 30 fps to match the remux window so output is consistent
    with what the client-side compressor produces. Metadata is stripped
    (-map_metadata -1) — the file's mtime survives, which is what
    gallery apps use for "Recent" after download.
    """
    command = [
        FFMPEG_BIN,
        "-i", input_path,
        "-vf", "scale='min(1080,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-r", "30",
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "fast",
        "-an",  # drop audio
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-map_metadata", "-1",
        "-y",
        output_path,
    ]
    _run_ffmpeg_with_progress(command, on_progress, duration_sec)


def process_video(
    input_path: str,
    output_path: str,
    on_progress: Callable[[float], None] | None = None,
):
    """
    Dispatcher: probes the input and picks the cheapest correct action.
    - Web-ready (H.264 ≤1080p ≤30fps, typical client-compressor output):
      stream-copy remux, ~0% CPU, 1-3 seconds.
    - Anything else (exotic codec, too large, unknown): full re-encode.
    Probe failures fall back to full transcode to preserve correctness.
    """
    probe = _probe_video(input_path)
    duration_sec = (probe or {}).get("duration_sec", 0) or 0
    if probe and _is_web_ready(probe):
        logger.info(
            "Remuxing (stream-copy) %s: %s %dx%d @ %.2ffps",
            input_path, probe["vcodec"], probe["width"], probe["height"], probe["fps"],
        )
        try:
            _remux_video(input_path, output_path, on_progress, duration_sec)
            return
        except subprocess.CalledProcessError as e:
            logger.warning("Remux failed, falling back to transcode: %s", e)
    else:
        logger.info(
            "Transcoding %s (probe=%s)",
            input_path, "unavailable" if probe is None else probe,
        )
    _transcode_video(input_path, output_path, on_progress, duration_sec)
