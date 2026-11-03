// Live background blur / replacement, run entirely on the device.
//
// Each camera frame:
//   1. A small copy goes to MediaPipe's selfie segmenter, which returns how
//      likely each pixel is to be you.
//   2. That mask is softened (edges and frame-to-frame flicker) and scaled up.
//   3. The background (blurred camera, a built-in scene or your photo) is
//      drawn, then you are drawn on top through the mask at full resolution.
// The result is drawn to a canvas, which the recorder records instead of the
// raw camera.

import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { type BackgroundChoice, drawCover, paintBuiltin } from "./backgrounds";

const SEG_WIDTH = 256;

let segmenterPromise: Promise<ImageSegmenter> | null = null;

// Load once and reuse; the files are served by this app (see
// scripts/copy-mediapipe.mjs), so nothing comes from other sites.
function loadSegmenter() {
  segmenterPromise ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe");
    const make = (delegate: "GPU" | "CPU") =>
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/selfie_segmenter.tflite", delegate },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    try {
      return await make("GPU");
    } catch {
      return await make("CPU");
    }
  })();
  segmenterPromise.catch(() => (segmenterPromise = null));
  return segmenterPromise;
}

export function preloadBackgroundFx() {
  return loadSegmenter().then(() => undefined);
}

function canvas(w = 1, h = 1) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function ctx2d(c: HTMLCanvasElement) {
  return c.getContext("2d", { willReadFrequently: false })!;
}

export class BackgroundFx {
  private seg: ImageSegmenter;
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
  /** Average time to process one frame, in ms (for checking speed). */
  frameMs = 0;
  segMs = 0;
  private frameNo = 0;

  private small = canvas();
  private maskC = canvas();
  private maskData: ImageData | null = null;
  private prev: Float32Array | null = null;
  private person = canvas();
  private blurA = canvas();
  private blurB = canvas();

  private constructor(seg: ImageSegmenter) {
    this.seg = seg;
  }

  static async create() {
    return new BackgroundFx(await loadSegmenter());
  }

  setChoice(choice: BackgroundChoice, customUrl: string | null) {
    this.choice = choice;
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
  }

  start(video: HTMLVideoElement, out: HTMLCanvasElement) {
    this.stop();
    this.video = video;
    this.out = out;
    this.running = true;
    this.prev = null;
    this.schedule();
  }

  stop() {
    this.running = false;
    if (this.video && "cancelVideoFrameCallback" in this.video && this.frameHandle) {
      this.video.cancelVideoFrameCallback(this.frameHandle);
    } else if (this.frameHandle) {
      cancelAnimationFrame(this.frameHandle);
    }
    this.frameHandle = 0;
  }

  private schedule() {
    if (!this.running || !this.video) return;
    const v = this.video;
    if ("requestVideoFrameCallback" in v) {
      this.frameHandle = v.requestVideoFrameCallback(() => this.frame());
    } else {
      this.frameHandle = requestAnimationFrame(() => this.frame());
    }
  }

  private frame() {
    try {
      const t = performance.now();
      this.render();
      this.frameMs = 0.9 * this.frameMs + 0.1 * (performance.now() - t);
    } catch (e) {
      console.warn("background effect frame failed", e);
    }
    this.schedule();
  }

  private render() {
    const v = this.video!;
    const out = this.out!;
    const W = v.videoWidth;
    const H = v.videoHeight;
    if (!W || !H || v.readyState < 2) return;

    if (out.width !== W || out.height !== H) {
      out.width = W;
      out.height = H;
      this.person.width = W;
      this.person.height = H;
      this.sceneKey = "";
    }
    const og = ctx2d(out);

    if (this.choice.kind === "none") {
      og.drawImage(v, 0, 0, W, H);
      return;
    }

    // 1. Segment a small copy of the frame.
    const sw = SEG_WIDTH;
    const sh = Math.max(1, Math.round((SEG_WIDTH * H) / W));
    if (this.small.width !== sw || this.small.height !== sh) {
      this.small.width = this.maskC.width = sw;
      this.small.height = this.maskC.height = sh;
      this.maskData = null;
      this.prev = null;
    }
    // On slower phones, find the outline every other frame and reuse it in
    // between, so the picture itself stays smooth.
    this.frameNo++;
    const skipSeg = this.segMs > 30 && this.frameNo % 2 === 1 && this.prev;
    if (!skipSeg) this.segment(sw, sh);
    this.composite(v, W, H, og);
  }

  private segment(sw: number, sh: number) {
    const v = this.video!;
    ctx2d(this.small).drawImage(v, 0, 0, sw, sh);
    const ts = Math.max(performance.now(), this.lastTs + 1);
    this.lastTs = ts;
    const t0 = performance.now();
    const result = this.seg.segmentForVideo(this.small, ts);
    const conf = result.confidenceMasks?.[0]?.getAsFloat32Array();
    result.close();
    this.segMs = 0.9 * this.segMs + 0.1 * (performance.now() - t0);
    if (!conf) return;

    // 2. Soften: sharpen the in/out decision a little, then blend with the
    //    previous frame so edges don't shimmer.
    const mg = ctx2d(this.maskC);
    this.maskData ??= mg.createImageData(sw, sh);
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

  private composite(v: HTMLVideoElement, W: number, H: number, og: CanvasRenderingContext2D) {
    // 3. Background.
    og.imageSmoothingEnabled = true;
    og.imageSmoothingQuality = "high";
    if (this.choice.kind === "blur") this.drawBlur(og, v, W, H, this.choice.strength === "strong" ? 40 : 20);
    else og.drawImage(this.sceneFor(W, H), 0, 0);

    // 4. You, through the mask, at full resolution.
    const pg = ctx2d(this.person);
    pg.globalCompositeOperation = "copy";
    pg.imageSmoothingEnabled = true;
    pg.imageSmoothingQuality = "high";
    pg.drawImage(this.maskC, 0, 0, W, H);
    pg.globalCompositeOperation = "source-in";
    pg.drawImage(v, 0, 0, W, H);
    pg.globalCompositeOperation = "source-over";
    og.drawImage(this.person, 0, 0);
  }

  // Blur by shrinking and enlarging in steps: works on every browser
  // (canvas blur filters are missing on older iPhones) and is fast.
  private drawBlur(g: CanvasRenderingContext2D, v: HTMLVideoElement, W: number, H: number, factor: number) {
    const aw = Math.max(1, Math.round(W / 4));
    const ah = Math.max(1, Math.round(H / 4));
    const bw = Math.max(1, Math.round(W / factor));
    const bh = Math.max(1, Math.round(H / factor));
    if (this.blurA.width !== aw || this.blurA.height !== ah) {
      this.blurA.width = aw;
      this.blurA.height = ah;
    }
    if (this.blurB.width !== bw || this.blurB.height !== bh) {
      this.blurB.width = bw;
      this.blurB.height = bh;
    }
    const a = ctx2d(this.blurA);
    const b = ctx2d(this.blurB);
    a.imageSmoothingQuality = b.imageSmoothingQuality = "high";
    a.drawImage(v, 0, 0, aw, ah);
    b.drawImage(this.blurA, 0, 0, bw, bh);
    a.drawImage(this.blurB, 0, 0, aw, ah);
    g.drawImage(this.blurA, 0, 0, W, H);
  }

  private sceneFor(W: number, H: number) {
    const c = this.choice;
    const key = `${c.kind}:${c.kind === "builtin" ? c.id : ""}:${W}x${H}:${this.customImg ? 1 : 0}`;
    if (this.scene && this.sceneKey === key) return this.scene;
    let scene: HTMLCanvasElement;
    if (c.kind === "builtin") {
      scene = paintBuiltin(c.id, W, H);
    } else {
      scene = canvas(W, H);
      const g = ctx2d(scene);
      if (this.customImg) drawCover(g, this.customImg, W, H);
      else {
        g.fillStyle = "#111";
        g.fillRect(0, 0, W, H);
      }
    }
    this.scene = scene;
    this.sceneKey = key;
    return scene;
  }
}
