"use client";

import { useSyncExternalStore } from "react";
import AddSong from "@/components/AddSong";
import SongList from "@/components/SongList";
import { songStore } from "@/lib/library";

export default function Home() {
  const songs = useSyncExternalStore(songStore.subscribe, songStore.get, songStore.getServer);
  const update = songStore.set;

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold">🎤 Song Recorder</h1>
        <p className="text-sm text-white/60">Add a song, and the vocals are removed for karaoke.</p>
      </header>
      <AddSong onAdded={(s) => update([s, ...songs])} />
      <section>
        <h2 className="mb-3 text-lg font-semibold">My karaoke tracks</h2>
        <SongList songs={songs} onDelete={(id) => update(songs.filter((s) => s.id !== id))} />
      </section>
    </main>
  );
}
