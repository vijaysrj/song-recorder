import { put } from "@vercel/blob";
import { getReplicate, pickInstrumental } from "@/lib/replicate";

// Polls a vocal-removal job. When it finishes, copies the karaoke track into
// Blob storage, because Replicate's own result links expire after an hour.
export async function GET(_request: Request, ctx: RouteContext<"/api/separate/[id]">) {
  const { id } = await ctx.params;
  try {
    const replicate = getReplicate();
    const p = await replicate.predictions.get(id);
    if (p.status === "failed" || p.status === "canceled") {
      return Response.json({ status: "failed", error: String(p.error ?? p.status) });
    }
    if (p.status !== "succeeded") return Response.json({ status: "working" });

    const source = pickInstrumental(p.output);
    if (!source) {
      return Response.json({
        status: "failed",
        error: `Unexpected output: ${JSON.stringify(p.output)}`,
      });
    }
    const audio = await fetch(source);
    if (!audio.ok || !audio.body) throw new Error("Could not download result");
    const blob = await put(`instrumentals/${id}.mp3`, audio.body, {
      access: "public",
      contentType: "audio/mpeg",
      allowOverwrite: true,
    });
    return Response.json({ status: "done", url: blob.url });
  } catch (error) {
    return Response.json({ status: "failed", error: (error as Error).message }, { status: 500 });
  }
}
