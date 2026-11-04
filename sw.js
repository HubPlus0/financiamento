const VERSAO = 'v14';
const ARQUIVOS = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'src/ui/app.js',
  'src/ui/comum.js',
  'src/ui/config.js',
  'src/ui/status.js',
  'src/ui/lancar.js',
  'src/ui/real.js',
  'src/ui/versoes.js',
  'src/ui/premissas.js',
  'src/ui/cenarios.js',
  'src/ui/comparativo.js',
  'src/ui/dados.js',
  'src/db.js',
  'src/engine.js',
  'src/invest.js',
  'src/scenario.js',
  'src/patrimonio.js',
  'src/paineis.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
