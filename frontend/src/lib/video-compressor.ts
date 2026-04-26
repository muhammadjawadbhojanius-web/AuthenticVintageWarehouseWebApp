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
// Goal: deliver the highest-quality MP4 we can while staying inside the
// 100 MB upload cap and the backend's stream-copy remux window
// (H.264 ≤1080p ≤30fps). Stream-copy is ~0% CPU on the server; everything
// outside that window forces a libx264 transcode there.
//
// Decision (in order, easiest-to-most-lossy):
//
//   1. Source already H.264 ≤1080p ≤30fps and ≤100 MB
//        →  skip the client encode. Backend remuxes.
//   2. fps > 30
//        →  reduce to 30 fps. Visually fine for warehouse content.
//   3. Long edge > 1920 (4K and up)
//        →  scale long edge down to 1920, preserving aspect ratio.
//   4. Estimated output size > 100 MB
//        →  drop video bitrate, but never below the per-resolution floor.
//           If the floor still doesn't fit, step the resolution down a
//           tier (1080p → 720p) and retry at that floor.
//
// We never upsize a low-res source, and we never bump a source's bitrate
// above what it already had.

const SIZE_CAP_BYTES = 100 * 1024 * 1024;     // 100 MB hard upload cap
const SIZE_TARGET_BYTES = 95 * 1024 * 1024;   // 95 MB to leave headroom

// Resolution tiers. "long edge" = max(width, height) so this works for
// portrait and landscape sources without conditional logic.
const TIER_1080P_LONG = 1920;
const TIER_720P_LONG = 1280;

// Default ("comfortable quality") bitrates per tier. The encoder is free
// to spend less if the source's effective bitrate is already lower.
const DEFAULT_BITRATE_1080P = 5_000_000;  // 5 Mbps — strong 1080p
const DEFAULT_BITRATE_720P = 2_500_000;   // 2.5 Mbps — solid 720p

// Floor bitrates per tier — never drop below this for size targeting.
// Below the floor the picture starts visibly degrading; better to step
// down to a lower resolution tier instead.
const FLOOR_BITRATE_1080P = 4_000_000;
const FLOOR_BITRATE_720P = 2_000_000;

const TARGET_FRAME_RATE = 30;
const FPS_TOLERANCE = 30.5; // 29.97 source counts as "30 fps"

// Tolerance for the post-encode duration sanity check. mediabunny's CFR
// re-stamping bug can stretch some VFR sources; if we ever produce an
// output more than 5 % off the source duration, we ship the original
// unchanged and let the backend handle it.
const DURATION_DRIFT_TOLERANCE = 0.05;

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
  /**
   * Output frame rate, or null to preserve the source's (variable) frame
   * rate. We only set a value when fps actually needs to be reduced;
   * passing a value to mediabunny forces CFR re-stamping which can
   * stretch duration on some VFR sources.
   */
  fps: number | null;
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

/**
 * Build the cheapest plan that gets the file inside the 100 MB cap *and*
 * inside the backend's stream-copy window. Returns null when no changes
 * are needed — caller then ships the original file untouched.
 */
function planCompression(
  srcW: number,
  srcH: number,
  srcFps: number,
  durationSec: number,
  sizeBytes: number,
): CompressionPlan | null {
  const longEdge = Math.max(srcW, srcH);
  const shortEdge = Math.min(srcW, srcH);
  const portrait = srcH >= srcW;

  const fpsTooHigh = srcFps > FPS_TOLERANCE;
  const resTooHigh = longEdge > TIER_1080P_LONG;
  const sizeTooBig = sizeBytes > SIZE_CAP_BYTES;

  // Fast path — already in spec on every dimension. Server stream-copies.
  if (!fpsTooHigh && !resTooHigh && !sizeTooBig) {
    return null;
  }

  // Step 1 — pick the resolution. Only downsize when the source long edge
  // exceeds 1080p; otherwise preserve source dimensions.
  let outLong = longEdge;
  let outShort = shortEdge;
  if (resTooHigh) {
    const scale = TIER_1080P_LONG / longEdge;
    outLong = Math.round(longEdge * scale) & ~1;
    outShort = Math.round(shortEdge * scale) & ~1;
  }

  // Step 2 — pick the fps. Only set a value when fps must come down;
  // otherwise null tells the encoder to preserve source PTS (avoids the
  // CFR re-stamping bug that stretches some VFR sources).
  const outFps: number | null = fpsTooHigh ? TARGET_FRAME_RATE : null;

  // Step 3 — pick the bitrate. Three inputs:
  //   • a per-tier default that reflects "comfortable quality"
  //   • the source's effective bitrate (we never bitrate-bump)
  //   • a size-cap calculation when the source is too big
  const isHighTier = outLong > TIER_720P_LONG;
  let defaultBitrate = isHighTier ? DEFAULT_BITRATE_1080P : DEFAULT_BITRATE_720P;
  let floorBitrate = isHighTier ? FLOOR_BITRATE_1080P : FLOOR_BITRATE_720P;

  // Effective source bitrate: file-size proxy. Slightly overshoots since
  // it includes audio that we strip, which is fine — it just means we
  // err on the side of *more* bitrate, never less.
  const srcBitrate =
    durationSec > 0 ? (sizeBytes * 8) / durationSec : defaultBitrate;

  // Size-cap target (only applied when sizeTooBig). 95 MB so we don't
  // drift over after VBR rate control variance.
  const sizeBitrate =
    durationSec > 0 ? (SIZE_TARGET_BYTES * 8) / durationSec : defaultBitrate;

  // Start at min(default, source) — never up-bitrate.
  let videoBitrate = Math.min(defaultBitrate, srcBitrate);

  if (sizeTooBig) {
    // Bring it down toward the size target, but not below the tier floor.
    videoBitrate = Math.max(Math.min(videoBitrate, sizeBitrate), floorBitrate);

    // Even at the floor, the result still wouldn't fit → drop a tier.
    const floorWillFit = (floorBitrate * durationSec) / 8 <= SIZE_CAP_BYTES;
    if (!floorWillFit && isHighTier) {
      // Re-scale to 720p and retry at the lower tier's floor.
      const scale = TIER_720P_LONG / longEdge;
      outLong = Math.round(longEdge * scale) & ~1;
      outShort = Math.round(shortEdge * scale) & ~1;
      defaultBitrate = DEFAULT_BITRATE_720P;
      floorBitrate = FLOOR_BITRATE_720P;
      videoBitrate = Math.max(
        Math.min(sizeBitrate, defaultBitrate),
        floorBitrate,
      );
    }
  }

  const outW = portrait ? outShort : outLong;
  const outH = portrait ? outLong : outShort;

  // Sanity: if after all that nothing actually changed and the source
  // already fits the size cap, skip. (Rare — e.g. a 30 fps source we
  // were going to re-encode just for size that turned out to fit.)
  const dimsUnchanged = outW === srcW && outH === srcH;
  if (
    dimsUnchanged &&
    outFps === null &&
    videoBitrate >= srcBitrate &&
    !sizeTooBig
  ) {
    return null;
  }

  const reasons: string[] = [];
  if (!dimsUnchanged) reasons.push(`${srcW}x${srcH}→${outW}x${outH}`);
  if (outFps !== null) reasons.push(`${srcFps.toFixed(1)}→${outFps}fps`);
  if (videoBitrate < srcBitrate * 0.9) {
    reasons.push(`bitrate→${(videoBitrate / 1e6).toFixed(2)}Mbps`);
  }
  if (reasons.length === 0) reasons.push("re-encode for upload cap");

  return {
    outW,
    outH,
    fps: outFps,
    videoBitrate,
    reason: reasons.join(", "),
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

    // Probe fps + duration to inform the compression plan. We sample many
    // packets (not just 60) because computePacketStats(60) only sees the
    // first ~2 seconds of a 30 fps source — a high-rate burst at the
    // start of a VFR phone capture (autofocus, exposure) can otherwise
    // push the average over 30 fps and trigger a needless CFR re-encode.
    const [stats, durationSec] = await Promise.all([
      vt.computePacketStats(2000),
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

    // Only set frameRate when fps actually needs to come down. Per
    // mediabunny's docs, omitting it preserves the source's (variable)
    // frame rate — which is what we want for ≤30fps sources, since
    // forcing CFR re-stamps every frame at uniform PTS and stretches
    // duration when the source has bursty inter-frame intervals.
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        width: plan.outW,
        height: plan.outH,
        fit: "contain",
        codec: "avc",
        bitrate: plan.videoBitrate,
        ...(plan.fps !== null ? { frameRate: plan.fps } : {}),
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

    // Duration sanity check — last line of defense against the CFR
    // re-stamp stretch. If the output's duration drifted more than the
    // tolerance, ship the original and let the backend decide.
    const outBlob = new Blob([buf], { type: "video/mp4" });
    if (durationSec > 0) {
      try {
        const probeInput = new Input({
          source: new BlobSource(outBlob),
          formats: ALL_FORMATS,
        });
        const outDuration = await probeInput.computeDuration();
        try {
          (probeInput as unknown as { dispose?: () => void }).dispose?.();
        } catch {
          // ignore
        }
        const drift = Math.abs(outDuration - durationSec) / durationSec;
        if (drift > DURATION_DRIFT_TOLERANCE) {
          console.warn(
            `[video-compressor] output duration ${outDuration.toFixed(1)}s drifted from source ${durationSec.toFixed(1)}s (${(drift * 100).toFixed(1)}%), using original`,
          );
          return file;
        }
      } catch (e) {
        console.warn("[video-compressor] duration verify failed, accepting output", e);
      }
    }

    console.info(
      `[video-compressor] mediabunny ${(file.size / 1e6).toFixed(1)}MB → ${(buf.byteLength / 1e6).toFixed(1)}MB (${Math.round((1 - buf.byteLength / file.size) * 100)}% reduction)`,
    );

    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([outBlob], `${baseName}.mp4`, { type: "video/mp4" });
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

  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    // Muted + no AudioContext is the whole audio-stripping story for this
    // path. The warehouse workflow doesn't keep audio on videos, and we
    // never want playback audible to the user during compression either.
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
    // Fallback path uses the 1080p tier too — same backend remux window.
    const resTooHigh = longEdge > TIER_1080P_LONG;

    // If the source already fits the backend remux window and isn't
    // oversized, skip re-encoding. (MediaRecorder can't cheaply probe
    // fps, so we trust dimensions + file size as a proxy.)
    if (!resTooHigh && file.size <= SIZE_CAP_BYTES) {
      onProgress?.(1);
      return file;
    }

    const scale = resTooHigh ? TIER_1080P_LONG / longEdge : 1;
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
    // Video-only stream — no audio tracks are ever added, so MediaRecorder
    // has nothing to encode on the audio side.
    const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];

    const fallbackBitrate =
      outLong > TIER_720P_LONG ? DEFAULT_BITRATE_1080P : DEFAULT_BITRATE_720P;
    const recorder = new MediaRecorder(new MediaStream(tracks), {
      mimeType,
      videoBitsPerSecond: fallbackBitrate,
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
      // Stays muted through play() — previously this was set to false
      // which made the source video audible to the user and would also
      // leak audio into the MediaRecorder output on some browsers.
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
