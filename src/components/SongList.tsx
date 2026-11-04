"use client";

import { useState } from "react";
import type { Song } from "@/lib/library";
import LyricsFinder from "./LyricsFinder";
import TapSync from "./TapSync";

// One card per song: a big Sing button, with everything else tucked under
// "More" so the list stays calm.
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
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [finding, setFinding] = useState<string | null>(null);
  const [tapping, setTapping] = useState<Song | null>(null);

  if (!songs.length) {
    return (
      <p className="rounded-2xl bg-white/[0.03] p-6 text-center text-sm text-white/50 ring-1 ring-white/10">
        No songs yet. Add your first one below.
      </p>
    );
  }
  return (
    <ul className="space-y-3">
      {songs.map((s) => {
        const isOpen = open === s.id;
        const lyricsNote = s.timed?.length
          ? { text: "Lyrics timed", cls: "text-emerald-300" }
          : s.lyrics.trim()
            ? { text: "Lyrics added", cls: "text-white/55" }
            : { text: "No lyrics yet", cls: "text-white/40" };
        return (
          <li
            key={s.id}
            className="overflow-hidden rounded-2xl bg-white/[0.05] ring-1 ring-white/10"
          >
            <div className="flex items-center gap-3 p-3 pl-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-pink-500/40 to-fuchsia-600/40 text-lg">
                ♪
              </div>
              <button
                onClick={() => setOpen(isOpen ? null : s.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate font-semibold">{s.title}</span>
                <span className={`text-xs ${lyricsNote.cls}`}>
                  {lyricsNote.text} · {isOpen ? "Less" : "More"}{" "}
                  {isOpen ? "▴" : "▾"}
                </span>
              </button>
              <button
                onClick={() => onSing(s)}
                className="shrink-0 rounded-full bg-pink-600 px-5 py-2.5 text-sm font-semibold shadow-lg shadow-pink-600/25 hover:bg-pink-500 active:scale-95"
              >
                Sing
              </button>
            </div>

            {isOpen && (
              <div className="space-y-3 border-t border-white/10 p-4">
                <audio
                  controls
                  preload="none"
                  src={s.trackUrl}
                  className="h-10 w-full"
                />

                <div className="grid grid-cols-2 gap-2">
                  <SmallButton
                    onClick={() => setEditing(editing === s.id ? null : s.id)}
                  >
                    {editing === s.id
                      ? "Save lyrics"
                      : s.lyrics
                        ? "Edit lyrics"
                        : "Add lyrics"}
                  </SmallButton>
                  <SmallButton
                    onClick={() => setFinding(finding === s.id ? null : s.id)}
                  >
                    Find timed lyrics
                  </SmallButton>
                  <SmallButton
                    onClick={() => setTapping(s)}
                    disabled={!s.lyrics.trim()}
                  >
                    Tap to time lines
                  </SmallButton>
                  <a
                    href={`${s.trackUrl}${s.trackUrl.includes("?") ? "&" : "?"}download=1`}
                    className="rounded-xl bg-white/[0.07] py-2.5 text-center text-sm font-medium hover:bg-white/10"
                  >
                    Download track
                  </a>
                </div>

                {editing === s.id ? (
                  <textarea
                    autoFocus
                    defaultValue={s.lyrics}
                    rows={8}
                    placeholder="Paste the lyrics here (Tamil, Hindi or English letters)"
                    onBlur={(e) => {
                      const lyrics = e.target.value;
                      // Changed words no longer match the saved timings.
                      onUpdate(
                        lyrics === s.lyrics
                          ? s
                          : { ...s, lyrics, timed: undefined },
                      );
                      setEditing(null);
                    }}
                    className="w-full rounded-xl bg-white/10 p-3 text-base outline-none focus:ring-2 focus:ring-pink-500"
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

                <button
                  onClick={() =>
                    confirm(`Remove "${s.title}"?`) && onDelete(s.id)
                  }
                  className="w-full pt-1 text-center text-xs text-red-300/80"
                >
                  Remove song
                </button>
              </div>
            )}
          </li>
        );
      })}
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

function SmallButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-xl bg-white/[0.07] py-2.5 text-sm font-medium hover:bg-white/10 disabled:opacity-35"
    >
      {children}
    </button>
  );
}
