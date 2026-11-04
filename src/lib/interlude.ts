// What the video shows in the parts where your camera is hidden (for
// example during an interlude): an animation that moves with the music.

export const LEVEL_RATE = 30; // loudness values per second

/** How loud the sound is, LEVEL_RATE times a second, from 0 to 1. */
export async function audioLevels(blob: Blob): Promise<Float32Array> {
  const mb = await import("mediabunny");
  const input = new mb.Input({
    source: new mb.BlobSource(blob),
    formats: mb.ALL_FORMATS,
  });
  const at = await input.getPrimaryAudioTrack();
  const duration = await input.computeDuration();
  const out = new Float32Array(Math.ceil(duration * LEVEL_RATE) + 1);
  if (!at) return out;
  const sum = new Float64Array(out.length);
  const count = new Uint32Array(out.length);
  const sink = new mb.AudioSampleSink(at);
  for await (const s of sink.samples()) {
    const n = s.numberOfFrames;
    const buf = new Float32Array(n);
    s.copyTo(buf, { planeIndex: 0, format: "f32-planar" });
    for (let i = 0; i < n; i++) {
      const k = Math.floor((s.timestamp + i / s.sampleRate) * LEVEL_RATE);
      if (k >= 0 && k < out.length) {
        sum[k] += buf[i] * buf[i];
        count[k]++;
      }
    }
    s.close();
  }
  let peak = 1e-6;
  for (let k = 0; k < out.length; k++) {
    out[k] = count[k] ? Math.sqrt(sum[k] / count[k]) : 0;
    peak = Math.max(peak, out[k]);
  }
  // Scale so the loudest part reaches 1, and smooth so it doesn't flicker.
  let prev = 0;
  for (let k = 0; k < out.length; k++) {
    const v = Math.min(1, out[k] / (peak * 0.8));
    prev = v > prev ? v : prev * 0.85 + v * 0.15;
    out[k] = prev;
  }
  return out;
}

export function levelAt(levels: Float32Array | null, t: number): number {
  if (!levels?.length) return 0.4 + 0.2 * Math.sin(t * 4);
  return levels[
    Math.max(0, Math.min(levels.length - 1, Math.round(t * LEVEL_RATE)))
  ];
}

/** Draws one frame of the animation for time t (seconds into the video). */
export function drawInterlude(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  levels: Float32Array | null,
  title: string,
) {
  const level = levelAt(levels, t);
  const u = Math.min(w, h);

  // Slowly drifting deep pink → purple background.
  const hue = 300 + 25 * Math.sin(t * 0.25);
  const g = ctx.createLinearGradient(0, 0, w * 0.3, h);
  g.addColorStop(0, `hsl(${hue} 70% 14%)`);
  g.addColorStop(1, `hsl(${hue - 50} 75% 7%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h * 0.5;

  // A glow that swells with the music.
  const r0 = u * (0.22 + 0.12 * level);
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0 * 2.2);
  glow.addColorStop(0, `hsla(${hue + 20} 90% 65% / ${0.35 + 0.35 * level})`);
  glow.addColorStop(1, "hsla(0 0% 0% / 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  // Ring of bars around the centre, each following recent loudness.
  const bars = 64;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2, u * 0.012);
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2 - Math.PI / 2;
    const lag = (Math.abs(i - bars / 2) / bars) * 0.6;
    const l = levelAt(levels, t - lag);
    const wobble = 0.5 + 0.5 * Math.sin(i * 1.7 + t * 3);
    const len = u * (0.03 + 0.2 * l * (0.6 + 0.4 * wobble));
    const r = u * 0.2;
    ctx.strokeStyle = `hsla(${hue + (i / bars) * 80} 95% ${65 + 15 * l}% / 0.9)`;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len));
    ctx.stroke();
  }

  // Musical note in the middle, gently bouncing.
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(u * (0.14 + 0.03 * level))}px sans-serif`;
  ctx.fillText("♪", cx, cy + Math.sin(t * 2) * u * 0.01);

  if (title) {
    ctx.font = `600 ${Math.round(u * 0.05)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(title, cx, cy + u * 0.48, w * 0.85);
  }
}
