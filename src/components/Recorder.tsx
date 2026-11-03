"use client";

import { useEffect, useRef, useState } from "react";
import type { Song } from "@/lib/library";
import TimedLyrics from "./TimedLyrics";
import { buildVocalChain } from "@/lib/vocalChain";
import { BackgroundFx } from "@/lib/backgroundFx";
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
  | { kind: "done"; url: string; ext: string }
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

export default function Recorder({
  song,
  onClose,
}: {
  song: Song;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const musicRef = useRef<AudioBufferSourceNode | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const voiceGainRef = useRef<GainNode | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const setReverbRef = useRef<(v: number) => void>(() => {});
  const fxRef = useRef<BackgroundFx | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);

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
  const [fxReady, setFxReady] = useState(false);
  const [fxError, setFxError] = useState("");
  const [thumbs] = useState(() =>
    Object.fromEntries(
      BUILTINS.map((b) => [b.id, paintBuiltin(b.id, 72, 96).toDataURL()]),
    ),
  );

  function chooseBg(c: BackgroundChoice) {
    setBg(c);
    saveChoice(c);
  }

  const fxActive =
    bg.kind !== "none" && phase.kind !== "done" && phase.kind !== "error";
  useEffect(() => {
    if (!fxActive) {
      fxRef.current?.stop();
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        fxRef.current ??= await BackgroundFx.create();
        (window as unknown as { __fx?: BackgroundFx }).__fx = fxRef.current;
        if (cancelled || !videoRef.current || !fxCanvasRef.current) return;
        fxRef.current.onError = (m) => setFxError(`Background effect stopped working: ${m}`);
        fxRef.current.setChoice(bg, customUrl);
        fxRef.current.start(videoRef.current, fxCanvasRef.current);
        setFxReady(true);
      } catch (e) {
        setFxError(
          `Backgrounds aren't available on this browser (${(e as Error).message}).`,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fxActive, bg, customUrl]);

  // Live preview of the front camera while setting up.
  function startCamera(
    isCancelled: () => boolean = () => false,
    mic = micId,
    hp = headphones,
  ) {
    const portrait = window.matchMedia("(orientation: portrait)").matches;
    navigator.mediaDevices
      .getUserMedia({
        // Full HD shaped like the screen: tall on a phone held upright,
        // wide on a laptop.
        video: {
          facingMode: "user",
          width: { ideal: portrait ? 1080 : 1920 },
          height: { ideal: portrait ? 1920 : 1080 },
          frameRate: { ideal: 30 },
        },
        // With headphones: raw, full-band voice. There is no echo to cancel,
        // and phone call filters make singing sound thin and pumpy; the
        // studio chain does the polishing instead.
        // Without headphones: the phone's echo cancelling removes the music
        // coming out of the speaker, so the video doesn't get it twice.
        audio: {
          ...(mic ? { deviceId: { exact: mic } } : {}),
          echoCancellation: !hp,
          noiseSuppression: !hp,
          autoGainControl: false,
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 24 },
          channelCount: { ideal: 1 },
        },
      })
      .then((stream) => {
        if (isCancelled()) return stream.getTracks().forEach((t) => t.stop());
        camRef.current = stream;
        // Tell the encoder to keep sharpness rather than drop resolution.
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
    ctxRef.current?.close().catch(() => {});
    wakeRef.current?.release().catch(() => {});
  }

  async function start() {
    const cam = camRef.current;
    if (!cam) return;
    try {
      setPhase({ kind: "loading" });
      // Must be created inside the tap so phones allow sound.
      const ctx = new AudioContext({ latencyHint: "interactive" });
      ctxRef.current = ctx;
      await ctx.resume();

      const res = await fetch(song.trackUrl);
      if (!res.ok) throw new Error("Could not load the karaoke track");
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      setDuration(buffer.duration);

      // Audio graph:
      //   music -> musicGain -> speakers/headphones (what you hear)
      //   music -> musicGain -> delay -> mix   (delayed to line up with your voice)
      //   mic   -> studio vocal chain -> voiceGain -> mix
      const mixOut = ctx.createMediaStreamDestination();
      // Limiter so loud notes (or voice turned up) never clip, with a little
      // headroom left for the MP4 encoder.
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

      // With a background effect, record the processed picture instead of
      // the raw camera.
      const useFx = bg.kind !== "none" && fxReady && !fxError && fxCanvasRef.current;
      const videoTracks = useFx
        ? fxCanvasRef.current!.captureStream(30).getVideoTracks()
        : cam.getVideoTracks();
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
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || "video/webm";
        const blob = new Blob(chunks, { type });
        setPhase({
          kind: "done",
          url: URL.createObjectURL(blob),
          ext: type.includes("mp4") ? "mp4" : "webm",
        });
        wakeRef.current?.release().catch(() => {});
        // Recording is over: switch the camera and mic off and silence audio.
        stopCamera();
        if (useFx) videoTracks.forEach((t) => t.stop());
        ctx.close().catch(() => {});
      };

      wakeRef.current =
        (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;

      for (let n = 3; n > 0; n--) {
        setPhase({ kind: "countdown", n });
        await sleep(1000);
      }

      rec.start(1000);
      src.start();
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

  function again() {
    if (phase.kind === "done") URL.revokeObjectURL(phase.url);
    ctxRef.current?.close().catch(() => {});
    setElapsed(0);
    setPhase({ kind: "setup" });
    startCamera();
  }

  const cam0MicId = () =>
    camRef.current?.getAudioTracks()[0]?.getSettings().deviceId ?? "";

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const live = phase.kind === "countdown" || phase.kind === "recording";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Camera preview (mirrored like a selfie) or the finished recording */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {phase.kind === "done" ? (
          // The key makes React build a fresh element. Reusing the camera's
          // element kept its live stream attached, which browsers show as a
          // "Live Broadcast" instead of your recording.
          <video
            key="playback"
            src={phase.url}
            controls
            playsInline
            onLoadedMetadata={fixUnknownDuration}
            className="h-full w-full object-contain"
          />
        ) : (
          <>
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
              className="h-full w-full -scale-x-100 object-cover"
            />
            {/* Processed picture (blur / background) drawn over the camera */}
            <canvas
              key="fx"
              ref={fxCanvasRef}
              className={`absolute inset-0 h-full w-full -scale-x-100 object-cover ${
                bg.kind !== "none" && fxReady && !fxError ? "" : "hidden"
              }`}
            />
            {bg.kind !== "none" && !fxReady && !fxError && (
              <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-xs">
                Loading background…
              </div>
            )}
          </>
        )}

        <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4">
          <button
            onClick={() => {
              cleanup();
              onClose();
            }}
            className="rounded-full bg-black/50 px-3 py-1.5 text-sm"
          >
            ✕ Close
          </button>
          <span className="truncate px-2 text-sm font-medium">
            {song.title}
          </span>
          {phase.kind === "recording" ? (
            <span className="flex items-center gap-1.5 rounded-full bg-red-600 px-3 py-1.5 text-sm font-semibold">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
              {fmt(elapsed)} / {fmt(duration)}
            </span>
          ) : (
            <span className="w-16" />
          )}
        </div>

        {phase.kind === "countdown" && (
          <div className="absolute inset-0 flex items-center justify-center text-8xl font-bold">
            {phase.n}
          </div>
        )}

        {/* Lyrics over the camera (not burned into the video): highlighted
            line by line when timings exist, otherwise static text. */}
        {song.timed?.length && phase.kind !== "done" ? (
          <div className="absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/85 via-black/50 to-transparent">
            <TimedLyrics
              lines={song.timed}
              time={phase.kind === "recording" ? elapsed : 0}
            />
          </div>
        ) : null}
        {song.lyrics && !song.timed?.length && phase.kind !== "done" && (
          <div className="absolute inset-x-0 bottom-0 max-h-[55%] overflow-y-auto bg-gradient-to-t from-black/85 via-black/60 to-transparent px-5 pb-4 pt-10">
            <p className="whitespace-pre-line text-center text-xl leading-relaxed font-semibold [text-shadow:0_1px_4px_#000]">
              {song.lyrics}
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-3 bg-neutral-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {phase.kind === "error" && (
          <p className="text-sm text-red-400">{phase.message}</p>
        )}

        {(phase.kind === "setup" || live || phase.kind === "loading") && (
          <>
            <Slider label="🎵 Music" value={music} onChange={setMusic} />
            <Slider
              label="🎤 Voice"
              value={voice}
              onChange={setVoice}
              max={2}
            />
            {studio && (
              <Slider label="✨ Reverb" value={reverb} onChange={setReverb} />
            )}
          </>
        )}

        {phase.kind === "setup" && (
          <>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {(
                [
                  {
                    key: "none",
                    label: "None",
                    c: { kind: "none" },
                    style: { background: "#262626" },
                  },
                  {
                    key: "blur",
                    label: "Blur",
                    c: { kind: "blur", strength: "light" },
                    style: {
                      background: "linear-gradient(135deg,#555,#999,#444)",
                      filter: "blur(1px)",
                    },
                  },
                  {
                    key: "blur2",
                    label: "More blur",
                    c: { kind: "blur", strength: "strong" },
                    style: {
                      background: "linear-gradient(135deg,#777,#aaa)",
                      filter: "blur(2px)",
                    },
                  },
                  ...BUILTINS.map((b) => ({
                    key: b.id,
                    label: b.label,
                    c: { kind: "builtin", id: b.id } as BackgroundChoice,
                    style: {
                      backgroundImage: `url(${thumbs[b.id]})`,
                      backgroundSize: "cover",
                    },
                  })),
                ] as {
                  key: string;
                  label: string;
                  c: BackgroundChoice;
                  style: React.CSSProperties;
                }[]
              ).map((o) => {
                const selected = JSON.stringify(o.c) === JSON.stringify(bg);
                return (
                  <button
                    key={o.key}
                    onClick={() => chooseBg(o.c)}
                    className={`flex shrink-0 flex-col items-center gap-1 text-[11px] ${selected ? "text-white" : "text-white/60"}`}
                  >
                    <span
                      style={o.style}
                      className={`block h-12 w-9 rounded-lg ring-2 ${selected ? "ring-pink-500" : "ring-white/10"}`}
                    />
                    {o.label}
                  </button>
                );
              })}
              <label
                className={`flex shrink-0 cursor-pointer flex-col items-center gap-1 text-[11px] ${bg.kind === "custom" ? "text-white" : "text-white/60"}`}
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
                  className={`flex h-12 w-9 items-center justify-center rounded-lg bg-white/10 text-lg ring-2 ${bg.kind === "custom" ? "ring-pink-500" : "ring-white/10"}`}
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
            {fxError && <p className="text-xs text-red-400">{fxError}</p>}

            <details className="rounded-xl bg-white/5 px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none text-white/80">
                ⚙️ Sound settings
              </summary>
              <div className="mt-3 space-y-3">
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    🎙️ Studio voice
                    <span className="block text-xs text-white/50">
                      EQ, compression and reverb, like a studio mix
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={studio}
                    onChange={(e) => setStudio(e.target.checked)}
                    className="h-5 w-5 accent-pink-500"
                  />
                </label>
                <label className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    🎧 Wearing headphones
                    <span className="block text-xs text-white/50">
                      {headphones
                        ? "Best sound: the mic hears only your voice"
                        : "Speaker mode: echo cancelling removes the music from the mic"}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    checked={headphones}
                    onChange={(e) => {
                      const hp = e.target.checked;
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
                    className="h-5 w-5 accent-pink-500"
                  />
                </label>
                {mics.length > 1 && (
                  <label className="flex items-center gap-3 text-sm">
                    <span className="w-20 shrink-0">🎤 Mic</span>
                    <select
                      value={micId || cam0MicId()}
                      onChange={(e) => {
                        setMicId(e.target.value);
                        stopCamera();
                        startCamera(undefined, e.target.value, headphones);
                      }}
                      className="min-w-0 flex-1 rounded-lg bg-white/10 px-2 py-1.5"
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
                <p className="text-center text-xs text-white/50">
                  {headphones
                    ? "Wired headphones sound best. Bluetooth headphones switch the phone to a low-quality call mic; if you use them, pick the phone's own mic above."
                    : "Keep the music volume moderate and hold the phone 20–30 cm away. Headphones still give the clearest voice."}
                </p>
              </div>
            </details>
            <button
              onClick={start}
              disabled={bg.kind !== "none" && !fxReady && !fxError}
              className="w-full rounded-xl bg-red-600 py-3.5 text-base font-semibold disabled:opacity-50"
            >
              ● Start recording
            </button>
          </>
        )}
        {phase.kind === "loading" && (
          <p className="text-center text-sm text-white/70">Loading the song…</p>
        )}
        {phase.kind === "recording" && (
          <button
            onClick={stopEarly}
            className="w-full rounded-xl bg-white/15 py-3.5 text-base font-semibold"
          >
            ■ Stop
          </button>
        )}
        {phase.kind === "done" && (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={again}
              className="rounded-xl bg-white/15 py-3.5 font-semibold"
            >
              ↺ Record again
            </button>
            <a
              href={phase.url}
              download={`${song.title}.${phase.ext}`}
              className="rounded-xl bg-pink-600 py-3.5 text-center font-semibold"
            >
              ⬇ Save video
            </a>
          </div>
        )}
      </div>
    </div>
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

function Slider({
  label,
  value,
  onChange,
  max = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-pink-500"
      />
    </label>
  );
}
