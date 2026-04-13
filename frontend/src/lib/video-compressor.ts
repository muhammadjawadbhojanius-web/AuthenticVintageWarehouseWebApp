import { isVideoFilename } from "./media";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_MAX_WIDTH = 720;
const DEFAULT_MAX_HEIGHT = 1280;
const DEFAULT_FRAME_RATE = 30;
const DEFAULT_VIDEO_BITRATE = 2_500_000; // 2.5 Mbps
const COMPRESS_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB

// Ordered by preference — Safari supports mp4, Chrome supports webm.
const MIME_CANDIDATES = [
  'video/mp4; codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4; codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm; codecs=vp9,opus',
  'video/webm; codecs=vp8,opus',
  'video/webm',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressVideoOptions {
  maxWidth?: number;
  maxHeight?: number;
  frameRate?: number;
  videoBitrate?: number;
  onProgress?: (fraction: number) => void;
}

export interface CompressVideosProgress {
  fileIndex: number;
  fileCount: number;
  fileProgress: number;
  overall: number;
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

function selectMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

function hasCaptureStream(): boolean {
  return typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype;
}

export function isCompressionSupported(): boolean {
  return hasCaptureStream() && selectMimeType() !== null;
}

// ---------------------------------------------------------------------------
// Single-file compression
// ---------------------------------------------------------------------------

export async function compressVideo(
  file: File,
  opts: CompressVideoOptions = {},
): Promise<File> {
  const {
    maxWidth = DEFAULT_MAX_WIDTH,
    maxHeight = DEFAULT_MAX_HEIGHT,
    frameRate = DEFAULT_FRAME_RATE,
    videoBitrate = DEFAULT_VIDEO_BITRATE,
    onProgress,
  } = opts;

  // Skip small files — only compress videos above 100 MB.
  if (file.size < COMPRESS_THRESHOLD_BYTES) {
    console.info(
      `[video-compressor] File ${(file.size / 1e6).toFixed(1)}MB < 100MB threshold, skipping`,
    );
    onProgress?.(1);
    return file;
  }

  // Bail out early if browser doesn't support the needed APIs.
  const mimeType = selectMimeType();
  if (!mimeType || !hasCaptureStream()) {
    console.warn("[video-compressor] Browser APIs not supported, skipping compression");
    return file;
  }

  // Create the AudioContext right away (user-gesture chain from file input).
  let audioCtx: AudioContext | null = null;
  try {
    audioCtx = new AudioContext();
  } catch {
    // Audio compression won't work, but video-only is fine.
  }

  const url = URL.createObjectURL(file);

  try {
    // --- Load video metadata ---
    const video = document.createElement("video");
    video.muted = true; // muted so autoplay works; audio goes via AudioContext
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Failed to load video"));
    });

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;

    // Skip if already at or below target resolution.
    if (srcW <= maxWidth && srcH <= maxHeight) {
      console.info(
        `[video-compressor] Video ${srcW}x${srcH} already ≤ ${maxWidth}x${maxHeight}, skipping`,
      );
      onProgress?.(1);
      return file;
    }

    // --- Compute output dimensions (scale down, preserve aspect ratio) ---
    const scale = Math.min(maxWidth / srcW, maxHeight / srcH, 1);
    // H.264 requires even dimensions.
    const outW = Math.round(srcW * scale) & ~1;
    const outH = Math.round(srcH * scale) & ~1;

    console.info(
      `[video-compressor] Compressing ${srcW}x${srcH} → ${outW}x${outH} @ ${frameRate}fps`,
    );

    // --- Set up canvas ---
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;

    // --- Build combined MediaStream (video from canvas + audio from source) ---
    const canvasStream = (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(frameRate);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    // Wire up audio if AudioContext is available and the video has audio.
    let audioDest: MediaStreamAudioDestinationNode | null = null;
    if (audioCtx) {
      try {
        const source = audioCtx.createMediaElementSource(video);
        audioDest = audioCtx.createMediaStreamDestination();
        source.connect(audioDest);
        // Also connect to destination so AudioContext processes it (even though video is muted).
        source.connect(audioCtx.destination);
        for (const t of audioDest.stream.getAudioTracks()) {
          tracks.push(t);
        }
      } catch {
        // Audio wiring failed — record video-only.
      }
    }

    const combinedStream = new MediaStream(tracks);

    // --- MediaRecorder ---
    const recorder = new MediaRecorder(combinedStream, {
      mimeType,
      videoBitsPerSecond: videoBitrate,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    // --- Frame drawing loop ---
    const drawFrame = () => {
      if (video.ended || video.paused) return;
      ctx.drawImage(video, 0, 0, outW, outH);
      if (video.duration > 0) {
        onProgress?.(Math.min(video.currentTime / video.duration, 0.99));
      }
      // Prefer requestVideoFrameCallback for frame-accurate drawing.
      if ("requestVideoFrameCallback" in video) {
        (video as unknown as { requestVideoFrameCallback(cb: () => void): void })
          .requestVideoFrameCallback(drawFrame);
      } else {
        requestAnimationFrame(drawFrame);
      }
    };

    // --- Record ---
    const compressed = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: mimeType }));
      };
      recorder.onerror = (e) => reject(e);

      recorder.start(500); // 500ms timeslice to keep memory bounded

      // Unmute so AudioContext can process audio (the video element itself is
      // piped through AudioContext, not the speakers, because we connected
      // createMediaElementSource which detaches from default output).
      video.muted = false;

      video.onended = () => {
        // Small delay so the last frames/audio flush through.
        setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, 200);
      };

      video.onerror = () => reject(new Error("Video playback error during compression"));

      // Start drawing and playing.
      if ("requestVideoFrameCallback" in video) {
        (video as unknown as { requestVideoFrameCallback(cb: () => void): void })
          .requestVideoFrameCallback(drawFrame);
      } else {
        requestAnimationFrame(drawFrame);
      }

      video.play().catch(reject);
    });

    onProgress?.(1);

    // If compression made the file larger, return the original.
    if (compressed.size >= file.size) {
      console.info(
        `[video-compressor] Compressed (${(compressed.size / 1e6).toFixed(1)}MB) ≥ original (${(file.size / 1e6).toFixed(1)}MB), using original`,
      );
      return file;
    }

    console.info(
      `[video-compressor] ${(file.size / 1e6).toFixed(1)}MB → ${(compressed.size / 1e6).toFixed(1)}MB (${Math.round((1 - compressed.size / file.size) * 100)}% reduction)`,
    );

    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([compressed], `${baseName}.${ext}`, { type: mimeType });
  } catch (err) {
    console.warn("[video-compressor] Compression failed, using original file:", err);
    return file;
  } finally {
    URL.revokeObjectURL(url);
    if (audioCtx && audioCtx.state !== "closed") {
      audioCtx.close().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Batch helper — compresses videos sequentially, passes images through.
// ---------------------------------------------------------------------------

export async function compressVideos(
  files: File[],
  onProgress?: (info: CompressVideosProgress) => void,
): Promise<File[]> {
  const result: File[] = [];
  const videoIndices: number[] = [];

  for (let i = 0; i < files.length; i++) {
    if (isVideoFilename(files[i].name)) videoIndices.push(i);
  }

  // No videos → return immediately.
  if (videoIndices.length === 0) {
    onProgress?.({ fileIndex: 0, fileCount: 0, fileProgress: 1, overall: 1 });
    return [...files];
  }

  let videosProcessed = 0;

  for (let i = 0; i < files.length; i++) {
    if (!isVideoFilename(files[i].name)) {
      result.push(files[i]);
      continue;
    }

    const vidIdx = videosProcessed;
    const compressed = await compressVideo(files[i], {
      onProgress: (frac) => {
        onProgress?.({
          fileIndex: vidIdx,
          fileCount: videoIndices.length,
          fileProgress: frac,
          overall: (vidIdx + frac) / videoIndices.length,
        });
      },
    });
    result.push(compressed);
    videosProcessed++;
  }

  onProgress?.({
    fileIndex: videoIndices.length - 1,
    fileCount: videoIndices.length,
    fileProgress: 1,
    overall: 1,
  });

  return result;
}
