import { getDemucsVersion, getReplicate } from "@/lib/replicate";

// Starts vocal removal for an uploaded song. Returns a job id to poll.
export async function POST(request: Request) {
  const { url } = (await request.json()) as { url?: string };
  if (!url) return Response.json({ error: "Missing song url" }, { status: 400 });
  try {
    const replicate = getReplicate();
    const version = await getDemucsVersion(replicate);
    const prediction = await replicate.predictions.create({
      version,
      input: { audio: url, stem: "vocals", output_format: "mp3" },
    });
    return Response.json({ id: prediction.id });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
