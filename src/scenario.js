// Cenários, projeção e versões (puro: sem DOM, sem IndexedDB). Fase 4.
import { r2, taxaMensal, passoMes, seguros, faixa, prazoAposAmortizacao, valorDeCorte, replayHistorico, somaMeses } from './engine.js';
import { saldoFGTSReal, proximoUsoFGTS, creditoFGTSPrestacao, selicDe, cdiDe, trVinculada, PISO_TR, dataMes, aportar, render, resgatar, liquidoCarteira } from './invest.js';
import { patrimonioMes, deflator } from './patrimonio.js';

const proxComp = c => somaMeses(c + '-01', 1).slice(0, 7);
const somaMes = (c, n) => somaMeses(c + '-01', n).slice(0, 7);
const mesesEntre = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const soma = (l, f) => l.reduce((s, x) => s + f(x), 0);

// ---- FGTS nas prestações ("Usar FGTS em 12 prestações", regra do app da Caixa)
// Você pede um valor; ele é debitado INTEIRO do FGTS no pedido e abate a prestação em partes iguais, mês a mês, por
// 12 meses ou pelo prazo restante (o que for menor). Limite: até 80% da prestação por mês (teto do pedido = 80% ×
// prestação × meses), e o saldo do FGTS na hora. Os depósitos que entram durante o período ficam no FGTS para o próximo
// pedido. Terminado o período, pode pedir de novo; pode ser pedido logo depois de uma amortização com FGTS.
// Premissas (padrão = escolha do usuário): fgtsPrestacaoBase: 'encargo' (80% da prestação total) | 'aj' (só A+J);
//  fgtsPrestacaoJanela: efeito na janela de 24 meses da amortização com FGTS: 'naoAfeta' | 'reiniciaNoFim' (a janela
//  só abre 24 meses depois do fim do período) | 'bloqueiaDurante' (não amortiza com FGTS durante o período).
// Hipótese do app (sem regra da Caixa): se a dívida acaba antes do fim do período, o que sobrou do pedido volta ao FGTS.
export const FGTS_PRESTACAO_MESES = 12;
export const PADRAO_FGTS_PRESTACAO = { fgtsPrestacaoPct: 0.8, fgtsPrestacaoBase: 'encargo', fgtsPrestacaoJanela: 'naoAfeta' };
export const regraFGTSPrestacao = (p = {}) => ({ pct: p.fgtsPrestacaoPct ?? PADRAO_FGTS_PRESTACAO.fgtsPrestacaoPct,
  base: p.fgtsPrestacaoBase ?? PADRAO_FGTS_PRESTACAO.fgtsPrestacaoBase, janela: p.fgtsPrestacaoJanela ?? PADRAO_FGTS_PRESTACAO.fgtsPrestacaoJanela });
/** Teto mensal: pct × (encargo ou A+J) do mês, em centavos. `m` = mês projetado (encargo, pmt). */
export const tetoFGTSPrestacao = (regra, m) => r2(regra.pct * (regra.base === 'aj' ? r2(m.pmt) : m.encargo));
/** Teto do pedido: teto mensal do mês do pedido × meses do período. */
export const tetoPedidoFGTS = (regra, m, meses) => r2(tetoFGTSPrestacao(regra, m) * meses);

/**
 * Início do FGTS nas prestações automático, a partir da projeção do mesmo cenário SEM ele (o FGTS na prestação não muda
 * o saldo devedor, só quem paga): o 1º mês depois da última amortização com FGTS em que a próxima janela de 24 meses só
 * abre na última parcela ou depois. É "depois da última janela": dali em diante o FGTS ficaria parado. null se não há.
 */
export function inicioAutoFGTSPrestacao(meses) {
  const ativos = meses.filter(m => m.saldoInicial > 0), q = ativos.at(-1)?.competencia;
  const k = ativos.findLastIndex(m => m.amortFGTS > 0);
  return ativos.slice(k + 1).find(m => (m.fgtsLivreEm ?? '') >= q)?.competencia ?? null;
}

/**
 * Erros da configuração (null/undefined = desligado: sem erro). cfg = cenario.fgtsPrestacao:
 * { modo: 'periodo', inicio: 'YYYY-MM', renovar?, valor? } | { modo: 'auto', valor? }. `valor` = quanto pedir em cada
 * pedido (sem ele, o máximo: teto do pedido ou o saldo do FGTS). Com `renovar` (e no automático) um pedido novo é feito
 * no mês seguinte ao fim de cada período, até a quitação.
 */
export function errosFGTSPrestacao(estado, cfg) {
  if (!cfg) return [];
  const erros = [];
  if (!estado.fgts) erros.push('Sem saldo de FGTS informado: não dá para usar o FGTS nas prestações.');
  if (cfg.valor != null && !(cfg.valor > 0)) erros.push('O valor do pedido precisa ser maior que zero (ou vazio, para o máximo).');
  if (cfg.modo === 'auto') return erros;
  if (cfg.modo !== 'periodo') return [...erros, `Modo do FGTS nas prestações desconhecido: ${cfg.modo}.`];
  if (!/^\d{4}-\d{2}$/.test(cfg.inicio ?? '')) erros.push('Informe o mês do primeiro pedido do FGTS nas prestações.');
  return erros;
}

/** Cenário com o FGTS nas prestações (`cfg` null desliga); recusa (Error) o que `errosFGTSPrestacao` recusa. */
export function definirFGTSPrestacao(estado, cenario, cfg) {
  const erros = errosFGTSPrestacao(estado, cfg);
  if (erros.length) throw new Error(erros.join(' '));
  const { fgtsPrestacao: _, ...resto } = cenario;
  return cfg ? { ...resto, fgtsPrestacao: cfg } : resto;
}

/** Depósito mensal do FGTS no mês: o último de `depositos` [{desde, valor}] com desde ≤ mês (antes do 1º, vale o 1º); sem lista, `deposito`. */
export const depositoFGTS = (fg, comp) => (fg.depositos?.filter(d => d.desde <= comp).pop() ?? fg.depositos?.[0])?.valor ?? fg.deposito ?? 0;

/**
 * Ponto de partida da projeção: o estado real depois da última parcela lançada e das extras posteriores a ela.
 * dados = { config, parcelas, extras, premissas, fgtsReal }. null se não há parcela lançada.
 * `contrato` leva só o que a projeção usa; `linhaReal` (replay completo) fica de fora do snapshot da versão.
 */
export function estadoReal({ config, parcelas, extras, premissas, fgtsReal = [] }) {
  if (!parcelas.length) return null;
  const linhaReal = replayHistorico(config, parcelas, extras, premissas);
  const ult = linhaReal.meses[linhaReal.meses.length - 1];
  const { taxaNominalAA, valorAvaliacao, taxaOperacional } = config.contrato;
  // FGTS: parte do saldo informado mais recente (o saldo inicial da Config, preenchido uma vez, ou um lançado), desconta
  // os usos depois dele e soma, de cada mês seguinte até o anterior à projeção, rendimento (sem TR) e depósito (dezembro em dobro)
  const ini = config.inicial ?? {}, dep = ini.depositoMensalFGTS ?? 0, rend = (1 + (premissas.fgtsRendAA ?? 0.03)) ** (1 / 12);
  const depositos = ini.depositosFGTS?.length ? [...ini.depositosFGTS].sort((a, b) => (a.desde < b.desde ? -1 : 1)) : undefined;
  // saldoFGTSAtual / dataSaldoFGTS: nomes antigos do que a tela chama de saldo inicial
  const movs = ini.saldoFGTSAtual != null && ini.dataSaldoFGTS ? [...fgtsReal, { data: ini.dataSaldoFGTS, tipo: 'saldo-informado', valor: ini.saldoFGTSAtual }] : fgtsReal;
  const base = movs.filter(m => m.tipo === 'saldo-informado').map(m => m.data).sort().pop();
  let sf = saldoFGTSReal(movs);
  const comp0 = proxComp(ult.competencia);
  // ponytail: usos descontados de uma vez, sem tirar o rendimento deles depois da data do uso (centavos)
  if (sf != null) for (let c = proxComp(base.slice(0, 7)); c < comp0; c = proxComp(c)) sf = sf * rend + depositoFGTS({ deposito: dep, depositos }, c) * (c.endsWith('-12') ? 2 : 1);
  const pu = proximoUsoFGTS(fgtsReal, regraFGTSPrestacao(premissas).janela);
  const credito = creditoFGTSPrestacao(fgtsReal, parcelas); // pedido de FGTS nas prestações ainda abatendo
  const fgts = { saldo: sf ?? 0, livreEm: pu?.slice(0, 7) ?? null, deposito: dep, depositos, ...(credito && { credito }),
    aviso: sf == null ? 'Saldo do FGTS nunca informado: usando 0.' : null };
  return { competencia: comp0, ...linhaReal.estado, fatorTR: ult.fatorTR, fgts,
    contrato: { taxaNominalAA, valorAvaliacao, taxaOperacional },
    // o que patrimonio.js precisa do config (valorCompra, documentação, assinatura, vencimento, financiado)
    cfg: { contrato: { dataAssinatura: config.contrato.dataAssinatura, valorFinanciado: config.contrato.valorFinanciado, diaVencimento: config.contrato.diaVencimento },
      inicial: { entradaDinheiro: config.inicial?.entradaDinheiro ?? null, entradaFGTS: config.inicial?.entradaFGTS ?? null, documentacao: config.inicial?.documentacao ?? null } },
    faixasVistas: [...new Set(linhaReal.meses.map(m => m.calc.faixa))], linhaReal };
}

/**
 * TR do mês pela premissa. Modo curva: vale o último ponto com desde ≤ mês (antes do 1º ponto, vale o 1º).
 * Modo vinculadaSelic ({ piso, fator }): max(0, fator × (selic − piso)); `selic` = Selic a.a. do mês (selicDe).
 */
export function trDe(trMensal, comp, selic) {
  switch (trMensal.modo) {
    case 'curva': {
      const ps = [...trMensal.pontos].sort((a, b) => (a.desde < b.desde ? -1 : 1));
      return (ps.filter(p => p.desde <= comp).pop() ?? ps[0]).valor;
    }
    case 'vinculadaSelic':
      if (selic == null) throw new Error('TR vinculada à Selic precisa da Selic das premissas.');
      return trVinculada(trMensal, selic);
    default: throw new Error(`Modo de TR desconhecido: ${trMensal.modo}`);
  }
}

const extraDe = (orc, comp) => (orc?.meses?.[comp]?.confirmado ? orc.meses[comp].extra ?? 0 : 0);
const teto2 = x => Math.ceil(x * 100 - 1e-6) / 100;
export const APORTE_MIN = -0.10; // a Caixa aceita PMT novo ~R$ 0,05 acima; o aporte pode ficar uns centavos negativo

/** Regras prontas (derivadas do orçamento na hora): amortBolso do mês. `manual` usa só meses confirmados. `extra` já inclui o bolso liberado pelo FGTS na prestação. */
function planoDoMes(cenario, comp, extra) {
  const r = cenario.regra ?? 'manual';
  if (r === 'manual') { const p = cenario.meses?.[comp]; return p?.confirmado ? p : {}; }
  if (r === 'referencia') return {};
  return { amortBolso: extra * (r === 'amortizarTudo' ? 1 : r === 'investirTudo' ? 0 : r.dividir) };
}

/**
 * Projeta mês a mês até a quitação (ou até `ate`, 'YYYY-MM': depois de quitar sobram meses com saldo 0, encargo 0
 * e aporte = orçamento). Extra do cenário acontece no vencimento, depois da parcela; ordem: FGTS, resgate, bolso.
 * Orçamento do mês = base[mês] + extra confirmado; `base` = encargo da referência (padrão: o encargo do próprio
 * cenário). Sem orçamento nem base, aporte fica null. FGTS (se `estado.fgts`): rende e recebe depósito no mês, e só
 * pode ser usado desde `livreEm`; projetar não recusa nada (quem recusa é `validarMes`).
 * FGTS nas prestações (cenario.fgtsPrestacao, e o pedido real em curso em `estado.fgts.credito`): no mês do pedido o
 * valor sai todo do FGTS; cada mês do período abate valor/meses da prestação (`fgtsPrestacao`), e o resto fica em
 * `fgtsCredito` (ainda é do usuário: entra no patrimônio).
 * Valor de corte: com `usarValorDeCorte`, amortBolso cai até o corte do prazo que alcança e a sobra vira aporte.
 */
export function projetar(estado, cenario, orcamento, premissas, { base, ate } = {}) {
  const fpc = estado.fgts && cenario.fgtsPrestacao?.modo ? cenario.fgtsPrestacao : null;
  const fpDesde = fpc?.modo === 'auto' ? inicioAutoFGTSPrestacao(projetar(estado, { ...cenario, fgtsPrestacao: undefined }, orcamento, premissas, { base, ate })) : null;
  const i = taxaMensal(estado.contrato);
  let { saldo, pmt, prazo, fatorTR: fator, competencia: comp } = estado;
  const vistas = new Set(estado.faixasVistas);
  const fg = estado.fgts ? { ...estado.fgts } : null;
  const rend = (1 + (premissas.fgtsRendAA ?? 0.03)) ** (1 / 12);
  const auto = !['manual', 'referencia', undefined].includes(cenario.regra);
  // regra pronta: usarFGTS liga o FGTS em toda janela. Manual com usarFGTS: depois do 1º uso digitado, cada janela usa o saldo todo.
  let fgtsAuto = auto && (cenario.usarFGTS ?? cenario.regra === 'amortizarTudo');
  const rfp = regraFGTSPrestacao(premissas); // FGTS nas prestações (cenario.fgtsPrestacao; o automático começa em fpDesde)
  // período em curso: { mes, n, porMes, restante }; começa com o pedido real ainda não consumido, se houver
  const cr = fg?.credito;
  let bloco = cr?.meses > 0 && cr.restante > 0.005 ? { mes: 0, n: cr.meses, porMes: cr.porMes, restante: cr.restante } : null, pedidos = 0;
  const podePedir = c => !!fpc && (fpc.modo === 'auto' ? !!fpDesde && c >= fpDesde : c >= fpc.inicio && (!!fpc.renovar || pedidos === 0));
  const meses = []; let custo = 0;
  // carteira por lotes: só existe com orçamento (sem ele o aporte é null e carteiraBruta/Liquida ficam null)
  let lotes = orcamento || base ? [] : null;
  const dia = estado.cfg?.contrato?.diaVencimento ?? 5, opc = { dia, isentoIR: !!premissas.isentoIR };
  while ((prazo > 0 && saldo > 0) || comp <= (ate ?? '')) {
    const selic = premissas.selic ? selicDe(premissas.selic, comp, estado.competencia) : null;
    const tr = trDe(premissas.trMensal, comp, selic);
    const data = dataMes(comp, dia);
    let disp = null; // carteira líquida disponível no mês (depois do rendimento, antes dos movimentos)
    if (lotes) { lotes = render(lotes, cdiDe(selic ?? 0, premissas.cdiSpread), premissas.pctCDI ?? 1); disp = liquidoCarteira(lotes, data, opc); }
    const ativo = prazo > 0 && saldo > 0;
    let fgDisp = 0;
    // 13º: dezembro deposita em dobro
    if (fg) { fg.saldo = fg.saldo * rend * (1 + tr) + depositoFGTS(fg, comp) * (comp.endsWith('-12') ? 2 : 1); fgDisp = comp >= (fg.livreEm ?? '') ? fg.saldo : 0; }
    let fgtsPrestacao = 0, fpMes = null, fpFim = false, fgtsPedido = 0, fgtsPedidoTeto = null;
    const ex = { amortBolso: 0, amortFGTS: 0, resgate: 0 };
    let p = { saldoCorrigido: 0, juros: 0 }, sg = { mip: 0, dfi: 0 }, amortizacao = 0, pmtMes = 0, saldoAposParcela = 0, taxa = 0;
    let resto = 0, proxPmt = pmt, corte = null, fx = null, encargo = 0; const eventos = [];
    if (ativo) {
      p = passoMes({ saldo, pmt }, { tr, i });
      fator *= 1 + tr;
      sg = seguros(p.saldoCorrigido, estado.contrato.valorAvaliacao * fator, premissas);
      taxa = estado.contrato.taxaOperacional;
      prazo -= 1;
      ({ amortizacao, pmt: pmtMes, saldoFinal: saldoAposParcela } = p);
      if (prazo === 0 || saldoAposParcela <= 0) { // última parcela: a amortização zera o saldo
        prazo = 0; amortizacao = p.saldoCorrigido; pmtMes = amortizacao + p.juros; saldoAposParcela = 0;
      }
      encargo = r2(pmtMes) + r2(sg.mip) + r2(sg.dfi) + taxa;
      if (fg) { // FGTS na prestação: no vencimento, antes da amortização extra; não depende da janela de 24 meses
        if (!bloco && podePedir(comp)) { // pedido: 12 meses ou o prazo restante; sai todo do FGTS agora
          const n = Math.min(FGTS_PRESTACAO_MESES, prazo + 1);
          fgtsPedidoTeto = tetoPedidoFGTS(rfp, { pmt: pmtMes, encargo }, n);
          const v = Math.floor(Math.min(fpc.valor ?? Infinity, fgtsPedidoTeto, fg.saldo) * 100 + 1e-6) / 100;
          if (v >= 0.01) { fg.saldo -= v; fgtsPedido = v; pedidos++; bloco = { mes: 0, n, porMes: v / n, restante: v }; }
        }
        if (bloco) {
          bloco.mes++; fpMes = bloco.mes; fpFim = bloco.mes >= bloco.n;
          fgtsPrestacao = Math.min(fpFim ? bloco.restante : bloco.porMes, bloco.restante, encargo);
          bloco.restante -= fgtsPrestacao;
        }
        fgDisp = comp >= (fg.livreEm ?? '') && !(bloco && rfp.janela === 'bloqueiaDurante') ? fg.saldo : 0;
      }
      // regra pronta: o bolso liberado pelo FGTS na prestação entra como extra do mês (amortiza, divide ou investe conforme a regra)
      const pl = planoDoMes(cenario, comp, extraDe(orcamento, comp) + fgtsPrestacao);
      resto = saldoAposParcela; proxPmt = pmtMes;
      const fgtsDigitado = pl.amortFGTS ?? 0;
      ex.amortFGTS = Math.min(fgtsAuto && !(fgtsDigitado > 0) ? fgDisp : fgtsDigitado, resto); resto -= ex.amortFGTS;
      if (!auto && cenario.usarFGTS && fgtsDigitado > 0) fgtsAuto = true;
      ex.resgate = Math.min(pl.resgate ?? 0, resto, disp ?? Infinity); resto -= ex.resgate;
      let b = Math.min(pl.amortBolso ?? 0, resto);
      if (b > 0 && resto - b > 0.005) {
        corte = valorDeCorte(resto, pmtMes, prazoAposAmortizacao(resto - b, pmtMes, i).nNovo, i);
        if (cenario.usarValorDeCorte) b = Math.max(0, Math.min(b, teto2(corte)));
      }
      ex.amortBolso = b; resto -= b;
      const total = ex.amortBolso + ex.amortFGTS + ex.resgate;
      if (resto <= 0.005 && total > 0) { resto = 0; prazo = 0; }
      else if (total > 0) ({ nNovo: prazo, pmtNovo: proxPmt } = prazoAposAmortizacao(resto, pmtMes, i));
      fx = faixa({ amortizacao, juros: p.juros, trValor: saldo * tr });
      if (total > 0) eventos.push('extra');
      if (ex.amortFGTS > 0) eventos.push('fgts');
      if (!vistas.has(fx)) { vistas.add(fx); eventos.push(`marco-faixa-${fx}`); }
    }
    const livre = fg ? fg.livreEm ?? null : null;
    if (fg && ex.amortFGTS > 0) { fg.saldo -= ex.amortFGTS; fg.livreEm = somaMeses(comp + '-01', 24).slice(0, 7); }
    if (fpFim && rfp.janela === 'reiniciaNoFim') { const l = somaMes(comp, 24); if (l > (fg.livreEm ?? '')) fg.livreEm = l; }
    // fim do período, ou a dívida acabou antes dele: o que sobrou do pedido volta ao FGTS (hipótese do app)
    if (bloco && (fpFim || !(prazo > 0 && resto > 0))) { fg.saldo += Math.max(0, bloco.restante); bloco = null; }
    if (fgtsPedido > 0) eventos.push('fgts-pedido');
    if (fgtsPrestacao > 0) eventos.push('fgts-prestacao');
    // do bolso sai só a parte da parcela que o FGTS não pagou: com o mesmo orçamento, o aporte sobe
    const doBolso = encargo - fgtsPrestacao;
    const orc = orcamento || base ? (base ? base[comp] ?? 0 : encargo) + extraDe(orcamento, comp) : null;
    const aporte = orc == null ? null : orc - doBolso - ex.amortBolso;
    custo += doBolso + ex.amortBolso + (aporte ?? 0);
    if (lotes) { // resgate para amortizar e aporte negativo saem FIFO; aporte positivo vira lote novo
      if (ex.resgate > 0) lotes = resgatar(lotes, ex.resgate, data, opc).lotes;
      if (aporte > 0) lotes = aportar(lotes, comp, aporte);
      else if (aporte < 0) lotes = resgatar(lotes, Math.min(-aporte, liquidoCarteira(lotes, data, opc)), data, opc).lotes;
    }
    meses.push({ competencia: comp, trMes: tr, saldoInicial: ativo ? saldo : 0, saldoCorrigido: p.saldoCorrigido, juros: p.juros,
      amortizacao, pmt: pmtMes, mip: sg.mip, dfi: sg.dfi, taxa, encargo, saldoAposParcela, ...ex,
      orcamento: orc, aporte, custoBolso: custo, valorCorte: corte, carteiraBruta: lotes ? soma(lotes, l => l.valor) : null,
      carteiraLiquida: lotes ? liquidoCarteira(lotes, data, opc) : null, carteiraDisponivel: disp,
      fgtsSaldo: fg ? fg.saldo : null, fgtsDisponivel: fgDisp, fgtsLivreEm: livre, fgtsPrestacao, fgtsPrestacaoMes: fpMes,
      fgtsPedido, fgtsPedidoTeto, fgtsCredito: bloco ? bloco.restante : 0,
      saldoFinal: resto, prazoRestante: prazo, faixa: fx, eventos });
    saldo = resto; pmt = proxPmt; comp = proxComp(comp);
  }
  return meses;
}

export const resumo = meses => ({
  quitacao: meses.filter(m => m.saldoInicial > 0).pop()?.competencia ?? null,
  totalJuros: soma(meses, m => m.juros),
  totalTR: soma(meses, m => m.saldoCorrigido - m.saldoInicial),
  totalSeguros: soma(meses, m => m.mip + m.dfi),
  totalTaxas: soma(meses, m => m.taxa),
  custoBolso: meses.length ? meses[meses.length - 1].custoBolso : 0,
  usoFGTS: soma(meses, m => m.amortFGTS + (m.fgtsPrestacao ?? 0)),
  usoFGTSPrestacao: soma(meses, m => m.fgtsPrestacao ?? 0),
});

// Arredondamento só do que é gravado (as contas de projetar seguem em precisão total). Listas explícitas por campo.
const DINHEIRO = 'saldoInicial saldoCorrigido juros amortizacao pmt mip dfi taxa encargo saldoAposParcela amortBolso amortFGTS resgate orcamento aporte custoBolso valorCorte carteiraBruta carteiraLiquida carteiraDisponivel fgtsSaldo fgtsDisponivel fgtsPrestacao fgtsPedido fgtsCredito saldoFinal'.split(' ');
const DINHEIRO_RESUMO = 'totalJuros totalTR totalSeguros totalTaxas custoBolso usoFGTS usoFGTSPrestacao'.split(' ');
const dec = (x, n) => (x == null ? x : Number(x.toFixed(n))); // casas decimais fixas: 2 em reais, 8 em taxas, 10 em fatores

const arred = (o, campos) => { for (const c of campos) if (c in o) o[c] = dec(o[c], 2); return o; };
// FGTS nas prestações só entra no registro dos meses em que está ligado (enxuto; quem lê usa `?? 0`)
const mesGravado = ({ fgtsPrestacao, fgtsPrestacaoMes, fgtsPedido, fgtsPedidoTeto, fgtsCredito, ...m }) =>
  ({ ...arred({ ...m, ...(fgtsPrestacaoMes != null && { fgtsPrestacao, fgtsPrestacaoMes, fgtsCredito }), ...(fgtsPedido > 0 && { fgtsPedido }) }, DINHEIRO), trMes: dec(m.trMes, 8) });
function estadoGravado(e) {
  const g = arred({ ...e }, ['saldo', 'pmt']);
  g.fatorTR = dec(e.fatorTR, 10);
  g.contrato = { ...e.contrato, taxaNominalAA: dec(e.contrato.taxaNominalAA, 10), ...arred({ valorAvaliacao: e.contrato.valorAvaliacao, taxaOperacional: e.contrato.taxaOperacional }, ['valorAvaliacao', 'taxaOperacional']) };
  if (e.fgts) g.fgts = arred({ ...e.fgts, ...(e.fgts.credito && { credito: arred({ ...e.fgts.credito }, ['porMes', 'restante']) }) }, ['saldo', 'deposito']);
  return g;
}

/** Registro completo de `versoes` (nunca editado depois). Recebe cópias: o que vai no snapshot não muda depois. */
export function criarVersao({ cenario, motivo, estado, orcamento, premissas, agora, meses: prontos }) {
  const { linhaReal, ...inicial } = estado;
  const cheios = prontos ?? projetar(estado, cenario, orcamento, premissas);
  return { cenarioId: cenario.id, criadaEm: agora, motivo, premissasSnapshot: structuredClone(premissas),
    estadoInicialSnapshot: structuredClone(estadoGravado(inicial)), meses: cheios.map(mesGravado), resumo: arred(resumo(cheios), DINHEIRO_RESUMO) };
}

/**
 * Meses reais normalizados para a divergência. Por mês (vencimento k): `feito` = extras com data em [venc k, venc k+1);
 * `saldoFinal` = saldo depois dessas extras (= saldoAnt do mês seguinte, ou o estado atual no último).
 */
export function mesesReais(linhaReal, extrasReais, parcelas = []) {
  const pagos = new Map(parcelas.filter(p => p.seguros != null).map(p => [p.competencia, p.seguros]));
  const ms = linhaReal.meses;
  return ms.map((m, k) => {
    const prox = ms[k + 1];
    return { competencia: m.competencia, saldoAnt: m.saldoAnt, saldoFinal: prox ? prox.saldoAnt : linhaReal.estado.saldo,
      trMes: m.calc.trMes, seguros: pagos.get(m.competencia) ?? m.calc.mip + m.calc.dfi,
      feito: soma(extrasReais.filter(e => e.data >= m.vencimento && (!prox || e.data < prox.vencimento)), e => e.valor) };
  });
}

const planejadoDe = m => m.amortBolso + m.amortFGTS + m.resgate;

/**
 * Divergência de um mês real contra o mês da versão (mesReal vem de `mesesReais`; `seguros` pode vir pago de verdade).
 * Medida no SALDO DEVEDOR depois do mês (depois das extras): positivo = real acima do previsto.
 *  execucao: amortização planejada × feita no mês; efeito no saldo = planejado − feito.
 *  modelo: TR ≈ saldoAnt × (trReal − trPrevista); Seguros = pago − previsto (em R$, fora do saldo);
 *          Arredondamento/outros = o que sobra do saldo depois de TR e execução.
 *  total = Σ linhas do modelo + (planejado − feito) = Δsaldo + diferença de seguros.
 */
export function divergencia(mesReal, mesVersao) {
  const planejado = planejadoDe(mesVersao), feito = mesReal.feito;
  const tr = mesReal.saldoAnt * (mesReal.trMes - mesVersao.trMes);
  const seg = mesReal.seguros - (mesVersao.mip + mesVersao.dfi);
  const outros = (mesReal.saldoFinal - mesVersao.saldoFinal) - (planejado - feito) - tr;
  const modelo = [{ rotulo: 'TR', valor: tr }, { rotulo: 'Seguros', valor: seg }, { rotulo: 'Arredondamento/outros', valor: outros }];
  return { modelo, execucao: { planejado, feito }, total: soma(modelo, l => l.valor) + planejado - feito };
}

/**
 * Acumulada desde o 1º mês da versão até o último mês real: TR, seguros e execução somam mês a mês; "outros" é o que
 * sobra do saldo no último mês comum (as diferenças de saldo já são cumulativas). Chamador: versão do mês anterior
 * (padrão) ou a primeira do cenário.
 */
export function divergenciaAcumulada(linhaReal, extrasReais, versao, parcelas = []) {
  const vm = new Map(versao.meses.map(m => [m.competencia, m]));
  const pares = mesesReais(linhaReal, extrasReais, parcelas).filter(r => vm.has(r.competencia)).map(r => [r, vm.get(r.competencia)]);
  if (!pares.length) return { modelo: [], execucao: { planejado: 0, feito: 0 }, total: 0 };
  const ds = pares.map(([r, v]) => divergencia(r, v));
  const [rU, vU] = pares[pares.length - 1];
  const planejado = soma(ds, d => d.execucao.planejado), feito = soma(ds, d => d.execucao.feito);
  const tr = soma(ds, d => d.modelo[0].valor), seg = soma(ds, d => d.modelo[1].valor);
  const outros = (rU.saldoFinal - vU.saldoFinal) - (planejado - feito) - tr;
  const modelo = [{ rotulo: 'TR', valor: tr }, { rotulo: 'Seguros', valor: seg }, { rotulo: 'Arredondamento/outros', valor: outros }];
  return { modelo, execucao: { planejado, feito }, total: tr + seg + outros + planejado - feito };
}

/**
 * Conjunto `padrao` completo + mapa `origem`. `existente` = premissa já gravada (mantém mipTaxa/dfiTaxa).
 * TR = média dos últimos 12 meses reais/reconstruídos, em curva de um ponto. Taxas sempre em decimal.
 */
export function premissasPadrao(linhaReal, existente = {}) {
  const ult = linhaReal.meses.slice(-12);
  const tr = ult.length ? soma(ult, m => m.calc.trMes) / ult.length : 0.0017;
  const selicAtual = existente.selic?.atual ?? 0.1375;
  const mip = existente.mipTaxa ?? 0.00008494, dfi = existente.dfiTaxa ?? 0.00007095;
  return { id: 'padrao', nome: 'Padrão',
    trMensal: { modo: 'vinculadaSelic', piso: PISO_TR, fator: tr / (selicAtual - PISO_TR) }, // TR(selic atual) = média dos 12 meses
    selic: { atual: selicAtual, longoPrazo: 0.105, anosAteLongoPrazo: 3 },
    cdiSpread: -0.001, pctCDI: 1, isentoIR: false, ipcaAA: 0.043, valorizacaoImovelAA: 0.05, custoVendaPct: 0.06,
    irGanhoCapitalImovel: true, fgtsRendAA: 0.03, ...PADRAO_FGTS_PRESTACAO, mipTaxa: mip, dfiTaxa: dfi,
    origem: { trMensal: `vinculada à Selic: máx(0, fator × (Selic − ${PISO_TR * 100}%)), fator calibrado na média dos últimos ${ult.length} meses reais/reconstruídos`,
      'selic.atual': 'Copom 16/09/2026; decisão de 04/11/2026 a confirmar', 'selic.longoPrazo': 'estimativa editável',
      'selic.anosAteLongoPrazo': 'estimativa editável', cdiSpread: 'CDI = Selic − 0,10 p.p. (mercado)',
      pctCDI: 'decisão de design (CDB 100% do CDI)', isentoIR: 'decisão de design (com IR)',
      ipcaAA: 'Focus, projeção 2027, out/2026 — conferir', valorizacaoImovelAA: 'planilha dele',
      custoVendaPct: 'corretagem', irGanhoCapitalImovel: 'conservador (15%)', fgtsRendAA: 'lei (3% a.a. + TR)',
      fgtsPrestacaoPct: 'Caixa: até 80% da prestação; o pedido sai todo do FGTS e abate em 12 meses', fgtsPrestacaoBase: 'não confirmado com a Caixa: escolha do usuário',
      fgtsPrestacaoJanela: 'não confirmado com a Caixa: escolha do usuário',
      mipTaxa: 'calibrada no histórico', dfiTaxa: 'calibrada no histórico' } };
}

// ---- Fase 5: grupo de comparação, validação e prévia

/** Encargo mensal da referência (contrato sem extras): é a "parcela" do orçamento de qualquer cenário do grupo. */
export const baseReferencia = (estado, premissas) =>
  Object.fromEntries(projetar(estado, { regra: 'referencia' }, null, premissas).map(m => [m.competencia, m.encargo]));

/**
 * Projeta o grupo no mesmo orçamento: { [cenarioId]: meses }. Orçamento = encargo da referência + extra; todos vão até
 * a quitação mais tardia (quem quita antes segue com saldo 0 e aporte = orçamento), então o custo do bolso é igual.
 */
export function projetarGrupo(estado, cenarios, orcamento, premissasPorId) {
  const pr = c => premissasPorId[c.premissasId];
  const ref = cenarios.find(c => c.regra === 'referencia') ?? cenarios[0];
  const refM = projetar(estado, ref, orcamento, pr(ref));
  const base = Object.fromEntries(refM.map(m => [m.competencia, m.encargo]));
  const ult = ms => ms[ms.length - 1]?.competencia ?? '';
  const rodada = Object.fromEntries(cenarios.map(c => [c.id, c === ref ? refM : projetar(estado, c, orcamento, pr(c), { base })]));
  const ate = Object.values(rodada).map(ult).sort().pop();
  return Object.fromEntries(cenarios.map(c => [c.id, ult(rodada[c.id]) >= ate ? rodada[c.id] : projetar(estado, c, orcamento, pr(c), { base, ate })]));
}

const comMes = (cen, comp, v) => ({ ...cen, meses: { ...cen.meses, [comp]: { amortBolso: v.amortBolso ?? 0, amortFGTS: v.amortFGTS ?? 0, resgate: v.resgate ?? 0, confirmado: true } } });
const comExtra = (orc, comp, v) => (v.extra == null ? orc : { ...orc, meses: { ...orc?.meses, [comp]: { extra: v.extra, confirmado: true } } });
const noMes = (ms, comp) => ms.find(m => m.competencia === comp);

/**
 * FGTS nas prestações no mês projetado `m`: erros (configuração inválida, amortizar com FGTS no período quando a
 * premissa bloqueia) e avisos (saldo do FGTS não cobre o teto: paga só o que tem).
 */
function checarFGTSPrestacao(estado, cenario, premissas, m, v = {}) {
  const erros = errosFGTSPrestacao(estado, cenario.fgtsPrestacao), avisos = [];
  if (!m) return { erros, avisos };
  const rg = regraFGTSPrestacao(premissas);
  if (m.fgtsPrestacaoMes && rg.janela === 'bloqueiaDurante' && v.amortFGTS > 0) erros.push('FGTS bloqueado: está pagando prestações com FGTS neste mês e a premissa não deixa amortizar com FGTS ao mesmo tempo.');
  // pedido no mês: o saldo do FGTS precisa estar lá inteiro; com menos, o pedido é menor (ou não sai)
  const quer = Math.min(cenario.fgtsPrestacao?.valor ?? Infinity, m.fgtsPedidoTeto ?? 0);
  if (m.fgtsPedidoTeto != null && (m.fgtsPedido ?? 0) < quer - 0.005) avisos.push(m.fgtsPedido > 0
    ? `O saldo do FGTS no pedido cobre só ${m.fgtsPedido.toFixed(2)} de ${quer.toFixed(2)} (até ${Math.round(rg.pct * 100)}% da prestação × ${Math.round(m.fgtsPedidoTeto / tetoFGTSPrestacao(rg, m))} meses): abate ${m.fgtsPrestacao.toFixed(2)} por mês.`
    : 'Sem saldo de FGTS para o pedido neste mês: a prestação sai toda do bolso e o pedido fica para quando houver saldo.');
  return { erros, avisos };
}

/** Valida os valores de um mês do cenário (`v` = { amortBolso, amortFGTS, resgate, extra? }). → { ok, erros, avisos }. */
export function validarMes(estado, cenario, orcamento, premissas, comp, v) {
  const ms = projetar(estado, comMes(cenario, comp, v), comExtra(orcamento, comp, v), premissas, { base: baseReferencia(estado, premissas), ate: comp });
  const m = noMes(ms, comp), erros = [];
  if (!m) return { ok: false, erros: ['Mês fora da projeção.'], avisos: [] };
  const fp = checarFGTSPrestacao(estado, cenario, premissas, m, v);
  erros.push(...fp.erros);
  if (v.amortFGTS > 0 && estado.fgts) {
    if (m.fgtsLivreEm > comp) erros.push(`FGTS bloqueado: só pode amortizar de novo a partir de ${m.fgtsLivreEm} (24 meses desde o último uso).`);
    else if (v.amortFGTS > m.fgtsDisponivel + 0.005) erros.push(`FGTS insuficiente: saldo projetado ${m.fgtsDisponivel.toFixed(2)}${m.fgtsPrestacao > 0 ? ' depois da parte da prestação' : ''}.`);
  }
  if (v.resgate > (m.carteiraDisponivel ?? 0) + 0.005) erros.push(`Resgate acima da carteira líquida do mês (${(m.carteiraDisponivel ?? 0).toFixed(2)}).`);
  if (m.aporte < APORTE_MIN) erros.push(`Aporte negativo (${m.aporte.toFixed(2)}): amortiza mais do que o orçamento permite.`);
  return { ok: !erros.length, erros, avisos: fp.avisos };
}

/** Cenário com o mês confirmado; recusa (Error com o motivo) o que `validarMes` recusa. */
export function definirMes(estado, cenario, orcamento, premissas, comp, v) {
  const { ok, erros } = validarMes(estado, cenario, orcamento, premissas, comp, v);
  if (!ok) throw new Error(erros.join(' '));
  return comMes(cenario, comp, v);
}

/** Próxima janela de amortização com FGTS na projeção: { abreEm, saldoProjetado, ultimoUso } (null sem FGTS). */
export function janelaFGTS(meses) {
  if (!meses.length || meses[0].fgtsSaldo == null) return null;
  const m = meses.find(x => !(x.fgtsLivreEm > x.competencia));
  const livre = meses[0].fgtsLivreEm;
  return { abreEm: m?.competencia ?? null, saldoProjetado: m?.fgtsDisponivel ?? null,
    ultimoUso: livre ? somaMeses(livre + '-01', -24).slice(0, 7) : null };
}

/**
 * Prévia do que muda ao confirmar `v` no mês `comp`. Não grava nada. `horizonte` = anos desde hoje (estado.competencia)
 * para o patrimônio; `deltaPatrimonio` = com a ação − sem a ação (mesmo orçamento); `fator` = (1 + IPCA)^horizonte.
 */
export function previa(estado, cenario, orcamento, premissas, comp, v, horizonte = 10) {
  const base = baseReferencia(estado, premissas), o = comExtra(orcamento, comp, v);
  const hc = somaMeses(estado.competencia + '-01', 12 * horizonte).slice(0, 7), op = { base, ate: hc > comp ? hc : comp };
  const nova = projetar(estado, comMes(cenario, comp, v), o, premissas, op);
  const semMs = projetar(estado, comMes(cenario, comp, {}), o, premissas, op);
  const sem = noMes(semMs, comp), m = noMes(nova, comp);
  if (!m || !sem) return null;
  const pat = ms => (estado.cfg && noMes(ms, hc) ? patrimonioMes(estado.cfg, premissas, noMes(ms, hc)) : null);
  const patrimonio = pat(nova);
  return { mesesReduzidos: sem.prazoRestante - m.prazoRestante, valorDeCorte: m.valorCorte,
    sobraParaCarteira: cenario.usarValorDeCorte && m.valorCorte != null ? Math.max(0, (v.amortBolso ?? 0) - m.amortBolso) : 0,
    novaQuitacao: resumo(nova).quitacao, novaParcela: nova[nova.indexOf(m) + 1]?.encargo ?? 0, aporte: m.aporte,
    fgtsPrestacao: m.fgtsPrestacao, avisos: checarFGTSPrestacao(estado, cenario, premissas, m, v).avisos,
    patrimonio, deltaPatrimonio: patrimonio == null ? null : patrimonio - pat(semMs), horizonte, fator: deflator(premissas.ipcaAA ?? 0, horizonte) };
}
