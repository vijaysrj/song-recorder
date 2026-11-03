"use client";

import { useState } from "react";
import type { Song } from "@/lib/library";
import LyricsFinder from "./LyricsFinder";
import TapSync from "./TapSync";

export default function SongList({
  songs,
  onDelete,
  onUpdate,
  onSing,
}: {
  songs: Song[];
  onDelete: (id: string) => void;
  onUpdate: (song: Song) => void;
  onSing: (song: Song) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [finding, setFinding] = useState<string | null>(null);
  const [tapping, setTapping] = useState<Song | null>(null);

  if (!songs.length) {
    return <p className="text-center text-sm text-white/50">No songs yet. Add one above.</p>;
  }
  return (
    <ul className="space-y-3">
      {songs.map((s) => (
        <li key={s.id} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium">
              {s.title}
              {s.timed?.length ? (
                <span className="ml-2 rounded-full bg-green-600/30 px-2 py-0.5 text-xs text-green-300">
                  timed lyrics
                </span>
              ) : null}
            </span>
            <button
              onClick={() => confirm(`Remove "${s.title}"?`) && onDelete(s.id)}
              className="text-sm text-white/50"
            >
              Remove
            </button>
          </div>
          <audio controls preload="none" src={s.trackUrl} className="w-full" />
          <a
            href={`${s.trackUrl}${s.trackUrl.includes("?") ? "&" : "?"}download=1`}
            className="mt-2 inline-block text-sm text-pink-400"
          >
            ⬇ Download karaoke track
          </a>

          {editing === s.id ? (
            <textarea
              autoFocus
              defaultValue={s.lyrics}
              rows={8}
              placeholder="Paste the lyrics here (Tamil, Hindi or English letters)"
              onBlur={(e) => {
                const lyrics = e.target.value;
                // Changed words no longer match the saved timings.
                onUpdate(lyrics === s.lyrics ? s : { ...s, lyrics, timed: undefined });
                setEditing(null);
              }}
              className="mt-3 w-full rounded-xl bg-white/10 p-3 text-base outline-none focus:ring-2 focus:ring-pink-500"
            />
          ) : null}

          {finding === s.id && (
            <LyricsFinder
              song={s}
              onPick={(song) => {
                onUpdate(song);
                setFinding(null);
              }}
              onClose={() => setFinding(null)}
            />
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => setFinding(finding === s.id ? null : s.id)}
              className="rounded-xl bg-white/10 py-2.5 text-sm font-medium"
            >
              🔎 Find timed lyrics
            </button>
            <button
              onClick={() => setTapping(s)}
              disabled={!s.lyrics.trim()}
              title={s.lyrics.trim() ? "" : "Add lyrics first"}
              className="rounded-xl bg-white/10 py-2.5 text-sm font-medium disabled:opacity-40"
            >
              👆 Tap to time lines
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <button
              onClick={() => setEditing(editing === s.id ? null : s.id)}
              className="rounded-xl bg-white/10 py-2.5 text-sm font-medium"
            >
              {editing === s.id ? "Save lyrics" : s.lyrics ? "Edit lyrics" : "Add lyrics"}
            </button>
            <button
              onClick={() => onSing(s)}
              className="rounded-xl bg-pink-600 py-2.5 text-sm font-semibold"
            >
              🎤 Sing
            </button>
          </div>
        </li>
      ))}
      {tapping && (
        <TapSync
          song={tapping}
          onSave={(timed) => {
            onUpdate({ ...tapping, timed });
            setTapping(null);
          }}
          onClose={() => setTapping(null)}
        />
      )}
    </ul>
  );
}
