"use client";

import { useEffect, useRef, useState } from "react";
import type { Song } from "@/lib/library";

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
  return types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Recorder({ song, onClose }: { song: Song; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const camRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const musicRef = useRef<AudioBufferSourceNode | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const musicGainRef = useRef<GainNode | null>(null);
  const voiceGainRef = useRef<GainNode | null>(null);
  const wakeRef = useRef<WakeLockSentinel | null>(null);

  const [phase, setPhase] = useState<Phase>({ kind: "setup" });
  const [voice, setVoice] = useState(1);
  const [music, setMusic] = useState(0.8);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);

  // Live preview of the front camera while setting up.
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 1280 } },
        // Raw voice: with headphones there is no echo to cancel, and these
        // filters make singing sound thin.
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        camRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch((e) =>
        setPhase({ kind: "error", message: `Camera or microphone blocked: ${(e as Error).message}` }),
      );
    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (musicGainRef.current) musicGainRef.current.gain.value = music;
  }, [music]);
  useEffect(() => {
    if (voiceGainRef.current) voiceGainRef.current.gain.value = voice;
  }, [voice]);

  function cleanup() {
    try {
      musicRef.current?.stop();
    } catch {}
    if (recRef.current?.state === "recording") recRef.current.stop();
    camRef.current?.getTracks().forEach((t) => t.stop());
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
      //   mic   -> voiceGain -> mix
      const mixOut = ctx.createMediaStreamDestination();
      // Gentle limiter so loud notes (or voice turned up) don't distort.
      const mix = ctx.createDynamicsCompressor();
      mix.threshold.value = -6;
      mix.knee.value = 6;
      mix.ratio.value = 12;
      mix.attack.value = 0.003;
      mix.release.value = 0.25;
      mix.connect(mixOut);
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

      ctx.createMediaStreamSource(cam).connect(voiceGain).connect(mix);

      const stream = new MediaStream([...cam.getVideoTracks(), ...mixOut.stream.getAudioTracks()]);
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 2_500_000,
        audioBitsPerSecond: 192_000,
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
      };

      wakeRef.current = (await navigator.wakeLock?.request("screen").catch(() => null)) ?? null;

      for (let n = 3; n > 0; n--) {
        setPhase({ kind: "countdown", n });
        await sleep(1000);
      }

      rec.start(1000);
      src.start();
      const startedAt = ctx.currentTime;
      setPhase({ kind: "recording" });
      const timer = setInterval(() => setElapsed(ctx.currentTime - startedAt), 250);
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
    try {
      musicRef.current?.stop(); // triggers onended, which stops the recorder
    } catch {}
  }

  function again() {
    if (phase.kind === "done") URL.revokeObjectURL(phase.url);
    ctxRef.current?.close().catch(() => {});
    setElapsed(0);
    setPhase({ kind: "setup" });
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const live = phase.kind === "countdown" || phase.kind === "recording";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Camera preview (mirrored like a selfie) or the finished recording */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {phase.kind === "done" ? (
          <video src={phase.url} controls playsInline className="h-full w-full object-contain" />
        ) : (
          <video
            ref={(el) => {
              videoRef.current = el;
              if (el && camRef.current && el.srcObject !== camRef.current) el.srcObject = camRef.current;
            }}
            autoPlay
            muted
            playsInline
            className="h-full w-full -scale-x-100 object-cover"
          />
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
          <span className="truncate px-2 text-sm font-medium">{song.title}</span>
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

        {/* Static lyrics over the camera. Not burned into the video. */}
        {song.lyrics && phase.kind !== "done" && (
          <div className="absolute inset-x-0 bottom-0 max-h-[55%] overflow-y-auto bg-gradient-to-t from-black/85 via-black/60 to-transparent px-5 pb-4 pt-10">
            <p className="whitespace-pre-line text-center text-xl leading-relaxed font-semibold [text-shadow:0_1px_4px_#000]">
              {song.lyrics}
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="space-y-3 bg-neutral-950 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {phase.kind === "error" && <p className="text-sm text-red-400">{phase.message}</p>}

        {(phase.kind === "setup" || live || phase.kind === "loading") && (
          <>
            <Slider label="🎵 Music" value={music} onChange={setMusic} />
            <Slider label="🎤 Voice" value={voice} onChange={setVoice} max={2} />
          </>
        )}

        {phase.kind === "setup" && (
          <>
            <p className="text-center text-xs text-white/50">
              🎧 Plug in headphones so the music stays out of the mic.
            </p>
            <button onClick={start} className="w-full rounded-xl bg-red-600 py-3.5 text-base font-semibold">
              ● Start recording
            </button>
          </>
        )}
        {phase.kind === "loading" && <p className="text-center text-sm text-white/70">Loading the song…</p>}
        {phase.kind === "recording" && (
          <button onClick={stopEarly} className="w-full rounded-xl bg-white/15 py-3.5 text-base font-semibold">
            ■ Stop
          </button>
        )}
        {phase.kind === "done" && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={again} className="rounded-xl bg-white/15 py-3.5 font-semibold">
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
