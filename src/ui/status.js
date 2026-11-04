// Tela Status: desenha o resultado de painelStatus (src/paineis.js). Sem cálculo próprio além de formatação.
import { carregarDados } from './dados.js';
import { painelStatus } from '../paineis.js';
import { $, $$, esc, R, RS, N, PC, ic, FX, fbadge, dataBR, dataHora, anosEMeses, xDe, rotX, interp, marcasAno, donut, lineChart, attachHover } from './comum.js';

// estado da tela (sobrevive às remontagens)
const st = { filter: 'prev', n: 8, divv: 'mes', contra: 'anterior', sel: null };
const COR = { entradaDinheiro: 'var(--s6)', entradaFGTS: 'var(--s7)', documentacao: 'var(--s5)', principalDevolvido: 'var(--s3)', segurosTaxas: 'var(--s4)', tr: 'var(--s2)', juros: 'var(--s1)' };
const mk = (lab, cl) => `<span style="display:flex;align-items:center;gap:6px"><i class="dot" style="background:${cl}"></i>${lab}</span>`;

const evHTML = e => (e.tipo === 'amortizacao'
  ? `<span class="ev ${e.origem === 'fgts' ? 'fgts' : 'am'}">${ic('amort', 13)}${e.origem === 'resgate' ? 'Resgate da carteira' : 'Amortização' + (e.origem === 'fgts' ? ' FGTS' : '')} ${R(e.valor)}</span>`
  : e.tipo === 'janela-fgts' ? `<span class="ev jan">${ic('cal', 13)}Janela do FGTS abre${e.saldo != null ? ' · ' + R(e.saldo, 0) : ''}</span>` : '');

function rowHTML(r) {
  const a = Math.max(0, r.amortizacao), tr = Math.max(0, r.tr), j = Math.max(0, r.juros), t = (a + tr + j) || 1;
  const bar = `<div class="bar thin" role="img" aria-label="Amortização ${N(r.amortizacao)}, TR ${N(r.tr)}, juros ${N(r.juros)}"><i style="width:${a / t * 100}%;background:var(--s3)"></i><i style="width:${tr / t * 100}%;background:var(--s2)"></i><i style="width:${j / t * 100}%;background:var(--s1)"></i></div>`;
  const ev = r.eventos.map(evHTML).join('');
  return `<li class="mrow">${fbadge(r.faixa ?? 1)}<div class="mmain"><div class="mtop"><b>${r.rotulo}</b><span class="tag ${r.real ? '' : 'warn'}">${r.real ? 'Real' : 'Previsto'}</span><span class="amt">${R(r.encargo)}</span></div>${bar}
   <div class="mvals"><span><i class="dot" style="background:var(--s3)"></i>Amort. ${N(r.amortizacao)}</span><span><i class="dot" style="background:var(--s2)"></i>TR ${N(r.tr)}</span><span><i class="dot" style="background:var(--s1)"></i>Juros ${N(r.juros)}</span></div>${ev ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${ev}</div>` : ''}</div></li>`;
}

function marcoHTML(r, p) {
  const m = r.real ? null : r.eventos.find(e => e.tipo === 'marco-faixa' && e.faixa >= 2);
  if (!m) return '';
  const q = p.marcos.referencia.find(x => x.faixa === m.faixa);
  return `<li class="marco" style="list-style:none">${ic('flag', 18)}<div><b>Marco · ${r.rotulo}</b><br>${FX[m.faixa][0]}: ${FX[m.faixa][2]}. ${q ? `Sem amortização extra seria em ${q.rotulo}.` : 'Sem amortização extra, não chega a essa faixa.'}</div></li>`;
}

function listaMeses(p) {
  const real = p.serie.filter(r => r.real), prev = p.serie.filter(r => !r.real);
  let rows, maxN = 0;
  if (st.filter === 'prev') { rows = prev.slice(0, st.n); maxN = prev.length; }
  else if (st.filter === 'real') { rows = real.slice().reverse().slice(0, st.n); maxN = real.length; }
  else rows = p.serie.filter(r => r.eventos.some(e => e.tipo !== 'marco-faixa'));
  const list = rows.map(r => (st.filter === 'real' ? '' : marcoHTML(r, p)) + rowHTML(r)).join('');
  return { list: list || '<li class="sub" style="padding:12px 0">Nada para mostrar.</li>', mais: maxN > st.n ? Math.min(8, maxN - st.n) : 0 };
}

function graficoSaldo(p, d) {
  const ini = p.ultimaParcela.competencia, pt = l => [[xDe(ini), p.saldoAtual], ...l.map(m => [xDe(m.competencia), m.saldo])];
  const ref = pt(p.serieSaldo.referencia), pl = pt(p.serieSaldo.plano);
  const x0 = Math.floor(ref[0][0]), x1 = Math.ceil(Math.max(ref.at(-1)[0], pl.at(-1)[0]));
  const dots = p.serieSaldo.marcos.plano.filter(m => m.faixa >= 2 && m.saldo != null).map(m => ({ x: xDe(m.competencia), y: m.saldo, color: `var(--f${m.faixa})` }));
  const ymax = Math.max(...ref.map(q => q[1]), ...pl.map(q => q[1]));
  return lineChart('st', { series: [{ pts: ref, color: 'var(--ink3)', dash: 1, w: 2 }, { pts: pl, color: 'var(--s1)' }], x0, x1, ymax, xt: marcasAno(x0, x1), dots,
    aria: 'Saldo devedor, plano ativo e contrato sem amortização extra',
    tip: x => `<b>${rotX(x)}</b><span>Plano <b>${R(interp(pl, x), 0)}</b></span><span>Sem extra <b>${R(interp(ref, x), 0)}</b></span>` });
}

function divergenciaHTML(p) {
  const dv = p.divergencia, bl = dv?.versao && (st.divv === 'mes' ? dv.mes : dv.acumulada);
  const segs = `<div class="seg" role="group" aria-label="Período"><button data-act="divv" data-v="mes" aria-pressed="${st.divv === 'mes'}">No mês</button><button data-act="divv" data-v="acum" aria-pressed="${st.divv === 'acum'}">Acumulada</button></div>
    <div class="seg" role="group" aria-label="Comparar com"><button data-act="contra" data-v="anterior" aria-pressed="${st.contra === 'anterior'}">Versão do mês</button><button data-act="contra" data-v="primeira" aria-pressed="${st.contra === 'primeira'}">1ª versão do plano</button></div>`;
  if (!bl) return `<article class="card"><div class="kicker">Real × previsto</div>${segs}<div class="sub">Ainda não há versão do plano que cubra o último mês real para comparar.</div></article>`;
  const mod = bl.modelo.reduce((a, b) => a + b.valor, 0), exe = bl.execucao.planejado - bl.execucao.feito;
  return `<article class="card"><div class="kicker">Real × previsto</div>${segs}
    <div class="row"><div class="h2">${st.divv === 'mes' ? dv.competencia.rotulo : 'Acumulada até ' + dv.competencia.rotulo}</div><span class="tag bad">saldo ${RS(bl.total)}</span></div>
    <div><div class="sub" style="font-weight:700;color:var(--ink);margin-bottom:4px">Modelo × Caixa <span class="muted">(${RS(mod)})</span></div>
    <dl class="dl" style="margin:0">${bl.modelo.map(m => `<dt>${esc(m.rotulo)}</dt><dd class="${m.valor > 0 ? 'neg' : ''}">${RS(m.valor)}</dd>`).join('')}</dl></div>
    <hr class="hr">
    <div><div class="sub" style="font-weight:700;color:var(--ink);margin-bottom:4px">Plano × execução <span class="muted">(${RS(exe)})</span></div>
    <dl class="dl" style="margin:0"><dt>Planejado amortizar</dt><dd>${R(bl.execucao.planejado)}</dd><dt>Amortizado de fato</dt><dd>${R(bl.execucao.feito)}</dd><dt>${exe < 0 ? 'Amortizou a mais' : 'Amortizou a menos'}</dt><dd class="${exe > 0 ? 'neg' : ''}">${RS(exe)}</dd></dl></div>
    <div class="sub">Positivo significa saldo real acima do previsto. Comparado com ${st.contra === 'anterior' ? 'a versão que previa o mês' : 'a primeira versão do plano ativo'}, de ${dataHora(dv.versao.criadaEm)}.</div></article>`;
}

/** HTML da tela a partir de `d` (dados preparados) e `p` (painelStatus). Puro. */
export function statusView(d, p) {
  const fin = d.config.contrato.valorFinanciado || 0, dev = p.totalPago.principalDevolvido, pct = fin > 0 ? dev / fin * 100 : 0;
  const pr = p.proximaParcela, enc = pr.encargo || 1, f = pr.faixa ?? 1;
  const dias = Math.round((Date.parse(pr.vencimento) - Date.parse(d.hoje)) / 864e5);
  const em = dias === 0 ? 'é hoje' : dias > 0 ? `em ${dias} ${dias === 1 ? 'dia' : 'dias'}` : `atrasada há ${-dias} ${dias === -1 ? 'dia' : 'dias'}`;
  const T = p.totalPago, G = T.total, itens = p.composicao.map(c => ({ ...c, c: COR[c.chave] }));
  const { list, mais } = listaMeses(p);
  const fx = [2, 3, 4].map(n => p.marcos.plano.find(x => x.faixa === n)).filter(Boolean);
  const atual = f, qRef = p.quitacaoReferencia?.rotulo, qPl = p.quitacaoPlano?.rotulo;
  return `
  <article class="card">
    <div class="kicker">Saldo devedor · após ${p.ultimaParcela.rotulo}</div>
    <div class="big">${R(p.saldoAtual)}</div>
    <div><div class="bar" role="img" aria-label="Principal devolvido ${PC(pct, 1)}"><i style="width:${Math.min(100, pct)}%;background:var(--s3)"></i></div>
    <div class="row sub" style="margin-top:6px"><span>Principal devolvido ${R(dev)}</span><span>${PC(pct, 1)}</span></div></div>
    <hr class="hr">
    <div class="grid2"><div class="kv"><small>Prazo restante</small><b>${p.prazoRestante} meses</b><small>${anosEMeses(p.prazoRestante)}</small></div>
    <div class="kv"><small>Quitação</small><b>${qRef ?? '—'}</b><small>Plano ativo: ${qPl ?? '—'}</small></div></div>
  </article>
  <article class="card">
    <div class="row"><div><div class="kicker">Próxima parcela</div><div class="sub">Vence ${dataBR(pr.vencimento)} · ${em}</div></div><span class="tag bad" title="${FX[f][2]}">${ic('f' + f, 13)} ${FX[f][0]}</span></div>
    <div class="mid">${R(pr.encargo)}</div>
    <div class="bar"><i style="width:${pr.amortizacao / enc * 100}%;background:var(--s3)"></i><i style="width:${pr.juros / enc * 100}%;background:var(--s1)"></i><i style="width:${(pr.seguros + pr.taxa) / enc * 100}%;background:var(--s4)"></i></div>
    <dl class="dl" style="margin:0">
      <dt>${mk('Amortização', 'var(--s3)')}</dt><dd>${R(pr.amortizacao)}</dd>
      <dt>${mk('Juros', 'var(--s1)')}</dt><dd>${R(pr.juros)}</dd>
      <dt>${mk('Seguros e taxa', 'var(--s4)')}</dt><dd>${R(pr.seguros + pr.taxa)}</dd>
    </dl>
    <div class="cutbox"${f === 1 ? ' style="background:color-mix(in srgb,var(--f1) 10%,var(--surface))"' : ''}>A TR do mês soma <b>${R(pr.tr)}</b> ao saldo e a amortização é ${R(pr.amortizacao)}. ${f === 1 ? 'Por isso o saldo ainda sobe com a parcela paga.' : FX[f][2] + '.'}</div>
    <div class="sub">Parcela original ${R(p.parcela.original.encargo)} (${p.parcela.original.rotulo}) → agora ${R(p.parcela.atual.encargo)}</div>
  </article>
  <article class="card">
    <div><div class="kicker">Para onde foi cada real</div><div class="sub">Toque numa fatia ou numa linha</div></div>
    <div>${donut(itens, G, st.sel)}</div>
    <div style="display:flex;flex-direction:column">${itens.map((g, k) => [g, k]).reverse().map(([g, k]) => `<button data-act="seg" data-k="${k}" class="row" style="min-height:44px;border:0;border-bottom:1px solid var(--line);background:${st.sel === k ? 'var(--surface2)' : 'transparent'};padding:0 4px;border-radius:8px;text-align:left"><span style="display:flex;align-items:center;gap:10px"><i class="dot" style="background:${g.c}"></i>${esc(g.rotulo)}</span><span><b>${R(g.valor)}</b> <small class="muted">${PC(G > 0 ? g.valor / G * 100 : 0, 1)}</small></span></button>`).join('')}</div>
    <div class="sub">Custos (não voltam): juros + TR + seguros e taxas + documentação = <b>${R(T.custos)}</b>. Patrimônio formado: entrada + principal devolvido = <b>${R(T.entrada + T.entradaFGTS + T.principalDevolvido)}</b>.</div>
  </article>
  <article class="card">
    <div class="kicker">Total pago: bolso × FGTS</div>
    <div class="bar" style="height:16px"><i style="width:${G > 0 ? p.gastoPorOrigem.bolso / G * 100 : 0}%;background:var(--accent)"></i><i style="width:${G > 0 ? p.gastoPorOrigem.fgts / G * 100 : 0}%;background:var(--s7)"></i></div>
    <div class="grid2"><div class="kv"><small style="display:flex;align-items:center;gap:6px"><i class="dot" style="background:var(--accent)"></i>Do bolso</small><b>${R(p.gastoPorOrigem.bolso)}</b><small>${PC(G > 0 ? p.gastoPorOrigem.bolso / G * 100 : 0, 1)}</small></div>
    <div class="kv"><small style="display:flex;align-items:center;gap:6px"><i class="dot" style="background:var(--s7)"></i>Do FGTS</small><b>${R(p.gastoPorOrigem.fgts)}</b><small>entrada ${R(p.detalheOrigem.fgts.entrada, 0)} + amortizações ${R(p.detalheOrigem.fgts.extras, 0)}</small></div></div>
  </article>
  ${divergenciaHTML(p)}
  <article class="card">
    <div><div class="kicker">Evolução do saldo</div><div class="sub">Plano ativo × contrato sem amortização extra, com os marcos de faixa</div></div>
    ${graficoSaldo(p, d)}
    <div class="legend"><span><i class="dot" style="background:var(--s1)"></i>Plano ativo (${esc(d.plano.nome)})</span><span><i class="dot" style="background:var(--ink3)"></i>Sem amortização extra</span></div>
    <div class="legend">${fx.filter(m => p.serieSaldo.marcos.plano.some(x => x.faixa === m.faixa)).map(m => `<span><i class="dot" style="background:var(--f${m.faixa});border-radius:50%"></i>${FX[m.faixa][0]} em ${m.rotulo}</span>`).join('')}</div>
  </article>
  <article class="card">
    <div><div class="kicker">As quatro faixas</div><div class="sub">Comparam a amortização da parcela (A) com a TR e os juros (J)</div></div>
    <div>${[1, 2, 3, 4].map(n => {
      const pl = p.marcos.plano.find(x => x.faixa === n), rf = p.marcos.referencia.find(x => x.faixa === n), real = p.marcos.real.find(x => x.faixa === n);
      const txt = real ? `Desde ${real.rotulo}${n === atual ? ', ainda em vigor' : ''}` : `Plano <b style="color:var(--ink)">${pl?.rotulo ?? '—'}</b> · sem extra ${rf?.rotulo ?? '—'}`;
      return `<div class="fx">${fbadge(n)}<div style="flex:1;min-width:0"><b>${FX[n][0]} · ${FX[n][1]}</b><div class="sub">${FX[n][2]}</div><div class="sub" style="margin-top:3px">${txt}</div></div></div>`;
    }).join('')}</div>
  </article>
  <article class="card">
    <div class="kicker">Mês a mês</div>
    <div class="chips" role="group" aria-label="Filtro da lista">${[['prev', 'Previstos'], ['real', 'Reais'], ['ev', 'Só eventos']].map(x => `<button class="chip" data-act="filter" data-v="${x[0]}" aria-pressed="${st.filter === x[0]}">${x[1]}</button>`).join('')}</div>
    <div class="legend">${mk('Amortização', 'var(--s3)')}${mk('TR', 'var(--s2)')}${mk('Juros', 'var(--s1)')}</div>
    <ul class="mlist">${list}</ul>
    ${mais ? `<button class="btn block" data-act="more">Mostrar mais ${mais} meses</button>` : ''}
  </article>`;
}

export async function montarStatus(el) {
  const d = await carregarDados();
  if (!d) return (el.innerHTML = '<article class="card"><div class="h2">Sem parcelas lançadas</div><div class="sub">Lance a primeira parcela na aba Lançar para ver o status.</div></article>');
  const desenhar = () => {
    const y = window.scrollY;
    el.innerHTML = statusView(d, painelStatus(d, { contra: st.contra }));
    attachHover(el);
    window.scrollTo(0, y);
  };
  el.onclick = ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const v = b.dataset.v, a = b.dataset.act;
    if (a === 'filter') { st.filter = v; st.n = 8; } else if (a === 'more') st.n += 8;
    else if (a === 'divv') st.divv = v; else if (a === 'contra') st.contra = v;
    else if (a === 'seg') st.sel = st.sel === +b.dataset.k ? null : +b.dataset.k;
    else return;
    desenhar();
  };
  desenhar();
}
