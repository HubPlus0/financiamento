// FGTS pagando parte das prestações. Rodar: node tests/fgtsPrestacao.test.js
// Números inventados; nenhum dado do histórico real.
const assert = require('assert');
const perto = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

(async () => {
  const E = await import('../src/engine.js');
  const S = await import('../src/scenario.js');
  const I = await import('../src/invest.js');
  const P = await import('../src/patrimonio.js');
  const D = await import('../src/db.js');

  const contrato = { taxaNominalAA: 0.12, valorAvaliacao: 150000, taxaOperacional: 25 };
  const prem = { trMensal: { modo: 'curva', pontos: [{ desde: '2030-01', valor: 0.002 }] }, mipTaxa: 0.0001, dfiTaxa: 0.0001, fgtsRendAA: 0.03 };
  const i = 0.01, n = 240, saldo0 = 100000, f = 1.03 ** (1 / 12) * 1.002; // FGTS rende 3% a.a. + TR
  const cfg = { contrato: { dataAssinatura: '2029-06-10', valorFinanciado: 120000, diaVencimento: 10 }, inicial: { entradaDinheiro: 20000, entradaFGTS: 10000, documentacao: 3000 } };
  const est = fgts => ({ competencia: '2030-01', saldo: saldo0, pmt: E.price(saldo0, n, i), prazo: n, fatorTR: 1, contrato, faixasVistas: [], cfg, fgts });
  const estado = est({ saldo: 20000, livreEm: '2030-03', deposito: 500, aviso: null });
  const base = { orcamentoId: 'o', premissasId: 'p', planoAtivo: false, usarValorDeCorte: false, meses: {} };
  const periodo = (extra = {}) => ({ modo: 'periodo', inicio: '2030-01', ...extra });
  const man = (fgtsPrestacao, extra = {}) => ({ ...base, id: 'm', regra: 'manual', fgtsPrestacao, ...extra });

  const orc = { id: 'o', meses: Object.fromEntries(Array.from({ length: 300 }, (_, k) => [E.somaMeses('2030-01-01', k).slice(0, 7), { extra: 1000, confirmado: true }])) };
  const cent = x => Math.floor(x * 100 + 1e-6) / 100;

  // ---- pedido: até 80% da prestação × 12, sai INTEIRO do FGTS no pedido e abate valor/12 por mês
  const ms = S.projetar(estado, man(periodo()), null, prem);
  const m0 = ms[0], teto0 = E.r2(E.r2(0.8 * m0.encargo) * 12), S1 = 20000 * f + 500;
  perto(m0.fgtsPedidoTeto, teto0, 1e-9, 'teto do pedido = 80% do encargo × 12');
  perto(m0.fgtsPedido, teto0, 1e-9, 'com saldo, pede o teto');
  perto(m0.fgtsSaldo, S1 - m0.fgtsPedido, 1e-6, 'o pedido sai todo do FGTS no 1º mês');
  perto(m0.fgtsPrestacao, m0.fgtsPedido / 12, 1e-9, 'abate 1/12 por mês');
  perto(m0.fgtsCredito, m0.fgtsPedido * 11 / 12, 1e-6, 'o resto fica como crédito');
  assert.strictEqual(m0.fgtsPrestacaoMes, 1);
  assert(m0.eventos.includes('fgts-pedido') && m0.eventos.includes('fgts-prestacao'));
  assert(ms.slice(0, 12).every(m => Math.abs(m.fgtsPrestacao - m0.fgtsPedido / 12) < 1e-6), 'parcelas iguais');
  perto(ms.slice(0, 12).reduce((s, m) => s + m.fgtsPrestacao, 0), m0.fgtsPedido, 1e-6, 'os 12 meses consomem o pedido');
  assert.strictEqual(ms[11].fgtsCredito, 0);
  assert(ms.slice(1, 12).every(m => m.fgtsPedido === 0));
  // os depósitos que entram durante o período NÃO são usados: ficam no FGTS
  perto(ms[1].fgtsSaldo, m0.fgtsSaldo * f + 500, 1e-6, 'depósito do 2º mês fica no FGTS');
  // base A+J e percentual editáveis; valor escolhido abaixo do teto
  const aj = S.projetar(estado, man(periodo()), null, { ...prem, fgtsPrestacaoBase: 'aj' })[0];
  perto(aj.fgtsPedido, E.r2(E.r2(0.8 * E.r2(aj.pmt)) * 12), 1e-9, '80% de A+J × 12');
  assert(aj.fgtsPedido < m0.fgtsPedido);
  perto(S.projetar(estado, man(periodo()), null, { ...prem, fgtsPrestacaoPct: 0.5 })[0].fgtsPedido, E.r2(E.r2(0.5 * m0.encargo) * 12), 1e-9, 'percentual editável');
  const v6 = S.projetar(estado, man(periodo({ valor: 6000 })), null, prem);
  assert.strictEqual(v6[0].fgtsPedido, 6000);
  perto(v6[0].fgtsPrestacao, 500, 1e-9, 'valor escolhido / 12');
  // FGTS na prestação não mexe no saldo devedor nem no prazo: é só quem paga
  const semFP = S.projetar(estado, man(undefined), null, prem);
  assert.deepStrictEqual(ms.map(m => [m.saldoFinal, m.prazoRestante, m.encargo]), semFP.map(m => [m.saldoFinal, m.prazoRestante, m.encargo]));
  assert(semFP.every(m => m.fgtsPrestacao === 0 && m.fgtsPrestacaoMes === null && m.fgtsPedido === 0));
  // prazo restante menor que 12: o período é o prazo restante
  const curto = { ...estado, saldo: 5000, pmt: E.price(5000, 5, i), prazo: 5 };
  const mc = S.projetar(curto, man(periodo()), null, prem);
  assert.strictEqual(mc.length, 5);
  perto(mc[0].fgtsPedidoTeto, E.r2(E.r2(0.8 * mc[0].encargo) * 5), 1e-9, 'teto com 5 meses');
  assert.deepStrictEqual(mc.map(m => m.fgtsPrestacaoMes), [1, 2, 3, 4, 5]);
  perto(mc.reduce((s, m) => s + m.fgtsPrestacao, 0), mc[0].fgtsPedido, 1e-6, 'consome tudo até quitar');

  // ---- 12 meses; sem renovar, para; renovando, pede de novo no mês seguinte, com o que acumulou
  assert.deepStrictEqual(ms.slice(0, 14).map(m => m.fgtsPrestacaoMes), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, null, null]);
  assert(ms.slice(12).every(m => m.fgtsPrestacao === 0 && m.fgtsPedido === 0));
  const ren = S.projetar(estado, man(periodo({ renovar: true })), null, prem);
  assert.deepStrictEqual(ren.slice(10, 26).map(m => m.fgtsPrestacaoMes), [11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2]);
  assert(ren[12].fgtsPedido > 0, 'renovação: novo pedido no 13º mês');
  // validação: sem FGTS informado, recusa; valor do pedido precisa ser positivo
  assert.deepStrictEqual(S.errosFGTSPrestacao(estado, periodo({ renovar: true })), []);
  assert.match(S.errosFGTSPrestacao(estado, periodo({ valor: 0 })).join(' '), /maior que zero/);
  assert.match(S.errosFGTSPrestacao(estado, { modo: 'periodo' }).join(' '), /primeiro pedido/);
  assert.throws(() => S.definirFGTSPrestacao(estado, man(undefined), periodo({ valor: -1 })), /maior que zero/);
  assert.deepStrictEqual(S.definirFGTSPrestacao(estado, man(undefined), periodo()).fgtsPrestacao, periodo());
  assert(!('fgtsPrestacao' in S.definirFGTSPrestacao(estado, man(periodo()), null)), 'null desliga');
  assert(!S.validarMes(estado, man(periodo({ valor: 0 })), orc, prem, '2030-02', {}).ok);
  const semFGTS = est(undefined);
  assert.match(S.errosFGTSPrestacao(semFGTS, periodo()).join(' '), /Sem saldo de FGTS/);
  assert(!S.validarMes(semFGTS, man(periodo()), orc, prem, '2030-01', {}).ok);
  assert(S.projetar(semFGTS, man(periodo()), null, prem).every(m => m.fgtsPrestacao === 0));

  // ---- saldo insuficiente: o pedido é só o saldo que já está lá; avisa
  const pouco = est({ saldo: 600, livreEm: null, deposito: 0, aviso: null });
  const mp = S.projetar(pouco, man(periodo({ renovar: true })), null, prem);
  perto(mp[0].fgtsPedido, cent(600 * f), 1e-9, 'pede o saldo todo');
  perto(mp[0].fgtsPrestacao, mp[0].fgtsPedido / 12, 1e-9, 'e abate 1/12 por mês');
  assert(mp[0].fgtsSaldo < 0.01);
  const v0 = S.validarMes(pouco, man(periodo({ renovar: true })), orc, prem, '2030-01', {});
  assert(v0.ok && /cobre só/.test(v0.avisos.join(' ')), 'aviso de saldo insuficiente');
  assert.deepStrictEqual(S.validarMes(pouco, man(periodo({ renovar: true })), orc, prem, '2030-02', {}).avisos, [], 'no meio do período, sem aviso');
  assert.match(S.validarMes(pouco, man(periodo({ renovar: true })), orc, prem, '2031-01', {}).avisos.join(' '), /Sem saldo de FGTS para o pedido/);
  assert.match(S.previa(pouco, man(periodo({ renovar: true })), orc, prem, '2030-01', {}, 1).avisos.join(' '), /cobre só/);
  assert.deepStrictEqual(S.validarMes(estado, man(periodo()), orc, prem, '2030-01', {}).avisos, [], 'com saldo, sem aviso');
  assert(!S.validarMes(estado, man(periodo({ valor: 6000 })), orc, prem, '2030-01', {}).avisos.length, 'valor escolhido abaixo do saldo: sem aviso');

  // ---- é preciso ter o valor antes: com só o depósito mensal, o 1º pedido é pequeno e o seguinte junta 12 meses
  const soDep = est({ saldo: 0, livreEm: null, deposito: 300, aviso: null });
  const md = S.projetar(soDep, man(periodo({ renovar: true })), null, prem);
  perto(md[0].fgtsPedido, 300, 1e-9, '1º pedido: só o depósito do mês');
  perto(md[0].fgtsPrestacao, 25, 1e-9, '300 / 12');
  assert(md[12].fgtsPedido > 3500, `2º pedido junta os depósitos do período (${md[12].fgtsPedido})`);
  perto(md[12].fgtsPrestacao, md[12].fgtsPedido / 12, 1e-9, '2º período');

  // ---- pedido real em curso (estado.fgts.credito): abate primeiro, e o pedido do cenário só vem depois
  const comCredito = est({ saldo: 20000, livreEm: null, deposito: 500, aviso: null, credito: { porMes: 400, meses: 3, restante: 1200 } });
  const mr = S.projetar(comCredito, man(periodo({ renovar: true })), null, prem);
  assert.deepStrictEqual(mr.slice(0, 5).map(m => [Math.round(m.fgtsPrestacao), m.fgtsPrestacaoMes, m.fgtsPedido > 0]), [[400, 1, false], [400, 2, false], [400, 3, false], [Math.round(mr[3].fgtsPedido / 12), 1, true], [Math.round(mr[3].fgtsPedido / 12), 2, false]]);
  assert(S.projetar(comCredito, man(undefined), null, prem).slice(0, 4).map(m => m.fgtsPrestacao).join() === '400,400,400,0', 'o real abate mesmo sem a opção no cenário');
  // dívida acaba no meio do período: o que sobrou do pedido volta ao FGTS
  const big = { id: 'o', meses: Object.fromEntries(Object.keys(orc.meses).map(c => [c, { extra: 30000, confirmado: true }])) };
  const qq = S.projetar(estado, { ...base, id: 'q', regra: 'amortizarTudo', usarFGTS: false, fgtsPrestacao: periodo() }, big, prem);
  const ql = qq.filter(m => m.saldoInicial > 0).at(-1), qa = qq[qq.indexOf(ql) - 1];
  assert(ql.fgtsPrestacaoMes < 12 && qa.fgtsCredito > 0, 'quita no meio do período');
  assert.strictEqual(ql.fgtsCredito, 0);
  perto(ql.fgtsSaldo, qa.fgtsSaldo * f + 500 * (ql.competencia.endsWith('-12') ? 2 : 1) + qa.fgtsCredito - ql.fgtsPrestacao, 1e-6, 'sobra volta ao FGTS');
  // o crédito ainda não abatido entra no patrimônio
  const premPat = { ...prem, valorizacaoImovelAA: 0.05, custoVendaPct: 0.06, irGanhoCapitalImovel: true };
  perto(P.patrimonioMes(cfg, premPat, m0) - P.patrimonioMes(cfg, premPat, { ...m0, fgtsCredito: 0 }), m0.fgtsCredito, 1e-6, 'crédito no patrimônio');

  // ---- mesmo orçamento: o aporte sobe exatamente o que o FGTS pagou; custo do bolso igual; carteira maior
  const prem2 = { ...prem, selic: { atual: 0.12, longoPrazo: 0.1, anosAteLongoPrazo: 3 }, trMensal: { modo: 'vinculadaSelic', piso: 0.085, fator: 0.03 }, cdiSpread: -0.001, pctCDI: 1, isentoIR: false };
  const grupo = [{ ...base, id: 'ref', regra: 'referencia', fixo: true }, { ...base, id: 'inv', regra: 'investirTudo' },
    { ...base, id: 'invfp', regra: 'investirTudo', fgtsPrestacao: periodo({ renovar: true }) }];
  const g = S.projetarGrupo(estado, grupo, orc, { p: prem2 });
  for (let k = 0; k < 24; k++) perto(g.invfp[k].aporte - g.inv[k].aporte, g.invfp[k].fgtsPrestacao, 1e-6, `aporte maior no mês ${k}`);
  assert(g.invfp[0].fgtsPrestacao > 0);
  for (const k of [12, 60, g.ref.length]) perto(g.invfp[k - 1].custoBolso, g.ref[k - 1].custoBolso, 0.01, `custoBolso igual no mês ${k}`);
  assert(g.invfp[24].carteiraLiquida > g.inv[24].carteiraLiquida);
  assert(g.invfp[24].fgtsSaldo < g.inv[24].fgtsSaldo);

  // uso contínuo desde já (renovando) convive com cenários sem janela de FGTS; o bolso liberado segue a regra do cenário
  const cont = periodo({ renovar: true });
  const grupo2 = [grupo[0], { ...base, id: 'tudo', regra: 'amortizarTudo', usarFGTS: false }, { ...base, id: 'tudofp', regra: 'amortizarTudo', usarFGTS: false, fgtsPrestacao: cont },
    { ...base, id: 'meio', regra: { dividir: 0.5 } }, { ...base, id: 'meiofp', regra: { dividir: 0.5 }, fgtsPrestacao: cont }];
  const g2 = S.projetarGrupo(estado, grupo2, orc, { p: prem2 });
  const ativos = ms => ms.filter(m => m.saldoInicial > 0);
  assert(ativos(g2.tudofp).every(m => m.fgtsPrestacaoMes != null && m.amortFGTS === 0), 'contínuo até quitar, sem janelas');
  perto(g2.tudofp[0].amortBolso - g2.tudo[0].amortBolso, g2.tudofp[0].fgtsPrestacao, 1e-6, 'amortizar tudo: o liberado amortiza');
  perto(g2.tudofp[0].aporte, g2.tudo[0].aporte, 1e-6, 'amortizar tudo: aporte igual');
  perto(g2.meiofp[0].amortBolso - g2.meio[0].amortBolso, g2.meiofp[0].fgtsPrestacao / 2, 1e-6, 'dividir: metade amortiza');
  assert(ativos(g2.tudofp).length < ativos(g2.tudo).length, 'quita antes');
  for (const c of grupo2) perto(g2[c.id].at(-1).custoBolso, g2.ref.at(-1).custoBolso, 0.01, `custoBolso igual (${c.id})`);

  // ---- conservação em gastos e origem (FGTS × bolso)
  for (const c of grupo) {
    const gs = P.gastos(cfg, g[c.id]);
    perto(gs.diferenca, 0, 0.05, `conservação (${c.id})`);
    perto(gs.porOrigem.bolso + gs.porOrigem.fgts, gs.total, 1e-6, `bolso + FGTS = total (${c.id})`);
  }
  const gfp = P.gastos(cfg, g.invfp), gi = P.gastos(cfg, g.inv), usoP = g.invfp.reduce((s, m) => s + m.fgtsPrestacao, 0);
  perto(gfp.fgtsPrestacao, usoP, 1e-6, 'gastos.fgtsPrestacao');
  perto(gfp.porOrigem.fgts, 10000 + usoP, 1e-6, 'FGTS = entrada + prestações');
  perto(gfp.totalPago, gi.totalPago, 1e-6, 'o total pago não muda: muda só quem paga');
  perto(gi.porOrigem.bolso - gfp.porOrigem.bolso, usoP, 1e-6, 'o bolso paga menos o que o FGTS pagou');

  // ---- resumo e versão gravada
  const rs = S.resumo(g.invfp);
  perto(rs.usoFGTSPrestacao, usoP, 1e-9, 'resumo.usoFGTSPrestacao');
  perto(rs.usoFGTS, usoP, 1e-9, 'resumo.usoFGTS inclui as prestações');
  const ver = S.criarVersao({ cenario: grupo[2], motivo: 'criacao', estado, orcamento: orc, premissas: prem2, agora: 'x', meses: g.invfp });
  const casas = x => (String(x).split('.')[1] ?? '').length;
  assert(ver.meses.filter(m => m.fgtsPrestacaoMes).every(m => casas(m.fgtsPrestacao) <= 2 && casas(m.fgtsCredito) <= 2));
  assert(ver.meses[0].fgtsPedido > 0 && casas(ver.meses[0].fgtsPedido) <= 2 && !('fgtsPedido' in ver.meses[1]) && !('fgtsPedidoTeto' in ver.meses[0]));
  assert(casas(ver.resumo.usoFGTSPrestacao) <= 2);
  assert(ver.meses[0].fgtsPrestacao > 0 && !('fgtsPrestacao' in S.criarVersao({ cenario: grupo[1], motivo: 'criacao', estado, orcamento: orc, premissas: prem2, agora: 'x', meses: g.inv }).meses[0]), 'mês sem FGTS na prestação fica enxuto');

  // ---- automático: liga depois da última janela de amortização com FGTS e vai até a quitação
  const ext = { id: 'o', meses: Object.fromEntries(Object.entries(orc.meses).map(([c]) => [c, { extra: 3000, confirmado: true }])) };
  const tudo = { ...base, id: 't', regra: 'amortizarTudo', usarFGTS: true };
  const sa = S.projetar(estado, tudo, ext, prem), au = S.projetar(estado, { ...tudo, fgtsPrestacao: { modo: 'auto' } }, ext, prem);
  const ultAmort = au.filter(m => m.amortFGTS > 0).at(-1), k = au.indexOf(ultAmort), quit = au.filter(m => m.saldoInicial > 0).at(-1);
  assert(au[k + 1].fgtsLivreEm >= quit.competencia, 'depois da última janela, a próxima só abriria com a dívida quitada');
  assert.strictEqual(S.inicioAutoFGTSPrestacao(sa), au[k + 1].competencia);
  assert(au.slice(0, k + 1).every(m => m.fgtsPrestacao === 0), 'antes (e na) última janela, nada');
  assert(au.slice(k + 1, au.indexOf(quit) + 1).every(m => m.fgtsPrestacaoMes != null), 'depois, todo mês até quitar');
  assert(au[k + 1].fgtsPrestacao > 0);
  assert(sa.at(-1).fgtsSaldo > au.at(-1).fgtsSaldo, 'sem o automático o FGTS fica parado');
  perto(au[k + 1].amortBolso - sa[k + 1].amortBolso, au[k + 1].fgtsPrestacao, 1e-6, 'amortizar tudo: o bolso liberado amortiza');
  perto(au[k + 1].aporte, sa[k + 1].aporte, 1e-6, 'e o aporte fica igual');

  // sem extra do bolso, o FGTS amortiza a cada 24 meses; a última janela é a que deixa 24 meses ou menos de prazo
  const so = { ...base, id: 's', regra: 'investirTudo', usarFGTS: true, fgtsPrestacao: { modo: 'auto' } };
  const est300 = est({ saldo: 20000, livreEm: '2030-03', deposito: 300, aviso: null });
  const ja = S.projetar(est300, so, orc, prem), ua = ja.filter(m => m.amortFGTS > 0).at(-1);
  assert(ja.filter(m => m.amortFGTS > 0).length >= 3, 'várias janelas antes da última');
  assert(ua.prazoRestante <= 24, `a última janela deixa ${ua.prazoRestante} meses`);
  assert(ja.filter(m => m.amortFGTS > 0).slice(0, -1).every(m => m.prazoRestante > 24));
  assert.strictEqual(ja.find(m => m.fgtsPrestacao > 0).competencia, ja[ja.indexOf(ua) + 1].competencia);
  assert.strictEqual(S.inicioAutoFGTSPrestacao(S.projetar(est300, { ...so, usarFGTS: false, fgtsPrestacao: undefined }, orc, prem)), null, 'sem amortizar com FGTS e janela aberta, não liga');

  // ---- premissas da janela de 24 meses
  const amortFP = c => ({ ...base, id: 'a', regra: 'amortizarTudo', usarFGTS: true, fgtsPrestacao: periodo({ inicio: '2030-02', ...c }) });
  // não afeta (padrão): a janela de mar/2030 amortiza com o saldo que sobrou depois da prestação
  const na = S.projetar(estado, amortFP(), ext, prem), mar = na.find(m => m.competencia === '2030-03');
  assert(mar.amortFGTS > 0 && mar.fgtsPrestacao > 0);
  perto(mar.amortFGTS, mar.fgtsDisponivel, 1e-9, 'amortiza o que sobrou');
  // bloqueia durante: sem amortização com FGTS no período; recusa no validarMes
  const bl = S.projetar(estado, amortFP(), ext, { ...prem, fgtsPrestacaoJanela: 'bloqueiaDurante' });
  assert(bl.filter(m => m.fgtsPrestacaoMes).every(m => m.amortFGTS === 0));
  assert(bl.find(m => m.competencia === '2031-02').amortFGTS > 0, 'depois do período, a janela já aberta amortiza');
  assert.match(S.validarMes(estado, man(periodo()), orc, { ...prem, fgtsPrestacaoJanela: 'bloqueiaDurante' }, '2030-03', { amortFGTS: 100 }).erros.join(' '), /pagando prestações/);
  assert(S.validarMes(estado, man(periodo()), orc, prem, '2030-03', { amortFGTS: 100 }).ok, 'sem a premissa, pode');
  // reinicia no fim: a janela só abre 24 meses depois do fim do período
  const ri = S.projetar(estado, man(periodo()), null, { ...prem, fgtsPrestacaoJanela: 'reiniciaNoFim' });
  assert.strictEqual(ri.find(m => m.competencia === '2031-01').fgtsLivreEm, '2032-12');
  assert.strictEqual(ri.find(m => m.competencia === '2030-06').fgtsLivreEm, '2030-03');

  // ---- lado real: parcela com a parte paga pelo FGTS, saldo real do FGTS e gastos
  const config = { contrato: { dataAssinatura: '2030-01-10', valorFinanciado: 100000, prazoOriginal: 240, taxaNominalAA: 0.12, diaVencimento: 10, taxaOperacional: 25, valorAvaliacao: 150000 },
    inicial: { entradaDinheiro: 20000, entradaFGTS: 10000, documentacao: 3000 } };
  const pr = { mipTaxa: 0.0001, dfiTaxa: 0.0001 };
  const lin = { meses: [{ vencimento: '2030-03-10', fatorTR: 1, calc: { trMes: 0.001 } }], extrasFinais: [], estado: { saldo: 90000, pmt: 1000, prazo: 200 } };
  const passo = E.passoMes({ saldo: 90000, pmt: 1000 }, { tr: 0.002, i });
  const lp = E.lancarParcela(lin, { vencimento: '2030-04-10', pago: 1100, saldoApos: passo.saldoFinal, fgtsPrestacao: 880 }, config, pr);
  assert.strictEqual(lp.registro.fgtsPrestacao, 880);
  assert.deepStrictEqual(lp.avisos, []);
  assert.match(E.lancarParcela(lin, { vencimento: '2030-04-10', pago: 1100, saldoApos: passo.saldoFinal, fgtsPrestacao: 900 }, config, pr).avisos.join(' '), /acima de 80%/);
  assert(!('fgtsPrestacao' in E.lancarParcela(lin, { vencimento: '2030-04-10', pago: 1100, saldoApos: passo.saldoFinal }, config, pr).registro));
  // replay leva a parte do FGTS para a linha real; gastos separa a origem e mantém a conservação
  const aj0 = E.price(100000, 240, i);
  const parcelas = ['2030-02', '2030-03', '2030-04'].map((c, k) => ({ competencia: c, vencimento: c + '-10', aj: aj0, ...(k && { fgtsPrestacao: 500 }) }));
  const lr = E.replayHistorico(config, parcelas, [], pr);
  assert.deepStrictEqual(lr.meses.map(m => m.fgtsPrestacao), [0, 500, 500]);
  const real = P.linhaDoReal(lr, []), gr = P.gastos(config, real);
  assert.strictEqual(gr.fgtsPrestacao, 1000);
  perto(gr.porOrigem.fgts, 10000 + 1000, 1e-9, 'FGTS real = entrada + prestações');
  perto(gr.diferenca, 0, 0.05, 'conservação na linha real');
  // pedido real: o valor inteiro sai do FGTS na data do pedido; a janela de 24 meses só conta o pedido com 'reiniciaNoFim',
  // a partir do fim do período
  const fr = [{ data: '2030-01-01', tipo: 'saldo-informado', valor: 9000 }, { data: '2030-02-10', tipo: 'uso-amortizacao', valor: 3000 },
    { data: '2030-02-15', tipo: 'uso-prestacao', valor: 6000, meses: 12 }];
  assert.strictEqual(I.saldoFGTSReal(fr), 9000 - 3000 - 6000);
  assert.strictEqual(I.proximoUsoFGTS(fr), '2032-02-10');
  assert.strictEqual(I.proximoUsoFGTS(fr, 'reiniciaNoFim'), '2033-02-15');
  assert(I.podeUsarFGTS(fr, '2032-03-01') && !I.podeUsarFGTS(fr, '2032-03-01', 'reiniciaNoFim'));
  // crédito em curso: o 1º vencimento depois do pedido já abate; parcela sem o valor informado conta valor/meses
  assert.deepStrictEqual(I.creditoFGTSPrestacao(fr, parcelas), { porMes: 500, meses: 10, restante: 5000 });
  assert.deepStrictEqual(I.creditoFGTSPrestacao(fr, parcelas.map(({ fgtsPrestacao, ...p }) => p)), { porMes: 500, meses: 10, restante: 5000 });
  assert.strictEqual(I.creditoFGTSPrestacao(fr.slice(0, 2), parcelas), null);
  const er = S.estadoReal({ config, parcelas, extras: [], premissas: { ...prem, ...pr }, fgtsReal: fr });
  assert.deepStrictEqual(er.fgts.credito, { porMes: 500, meses: 10, restante: 5000 });
  const pj = S.projetar(er, man(undefined), null, prem);
  assert.deepStrictEqual(pj.slice(0, 11).map(m => Math.round(m.fgtsPrestacao)), [500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 0], 'a projeção continua o pedido real');

  // ---- backup ida e volta com tudo o que é novo
  const stores = {
    config: [{ id: 'config', criadoEm: 'x', contrato: { valorFinanciado: 1000 }, inicial: {} }],
    parcelasReais: [{ id: 'p1', criadoEm: 'x', competencia: '2030-04', aj: 1, pago: 1100, fgtsPrestacao: 880 }],
    amortizacoesReais: [], fgtsReal: fr.map((m, k) => ({ id: 'f' + k, criadoEm: 'x', ...m })),
    premissas: [{ id: 'padrao', criadoEm: 'x', ...S.PADRAO_FGTS_PRESTACAO, fgtsPrestacaoJanela: 'reiniciaNoFim' }], orcamentos: [],
    cenarios: [{ id: 'c', criadoEm: 'x', regra: 'manual', meses: {}, fgtsPrestacao: { modo: 'periodo', inicio: '2030-04', renovar: true, valor: 5000 } }, { id: 'c2', regra: 'amortizarTudo', fgtsPrestacao: { modo: 'auto' } }],
    versoes: [],
  };
  const bk = JSON.parse(JSON.stringify(D.montarBackup(stores, '2030-01-01T00:00:00.000Z')));
  assert.deepStrictEqual(D.lerBackup(bk).stores, stores);
  // backup antigo, sem nada disso, continua valendo (sem migração: campos novos são opcionais)
  const velho = D.lerBackup({ app: 'financiamento', versaoSchema: 2, stores: { cenarios: [{ id: 'c', regra: 'manual', meses: {} }] } });
  assert(S.projetar(estado, velho.stores.cenarios[0], null, prem).every(m => m.fgtsPrestacao === 0));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
