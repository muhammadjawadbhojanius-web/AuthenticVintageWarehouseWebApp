import { isVideoFilename } from "./media";
import {
  Conversion,
  Input,
  Output,
  BlobSource,
  BufferTarget,
  Mp4OutputFormat,
  ALL_FORMATS,
  canEncodeVideo,
} from "mediabunny";
import type { ConversionAudioOptions } from "mediabunny";

// ---------------------------------------------------------------------------
// Configuration — compression rules
// ---------------------------------------------------------------------------
//
// Decision is driven by the backend's stream-copy remux window (H.264 at
// ≤720p / ≤30 fps). Anything that falls inside that window is cheap for
// the server to re-wrap; anything outside forces a CPU-bound libx264
// transcode. We re-encode on the client whenever that's the case, so the
// server's job is always the fast one.
//
//   1. fps > 30 OR resolution > 720p  →  re-encode to fit (720p / 30 fps)
//                                        at the default bitrate, regardless
//                                        of file size.
//   2. Already ≤720p / ≤30 fps, file > 100 MB  →  re-encode same dims/fps
//                                        with a bitrate targeted to bring
//                                        the file just under 100 MB.
//   3. Already ≤720p / ≤30 fps, file ≤ 100 MB  →  skip. Backend remuxes.

const COMPRESS_THRESHOLD_BYTES = 100 * 1024 * 1024; // 100 MB
const TARGET_SIZE_BYTES = 95 * 1024 * 1024;         // 95 MB target (5MB margin)

const TARGET_LONG_EDGE = 1280;
const TARGET_SHORT_EDGE = 720;
const TARGET_FRAME_RATE = 30;
const FPS_TOLERANCE = 30.5; // 29.97 source counts as "30 fps"

const DEFAULT_VIDEO_BITRATE = 2_500_000; // 2.5 Mbps for resolution/fps re-encodes
const DEFAULT_AUDIO_BITRATE = 128_000;   // 128 kbps AAC
const MIN_VIDEO_BITRATE = 500_000;       // floor for size-targeted re-encode

// Fallback MediaRecorder MIME preference (Safari/older browsers only).
const FALLBACK_MIME_CANDIDATES = [
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
  onProgress?: (fraction: number) => void;
}

export interface CompressVideosProgress {
  fileIndex: number;
  fileCount: number;
  fileProgress: number;
  overall: number;
}

interface CompressionPlan {
  /** Output width in pixels (preserves aspect; even number). */
  outW: number;
  /** Output height in pixels (preserves aspect; even number). */
  outH: number;
  /** Output frame rate. */
  fps: number;
  /** Target video bitrate in bits/sec. */
  videoBitrate: number;
  /** Human-readable description of why we're re-encoding. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

function hasWebCodecs(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof VideoDecoder !== "undefined";
}

function fallbackMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of FALLBACK_MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

export function isCompressionSupported(): boolean {
  if (hasWebCodecs()) return true;
  return fallbackMime() !== null &&
    typeof HTMLCanvasElement !== "undefined" &&
    "captureStream" in HTMLCanvasElement.prototype;
}

// ---------------------------------------------------------------------------
// Planning — apply the rules to a probed source
// ---------------------------------------------------------------------------

function planCompression(
  srcW: number,
  srcH: number,
  srcFps: number,
  durationSec: number,
  sizeBytes: number,
): CompressionPlan | null {
  const longEdge = Math.max(srcW, srcH);
  const shortEdge = Math.min(srcW, srcH);
  const fpsTooHigh = srcFps > FPS_TOLERANCE;
  const resTooHigh = longEdge > TARGET_LONG_EDGE || shortEdge > TARGET_SHORT_EDGE;

  // Case A/B/C: fps and/or resolution exceed the backend remux window —
  // fit to 720p/30fps at the default bitrate. Aspect ratio is preserved by
  // scaling the long edge to 1280 and the short edge to ≤720 (whichever
  // is more restrictive). This runs regardless of file size: the point is
  // to keep the server out of a libx264 transcode.
  if (fpsTooHigh || resTooHigh) {
    const scale = resTooHigh
      ? Math.min(TARGET_LONG_EDGE / longEdge, TARGET_SHORT_EDGE / shortEdge, 1)
      : 1;
    const portrait = srcH >= srcW;
    const outLong = Math.round(longEdge * scale) & ~1;
    const outShort = Math.round(shortEdge * scale) & ~1;
    const outW = portrait ? outShort : outLong;
    const outH = portrait ? outLong : outShort;
    const fps = fpsTooHigh ? TARGET_FRAME_RATE : srcFps;

    const reasons: string[] = [];
    if (resTooHigh) reasons.push(`${srcW}x${srcH}→${outW}x${outH}`);
    if (fpsTooHigh) reasons.push(`${srcFps.toFixed(1)}→${fps}fps`);

    return {
      outW,
      outH,
      fps,
      videoBitrate: DEFAULT_VIDEO_BITRATE,
      reason: reasons.join(", "),
    };
  }

  // Already inside the remux window. Only re-encode if the file is also
  // too big to upload comfortably — otherwise let the backend stream-copy.
  if (sizeBytes <= COMPRESS_THRESHOLD_BYTES) {
    return null;
  }

  // Case D: already at ≤720p/≤30fps but file > 100 MB — re-encode same
  // dims and fps with a bitrate computed to land just under 100 MB.
  if (durationSec <= 0) {
    // No duration → can't compute target bitrate, skip.
    return null;
  }
  const targetTotalBps = (TARGET_SIZE_BYTES * 8) / durationSec;
  const targetVideoBps = Math.max(
    MIN_VIDEO_BITRATE,
    Math.floor(targetTotalBps - DEFAULT_AUDIO_BITRATE),
  );

  return {
    outW: srcW,
    outH: srcH,
    fps: srcFps,
    videoBitrate: targetVideoBps,
    reason: `bitrate→${(targetVideoBps / 1e6).toFixed(2)}Mbps to fit ${TARGET_SIZE_BYTES / 1e6}MB`,
  };
}

// ---------------------------------------------------------------------------
// Primary path — mediabunny (WebCodecs + MP4 muxer)
// Runs at hardware speed, decoupled from playback.
// ---------------------------------------------------------------------------

async function compressWithMediabunny(
  file: File,
  onProgress?: (f: number) => void,
): Promise<File | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  try {
    const videoTracks = await input.getVideoTracks();
    if (videoTracks.length === 0) {
      console.info("[video-compressor] No video track, skipping");
      onProgress?.(1);
      return file;
    }
    const vt = videoTracks[0];
    const srcW = vt.displayWidth;
    const srcH = vt.displayHeight;

    // Probe fps + duration to inform the compression plan.
    const [stats, durationSec] = await Promise.all([
      vt.computePacketStats(60),
      input.computeDuration(),
    ]);
    const srcFps = stats.averagePacketRate || 0;

    const plan = planCompression(srcW, srcH, srcFps, durationSec, file.size);
    if (!plan) {
      console.info(
        `[video-compressor] No actionable plan (${srcW}x${srcH} @ ${srcFps.toFixed(1)}fps, ${durationSec.toFixed(1)}s), skipping`,
      );
      onProgress?.(1);
      return file;
    }

    // Confirm the browser can actually encode H.264 at the planned target.
    const canH264 = await canEncodeVideo("avc", {
      width: plan.outW,
      height: plan.outH,
      bitrate: plan.videoBitrate,
    });
    if (!canH264) {
      console.info("[video-compressor] H.264 WebCodecs encode unsupported, falling back");
      return null;
    }

    const output = new Output({
      target: new BufferTarget(),
      format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    });

    // Audio is not needed for this warehouse workflow — dropping it
    // shrinks the upload and sidesteps the AAC-encode-unsupported path
    // on Firefox / some Chromium builds.
    const audioOpts: ConversionAudioOptions = { discard: true };

    const conversion = await Conversion.init({
      input,
      output,
      video: {
        width: plan.outW,
        height: plan.outH,
        fit: "contain",
        codec: "avc",
        bitrate: plan.videoBitrate,
        frameRate: plan.fps,
      },
      audio: audioOpts,
      showWarnings: false,
    });

    if (!conversion.isValid) {
      console.info("[video-compressor] mediabunny conversion invalid, falling back");
      return null;
    }

    conversion.onProgress = (p) => onProgress?.(Math.min(p, 0.99));

    console.info(
      `[video-compressor] mediabunny: ${plan.reason} (source ${srcW}x${srcH} @ ${srcFps.toFixed(1)}fps, ${durationSec.toFixed(1)}s)`,
    );

    await conversion.execute();
    onProgress?.(1);

    const buf = (output.target as BufferTarget).buffer;
    if (!buf) {
      console.warn("[video-compressor] mediabunny produced empty buffer");
      return null;
    }

    if (buf.byteLength >= file.size) {
      console.info(
        `[video-compressor] mediabunny output (${(buf.byteLength / 1e6).toFixed(1)}MB) ≥ original (${(file.size / 1e6).toFixed(1)}MB), using original`,
      );
      return file;
    }

    console.info(
      `[video-compressor] mediabunny ${(file.size / 1e6).toFixed(1)}MB → ${(buf.byteLength / 1e6).toFixed(1)}MB (${Math.round((1 - buf.byteLength / file.size) * 100)}% reduction)`,
    );

    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([buf], `${baseName}.mp4`, { type: "video/mp4" });
  } finally {
    try {
      (input as unknown as { dispose?: () => void }).dispose?.();
    } catch {
      // Ignore dispose errors.
    }
  }
}

// ---------------------------------------------------------------------------
// Fallback path — MediaRecorder + canvas.captureStream
// Realtime-bound (same speed as playback), kept for browsers without
// WebCodecs encode support (mainly older Safari). Uses a simpler plan:
// fits the source into 720p at 30 fps using the default bitrate.
// ---------------------------------------------------------------------------

async function compressWithMediaRecorder(
  file: File,
  onProgress?: (f: number) => void,
): Promise<File> {
  const mimeType = fallbackMime();
  if (!mimeType) return file;

  let audioCtx: AudioContext | null = null;
  try {
    audioCtx = new AudioContext();
  } catch {
    // Video-only fallback.
  }

  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("Failed to load video"));
    });

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    const longEdge = Math.max(srcW, srcH);
    const shortEdge = Math.min(srcW, srcH);
    const resTooHigh = longEdge > TARGET_LONG_EDGE || shortEdge > TARGET_SHORT_EDGE;

    // If the source already fits the backend remux window and isn't
    // oversized, skip re-encoding. (MediaRecorder can't cheaply probe
    // fps, so we trust dimensions + file size as a proxy.)
    if (!resTooHigh && file.size <= COMPRESS_THRESHOLD_BYTES) {
      onProgress?.(1);
      return file;
    }

    const scale = resTooHigh
      ? Math.min(TARGET_LONG_EDGE / longEdge, TARGET_SHORT_EDGE / shortEdge, 1)
      : 1;
    const portrait = srcH >= srcW;
    const outLong = Math.round(longEdge * scale) & ~1;
    const outShort = Math.round(shortEdge * scale) & ~1;
    const outW = portrait ? outShort : outLong;
    const outH = portrait ? outLong : outShort;

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;

    const canvasStream = (canvas as HTMLCanvasElement & { captureStream(fps: number): MediaStream }).captureStream(TARGET_FRAME_RATE);
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    if (audioCtx) {
      try {
        const source = audioCtx.createMediaElementSource(video);
        const audioDest = audioCtx.createMediaStreamDestination();
        source.connect(audioDest);
        source.connect(audioCtx.destination);
        for (const t of audioDest.stream.getAudioTracks()) tracks.push(t);
      } catch {
        // Video-only.
      }
    }

    const recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType,
      videoBitsPerSecond: DEFAULT_VIDEO_BITRATE,
    });

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const drawFrame = () => {
      if (video.ended || video.paused) return;
      ctx.drawImage(video, 0, 0, outW, outH);
      if (video.duration > 0) {
        onProgress?.(Math.min(video.currentTime / video.duration, 0.99));
      }
      if ("requestVideoFrameCallback" in video) {
        (video as unknown as { requestVideoFrameCallback(cb: () => void): void })
          .requestVideoFrameCallback(drawFrame);
      } else {
        requestAnimationFrame(drawFrame);
      }
    };

    const compressed = await new Promise<Blob>((resolve, reject) => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
      recorder.onerror = (e) => reject(e);
      recorder.start(500);
      video.muted = false;
      video.onended = () => setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 200);
      video.onerror = () => reject(new Error("Video playback error during compression"));
      if ("requestVideoFrameCallback" in video) {
        (video as unknown as { requestVideoFrameCallback(cb: () => void): void })
          .requestVideoFrameCallback(drawFrame);
      } else {
        requestAnimationFrame(drawFrame);
      }
      video.play().catch(reject);
    });

    onProgress?.(1);

    if (compressed.size >= file.size) return file;

    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([compressed], `${baseName}.${ext}`, { type: mimeType });
  } finally {
    URL.revokeObjectURL(url);
    if (audioCtx && audioCtx.state !== "closed") {
      audioCtx.close().catch(() => {});
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function compressVideo(
  file: File,
  opts: CompressVideoOptions = {},
): Promise<File> {
  const { onProgress } = opts;

  // No blanket size gate: the planner returns null for sources that are
  // already inside the backend remux window AND under the size threshold,
  // so mediabunny / MediaRecorder bail out early in those cases.

  if (hasWebCodecs()) {
    try {
      const t0 = performance.now();
      const result = await compressWithMediabunny(file, onProgress);
      if (result) {
        console.info(
          `[video-compressor] mediabunny finished in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
        );
        return result;
      }
    } catch (err) {
      console.warn("[video-compressor] mediabunny path failed, trying fallback:", err);
    }
  }

  try {
    return await compressWithMediaRecorder(file, onProgress);
  } catch (err) {
    console.warn("[video-compressor] All compression paths failed, using original:", err);
    return file;
  }
}

export async function compressVideos(
  files: File[],
  onProgress?: (info: CompressVideosProgress) => void,
): Promise<File[]> {
  const result: File[] = [];
  const videoIndices: number[] = [];

  for (let i = 0; i < files.length; i++) {
    if (isVideoFilename(files[i].name)) videoIndices.push(i);
  }

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

// ---------------------------------------------------------------------------
// Pipelined helper — compresses files one at a time, but hands each file to
// the upload queue as soon as it's ready. This overlaps network I/O with
// compression instead of serializing "compress all, then upload all".
// ---------------------------------------------------------------------------

export interface CompressAndUploadProgress {
  /** Overall 0..1 across both compression and upload. */
  overall: number;
  /** Short human label describing the current activity. */
  label: string;
}

export interface CompressAndUploadOptions {
  files: File[];
  uploadFile: (file: File, onProgress: (p: number) => void) => Promise<void>;
  onProgress?: (info: CompressAndUploadProgress) => void;
}

export async function compressAndUploadPipelined(
  opts: CompressAndUploadOptions,
): Promise<void> {
  const { files, uploadFile, onProgress } = opts;
  if (files.length === 0) return;

  const total = files.length;
  const compressDone = new Array(total).fill(0); // 0..1 per file
  const uploadDone = new Array(total).fill(0);   // 0..1 per file
  const labels = new Array(total).fill("Waiting");
  const uploadPromises: Promise<void>[] = [];

  const emit = () => {
    if (!onProgress) return;
    let sum = 0;
    for (let i = 0; i < total; i++) {
      sum += 0.4 * compressDone[i] + 0.6 * uploadDone[i];
    }
    let activeLabel = labels[total - 1];
    for (let i = 0; i < total; i++) {
      if (compressDone[i] < 1 || uploadDone[i] < 1) {
        activeLabel = labels[i];
        break;
      }
    }
    onProgress({ overall: sum / total, label: activeLabel });
  };

  for (let i = 0; i < total; i++) {
    const f = files[i];
    const human = `${f.name} (${i + 1}/${total})`;
    const isVid = isVideoFilename(f.name);

    let ready: File = f;
    if (isVid) {
      labels[i] = `Compressing ${human}`;
      emit();
      ready = await compressVideo(f, {
        onProgress: (p) => {
          compressDone[i] = p;
          emit();
        },
      });
    }
    compressDone[i] = 1;
    labels[i] = `Uploading ${human}`;
    emit();

    uploadPromises.push(
      uploadFile(ready, (p) => {
        uploadDone[i] = p;
        labels[i] = `Uploading ${human}`;
        emit();
      }).then(() => {
        uploadDone[i] = 1;
        labels[i] = `Done ${human}`;
        emit();
      }),
    );
  }

  await Promise.all(uploadPromises);
}
