// Testes da Fase 7 (painéis Status/Comparativo e séries dos gráficos). Rodar: node tests/paineis.test.js
// Números inventados; a parte do histórico real lê seed/seed.json e é pulada sem ele.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const perto = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);
const soma = (l, f) => l.reduce((s, x) => s + f(x), 0);
const json = x => JSON.parse(JSON.stringify(x));

(async () => {
  const E = await import('../src/engine.js');
  const S = await import('../src/scenario.js');
  const PN = await import('../src/paineis.js');
  const D = await import('../src/db.js');

  // ---- dados inventados: contrato de 100 mil em 120 meses, TR constante, 8 parcelas e 2 extras
  const config = { contrato: { dataAssinatura: '2029-06-10', valorFinanciado: 100000, prazoOriginal: 120, taxaNominalAA: 0.12, diaVencimento: 10, taxaOperacional: 25, valorAvaliacao: 150000 },
    inicial: { entradaDinheiro: 20000, entradaFGTS: 10000, documentacao: 3000 } };
  const prem = { id: 'p', trMensal: { modo: 'curva', pontos: [{ desde: '2029-01', valor: 0.002 }] }, selic: { atual: 0.1375, longoPrazo: 0.105, anosAteLongoPrazo: 3 },
    cdiSpread: -0.001, pctCDI: 1, isentoIR: false, ipcaAA: 0.04, valorizacaoImovelAA: 0.05, custoVendaPct: 0.06, irGanhoCapitalImovel: true,
    mipTaxa: 0.0001, dfiTaxa: 0.0001, fgtsRendAA: 0.03 };
  const i = 0.01, tr = 0.002;
  let saldo = 100000, prazo = 120, pmt = E.price(saldo, prazo, i);
  const parcelas = [], extras = [];
  for (let k = 0; k < 8; k++) {
    const venc = E.somaMeses('2029-07-10', k), aj = pmt * (1 + tr), corr = saldo * (1 + tr);
    saldo = corr - (aj - corr * i); pmt = aj; prazo -= 1;
    parcelas.push({ competencia: venc.slice(0, 7), vencimento: venc, pago: aj + 30, aj, saldoApos: saldo, origemDados: 'lancamento' });
    if (k === 2 || k === 5) { // extra no dia do vencimento (sem pro rata): bolso no 3º mês, FGTS no 6º
      const e = { data: venc, valor: k === 2 ? 5000 : 2000, origem: k === 2 ? 'bolso' : 'fgts' };
      saldo -= e.valor; ({ nNovo: prazo, pmtNovo: pmt } = E.prazoAposAmortizacao(saldo, pmt, i)); extras.push(e);
    }
  }
  const fgtsReal = [{ data: '2029-12-01', tipo: 'saldo-informado', valor: 8000 }, { data: '2029-12-10', tipo: 'uso-amortizacao', valor: 2000 }];
  const meses = Object.fromEntries(Array.from({ length: 200 }, (_, k) => [E.somaMeses('2030-03-01', k).slice(0, 7), { extra: 1500, confirmado: true }]));
  const orcamentos = [{ id: 'o', nome: 'Padrão', meses }];
  const base = { orcamentoId: 'o', premissasId: 'p', usarValorDeCorte: false, meses: {} };
  const cenarios = [{ ...base, id: 'ref', nome: 'Referência', regra: 'referencia', fixo: true }, { ...base, id: 'tudo', nome: 'Tudo', regra: 'amortizarTudo' },
    { ...base, id: 'inv', nome: 'Investir', regra: 'investirTudo' }, { ...base, id: 'meio', nome: 'Meio', regra: { dividir: 0.5 }, planoAtivo: true }];
  const pp = { p: prem };
  // versões do plano ativo: uma feita com 3 parcelas (a primeira) e outra com 7 (a do mês anterior)
  const versao = (n, criadaEm) => {
    const cenario = cenarios[3], ps = parcelas.slice(0, n), xs = extras.filter(e => e.data <= ps.at(-1).vencimento);
    const estado = S.estadoReal({ config, parcelas: ps, extras: xs, premissas: prem, fgtsReal });
    const ms = S.projetarGrupo(estado, cenarios, orcamentos[0], pp)[cenario.id];
    return { id: 'v' + n, ...S.criarVersao({ cenario, motivo: 'lancamento-real', estado, orcamento: orcamentos[0], premissas: prem, agora: criadaEm, meses: ms }) };
  };
  const raw = { config, parcelas, extras, fgtsReal, premissas: [prem], orcamentos, cenarios, versoes: [versao(7, '2030-02-01'), versao(3, '2029-10-01')], hoje: '2030-03-01' };

  // ---- Status: números batem com uma soma manual da linha real
  const st = PN.painelStatus(raw);
  const estReal = S.estadoReal({ config, parcelas, extras, premissas: prem, fgtsReal });
  const real = estReal.linhaReal;
  // FGTS: parte do saldo informado mais recente (saldo inicial da Config ou lançado), desconta usos e cresce mês a mês
  // até o mês anterior à projeção (2030-03): rendimento de 3% a.a. e depósito, dezembro em dobro
  const r = 1.03 ** (1 / 12);
  const fgCfg = (data, dep) => S.estadoReal({ config: { ...config, inicial: { ...config.inicial, saldoFGTSAtual: 9000, dataSaldoFGTS: data, depositoMensalFGTS: dep } }, parcelas, extras, premissas: prem, fgtsReal }).fgts.saldo;
  perto(estReal.fgts.saldo, 6000 * r * r, 1e-6, 'lançado 2029-12 menos o uso, + jan e fev');
  perto(fgCfg('2030-01-15', 0), 9000 * r, 1e-6, 'saldo inicial de jan + fev');
  perto(fgCfg('2030-01-15', 100), 9000 * r + 100, 1e-6, 'com depósito');
  perto(fgCfg('2029-11-01', 100), (6000 * r + 100) * r + 100, 1e-6, 'lançado mais recente vence o saldo inicial');
  const comHist = S.estadoReal({ config: { ...config, inicial: { ...config.inicial, saldoFGTSAtual: 9000, dataSaldoFGTS: '2029-12-20', depositoMensalFGTS: 300,
    depositosFGTS: [{ desde: '2030-02', valor: 300 }, { desde: '2029-01', valor: 100 }] } }, parcelas, extras, premissas: prem, fgtsReal }).fgts;
  perto(comHist.saldo, (9000 * r + 100) * r + 300, 1e-6, 'jan com o depósito antigo, fev com o novo');
  perto(st.saldoAtual, real.estado.saldo, 1e-9, 'saldo');
  assert.strictEqual(st.prazoRestante, real.estado.prazo);
  const T = st.totalPago;
  perto(T.juros, soma(real.meses, m => m.calc.juros), 1e-6, 'juros');
  perto(T.seguros, soma(real.meses, m => m.calc.mip + m.calc.dfi), 1e-6, 'seguros');
  perto(T.taxas, soma(real.meses, m => m.calc.taxa), 1e-6, 'taxas');
  perto(T.principalDevolvido, 100000 - real.estado.saldo, 1e-6, 'principal devolvido');
  perto(T.parcelasEExtras, soma(real.meses, m => m.encargo) + soma(extras, e => e.valor), 1e-6, 'total pago');
  perto(T.juros + T.trPaga + T.seguros + T.taxas + T.principalDevolvido, T.parcelasEExtras, 0.05, 'conservação');
  perto(T.total, T.parcelasEExtras + 20000 + 10000 + 3000, 1e-6, 'total com entrada e documentação');
  perto(st.gastoPorOrigem.fgts, 10000 + 2000, 1e-9, 'FGTS');
  perto(st.gastoPorOrigem.bolso, T.total - 12000, 1e-6, 'bolso');
  perto(st.gastoPorOrigem.bolso + st.gastoPorOrigem.fgts, T.total, 1e-6, 'bolso + FGTS');
  perto(soma(Object.values(st.detalheOrigem.bolso), x => x), st.gastoPorOrigem.bolso, 1e-6, 'detalhe do bolso');
  perto(soma(st.composicao, c => c.valor), T.total, 0.05, 'composição soma o total');
  assert.strictEqual(st.trNoSaldo, 0);
  // parcela original = encargo do 2º vencimento (pago), atual = próxima parcela
  assert.strictEqual(st.parcela.original.competencia, '2029-08');
  perto(st.parcela.original.encargo, parcelas[1].pago, 1e-9, 'parcela original');
  const prox = st.proximaParcela;
  perto(prox.amortizacao + prox.juros + prox.seguros + prox.taxa, prox.encargo, 0.03, 'próxima parcela quebrada');
  assert.strictEqual(prox.competencia, '2030-03'); assert.strictEqual(prox.vencimento, '2030-03-10');
  // série: reais seguidos do projetado
  assert.strictEqual(st.serie.filter(m => m.real).length, 8);
  assert(st.serie.slice(0, 8).every(m => m.real) && st.serie.slice(8).every(m => !m.real));
  perto(st.serie[7].saldo, real.estado.saldo, 1e-9, 'último saldo real');
  assert(st.serie.slice(0, 8).some(m => m.eventos.some(e => e.origem === 'fgts')) && st.serie.slice(0, 8).some(m => m.eventos.some(e => e.origem === 'bolso')));
  assert(st.serie.some(m => !m.real && m.eventos.some(e => e.tipo === 'amortizacao')));
  // marcos: primeira competência de cada faixa; saldo posicionado
  st.marcos.plano.forEach(m => assert.strictEqual(st.serie.find(x => x.faixa === m.faixa).competencia, m.competencia));
  st.marcos.plano.forEach(m => assert(st.serie.find(x => x.competencia === m.competencia).eventos.some(e => e.tipo === 'marco-faixa' && e.faixa === m.faixa)));
  assert(st.marcos.real.length >= 1 && st.marcos.plano.length >= st.marcos.real.length);
  assert(st.serieSaldo.reais.length === 8 && st.serieSaldo.plano.length > 0 && st.serieSaldo.referencia.length > 0);
  assert(st.quitacao.competencia < st.quitacaoReferencia.competencia, 'plano com extras quita antes');
  // extras feitas x contrato sem nenhuma extra: sem extra (TR constante, Price) quita no prazo original (1ª parcela 2029-07 + 119)
  const X = st.extras;
  assert.deepStrictEqual(X.lista.map(e => [e.valor, e.origem]), [[5000, 'bolso'], [2000, 'fgts']]);
  assert(X.lista.every(e => e.mesesReduzidos > 0));
  assert.strictEqual(X.total, 7000); assert.strictEqual(X.fgts, 2000); assert.strictEqual(X.bolso, 5000);
  assert.strictEqual(X.quitacaoSemExtras.competencia, '2039-06');
  assert.strictEqual(X.quitacaoComExtras.competencia, st.quitacaoReferencia.competencia);
  assert.strictEqual(X.mesesAMenos, soma(X.lista, e => e.mesesReduzidos), 'meses a menos = soma das reduções');
  assert(X.economizado.juros > 0 && X.economizado.tr > 0 && X.economizado.porReal > 0.5);
  const se = st.serieSaldo.semExtras;
  perto(se[1].saldo, st.serieSaldo.reais[1].saldo, 1e-9, 'antes da 1ª extra, igual ao real');
  assert(se[2].saldo > st.serieSaldo.reais[2].saldo + 4900, 'depois da extra, acima do real');
  assert.strictEqual(se.at(-1).competencia, '2039-06'); perto(se.at(-1).saldo, 0, 0.01, 'quita');
  assert.strictEqual(PN.painelStatus({ ...raw, extras: [] }).extras, null);
  // divergência: formato do item 4, contra a versão anterior e contra a primeira
  for (const contra of ['anterior', 'primeira']) {
    const dv = PN.painelStatus(raw, { contra }).divergencia;
    assert.strictEqual(dv.contra, contra);
    for (const x of [dv.mes, dv.acumulada]) {
      assert(x.modelo.length === 3 && x.modelo.every(l => typeof l.rotulo === 'string' && Number.isFinite(l.valor)));
      assert(Number.isFinite(x.execucao.planejado) && Number.isFinite(x.execucao.feito));
      perto(x.total, soma(x.modelo, l => l.valor) + x.execucao.planejado - x.execucao.feito, 1e-9, 'total da divergência');
    }
  }
  assert.strictEqual(PN.painelStatus(raw).divergencia.versao.criadaEm, '2030-02-01');
  assert.strictEqual(PN.painelStatus(raw, { contra: 'primeira' }).divergencia.versao.criadaEm, '2029-10-01');
  assert.strictEqual(PN.rotuloMes('2036-11'), 'nov/2036');

  // ---- serialização: as três funções voltam iguais de um JSON
  const cp = PN.painelComparativo(raw, 10, false), gr = PN.seriesGraficos(raw);
  assert.deepStrictEqual(json(st), st); assert.deepStrictEqual(json(cp), cp); assert.deepStrictEqual(json(gr), gr);

  // ---- comparativo: inflação muda TODO valor monetário, pelo fator
  const CAMPOS = ['patrimonio', 'saldoDevedor', 'carteira', 'custoBolso', 'fgtsUsado', 'jurosPagos', 'trPaga'];
  const monetarios = c => [...CAMPOS.map(k => [k, c[k]]), ...Object.entries(c.composicao).map(([k, v]) => ['composicao.' + k, v]),
    ...(c.economizado ? [['economizado.juros', c.economizado.juros], ['economizado.tr', c.economizado.tr]] : [])];
  for (const h of [5, 10, 15, 'quitacao']) {
    const a = PN.painelComparativo(raw, h, false), b = PN.painelComparativo(raw, h, true);
    assert.strictEqual(a.fator, 1); assert(b.fator > 1); perto(b.fator, 1.04 ** a.anos, 1e-12, 'fator = (1+IPCA)^anos');
    assert.strictEqual(a.cenarios.length, 4);
    let mudou = 0;
    a.cenarios.forEach((ca, k) => monetarios(ca).forEach(([nome, v], n) => {
      const w = monetarios(b.cenarios[k])[n][1];
      perto(w, v / b.fator, 1e-6, `${h} ${ca.id} ${nome}`);
      if (v !== 0) { assert.notStrictEqual(w, v, `${h} ${ca.id} ${nome} não mudou`); mudou++; }
    }));
    assert(mudou > 20);
    a.cenarios.forEach((ca, k) => { assert.deepStrictEqual(ca.quitacao, b.cenarios[k].quitacao); assert.strictEqual(ca.economizado?.anos, b.cenarios[k].economizado?.anos); });
    // o melhor é o de maior patrimônio; patrimônio = imóvel − dívida + carteira + FGTS
    const top = a.cenarios.reduce((x, y) => (y.patrimonio > x.patrimonio ? y : x));
    assert.strictEqual(a.melhor, top.id);
    a.cenarios.forEach(c => perto(c.patrimonio, c.composicao.imovelLiquido - c.composicao.divida + c.composicao.carteira + c.composicao.fgts, 1e-6, 'composição'));
    // custo do bolso igual em todos os cenários
    perto(Math.max(...a.cenarios.map(c => c.custoBolso)), Math.min(...a.cenarios.map(c => c.custoBolso)), 0.01, 'custo do bolso igual');
    assert.strictEqual(a.cenarios.find(c => c.referencia).economizado, null);
    a.cenarios.filter(c => !c.referencia).forEach(c => { assert(c.economizado.juros >= -1e-6); c.marcos.forEach(m => assert(m.mesesAntecipados == null || m.mesesAntecipados >= 0)); });
  }
  // quitação = a mais tardia do grupo
  const q = PN.painelComparativo(raw, 'quitacao', false);
  const tardia = q.cenarios.map(c => c.quitacao.competencia).sort().pop();
  assert.strictEqual(q.competencia, tardia);
  assert.strictEqual(q.cenarios.find(c => c.referencia).quitacao.competencia, tardia);
  const antes = q.cenarios.find(c => c.id === 'tudo');
  assert(antes.quitacao.competencia < tardia && antes.saldoDevedor === 0 && antes.carteira > 0, 'quem quita antes investe a parcela liberada');
  // hoje: sem melhor e mesmo patrimônio
  const h0 = PN.painelComparativo(raw, 'hoje', true);
  assert.strictEqual(h0.melhor, null); assert.strictEqual(h0.fator, 1);
  assert(h0.cenarios.every(c => c.patrimonio === h0.cenarios[0].patrimonio));
  // 15 anos passa da quitação do contrato (projeção estendida)
  assert(PN.painelComparativo(raw, 15, false).cenarios.every(c => c.saldoDevedor === 0));

  // ---- gráficos
  assert.strictEqual(gr.anos[0], 2030);
  perto(gr.rosca.total, soma(gr.rosca.itens, x => x.valor), 0.05, 'rosca');
  for (const g of ['saldoPorAno', 'saldoXCarteira']) { assert.strictEqual(gr[g].length, 4); gr[g].forEach(c => assert.strictEqual(c.saldo.length, gr.anos.length)); }
  assert.strictEqual(gr.saldoPorAno.find(c => c.id === 'ref').saldo.at(-1), 0);
  gr.composicaoParcela.forEach(c => { assert.strictEqual(c.anos.length, gr.anos.length); assert(c.anos.every(a => ['ano', 'amortizacao', 'juros', 'tr', 'segurosTaxas'].every(k => k in a))); });
  const refP = gr.composicaoParcela.find(c => c.id === 'ref').anos;
  const refMs = S.projetar(estReal, cenarios[0], null, prem);
  perto(soma(refP, a => a.amortizacao), soma(refMs, m => m.amortizacao), 1e-6, 'amortização da parcela por ano');
  // cruzamento: primeiro mês com carteira >= saldo
  const fake = [['2030-01', 100, 10], ['2030-02', 90, 50], ['2030-03', 80, 79], ['2030-04', 70, 80], ['2030-05', 60, 90]].map(([competencia, saldoFinal, carteiraLiquida]) => ({ competencia, saldoFinal, carteiraLiquida }));
  assert.strictEqual(PN.cruzamento(fake), 'abr/2030');
  assert.strictEqual(PN.cruzamento(fake.slice(0, 3)), null);
  assert.strictEqual(PN.cruzamento(fake.map(m => ({ ...m, carteiraLiquida: null }))), null);

  // ---- db, sw
  assert.strictEqual(typeof D.contagens, 'function');
  assert(/documentacao[^\n]*required/.test(fs.readFileSync(path.join(__dirname, '../src/ui/config.js'), 'utf8')), 'documentação obrigatória na Config');
  const sw = fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8');
  ['src/paineis.js', 'src/ui/dados.js', 'src/ui/comparativo.js'].forEach(f => assert(sw.includes(`'${f}'`), 'sw.js sem ' + f));
  assert(+sw.match(/VERSAO = 'v(\d+)'/)[1] >= 8, 'VERSAO sobe');

  // ---- histórico real (pulado sem seed)
  const arq = path.join(__dirname, '..', 'seed', 'seed.json');
  if (!fs.existsSync(arq)) return console.log('ok (sem seed: histórico real pulado)');
  const s = JSON.parse(fs.readFileSync(arq, 'utf8')).stores;
  const pr = s.premissas.map(p => ({ ...prem, ...p }));
  const dr = { config: s.config[0], parcelas: s.parcelasReais, extras: s.amortizacoesReais, fgtsReal: s.fgtsReal, premissas: pr.length ? pr : [prem],
    orcamentos: s.orcamentos, cenarios: s.cenarios, versoes: s.versoes };
  const sr = PN.painelStatus(dr), est = S.estadoReal({ ...dr, premissas: dr.premissas[0] }).linhaReal;
  perto(sr.saldoAtual, est.estado.saldo, 1e-9, 'saldo real');
  perto(sr.totalPago.juros, soma(est.meses, m => m.calc.juros), 1e-6, 'juros reais');
  perto(sr.totalPago.seguros, soma(est.meses, m => m.calc.mip + m.calc.dfi), 1e-6, 'seguros reais');
  perto(sr.totalPago.taxas, soma(est.meses, m => m.calc.taxa), 1e-6, 'taxas reais');
  perto(sr.totalPago.principalDevolvido, dr.config.contrato.valorFinanciado - est.estado.saldo, 1e-6, 'principal real');
  perto(sr.gastoPorOrigem.fgts, (dr.config.inicial.entradaFGTS ?? 0) + soma(dr.extras.filter(e => e.origem === 'fgts'), e => e.valor), 1e-6, 'FGTS real');
  perto(sr.totalPago.juros + sr.totalPago.trPaga + sr.totalPago.seguros + sr.totalPago.taxas + sr.totalPago.principalDevolvido, sr.totalPago.parcelasEExtras, 0.05, 'conservação real');
  assert.deepStrictEqual(json(sr), sr);
  const cr = PN.painelComparativo(dr, 'quitacao', true);
  assert.deepStrictEqual(json(cr), cr); assert(cr.cenarios.length >= 1);
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
