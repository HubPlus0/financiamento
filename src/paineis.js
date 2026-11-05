// Dados dos painéis Status e Comparativo e dos gráficos (puro: só devolve JSON; Fase 7).
// Entrada: `dados` = { config, parcelas, extras, fgtsReal, premissas[], orcamentos[], cenarios[], versoes[], hoje?, orcamentoId? }
// (montado por src/ui/dados.js). `preparar(dados)` calcula estado real e projeções do grupo; as três funções aceitam
// o bruto ou o já preparado.
//
// Mapa para o Artifact (nome no Artifact -> campo):
//  Status:  SALDO -> saldoAtual; "328 meses" -> prazoRestante; "fev/2054" -> quitacao.rotulo; "Plano ativo: quitLab" -> quitacaoPlano.rotulo
//   nxt {aj,J,A,seg,tax,tot} -> proximaParcela {aj, juros, amortizacao, mip, dfi, seguros, taxa, encargo, tr, faixa, vencimento}
//   "Parcela original -> agora" -> parcela { original: {competencia, encargo}, atual }
//   GASTO / GTOT -> composicao[] / totalPago.total; FGTS_G, BOLSO_G -> gastoPorOrigem { fgts, bolso } (+ detalheOrigem)
//   divv mes / acum {mod, ex, tot} -> divergencia.mes / .acumulada { modelo[{rotulo,valor}], execucao{planejado,feito}, total }
//   D.marcosDiv / D.marcosRef -> marcos.plano / marcos.referencia [{faixa, competencia, rotulo, saldo}]; marcos.real; marcos.passaTR
//   D.real / D.plan (lista) -> serie[] { competencia, rotulo, real, faixa, amortizacao(A), juros(J), tr(TR), seguros(seg), taxa, encargo(enc), saldo(S), eventos(ev) }
//   statusChart -> serieSaldo { reais, plano, referencia, marcos }; fgtsWin -> janelaFGTS
//  Comparativo (por cenario em painelComparativo(...).cenarios): pat -> patrimonio; Vl,S,cart,fg -> composicao.{imovelLiquido,divida,carteira,fgts};
//   bolso -> custoBolso; fgUsed -> fgtsUsado (amortizações + prestações; fgtsPrestacoes separado); quit/quitLab -> quitacao.rotulo; jur,tr -> jurosPagos, trPaga;
//   econJ, econT, anosMenos -> economizado.{juros, tr, anos}; infl -> fator; best/tie -> melhor (null em "hoje"); marcos de faixa -> marcos[].mesesAntecipados
//  Gráficos (seriesGraficos): donut -> rosca; D.yearly[k].S -> saldoPorAno; .A/.J/.TR/.seg -> composicaoParcela; .cart + D.cross -> saldoXCarteira (cruzamento)
// Sem dado no Artifact: nada faltou; o texto "sem amortização extra seria em fev/2029" sai de marcos.referencia.
import { somaMeses, passoMes, taxaMensal } from './engine.js';
import { dataMes } from './invest.js';
import { estadoReal, projetar, projetarGrupo, resumo, mesesReais, divergencia, divergenciaAcumulada, janelaFGTS } from './scenario.js';
import { gastos, economizado, linhaDoReal, vendaLiquida, patrimonio, deflator } from './patrimonio.js';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** 'YYYY-MM' -> 'nov/2036' (único lugar com esse formato). */
export const rotuloMes = c => (c ? `${MESES[+c.slice(5, 7) - 1]}/${c.slice(0, 4)}` : null);
const marca = c => (c ? { competencia: c, rotulo: rotuloMes(c) } : null);
const somaMes = (c, n) => somaMeses(c + '-01', n).slice(0, 7);
const mesesEntre = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const soma = (l, f) => l.reduce((s, x) => s + f(x), 0);
const ativos = ms => ms.filter(m => m.saldoInicial > 0);

/** Estado real + projeções do grupo (até a quitação mais tardia e, no mínimo, 15 anos). null sem parcelas. */
export function preparar(d) {
  if (d.estado || !d.parcelas?.length) return d.estado ? d : null;
  const { config, parcelas, extras = [], fgtsReal = [], premissas, orcamentos = [], cenarios = [], versoes = [] } = d;
  const pp = Object.fromEntries(premissas.map(p => [p.id, p]));
  const orc = orcamentos.find(o => o.id === d.orcamentoId) ?? orcamentos.find(o => cenarios.some(c => c.orcamentoId === o.id && c.planoAtivo)) ?? orcamentos[0] ?? null;
  let grupo = cenarios.filter(c => orc && c.orcamentoId === orc.id && pp[c.premissasId]).sort((a, b) => (b.regra === 'referencia') - (a.regra === 'referencia'));
  const padrao = pp.padrao ?? premissas[0];
  if (!grupo.length) grupo = [{ id: 'ref', nome: 'Contrato sem amortização extra', regra: 'referencia', fixo: true, premissasId: padrao.id, meses: {} }];
  const estado = estadoReal({ config, parcelas, extras, fgtsReal, premissas: pp[grupo[0].premissasId] });
  let proj = projetarGrupo(estado, grupo, orc, pp);
  const ref = grupo.find(c => c.regra === 'referencia') ?? grupo[0];
  const ult = Object.values(proj).map(m => m.at(-1)?.competencia ?? '').sort().pop(), ate = [ult, somaMes(estado.competencia, 180)].sort().pop();
  if (ate > ult) { // horizontes de 15 anos além da quitação: estende todos
    const base = Object.fromEntries(proj[ref.id].map(m => [m.competencia, m.encargo]));
    proj = Object.fromEntries(grupo.map(c => [c.id, projetar(estado, c, orc, pp[c.premissasId], { base, ate })]));
  }
  const plano = grupo.find(c => c.planoAtivo) ?? ref;
  return { ...d, extras, versoes, estado, pp, orc, grupo, proj, ref, plano, premPlano: pp[plano.premissasId], real: linhaDoReal(estado.linhaReal, extras),
    hoje: d.hoje ?? new Date().toISOString().slice(0, 10) };
}

const faixasReais = P => P.estado.linhaReal.meses.map(m => ({ competencia: m.competencia, faixa: m.calc.faixa }));

/** Primeira competência de cada faixa numa série [{competencia, faixa, saldo}]. */
function marcosDe(serie) {
  const vistos = new Set(), out = [];
  for (const m of serie) if (m.faixa != null && !vistos.has(m.faixa)) { vistos.add(m.faixa); out.push({ faixa: m.faixa, ...marca(m.competencia), saldo: m.saldo ?? null }); }
  return out;
}

const eventosProj = m => [
  ...(m.amortBolso > 0 ? [{ tipo: 'amortizacao', origem: 'bolso', valor: m.amortBolso }] : []),
  ...(m.amortFGTS > 0 ? [{ tipo: 'amortizacao', origem: 'fgts', valor: m.amortFGTS }] : []),
  ...(m.resgate > 0 ? [{ tipo: 'amortizacao', origem: 'resgate', valor: m.resgate }] : []),
  ...(m.fgtsPedido > 0 ? [{ tipo: 'fgts-pedido', valor: m.fgtsPedido }] : []),
  ...(m.fgtsPrestacao > 0 ? [{ tipo: 'fgts-prestacao', valor: m.fgtsPrestacao, mes: m.fgtsPrestacaoMes }] : []),
  ...(m.fgtsSaldo != null && m.fgtsLivreEm === m.competencia ? [{ tipo: 'janela-fgts', saldo: m.fgtsDisponivel }] : []),
];
const linhaProj = m => ({ competencia: m.competencia, rotulo: rotuloMes(m.competencia), real: false, faixa: m.faixa, amortizacao: m.amortizacao, juros: m.juros,
  tr: m.saldoCorrigido - m.saldoInicial, seguros: m.mip + m.dfi, taxa: m.taxa, encargo: m.encargo, saldo: m.saldoFinal, eventos: eventosProj(m) });

function linhasReais(P) {
  const ms = P.estado.linhaReal.meses;
  return ms.map((m, k) => {
    const prox = ms[k + 1], r = P.real[k];
    const eventos = [...(m.fgtsPrestacao > 0 ? [{ tipo: 'fgts-prestacao', valor: m.fgtsPrestacao }] : []),
      ...P.extras.filter(e => e.data >= m.vencimento && (!prox || e.data < prox.vencimento)).map(e => ({ tipo: 'amortizacao', origem: e.origem, valor: e.valor }))];
    return { competencia: m.competencia, rotulo: rotuloMes(m.competencia), real: true, faixa: m.calc.faixa, amortizacao: m.calc.amortizacao, juros: m.calc.juros,
      tr: m.calc.saldoCorrigido - m.saldoAnt, seguros: m.calc.mip + m.calc.dfi, taxa: m.calc.taxa, encargo: m.encargo, saldo: r.saldoFinal, eventos };
  });
}

/** Divergência do último mês real e acumulada. contra: 'anterior' (versão que previa o mês) | 'primeira' (1ª versão do plano ativo). */
function divergencias(P, contra) {
  const L = P.estado.linhaReal.meses.at(-1).competencia;
  const vs = P.versoes.filter(v => v.cenarioId === P.plano.id).sort((a, b) => (a.criadaEm < b.criadaEm ? -1 : 1));
  const v = contra === 'primeira' ? vs[0] : vs.filter(x => x.meses.length && x.meses[0].competencia <= L && x.meses.at(-1).competencia >= L).at(-1);
  if (!v) return { contra, versao: null, mes: null, acumulada: null };
  const mr = mesesReais(P.estado.linhaReal, P.extras, P.parcelas).find(r => r.competencia === L), mv = v.meses.find(m => m.competencia === L);
  return { contra, versao: { criadaEm: v.criadaEm, motivo: v.motivo }, competencia: marca(L),
    mes: mr && mv ? divergencia(mr, mv) : null, acumulada: divergenciaAcumulada(P.estado.linhaReal, P.extras, v, P.parcelas) };
}

/** Gastos da linha real e a composição da rosca (usados pelo Status e pelos gráficos). */
function totaisReais(P) {
  const g = gastos(P.estado.cfg, P.real);
  const composicao = [['entradaDinheiro', 'Entrada em dinheiro', g.entradaDinheiro], ['entradaFGTS', 'Entrada com FGTS', g.entradaFGTS], ['documentacao', 'Documentação', g.documentacao],
    ['principalDevolvido', 'Principal devolvido', g.principalDevolvido], ['segurosTaxas', 'Seguros + taxas', g.seguros + g.taxas], ['tr', 'TR (correção)', g.trPaga], ['juros', 'Juros', g.juros]]
    .map(([chave, rotulo, valor]) => ({ chave, rotulo, valor }));
  return { g, composicao };
}

const jurosETR = ms => ({ juros: soma(ms, m => m.juros), tr: soma(ms, m => m.saldoCorrigido - m.saldoInicial) });

/**
 * Contrato sem nenhuma amortização extra: do 1º mês com extra em diante, refaz os meses reais com a TR real e sem
 * extras e depois projeta sem extras (premissas da referência). null se nunca houve extra.
 * → { serie [{competencia, saldo}] desde o 1º mês real, quitacao, juros, tr (somados do 1º mês com extra até quitar), k0 }
 */
function semExtras(P) {
  const { estado } = P, lr = estado.linhaReal, ms = lr.meses;
  let k0 = ms.findIndex(m => m.extras.length);
  if (k0 < 0) { if (!lr.extrasFinais.length) return null; k0 = ms.length; }
  const p0 = [...P.parcelas].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1))[k0 - 1];
  let saldo = ms[k0 - 1].saldo, pmt = p0.aj ?? p0.amortizacao + p0.juros;
  const serie = ms.slice(0, k0).map(m => ({ competencia: m.competencia, saldo: m.saldo })), passado = [];
  for (const m of ms.slice(k0)) {
    const p = passoMes({ saldo, pmt }, { tr: m.calc.trMes, i: taxaMensal(estado.contrato) });
    passado.push({ saldoInicial: saldo, saldoCorrigido: p.saldoCorrigido, juros: p.juros });
    saldo = p.saldoFinal; pmt = p.pmt;
    serie.push({ competencia: m.competencia, saldo });
  }
  const prazo = ms[k0 - 1].prazoRestante - (ms.length - k0);
  const futuro = ativos(projetar({ ...estado, saldo, pmt, prazo }, { regra: 'referencia' }, null, P.pp[P.ref.premissasId]));
  futuro.forEach(m => serie.push({ competencia: m.competencia, saldo: m.saldoFinal }));
  return { serie, quitacao: resumo(futuro).quitacao, k0, ...jurosETR([...passado, ...futuro]) };
}

/** Amortizações extras feitas e o impacto contra o contrato sem nenhuma extra. null se nunca houve extra. */
function impactoExtras(P, sem) {
  if (!sem) return null;
  const lr = P.estado.linhaReal, rf = ativos(P.proj[P.ref.id]);
  const lista = [...lr.meses.flatMap(m => m.extras), ...lr.extrasFinais]
    .map(e => ({ data: e.data, valor: e.valor, origem: e.origem ?? 'bolso', mesesReduzidos: e.prazoAntes - e.prazoDepois }));
  const reaisDesde = lr.meses.slice(sem.k0).map(m => ({ saldoInicial: m.saldoAnt, saldoCorrigido: m.calc.saldoCorrigido, juros: m.calc.juros }));
  const com = jurosETR([...reaisDesde, ...rf]), qCom = resumo(rf).quitacao, total = soma(lista, e => e.valor);
  const juros = sem.juros - com.juros, tr = sem.tr - com.tr;
  return { lista, total, fgts: soma(lista.filter(e => e.origem === 'fgts'), e => e.valor), bolso: soma(lista.filter(e => e.origem !== 'fgts'), e => e.valor),
    quitacaoSemExtras: marca(sem.quitacao), quitacaoComExtras: marca(qCom), mesesAMenos: mesesEntre(qCom, sem.quitacao),
    economizado: { juros, tr, total: juros + tr, porReal: total > 0 ? (juros + tr) / total : 0 } };
}

export function painelStatus(dados, { contra = 'anterior' } = {}) {
  const P = preparar(dados);
  if (!P) return null;
  const { estado, cfg = estado.cfg } = P, ms = estado.linhaReal.meses, dia = cfg.contrato.diaVencimento ?? 5;
  const pl = P.proj[P.plano.id], rf = P.proj[P.ref.id];
  const reais = linhasReais(P), lPlano = ativos(pl).map(linhaProj), lRef = ativos(rf).map(linhaProj);
  const { g, composicao } = totaisReais(P);
  const prox = pl[0], tr = prox.saldoCorrigido - prox.saldoInicial;
  const encargoDe = k => { const p = [...P.parcelas].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1))[k]; return p?.pago ?? ms[k].encargo; };
  const k2 = ms.length > 1 ? 1 : 0; // original = 1º mês regular (o 1º tem juros pro rata)
  const marcos = { real: marcosDe(reais), plano: marcosDe([...reais, ...lPlano]), referencia: marcosDe([...reais, ...lRef]) };
  const passaTR = l => marca([...reais, ...l].find(m => m.amortizacao >= m.tr)?.competencia);
  const pt = l => l.map(m => ({ competencia: m.competencia, saldo: m.saldo }));
  const extraFGTS = soma(P.real, m => m.amortFGTS), extraBolso = soma(P.real, m => m.amortBolso);
  const sem = semExtras(P);
  return {
    saldoAtual: estado.saldo, ultimaParcela: { ...marca(ms.at(-1).competencia), vencimento: ms.at(-1).vencimento },
    prazoRestante: estado.prazo, quitacao: marca(resumo(pl).quitacao), quitacaoPlano: marca(resumo(pl).quitacao), quitacaoReferencia: marca(resumo(rf).quitacao),
    proximaParcela: { ...marca(prox.competencia), vencimento: dataMes(prox.competencia, dia), amortizacao: prox.amortizacao, juros: prox.juros, tr, aj: prox.pmt,
      mip: prox.mip, dfi: prox.dfi, seguros: prox.mip + prox.dfi, taxa: prox.taxa, encargo: prox.encargo, faixa: prox.faixa,
      fgtsPrestacao: prox.fgtsPrestacao ?? 0, doBolso: prox.encargo - (prox.fgtsPrestacao ?? 0), fgtsPrestacaoMes: prox.fgtsPrestacaoMes ?? null },
    totalPago: { juros: g.juros, trPaga: g.trPaga, seguros: g.seguros, taxas: g.taxas, principalDevolvido: g.principalDevolvido, documentacao: g.documentacao,
      entrada: g.entradaDinheiro, entradaFGTS: g.entradaFGTS, parcelasEExtras: g.totalPago, custos: g.custos, total: g.total },
    gastoPorOrigem: g.porOrigem,
    detalheOrigem: { bolso: { entrada: g.entradaDinheiro, documentacao: g.documentacao, parcelas: soma(P.real, m => m.encargo) - g.fgtsPrestacao, extras: extraBolso },
      fgts: { entrada: g.entradaFGTS, extras: extraFGTS, prestacoes: g.fgtsPrestacao } },
    trNoSaldo: g.trNoSaldo, composicao,
    parcela: { original: { ...marca(ms[k2].competencia), encargo: encargoDe(k2) }, atual: { ...marca(prox.competencia), encargo: prox.encargo } },
    marcos: { ...marcos, passaTR: { plano: passaTR(lPlano), referencia: passaTR(lRef) } },
    divergencia: divergencias(P, contra),
    serie: [...reais, ...lPlano].map(m => ({ ...m, eventos: [...m.eventos, ...marcos.plano.filter(x => x.competencia === m.competencia).map(x => ({ tipo: 'marco-faixa', faixa: x.faixa }))] })),
    extras: impactoExtras(P, sem),
    serieSaldo: { reais: pt(reais), plano: pt(lPlano), referencia: pt(lRef), semExtras: sem?.serie ?? null,
      marcos: { real: marcos.real, plano: marcos.plano.filter(x => x.competencia >= estado.competencia), referencia: marcos.referencia.filter(x => x.competencia >= estado.competencia) } },
    janelaFGTS: janelaFGTS(pl),
  };
}

// ---- Comparativo

const anosDe = (P, h) => {
  if (h === 'hoje') return { anos: 0, comp: null };
  if (h === 'quitacao') {
    const q = Object.values(P.proj).map(ms => resumo(ms).quitacao ?? '').sort().pop();
    return { anos: (mesesEntre(P.estado.competencia, q) + 1) / 12, comp: q };
  }
  return { anos: +h, comp: somaMes(P.estado.competencia, 12 * h) };
};

/**
 * Comparativo no horizonte `horizonte` ('hoje' | 5 | 10 | 15 | 'quitacao').
 * `deflacionar`: true = valores a preços de hoje ("Em reais de hoje" na tela). Saldos no horizonte (patrimônio, dívida,
 * carteira, FGTS) dividem por `fator` = (1+IPCA)^anos; fluxos (custo do bolso, FGTS usado, juros, TR, economizado) dividem
 * cada mês projetado pelo fator da data dele (meses reais ficam como foram pagos). Sem deflacionar, `fator` vem 1 e
 * `fatorIPCA` mostra o do horizonte.
 */
export function painelComparativo(dados, horizonte = 10, deflacionar = false) {
  const P = preparar(dados);
  if (!P) return null;
  const { anos, comp } = anosDe(P, horizonte), cfg = P.estado.cfg, dia = cfg.contrato.diaVencimento ?? 5, ipca = P.premPlano.ipcaAA ?? 0;
  const fatorIPCA = deflator(ipca, anos), f = deflacionar ? fatorIPCA : 1, d = x => x / f;
  const fluxo = (ms, g) => soma(ms, m => g(m) / (deflacionar ? deflator(ipca, Math.max(0, mesesEntre(P.estado.competencia, m.competencia)) / 12) : 1));
  const corr = (ms, g) => fluxo(ms, g) - soma(ms, g); // nominal → a preços de hoje (0 sem deflacionar)
  const J = m => m.juros, TR = m => m.saldoCorrigido - m.saldoInicial;
  const bolsoMes = m => m.encargo - (m.fgtsPrestacao ?? 0) + m.amortBolso + (m.aporte ?? 0); // o que projetar soma em custoBolso
  const refMs = P.proj[P.ref.id], reais = faixasReais(P);
  const marcosDeMs = ms => marcosDe([...reais, ...ativos(ms)]);
  const mRef = marcosDeMs(refMs);
  const cenarios = P.grupo.map(c => {
    const ms = P.proj[c.id], prem = P.pp[c.premissasId], ehRef = c === P.ref;
    let imovel, divida, carteira, fgts, m = null, custoBolso = 0, fgtsUsado = 0, fgtsPrestacoes = 0;
    if (comp == null) { // hoje: todos partem do real
      const dt = P.hoje;
      imovel = vendaLiquida(cfg, prem, dt); divida = P.estado.saldo; carteira = 0; fgts = (P.estado.fgts?.saldo ?? 0) + (P.estado.fgts?.credito?.restante ?? 0);
    } else {
      m = ms.find(x => x.competencia === comp);
      imovel = vendaLiquida(cfg, prem, dataMes(comp, dia)); divida = m.saldoFinal; carteira = m.carteiraLiquida ?? 0; fgts = (m.fgtsSaldo ?? 0) + (m.fgtsCredito ?? 0);
      const ate = ms.filter(x => x.competencia <= comp);
      custoBolso = fluxo(ate, bolsoMes); fgtsPrestacoes = fluxo(ate, x => x.fgtsPrestacao ?? 0); fgtsUsado = fluxo(ate, x => x.amortFGTS) + fgtsPrestacoes;
    }
    const pat = patrimonio(cfg, prem, comp == null ? P.hoje : dataMes(comp, dia), { saldo: divida, carteira, fgts });
    const at = ativos(ms), gt = gastos(cfg, [...P.real, ...at]), ec = economizado(ms, refMs, prem), mc = marcosDeMs(ms);
    return { id: c.id, nome: c.nome, regra: c.regra, referencia: ehRef, planoAtivo: !!c.planoAtivo,
      patrimonio: d(pat), composicao: { imovelLiquido: d(imovel), divida: d(divida), carteira: d(carteira), fgts: d(fgts) },
      saldoDevedor: d(divida), carteira: d(carteira), quitacao: marca(resumo(ms).quitacao),
      custoBolso, fgtsUsado, fgtsPrestacoes, jurosPagos: gt.juros + corr(at, J), trPaga: gt.trPaga + corr(at, TR),
      // projetado: a TR somada de economizado (trTotal) é Σ (saldoCorrigido − saldoInicial)
      economizado: ehRef ? null : { juros: ec.juros + corr(refMs, J) - corr(ms, J), tr: ec.tr + corr(refMs, TR) - corr(ms, TR), anos: ec.anos, meses: ec.meses },
      marcos: [2, 3].map(fx => { const a = mc.find(x => x.faixa === fx)?.competencia ?? null, b = mRef.find(x => x.faixa === fx)?.competencia ?? null;
        return { faixa: fx, ...marca(a), referencia: marca(b), mesesAntecipados: a && b ? mesesEntre(a, b) : null }; }) };
  });
  const melhor = comp == null ? null : cenarios.reduce((b, c) => (c.patrimonio > b.patrimonio ? c : b)).id;
  return { horizonte, anos, ...marca(comp), deflacionado: !!deflacionar, fator: f, fatorIPCA, melhor, cenarios };
}

// ---- Gráficos (por ano civil)

/** Primeiro mês com carteira líquida >= saldo (e carteira > 0); null se nunca. */
export const cruzamento = ms => marca(ms.find(m => m.carteiraLiquida > 0 && m.carteiraLiquida >= m.saldoFinal)?.competencia)?.rotulo ?? null;

export function seriesGraficos(dados) {
  const P = preparar(dados);
  if (!P) return null;
  const todos = P.grupo.map(c => ({ c, ms: P.proj[c.id] }));
  const a0 = +P.estado.competencia.slice(0, 4), a1 = +todos.map(x => x.ms.at(-1).competencia).sort().pop().slice(0, 4);
  const anos = Array.from({ length: a1 - a0 + 1 }, (_, k) => a0 + k);
  const doAno = (ms, a) => ms.filter(m => +m.competencia.slice(0, 4) === a);
  const fimAno = (ms, a, campo) => { const l = doAno(ms, a).at(-1); return l ? l[campo] ?? 0 : 0; };
  const { g, composicao } = totaisReais(P);
  const ident = ({ c }) => ({ id: c.id, nome: c.nome, referencia: c === P.ref, planoAtivo: !!c.planoAtivo });
  return {
    rosca: { itens: composicao, total: g.total },
    anos,
    saldoPorAno: todos.map(x => ({ ...ident(x), saldo: anos.map(a => fimAno(x.ms, a, 'saldoFinal')) })),
    composicaoParcela: todos.map(x => ({ ...ident(x), anos: anos.map(a => { const l = ativos(doAno(x.ms, a));
      return { ano: a, amortizacao: soma(l, m => m.amortizacao), juros: soma(l, m => m.juros), tr: soma(l, m => m.saldoCorrigido - m.saldoInicial), segurosTaxas: soma(l, m => m.mip + m.dfi + m.taxa) }; }) })),
    saldoXCarteira: todos.map(x => ({ ...ident(x), saldo: anos.map(a => fimAno(x.ms, a, 'saldoFinal')), carteira: anos.map(a => fimAno(x.ms, a, 'carteiraLiquida')), cruzamento: cruzamento(x.ms) })),
  };
}
