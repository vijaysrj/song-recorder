"use client";

import { useEffect, useState } from "react";
import type { Song } from "./library";

// Karaoke tracks live on this device (IndexedDB), not in cloud storage.
// Songs added before this change still point at a cloud URL; those keep
// working from that URL and are copied onto the device the first time they
// load.

const DB = "song-recorder";
const STORE = "tracks";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveTrack(id: string, audio: Blob) {
  // Ask the browser not to clear our storage when space runs low.
  navigator.storage?.persist?.().catch(() => {});
  await run("readwrite", (s) => s.put(audio, id));
}

export function getTrack(id: string): Promise<Blob | undefined> {
  return run<Blob | undefined>("readonly", (s) => s.get(id)).catch(
    () => undefined,
  );
}

export function deleteTrack(id: string) {
  return run("readwrite", (s) => s.delete(id)).catch(() => {});
}

export type TrackState = { url: string; type: string } | null;

// A playable URL for the song's karaoke track (null while loading).
export function useTrack(song: Song): TrackState {
  const [state, setState] = useState<TrackState>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      const local = await getTrack(song.id);
      if (cancelled) return;
      if (local) {
        objectUrl = URL.createObjectURL(local);
        setState({ url: objectUrl, type: local.type });
        return;
      }
      if (!song.trackUrl) {
        setState({ url: "", type: "" });
        return;
      }
      setState({ url: song.trackUrl, type: "audio/mpeg" });
      // Older song: keep a copy on the device so it no longer needs the cloud.
      try {
        const res = await fetch(song.trackUrl);
        if (res.ok) await saveTrack(song.id, await res.blob());
      } catch {}
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [song.id, song.trackUrl]);
  return state;
}

export function extFor(type: string) {
  if (type.includes("mp4") || type.includes("aac") || type.includes("m4a"))
    return "m4a";
  if (type.includes("ogg") || type.includes("opus")) return "ogg";
  if (type.includes("wav")) return "wav";
  if (type.includes("flac")) return "flac";
  return "mp3";
}
