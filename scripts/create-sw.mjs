import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const entries = await readdir("dist/assets");
const precache = [
  "/",
  "/index.html",
  "/favicon.svg",
  ...entries
    .filter((n) => /\.(js|css|mjs)$/.test(n))
    .map((n) => "/assets/" + n),
];
const version = createHash("sha256")
  .update(await readFile("dist/index.html"))
  .digest("hex")
  .slice(0, 12);
// Only same-origin public app assets are cached, never media or API responses.
await writeFile(
  "dist/sw.js",
  `const CACHE='clipscribe-shell-${version}';
const PRECACHE=${JSON.stringify(precache)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(PRECACHE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('clipscribe-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
 if(e.request.mode==='navigate'){
   e.respondWith(fetch(e.request).catch(()=>caches.open(CACHE).then(c=>c.match('/index.html'))));return;
 }
 if(!u.pathname.startsWith('/assets/')&&!u.pathname.startsWith('/runtime/')&&u.pathname!=='/favicon.svg')return;
 e.respondWith(caches.open(CACHE).then(async c=>{const hit=await c.match(e.request);if(hit)return hit;const response=await fetch(e.request);if(response.ok){try{await c.put(e.request,response.clone());}catch{/* Cache pressure must not break an otherwise valid asset response. */}}return response;}));
});`,
);
console.log("Generated versioned app-shell service worker.");
