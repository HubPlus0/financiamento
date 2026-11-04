const assert = require('assert');
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const existe = p => fs.existsSync(path.join(raiz, p === './' ? 'index.html' : p));

const sw = fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8');
const lista = sw.match(/ARQUIVOS\s*=\s*\[([\s\S]*?)\]/)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
assert(lista.length > 0, 'lista vazia');
lista.forEach(f => assert(existe(f), 'falta no disco: ' + f));

const m = JSON.parse(fs.readFileSync(path.join(raiz, 'manifest.webmanifest'), 'utf8'));
assert.strictEqual(m.display, 'standalone');
m.icons.forEach(i => assert(existe(i.src), 'ícone ausente: ' + i.src));
assert(m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512'));
assert(m.icons.some(i => /maskable/.test(i.purpose || '')));
console.log('ok');
