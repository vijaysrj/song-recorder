import Replicate from "replicate";

export function getReplicate() {
  const auth = process.env.REPLICATE_API_TOKEN;
  if (!auth) throw new Error("REPLICATE_API_TOKEN is not set");
  return new Replicate({ auth });
}

// Community Demucs model on Replicate. Override with DEMUCS_MODEL if needed.
const MODEL = process.env.DEMUCS_MODEL ?? "ryan5453/demucs";

let cachedVersion: string | undefined;
export async function getDemucsVersion(replicate: Replicate) {
  if (process.env.DEMUCS_VERSION) return process.env.DEMUCS_VERSION;
  if (cachedVersion) return cachedVersion;
  const [owner, name] = MODEL.split("/");
  const model = await replicate.models.get(owner, name);
  const id = model.latest_version?.id;
  if (!id) throw new Error(`No version found for ${MODEL}`);
  cachedVersion = id;
  return id;
}

// Demucs returns one URL per stem. With stem="vocals" we expect
// { vocals, no_vocals }; "no_vocals" is the karaoke track.
export function pickInstrumental(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const o = output as Record<string, unknown>;
  const v = o.no_vocals ?? o.accompaniment ?? o.instrumental;
  return typeof v === "string" ? v : undefined;
}
