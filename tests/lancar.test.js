// Testes da Fase 3. Rodar: node tests/lancar.test.js
// O teste com histórico real lê seed/seed.json e é pulado sem ele. Nenhum número do histórico real vive aqui.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const perto = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

(async () => {
  const E = await import('../src/engine.js');
  const F = await import('../src/invest.js');

  // ---- números inventados
  const cfg = { contrato: { dataAssinatura: '2030-01-10', valorFinanciado: 100000, prazoOriginal: 240, taxaNominalAA: 0.12,
    diaVencimento: 10, taxaOperacional: 25, valorAvaliacao: 150000 } };
  const prem = { mipTaxa: 0.0001, dfiTaxa: 0.0001 };
  const i = 0.01;
  const parc = [{ vencimento: '2030-03-10' }, { vencimento: '2030-12-10' }];
  assert.strictEqual(E.proximoVencimento(parc, cfg), '2031-01-10');
  assert.strictEqual(E.proximoVencimento([{ vencimento: '2030-01-31' }], { contrato: { diaVencimento: 31 } }), '2030-02-28');
  assert.strictEqual(E.proximoVencimento([], cfg), null);

  // linhaReal sintética: um mês já lançado, estado S/P, TR de 0,2% no mês seguinte
  const S = 90000, P = 1100, tr = 0.002;
  const linha = { meses: [{ vencimento: '2030-03-10', fatorTR: 1.01, calc: { trMes: 0.001 } }], extrasFinais: [], estado: { saldo: S, pmt: P, prazo: 200 } };
  const passo = E.passoMes({ saldo: S, pmt: P }, { tr, i });
  const entrada = { vencimento: '2030-04-10', pago: 1250, saldoApos: passo.saldoFinal };
  const r = E.lancarParcela(linha, entrada, cfg, prem);
  perto(r.calc.trMes, tr, 1e-12, 'TR derivada do saldo');
  perto(r.calc.juros, passo.juros, 1e-9, 'juros');
  perto(r.calc.amortizacao, passo.amortizacao, 1e-9, 'amortização');
  assert.strictEqual(r.registro.competencia, '2030-04');
  assert.strictEqual(r.registro.origemDados, 'lancamento');
  assert.strictEqual(r.registro.devido, 1250);
  assert.strictEqual(r.registro.numeroCaixa, 2);
  assert.strictEqual(r.registro.aj, E.r2(passo.pmt));
  perto(r.registro.seguros, 1250 - r.registro.aj - 25, 0.005, 'seguros = pago - A+J - taxa');
  assert.deepStrictEqual(r.avisos, []);

  // opcional divergente: aviso e o valor da Caixa prevalece; dentro de R$ 0,05 não avisa
  const d = E.lancarParcela(linha, { ...entrada, juros: E.r2(passo.juros + 1), correcao: E.r2(S * tr + 0.03) }, cfg, prem);
  assert.strictEqual(d.avisos.length, 1);
  assert(d.avisos[0].startsWith('Juros'));
  assert.strictEqual(d.registro.juros, E.r2(passo.juros + 1));
  assert.strictEqual(d.registro.correcao, E.r2(S * tr + 0.03));
  perto(d.calc.trMes, E.r2(S * tr + 0.03) / S, 1e-12, 'correção digitada vira a TR');
  const d2 = E.lancarParcela(linha, { ...entrada, correcao: S * tr + 5 }, cfg, prem);
  assert(d2.avisos.some(a => a.startsWith('Correção')));

  // extra: conferir contra a regra (prazo exato do corte bate; um mês a menos não)
  const n = 200, pmtN = E.price(S, n, i);
  const corte = E.valorDeCorte(S, pmtN, n - 5, i);
  const l2 = { meses: [{ vencimento: '2030-04-10', calc: { trMes: 0 } }], extrasFinais: [], estado: { saldo: S, pmt: pmtN, prazo: n } };
  const ok = E.conferirExtra(l2, { data: '2030-04-10', valor: corte, prazoNovo: n - 5 }, cfg);
  assert.strictEqual(ok.prazoCalculado, n - 5);
  assert.strictEqual(ok.bateu, true);
  perto(ok.ajCalculado, pmtN, 1e-6, 'A+J novo mantém a parcela');
  const ruim = E.conferirExtra(l2, { data: '2030-04-10', valor: corte, prazoNovo: n - 4, ajNovo: 1 }, cfg);
  assert.strictEqual(ruim.bateu, false);
  assert.strictEqual(ruim.avisos.length, 2);

  // FGTS: saldo informado menos usos posteriores; uso-entrada não abre a janela de 24 meses
  const g = [
    { data: '2030-01-10', tipo: 'uso-entrada', valor: 9000 },
    { data: '2030-06-01', tipo: 'saldo-informado', valor: 20000 },
    { data: '2030-05-01', tipo: 'saldo-informado', valor: 1 },
    { data: '2030-07-01', tipo: 'uso-amortizacao', valor: 3000 },
    { data: '2030-09-01', tipo: 'uso-amortizacao', valor: 500 },
  ];
  assert.strictEqual(F.saldoFGTSReal(g), 16500);
  assert.strictEqual(F.saldoFGTSReal(g, '2030-07-15'), 17000);
  assert.strictEqual(F.saldoFGTSReal(g, '2030-06-15'), 20000);
  assert.strictEqual(F.saldoFGTSReal([]), null);
  assert.strictEqual(F.proximoUsoFGTS(g), '2032-09-01');
  assert.strictEqual(F.proximoUsoFGTS(g.slice(0, 2)), null);
  assert.strictEqual(F.podeUsarFGTS(g.slice(0, 2), '2030-02-01'), true);
  assert.strictEqual(F.podeUsarFGTS(g, '2032-08-31'), false);
  assert.strictEqual(F.podeUsarFGTS(g, '2032-09-01'), true);

  // ---- histórico real: relançar o mês seguinte ao corte reproduz o seed
  const f = path.join(__dirname, '..', 'seed', 'seed.json');
  if (!fs.existsSync(f)) { console.log('pulado: sem seed'); console.log('ok'); return; }
  const esp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'esperado.json'), 'utf8')).competencias;
  const { config, parcelasReais: P0, amortizacoesReais: X0, premissas } = JSON.parse(fs.readFileSync(f, 'utf8')).stores;
  const alvo = P0.find(p => p.competencia === esp.relancar); // mês a relançar
  const corteVenc = P0.find(p => p.competencia === esp.anteriorRelancar).vencimento;
  const ant = E.replayHistorico(config[0], P0.filter(p => p.vencimento <= corteVenc), X0.filter(x => x.data <= corteVenc), premissas[0]);
  const full = E.replayHistorico(config[0], P0, X0, premissas[0]).meses.find(m => m.competencia === esp.relancar);
  const out = E.lancarParcela(ant, { vencimento: alvo.vencimento, pago: alvo.pago, saldoApos: alvo.saldoApos }, config[0], premissas[0]);
  perto(out.calc.juros, full.calc.juros, 0.01, 'juros');
  perto(out.calc.amortizacao, full.calc.amortizacao, 0.01, 'amortização');
  perto(out.calc.trMes, full.calc.trMes, 1e-6, 'TR');
  const reg = out.registro;
  for (const k of ['competencia', 'vencimento', 'dataPagamento', 'numeroCaixa', 'pago', 'devido', 'saldoApos', 'taxa'])
    assert.strictEqual(reg[k], alvo[k], k);
  for (const k of ['aj', 'amortizacao', 'juros', 'correcao', 'seguros']) perto(reg[k], alvo[k], 0.011, k);
  assert.strictEqual(E.proximoVencimento(P0.filter(p => p.vencimento <= corteVenc), config[0]), alvo.vencimento);

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
