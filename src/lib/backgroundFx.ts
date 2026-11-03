// The picture that gets recorded: the whole camera picture in its own shape
// (tall on a phone held upright, wide on a laptop), Full HD, like a normal
// camera app. What you see in the preview is exactly what ends up in the video.
//
// Each camera frame:
//   1. The camera picture is drawn into the frame, uncropped.
//   2. With a background effect, a small copy goes to MediaPipe's selfie
//      segmenter, which says how likely each pixel is to be you. That mask is
//      softened (edges and frame-to-frame flicker) and scaled up.
//   3. The background (blurred camera, a built-in scene or your photo) is
//      drawn, then you are drawn on top through the mask at full resolution.
// Everything runs on the device.

import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import { type BackgroundChoice, drawCover, paintBuiltin } from "./backgrounds";

const SEG_W = 256;
// Longest side of the recorded picture (Full HD).
const OUT_LONG = 1920;

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

  /** Size of the recorded picture: the camera's own shape, Full HD. */
  ow = 1080;
  oh = 1920;
  /** Told when the picture's shape is known or changes. */
  onSize?: (w: number, h: number) => void;

  /** Average time to process one frame / to segment one frame, in ms. */
  frameMs = 0;
  segMs = 0;
  /** Frames drawn since start(); stays 0 if the camera never delivers a picture. */
  framesRendered = 0;
  /** Told whenever the effect's state changes (loading, on, error…). */
  onStatus?: (s: FxStatus) => void;

  private segH = Math.round((SEG_W * 1920) / 1080);
  private frame = canvas(1080, 1920); // the camera picture
  private small = canvas(SEG_W, this.segH);
  private maskC = canvas(SEG_W, this.segH);
  private maskData: ImageData | null = null;
  private prev: Float32Array | null = null;
  private person = canvas(1080, 1920);
  private blurA = canvas();
  private blurB = canvas();

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

  // Match the picture to the camera's shape (tall on a phone held upright,
  // wide on a laptop), scaled so the long side is Full HD.
  private fitTo(W: number, H: number) {
    const k = OUT_LONG / Math.max(W, H);
    const ow = Math.round((W * k) / 2) * 2;
    const oh = Math.round((H * k) / 2) * 2;
    if (ow === this.ow && oh === this.oh && this.out?.width === ow) return;
    this.ow = ow;
    this.oh = oh;
    this.segH = Math.round((SEG_W * oh) / ow);
    for (const c of [this.frame, this.person]) {
      c.width = ow;
      c.height = oh;
    }
    for (const c of [this.small, this.maskC]) {
      c.width = SEG_W;
      c.height = this.segH;
    }
    this.maskData = null;
    this.prev = null;
    this.blurA.width = this.blurB.width = 1; // re-made at the new size
    this.sceneKey = "";
    this.sizeOut();
    this.onSize?.(ow, oh);
  }

  private sizeOut() {
    if (!this.out) return;
    if (this.out.width !== this.ow) this.out.width = this.ow;
    if (this.out.height !== this.oh) this.out.height = this.oh;
  }

  start(video: HTMLVideoElement, out: HTMLCanvasElement) {
    this.stop();
    this.video = video;
    this.out = out;
    this.sizeOut();
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

    // 1. The whole camera picture, as a normal camera app records it.
    this.fitTo(W, H);
    const fg = ctx2d(this.frame);
    fg.imageSmoothingEnabled = true;
    fg.imageSmoothingQuality = "high";
    fg.drawImage(v, 0, 0, this.ow, this.oh);

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
    pg.drawImage(this.maskC, 0, 0, this.ow, this.oh);
    pg.globalCompositeOperation = "source-in";
    pg.drawImage(this.frame, 0, 0);
    pg.globalCompositeOperation = "source-over";
    og.drawImage(this.person, 0, 0);
    return true;
  }

  private segment() {
    ctx2d(this.small).drawImage(this.frame, 0, 0, SEG_W, this.segH);
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
    this.maskData ??= mg.createImageData(SEG_W, this.segH);
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
    const aw = Math.round(this.ow / 4);
    const ah = Math.round(this.oh / 4);
    const bw = Math.max(1, Math.round(this.ow / factor));
    const bh = Math.max(1, Math.round(this.oh / factor));
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
    g.drawImage(this.blurA, 0, 0, this.ow, this.oh);
  }

  private sceneFor() {
    const c = this.choice;
    const key = `${c.kind}:${c.kind === "builtin" ? c.id : ""}:${this.customImg ? 1 : 0}`;
    if (this.scene && this.sceneKey === key) return this.scene;
    let scene: HTMLCanvasElement;
    if (c.kind === "builtin") {
      scene = paintBuiltin(c.id, this.ow, this.oh);
    } else {
      scene = canvas(this.ow, this.oh);
      const g = ctx2d(scene);
      if (this.customImg) drawCover(g, this.customImg, this.ow, this.oh);
      else {
        g.fillStyle = "#111";
        g.fillRect(0, 0, this.ow, this.oh);
      }
    }
    this.scene = scene;
    this.sceneKey = key;
    return scene;
  }
}
