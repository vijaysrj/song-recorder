"use client";

import { useEffect, useRef, useState } from "react";
import {
  exportEdit,
  inRanges,
  keptRanges,
  type Range,
  videoDuration,
} from "@/lib/editVideo";
import { audioLevels, drawInterlude } from "@/lib/interlude";

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};

type Mark = "cut" | "hide";

// Trim the start and end of your video, cut out parts in the middle, and
// hide the camera in parts (like an interlude) to show a music animation.
// The preview plays the edit as it will be saved.
export default function VideoEditor({
  blob,
  title,
  onSave,
  onCancel,
}: {
  blob: Blob;
  title: string;
  onSave: (edited: Blob) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const animRef = useRef<HTMLCanvasElement>(null);
  const levelsRef = useRef<Float32Array | null>(null);
  const [hidden, setHidden] = useState<Range[]>([]);
  const [markKind, setMarkKind] = useState<Mark>("cut");
  const [duration, setDuration] = useState(0);
  const [trim, setTrim] = useState<Range>({ start: 0, end: 0 });
  const [cuts, setCuts] = useState<Range[]>([]);
  const [cutStart, setCutStart] = useState<number | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    // Set directly (not via state) so the address is made and freed together.
    const u = URL.createObjectURL(blob);
    if (videoRef.current) videoRef.current.src = u;
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  useEffect(() => {
    let off = false;
    videoDuration(blob)
      .then((d) => {
        if (off) return;
        setDuration(d);
        setTrim({ start: 0, end: d });
      })
      .catch((e) =>
        setError(`Couldn't read the video (${(e as Error).message})`),
      );
    return () => {
      off = true;
    };
  }, [blob]);

  // Loudness of the sound, so the animation can move with the music.
  useEffect(() => {
    let off = false;
    audioLevels(blob)
      .then((l) => {
        if (!off) levelsRef.current = l;
      })
      .catch(() => {});
    return () => {
      off = true;
    };
  }, [blob]);

  const hiding = inRanges(time, hidden);
  // Draw the animation over the preview while in a hidden part.
  useEffect(() => {
    if (!hiding) return;
    const v = videoRef.current;
    const c = animRef.current;
    const ctx = c?.getContext("2d");
    if (!v || !c || !ctx) return;
    c.width = v.videoWidth || 1080;
    c.height = v.videoHeight || 1920;
    let raf = 0;
    const frame = () => {
      drawInterlude(
        ctx,
        c.width,
        c.height,
        v.currentTime,
        levelsRef.current,
        title,
      );
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [hiding, title]);

  const keep = duration ? keptRanges(trim, cuts) : [];
  const keptLength = keep.reduce((s, r) => s + r.end - r.start, 0);

  // Play only the kept parts.
  function onTimeUpdate() {
    const v = videoRef.current;
    if (!v) return;
    const t = v.currentTime;
    setTime(t);
    if (v.paused) return;
    const inKept = keep.find((r) => t >= r.start - 0.05 && t < r.end);
    if (inKept) return;
    const next = keep.find((r) => r.start > t);
    if (next) v.currentTime = next.start;
    else {
      v.pause();
      v.currentTime = keep[0]?.start ?? 0;
    }
  }

  function seek(t: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(duration, t));
    setTime(v.currentTime);
  }

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      if (
        !keep.some(
          (r) => v.currentTime >= r.start && v.currentTime < r.end - 0.1,
        )
      )
        v.currentTime = keep[0]?.start ?? 0;
      v.play();
    } else v.pause();
  }

  function mark(kind: Mark) {
    if (cutStart === null) {
      setMarkKind(kind);
      setCutStart(time);
      return;
    }
    const a = Math.min(cutStart, time);
    const b = Math.max(cutStart, time);
    if (b - a > 0.1) {
      const r = { start: a, end: b };
      if (markKind === "cut") setCuts([...cuts, r]);
      else setHidden([...hidden, r].sort((x, y) => x.start - y.start));
    }
    setCutStart(null);
  }

  async function save() {
    setError("");
    setSaving(0);
    videoRef.current?.pause();
    try {
      const edited = await exportEdit(blob, keep, (p) => setSaving(p), {
        ranges: hidden,
        levels: levelsRef.current ?? (await audioLevels(blob)),
        title,
      });
      onSave(edited);
    } catch (e) {
      setError(`Couldn't save the edit (${(e as Error).message})`);
      setSaving(null);
    }
  }

  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      <div className="flex items-center justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button
          onClick={onCancel}
          disabled={saving !== null}
          className="rounded-full px-3 py-1.5 text-sm text-white/70"
        >
          Cancel
        </button>
        <span className="text-sm font-semibold">Edit video</span>
        <button
          onClick={save}
          disabled={saving !== null || !keep.length}
          className="rounded-full bg-pink-600 px-4 py-1.5 text-sm font-semibold disabled:opacity-40"
        >
          Save
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <video
          ref={videoRef}
          playsInline
          onClick={togglePlay}
          onTimeUpdate={onTimeUpdate}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          className="max-h-full max-w-full"
        />
        {hiding && (
          <canvas
            ref={animRef}
            onClick={togglePlay}
            className="absolute inset-0 h-full w-full object-contain"
          />
        )}
        {!playing && saving === null && (
          <button
            aria-label="Play"
            onClick={togglePlay}
            className="absolute flex h-16 w-16 items-center justify-center rounded-full bg-black/50 text-2xl backdrop-blur-md"
          >
            ▶
          </button>
        )}
        {saving !== null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 px-10">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/20 border-t-pink-500" />
            <p className="font-medium">
              Saving your edit… {Math.round(saving * 100)}%
            </p>
          </div>
        )}
      </div>

      <div className="space-y-4 p-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {/* Timeline: kept parts bright, cut parts red; tap to jump */}
        <div
          className="relative h-12 cursor-pointer overflow-hidden rounded-xl bg-white/10"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - r.left) / r.width) * duration);
          }}
        >
          {keep.map((r, i) => (
            <div
              key={i}
              className="absolute inset-y-0 bg-pink-500/50"
              style={{ left: pct(r.start), width: pct(r.end - r.start) }}
            />
          ))}
          {cuts.map((c, i) => (
            <div
              key={i}
              className="absolute inset-y-0 bg-[repeating-linear-gradient(45deg,rgba(239,68,68,0.6)_0_6px,rgba(239,68,68,0.25)_6px_12px)]"
              style={{ left: pct(c.start), width: pct(c.end - c.start) }}
            />
          ))}
          {hidden.map((c, i) => (
            <div
              key={i}
              className="absolute inset-y-0 bg-violet-500/70"
              style={{ left: pct(c.start), width: pct(c.end - c.start) }}
            />
          ))}
          {cutStart !== null && (
            <div
              className={`absolute inset-y-0 ${markKind === "cut" ? "bg-red-500/40" : "bg-violet-400/40"}`}
              style={{
                left: pct(Math.min(cutStart, time)),
                width: pct(Math.abs(time - cutStart)),
              }}
            />
          )}
          <div
            className="absolute inset-y-0 w-0.5 bg-white"
            style={{ left: pct(time) }}
          />
        </div>
        <div className="flex justify-between text-xs text-white/60 tabular-nums">
          <span>{fmt(time)}</span>
          <span>Final length {fmt(keptLength)}</span>
        </div>

        <Slider
          label="Start"
          value={trim.start}
          max={duration}
          onChange={(v) => {
            const start = Math.min(v, trim.end - 0.5);
            setTrim({ ...trim, start });
            seek(start);
          }}
        />
        <Slider
          label="End"
          value={trim.end}
          max={duration}
          onChange={(v) => {
            const end = Math.max(v, trim.start + 0.5);
            setTrim({ ...trim, end });
            seek(end);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          {cutStart === null ? (
            <>
              <button
                onClick={() => mark("cut")}
                className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
              >
                ✂ Cut from here
              </button>
              <button
                onClick={() => mark("hide")}
                className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold"
              >
                ♪ Hide video from here
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => mark(markKind)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  markKind === "cut" ? "bg-red-600" : "bg-violet-600"
                }`}
              >
                {markKind === "cut" ? "✂" : "♪"} …to here (from {fmt(cutStart)})
              </button>
              <button
                onClick={() => setCutStart(null)}
                className="text-sm text-white/60"
              >
                Cancel
              </button>
            </>
          )}
          {cuts.map((c, i) => (
            <span
              key={i}
              className="flex items-center gap-1 rounded-full bg-red-600/25 px-3 py-1.5 text-xs"
            >
              Cut {fmt(c.start)}–{fmt(c.end)}
              <button
                aria-label="Undo this cut"
                onClick={() => setCuts(cuts.filter((_, j) => j !== i))}
                className="px-1"
              >
                ✕
              </button>
            </span>
          ))}
          {hidden.map((c, i) => (
            <span
              key={`h${i}`}
              className="flex items-center gap-1 rounded-full bg-violet-600/30 px-3 py-1.5 text-xs"
            >
              Animation {fmt(c.start)}–{fmt(c.end)}
              <button
                aria-label="Show my video here again"
                onClick={() => setHidden(hidden.filter((_, j) => j !== i))}
                className="px-1"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <p className="text-xs text-white/40">
          Play or tap the bar to reach a spot, tap “Cut from here” (removes it)
          or “Hide video from here” (shows a music animation, e.g. for an
          interlude), move to where the part ends, then tap again.
        </p>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <span className="w-12 shrink-0 text-white/80">{label}</span>
      <input
        type="range"
        min={0}
        max={max || 1}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-pink-500"
      />
      <span className="w-12 text-right text-xs text-white/60 tabular-nums">
        {fmt(value)}
      </span>
    </label>
  );
}
