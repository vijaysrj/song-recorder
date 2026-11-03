"use client";

import { upload } from "@vercel/blob/client";
import { useState } from "react";
import type { Song } from "@/lib/library";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; pct: number }
  | { kind: "separating"; seconds: number }
  | { kind: "error"; message: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Phones don't always label audio files correctly (an MP3 from Downloads or
// WhatsApp can come through with no type), so work it out from the name.
const AUDIO_TYPES: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
};
// Listing extensions as well as audio/* makes Android open the full file
// browser (Downloads, WhatsApp, Drive) instead of just the music library.
const ACCEPT = "audio/*,video/mp4," + Object.keys(AUDIO_TYPES).map((e) => "." + e).join(",");

function contentTypeFor(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type.startsWith("audio/") || file.type === "video/mp4") return file.type;
  return AUDIO_TYPES[ext] ?? "audio/mpeg";
}

export default function AddSong({ onAdded }: { onAdded: (s: Song) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [isKaraoke, setIsKaraoke] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind === "uploading" || phase.kind === "separating";

  async function start() {
    if (!file) return;
    try {
      setPhase({ kind: "uploading", pct: 0 });
      const blob = await upload(`songs/${file.name}`, file, {
        access: "public",
        contentType: contentTypeFor(file),
        handleUploadUrl: "/api/upload",
        onUploadProgress: (e) => setPhase({ kind: "uploading", pct: Math.round(e.percentage) }),
      });

      let trackUrl = blob.url;
      if (!isKaraoke) {
        const res = await fetch("/api/separate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: blob.url }),
        });
        const job = await res.json();
        if (!res.ok) throw new Error(job.error ?? "Could not start vocal removal");

        const startedAt = Date.now();
        for (;;) {
          setPhase({ kind: "separating", seconds: Math.round((Date.now() - startedAt) / 1000) });
          await sleep(4000);
          const s = await (await fetch(`/api/separate/${job.id}`)).json();
          if (s.status === "done") {
            trackUrl = s.url;
            break;
          }
          if (s.status === "failed") throw new Error(s.error ?? "Vocal removal failed");
        }
      }

      onAdded({
        id: crypto.randomUUID(),
        title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
        trackUrl,
        lyrics: "",
        createdAt: Date.now(),
      });
      setFile(null);
      setTitle("");
      setIsKaraoke(false);
      setPhase({ kind: "idle" });
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  }

  return (
    <section className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
      <h2 className="mb-3 text-lg font-semibold">Add a song</h2>

      <label className="block rounded-xl border-2 border-dashed border-white/20 p-5 text-center active:bg-white/5">
        <input
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
          }}
        />
        {file ? (
          <span className="break-all">{file.name}</span>
        ) : (
          <span className="text-white/60">Tap to choose a song (MP3 or M4A)</span>
        )}
      </label>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Song name"
        disabled={busy}
        className="mt-3 w-full rounded-xl bg-white/10 px-4 py-3 text-base outline-none focus:ring-2 focus:ring-pink-500"
      />

      <label className="mt-3 flex items-center gap-3 text-sm text-white/80">
        <input
          type="checkbox"
          checked={isKaraoke}
          disabled={busy}
          onChange={(e) => setIsKaraoke(e.target.checked)}
          className="h-5 w-5 accent-pink-500"
        />
        This is already a karaoke track (no singing), skip vocal removal
      </label>

      <button
        onClick={start}
        disabled={!file || busy}
        className="mt-4 w-full rounded-xl bg-pink-600 py-3 text-base font-semibold disabled:opacity-40"
      >
        {isKaraoke ? "Add song" : "Remove vocals and add"}
      </button>

      {phase.kind === "uploading" && (
        <p className="mt-3 text-sm text-white/70">Uploading… {phase.pct}%</p>
      )}
      {phase.kind === "separating" && (
        <p className="mt-3 text-sm text-white/70">
          Removing vocals… {phase.seconds}s (usually 1 to 3 minutes, keep this page open)
        </p>
      )}
      {phase.kind === "error" && (
        <p className="mt-3 text-sm text-red-400">Something went wrong: {phase.message}</p>
      )}
    </section>
  );
}
