// The picture that gets recorded: always a 1080×1920 (9:16) frame, the
// format Instagram Reels, Shorts and WhatsApp Status use, so what you see in
// the preview is exactly what ends up in the video.
//
// Each camera frame:
//   1. The camera picture is cropped to 9:16 (centred) into the frame.
//   2. With a background effect, a small copy goes to MediaPipe's selfie
//      segmenter, which says how likely each pixel is to be you. That mask is
//      softened (edges and frame-to-frame flicker) and scaled up.
//   3. The background (blurred camera, a built-in scene or your photo) is
//      drawn, then you are drawn on top through the mask at full resolution.
// Everything runs on the device.

import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { type BackgroundChoice, drawCover, paintBuiltin } from "./backgrounds";

export const OUT_W = 1080;
export const OUT_H = 1920;
const SEG_W = 256;
const SEG_H = Math.round((SEG_W * OUT_H) / OUT_W);

let segmenterPromise: Promise<ImageSegmenter> | null = null;

// Load once and reuse; the files are served by this app (see
// scripts/copy-mediapipe.mjs), so nothing comes from other sites.
function loadSegmenter() {
  segmenterPromise ??= (async () => {
    const { FilesetResolver, ImageSegmenter } =
      await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe");
    // CPU on purpose: the model is tiny (256 px wide input, a few ms per
    // frame), and reading GPU masks back fails on some phones (iPhones lack
    // the float-texture support it needs).
    return ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "/models/selfie_segmenter.tflite",
        delegate: "CPU",
      },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  })();
  segmenterPromise.catch(() => (segmenterPromise = null));
  return segmenterPromise;
}

function canvas(w = 1, h = 1) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement) {
  return c.getContext("2d")!;
}

export type FxStatus =
  | { kind: "plain" } // no effect chosen
  | { kind: "loading" } // effect chosen, tools still downloading
  | { kind: "on" } // effect running
  | { kind: "error"; message: string };

export class BackgroundFx {
  private seg: ImageSegmenter | null = null;
  private segLoading = false;
  private video: HTMLVideoElement | null = null;
  private out: HTMLCanvasElement | null = null;
  private choice: BackgroundChoice = { kind: "none" };
  private customUrl: string | null = null;
  private customImg: HTMLImageElement | null = null;
  private scene: HTMLCanvasElement | null = null;
  private sceneKey = "";
  private running = false;
  private lastTs = 0;
  private frameHandle = 0;
  private frameNo = 0;
  private lastRenderAt = 0;
  private failures = 0;
  private status: FxStatus = { kind: "plain" };

  /** 1 fills the 9:16 frame with the camera; smaller shows more of the room. */
  zoom = 1;

  /** Average time to process one frame / to segment one frame, in ms. */
  frameMs = 0;
  segMs = 0;
  /** Frames drawn since start(); stays 0 if the camera never delivers a picture. */
  framesRendered = 0;
  /** Told whenever the effect's state changes (loading, on, error…). */
  onStatus?: (s: FxStatus) => void;

  private frame = canvas(OUT_W, OUT_H); // camera, cropped to 9:16
  private small = canvas(SEG_W, SEG_H);
  private maskC = canvas(SEG_W, SEG_H);
  private maskData: ImageData | null = null;
  private prev: Float32Array | null = null;
  private person = canvas(OUT_W, OUT_H);
  private blurA = canvas();
  private blurB = canvas();
  private fill = canvas(27, 48);

  setChoice(choice: BackgroundChoice, customUrl: string | null) {
    this.choice = choice;
    this.failures = 0;
    if (customUrl !== this.customUrl) {
      this.customUrl = customUrl;
      this.customImg = null;
      this.sceneKey = "";
      if (customUrl) {
        const img = new Image();
        img.onload = () => {
          this.customImg = img;
          this.sceneKey = "";
        };
        img.src = customUrl;
      }
    }
    if (choice.kind === "none") this.setStatus({ kind: "plain" });
    else if (this.seg) this.setStatus({ kind: "on" });
    else this.loadSeg();
  }

  private loadSeg() {
    this.setStatus({ kind: "loading" });
    if (this.segLoading) return;
    this.segLoading = true;
    loadSegmenter()
      .then((seg) => {
        this.seg = seg;
        if (this.choice.kind !== "none") this.setStatus({ kind: "on" });
      })
      .catch((e) =>
        this.setStatus({
          kind: "error",
          message: `Couldn't load backgrounds (${(e as Error).message})`,
        }),
      )
      .finally(() => (this.segLoading = false));
  }

  private setStatus(s: FxStatus) {
    this.status = s;
    this.onStatus?.(s);
  }

  start(video: HTMLVideoElement, out: HTMLCanvasElement) {
    this.stop();
    this.video = video;
    this.out = out;
    out.width = OUT_W;
    out.height = OUT_H;
    this.running = true;
    this.prev = null;
    this.lastRenderAt = 0;
    this.framesRendered = 0;
    this.failures = 0;
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  // requestAnimationFrame behaves the same on every browser.
  private schedule() {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(() => this.tick());
  }

  private tick() {
    // Up to ~30 frames a second (screens refresh faster than cameras).
    const now = performance.now();
    if (now - this.lastRenderAt >= 30) {
      this.lastRenderAt = now;
      try {
        const drawn = this.render();
        this.frameMs = 0.9 * this.frameMs + 0.1 * (performance.now() - now);
        if (drawn) this.framesRendered++;
        this.failures = 0;
      } catch (e) {
        console.warn("video frame failed", e);
        // Don't fail silently: after repeated errors, fall back to the plain
        // camera and tell the screen why.
        if (++this.failures === 10 && this.choice.kind !== "none") {
          this.setStatus({
            kind: "error",
            message: `Background stopped working (${(e as Error)?.message ?? e})`,
          });
        }
      }
    }
    this.schedule();
  }

  private render(): boolean {
    const v = this.video;
    const out = this.out;
    if (!v || !out) return false;
    const W = v.videoWidth;
    const H = v.videoHeight;
    if (!W || !H || v.readyState < 2) return false;

    // 1. Fit the camera into the 9:16 frame. At zoom 1 it fills the frame
    //    (cropping the sides); below 1 you're shown smaller, with a soft
    //    blurred copy of the camera filling any gap.
    const cover = Math.max(OUT_W / W, OUT_H / H);
    const scale = cover * this.zoom;
    const fg = ctx2d(this.frame);
    fg.imageSmoothingEnabled = true;
    fg.imageSmoothingQuality = "high";
    const dw = W * scale;
    const dh = H * scale;
    if (dw < OUT_W || dh < OUT_H) {
      const f = this.fill;
      const fc = ctx2d(f);
      const cw = OUT_W / cover;
      const ch = OUT_H / cover;
      fc.drawImage(
        v,
        (W - cw) / 2,
        (H - ch) / 2,
        cw,
        ch,
        0,
        0,
        f.width,
        f.height,
      );
      fg.drawImage(f, 0, 0, OUT_W, OUT_H);
      fg.fillStyle = "rgba(0,0,0,0.25)";
      fg.fillRect(0, 0, OUT_W, OUT_H);
    }
    // Centred sideways; vertically a little above centre, where faces are.
    const dx = (OUT_W - dw) / 2;
    const dy = (OUT_H - dh) * 0.45;
    if (dw < OUT_W || dh < OUT_H) {
      // Smaller than the frame: a rounded, softly shadowed card, so it looks
      // deliberate rather than letterboxed.
      fg.save();
      fg.shadowColor = "rgba(0,0,0,0.45)";
      fg.shadowBlur = 40;
      fg.beginPath();
      fg.roundRect(dx, dy, dw, dh, 36);
      fg.fillStyle = "#000";
      fg.fill();
      fg.shadowColor = "transparent";
      fg.clip();
      fg.drawImage(v, dx, dy, dw, dh);
      fg.restore();
    } else {
      fg.drawImage(v, dx, dy, dw, dh);
    }

    const og = ctx2d(out);
    const effectOn =
      this.choice.kind !== "none" && this.seg && this.status.kind !== "error";
    if (!effectOn) {
      og.drawImage(this.frame, 0, 0);
      return true;
    }

    // 2. Find you. On slower phones, every other frame, reusing the outline
    //    in between so the picture itself stays smooth.
    this.frameNo++;
    const skipSeg = this.segMs > 30 && this.frameNo % 2 === 1 && this.prev;
    if (!skipSeg) this.segment();

    // 3. Background.
    og.imageSmoothingEnabled = true;
    og.imageSmoothingQuality = "high";
    if (this.choice.kind === "blur")
      this.drawBlur(og, this.choice.strength === "strong" ? 48 : 28);
    else og.drawImage(this.sceneFor(), 0, 0);

    // 4. You, through the mask, at full resolution.
    const pg = ctx2d(this.person);
    pg.globalCompositeOperation = "copy";
    pg.imageSmoothingEnabled = true;
    pg.imageSmoothingQuality = "high";
    pg.drawImage(this.maskC, 0, 0, OUT_W, OUT_H);
    pg.globalCompositeOperation = "source-in";
    pg.drawImage(this.frame, 0, 0);
    pg.globalCompositeOperation = "source-over";
    og.drawImage(this.person, 0, 0);
    return true;
  }

  private segment() {
    ctx2d(this.small).drawImage(this.frame, 0, 0, SEG_W, SEG_H);
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    const t0 = performance.now();
    const result = this.seg!.segmentForVideo(this.small, ts);
    const conf = result.confidenceMasks?.[0]?.getAsFloat32Array();
    result.close();
    this.segMs = 0.9 * this.segMs + 0.1 * (performance.now() - t0);
    if (!conf) return;

    // Sharpen the in/out decision a little, then blend with the previous
    // frame so edges don't shimmer.
    const mg = ctx2d(this.maskC);
    this.maskData ??= mg.createImageData(SEG_W, SEG_H);
    const px = this.maskData.data;
    const prev = (this.prev ??= new Float32Array(conf.length));
    for (let i = 0; i < conf.length; i++) {
      let p = (conf[i] - 0.3) / 0.45;
      p = p < 0 ? 0 : p > 1 ? 1 : p * p * (3 - 2 * p);
      p = 0.65 * p + 0.35 * prev[i];
      prev[i] = p;
      px[i * 4 + 3] = p * 255;
    }
    mg.putImageData(this.maskData, 0, 0);
  }

  // Blur by shrinking and enlarging in steps: works on every browser
  // (canvas blur filters are missing on older iPhones) and is fast.
  private drawBlur(g: CanvasRenderingContext2D, factor: number) {
    const aw = Math.round(OUT_W / 4);
    const ah = Math.round(OUT_H / 4);
    const bw = Math.max(1, Math.round(OUT_W / factor));
    const bh = Math.max(1, Math.round(OUT_H / factor));
    if (this.blurA.width !== aw) {
      this.blurA.width = aw;
      this.blurA.height = ah;
    }
    if (this.blurB.width !== bw) {
      this.blurB.width = bw;
      this.blurB.height = bh;
    }
    const a = ctx2d(this.blurA);
    const b = ctx2d(this.blurB);
    a.imageSmoothingQuality = b.imageSmoothingQuality = "high";
    a.drawImage(this.frame, 0, 0, aw, ah);
    b.drawImage(this.blurA, 0, 0, bw, bh);
    a.drawImage(this.blurB, 0, 0, aw, ah);
    g.drawImage(this.blurA, 0, 0, OUT_W, OUT_H);
  }

  private sceneFor() {
    const c = this.choice;
    const key = `${c.kind}:${c.kind === "builtin" ? c.id : ""}:${this.customImg ? 1 : 0}`;
    if (this.scene && this.sceneKey === key) return this.scene;
    let scene: HTMLCanvasElement;
    if (c.kind === "builtin") {
      scene = paintBuiltin(c.id, OUT_W, OUT_H);
    } else {
      scene = canvas(OUT_W, OUT_H);
      const g = ctx2d(scene);
      if (this.customImg) drawCover(g, this.customImg, OUT_W, OUT_H);
      else {
        g.fillStyle = "#111";
        g.fillRect(0, 0, OUT_W, OUT_H);
      }
    }
    this.scene = scene;
    this.sceneKey = key;
    return scene;
  }
}
