import { getReplicate, pickInstrumental } from "@/lib/replicate";

// Polls a vocal-removal job. When it is done, the phone downloads the karaoke
// track from /api/separate/[id]/track and keeps it on the device.
export async function GET(_request: Request, ctx: RouteContext<"/api/separate/[id]">) {
  const { id } = await ctx.params;
  try {
    const p = await getReplicate().predictions.get(id);
    if (p.status === "failed" || p.status === "canceled") {
      return Response.json({ status: "failed", error: String(p.error ?? p.status) });
    }
    if (p.status !== "succeeded") return Response.json({ status: "working" });
    if (!pickInstrumental(p.output)) {
      return Response.json({
        status: "failed",
        error: `Unexpected output: ${JSON.stringify(p.output)}`,
      });
    }
    return Response.json({ status: "done" });
  } catch (error) {
    return Response.json({ status: "failed", error: (error as Error).message }, { status: 500 });
  }
}
