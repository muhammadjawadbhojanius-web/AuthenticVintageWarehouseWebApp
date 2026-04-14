import json
import logging
import shutil
import subprocess
from PIL import Image

logger = logging.getLogger(__name__)

# We rely on the system ffmpeg/ffprobe installed via apt in the Dockerfile.
# Resolved at module load so any missing-binary error fails loudly at
# startup rather than mid-upload.
FFMPEG_BIN = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"
FFPROBE_BIN = shutil.which("ffprobe") or "/usr/bin/ffprobe"

# What counts as "already web-ready" and therefore eligible for a lossless
# stream-copy remux instead of a CPU-heavy re-encode. Audio codec is
# irrelevant because we strip audio from every video regardless.
WEB_READY_VIDEO_CODECS = {"h264"}
MAX_REMUX_WIDTH = 720
MAX_REMUX_HEIGHT = 1280
MAX_REMUX_FPS = 30.5  # small tolerance for 29.97


def process_image(input_path: str):
    """Strips EXIF metadata from an image by re-saving it."""
    with Image.open(input_path) as img:
        data = list(img.getdata())
        out_img = Image.new(img.mode, img.size)
        out_img.putdata(data)
        out_img.save(input_path)


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

        return {
            "vcodec": (vstream.get("codec_name") or "").lower(),
            "acodec": (astream.get("codec_name") or "").lower() if astream else "",
            "width": int(vstream.get("width") or 0),
            "height": int(vstream.get("height") or 0),
            "fps": fps,
        }
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, json.JSONDecodeError, ValueError) as e:
        logger.warning("ffprobe failed for %s: %s", path, e)
        return None


def _is_web_ready(probe: dict) -> bool:
    """True if the video can be remuxed (stream-copied) instead of re-encoded."""
    # Fit either orientation inside the 720x1280 box.
    w, h = probe["width"], probe["height"]
    fits = (
        (w <= MAX_REMUX_WIDTH and h <= MAX_REMUX_HEIGHT)
        or (w <= MAX_REMUX_HEIGHT and h <= MAX_REMUX_WIDTH)
    )
    return (
        probe["vcodec"] in WEB_READY_VIDEO_CODECS
        and fits
        and probe["fps"] <= MAX_REMUX_FPS
    )


def _remux_video(input_path: str, output_path: str):
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
    subprocess.run(command, check=True, capture_output=True)


def _transcode_video(input_path: str, output_path: str):
    """
    Full re-encode to H.264/AAC MP4. Used when the input isn't already
    web-ready. Expensive on low-end CPUs; avoid when possible.
    """
    command = [
        FFMPEG_BIN,
        "-i", input_path,
        "-vf", "scale='min(720,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
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
    subprocess.run(command, check=True, capture_output=True)


def process_video(input_path: str, output_path: str):
    """
    Dispatcher: probes the input and picks the cheapest correct action.
    - Web-ready (H.264/AAC ≤720p ≤30fps, typical client-compressor output):
      stream-copy remux, ~0% CPU, 1-3 seconds.
    - Anything else (exotic codec, too large, unknown): full re-encode.
    Probe failures fall back to full transcode to preserve correctness.
    """
    probe = _probe_video(input_path)
    if probe and _is_web_ready(probe):
        logger.info(
            "Remuxing (stream-copy) %s: %s %dx%d @ %.2ffps",
            input_path, probe["vcodec"], probe["width"], probe["height"], probe["fps"],
        )
        try:
            _remux_video(input_path, output_path)
            return
        except subprocess.CalledProcessError as e:
            logger.warning("Remux failed, falling back to transcode: %s", e)
    else:
        logger.info(
            "Transcoding %s (probe=%s)",
            input_path, "unavailable" if probe is None else probe,
        )
    _transcode_video(input_path, output_path)
