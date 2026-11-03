// Searches LRCLIB (free timed-lyrics library) and returns songs that have
// line timings. Done on the server so we can identify ourselves properly.
type LrclibRecord = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string;
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
};

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return Response.json([]);
  const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, {
    headers: { "User-Agent": "SongRecorder/0.1 (https://github.com/vijaysrj/song-recorder)" },
  });
  if (!res.ok) return Response.json({ error: "Lyrics search failed" }, { status: 502 });
  const records = (await res.json()) as LrclibRecord[];
  return Response.json(
    records
      .filter((r) => !r.instrumental && r.syncedLyrics)
      .map((r) => ({
        id: r.id,
        title: r.trackName,
        artist: r.artistName,
        album: r.albumName,
        duration: r.duration,
        plainLyrics: r.plainLyrics ?? "",
        syncedLyrics: r.syncedLyrics,
      })),
  );
}
