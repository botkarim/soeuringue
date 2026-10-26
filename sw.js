/* Soeuringue — fonctionnement hors ligne. Ne met en cache que le code de l'appli, jamais les données. */
const CACHE = 'soeuringue-v1.12.4';
const FILES = ['./', './index.html', './app.js', './engine.js', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png', './logo-full.png', './logo-splash.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // l'IA passe directement, sans cache
  // Agenda : l'appli demande cal.ics?d=… ; on renvoie un vrai fichier calendrier pour que l'iPhone propose « Ajouter au calendrier »
  if (/\/cal\.ics$/.test(u.pathname) && u.searchParams.get('d')) {
    e.respondWith(new Response(u.searchParams.get('d'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'inline; filename="soeuringue.ics"', 'Cache-Control': 'no-store' } }));
    return;
  }
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html'))));
});
