"use client";

import { useState } from "react";
import type { Song } from "@/lib/library";
import { shrinkForUpload } from "@/lib/shrinkAudio";
import { saveTrack } from "@/lib/tracks";

type Phase =
  | { kind: "idle" }
  | { kind: "preparing"; pct: number }
  | { kind: "uploading" }
  | { kind: "saving" }
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
const ACCEPT =
  "audio/*,video/mp4," +
  Object.keys(AUDIO_TYPES)
    .map((e) => "." + e)
    .join(",");

function contentTypeFor(file: File) {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.type.startsWith("audio/") || file.type === "video/mp4")
    return file.type;
  return AUDIO_TYPES[ext] ?? "audio/mpeg";
}

export default function AddSong({
  onAdded,
  startOpen = false,
}: {
  onAdded: (s: Song) => void;
  startOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(startOpen);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [isKaraoke, setIsKaraoke] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const busy = phase.kind !== "idle" && phase.kind !== "error";

  async function start() {
    if (!file) return;
    try {
      const id = crypto.randomUUID();
      const type = contentTypeFor(file);
      let track: Blob = new Blob([file], { type });
      if (!isKaraoke) {
        setPhase({ kind: "preparing", pct: 0 });
        const small = await shrinkForUpload(file, type, (p) =>
          setPhase({ kind: "preparing", pct: Math.round(p * 100) }),
        );
        setPhase({ kind: "uploading" });
        const res = await fetch("/api/separate", {
          method: "POST",
          headers: { "Content-Type": small.type || type },
          body: small,
        });
        const job = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(
            job.error ??
              (res.status === 413
                ? "The song file is too big"
                : "Could not start vocal removal"),
          );

        const startedAt = Date.now();
        for (;;) {
          setPhase({
            kind: "separating",
            seconds: Math.round((Date.now() - startedAt) / 1000),
          });
          await sleep(4000);
          const s = await (await fetch(`/api/separate/${job.id}`)).json();
          if (s.status === "done") break;
          if (s.status === "failed")
            throw new Error(s.error ?? "Vocal removal failed");
        }
        setPhase({ kind: "saving" });
        const out = await fetch(`/api/separate/${job.id}/track`);
        if (!out.ok) throw new Error("Could not download the karaoke track");
        track = new Blob([await out.blob()], { type: "audio/mpeg" });
      }
      await saveTrack(id, track);

      onAdded({
        id,
        title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
        trackUrl: "",
        lyrics: "",
        createdAt: Date.now(),
      });
      setFile(null);
      setTitle("");
      setIsKaraoke(false);
      setPhase({ kind: "idle" });
      setExpanded(false);
    } catch (e) {
      setPhase({ kind: "error", message: (e as Error).message });
    }
  }

  if (!expanded && !busy) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-white/20 py-4 text-sm font-medium text-white/75 hover:bg-white/[0.03]"
      >
        <span className="text-lg leading-none">＋</span> Add a song
      </button>
    );
  }

  return (
    <section className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">Add a song</h2>
        {!busy && (
          <button
            onClick={() => setExpanded(false)}
            className="text-sm text-white/50"
          >
            Cancel
          </button>
        )}
      </div>

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
          <span className="text-white/60">
            Tap to choose a song (MP3 or M4A)
          </span>
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

      {phase.kind === "preparing" && (
        <p className="mt-3 text-sm text-white/70">
          Preparing the song… {phase.pct}%
        </p>
      )}
      {phase.kind === "uploading" && (
        <p className="mt-3 text-sm text-white/70">Sending the song…</p>
      )}
      {phase.kind === "saving" && (
        <p className="mt-3 text-sm text-white/70">
          Saving the karaoke track on this phone…
        </p>
      )}
      {phase.kind === "separating" && (
        <p className="mt-3 text-sm text-white/70">
          Removing vocals… {phase.seconds}s (usually 1 to 3 minutes, keep this
          page open)
        </p>
      )}
      {phase.kind === "error" && (
        <p className="mt-3 text-sm text-red-400">
          Something went wrong: {phase.message}
        </p>
      )}
    </section>
  );
}
