// Testes do motor. Rodar: node tests/engine.test.js
// Os testes com histórico real leem seed/seed.json e seed/esperado.json (fora do git) e são pulados sem eles.
// Nenhum número do histórico real vive neste arquivo; tolerâncias e notas das diferenças conhecidas ficam em
// seed/esperado.json.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const perto = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

(async () => {
  const E = await import('../src/engine.js');
  const i = 0.01;

  // ---- funções genéricas (números inventados)
  assert.strictEqual(E.r2(1.005), 1.01);
  assert.strictEqual(E.r2(-1.005), -1.01);
  assert.strictEqual(E.r2(2.344), 2.34);
  perto(E.price(100000, 12, i), 8884.88, 0.005, 'price');

  // passoMes: saldoFinal = saldoCorrigido − amortização, pmt sobe pela TR
  const p = E.passoMes({ saldo: 100000, pmt: 1500 }, { tr: 0.002, i });
  perto(p.saldoCorrigido, 100200, 1e-9, 'saldoCorrigido');
  perto(p.pmt, 1503, 1e-9, 'pmt');
  perto(p.juros, 1002, 1e-9, 'juros');
  perto(p.saldoFinal, p.saldoCorrigido - (1503 - 1002), 1e-9, 'saldoFinal');
  perto(E.trDaSerie(1503, 1500), 0.002, 1e-12, 'trDaSerie');

  // prazo: sem amortizar nada, devolve o mesmo prazo; amortizar o corte reduz exatamente k meses
  const S = 80000, n = 200, pmt = E.price(S, n, i);
  assert.strictEqual(E.prazoAposAmortizacao(S, pmt, i).nNovo, n);
  const v = E.valorDeCorte(S, pmt, n - 7, i);
  assert.strictEqual(E.prazoAposAmortizacao(S - v, pmt, i).nNovo, n - 7);
  assert.strictEqual(E.prazoAposAmortizacao(S - v + 5, pmt, i).nNovo, n - 7); // sobra de 5 não vira outro mês
  perto(E.price(S - v, n - 7, i), pmt, 1e-6, 'corte mantém a parcela');

  // faixas: limiares TR$ e J + TR$ (TR$ < J e TR$ > J)
  const f = (a, j, t) => E.faixa({ amortizacao: a, juros: j, trValor: t });
  assert.deepStrictEqual([f(50, 1000, 300), f(300, 1000, 300), f(1000, 1000, 300), f(1299, 1000, 300), f(1300, 1000, 300)], [1, 2, 2, 2, 3]);
  assert.deepStrictEqual([f(200, 200, 500), f(499, 200, 500), f(500, 200, 500), f(700, 200, 500)], [1, 1, 2, 3]);

  // dias úteis após o vencimento (vencimento em fim de semana vale a segunda)
  assert.strictEqual(E.diasUteisApos('2030-01-04', '2030-01-04'), 0); // sex, no dia
  assert.strictEqual(E.diasUteisApos('2030-01-04', '2030-01-07'), 1); // sex -> seg
  assert.strictEqual(E.diasUteisApos('2030-01-05', '2030-01-07'), 0); // sáb vence na seg
  assert.strictEqual(E.diasUteisApos('2030-01-05', '2030-01-09'), 2);

  // ---- histórico real
  const dir = path.join(__dirname, '..', 'seed');
  if (!fs.existsSync(path.join(dir, 'seed.json')) || !fs.existsSync(path.join(dir, 'esperado.json'))) {
    console.log('pulado: sem seed');
    console.log('ok');
    return;
  }
  const seed = JSON.parse(fs.readFileSync(path.join(dir, 'seed.json'), 'utf8'));
  const esp = JSON.parse(fs.readFileSync(path.join(dir, 'esperado.json'), 'utf8'));
  const tol = esp.tolerancias;
  const { config, parcelasReais: P, amortizacoesReais: X, premissas } = seed.stores;
  const cfg = config[0];
  const opts = { ajProximo: esp.ajProximo };
  const R = E.replayHistorico(cfg, P, X, premissas[0], opts);
  const real = Object.fromEntries(P.map(q => [q.competencia, q]));
  const mes = Object.fromEntries(R.meses.map(m => [m.competencia, m]));
  const iC = E.taxaMensal(cfg.contrato);

  assert.strictEqual(R.meses.length, P.length);
  assert(R.meses.slice(6).every(m => m.origemDados === 'reconstruido'), 'meses do PDF são reconstruídos');
  assert(P.slice(6).every(q => q.origemDados === 'caixa-pdf'), 'registro de entrada intacto');

  // 1. meses limpos: juros, amortização e saldo (partindo do saldo real do mês anterior)
  for (const c of esp.competencias.limpos) {
    const m = mes[c], q = real[c];
    perto(m.calc.juros, q.juros, tol.limpo, c + ' juros');
    perto(m.calc.amortizacao, q.amortizacao, tol.limpo, c + ' amortização');
    perto(m.saldoCalc, q.saldoApos, tol.limpo, c + ' saldo');
  }

  // 2. as extras: prazo da regra (exceções documentadas) e ajNovo com o prazo da Caixa
  const todas = [...R.meses.flatMap(m => m.extras), ...R.extrasFinais];
  assert.strictEqual(todas.length, X.length);
  assert.strictEqual(X.length, 9);
  for (const e of todas) {
    const x = X.find(a => a.data === e.data);
    const dif = x.prazoNovo - e.calc.prazoNovo;
    assert.strictEqual(dif, esp.prazoExcecoes[e.data] || 0, `prazo da extra ${e.data}`);
    perto(e.calc.ajNovoComPrazoReal, x.ajNovo, tol.ajNovo, `ajNovo ${e.data}`);
  }

  // 3. valor de corte
  const dez = real[esp.competencias.corteValor];
  perto(E.r2(E.valorDeCorte(dez.saldoApos, dez.aj, esp.corteMeses, iC)), esp.valorDeCorte, 0.01, 'corte');

  // 4. replay completo até o saldo depois da última extra (diferença explicada em esperado.notas.saldoFinal)
  const xUlt = X.find(a => a.saldoApos != null);
  assert.strictEqual(xUlt.data, X[X.length - 1].data);
  perto(R.extrasFinais[0].calc.saldoDepois, xUlt.saldoApos, tol.saldoFinal, 'saldo final calculado');
  assert.strictEqual(R.estado.saldo, xUlt.saldoApos);
  assert.strictEqual(R.estado.prazo, X[X.length - 1].prazoNovo);

  // parcela em aberto (próxima): J = S_corr × i, A = A+J − J
  const nov = esp.parcelaProxima;
  const trNov = E.trDaSerie(nov.aj, X[X.length - 1].ajNovo);
  const pn = E.passoMes({ saldo: R.estado.saldo, pmt: X[X.length - 1].ajNovo }, { tr: trNov, i: iC });
  perto(pn.pmt, nov.aj, 0.01, 'A+J próxima');
  perto(pn.juros, nov.juros, 0.15, 'juros próxima');
  perto(pn.amortizacao, nov.amortizacao, 0.15, 'amortização próxima');

  // 5. primeira parcela e mês com extra fora do vencimento (diferenças em esperado.notas)
  const m1 = R.meses[0], q1 = P[0];
  perto(m1.calc.juros, q1.juros, tol.primeiraJuros, '1ª parcela juros');
  perto(m1.calc.amortizacao, q1.amortizacao, tol.primeiraJuros, '1ª parcela amortização');
  perto(m1.saldoCalc, q1.saldoApos, tol.primeiraSaldo, '1ª parcela saldo');
  const sem = E.replayHistorico(cfg, P, X, premissas[0], { ...opts, proRataAtraso: false });
  perto(sem.meses[2].saldoCalc - real[esp.competencias.set].saldoApos, -esp.difSaldoExtraTardia, 0.2, 'mês com extra fora do vencimento, sem pro rata');
  perto(mes[esp.competencias.set].saldoCalc, real[esp.competencias.set].saldoApos, tol.extraTardiaComProRata, 'mês com extra fora do vencimento, com pro rata');

  // 6. seguros: total por mês e MIP/DFI informados nas extras
  for (const m of R.meses) {
    perto(m.calc.mip + m.calc.dfi, real[m.competencia].seguros, tol.seguroMes, m.competencia + ' seguros');
    perto(m.encargo, real[m.competencia].devido, tol.encargo, m.competencia + ' encargo');
  }
  R.meses.forEach((m, k) => m.extras.concat(k === R.meses.length - 1 ? R.extrasFinais : []).forEach(e => {
    const x = X.find(a => a.data === e.data);
    const fator = (m.extras.includes(e) ? R.meses[k - 1] : m).fatorTR;
    const sg = E.seguros(e.saldoDepois, cfg.contrato.valorAvaliacao * fator, premissas[0]);
    perto(sg.mip, x.mipNovo, 0.05, 'MIP ' + e.data);
    perto(sg.dfi, x.dfiNovo, 0.06, 'DFI ' + e.data);
  }));

  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
