export type Song = {
  id: string;
  title: string;
  trackUrl: string; // karaoke (no vocals) track
  lyrics: string;
  // Optional start time (seconds into the track) for each lyric line.
  timed?: TimedLine[];
  createdAt: number;
};

export type TimedLine = { t: number; text: string };

const KEY = "song-recorder:library";

export function loadSongs(): Song[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Song[];
  } catch {
    return [];
  }
}

export function saveSongs(songs: Song[]) {
  localStorage.setItem(KEY, JSON.stringify(songs));
}

// Tiny external store so React can read the library without effects.
const listeners = new Set<() => void>();
let snapshot: Song[] | null = null;
const EMPTY: Song[] = [];

export const songStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  get(): Song[] {
    if (snapshot === null) snapshot = loadSongs();
    return snapshot;
  },
  getServer(): Song[] {
    return EMPTY;
  },
  set(next: Song[]) {
    snapshot = next;
    saveSongs(next);
    listeners.forEach((fn) => fn());
  },
};
