"use client";

import { useState } from "react";
import type { Song } from "@/lib/library";

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

  if (!songs.length) {
    return <p className="text-center text-sm text-white/50">No songs yet. Add one above.</p>;
  }
  return (
    <ul className="space-y-3">
      {songs.map((s) => (
        <li key={s.id} className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="font-medium">{s.title}</span>
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
                onUpdate({ ...s, lyrics: e.target.value });
                setEditing(null);
              }}
              className="mt-3 w-full rounded-xl bg-white/10 p-3 text-base outline-none focus:ring-2 focus:ring-pink-500"
            />
          ) : null}

          <div className="mt-3 grid grid-cols-2 gap-2">
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
    </ul>
  );
}
