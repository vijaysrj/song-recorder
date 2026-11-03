"use client";

import { useState, useSyncExternalStore } from "react";
import AddSong from "@/components/AddSong";
import Recorder from "@/components/Recorder";
import SongList from "@/components/SongList";
import { songStore, type Song } from "@/lib/library";

export default function Home() {
  const songs = useSyncExternalStore(songStore.subscribe, songStore.get, songStore.getServer);
  const update = songStore.set;
  const [singing, setSinging] = useState<Song | null>(null);

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-6 px-4 py-6">
      <header>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">🎤 Song Recorder</h1>
          <a href="/api/auth/logout" className="text-sm text-white/50">
            Sign out
          </a>
        </div>
        <p className="text-sm text-white/60">Add a song, paste the lyrics, then tap Sing to record yourself.</p>
      </header>
      <AddSong onAdded={(s) => update([s, ...songs])} />
      <section>
        <h2 className="mb-3 text-lg font-semibold">My karaoke tracks</h2>
        <SongList
          songs={songs}
          onDelete={(id) => update(songs.filter((s) => s.id !== id))}
          onUpdate={(song) => update(songs.map((s) => (s.id === song.id ? song : s)))}
          onSing={setSinging}
        />
      </section>
      {singing && <Recorder song={singing} onClose={() => setSinging(null)} />}
    </main>
  );
}
