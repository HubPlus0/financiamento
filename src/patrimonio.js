// Imóvel, patrimônio, gastos e economizado (puro). Fase 6.
import { somaMeses } from './engine.js';
import { dataMes } from './invest.js';

// valorCompra é sempre derivado (db.js reexporta)
export const valorCompra = c => (c.inicial.entradaDinheiro ?? 0) + (c.inicial.entradaFGTS ?? 0) + (c.contrato.valorFinanciado ?? 0);

const soma = (l, f) => l.reduce((s, x) => s + f(x), 0);
const anosEntre = (a, b) => Math.max(0, (Date.parse(b) - Date.parse(a)) / 864e5 / 365.25);

/** valorCompra × (1 + valorização a.a.)^(anos desde a assinatura). `data` = YYYY-MM-DD. */
export const valorMercado = (config, premissas, data) =>
  valorCompra(config) * (1 + premissas.valorizacaoImovelAA) ** anosEntre(config.contrato.dataAssinatura, data);

/** Venda do imóvel em `data`. IR de 15% sobre o ganho (valor de mercado − custo de venda − (compra + documentação)), se ligado. */
export function venda(config, premissas, data) {
  const vm = valorMercado(config, premissas, data), custoVenda = vm * premissas.custoVendaPct;
  const ganho = vm - custoVenda - (valorCompra(config) + (config.inicial.documentacao ?? 0));
  const irImovel = premissas.irGanhoCapitalImovel ? 0.15 * Math.max(0, ganho) : 0;
  return { valorMercado: vm, custoVenda, ganho, irImovel, liquida: vm - custoVenda - irImovel };
}
export const vendaLiquida = (config, premissas, data) => venda(config, premissas, data).liquida;

/** patrimônio = venda líquida − saldo devedor + carteira líquida + FGTS. */
export const patrimonio = (config, premissas, data, { saldo, carteira = 0, fgts = 0 }) =>
  vendaLiquida(config, premissas, data) - saldo + carteira + fgts;

/** Patrimônio de um mês projetado (no vencimento da competência). `cfg` = estado.cfg (ou a config completa). */
export const patrimonioMes = (cfg, premissas, m) =>
  patrimonio(cfg, premissas, dataMes(m.competencia, cfg.contrato.diaVencimento ?? 5),
    { saldo: m.saldoFinal, carteira: m.carteiraLiquida ?? 0, fgts: m.fgtsSaldo ?? 0 });

/** Patrimônio de hoje na linha real (sem carteira): estado = estadoReal(...). */
export const patrimonioHoje = (estado, premissas, data) =>
  patrimonio(estado.cfg, premissas, data, { saldo: estado.saldo, fgts: estado.fgts?.saldo ?? 0 });

export const deflator = (ipcaAA, anos) => (1 + ipcaAA) ** anos;

/**
 * Linha real no mesmo formato dos meses projetados (para `gastos`). Extras do mês k = datas em [venc k, venc k+1);
 * juros e seguros do modelo (replay); o saldo final do mês vem do saldo informado pela Caixa.
 */
export function linhaDoReal(linhaReal, extras) {
  const ms = linhaReal.meses;
  return ms.map((m, k) => {
    const prox = ms[k + 1];
    const xs = extras.filter(e => e.data >= m.vencimento && (!prox || e.data < prox.vencimento));
    const fgts = soma(xs.filter(e => e.origem === 'fgts'), e => e.valor);
    return { competencia: m.competencia, encargo: m.encargo, juros: m.calc.juros, mip: m.calc.mip, dfi: m.calc.dfi, taxa: m.calc.taxa,
      amortFGTS: fgts, amortBolso: soma(xs, e => e.valor) - fgts, resgate: 0, fgtsPrestacao: m.fgtsPrestacao ?? 0,
      saldoInicial: m.saldoAnt, saldoFinal: prox ? prox.saldoAnt : linhaReal.estado.saldo };
  });
}

const pago = m => m.encargo + m.amortBolso + m.amortFGTS + m.resgate;
/** TR em reais do período = o que moveu o saldo além dos pagamentos (inclui o pró-rata das extras e centavos). */
const trTotal = ms => (ms.length
  ? soma(ms, pago) + ms.at(-1).saldoFinal - ms[0].saldoInicial - soma(ms, m => m.juros + m.mip + m.dfi + m.taxa)
  : 0);

/**
 * Gastos de um período (meses de `linhaDoReal` e/ou projetados, em sequência). Conservação (exata, por construção da TR):
 *   juros + trPaga + seguros + taxas + principalDevolvido = totalPago, com totalPago = Σ encargos + Σ amortizações extras
 *   (bolso + FGTS + resgate). Saldo acima do inicial = TR (e juro capitalizado da 1ª parcela) ainda não coberta: trNoSaldo.
 * Por origem: FGTS = entrada com FGTS + amortizações com FGTS + parte das parcelas paga com FGTS (`fgtsPrestacao`, que já
 * está dentro do encargo); bolso = o resto (entrada, documentação, parcelas menos essa parte, extras).
 * `cfg` traz inicial.{entradaDinheiro, entradaFGTS, documentacao}.
 */
export function gastos(cfg, meses) {
  const juros = soma(meses, m => m.juros), seguros = soma(meses, m => m.mip + m.dfi), taxas = soma(meses, m => m.taxa);
  const amortFGTS = soma(meses, m => m.amortFGTS), fgtsPrestacao = soma(meses, m => m.fgtsPrestacao ?? 0), totalPago = soma(meses, pago);
  const ini = meses[0]?.saldoInicial ?? 0, fim = meses.at(-1)?.saldoFinal ?? ini;
  const principalDevolvido = Math.max(0, ini - fim), trNoSaldo = Math.max(0, fim - ini);
  const trPaga = trTotal(meses) - trNoSaldo;
  const entradaDinheiro = cfg.inicial.entradaDinheiro ?? 0, entradaFGTS = cfg.inicial.entradaFGTS ?? 0, documentacao = cfg.inicial.documentacao ?? 0;
  const total = totalPago + entradaDinheiro + entradaFGTS + documentacao;
  return { juros, trPaga, trNoSaldo, seguros, taxas, principalDevolvido, documentacao, entradaDinheiro, entradaFGTS,
    totalPago, custos: juros + trPaga + seguros + taxas + documentacao, total, fgtsPrestacao,
    porOrigem: { bolso: total - entradaFGTS - amortFGTS - fgtsPrestacao, fgts: entradaFGTS + amortFGTS + fgtsPrestacao },
    diferenca: juros + trPaga + seguros + taxas + principalDevolvido - totalPago };
}

/** Quanto o cenário economiza contra a referência (listas projetadas do mesmo grupo). `fator` deflaciona até a quitação do cenário. */
export function economizado(cenarioMeses, referenciaMeses, premissas = {}) {
  const t = ms => ({ juros: soma(ms, m => m.juros), tr: trTotal(ms), meses: ms.filter(m => m.saldoInicial > 0).length });
  const c = t(cenarioMeses), r = t(referenciaMeses);
  return { juros: r.juros - c.juros, tr: r.tr - c.tr, meses: r.meses - c.meses, anos: (r.meses - c.meses) / 12,
    fator: deflator(premissas.ipcaAA ?? 0, c.meses / 12) };
}

/**
 * Carteira líquida e patrimônio por horizonte (anos desde `estado.competencia`) e na quitação.
 * → [{ anos, competencia, carteiraLiquida, saldo, patrimonio, fator }]; a quitação vem por último (rotulo: 'quitacao').
 * Fora da projeção os valores vêm null (projete com `ate` para cobrir o horizonte). `fator` = (1 + IPCA)^anos.
 */
export function horizontes(estado, meses, premissas, anos = [5, 10, 15]) {
  const linha = (a, m, comp, extra = {}) => ({ ...extra, anos: a, competencia: comp, carteiraLiquida: m?.carteiraLiquida ?? null,
    saldo: m?.saldoFinal ?? null, patrimonio: m ? patrimonioMes(estado.cfg, premissas, m) : null, fator: deflator(premissas.ipcaAA ?? 0, a) });
  const out = anos.map(a => { const c = somaMeses(estado.competencia + '-01', 12 * a).slice(0, 7); return linha(a, meses.find(m => m.competencia === c), c); });
  const q = meses.filter(m => m.saldoInicial > 0).at(-1);
  return [...out, linha(q ? (meses.indexOf(q) + 1) / 12 : 0, q, q?.competencia ?? null, { rotulo: 'quitacao' })];
}
