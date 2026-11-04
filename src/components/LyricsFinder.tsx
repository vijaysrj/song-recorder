"use client";

import { useState } from "react";
import type { Song } from "@/lib/library";
import { fmtTime, parseLrc } from "@/lib/lrc";

type Result = {
  id: number;
  title: string;
  artist: string;
  album: string;
  duration: number;
  plainLyrics: string;
  syncedLyrics: string;
};

// Looks up timed lyrics online and lets you pick the matching song.
export default function LyricsFinder({
  song,
  onPick,
  onClose,
}: {
  song: Song;
  onPick: (song: Song) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState(song.title);
  const [results, setResults] = useState<Result[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/lyrics?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed");
      setResults(data as Result[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-xl bg-black/30 p-3">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Song name, film or singer"
          className="min-w-0 flex-1 rounded-lg bg-white/10 px-3 py-2 text-base outline-none focus:ring-2 focus:ring-pink-500"
        />
        <button onClick={search} disabled={busy} className="rounded-lg bg-pink-600 px-4 text-sm font-semibold">
          {busy ? "…" : "Search"}
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {results && !results.length && (
        <p className="text-sm text-white/60">
          No timed lyrics found. Try the film or singer name, or use “Tap to time lines”.
        </p>
      )}
      {results?.map((r) => (
        <button
          key={r.id}
          onClick={() =>
            onPick({
              ...song,
              lyrics: r.plainLyrics || parseLrc(r.syncedLyrics).map((l) => l.text).join("\n"),
              timed: parseLrc(r.syncedLyrics),
            })
          }
          className="block w-full rounded-lg bg-white/5 p-3 text-left active:bg-white/10"
        >
          <span className="block font-medium">{r.title}</span>
          <span className="block text-xs text-white/60">
            {r.artist}
            {r.album ? ` · ${r.album}` : ""} · {fmtTime(r.duration)}
          </span>
          <span className="mt-1 line-clamp-2 block text-xs text-white/40">
            {parseLrc(r.syncedLyrics)
              .slice(0, 3)
              .map((l) => l.text)
              .filter(Boolean)
              .join(" / ")}
          </span>
        </button>
      ))}
      <button onClick={onClose} className="text-sm text-white/50">
        Close
      </button>
    </div>
  );
}
