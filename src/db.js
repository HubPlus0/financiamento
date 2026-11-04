// Persistência: IndexedDB fino + parte pura (validar, migrar, montar backup) testável no Node.
// O módulo só toca em indexedDB dentro das funções.
export const VERSAO_SCHEMA = 2;
export const STORES = ['config', 'parcelasReais', 'amortizacoesReais', 'fgtsReal', 'premissas', 'orcamentos', 'cenarios', 'versoes'];
const NOME_DB = 'financiamento';

import { valorCompra } from './patrimonio.js';
export { valorCompra }; // sempre derivado (v2 não o grava mais); vive em patrimonio.js

// MIGRACOES[v] leva um backup da versão v para v+1 (recebe e devolve o objeto de backup).
const MIGRACOES = {
  1: b => { b.stores.config.forEach(c => { delete c.inicial?.valorCompra; }); return b; },
};

// Valida e migra até VERSAO_SCHEMA. Não altera o argumento.
export function lerBackup(json) {
  if (!json || json.app !== 'financiamento' || typeof json.stores !== 'object' || json.stores === null) throw new Error('Arquivo não é um backup do financiamento.');
  let v = json.versaoSchema;
  if (!Number.isInteger(v) || v < 1) throw new Error('versaoSchema inválida.');
  if (v > VERSAO_SCHEMA) throw new Error(`Backup do schema ${v}, mais novo que o app (${VERSAO_SCHEMA}). Atualize o app.`);
  const b = structuredClone(json);
  STORES.forEach(s => { b.stores[s] ??= []; });
  for (; v < VERSAO_SCHEMA; v++) MIGRACOES[v](b);
  b.versaoSchema = VERSAO_SCHEMA;
  return b;
}

export const montarBackup = (stores, exportadoEm = new Date().toISOString()) =>
  ({ app: 'financiamento', versaoSchema: VERSAO_SCHEMA, exportadoEm, stores: Object.fromEntries(STORES.map(s => [s, stores[s] ?? []])) });

// ---- gzip + base64 (puro; CompressionStream existe no navegador e no Node 18+). Só o store `versoes` usa.
const emBytes = async (stream, dados) => new Uint8Array(await new Response(new Blob([dados]).stream().pipeThrough(stream)).arrayBuffer());
export async function gzipB64(valor) {
  const b = await emBytes(new CompressionStream('gzip'), JSON.stringify(valor));
  let t = ''; for (let i = 0; i < b.length; i += 8192) t += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(t);
}
export async function gunzipB64(txt) {
  const b = await emBytes(new DecompressionStream('gzip'), Uint8Array.from(atob(txt), c => c.charCodeAt(0)));
  return JSON.parse(new TextDecoder().decode(b));
}
// Registro de versão: grava `mesesGz` no lugar de `meses`; a leitura devolve `meses` (registro antigo, com `meses`, passa como está).
const comprimir = async (s, r) => { if (s !== 'versoes' || !r.meses) return r; const { meses, ...resto } = r; return { ...resto, mesesGz: await gzipB64(meses) }; };
const expandir = async (s, r) => { if (s !== 'versoes' || !r?.mesesGz) return r; const { mesesGz, ...resto } = r; return { ...resto, meses: await gunzipB64(mesesGz) }; };

// ---- IndexedDB
let _db;
export function abrir() {
  return _db ??= new Promise((ok, erro) => {
    const rq = indexedDB.open(NOME_DB, VERSAO_SCHEMA);
    rq.onupgradeneeded = () => STORES.forEach(s => { if (!rq.result.objectStoreNames.contains(s)) rq.result.createObjectStore(s, { keyPath: 'id' }); });
    rq.onsuccess = () => ok(rq.result);
    rq.onerror = () => erro(rq.error);
  });
}
const pronto = rq => new Promise((ok, erro) => { rq.onsuccess = () => ok(rq.result); rq.onerror = () => erro(rq.error); });
const fim = tx => new Promise((ok, erro) => { tx.oncomplete = ok; tx.onerror = tx.onabort = () => erro(tx.error); });
const loja = async (s, modo = 'readonly') => (await abrir()).transaction(s, modo).objectStore(s);

export const listar = async s => Promise.all((await pronto((await loja(s)).getAll())).map(r => expandir(s, r)));
export const obter = async (s, id) => expandir(s, await pronto((await loja(s)).get(id)));
export const apagar = async (s, id) => pronto((await loja(s, 'readwrite')).delete(id));
export async function salvar(s, reg) {
  reg = { ...reg };
  reg.id ??= s === 'config' ? 'config' : crypto.randomUUID();
  reg.criadoEm ??= new Date().toISOString();
  const gravar = await comprimir(s, reg); // antes de abrir a transação: await no meio a fecharia
  await pronto((await loja(s, 'readwrite')).put(gravar));
  return reg;
}

export async function exportarTudo() {
  const db = await abrir();
  const tx = db.transaction(STORES);
  const dados = await Promise.all(STORES.map(s => pronto(tx.objectStore(s).getAll())));
  return montarBackup(Object.fromEntries(STORES.map((s, k) => [s, dados[k]])));
}

// Substitui tudo numa transação. A confirmação fica na UI.
export async function importarTudo(json) {
  const b = lerBackup(json);
  const tx = (await abrir()).transaction(STORES, 'readwrite');
  STORES.forEach(s => { const st = tx.objectStore(s); st.clear(); b.stores[s].forEach(r => st.put(r)); });
  await fim(tx);
}

export async function contagens() {
  const db = await abrir();
  const tx = db.transaction(['parcelasReais', 'amortizacoesReais', 'cenarios', 'versoes']);
  const n = s => pronto(tx.objectStore(s).count());
  const [parcelasReais, amortizacoesReais, cenarios, versoes] = await Promise.all([n('parcelasReais'), n('amortizacoesReais'), n('cenarios'), n('versoes')]);
  return { parcelasReais, amortizacoesReais, cenarios, versoes };
}
