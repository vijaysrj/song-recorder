"use client";

import { useEffect, useRef, useState } from "react";
import {
  exportEdit,
  keptRanges,
  type Range,
  videoDuration,
} from "@/lib/editVideo";

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
};

// Trim the start and end of your video and cut out parts in the middle.
// The preview plays the edit as it will be saved (skipping cut parts).
export default function VideoEditor({
  blob,
  onSave,
  onCancel,
}: {
  blob: Blob;
  onSave: (edited: Blob) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
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

  function markCut() {
    if (cutStart === null) {
      setCutStart(time);
      return;
    }
    const a = Math.min(cutStart, time);
    const b = Math.max(cutStart, time);
    if (b - a > 0.1) setCuts([...cuts, { start: a, end: b }]);
    setCutStart(null);
  }

  async function save() {
    setError("");
    setSaving(0);
    videoRef.current?.pause();
    try {
      const edited = await exportEdit(blob, keep, (p) => setSaving(p));
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
          {cutStart !== null && (
            <div
              className="absolute inset-y-0 bg-red-500/40"
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
          <button
            onClick={markCut}
            className={`rounded-full px-4 py-2 text-sm font-semibold ${
              cutStart === null ? "bg-white/10" : "bg-red-600"
            }`}
          >
            {cutStart === null
              ? "✂ Cut from here"
              : `✂ …to here (from ${fmt(cutStart)})`}
          </button>
          {cutStart !== null && (
            <button
              onClick={() => setCutStart(null)}
              className="text-sm text-white/60"
            >
              Cancel cut
            </button>
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
        </div>
        <p className="text-xs text-white/40">
          Play or drag to a spot, tap “Cut from here”, move to where the part
          ends, then tap again.
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
