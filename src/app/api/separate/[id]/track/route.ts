import { getReplicate, pickInstrumental } from "@/lib/replicate";

// Streams the finished karaoke track to the phone. Replicate's result links
// expire after an hour, which is fine: the phone saves the track right away.
export async function GET(_request: Request, ctx: RouteContext<"/api/separate/[id]/track">) {
  const { id } = await ctx.params;
  try {
    const p = await getReplicate().predictions.get(id);
    const source = p.status === "succeeded" ? pickInstrumental(p.output) : undefined;
    if (!source) return Response.json({ error: "Track not ready" }, { status: 404 });
    const audio = await fetch(source);
    if (!audio.ok || !audio.body) throw new Error("Could not download the track");
    return new Response(audio.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}
