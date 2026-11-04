// Versão gravada é arredondada e enxuta. Rodar: node tests/versao.test.js
const assert = require('assert');
(async () => {
  const E = await import('../src/engine.js');
  const S = await import('../src/scenario.js');
  const contrato = { taxaNominalAA: 0.12, valorAvaliacao: 300000, taxaOperacional: 25 };
  const prem = { trMensal: { modo: 'curva', pontos: [{ desde: '2030-01', valor: 0.0017123456789 }] }, mipTaxa: 0.00008494, dfiTaxa: 0.00007095 };
  const estado = { competencia: '2030-01', saldo: 200000.123456, pmt: E.price(200000, 300, 0.01), prazo: 300, fatorTR: 1.000123456789123, contrato, faixasVistas: [] };
  const v = S.criarVersao({ cenario: { id: 'c', meses: {} }, motivo: 'criacao', estado, orcamento: { id: 'o', meses: {} }, premissas: prem, agora: 'x' });
  assert.strictEqual(v.meses.length, 300);
  const casas = x => (String(x).split('.')[1] ?? '').length;
  const dinheiro = 'saldoInicial saldoCorrigido juros amortizacao pmt mip dfi encargo saldoFinal aporte custoBolso carteiraBruta carteiraLiquida'.split(' ');
  v.meses.forEach(m => { dinheiro.forEach(c => assert(casas(m[c]) <= 2, `${c}: ${m[c]}`)); assert(casas(m.trMes) <= 8, `trMes ${m.trMes}`); });
  Object.values(v.resumo).forEach(x => assert(x === null || typeof x === 'string' || casas(x) <= 2, `resumo ${x}`));
  assert(casas(v.estadoInicialSnapshot.saldo) <= 2 && casas(v.estadoInicialSnapshot.fatorTR) <= 10);
  const kb = JSON.stringify(v).length / 1024;
  console.log(`versão de 300 meses: ${kb.toFixed(1)} KB`);
  // o alvo de 90 KB não é alcançável só arredondando (~35 chaves por mês); guarda contra regressão
  assert(kb < 160, `versão grande demais: ${kb} KB`);
  // gzip: ida e volta, tamanho e lerBackup nos dois formatos
  const D = await import('../src/db.js');
  const gz = await D.gzipB64(v.meses);
  assert.deepStrictEqual(await D.gunzipB64(gz), v.meses);
  console.log(`comprimida: ${(gz.length / 1024).toFixed(1)} KB`);
  assert(gz.length < 30 * 1024, 'mesesGz acima de 30 KB');
  const bk = meses => ({ app: 'financiamento', versaoSchema: 2, stores: { versoes: [meses ? { id: 'a', meses } : { id: 'b', mesesGz: gz }] } });
  assert.deepStrictEqual(D.lerBackup(bk(v.meses)).stores.versoes[0].meses, v.meses);
  assert.strictEqual(D.lerBackup(bk()).stores.versoes[0].mesesGz, gz);
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
