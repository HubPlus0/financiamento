// Motor do financiamento (Caixa, Tabela Price + TR). Funções puras: sem DOM, sem IndexedDB.
// Dinheiro em reais; arredonda (r2) só onde a Caixa arredonda; contas intermediárias em precisão total.

// Arredonda a 2 casas, meio para longe de zero, com folga para o erro binário de x.xx5.
export const r2 = x => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-7) / 100;

/** Taxa mensal do contrato: nominal a.a. dividido por 12 (não composta). */
export const taxaMensal = contrato => contrato.taxaNominalAA / 12;

/** Parcela Price (A+J) para saldo, n meses e taxa mensal i. */
export const price = (saldo, n, i) => saldo * i / (1 - Math.pow(1 + i, -n));

/** Valor presente de n parcelas pmt: inverso de price. */
const pv = (pmt, n, i) => pmt * (1 - Math.pow(1 + i, -n)) / i;

/**
 * Um mês sem amortização extra.
 * estado: { saldo, pmt } (pmt = A+J do mês anterior, ou o ajNovo se houve extra)
 * tr: TR do mês. diasPeriodo (opcional): juros pro rata (dias/30), para a 1ª parcela.
 */
export function passoMes({ saldo, pmt }, { tr, i, diasPeriodo }) {
  const saldoCorrigido = saldo * (1 + tr);
  const pmtMes = pmt * (1 + tr);
  const juros = saldoCorrigido * i * (diasPeriodo == null ? 1 : diasPeriodo / 30);
  const amortizacao = pmtMes - juros;
  return { saldoCorrigido, juros, pmt: pmtMes, amortizacao, saldoFinal: saldoCorrigido - amortizacao };
}

/** TR do mês deduzida das parcelas A+J (mês normal ou mês seguinte a uma extra, com pmtAnterior = ajNovo). */
export const trDaSerie = (pmtAtual, pmtAnterior) => pmtAtual / pmtAnterior - 1;

/** Prazo exato (fracionário) para quitar `saldo` pagando `pmt`. */
export const prazoExato = (saldo, pmt, i) => -Math.log(1 - saldo * i / pmt) / Math.log(1 + i);

/**
 * Amortização extra por prazo: menor prazo inteiro que mantém a parcela atual.
 * saldo: já descontado o valor extra.
 * Regra calibrada: ceil(nExato − TOL_PRAZO). A Caixa aceita a parcela nova até ~R$ 0,05 acima da atual
 * (1 R$ de parcela ≈ 1,16 mês), por isso a tolerância em meses.
 */
export const TOL_PRAZO = 0.06;
export function prazoAposAmortizacao(saldo, pmtAtual, i) {
  const nNovo = Math.ceil(prazoExato(saldo, pmtAtual, i) - TOL_PRAZO);
  return { nNovo, pmtNovo: price(saldo, nNovo, i) };
}

/** Maior amortização que ainda dá exatamente nAlvo meses mantendo a parcela atual. */
export const valorDeCorte = (saldo, pmtAtual, nAlvo, i) => saldo - pv(pmtAtual, nAlvo, i);

/**
 * Faixa do mês. trValor = saldoAnt × tr, em reais.
 * 1: A < TR$ (saldo sobe); 2: TR$ ≤ A < J+TR$; 3: A ≥ J+TR$.
 * As antigas faixas 3 (J ≤ A < J+TR$) e 4 viraram a 3: com a TR baixa, a diferença era de poucos meses.
 */
export const faixa = ({ amortizacao: a, juros: j, trValor: t }) => (a < t ? 1 : a < j + t ? 2 : 3);

/** Seguros do mês: MIP sobre o saldo, DFI sobre o valor de avaliação corrigido pela TR acumulada. */
export function seguros(saldo, valorImovelCorrigido, premissas) {
  return { mip: premissas.mipTaxa * saldo, dfi: premissas.dfiTaxa * valorImovelCorrigido };
}

// Amortização feita depois do vencimento: a Caixa usa um saldo maior. Hipótese calibrada
// (não é regra da Caixa): saldo × TR do período seguinte × dias úteis / DIVISOR_TR_DIA.
export const DIVISOR_TR_DIA = 17.5;

const dia = s => new Date(s + 'T12:00:00Z');
const iso = d => d.toISOString().slice(0, 10);
const fimDeSemana = d => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/** Dias úteis (seg-sex, sem feriados) de `venc` (empurrado para segunda se cair no fim de semana) até `data`. */
export function diasUteisApos(venc, data) {
  let d = dia(venc);
  while (fimDeSemana(d)) d = new Date(d.getTime() + 864e5);
  let n = 0;
  for (d = new Date(d.getTime() + 864e5); iso(d) <= data; d = new Date(d.getTime() + 864e5)) if (!fimDeSemana(d)) n++;
  return n;
}

/** Saldo depois de amortizar `valor` na data (dias úteis após o vencimento; 0 = no vencimento). */
export const saldoAposExtra = (saldo, valor, trProximo, diasUteis) =>
  saldo - valor + saldo * trProximo * diasUteis / DIVISOR_TR_DIA;

/**
 * Linha real mês a mês. Onde a Caixa informou valor (saldoApos, ajNovo, prazoNovo), ele vira o estado seguinte e o
 * calculado fica em `calc` / `extras[].calc` para comparação. Meses só com A+J (PDF) são reconstruídos.
 * parcela.aj = A+J do mês (amortizacao + juros, ou o total do PDF).
 * opts.ajProximo: A+J do próximo vencimento (para a TR do período de extras depois da última parcela).
 * opts.proRataAtraso=false: ignora o ajuste de extras feitas depois do vencimento (para medir o efeito).
 * Devolve { meses, extrasFinais, estado } (estado = saldo, pmt e prazo ao fim, depois das extras finais).
 */
export function replayHistorico(config, parcelasReais, amortizacoesReais, premissas, opts = {}) {
  const c = config.contrato;
  const i = taxaMensal(c);
  const ps = [...parcelasReais].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));
  const xs = [...amortizacoesReais].sort((a, b) => (a.data < b.data ? -1 : 1));
  const ajDe = p => p.aj ?? (p.amortizacao + p.juros);
  let saldo = c.valorFinanciado, prazo = c.prazoOriginal, pmt = price(saldo, prazo, i), fator = 1; // fator = ΠTR (DFI)
  let ultimaTr = 0;

  const aplicaExtras = (lista, venc, ajProx) => lista.map(e => {
    const du = opts.proRataAtraso === false ? 0 : diasUteisApos(venc, e.data);
    const trP = ajProx != null ? trDaSerie(ajProx, e.ajNovo ?? pmt) : ultimaTr;
    const saldoAntes = saldo;
    const saldoCalc = saldoAposExtra(saldo, e.valor, trP, du);
    saldo = e.saldoApos ?? saldoCalc; // saldo informado pela Caixa vence o calculado
    const calc = prazoAposAmortizacao(saldo, pmt, i);
    const r = { data: e.data, valor: e.valor, origem: e.origem, prazoAntes: prazo, saldoAntes, saldoDepois: saldo, diasUteis: du, trProximo: trP,
      calc: { saldoDepois: saldoCalc, prazoNovo: calc.nNovo, ajNovo: calc.pmtNovo, nExato: prazoExato(saldo, pmt, i) } };
    pmt = e.ajNovo ?? calc.pmtNovo;
    prazo = r.prazoDepois = e.prazoNovo ?? calc.nNovo;
    if (e.ajNovo != null) r.calc.ajNovoComPrazoReal = price(saldo, e.prazoNovo, i);
    return r;
  });

  const meses = ps.map((p, k) => {
    const vAnt = k ? ps[k - 1].vencimento : null;
    const extras = vAnt ? aplicaExtras(xs.filter(e => e.data >= vAnt && e.data < p.vencimento), vAnt, ajDe(p)) : [];
    const saldoAnt = saldo;
    const primeira = k === 0;
    // TR: correção informada / saldo, senão deduzida da série de A+J
    const tr = p.correcao != null ? p.correcao / saldoAnt : trDaSerie(ajDe(p), pmt);
    const dias = primeira ? Math.round((dia(p.vencimento) - dia(c.dataAssinatura)) / 864e5) : undefined;
    const passo = passoMes({ saldo, pmt }, { tr, i, diasPeriodo: dias });
    fator *= 1 + tr;
    const sg = seguros(passo.saldoCorrigido, c.valorAvaliacao * fator, premissas);
    const calc = { trMes: tr, saldoCorrigido: passo.saldoCorrigido, juros: passo.juros, amortizacao: passo.amortizacao,
      pmt: passo.pmt, mip: sg.mip, dfi: sg.dfi, taxa: c.taxaOperacional,
      faixa: faixa({ amortizacao: passo.amortizacao, juros: passo.juros, trValor: saldoAnt * tr }) };
    const real = p.saldoApos != null;
    saldo = real ? p.saldoApos : passo.saldoFinal;
    pmt = ajDe(p);
    prazo -= 1;
    ultimaTr = tr;
    return { competencia: p.competencia, vencimento: p.vencimento, origemDados: real ? p.origemDados : 'reconstruido',
      saldoAnt, saldoCalc: passo.saldoFinal, saldo, prazoRestante: prazo,
      encargo: r2(r2(pmt) + r2(sg.mip) + r2(sg.dfi) + c.taxaOperacional), fatorTR: fator, calc, extras };
  });

  const ult = ps[ps.length - 1];
  const finais = xs.filter(e => ult && e.data >= ult.vencimento);
  const extrasFinais = ult ? aplicaExtras(finais, ult.vencimento, opts.ajProximo) : [];
  return { meses, extrasFinais, estado: { saldo, pmt, prazo } };
}

// ---- Fase 3: lançamento do mês real

/** Soma n meses a uma data YYYY-MM-DD, no dia `d` (padrão: o da data), limitado ao último dia do mês. */
export function somaMeses(data, n, d = +data.slice(8)) {
  const t = new Date(Date.UTC(+data.slice(0, 4), +data.slice(5, 7) - 1 + n, 1));
  const ultimo = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(new Date(t.getTime() + (Math.min(d, ultimo) - 1) * 864e5));
}

/** Mês seguinte ao último vencimento lançado, no dia de vencimento do contrato (null sem parcelas). */
export function proximoVencimento(parcelasReais, config) {
  if (!parcelasReais.length) return null;
  const ult = parcelasReais.reduce((m, p) => (p.vencimento > m ? p.vencimento : m), '');
  return somaMeses(ult, 1, config.contrato.diaVencimento);
}

/**
 * Lança a parcela. linhaReal = resultado de replayHistorico (estado já com as extras do período).
 * entrada = { vencimento, pago, saldoApos, dataPagamento?, devido?, amortizacao?, juros?, correcao?, mip?, dfi?, taxa? }.
 * TR deduzida do saldo informado: saldoApos = (1+tr)·(S·(1+i·k) − P), k = 1 (ou dias/30 na 1ª parcela).
 * Opcional digitado que difere do calculado em > R$ 0,05 gera aviso e prevalece no registro.
 */
export function lancarParcela(linhaReal, entrada, config, premissas) {
  const c = config.contrato, i = taxaMensal(c), avisos = [];
  const { saldo: S, pmt: P } = linhaReal.estado;
  const ult = linhaReal.meses[linhaReal.meses.length - 1];
  const dias = ult ? undefined : Math.round((dia(entrada.vencimento) - dia(c.dataAssinatura)) / 864e5);
  const dif = (nome, calc, dig) => {
    if (dig != null && Math.abs(calc - dig) > 0.05)
      avisos.push(`${nome}: Caixa ${dig.toFixed(2)} x calculado ${calc.toFixed(2)}`.replace(/\./g, ','));
  };
  let tr = entrada.saldoApos / (S * (1 + i * (dias ?? 30) / 30) - P) - 1;
  dif('Correção', S * tr, entrada.correcao);
  if (entrada.correcao != null) tr = entrada.correcao / S;
  const passo = passoMes({ saldo: S, pmt: P }, { tr, i, diasPeriodo: dias });
  const fator = (ult?.fatorTR ?? 1) * (1 + tr);
  const sg = seguros(passo.saldoCorrigido, c.valorAvaliacao * fator, premissas);
  const calc = { trMes: tr, saldoCorrigido: passo.saldoCorrigido, juros: passo.juros, amortizacao: passo.amortizacao,
    pmt: passo.pmt, mip: sg.mip, dfi: sg.dfi, taxa: c.taxaOperacional,
    faixa: faixa({ amortizacao: passo.amortizacao, juros: passo.juros, trValor: S * tr }) };
  dif('Juros', calc.juros, entrada.juros);
  dif('Amortização', calc.amortizacao, entrada.amortizacao);
  dif('MIP', calc.mip, entrada.mip);
  dif('DFI', calc.dfi, entrada.dfi);
  dif('Taxa', calc.taxa, entrada.taxa);
  const juros = entrada.juros ?? r2(passo.juros), amortizacao = entrada.amortizacao ?? r2(passo.amortizacao);
  const aj = entrada.juros != null && entrada.amortizacao != null ? r2(juros + amortizacao) : r2(passo.pmt);
  const taxa = entrada.taxa ?? c.taxaOperacional;
  const registro = { competencia: entrada.vencimento.slice(0, 7), vencimento: entrada.vencimento,
    dataPagamento: entrada.dataPagamento ?? null, numeroCaixa: linhaReal.meses.length + 1,
    pago: entrada.pago, devido: entrada.devido ?? entrada.pago, saldoApos: entrada.saldoApos, aj, amortizacao, juros,
    correcao: entrada.correcao ?? r2(S * tr), seguros: r2(entrada.pago - aj - taxa), mip: entrada.mip, dfi: entrada.dfi,
    taxa, calc, origemDados: 'lancamento' };
  for (const k in registro) if (registro[k] === undefined) delete registro[k];
  return { registro, calc, avisos };
}

/**
 * Confere a extra (ainda não gravada) contra a regra do prazo. extra = { data, valor, prazoNovo?, ajNovo?, saldoApos? }.
 * Saldo na data como no replay: saldoAposExtra com a TR do último mês e os dias úteis após o último vencimento.
 */
export function conferirExtra(linhaReal, extra, config) {
  const i = taxaMensal(config.contrato), avisos = [];
  const { saldo, pmt } = linhaReal.estado;
  const ult = linhaReal.meses[linhaReal.meses.length - 1];
  const saldoDepois = extra.saldoApos ?? (ult
    ? saldoAposExtra(saldo, extra.valor, ult.calc.trMes, diasUteisApos(ult.vencimento, extra.data))
    : saldo - extra.valor);
  const { nNovo } = prazoAposAmortizacao(saldoDepois, pmt, i);
  const ajCalculado = price(saldoDepois, extra.prazoNovo ?? nNovo, i);
  const bateu = extra.prazoNovo == null ? null : extra.prazoNovo === nNovo;
  if (bateu === false) avisos.push(`Prazo: Caixa ${extra.prazoNovo} x calculado ${nNovo}`);
  if (extra.ajNovo != null && Math.abs(extra.ajNovo - ajCalculado) > 0.05)
    avisos.push(`A+J novo: Caixa ${extra.ajNovo.toFixed(2)} x calculado ${ajCalculado.toFixed(2)}`.replace(/\./g, ','));
  return { prazoCalculado: nNovo, bateu, ajCalculado, avisos };
}
