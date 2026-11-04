"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import AddSong from "@/components/AddSong";
import Recorder from "@/components/Recorder";
import SongList from "@/components/SongList";
import { songStore, type Song } from "@/lib/library";

export default function Studio() {
  const songs = useSyncExternalStore(
    songStore.subscribe,
    songStore.get,
    songStore.getServer,
  );
  const update = songStore.set;
  const [singing, setSinging] = useState<Song | null>(null);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-6 pb-10">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold">
          🎤 Song Recorder
        </Link>
        <a
          href="/api/auth/logout"
          className="rounded-full px-3 py-1.5 text-sm text-white/50 hover:bg-white/5"
        >
          Sign out
        </a>
      </header>
      <h1 className="mb-1 text-2xl font-bold">Your songs</h1>
      <p className="mb-5 text-sm text-white/55">Pick a song and tap Sing.</p>
      <SongList
        songs={songs}
        onDelete={(id) => update(songs.filter((s) => s.id !== id))}
        onUpdate={(song) =>
          update(songs.map((s) => (s.id === song.id ? song : s)))
        }
        onSing={setSinging}
      />
      <div className="mt-4">
        <AddSong
          startOpen={songs.length === 0}
          onAdded={(s) => update([s, ...songs])}
        />
      </div>
      {singing && <Recorder song={singing} onClose={() => setSinging(null)} />}
    </main>
  );
}
