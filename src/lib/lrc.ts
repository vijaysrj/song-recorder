import type { TimedLine } from "./library";

// Parses LRC text ("[01:23.45] line") into sorted timed lines.
export function parseLrc(lrc: string): TimedLine[] {
  const out: TimedLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, "").trim();
    for (const m of stamps) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text });
  }
  return out.sort((a, b) => a.t - b.t);
}

// Index of the line being sung at `time`, or -1 before the first line.
export function currentLine(lines: TimedLine[], time: number) {
  let i = -1;
  for (let k = 0; k < lines.length && lines[k].t <= time; k++) i = k;
  return i;
}

export const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
