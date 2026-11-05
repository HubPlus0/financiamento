// Investimento e FGTS (puro). Na Fase 6 ganha a carteira; por ora só o FGTS real.
import { somaMeses } from './engine.js';

const porData = l => [...l].sort((a, b) => (a.data < b.data ? -1 : 1));

/**
 * Último saldo informado (até `ate`) menos os usos posteriores a ele. null se nunca informado.
 * Tipos de `fgtsReal`: 'saldo-informado', 'uso-entrada', 'uso-amortizacao', 'uso-prestacao' (pedido de "Usar FGTS em
 * 12 prestações": o valor inteiro sai do FGTS na data do pedido; leva `meses`, a duração do período). Todo 'uso-*' sai do saldo.
 */
export function saldoFGTSReal(fgtsReal, ate = '9999-12-31') {
  const l = porData(fgtsReal).filter(m => m.data <= ate);
  const s = l.filter(m => m.tipo === 'saldo-informado').pop();
  if (!s) return null;
  return l.filter(m => m.tipo.startsWith('uso') && m.data > s.data).reduce((v, m) => v - m.valor, s.valor);
}

/**
 * Próxima data em que o FGTS pode amortizar: último uso-amortizacao + 24 meses (uso-entrada não conta). null = livre.
 * `janela` = premissa fgtsPrestacaoJanela: com 'reiniciaNoFim', o pedido de FGTS nas prestações também conta, a partir
 * do fim do período (data do pedido + meses). 'naoAfeta' e 'bloqueiaDurante' ignoram as prestações.
 */
export function proximoUsoFGTS(fgtsReal, janela = 'naoAfeta') {
  const fim = m => (m.tipo === 'uso-prestacao' ? somaMeses(m.data, m.meses ?? 12) : m.data);
  const l = porData(fgtsReal).filter(m => m.tipo === 'uso-amortizacao' || (janela === 'reiniciaNoFim' && m.tipo === 'uso-prestacao')).map(fim).sort();
  return l.length ? somaMeses(l.at(-1), 24) : null;
}

/**
 * Pedido real de FGTS nas prestações ainda em curso: { porMes, meses, restante } (meses e valor ainda não abatidos) ou
 * null. O abatimento começa no 1º vencimento depois do pedido; cada parcela lançada depois dele consome `fgtsPrestacao`
 * (ou valor/meses, se a parcela não informou).
 */
export function creditoFGTSPrestacao(fgtsReal, parcelas) {
  const u = porData(fgtsReal).filter(m => m.tipo === 'uso-prestacao' && m.meses > 0).pop();
  if (!u) return null;
  const porMes = u.valor / u.meses;
  const usadas = parcelas.filter(p => p.vencimento > u.data).sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1)).slice(0, u.meses);
  const meses = u.meses - usadas.length, restante = u.valor - usadas.reduce((s, p) => s + (p.fgtsPrestacao ?? porMes), 0);
  return meses > 0 && restante > 0.005 ? { porMes, meses, restante } : null;
}

export const podeUsarFGTS = (fgtsReal, data, janela) => (proximoUsoFGTS(fgtsReal, janela) ?? '') <= data;

// ---- Fase 6: Selic, TR vinculada e carteira por lotes (puro)

/** Vencimento da competência (YYYY-MM) no dia `dia`. */
export const dataMes = (comp, dia = 5) => somaMeses(comp + '-01', 0, dia);
const dias = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Selic (a.a.) da competência: linear de `atual` até `longoPrazo` em `anosAteLongoPrazo` anos desde `compInicial`; depois constante. */
export function selicDe({ atual, longoPrazo, anosAteLongoPrazo }, comp, compInicial) {
  const anos = ((+comp.slice(0, 4) - +compInicial.slice(0, 4)) * 12 + +comp.slice(5, 7) - +compInicial.slice(5, 7)) / 12;
  const t = anosAteLongoPrazo > 0 ? Math.min(1, Math.max(0, anos / anosAteLongoPrazo)) : 1;
  return atual + (longoPrazo - atual) * t;
}
export const cdiDe = (selic, cdiSpread = 0) => selic + cdiSpread;

/**
 * TR vinculada à Selic: tr_mensal = max(0, fator × (selic − piso)), selic em a.a. decimal.
 * Piso 8,5% (TR ≈ 0 com Selic baixa). `fator` é calibrado em premissasPadrao para a TR da Selic atual = média dos
 * últimos 12 meses reais (13,75% → ≈ 0,163% a.m.; 13% → ≈ 0,14%; 14% → ≈ 0,17%). Editável nas premissas.
 */
export const PISO_TR = 0.085;
export const trVinculada = ({ piso = PISO_TR, fator }, selic) => Math.max(0, fator * (selic - piso));

/** Alíquota regressiva do IR pela idade do lote em dias. */
export const irAliquota = d => (d <= 180 ? 0.225 : d <= 360 ? 0.2 : d <= 720 ? 0.175 : 0.15);

// Lote = { comp, principal, valor }; entra no vencimento da competência. `opc` = { dia, isentoIR }.
export const aportar = (lotes, comp, valor) => [...lotes, { comp, principal: valor, valor }];

/** Rende um mês: valor × (1 + ((1 + CDI)^(1/12) − 1) × pctCDI). */
export const render = (lotes, cdiAA, pctCDI = 1) => {
  const f = 1 + ((1 + cdiAA) ** (1 / 12) - 1) * pctCDI;
  return lotes.map(l => ({ ...l, valor: l.valor * f }));
};

const irLote = (l, data, { dia = 5, isentoIR = false } = {}) =>
  isentoIR ? 0 : irAliquota(dias(dataMes(l.comp, dia), data)) * Math.max(0, l.valor - l.principal);

/** Valor líquido da carteira se tudo fosse resgatado em `data`: Σ (valor − IR do lote). */
export const liquidoCarteira = (lotes, data, opc) => lotes.reduce((s, l) => s + l.valor - irLote(l, data, opc), 0);

/**
 * Resgata `liquido` (valor líquido de IR) em `data`, FIFO (lote mais antigo primeiro), com o IR dos lotes consumidos.
 * → { lotes, bruto, ir }. Erro se a carteira líquida não cobre o pedido (folga de R$ 0,005).
 */
export function resgatar(lotes, liquido, data, opc) {
  if (liquido > liquidoCarteira(lotes, data, opc) + 0.005) throw new Error('Resgate maior que a carteira líquida.');
  let falta = liquido, bruto = 0, ir = 0;
  const resto = [];
  for (const l of [...lotes].sort((a, b) => (a.comp < b.comp ? -1 : 1))) {
    const imp = irLote(l, data, opc), liq = l.valor - imp;
    if (falta <= 1e-9) { resto.push(l); continue; }
    const f = Math.min(1, falta / liq); // fração do lote consumida (o IR é linear no lote)
    bruto += f * l.valor; ir += f * imp; falta -= f * liq;
    if (f < 1) resto.push({ ...l, principal: l.principal * (1 - f), valor: l.valor * (1 - f) });
  }
  return { lotes: resto, bruto, ir };
}
