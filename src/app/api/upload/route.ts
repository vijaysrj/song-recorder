import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

// Issues short-lived tokens so the phone can upload songs straight to Blob
// storage (bypasses the server's request size limit).
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["audio/*", "video/mp4"],
        maximumSizeInBytes: 60 * 1024 * 1024,
        addRandomSuffix: true,
      }),
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
