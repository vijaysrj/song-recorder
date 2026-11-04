// Cut a finished video down to the parts you keep: trimmed ends and any
// sections removed from the middle. The kept parts are joined back to back
// and re-encoded on the device into a standard MP4.

export type Range = { start: number; end: number };

export async function videoDuration(blob: Blob): Promise<number> {
  const mb = await import("mediabunny");
  const input = new mb.Input({
    source: new mb.BlobSource(blob),
    formats: mb.ALL_FORMATS,
  });
  return input.computeDuration();
}

/** The parts to keep: [trimStart, trimEnd] minus every cut, in order. */
export function keptRanges(trim: Range, cuts: Range[]): Range[] {
  let parts: Range[] = [trim];
  for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
    parts = parts.flatMap((p) => {
      if (c.end <= p.start || c.start >= p.end) return [p];
      const out: Range[] = [];
      if (c.start > p.start) out.push({ start: p.start, end: c.start });
      if (c.end < p.end) out.push({ start: c.end, end: p.end });
      return out;
    });
  }
  return parts.filter((p) => p.end - p.start > 0.05);
}

/** Parts where the camera is swapped for the music animation. */
export type HideVideo = {
  ranges: Range[];
  levels: Float32Array | null;
  title: string;
};

export const inRanges = (t: number, ranges: Range[]) =>
  ranges.some((r) => t >= r.start && t < r.end);

export async function exportEdit(
  blob: Blob,
  keep: Range[],
  onProgress?: (fraction: number) => void,
  hide?: HideVideo,
): Promise<Blob> {
  const mb = await import("mediabunny");
  const input = new mb.Input({
    source: new mb.BlobSource(blob),
    formats: mb.ALL_FORMATS,
  });
  const vt = await input.getPrimaryVideoTrack();
  const at = await input.getPrimaryAudioTrack();
  if (!vt) throw new Error("no video in the recording");

  const width = vt.displayWidth;
  const height = vt.displayHeight;
  // H.264 + AAC where the browser can make them (what Instagram wants).
  const vcodec = await mb.getFirstEncodableVideoCodec(["avc", "vp9", "av1"], {
    width,
    height,
  });
  const acodec = at
    ? await mb.getFirstEncodableAudioCodec(["aac", "opus"])
    : null;
  if (!vcodec) throw new Error("this browser can't save edited video");
  if (at && !acodec)
    throw new Error("this browser can't save edited sound; please update it");

  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new mb.BufferTarget(),
  });
  const vsrc = new mb.VideoSampleSource({ codec: vcodec, bitrate: 8_000_000 });
  output.addVideoTrack(vsrc, { frameRate: 30 });
  const asrc = acodec
    ? new mb.AudioSampleSource({ codec: acodec, bitrate: 256_000 })
    : null;
  if (asrc) output.addAudioTrack(asrc);
  await output.start();

  const total = keep.reduce((s, r) => s + (r.end - r.start), 0) || 1;
  const rotation = await vt.getRotation();
  const vsink = new mb.VideoSampleSink(vt);
  // Canvas for animation frames, the same size as the picture.
  let anim: CanvasRenderingContext2D | null = null;
  const animFrame = async (orig: number, t: number, duration: number) => {
    const { drawInterlude } = await import("./interlude");
    if (!anim) {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      anim = c.getContext("2d");
      if (!anim) throw new Error("couldn't draw the animation");
    }
    drawInterlude(anim, width, height, orig, hide!.levels, hide!.title);
    return new mb.VideoSample(anim.canvas, { timestamp: t, duration });
  };
  const asink = at && asrc ? new mb.AudioSampleSink(at) : null;

  // Video and audio run side by side (the file needs them interleaved),
  // part by part, each part shifted to follow the previous one.
  let vDone = 0;
  let aDone = 0;
  const report = () =>
    onProgress?.(
      Math.min(0.99, asink ? (vDone + aDone) / (2 * total) : vDone / total),
    );

  const doVideo = async () => {
    let offset = 0;
    for (const r of keep) {
      for await (const s of vsink.samples(r.start, r.end)) {
        if (s.timestamp >= r.start - 1e-3 && s.timestamp < r.end) {
          const t = s.timestamp - r.start + offset;
          if (hide?.ranges.length && inRanges(s.timestamp, hide.ranges)) {
            const a = await animFrame(s.timestamp, t, s.duration);
            await vsrc.add(a);
            a.close();
          } else {
            s.setTimestamp(t);
            if (rotation) s.setRotation?.(rotation);
            await vsrc.add(s);
          }
          vDone = t;
          report();
        }
        s.close();
      }
      offset += r.end - r.start;
    }
    vsrc.close();
  };

  const doAudio = async () => {
    if (!asink || !asrc) return;
    let offset = 0;
    for (const r of keep) {
      for await (const s of asink.samples(r.start, r.end)) {
        const t = s.timestamp - r.start + offset;
        if (s.timestamp >= r.start - 0.05 && t >= 0 && s.timestamp < r.end) {
          s.setTimestamp(t);
          await asrc.add(s);
          aDone = t;
          report();
        }
        s.close();
      }
      offset += r.end - r.start;
    }
    asrc.close();
  };

  await Promise.all([doVideo(), doAudio()]);

  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("saving produced no file");
  onProgress?.(1);
  return new Blob([buffer], { type: "video/mp4" });
}
