// Testes da Fase 5 (cenários e orçamento compartilhado). Rodar: node tests/cenarios.test.js
// Números inventados; nenhum dado do histórico real.
const assert = require('assert');
const perto = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

(async () => {
  const E = await import('../src/engine.js');
  const S = await import('../src/scenario.js');

  const contrato = { taxaNominalAA: 0.12, valorAvaliacao: 150000, taxaOperacional: 25 };
  const prem = { trMensal: { modo: 'curva', pontos: [{ desde: '2030-01', valor: 0.002 }] }, mipTaxa: 0.0001, dfiTaxa: 0.0001, fgtsRendAA: 0.03 };
  const i = 0.01, n = 240, saldo0 = 100000;
  const estado = { competencia: '2030-01', saldo: saldo0, pmt: E.price(saldo0, n, i), prazo: n, fatorTR: 1, contrato, faixasVistas: [],
    fgts: { saldo: 10000, livreEm: '2030-03', deposito: 500, aviso: null } };
  const orcamentoCom = extra => ({ id: 'o1', meses: Object.fromEntries(Array.from({ length: 120 }, (_, k) => [E.somaMeses('2030-01-01', k).slice(0, 7), { extra, confirmado: true }])) });
  const base = { orcamentoId: 'o1', premissasId: 'p', planoAtivo: false, usarValorDeCorte: false, meses: {} };
  const grupo = {
    ref: { ...base, id: 'ref', regra: 'referencia', fixo: true },
    tudo: { ...base, id: 'tudo', regra: 'amortizarTudo' },
    inv: { ...base, id: 'inv', regra: 'investirTudo' },
    meio: { ...base, id: 'meio', regra: { dividir: 0.5 } },
    man: { ...base, id: 'man', regra: 'manual', usarValorDeCorte: true, meses: { '2030-02': { amortBolso: 700, amortFGTS: 0, resgate: 0, confirmado: true } } },
  };
  const lista = Object.values(grupo), pp = { p: prem };

  // custoBolso igual em todos os cenários, em qualquer horizonte
  const rodar = extra => S.projetarGrupo(estado, lista, orcamentoCom(extra), pp);
  for (const extra of [700, 3000]) {
    const g = rodar(extra), len = g.ref.length;
    assert(lista.every(c => g[c.id].length === len), 'mesmo horizonte');
    for (const k of [12, 60, 120, len]) {
      const cs = lista.map(c => g[c.id][k - 1].custoBolso);
      perto(Math.max(...cs), Math.min(...cs), 0.01, `custoBolso no mês ${k} (extra ${extra})`);
    }
    lista.forEach(c => perto(S.resumo(g[c.id]).custoBolso, S.resumo(g.ref).custoBolso, 0.01, 'resumo.custoBolso'));
    lista.forEach(c => assert(g[c.id].every(m => m.aporte >= S.APORTE_MIN), `aporte de ${c.id} não passa de -0,10`));
    // referência: sem extras e sem FGTS; o extra todo vai para o aporte
    assert(g.ref.every(m => m.amortBolso === 0 && m.amortFGTS === 0));
    perto(g.ref[0].aporte, extra, 1e-9, 'aporte da referência');
    perto(g.ref[0].orcamento, g.ref[0].encargo + extra, 1e-9, 'orçamento = encargo da referência + extra');
  }

  // quem quita antes continua até a quitação mais tardia, com aporte = orçamento
  const g = rodar(3000);
  const rt = S.resumo(g.tudo), rr = S.resumo(g.ref);
  assert(rt.quitacao < rr.quitacao, 'amortizar tudo quita antes da referência');
  const depois = g.tudo.filter(m => m.competencia > rt.quitacao);
  assert(depois.length > 0);
  depois.forEach(m => { assert.strictEqual(m.saldoInicial, 0); assert.strictEqual(m.encargo, 0); assert.strictEqual(m.prazoRestante, 0); perto(m.aporte, m.orcamento, 1e-9, 'aporte = orçamento'); });
  assert.strictEqual(g.tudo[g.tudo.length - 1].competencia, g.ref[g.ref.length - 1].competencia);
  assert(rt.usoFGTS > 0 && rr.usoFGTS === 0);

  // FGTS: um cenário não altera o de outro; uso no 1º mês permitido e de novo só 24 meses depois
  const so = S.projetarGrupo(estado, [grupo.ref, grupo.inv], orcamentoCom(3000), pp);
  assert.deepStrictEqual(g.inv.map(m => m.fgtsSaldo), so.inv.map(m => m.fgtsSaldo));
  assert.notDeepStrictEqual(g.tudo.map(m => m.fgtsSaldo), g.inv.map(m => m.fgtsSaldo));
  const usos = g.tudo.filter(m => m.amortFGTS > 0).map(m => m.competencia);
  assert.strictEqual(usos[0], '2030-03');
  if (usos[1]) assert.strictEqual(usos[1], '2032-03');
  perto(g.inv[0].fgtsSaldo, 10000 * (1.03 ** (1 / 12)) * 1.002 + 500, 1e-6, 'FGTS rende e recebe depósito');
  const dez = g.inv.findIndex(m => m.competencia === '2030-12');
  perto(g.inv[dez].fgtsSaldo, g.inv[dez - 1].fgtsSaldo * (1.03 ** (1 / 12)) * 1.002 + 1000, 1e-6, 'dezembro deposita em dobro (13º)');

  // depósito com data: vale o último com desde ≤ mês; antes do 1º, o 1º
  const depEst = { ...estado, fgts: { ...estado.fgts, deposito: 999, depositos: [{ desde: '2030-03', valor: 500 }, { desde: '2030-06', valor: 800 }] } };
  assert.deepStrictEqual(['2030-01', '2030-05', '2030-06', '2031-01'].map(c => S.depositoFGTS(depEst.fgts, c)), [500, 500, 800, 800]);
  assert.strictEqual(S.depositoFGTS({ deposito: 300 }, '2030-01'), 300);
  const pd = S.projetar(depEst, grupo.inv, orcamentoCom(0), prem), k6 = pd.findIndex(m => m.competencia === '2030-06');
  perto(pd[k6].fgtsSaldo, pd[k6 - 1].fgtsSaldo * (1.03 ** (1 / 12)) * 1.002 + 800, 1e-6, 'junho já com o depósito novo');
  perto(pd[k6 - 1].fgtsSaldo, pd[k6 - 2].fgtsSaldo * (1.03 ** (1 / 12)) * 1.002 + 500, 1e-6, 'maio com o antigo');

  // manual com usarFGTS: o 1º uso é digitado; depois, cada janela de 24 meses usa o saldo todo
  const pri = { amortBolso: 0, amortFGTS: 3000, resgate: 0, confirmado: true };
  const fgMan = usarFGTS => S.projetar(estado, { ...base, id: 'fm', regra: 'manual', usarFGTS, meses: { '2030-05': pri } }, null, prem).filter(m => m.amortFGTS > 0);
  assert.deepStrictEqual(fgMan(false).map(m => m.competencia), ['2030-05']);
  const rep = fgMan(true);
  assert.deepStrictEqual(rep.slice(0, 3).map(m => m.competencia), ['2030-05', '2032-05', '2034-05']);
  perto(rep[1].amortFGTS, rep[1].fgtsDisponivel, 1e-9, 'janela seguinte usa o saldo todo');
  assert.deepStrictEqual(S.projetar(estado, { ...base, id: 'fm', regra: 'manual', usarFGTS: true, meses: {} }, null, prem).filter(m => m.amortFGTS > 0), [], 'sem 1º uso, nada');

  // janela do FGTS
  const j = S.janelaFGTS(g.inv);
  assert.strictEqual(j.abreEm, '2030-03');
  assert.strictEqual(j.ultimoUso, '2028-03');
  assert(j.saldoProjetado > 10000);
  assert.strictEqual(S.janelaFGTS(S.projetar({ ...estado, fgts: undefined }, grupo.ref, null, prem)), null);

  // FGTS antes de 24 meses é recusado; depois, aceito; acima do saldo, recusado
  const orc = orcamentoCom(700), man = { ...base, id: 'm', regra: 'manual', meses: {} };
  assert.throws(() => S.definirMes(estado, man, orc, prem, '2030-01', { amortFGTS: 1000 }), /FGTS bloqueado/);
  assert.throws(() => S.definirMes(estado, man, orc, prem, '2030-03', { amortFGTS: 1e6 }), /FGTS insuficiente/);
  const m1 = S.definirMes(estado, man, orc, prem, '2030-03', { amortFGTS: 5000 });
  assert.strictEqual(m1.meses['2030-03'].confirmado, true);
  assert.strictEqual(man.meses['2030-03'], undefined, 'não altera o original');
  assert.throws(() => S.definirMes(estado, m1, orc, prem, '2032-02', { amortFGTS: 100 }), /bloqueado/);
  assert(S.validarMes(estado, m1, orc, prem, '2032-03', { amortFGTS: 100 }).ok);
  // aporte negativo é recusado (amortiza mais que o orçamento)
  assert.throws(() => S.definirMes(estado, man, orc, prem, '2030-02', { amortBolso: 5000 }), /Aporte negativo/);
  assert(S.validarMes(estado, man, orc, prem, '2030-02', { amortBolso: 700 }).ok);
  // mês não confirmado conta 0
  const naoConf = S.projetar(estado, { ...man, meses: { '2030-02': { amortBolso: 700, confirmado: false } } }, orc, prem);
  assert.strictEqual(naoConf[1].amortBolso, 0);

  // valor de corte: amortBolso vira o corte e a sobra vai para o aporte
  const g7 = rodar(700), mc = g7.man.find(m => m.competencia === '2030-02');
  assert(mc.amortBolso < 700 && mc.amortBolso > 600, `corte ${mc.amortBolso}`);
  perto(mc.amortBolso, mc.valorCorte, 0.011, 'amortBolso = corte');
  perto(mc.aporte, 700 - mc.amortBolso, 1e-9, 'sobra no aporte');
  const semCorte = S.projetar(estado, { ...grupo.man, usarValorDeCorte: false }, orcamentoCom(700), prem, { base: S.baseReferencia(estado, prem) });
  assert.strictEqual(semCorte[1].amortBolso, 700);
  assert.strictEqual(semCorte[1].prazoRestante, mc.prazoRestante, 'mesmo prazo com e sem corte');
  assert(semCorte[1].saldoFinal < mc.saldoFinal);

  // prévia: sem gravar nada
  const vazio = { ...grupo.man, meses: {} };
  const pv = S.previa(estado, vazio, orc, prem, '2030-02', { amortBolso: 700 });
  assert(pv.mesesReduzidos > 0 && pv.mesesReduzidos < 10);
  perto(pv.sobraParaCarteira, 700 - mc.amortBolso, 1e-9, 'sobra da prévia');
  perto(pv.valorDeCorte, mc.valorCorte, 1e-9, 'corte da prévia');
  assert(pv.novaQuitacao < S.resumo(g7.ref).quitacao && pv.novaParcela > 0);
  assert.strictEqual(pv.patrimonio, null);
  assert.deepStrictEqual(vazio.meses, {});
  assert.strictEqual(S.previa(estado, vazio, orc, prem, '2030-02', { amortBolso: 0 }).mesesReduzidos, 0);

  // campos por mês (item 6)
  ['saldoAposParcela', 'pmt', 'prazoRestante', 'encargo', 'orcamento', 'aporte', 'fgtsSaldo', 'amortBolso', 'amortFGTS', 'resgate'].forEach(k => assert(k in g7.man[0], k));

  // seguros pagos entram na divergência quando existem
  const lr = { meses: [{ competencia: '2030-01', vencimento: '2030-01-10', saldoAnt: 1000, calc: { trMes: 0.001, mip: 5, dfi: 15 } }], estado: { saldo: 900 } };
  assert.strictEqual(S.mesesReais(lr, [])[0].seguros, 20);
  assert.strictEqual(S.mesesReais(lr, [], [{ competencia: '2030-01', seguros: 22.5 }])[0].seguros, 22.5);
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
