// Background options for the recorder, and the built-in backgrounds.
// The built-ins are painted in code, so they cost no download and stay sharp
// at any size.

export type BackgroundChoice =
  | { kind: "none" }
  | { kind: "blur"; strength: "light" | "strong" }
  | { kind: "builtin"; id: BuiltinId }
  | { kind: "custom" };

export type BuiltinId = "stage" | "sunset" | "studio" | "bokeh" | "ocean";

export const BUILTINS: { id: BuiltinId; label: string }[] = [
  { id: "stage", label: "Stage" },
  { id: "studio", label: "Studio" },
  { id: "bokeh", label: "Lights" },
  { id: "sunset", label: "Sunset" },
  { id: "ocean", label: "Ocean" },
];

const CHOICE_KEY = "song-recorder:background";
const CUSTOM_KEY = "song-recorder:background-image";

export function loadChoice(): BackgroundChoice {
  try {
    const c = JSON.parse(localStorage.getItem(CHOICE_KEY) || "null");
    if (c && typeof c.kind === "string") return c;
  } catch {}
  return { kind: "none" };
}

export function saveChoice(c: BackgroundChoice) {
  try {
    localStorage.setItem(CHOICE_KEY, JSON.stringify(c));
  } catch {}
}

export function loadCustomImage(): string | null {
  try {
    return localStorage.getItem(CUSTOM_KEY);
  } catch {
    return null;
  }
}

// Shrink the picture so it fits in the browser's storage, then keep it.
export async function saveCustomImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const max = 1600;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext("2d")!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close?.();
  const url = c.toDataURL("image/jpeg", 0.85);
  try {
    localStorage.setItem(CUSTOM_KEY, url);
  } catch {
    // Too big to remember; it still works for this session.
  }
  return url;
}

// Deterministic random numbers so the "Lights" pattern looks the same each time.
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

export function paintBuiltin(id: BuiltinId, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const m = Math.max(w, h);

  if (id === "stage") {
    g.fillStyle = "#0b0614";
    g.fillRect(0, 0, w, h);
    // Coloured spotlights from the top.
    const beams: [number, string][] = [
      [0.15, "rgba(236,72,153,0.55)"],
      [0.5, "rgba(168,85,247,0.5)"],
      [0.85, "rgba(59,130,246,0.5)"],
    ];
    g.globalCompositeOperation = "lighter";
    for (const [x, color] of beams) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(w * x - m * 0.02, 0);
      g.lineTo(w * x + m * 0.02, 0);
      g.lineTo(w * x + m * 0.32, h);
      g.lineTo(w * x - m * 0.32, h);
      g.closePath();
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
    const floor = g.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, m * 0.6);
    floor.addColorStop(0, "rgba(255,200,255,0.25)");
    floor.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = floor;
    g.fillRect(0, 0, w, h);
  } else if (id === "studio") {
    const grad = g.createRadialGradient(w / 2, h * 0.4, 0, w / 2, h * 0.4, m * 0.75);
    grad.addColorStop(0, "#4a4a52");
    grad.addColorStop(0.6, "#1f1f24");
    grad.addColorStop(1, "#0a0a0c");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    // Soft vertical acoustic panels.
    g.globalAlpha = 0.07;
    g.fillStyle = "#000";
    const panel = m / 14;
    for (let x = 0; x < w; x += panel * 2) g.fillRect(x, 0, panel, h);
    g.globalAlpha = 1;
  } else if (id === "bokeh") {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#0b1026");
    grad.addColorStop(1, "#1b0b26");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    const rnd = seeded(7);
    const colors = ["255,214,120", "255,140,180", "140,200,255", "255,255,255"];
    g.globalCompositeOperation = "lighter";
    for (let i = 0; i < 70; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = (0.015 + rnd() * 0.05) * m;
      const col = colors[Math.floor(rnd() * colors.length)];
      const a = 0.12 + rnd() * 0.3;
      const dot = g.createRadialGradient(x, y, 0, x, y, r);
      dot.addColorStop(0, `rgba(${col},${a})`);
      dot.addColorStop(0.8, `rgba(${col},${a * 0.8})`);
      dot.addColorStop(1, `rgba(${col},0)`);
      g.fillStyle = dot;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
  } else if (id === "sunset") {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#2b1055");
    sky.addColorStop(0.45, "#d53369");
    sky.addColorStop(0.7, "#f8a65d");
    sky.addColorStop(1, "#fcd581");
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    const sunY = h * 0.68;
    const sun = g.createRadialGradient(w / 2, sunY, 0, w / 2, sunY, m * 0.35);
    sun.addColorStop(0, "rgba(255,240,200,0.95)");
    sun.addColorStop(0.25, "rgba(255,200,120,0.6)");
    sun.addColorStop(1, "rgba(255,160,90,0)");
    g.fillStyle = sun;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "rgba(40,10,40,0.55)";
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(0, h * 0.82);
    g.quadraticCurveTo(w * 0.3, h * 0.74, w * 0.55, h * 0.84);
    g.quadraticCurveTo(w * 0.8, h * 0.78, w, h * 0.83);
    g.lineTo(w, h);
    g.fill();
  } else if (id === "ocean") {
    const sea = g.createLinearGradient(0, 0, 0, h);
    sea.addColorStop(0, "#a8e6ff");
    sea.addColorStop(0.5, "#3aa0d8");
    sea.addColorStop(1, "#0a3d62");
    g.fillStyle = sea;
    g.fillRect(0, 0, w, h);
    const rnd = seeded(3);
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = Math.max(2, m / 400);
    for (let i = 0; i < 26; i++) {
      const y = h * (0.5 + rnd() * 0.5);
      const x = rnd() * w;
      const len = (0.05 + rnd() * 0.15) * m;
      g.beginPath();
      g.moveTo(x - len / 2, y);
      g.quadraticCurveTo(x, y - len * 0.05, x + len / 2, y);
      g.stroke();
    }
  }
  return c;
}

// Draw `img` to fill w×h without stretching (like CSS object-fit: cover).
export function drawCover(
  g: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  w: number,
  h: number,
) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  g.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}
