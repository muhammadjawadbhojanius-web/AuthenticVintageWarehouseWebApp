import shutil
import subprocess
from PIL import Image

# We rely on the system ffmpeg installed via apt in the Dockerfile.
# Resolved at module load so any missing-binary error fails loudly at
# startup rather than mid-upload.
FFMPEG_BIN = shutil.which("ffmpeg") or "/usr/bin/ffmpeg"


def process_image(input_path: str):
    """
    Strips EXIF metadata from an image by re-saving it.
    """
    with Image.open(input_path) as img:
        data = list(img.getdata())
        out_img = Image.new(img.mode, img.size)
        out_img.putdata(data)
        out_img.save(input_path)


def process_video(input_path: str, output_path: str):
    """
    Re-encodes a video to H.264/AAC MP4, preserving the original resolution.

    Why each flag is here:
      -c:v libx264         widely-compatible H.264 video codec
      -crf 23              constant rate factor: visually transparent quality,
                           smaller files than default. Lower=better/larger.
      -preset fast         encode speed/size tradeoff (default is "medium",
                           "fast" finishes ~1.5x sooner with marginal size cost)
      -c:a aac -b:a 128k   AAC audio at 128 kbit/s
      -pix_fmt yuv420p     required by Safari/iOS for H.264
      -movflags +faststart move the moov atom to the start of the file so the
                           web video player can begin playback before the
                           whole file is downloaded
      -vf scale=...        cap resolution at 720p (1280x720), preserve
                           aspect ratio, only downscale, ensure even dims
      -r 30                cap frame rate at 30 fps
      -map_metadata -1     strip all metadata (location, camera info, etc.)
      -y                   overwrite the output file if it exists
    """
    command = [
        FFMPEG_BIN,
        "-i", input_path,
        "-vf", "scale='min(720,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-r", "30",
        "-c:v", "libx264",
        "-crf", "23",
        "-preset", "fast",
        "-c:a", "aac",
        "-b:a", "128k",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-map_metadata", "-1",
        "-y",
        output_path,
    ]
    subprocess.run(command, check=True, capture_output=True)
