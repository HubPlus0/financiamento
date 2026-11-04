// Parte pura do db.js (sem IndexedDB). Rodar: node tests/db.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

(async () => {
  const D = await import('../src/db.js');
  assert.strictEqual(D.VERSAO_SCHEMA, 2);

  // migração 1→2 do seed: só remove valorCompra
  const sp = path.join(__dirname, '..', 'seed', 'seed.json');
  if (fs.existsSync(sp)) {
    const seed = JSON.parse(fs.readFileSync(sp, 'utf8'));
    const antes = structuredClone(seed);
    const m = D.lerBackup(seed);
    assert.deepStrictEqual(seed, antes, 'não pode alterar a entrada');
    assert.strictEqual(m.versaoSchema, 2);
    assert(!('valorCompra' in m.stores.config[0].inicial));
    delete antes.stores.config[0].inicial.valorCompra;
    antes.versaoSchema = 2;
    assert.deepStrictEqual(m, antes);
  } else console.log('seed ausente: migração do seed pulada');

  // ida e volta com dados inventados
  const stores = {
    config: [{ id: 'config', criadoEm: 'x', contrato: { valorFinanciado: 1000 }, inicial: { entradaDinheiro: 10, entradaFGTS: 5 } }],
    parcelasReais: [{ id: 'a', criadoEm: 'x', competencia: '2030-01', aj: 1 }],
    amortizacoesReais: [], fgtsReal: [], premissas: [{ id: 'padrao', criadoEm: 'x' }], orcamentos: [], cenarios: [], versoes: [],
  };
  const b = D.montarBackup(stores, '2030-01-01T00:00:00.000Z');
  assert.strictEqual(b.versaoSchema, 2);
  assert.deepStrictEqual(D.lerBackup(JSON.parse(JSON.stringify(b))).stores, stores);
  assert.deepStrictEqual(D.lerBackup(b), b);
  assert.strictEqual(D.valorCompra(stores.config[0]), 1015);

  // recusas
  assert.throws(() => D.lerBackup(null));
  assert.throws(() => D.lerBackup({ app: 'outro', versaoSchema: 2, stores: {} }));
  assert.throws(() => D.lerBackup({ app: 'financiamento', versaoSchema: 2 }));
  assert.throws(() => D.lerBackup({ ...b, versaoSchema: 3 }), /mais novo/);
  console.log('ok');
})();
