"use client";

import { useEffect, useRef, useState } from "react";
import type { Song } from "@/lib/library";
import TimedLyrics from "./TimedLyrics";
import VideoEditor from "./VideoEditor";
import { currentLine } from "@/lib/lrc";
import { useTrack } from "@/lib/tracks";
import { buildVocalChain } from "@/lib/vocalChain";
import { BackgroundFx, type FxStatus } from "@/lib/backgroundFx";
import { toShareableMp4 } from "@/lib/finalizeVideo";
import {
  type BackgroundChoice,
  BUILTINS,
  loadChoice,
  loadCustomImage,
  paintBuiltin,
  saveChoice,
  saveCustomImage,
} from "@/lib/backgrounds";

type Phase =
  | { kind: "setup" }
  | { kind: "loading" }
  | { kind: "countdown"; n: number }
  | { kind: "recording" }
  | { kind: "finishing"; progress: number }
  | { kind: "done"; url: string; ext: string; blob: Blob }
  | { kind: "error"; message: string };

// Prefer MP4 (plays everywhere, Instagram and WhatsApp accept it), else WebM.
function pickMimeType() {
  const types = [
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  return types.find(
    (t) =>
      typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fmt = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const BG_OPTIONS: { key: string; label: string; c: BackgroundChoice }[] = [
  { key: "none", label: "None", c: { kind: "none" } },
  { key: "blur", label: "Blur", c: { kind: "blur", strength: "light" } },
  { key: "blur2", label: "More blur", c: { kind: "blur", strength: "strong" } },
  ...BUILTINS.map((b) => ({
    key: b.id,
    label: b.label,
    c: { kind: "builtin", id: b.id } as BackgroundChoice,
  })),
];

export default function Recorder({
  song,
  onClose,
}: {
  song: Song;
  onClose: () => void;
}) {
  const trackUrl = useTrack(song)?.url ?? "";
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const musicRef = useRef<AudioBufferSourceNode | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const voiceGainRef = useRef<GainNode | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const setReverbRef = useRef<(v: number) => void>(() => {});
  const [fx] = useState(() => new BackgroundFx());

  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [voice, setVoice] = useState(1);
  const [music, setMusic] = useState(0.8);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [studio, setStudio] = useState(true);
  const [reverb, setReverb] = useState(0.3);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  // Remembered between sessions: whether you sing with headphones on.
  const [headphones, setHeadphones] = useState(() => {
    try {
      return localStorage.getItem("song-recorder:headphones") !== "no";
    } catch {
      return true;
    }
  });

  // Background blur / virtual background, remembered on this device.
  const [bg, setBg] = useState<BackgroundChoice>(loadChoice);
  const [customUrl, setCustomUrl] = useState<string | null>(loadCustomImage);
  const [fxStatus, setFxStatus] = useState<FxStatus>({ kind: "plain" });
  // True if the processed picture never appears; then the raw camera is
  // shown and recorded instead, so you can still sing.
  const [rawCamera, setRawCamera] = useState(false);
  // Shape of the picture (width / height), from the camera.
  const [aspect, setAspect] = useState(9 / 16);
  const [camSize, setCamSize] = useState("");
  const [sheet, setSheet] = useState<null | "bg" | "sound" | "part">(null);
  // Which part of the song to sing (null = all of it), and the song's length.
  const [part, setPart] = useState<{ start: number; end: number } | null>(null);
  const [songLength, setSongLength] = useState(0);
  useEffect(() => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () =>
      Number.isFinite(a.duration) && setSongLength(a.duration);
    if (!trackUrl) return;
    a.src = trackUrl;
    return () => {
      a.removeAttribute("src");
    };
  }, [trackUrl]);
  const partStart = part?.start ?? 0;
  // Video editing: the editor is open, and the unedited recording (so an
  // edit can always be redone from the original).
  const [editing, setEditing] = useState(false);
  const [original, setOriginal] = useState<Blob | null>(null);
  const [thumbs] = useState(() =>
    Object.fromEntries(
      BUILTINS.map((b) => [b.id, paintBuiltin(b.id, 72, 128).toDataURL()]),
    ),
  );

  function chooseBg(c: BackgroundChoice) {
    setBg(c);
    saveChoice(c);
  }

  useEffect(() => {
    fx.onStatus = setFxStatus;
    fx.onSize = (w, h) => {
      setAspect(w / h);
      setCamSize(fx.cameraSize);
    };
    return () => {
      fx.onStatus = undefined;
      fx.onSize = undefined;
      fx.stop();
    };
  }, [fx]);
  useEffect(() => fx.setChoice(bg, customUrl), [fx, bg, customUrl]);

  // The picture (the whole camera picture, plus any background) is drawn on the
  // canvas the whole time the camera is on; that canvas is what gets recorded.
  const cameraOn =
    phase.kind !== "done" &&
    phase.kind !== "finishing" &&
    phase.kind !== "error";
  useEffect(() => {
    if (!cameraOn || !videoRef.current || !canvasRef.current) return;
    fx.start(videoRef.current, canvasRef.current);
    let checks = 0;
    const watchdog = setInterval(() => {
      if (fx.framesRendered > 0) return clearInterval(watchdog);
      const v = videoRef.current;
      if (v && v.readyState >= 2 && ++checks >= 3) {
        clearInterval(watchdog);
        setRawCamera(true);
      }
    }, 1000);
    return () => {
      clearInterval(watchdog);
      fx.stop();
    };
  }, [cameraOn, fx]);

  // Live preview of the front camera while setting up.
  function startCamera(
    isCancelled: () => boolean = () => false,
    mic = micId,
    hp = headphones,
  ) {
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    fx.preferPortrait = portrait;
    // With headphones: raw, full-band voice. There is no echo to cancel,
    // and phone call filters make singing sound thin and pumpy; the studio
    // chain does the polishing instead.
    // Without headphones: the phone's echo cancelling removes the music
    // coming out of the speaker, so the video doesn't get it twice.
    const audio: MediaTrackConstraints = {
      ...(mic ? { deviceId: { exact: mic } } : {}),
      echoCancellation: !hp,
      noiseSuppression: !hp,
      autoGainControl: false,
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 24 },
      channelCount: { ideal: 1 },
    };
    // Browsers differ in how they read width/height on a phone held
    // upright (some mean the sensor's sideways shape), and some hand back a
    // wide picture. Try the ways of asking in turn and keep the first that
    // gives a tall, full picture, like the phone's own camera.
    const tries: MediaTrackConstraints[] = portrait
      ? [
          {
            width: { ideal: 1080 },
            height: { ideal: 1920 },
            aspectRatio: { ideal: 9 / 16 },
          },
          { width: { ideal: 1920 }, height: { ideal: 1080 } },
          { width: { ideal: 1280 }, height: { ideal: 720 } },
          {},
        ]
      : [{ width: { ideal: 1920 }, height: { ideal: 1080 } }];
    const open = (v: MediaTrackConstraints) =>
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", frameRate: { ideal: 30 }, ...v },
        audio,
      });
    // Measure the real picture: iPhone Safari's track settings report the
    // sensor's sideways size even when the picture itself is upright.
    const isTall = (st: MediaStream) =>
      new Promise<boolean>((resolve) => {
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        const done = (ok: boolean) => {
          clearTimeout(timer);
          v.srcObject = null;
          resolve(ok);
        };
        const timer = setTimeout(() => done(false), 3000);
        v.onloadedmetadata = () => done(v.videoHeight > v.videoWidth);
        v.srcObject = st;
        v.play().catch(() => {});
      });
    (async () => {
      let stream: MediaStream | null = null;
      let firstError: unknown;
      for (const v of tries) {
        try {
          const st = await open(v);
          if (!portrait || (await isTall(st))) {
            stream = st;
            break;
          }
          st.getTracks().forEach((t) => t.stop());
        } catch (e) {
          firstError ??= e;
        }
      }
      // Nothing tall: take the camera's default; the picture is then trimmed
      // to a tall shape, as a phone camera does in portrait.
      stream ??= await open(tries[1] ?? tries[0]).catch((e) => {
        throw firstError ?? e;
      });
      return stream;
    })()
      .then((stream) => {
        if (isCancelled()) return stream.getTracks().forEach((t) => t.stop());
        camRef.current = stream;
        stream.getVideoTracks().forEach((t) => (t.contentHint = "detail"));
        if (videoRef.current) videoRef.current.srcObject = stream;
        navigator.mediaDevices
          .enumerateDevices()
          .then((all) =>
            setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId)),
          )
          .catch(() => {});
      })
      .catch((e) =>
        setPhase({
          kind: "error",
          message: `Camera or microphone blocked: ${(e as Error).message}`,
        }),
      );
  }

  function stopCamera() {
    camRef.current?.getTracks().forEach((t) => t.stop());
    camRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    startCamera(() => cancelled);
    return () => {
      cancelled = true;
      cleanup();
    };
    // Run once: open the camera on mount, release everything on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (musicGainRef.current) musicGainRef.current.gain.value = music;
  }, [music]);
  useEffect(() => {
    if (voiceGainRef.current) voiceGainRef.current.gain.value = voice;
  }, [voice]);
  useEffect(() => setReverbRef.current(reverb), [reverb]);

  function cleanup() {
    try {
      musicRef.current?.stop();
    } catch {}
    if (recRef.current?.state === "recording") recRef.current.stop();
    stopCamera();
    fx.stop();
    ctxRef.current?.close().catch(() => {});
    wakeRef.current?.release().catch(() => {});
  }

  async function start() {
    const cam = camRef.current;
    if (!cam) return;
    setSheet(null);
    try {
      setPhase({ kind: "loading" });
      // Must be created inside the tap so phones allow sound.
      const ctx = new AudioContext({ latencyHint: "interactive" });
      ctxRef.current = ctx;
      await ctx.resume();

      if (!trackUrl) throw new Error("The karaoke track is not on this device");
      const res = await fetch(trackUrl);
      if (!res.ok) throw new Error("Could not load the karaoke track");
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      const from = Math.min(part?.start ?? 0, buffer.duration - 1);
      const to = Math.min(part?.end ?? buffer.duration, buffer.duration);
      setDuration(to - from);

      // Audio graph:
      //   music -> musicGain -> speakers/headphones (what you hear)
      //   music -> musicGain -> delay -> mix   (delayed to line up with your voice)
      //   mic   -> studio vocal chain -> voiceGain -> mix
      const mixOut = ctx.createMediaStreamDestination();
      // Limiter so loud notes (or voice turned up) never clip, with a little
      // headroom left for the encoder.
      const mix = ctx.createDynamicsCompressor();
      mix.threshold.value = -8;
      mix.knee.value = 4;
      mix.ratio.value = 20;
      mix.attack.value = 0.001;
      mix.release.value = 0.2;
      const ceiling = ctx.createGain();
      ceiling.gain.value = 0.85;
      mix.connect(ceiling).connect(mixOut);
      const musicGain = ctx.createGain();
      musicGain.gain.value = music;
      musicGainRef.current = musicGain;
      const voiceGain = ctx.createGain();
      voiceGain.gain.value = voice;
      voiceGainRef.current = voiceGain;

      // Your voice reaches the mic later than the music left the app
      // (headphone output delay + mic input delay). Delay the music in the
      // recording by the same amount so they line up.
      const lag = (ctx.outputLatency || 0) + ctx.baseLatency + 0.04;
      const delay = ctx.createDelay(1);
      delay.delayTime.value = Math.min(lag, 0.9);

      const src = ctx.createBufferSource();
      src.buffer = buffer;
      musicRef.current = src;
      src.connect(musicGain);
      musicGain.connect(ctx.destination);
      musicGain.connect(delay).connect(mix);

      const chain = buildVocalChain(ctx, studio, reverb);
      setReverbRef.current = chain.setReverb;
      ctx.createMediaStreamSource(cam).connect(chain.input);
      chain.output.connect(voiceGain).connect(mix);

      // Record exactly what the preview shows.
      const canvasTracks = rawCamera
        ? []
        : canvasRef.current!.captureStream(30).getVideoTracks();
      const videoTracks = rawCamera ? cam.getVideoTracks() : canvasTracks;
      const stream = new MediaStream([
        ...videoTracks,
        ...mixOut.stream.getAudioTracks(),
      ]);
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
        audioBitsPerSecond: 320_000,
      });
      recRef.current = rec;
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        wakeRef.current?.release().catch(() => {});
        // Recording is over: switch the camera and mic off and silence audio.
        canvasTracks.forEach((t) => t.stop());
        stopCamera();
        fx.stop();
        ctx.close().catch(() => {});
        const type = rec.mimeType || mimeType || "video/webm";
        const raw = new Blob(chunks, { type });
        // Turn it into a standard MP4 that Instagram and WhatsApp accept.
        setPhase({ kind: "finishing", progress: 0 });
        let blob = raw;
        try {
          blob = await toShareableMp4(raw, (p) =>
            setPhase({ kind: "finishing", progress: p }),
          );
        } catch (e) {
          console.warn("MP4 conversion failed, keeping the original", e);
        }
        setOriginal(blob);
        setPhase({
          kind: "done",
          url: URL.createObjectURL(blob),
          ext: blob.type.includes("mp4") ? "mp4" : "webm",
          blob,
        });
      };

      wakeRef.current =
        (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;

      for (let n = 3; n > 0; n--) {
        setPhase({ kind: "countdown", n });
        await sleep(1000);
      }

      rec.start(1000);
      src.start(0, from, to - from);
      const startedAt = ctx.currentTime;
      setPhase({ kind: "recording" });
      const timer = setInterval(
        () => setElapsed(ctx.currentTime - startedAt),
        100,
      );
      // Stop shortly after the song ends, once the delayed tail is captured.
      src.onended = async () => {
        clearInterval(timer);
        await sleep(Math.ceil(lag * 1000) + 300);
        if (rec.state === "recording") rec.stop();
      };
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  }

  function stopEarly() {
    // Silence the music at once, then stop it (which also ends the recording).
    const ctx = ctxRef.current;
    if (musicGainRef.current && ctx) {
      musicGainRef.current.gain.cancelScheduledValues(ctx.currentTime);
      musicGainRef.current.gain.setValueAtTime(0, ctx.currentTime);
    }
    try {
      musicRef.current?.stop(); // triggers onended, which stops the recorder
    } catch {}
  }

  // Show a (new or edited) video on the finished screen.
  function showVideo(blob: Blob) {
    if (phase.kind === "done") URL.revokeObjectURL(phase.url);
    setPhase({
      kind: "done",
      url: URL.createObjectURL(blob),
      ext: blob.type.includes("mp4") ? "mp4" : "webm",
      blob,
    });
  }

  function again() {
    if (phase.kind === "done") URL.revokeObjectURL(phase.url);
    ctxRef.current?.close().catch(() => {});
    setElapsed(0);
    setPhase({ kind: "setup" });
    startCamera();
  }

  const fileName = (ext: string) =>
    `${song.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "song"}.${ext}`;
  const canShareFile = (blob: Blob, ext: string) => {
    try {
      const file = new File([blob], fileName(ext), { type: blob.type });
      return !!navigator.canShare?.({ files: [file] });
    } catch {
      return false;
    }
  };
  async function share(blob: Blob, ext: string) {
    const file = new File([blob], fileName(ext), { type: blob.type });
    try {
      await navigator.share({ files: [file], title: song.title });
    } catch {}
  }

  const cam0MicId = () =>
    camRef.current?.getAudioTracks()[0]?.getSettings().deviceId ?? "";
  const live = phase.kind === "countdown" || phase.kind === "recording";
  const showLyrics = phase.kind === "setup" || phase.kind === "loading" || live;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* The stage: the camera picture's own shape, exactly what the video
          will look like, as large as fits. */}
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center sm:p-3"
        style={{ containerType: "size" }}
      >
        <div
          className="relative overflow-hidden bg-neutral-900 sm:rounded-3xl"
          style={{
            aspectRatio: aspect,
            width: `min(100cqw, calc(100cqh * ${aspect}))`,
          }}
        >
          {phase.kind === "done" ? (
            // A fresh element: reusing the camera's kept its live stream
            // attached, which browsers show as a "Live Broadcast".
            <video
              key="playback"
              src={phase.url}
              controls
              playsInline
              autoPlay
              onLoadedMetadata={fixUnknownDuration}
              className="h-full w-full bg-black object-contain"
            />
          ) : (
            <>
              {/* Camera feed: the source for the canvas. Kept rendered (not
                  display:none) so every browser keeps decoding it. */}
              <video
                key="camera"
                ref={(el) => {
                  videoRef.current = el;
                  if (el && camRef.current && el.srcObject !== camRef.current)
                    el.srcObject = camRef.current;
                }}
                autoPlay
                muted
                playsInline
                className={
                  rawCamera
                    ? "absolute inset-0 h-full w-full -scale-x-100 object-contain"
                    : "pointer-events-none absolute top-0 left-0 h-px w-px opacity-0"
                }
              />
              {/* Mirrored like a selfie camera; the video itself isn't. */}
              <canvas
                ref={canvasRef}
                className={`absolute inset-0 h-full w-full -scale-x-100 object-contain ${rawCamera ? "hidden" : ""}`}
              />
            </>
          )}

          {phase.kind === "finishing" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-10 text-center">
              <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-pink-500" />
              <p className="font-medium">Preparing your video…</p>
              <div className="h-1.5 w-full max-w-48 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full bg-pink-500 transition-[width]"
                  style={{ width: `${Math.round(phase.progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 bg-gradient-to-b from-black/60 to-transparent p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <button
              aria-label="Close"
              onClick={() => {
                cleanup();
                onClose();
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/40 text-lg backdrop-blur-md"
            >
              ✕
            </button>
            <span className="min-w-0 flex-1 truncate text-center text-sm font-semibold [text-shadow:0_1px_4px_#000]">
              {song.title}
            </span>
            {phase.kind === "recording" ? (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-red-600/90 px-3 py-1.5 text-xs font-semibold tabular-nums">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                {fmt(elapsed)}
                {duration ? (
                  <span className="text-white/70">/ {fmt(duration)}</span>
                ) : null}
              </span>
            ) : (
              <span className="w-9 shrink-0" />
            )}
          </div>

          {/* Background status, so it never fails silently */}
          {cameraOn &&
            (fxStatus.kind === "loading" ||
              fxStatus.kind === "error" ||
              rawCamera) && (
              <div className="absolute inset-x-0 bottom-14 flex justify-center px-4">
                <span
                  className={`rounded-full px-3 py-1.5 text-center text-xs backdrop-blur-md ${
                    fxStatus.kind === "loading" && !rawCamera
                      ? "bg-black/50"
                      : "bg-red-600/80"
                  }`}
                >
                  {rawCamera
                    ? "Backgrounds aren't working on this browser; using the plain camera."
                    : fxStatus.kind === "loading"
                      ? "Getting your background ready…"
                      : fxStatus.kind === "error"
                        ? fxStatus.message
                        : ""}
                </span>
              </div>
            )}

          {phase.kind === "countdown" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span
                key={phase.n}
                className="text-9xl font-bold [text-shadow:0_2px_20px_#000]"
              >
                {phase.n}
              </span>
            </div>
          )}

          {/* Which part of the song you'll sing */}
          {phase.kind === "setup" && (
            <div className="absolute inset-x-0 bottom-3 flex justify-center">
              <button
                onClick={() => setSheet("part")}
                className="rounded-full bg-black/50 px-4 py-2 text-xs font-medium backdrop-blur-md"
              >
                ♪{" "}
                {part
                  ? `${fmt(part.start)} – ${fmt(part.end)}`
                  : `Whole song${songLength ? ` · ${fmt(songLength)}` : ""}`}{" "}
                ▾
              </button>
            </div>
          )}

          {/* Lyrics over the picture (not burned into the video) */}
          {showLyrics && song.timed?.length ? (
            <div className="absolute inset-x-0 top-0 h-[42%] bg-gradient-to-b from-black/80 via-black/45 to-transparent pt-12">
              <TimedLyrics
                lines={song.timed}
                time={partStart + (phase.kind === "recording" ? elapsed : 0)}
              />
            </div>
          ) : null}
          {showLyrics && song.lyrics && !song.timed?.length ? (
            <div className="absolute inset-x-0 top-0 max-h-[42%] overflow-y-auto bg-gradient-to-b from-black/80 via-black/50 to-transparent px-5 pt-14 pb-8">
              <p className="text-center text-lg leading-relaxed font-semibold whitespace-pre-line [text-shadow:0_1px_4px_#000]">
                {song.lyrics}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {/* Controls: one row, nothing else */}
      <div className="flex min-h-28 items-center justify-center px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {phase.kind === "setup" && (
          <div className="flex w-full max-w-sm items-center justify-between">
            <RoundButton label="Background" onClick={() => setSheet("bg")}>
              <BgIcon />
            </RoundButton>
            <button
              aria-label="Start recording"
              onClick={start}
              className="group flex h-20 w-20 items-center justify-center rounded-full ring-4 ring-white/90 transition active:scale-95"
            >
              <span className="h-16 w-16 rounded-full bg-red-600 transition group-hover:bg-red-500" />
            </button>
            <RoundButton label="Sound" onClick={() => setSheet("sound")}>
              <SoundIcon />
            </RoundButton>
          </div>
        )}
        {(phase.kind === "loading" || phase.kind === "countdown") && (
          <p className="text-sm text-white/70">
            {phase.kind === "loading" ? "Loading the song…" : "Get ready…"}
          </p>
        )}
        {phase.kind === "recording" && (
          <button
            aria-label="Stop recording"
            onClick={stopEarly}
            className="flex h-20 w-20 items-center justify-center rounded-full ring-4 ring-white/90 transition active:scale-95"
          >
            <span className="h-8 w-8 rounded-md bg-red-600" />
          </button>
        )}
        {phase.kind === "finishing" && (
          <p className="text-sm text-white/60">Almost there</p>
        )}
        {phase.kind === "done" && (
          <div className="w-full max-w-sm space-y-2">
            {original && phase.blob !== original && (
              <button
                onClick={() => showVideo(original)}
                className="w-full text-center text-xs text-white/55"
              >
                Edited · Undo edits
              </button>
            )}
            <div className="grid grid-cols-4 gap-2">
              <ActionButton onClick={again} icon="↺" label="Retake" />
              <ActionButton
                onClick={() => setEditing(true)}
                icon="✂"
                label="Edit"
              />
              <a
                href={phase.url}
                download={fileName(phase.ext)}
                className="flex flex-col items-center gap-1 rounded-2xl bg-white/10 py-3 text-sm font-medium hover:bg-white/15"
              >
                <span className="text-xl">⬇</span>
                Save
              </a>
              {canShareFile(phase.blob, phase.ext) ? (
                <ActionButton
                  primary
                  onClick={() => share(phase.blob, phase.ext)}
                  icon="↗"
                  label="Share"
                />
              ) : (
                <a
                  href={phase.url}
                  download={fileName(phase.ext)}
                  className="flex flex-col items-center gap-1 rounded-2xl bg-pink-600 py-3 text-sm font-semibold hover:bg-pink-500"
                >
                  <span className="text-xl">↗</span>
                  Save to share
                </a>
              )}
            </div>
          </div>
        )}
        {phase.kind === "done" && editing && (
          <VideoEditor
            blob={phase.blob}
            title={song.title}
            onCancel={() => setEditing(false)}
            onSave={(edited) => {
              setEditing(false);
              showVideo(edited);
            }}
          />
        )}
        {phase.kind === "error" && (
          <div className="w-full max-w-sm space-y-3 text-center">
            <p className="text-sm text-red-300">{phase.message}</p>
            <button
              onClick={again}
              className="w-full rounded-2xl bg-white/10 py-3 font-semibold"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Pop-up panels */}
      {sheet && (
        <div
          className="absolute inset-0 z-10 flex items-end justify-center bg-black/40"
          onClick={() => setSheet(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-t-3xl bg-neutral-900/95 p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] ring-1 ring-white/10 backdrop-blur-xl sm:mb-6 sm:rounded-3xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {sheet === "bg"
                  ? "Background"
                  : sheet === "part"
                    ? "Part of the song"
                    : "Sound"}
              </h2>
              <button
                onClick={() => setSheet(null)}
                className="rounded-full bg-white/10 px-3 py-1 text-sm"
              >
                Done
              </button>
            </div>

            {sheet === "bg" && (
              <>
                <div className="grid grid-cols-5 gap-2.5">
                  {BG_OPTIONS.map((o) => {
                    const selected = JSON.stringify(o.c) === JSON.stringify(bg);
                    const style: React.CSSProperties =
                      o.c.kind === "builtin"
                        ? {
                            backgroundImage: `url(${thumbs[o.c.id]})`,
                            backgroundSize: "cover",
                          }
                        : o.c.kind === "blur"
                          ? {
                              background:
                                "radial-gradient(circle at 50% 40%, #d4d4d8 0 22%, transparent 23%), linear-gradient(135deg,#52525b,#a1a1aa,#3f3f46)",
                              filter:
                                o.c.strength === "strong"
                                  ? "blur(2px)"
                                  : "blur(1px)",
                            }
                          : { background: "#27272a" };
                    return (
                      <button
                        key={o.key}
                        onClick={() => chooseBg(o.c)}
                        className={`flex flex-col items-center gap-1.5 text-[11px] ${selected ? "text-white" : "text-white/55"}`}
                      >
                        <span
                          style={style}
                          className={`flex aspect-[9/16] w-full items-center justify-center rounded-xl text-base ring-2 transition ${
                            selected ? "ring-pink-500" : "ring-white/10"
                          }`}
                        >
                          {o.c.kind === "none" ? "⊘" : ""}
                        </span>
                        {o.label}
                      </button>
                    );
                  })}
                  <label
                    className={`flex cursor-pointer flex-col items-center gap-1.5 text-[11px] ${bg.kind === "custom" ? "text-white" : "text-white/55"}`}
                  >
                    <span
                      style={
                        customUrl
                          ? {
                              backgroundImage: `url(${customUrl})`,
                              backgroundSize: "cover",
                            }
                          : undefined
                      }
                      className={`flex aspect-[9/16] w-full items-center justify-center rounded-xl bg-white/10 text-xl ring-2 ${
                        bg.kind === "custom" ? "ring-pink-500" : "ring-white/10"
                      }`}
                    >
                      {customUrl ? "" : "+"}
                    </span>
                    Your photo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        setCustomUrl(await saveCustomImage(file));
                        chooseBg({ kind: "custom" });
                      }}
                    />
                  </label>
                </div>
                <p className="mt-4 text-center text-xs text-white/50">
                  {fxStatus.kind === "loading"
                    ? "Getting your background ready…"
                    : fxStatus.kind === "error"
                      ? fxStatus.message
                      : "What you see is exactly what gets recorded."}
                </p>
              </>
            )}

            {sheet === "part" && (
              <PartPicker
                length={songLength}
                part={part}
                onChange={setPart}
                lineAt={(t) =>
                  song.timed?.length
                    ? (song.timed[currentLine(song.timed, t + 0.25)]?.text ??
                      "")
                    : ""
                }
              />
            )}

            {sheet === "sound" && (
              <div className="space-y-4">
                <Slider label="Music" value={music} onChange={setMusic} />
                <Slider
                  label="Voice"
                  value={voice}
                  onChange={setVoice}
                  max={2}
                />
                {studio && (
                  <Slider label="Reverb" value={reverb} onChange={setReverb} />
                )}
                <Toggle
                  label="Studio voice"
                  hint="Clarity, smooth levels and reverb"
                  checked={studio}
                  onChange={setStudio}
                />
                <Toggle
                  label="Wearing headphones"
                  hint={
                    headphones
                      ? "Best sound: the mic hears only you"
                      : "Speaker mode: echo cancelling removes the music"
                  }
                  checked={headphones}
                  onChange={(hp) => {
                    setHeadphones(hp);
                    try {
                      localStorage.setItem(
                        "song-recorder:headphones",
                        hp ? "yes" : "no",
                      );
                    } catch {}
                    stopCamera();
                    startCamera(undefined, micId, hp);
                  }}
                />
                {mics.length > 1 && (
                  <label className="flex items-center gap-3 text-sm">
                    <span className="w-16 shrink-0 text-white/80">Mic</span>
                    <select
                      value={micId || cam0MicId()}
                      onChange={(e) => {
                        setMicId(e.target.value);
                        stopCamera();
                        startCamera(undefined, e.target.value, headphones);
                      }}
                      className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2"
                    >
                      {mics.map((m, i) => (
                        <option
                          key={m.deviceId}
                          value={m.deviceId}
                          className="bg-neutral-900"
                        >
                          {m.label || `Microphone ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <p className="text-center text-xs leading-relaxed text-white/45">
                  {headphones
                    ? "Wired headphones sound best. Bluetooth ones switch the phone to a low-quality call mic."
                    : "Keep the music moderate and the phone 20–30 cm away."}
                  {camSize && (
                    <span className="mt-1 block text-white/30">
                      Camera {camSize}
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RoundButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-20 flex-col items-center gap-1.5 text-xs text-white/75"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/15 transition hover:bg-white/15 active:scale-95">
        {children}
      </span>
      {label}
    </button>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-2xl py-3 text-sm font-medium ${
        primary
          ? "bg-pink-600 font-semibold hover:bg-pink-500"
          : "bg-white/10 hover:bg-white/15"
      }`}
    >
      <span className="text-xl">{icon}</span>
      {label}
    </button>
  );
}

function BgIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.5 21c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" />
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    >
      <path d="M5 4v16M12 4v16M19 4v16" />
      <circle cx="5" cy="14" r="2" fill="currentColor" />
      <circle cx="12" cy="8" r="2" fill="currentColor" />
      <circle cx="19" cy="15" r="2" fill="currentColor" />
    </svg>
  );
}

// Pick the part of the song to sing: start and end, with the lyric line at
// each point so it's easy to find a verse.
function PartPicker({
  length,
  part,
  onChange,
  lineAt,
}: {
  length: number;
  part: { start: number; end: number } | null;
  onChange: (p: { start: number; end: number } | null) => void;
  lineAt: (t: number) => string;
}) {
  if (!length)
    return <p className="text-sm text-white/60">Loading the song…</p>;
  const start = part?.start ?? 0;
  const end = part?.end ?? length;
  const set = (s: number, e: number) =>
    onChange(s <= 0.5 && e >= length - 0.5 ? null : { start: s, end: e });
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Slider
          label={`From ${fmt(start)}`}
          value={start}
          max={length}
          step={1}
          onChange={(v) => set(Math.min(v, end - 5), end)}
        />
        {lineAt(start) && (
          <p className="pl-[5rem] text-xs text-white/45">“{lineAt(start)}”</p>
        )}
      </div>
      <div className="space-y-1">
        <Slider
          label={`To ${fmt(end)}`}
          value={end}
          max={length}
          step={1}
          onChange={(v) => set(start, Math.max(v, start + 5))}
        />
        {lineAt(end - 1) && (
          <p className="pl-[5rem] text-xs text-white/45">“{lineAt(end - 1)}”</p>
        )}
      </div>
      <div className="flex items-center justify-between text-xs text-white/50">
        <span>You&apos;ll sing {fmt(end - start)}</span>
        {part && (
          <button
            onClick={() => onChange(null)}
            className="rounded-full bg-white/10 px-3 py-1.5 text-white"
          >
            Whole song
          </button>
        )}
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
      <span>
        {label}
        <span className="block text-xs text-white/45">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="relative h-7 w-12 shrink-0 rounded-full bg-white/15 transition peer-checked:bg-pink-600 after:absolute after:top-1 after:left-1 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:after:translate-x-5" />
    </label>
  );
}

function Slider({
  label,
  value,
  onChange,
  max = 1,
  step = 0.05,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
  step?: number;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-[4.25rem] shrink-0 text-white/80 tabular-nums">
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-pink-500"
      />
    </label>
  );
}

// Browser recordings often don't store their length, so Safari labels them
// "Live Broadcast" and the seek bar doesn't work. Jumping far past the end
// makes the browser scan the file and learn the real length; then rewind.
function fixUnknownDuration(e: React.SyntheticEvent<HTMLVideoElement>) {
  const v = e.currentTarget;
  if (Number.isFinite(v.duration)) return;
  const rewind = () => {
    if (!Number.isFinite(v.duration)) return;
    v.removeEventListener("durationchange", rewind);
    v.currentTime = 0;
  };
  v.addEventListener("durationchange", rewind);
  v.currentTime = 1e101;
}
