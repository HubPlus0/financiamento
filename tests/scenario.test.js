// Testes da Fase 4. Rodar: node tests/scenario.test.js
// As partes com histórico real leem seed/seed.json e são puladas sem ele. Nenhum número do histórico real vive aqui.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const perto = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (tol ${tol})`);

(async () => {
  const E = await import('../src/engine.js');
  const S = await import('../src/scenario.js');

  // ---- números inventados
  const contrato = { taxaNominalAA: 0.12, valorAvaliacao: 150000, taxaOperacional: 25 };
  const prem = { trMensal: { modo: 'curva', pontos: [{ desde: '2030-01', valor: 0.002 }] }, mipTaxa: 0.0001, dfiTaxa: 0.0001 };
  const i = 0.01, n = 60, saldo0 = 50000;
  const estado = { competencia: '2030-01', saldo: saldo0, pmt: E.price(saldo0, n, i), prazo: n, fatorTR: 1, contrato, faixasVistas: [] };
  const plano = { id: 'c1', meses: {} };

  // curva: vale o último ponto com desde ≤ mês
  const curva = { modo: 'curva', pontos: [{ desde: '2030-01', valor: 0.1 }, { desde: '2030-06', valor: 0.2 }] };
  assert.deepStrictEqual(['2029-12', '2030-05', '2030-06', '2031-01'].map(c => S.trDe(curva, c)), [0.1, 0.1, 0.2, 0.2]);
  assert.throws(() => S.trDe({ modo: 'inexistente' }, '2030-01'), /desconhecido/);
  assert.throws(() => S.trDe({ modo: 'vinculadaSelic', fator: 1 }, '2030-01'), /Selic/);

  // sem extras: quita no prazo restante, saldo final 0, campos da fase
  const sem = S.projetar(estado, plano, null, prem);
  assert.strictEqual(sem.length, n);
  assert.strictEqual(sem[0].competencia, '2030-01');
  assert.strictEqual(sem[n - 1].competencia, '2034-12');
  assert.strictEqual(sem[n - 1].saldoFinal, 0);
  assert.strictEqual(sem[n - 1].prazoRestante, 0);
  assert(sem.every(m => m.aporte === null && m.carteiraBruta === null && m.fgtsSaldo === null));
  perto(sem[0].saldoAposParcela, sem[0].saldoCorrigido - sem[0].amortizacao, 1e-9, 'saldoAposParcela');
  assert(sem[0].encargo > sem[0].pmt);
  assert(sem.some(m => m.eventos.some(e => e.startsWith('marco-faixa-'))));
  const r = S.resumo(sem);
  assert.strictEqual(r.quitacao, '2034-12');
  perto(r.totalTaxas, 25 * n, 1e-9, 'taxas');
  assert(r.totalJuros > 0 && r.totalTR > 0 && r.totalSeguros > 0);

  // extra não confirmada conta zero; confirmada reduz prazo e fica no mês, depois da parcela
  const extra = { '2030-03': { amortBolso: 5000, amortFGTS: 1000, resgate: 0, confirmado: true } };
  const nao = S.projetar(estado, { id: 'c', meses: { '2030-03': { ...extra['2030-03'], confirmado: false } } }, null, prem);
  assert.deepStrictEqual(nao, sem);
  const com = S.projetar(estado, { id: 'c', meses: extra }, null, prem);
  assert(com.length < n);
  assert.deepStrictEqual(com[2].eventos.slice(0, 2), ['extra', 'fgts']);
  perto(com[2].saldoFinal, com[2].saldoAposParcela - 6000, 1e-9, 'saldo depois da extra');
  assert.strictEqual(com[2].prazoRestante, com.length - 3);
  assert.strictEqual(com[0].saldoFinal, sem[0].saldoFinal);

  // extra que cobre o saldo quita no mês
  const tudo = S.projetar(estado, { id: 'c', meses: { '2030-02': { amortBolso: 1e6, confirmado: true } } }, null, prem);
  assert.strictEqual(tudo.length, 2);
  assert.strictEqual(tudo[1].saldoFinal, 0);
  assert.strictEqual(tudo[1].prazoRestante, 0);
  assert(tudo[1].amortBolso < 1e6);

  // versão imutável: criar outra com premissa diferente não muda a anterior
  const ag = '2030-01-01T00:00:00.000Z';
  const prem2 = { ...prem, trMensal: { modo: 'curva', pontos: [{ desde: '2030-01', valor: 0.01 }] } };
  const v1 = S.criarVersao({ cenario: plano, motivo: 'criacao', estado, orcamento: null, premissas: prem, agora: ag });
  const antes = JSON.stringify(v1);
  const v2 = S.criarVersao({ cenario: plano, motivo: 'edicao-premissa', estado, orcamento: null, premissas: prem2, agora: ag });
  prem.trMensal.pontos[0].valor = 0.5; // mexer na premissa original depois também não altera o snapshot
  assert.strictEqual(JSON.stringify(v1), antes);
  prem.trMensal.pontos[0].valor = 0.002;
  assert.notStrictEqual(v2.resumo.totalTR, v1.resumo.totalTR);
  assert.strictEqual(v1.cenarioId, 'c1');
  assert(!('linhaReal' in v1.estadoInicialSnapshot));
  assert.strictEqual(v1.premissasSnapshot.trMensal.pontos[0].valor, 0.002);

  // divergência: planejou 700, o real não amortizou nada, o resto bate: tudo em execução, modelo ≈ 0
  const mv = { competencia: '2030-01', trMes: 0.002, saldoInicial: 50000, mip: 5, dfi: 15, amortBolso: 700, amortFGTS: 0, resgate: 0, saldoFinal: 48000 };
  const mr = { competencia: '2030-01', saldoAnt: 50000, trMes: 0.002, seguros: 20, feito: 0, saldoFinal: 48700 };
  const d = S.divergencia(mr, mv);
  assert.deepStrictEqual(d.execucao, { planejado: 700, feito: 0 });
  d.modelo.forEach(l => assert(Math.abs(l.valor) <= 1, `${l.rotulo}: ${l.valor}`));
  perto(d.total, 700, 1, 'total');
  // TR diferente aparece no modelo, não na execução
  const dt = S.divergencia({ ...mr, trMes: 0.003, saldoFinal: 48700 + 50 }, mv);
  perto(dt.modelo[0].valor, 50, 1e-9, 'linha TR');
  assert.strictEqual(dt.execucao.feito, 0);
  // acumulada: mesma coisa em 2 meses (o mês 2 sem plano e o real sem diferença nova)
  const vers = { meses: [mv, { ...mv, competencia: '2030-02', amortBolso: 0, saldoInicial: 48000, saldoFinal: 47000 }] };
  const linhaFake = { meses: [{ competencia: '2030-01', vencimento: '2030-01-10', saldoAnt: 50000, calc: { trMes: 0.002, mip: 5, dfi: 15 } },
    { competencia: '2030-02', vencimento: '2030-02-10', saldoAnt: 48700, calc: { trMes: 0.002, mip: 5, dfi: 15 } }], estado: { saldo: 47700 } };
  const da = S.divergenciaAcumulada(linhaFake, [], vers);
  assert.deepStrictEqual(da.execucao, { planejado: 700, feito: 0 });
  da.modelo.forEach(l => assert(Math.abs(l.valor) <= 1, `acum ${l.rotulo}: ${l.valor}`));

  // premissas padrão
  const lr = { meses: [{ competencia: '2030-01', calc: { trMes: 0.001 } }, { competencia: '2030-02', calc: { trMes: 0.003 } }] };
  const pp = S.premissasPadrao(lr, { mipTaxa: 0.5, dfiTaxa: 0.6 });
  assert.strictEqual(pp.trMensal.modo, 'vinculadaSelic'); // padrão: TR vinculada, calibrada na média
  perto(S.trDe(pp.trMensal, '2030-01', pp.selic.atual), 0.002, 1e-12, 'média da TR');
  assert.strictEqual(pp.mipTaxa, 0.5);
  assert.strictEqual(pp.selic.atual, 0.1375);
  assert(Object.keys(pp.origem).includes('ipcaAA'));

  // ---- backtest com o histórico real (pulado sem seed)
  const arq = path.join(__dirname, '..', 'seed', 'seed.json');
  if (!fs.existsSync(arq)) return console.log('ok (sem seed: backtest pulado)');
  const esp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'seed', 'esperado.json'), 'utf8')).competencias;
  const st = JSON.parse(fs.readFileSync(arq, 'utf8')).stores;
  const config = st.config[0], premReal = st.premissas.find(p => p.id === 'padrao') ?? st.premissas[0];
  const parcelas = [...st.parcelasReais].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));
  const extras = st.amortizacoesReais;

  // Referência do assert: replay sem o ajuste de dias úteis e sem os valores que a Caixa informou nas extras
  // (saldoApos, ajNovo, prazoNovo): o ajNovo da Caixa difere da regra do modelo em centavos por extra e acumula
  // (~R$ 3 em 10 meses). A TR da curva sai deste mesmo replay. O assert compara modelo com modelo.
  const semCaixa = extras.map(({ saldoApos, ajNovo, prazoNovo, ...e }) => e);
  const cheio = E.replayHistorico(config, parcelas, semCaixa, premReal, { proRataAtraso: false });
  const real = E.replayHistorico(config, parcelas, extras, premReal);
  const corte = parcelas.filter(p => p.competencia <= esp.backtestUltimaReal);
  const prox = parcelas.find(p => p.competencia === esp.backtestPrimeira).vencimento;
  const estIni = S.estadoReal({ config, parcelas: corte, extras: extras.filter(e => e.data < prox), premissas: premReal, fgtsReal: st.fgtsReal });
  assert.strictEqual(estIni.competencia, esp.backtestPrimeira);

  // extras do período do backtest como amortização do cenário, no mês do vencimento que as precede
  const meses = {};
  for (const e of extras.filter(e => e.data >= prox)) {
    const comp = parcelas.filter(p => p.vencimento <= e.data).pop().competencia;
    const m = meses[comp] ??= { amortBolso: 0, amortFGTS: 0, resgate: 0, confirmado: true };
    m[e.origem === 'fgts' ? 'amortFGTS' : 'amortBolso'] += e.valor;
  }
  const pontos = cheio.meses.map(m => ({ desde: m.competencia, valor: m.calc.trMes }));
  // sem FGTS: o backtest mede o saldo devedor; o saldo estimado do FGTS limitaria as amortizações reais com FGTS
  const proj = S.projetar({ ...estIni, fgts: null }, { id: 'bt', meses }, null, { ...premReal, trMensal: { modo: 'curva', pontos } });
  let maxDif = 0, maxReal = 0, nBt = 0;
  for (const m of proj) {
    const k = cheio.meses.findIndex(x => x.competencia === m.competencia);
    if (k < 0) break; // acabou o real
    nBt++;
    maxDif = Math.max(maxDif, Math.abs(m.saldoAposParcela - cheio.meses[k].saldo));
    maxReal = Math.max(maxReal, Math.abs(m.saldoAposParcela - real.meses[k].saldo));
  }
  assert(nBt >= 10, 'poucos meses comparados');
  console.log(`backtest: ${nBt} meses; maior diferença vs replay sem ajuste de dias úteis: ${maxDif.toFixed(2)}; vs replay real (com ajuste de dias úteis): ${maxReal.toFixed(2)}`);
  // A projeção amortiza no vencimento. O replay real usa o ajuste de dias úteis (extras pagas depois do
  // vencimento deixam o saldo maior), então a diferença contra ele é maior: só é informativa.
  assert(maxDif <= 0.5, `backtest: ${maxDif}`);

  // divergência acumulada com o histórico: roda e fecha a conta
  const v = S.criarVersao({ cenario: { id: 'bt', meses }, motivo: 'criacao', estado: estIni, orcamento: null,
    premissas: { ...premReal, trMensal: { modo: 'curva', pontos } }, agora: '2030-01-01T00:00:00.000Z' });
  const dac = S.divergenciaAcumulada(real, extras, v);
  assert(Number.isFinite(dac.total));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
