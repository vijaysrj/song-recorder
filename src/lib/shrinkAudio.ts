// Vercel only accepts requests up to 4.5 MB, so a song is sent to the
// vocal-removal service at most ~4 MB. Bigger files are re-encoded on the
// phone at the highest bitrate that fits (128–192 kbps for a normal song).
export const MAX_UPLOAD = 4_000_000;

export async function shrinkForUpload(
  file: File,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  if (file.size <= MAX_UPLOAD) return new Blob([file], { type: contentType });

  const mb = await import("mediabunny");
  const input = new mb.Input({
    source: new mb.BlobSource(file),
    formats: mb.ALL_FORMATS,
  });
  const seconds = await input.computeDuration();
  if (!seconds) throw new Error("Could not read this song file");
  // Leave room for the container's own bytes.
  const bitrate = Math.min(
    192_000,
    Math.floor((MAX_UPLOAD * 8 * 0.94) / seconds),
  );
  if (bitrate < 64_000)
    throw new Error("This song is too long (over about 8 minutes)");

  const useAac = await mb.canEncodeAudio("aac");
  const output = new mb.Output({
    format: useAac ? new mb.Mp4OutputFormat() : new mb.OggOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const conversion = await mb.Conversion.init({
    input,
    output,
    video: { discard: true },
    audio: {
      codec: useAac ? "aac" : "opus",
      bitrate,
      numberOfChannels: 2,
      sampleRate: useAac ? 44_100 : 48_000,
    },
  });
  if (!conversion.isValid)
    throw new Error("This phone could not convert the song file");
  conversion.onProgress = (p) => onProgress?.(p);
  await conversion.execute();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("Could not convert the song file");
  if (buffer.byteLength > 4_400_000)
    throw new Error("The song file is still too big after converting");
  return new Blob([buffer], { type: useAac ? "audio/mp4" : "audio/ogg" });
}
