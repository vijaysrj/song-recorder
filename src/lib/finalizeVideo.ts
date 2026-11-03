// Turn the browser's raw recording into a standard MP4 that Instagram,
// WhatsApp and YouTube accept: H.264 video + AAC audio, with the index at the
// start of the file and a proper duration.
//
// Browsers record in a streaming-friendly layout (and Chrome sometimes in
// WebM), which upload sites can reject or show with no length. When the codecs
// are already H.264/AAC this only rewrites the container (fast, no quality
// loss); otherwise it re-encodes on the device.

export async function toShareableMp4(
  recording: Blob,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const mb = await import("mediabunny");
  const input = new mb.Input({
    source: new mb.BlobSource(recording),
    formats: mb.ALL_FORMATS,
  });
  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new mb.BufferTarget(),
  });
  // Asking for a bitrate forces a re-encode, so only do that when the codec
  // has to change anyway.
  const v = await input.getPrimaryVideoTrack();
  const a = await input.getPrimaryAudioTrack();
  const conversion = await mb.Conversion.init({
    input,
    output,
    video:
      v?.codec === "avc"
        ? { codec: "avc" }
        : { codec: "avc", bitrate: 8_000_000 },
    audio:
      a?.codec === "aac"
        ? { codec: "aac" }
        : { codec: "aac", bitrate: 256_000 },
  });
  if (!conversion.isValid) {
    throw new Error(
      conversion.discardedTracks.map((t) => t.reason).join(", ") ||
        "unsupported recording",
    );
  }
  conversion.onProgress = (p) => onProgress?.(p);
  await conversion.execute();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("conversion produced no file");
  return new Blob([buffer], { type: "video/mp4" });
}
