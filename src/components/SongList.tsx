"use client";

import type { Song } from "@/lib/library";

export default function SongList({
  songs,
  onDelete,
}: {
  songs: Song[];
  onDelete: (id: string) => void;
}) {
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
        </li>
      ))}
    </ul>
  );
}
