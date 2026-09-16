import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

const AISTUDIO = "https://generativelanguage.googleapis.com/v1beta";
const GCLOUD = process.env.GCLOUD_BIN || "gcloud";

// GOOGLE_CLOUD_PROJECT が設定されていれば Vertex AI 経由（Cloud Billing = $300クーポンが使える）
// 未設定なら AI Studio の API キー経由。
export const useVertex = () => Boolean(process.env.GOOGLE_CLOUD_PROJECT);
const LOCATION = process.env.GOOGLE_CLOUD_LOCATION || "global";

function apiKey() {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("GEMINI_API_KEY が .env に設定されていません");
  return k;
}

let tokenCache = { value: null, exp: 0 };
async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.exp) return tokenCache.value;
  const { stdout } = await exec(GCLOUD, ["auth", "application-default", "print-access-token"]);
  tokenCache = { value: stdout.trim(), exp: Date.now() + 45 * 60 * 1000 };
  return tokenCache.value;
}

function endpoint(model) {
  if (!useVertex()) return { url: `${AISTUDIO}/models/${model}:generateContent` };
  const p = process.env.GOOGLE_CLOUD_PROJECT;
  const host = LOCATION === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${LOCATION}-aiplatform.googleapis.com`;
  return { url: `${host}/v1/projects/${p}/locations/${LOCATION}/publishers/google/models/${model}:generateContent` };
}

async function headers() {
  return useVertex()
    ? { "content-type": "application/json", authorization: `Bearer ${await accessToken()}` }
    : { "content-type": "application/json", "x-goog-api-key": apiKey() };
}

export async function listModels() {
  if (useVertex()) return []; // Vertex はモデル一覧の形が違うので今日は使わない
  const r = await fetch(`${AISTUDIO}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey() } });
  if (!r.ok) throw new Error(`listModels ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  return (j.models || []).map((m) => m.name.replace("models/", ""));
}

export async function generate(opts) {
  const {
    model, parts, system, tools,
    responseMimeType, responseSchema, responseModalities,
    temperature, timeoutMs = 90000,
  } = opts;

  const body = { contents: [{ role: "user", parts }] };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  // Vertex の REST は camelCase。google_search / googleSearch の両方を許容させる。
  if (tools) body.tools = useVertex() ? tools.map((t) => (t.google_search ? { googleSearch: {} } : t)) : tools;

  const gc = {};
  if (responseMimeType) gc.responseMimeType = responseMimeType;
  if (responseSchema) gc.responseSchema = responseSchema;
  if (responseModalities) gc.responseModalities = responseModalities;
  if (temperature != null) gc.temperature = temperature;
  if (Object.keys(gc).length) body.generationConfig = gc;

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const { url } = endpoint(model);
    const r = await fetch(url, { method: "POST", headers: await headers(), body: JSON.stringify(body), signal: ac.signal });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Gemini(${model}${useVertex() ? "@vertex" : ""}) ${r.status}: ${txt.slice(0, 600)}`);
    return JSON.parse(txt);
  } finally {
    clearTimeout(t);
  }
}

const partsOf = (res) => res?.candidates?.[0]?.content?.parts || [];

export const textOf = (res) =>
  partsOf(res).filter((p) => typeof p.text === "string").map((p) => p.text).join("");

export const imagesOf = (res) =>
  partsOf(res).filter((p) => p.inlineData?.data)
    .map((p) => ({ mime: p.inlineData.mimeType || "image/png", data: p.inlineData.data }));

export function groundingUrls(res) {
  const c = res?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  return c.map((x) => x.web?.uri).filter(Boolean);
}

export function looseJson(text) {
  if (!text) throw new Error("空の応答");
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  try { return JSON.parse(raw.trim()); } catch {}
  const s = raw.indexOf("["), s2 = raw.indexOf("{");
  const start = s >= 0 && (s2 < 0 || s < s2) ? s : s2;
  const endCh = raw[start] === "[" ? "]" : "}";
  const end = raw.lastIndexOf(endCh);
  if (start < 0 || end < 0) throw new Error("JSONが見つからない: " + raw.slice(0, 200));
  return JSON.parse(raw.slice(start, end + 1));
}
