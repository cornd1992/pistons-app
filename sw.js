// Offline cache. VERSION is bumped by build.py on every build (data + app-code hash).
const VERSION='20261020T1453-6-38de137f';
const CACHE='pistons-'+VERSION;
const SHELL=['./','./index.html','./styles.css','./app.js','./manifest.webmanifest','./data/bundle.json','./data/snapshots/index.json','./data/version.json',
 './icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png','./icons/favicon-32.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
// Network-first for everything same-origin (app shell + data): always fresh when online, cached copy when offline.
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin) return;
  e.respondWith(fetch(e.request,{cache:'no-cache'}).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c));}return r;})
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||(e.request.mode==='navigate'?caches.match('./index.html'):undefined))));
});
