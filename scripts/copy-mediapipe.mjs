// Copies MediaPipe's WebAssembly files into public/ so the app serves them
// itself (no third-party CDN). Runs before `dev` and `build`.
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/mediapipe", { recursive: true });
cpSync("node_modules/@mediapipe/tasks-vision/wasm", "public/mediapipe", { recursive: true });
