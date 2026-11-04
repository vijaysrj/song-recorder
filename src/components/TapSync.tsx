"use client";

import { useRef, useState } from "react";
import type { Song, TimedLine } from "@/lib/library";
import { fmtTime } from "@/lib/lrc";

// Play the song once and tap as each line starts; the times are saved.
export default function TapSync({
  song,
  onSave,
  onClose,
}: {
  song: Song;
  onSave: (timed: TimedLine[]) => void;
  onClose: () => void;
}) {
  const lines = song.lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [times, setTimes] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const next = times.length;
  const done = next >= lines.length;

  function tap() {
    const a = audioRef.current;
    if (!a || done) return;
    setTimes([...times, Math.max(0, a.currentTime - 0.15)]); // allow for reaction time
  }

  function restart() {
    const a = audioRef.current;
    if (a) {
      a.currentTime = 0;
      void a.play();
    }
    setTimes([]);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-950">
      <div className="flex items-center justify-between p-4">
        <button onClick={onClose} className="rounded-full bg-white/10 px-3 py-1.5 text-sm">
          ✕ Cancel
        </button>
        <span className="truncate px-2 text-sm font-medium">Time the lyrics</span>
        <span className="text-sm text-white/50">
          {Math.min(next, lines.length)}/{lines.length}
        </span>
      </div>

      <audio
        ref={audioRef}
        src={song.trackUrl}
        controls
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="mx-4 w-[calc(100%-2rem)]"
      />

      <ol className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {lines.map((l, i) => (
          <li
            key={i}
            className={`flex gap-3 py-1.5 ${i === next ? "text-lg font-bold text-white" : i < next ? "text-white/40" : "text-white/70"}`}
          >
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-white/40">
              {times[i] !== undefined ? fmtTime(times[i]) : ""}
            </span>
            <span>{l}</span>
          </li>
        ))}
      </ol>

      <div className="space-y-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {!playing && next === 0 && (
          <p className="text-center text-sm text-white/60">
            Press play, then tap the big button each time a line starts.
          </p>
        )}
        {!done ? (
          <button
            onClick={tap}
            disabled={!playing}
            className="w-full rounded-2xl bg-pink-600 py-6 text-lg font-bold disabled:opacity-40"
          >
            Tap: “{lines[next]}”
          </button>
        ) : (
          <button
            onClick={() => onSave(lines.map((text, i) => ({ t: times[i], text })))}
            className="w-full rounded-2xl bg-green-600 py-5 text-lg font-bold"
          >
            ✓ Save timings
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setTimes(times.slice(0, -1))}
            disabled={!times.length}
            className="rounded-xl bg-white/10 py-3 text-sm disabled:opacity-40"
          >
            ↶ Undo last tap
          </button>
          <button onClick={restart} className="rounded-xl bg-white/10 py-3 text-sm">
            ↺ Start over
          </button>
        </div>
      </div>
    </div>
  );
}
