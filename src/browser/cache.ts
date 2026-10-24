import {
  BROWSER_MODELS,
  MODEL_CACHE_PREFIX,
  type BrowserModel,
} from "./registry";
export function markerURL(model: BrowserModel) {
  return new URL(`/__clipscribe_cache__/${model}`, location.origin).href;
}
export async function modelInstalled(model: BrowserModel): Promise<boolean> {
  if (!("caches" in globalThis)) return false;
  const cache = await caches.open(MODEL_CACHE_PREFIX + model);
  const marker = await cache.match(markerURL(model));
  if (!marker) return false;
  try {
    const data = await marker.json();
    if (
      data.revision !== BROWSER_MODELS[model].revision ||
      !Array.isArray(data.urls) ||
      data.urls.length < 5
    )
      return false;
    for (const url of data.urls) {
      if (!(await cache.match(url))) {
        await cache.delete(markerURL(model));
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
export async function markInstalled(model: BrowserModel) {
  const cache = await caches.open(MODEL_CACHE_PREFIX + model);
  const urls = (await cache.keys())
    .map((r) => r.url)
    .filter((url) => url !== markerURL(model));
  if (
    !urls.some((url) => url.includes("encoder_model_quantized.onnx")) ||
    !urls.some((url) => url.includes("decoder_model_merged_quantized.onnx"))
  )
    throw new Error(
      "The browser did not retain all model files. Check storage permissions and retry.",
    );
  await cache.put(
    markerURL(model),
    new Response(
      JSON.stringify({ revision: BROWSER_MODELS[model].revision, urls }),
      { headers: { "Content-Type": "application/json" } },
    ),
  );
}
