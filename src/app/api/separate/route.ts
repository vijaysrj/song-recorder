import { getDemucsVersion, getReplicate } from "@/lib/replicate";

// Starts vocal removal. The phone sends the song itself (at most ~4 MB); it
// goes straight to Replicate's file storage, so no storage of our own is
// needed. Returns a job id to poll.
export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "audio/mpeg";
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength)
    return Response.json({ error: "Missing song" }, { status: 400 });
  try {
    const replicate = getReplicate();
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "mp3";
    const file = await replicate.files.create(
      new File([bytes], `song.${ext}`, { type }),
    );
    const version = await getDemucsVersion(replicate);
    const prediction = await replicate.predictions.create({
      version,
      input: { audio: file.urls.get, isolate_stem: "vocals", format: "mp3" },
    });
    return Response.json({ id: prediction.id });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
