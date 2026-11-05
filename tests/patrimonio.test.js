// Testes da Fase 6 (carteira, IR, TR vinculada, patrimônio, gastos). Rodar: node tests/patrimonio.test.js
// Números inventados; a parte do histórico real lê seed/seed.json e é pulada sem ele.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const perto = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

(async () => {
  const E = await import('../src/engine.js');
  const I = await import('../src/invest.js');
  const S = await import('../src/scenario.js');
  const P = await import('../src/patrimonio.js');
  const D = await import('../src/db.js');

  // ---- IR regressivo: R$ 1.000 → 1.100 (rendimento 100) com 100, 200, 400 e 800 dias
  const somaDias = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
  const lote = [{ comp: '2030-01', principal: 1000, valor: 1100 }], t0 = I.dataMes('2030-01', 5);
  [[100, 0.225], [200, 0.2], [400, 0.175], [800, 0.15]].forEach(([d, a]) =>
    perto(I.liquidoCarteira(lote, somaDias(t0, d), { dia: 5 }), 1100 - 100 * a, 1e-9, `IR com ${d} dias`));
  perto(I.liquidoCarteira(lote, somaDias(t0, 100), { dia: 5, isentoIR: true }), 1100, 1e-9, 'isento');

  // ---- resgate FIFO: o lote mais antigo sai primeiro; o valor pedido é líquido
  const tres = [{ comp: '2030-01', principal: 1000, valor: 1000 }, { comp: '2030-02', principal: 500, valor: 500 }];
  const r1 = I.resgatar(tres, 400, '2030-03-05', { dia: 5 });
  assert.deepStrictEqual(r1.lotes.map(l => [l.comp, Math.round(l.valor)]), [['2030-01', 600], ['2030-02', 500]]);
  const r2 = I.resgatar(tres, 1200, '2030-03-05', { dia: 5 });
  assert.deepStrictEqual(r2.lotes.map(l => [l.comp, Math.round(l.valor)]), [['2030-02', 300]]);
  // com rendimento: bruto suficiente para entregar o líquido
  const rend = [{ comp: '2030-01', principal: 1000, valor: 1200 }];
  const r3 = I.resgatar(rend, 500, somaDias(I.dataMes('2030-01', 5), 100), { dia: 5 });
  perto(r3.bruto - r3.ir, 500, 1e-9, 'líquido entregue');
  perto(r3.ir, r3.bruto * 200 * 0.225 / 1200, 1e-9, 'IR proporcional');
  assert.throws(() => I.resgatar(rend, 5000, '2030-03-05', { dia: 5 }), /carteira/);
  // rendimento mensal: ((1 + CDI)^(1/12) − 1) × pctCDI
  perto(I.render([{ comp: 'x', principal: 100, valor: 100 }], 0.12, 0.5)[0].valor, 100 * (1 + (1.12 ** (1 / 12) - 1) * 0.5), 1e-12, 'rendimento');

  // ---- Selic e TR vinculada
  const sel = { atual: 0.14, longoPrazo: 0.10, anosAteLongoPrazo: 2 };
  perto(I.selicDe(sel, '2030-01', '2030-01'), 0.14, 1e-12, 'selic no início');
  perto(I.selicDe(sel, '2031-01', '2030-01'), 0.12, 1e-12, 'selic na metade');
  perto(I.selicDe(sel, '2035-01', '2030-01'), 0.10, 1e-12, 'selic depois: constante');
  const lr = { meses: [{ competencia: '2030-01', calc: { trMes: 0.001 } }, { competencia: '2030-02', calc: { trMes: 0.003 } }] };
  const pp = S.premissasPadrao(lr);
  perto(S.trDe(pp.trMensal, '2030-01', pp.selic.atual), 0.002, 1e-12, 'TR com a Selic atual = média calibrada');
  assert.strictEqual(S.trDe(pp.trMensal, '2030-01', 0.085), 0);
  assert.strictEqual(S.trDe(pp.trMensal, '2030-01', 0.05), 0);
  assert(S.trDe(pp.trMensal, '2030-01', 0.14) > S.trDe(pp.trMensal, '2030-01', 0.13));

  // ---- projeção inventada com carteira
  const contrato = { taxaNominalAA: 0.12, valorAvaliacao: 150000, taxaOperacional: 25 };
  const cfg = { contrato: { dataAssinatura: '2029-06-10', valorFinanciado: 120000, diaVencimento: 10 },
    inicial: { entradaDinheiro: 20000, entradaFGTS: 10000, documentacao: 3000 } };
  const prem = { trMensal: { modo: 'vinculadaSelic', piso: 0.085, fator: 0.03 }, selic: { atual: 0.1375, longoPrazo: 0.105, anosAteLongoPrazo: 3 },
    cdiSpread: -0.001, pctCDI: 1, isentoIR: false, ipcaAA: 0.04, valorizacaoImovelAA: 0.05, custoVendaPct: 0.06, irGanhoCapitalImovel: true,
    mipTaxa: 0.0001, dfiTaxa: 0.0001, fgtsRendAA: 0.03 };
  const n = 120, saldo0 = 100000, i = 0.01;
  const estado = { competencia: '2030-01', saldo: saldo0, pmt: E.price(saldo0, n, i), prazo: n, fatorTR: 1, contrato, faixasVistas: [], cfg,
    fgts: { saldo: 8000, livreEm: '2030-03', deposito: 300, aviso: null } };
  const orc = { id: 'o', meses: Object.fromEntries(Array.from({ length: 200 }, (_, k) => [E.somaMeses('2030-01-01', k).slice(0, 7), { extra: 1500, confirmado: true }])) };
  const base = { orcamentoId: 'o', premissasId: 'p', planoAtivo: false, usarValorDeCorte: false, meses: {} };
  const lista = [{ ...base, id: 'ref', regra: 'referencia', fixo: true }, { ...base, id: 'tudo', regra: 'amortizarTudo' },
    { ...base, id: 'inv', regra: 'investirTudo' }, { ...base, id: 'meio', regra: { dividir: 0.5 } }];
  const g = S.projetarGrupo(estado, lista, orc, { p: prem });

  // custoBolso igual entre os cenários com a carteira ativa; a carteira só cresce no "investir tudo"
  const len = g.ref.length;
  for (const k of [12, 60, len]) {
    const cs = lista.filter(c => c.regra !== 'referencia').map(c => g[c.id][k - 1].custoBolso); // a referência não investe o extra
    perto(Math.max(...cs), Math.min(...cs), 0.01, `custoBolso no mês ${k}`);
  }
  assert(g.inv.every(m => m.carteiraBruta > 0 && m.carteiraLiquida <= m.carteiraBruta + 1e-9));
  assert(g.tudo[0].carteiraBruta < g.inv[0].carteiraBruta, 'amortizar tudo investe menos no começo');

  // conservação em cada cenário: juros + trPaga + seguros + taxas + principalDevolvido = totalPago
  for (const c of lista) {
    const gs = P.gastos(cfg, g[c.id]);
    perto(gs.diferenca, 0, 0.05, `conservação (${c.id})`);
    perto(gs.juros + gs.trPaga + gs.seguros + gs.taxas + gs.principalDevolvido, gs.totalPago, 0.05, `soma (${c.id})`);
    perto(gs.principalDevolvido, saldo0, 1e-6, 'quitado: devolveu o saldo todo');
    // a TR derivada do saldo bate com a TR do modelo (ΣsaldoCorrigido − saldoInicial), salvo centavos de arredondamento
    const trModelo = g[c.id].reduce((s, m) => s + m.saldoCorrigido - m.saldoInicial, 0);
    perto(gs.trPaga, trModelo, 5, `TR derivada x modelo (${c.id})`);
    perto(gs.porOrigem.bolso + gs.porOrigem.fgts, gs.total, 1e-6, 'bolso + FGTS = total');
  }
  // por origem: FGTS = entrada com FGTS + amortizações com FGTS
  const gt = P.gastos(cfg, g.tudo);
  perto(gt.porOrigem.fgts, 10000 + g.tudo.reduce((s, m) => s + m.amortFGTS, 0), 1e-6, 'origem FGTS');
  assert(gt.porOrigem.fgts > 10000);

  // economizado: amortizar tudo quita antes e paga menos juros que a referência
  const ec = P.economizado(g.tudo, g.ref, prem);
  assert(ec.juros > 0 && ec.tr > 0 && ec.meses > 0);
  perto(ec.anos, ec.meses / 12, 1e-12, 'anos');
  assert(ec.fator > 1);
  const ec0 = P.economizado(g.ref, g.ref, prem);
  assert.strictEqual(ec0.meses, 0); perto(ec0.juros, 0, 1e-9, 'referência não economiza');

  // patrimônio = venda líquida − saldo + carteira líquida + FGTS
  const m = g.inv[59], data = I.dataMes(m.competencia, 10);
  const v = P.venda(cfg, prem, data);
  perto(v.valorMercado, 150000 * 1.05 ** ((Date.parse(data) - Date.parse('2029-06-10')) / 864e5 / 365.25), 1e-6, 'valor de mercado');
  perto(v.irImovel, 0.15 * Math.max(0, v.valorMercado - v.custoVenda - (150000 + 3000)), 1e-9, 'IR do imóvel');
  perto(P.patrimonioMes(cfg, prem, m), v.liquida - m.saldoFinal + m.carteiraLiquida + (m.fgtsSaldo ?? 0), 1e-6, 'patrimônio do mês');
  assert.strictEqual(P.venda(cfg, { ...prem, irGanhoCapitalImovel: false }, data).irImovel, 0);
  assert.strictEqual(D.valorCompra, P.valorCompra); // db.js reexporta
  assert.strictEqual(P.valorCompra(cfg), 150000);

  // horizontes: fator = (1 + IPCA)^anos; quitação por último
  const hs = P.horizontes(estado, g.inv, prem, [0, 5, 9]);
  assert.deepStrictEqual(hs.map(h => h.anos).slice(0, 3), [0, 5, 9]);
  perto(hs[1].fator, 1.04 ** 5, 1e-12, 'fator 5 anos');
  assert.strictEqual(hs.at(-1).rotulo, 'quitacao');
  assert(hs.every(h => h.patrimonio != null));

  // prévia traz patrimônio, delta e fator; amortizar a mais com a carteira vazia é negativo no mês e recusado
  const man = { ...base, id: 'man', regra: 'manual' };
  const pv = S.previa(estado, man, orc, prem, '2030-02', { amortBolso: 1000, extra: 1500 }, 10);
  assert(Number.isFinite(pv.patrimonio) && Number.isFinite(pv.deltaPatrimonio));
  perto(pv.fator, 1.04 ** 10, 1e-12, 'fator da prévia');
  assert(pv.horizonte === 10);

  // validarMes recusa resgate acima da carteira líquida; aceita dentro dela
  const comInv = { ...man, meses: { '2030-02': { amortBolso: 0, amortFGTS: 0, resgate: 0, confirmado: true } } };
  const proj = S.projetar(estado, man, orc, prem, { base: S.baseReferencia(estado, prem), ate: '2030-12' });
  const disp = proj.find(x => x.competencia === '2030-09').carteiraDisponivel;
  assert(disp > 0);
  assert(!S.validarMes(estado, comInv, orc, prem, '2030-09', { resgate: disp + 100, extra: 1500 }).ok);
  assert(S.validarMes(estado, comInv, orc, prem, '2030-09', { resgate: disp / 2, extra: 1500 }).ok);
  assert(!S.validarMes(estado, comInv, orc, prem, '2030-01', { resgate: 1, extra: 1500 }).ok, 'carteira vazia no 1º mês');
  // o resgate sai da carteira: carteira cai e o saldo devedor também
  const rs = S.projetar(estado, { ...man, meses: { '2030-09': { amortBolso: 0, amortFGTS: 0, resgate: disp / 2, confirmado: true } } }, orc, prem, { base: S.baseReferencia(estado, prem), ate: '2030-12' });
  const a = proj.find(x => x.competencia === '2030-09'), b = rs.find(x => x.competencia === '2030-09');
  assert(b.carteiraLiquida < a.carteiraLiquida && b.saldoFinal < a.saldoFinal);
  perto(a.saldoFinal - b.saldoFinal, disp / 2, 1e-6, 'resgate amortiza o valor líquido pedido');

  // ---- linha real do seed (pulada sem seed)
  const arq = path.join(__dirname, '..', 'seed', 'seed.json');
  if (!fs.existsSync(arq)) return console.log('ok (sem seed: linha real pulada)');
  const esp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'esperado.json'), 'utf8')).competencias;
  const st = JSON.parse(fs.readFileSync(arq, 'utf8')).stores;
  const config = st.config[0], premReal = { ...prem, ...st.premissas.find(p => p.id === 'padrao') };
  const est = S.estadoReal({ config, parcelas: st.parcelasReais, extras: st.amortizacoesReais, premissas: premReal, fgtsReal: st.fgtsReal });
  const real = P.linhaDoReal(est.linhaReal, st.amortizacoesReais);
  const gr = P.gastos(est.cfg, real);
  perto(gr.diferenca, 0, 0.05, 'conservação na linha real');
  // totalPago independente: encargos do replay + extras do cadastro
  perto(gr.totalPago, est.linhaReal.meses.reduce((s, x) => s + x.encargo, 0) + st.amortizacoesReais.reduce((s, e) => s + e.valor, 0), 1e-6, 'totalPago da linha real');
  perto(gr.principalDevolvido, config.contrato.valorFinanciado - est.saldo, 1e-6, 'principal devolvido');
  // a TR derivada do saldo da Caixa fica perto da TR do modelo (+ pró-rata das extras tardias): sanidade
  const trModelo = est.linhaReal.meses.reduce((s, x) => s + x.calc.saldoCorrigido - x.saldoAnt, 0);
  assert(Math.abs(gr.trPaga - trModelo) < 0.03 * trModelo, `TR real x modelo: ${gr.trPaga} vs ${trModelo}`);
  perto(gr.porOrigem.fgts, (config.inicial.entradaFGTS ?? 0) + st.amortizacoesReais.filter(e => e.origem === 'fgts').reduce((s, e) => s + e.valor, 0), 1e-6, 'FGTS real');
  // patrimônio de hoje = venda líquida − saldo + FGTS (sem carteira)
  const hoje = esp.hoje;
  const pat = P.patrimonioHoje(est, premReal, hoje);
  perto(pat, P.vendaLiquida(config, premReal, hoje) - est.saldo + (est.fgts.saldo ?? 0), 1e-6, 'patrimônio de hoje');
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
