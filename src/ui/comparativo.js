// Tela Comparativo: cartões por cenário (o melhor em destaque), barras de composição, tabela e os gráficos.
// Os números vêm de painelComparativo / seriesGraficos (src/paineis.js).
import { carregarDados } from './dados.js';
import { painelComparativo, seriesGraficos } from '../paineis.js';
import { deflator } from '../patrimonio.js';
import { $, esc, R, RS, PC, ic, descRegra, corCenario, xDe, xDeRotulo, rotX, interp, marcasAno, lineChart, stackChart, attachHover } from './comum.js';

const HZ = [['hoje', 'Hoje'], [5, '5 anos'], [10, '10 anos'], [15, '15 anos'], ['quitacao', 'Quitação']];
const st = { hz: 10, infl: false, chart: null };
const rot = r => r.quitacao?.rotulo ?? '—';

function compBar(r, todos) {
  const W = 320, c = x => x.composicao;
  const mp = Math.max(...todos.map(x => c(x).imovelLiquido + c(x).carteira + c(x).fgts)), mn = Math.max(...todos.map(x => c(x).divida));
  const k = (W - 16) / ((mp + mn) || 1), z = 8 + mn * k, cc = c(r);
  const seg = (x, w, col) => `<rect x="${x.toFixed(1)}" y="14" width="${Math.max(0, w).toFixed(1)}" height="16" fill="${col}" stroke="var(--surface)" stroke-width="1.5"/>`;
  let x = z, out = seg(z - cc.divida * k, cc.divida * k, 'var(--s2)');
  [[cc.imovelLiquido, 'var(--s1)'], [cc.carteira, 'var(--s3)'], [cc.fgts, 'var(--s4)']].forEach(([v, col]) => { if (v > 0) { out += seg(x, v * k, col); x += v * k; } });
  const nx = z + r.patrimonio * k;
  return `<svg viewBox="0 0 ${W} 40" style="width:100%;height:auto" role="img" aria-label="Composição do patrimônio: imóvel líquido ${R(cc.imovelLiquido, 0)}, dívida ${R(cc.divida, 0)}, carteira ${R(cc.carteira, 0)}, FGTS ${R(cc.fgts, 0)}"><line x1="${z}" x2="${z}" y1="8" y2="36" stroke="var(--ink)" stroke-width="1.2"/>${out}<path d="M${nx - 5} 3 h10 l-5 7z" fill="var(--ink)"/></svg>`;
}

/** Gráficos de saldo, composição da parcela e dívida × carteira do cenário `sk`. */
function graficos(d, sg, sk, infl) {
  const agora = xDe(d.estado.competencia) - 1 / 12, ipca = d.premPlano.ipcaAA ?? 0, dfl = (v, x) => (infl ? v / deflator(ipca, Math.max(0, x - agora)) : v);
  const a0 = sg.anos[0], x1 = sg.anos.at(-1) + 1, xt = marcasAno(a0, x1);
  const pts = (arr, ini) => [[agora, dfl(ini, agora)], ...sg.anos.map((a, i) => [a + 1, dfl(arr[i], a + 1)])];
  const sSel = sg.saldoPorAno.find(s => s.id === sk), sRef = sg.saldoPorAno.find(s => s.referencia), cx = sg.saldoXCarteira.find(s => s.id === sk), cp = sg.composicaoParcela.find(s => s.id === sk);
  const saldo0 = d.estado.saldo, nome = esc(sSel.nome), cor = corCenario(d.grupo, sk);
  const ps = pts(sSel.saldo, saldo0), pr = pts(sRef.saldo, saldo0);
  const c1 = lineChart('c1', { series: [{ pts: pr, color: 'var(--ink3)', dash: 1, w: 2 }, { pts: ps, color: cor }], x0: a0, x1, ymax: Math.max(...ps.map(q => q[1]), ...pr.map(q => q[1])), xt,
    aria: 'Saldo devedor, cenário e referência', tip: x => `<b>${rotX(x)}</b><span>${nome} <b>${R(interp(ps, x), 0)}</b></span><span>Sem extra <b>${R(interp(pr, x), 0)}</b></span>` });
  const rows = cp.anos.filter(r => r.amortizacao + r.juros + r.tr + r.segurosTaxas > 0).map(r => ({ y: r.ano, A: dfl(r.amortizacao, r.ano + .5), J: dfl(r.juros, r.ano + .5), TR: dfl(r.tr, r.ano + .5), seg: dfl(r.segurosTaxas, r.ano + .5) }));
  const c2 = stackChart('c2', { rows, keys: [{ k: 'A', c: 'var(--s3)' }, { k: 'J', c: 'var(--s1)' }, { k: 'TR', c: 'var(--s2)' }, { k: 'seg', c: 'var(--s4)' }], every: 4, aria: 'Composição da parcela por ano',
    tip: i => { const r = rows[i]; return `<b>${r.y}</b><span>Amortização <b>${R(r.A, 0)}</b></span><span>Juros <b>${R(r.J, 0)}</b></span><span>TR <b>${R(r.TR, 0)}</b></span><span>Seguros + taxas <b>${R(r.seg, 0)}</b></span>`; } });
  const cs = pts(cx.saldo, saldo0), cc = pts(cx.carteira, 0), cxX = cx.cruzamento ? xDeRotulo(cx.cruzamento) : null;
  const c3 = lineChart('c3', { series: [{ pts: cs, color: 'var(--s2)' }, { pts: cc, color: 'var(--s3)' }], x0: a0, x1, ymax: Math.max(...cc.map(q => q[1]), ...cs.map(q => q[1])) * 1.02, xt,
    dots: cxX == null ? [] : [{ x: cxX, y: interp(cs, cxX), color: 'var(--ink)' }], aria: 'Saldo devedor contra carteira de investimento, com o ponto de cruzamento',
    tip: x => `<b>${rotX(x)}</b><span>Saldo devedor <b>${R(interp(cs, x), 0)}</b></span><span>Carteira <b>${R(interp(cc, x), 0)}</b></span>` });
  return { c1, c2, c3, cruz: cx.cruzamento, nome };
}

/** HTML da tela a partir de `d` (dados preparados), `pc` (painelComparativo) e `sg` (seriesGraficos). Puro. */
export function comparativoView(d, pc, sg) {
  const hz = pc.horizonte, hzl = HZ.find(h => h[0] === hz)[1], todos = pc.cenarios, tie = pc.melhor == null;
  const sorted = [...todos].sort((a, b) => b.patrimonio - a.patrimonio), top = sorted[0], second = sorted[1];
  const gap = second && top.patrimonio > 0 ? (top.patrimonio - second.patrimonio) / top.patrimonio * 100 : 100;
  const mine = d.grupo.filter(c => c.regra !== 'referencia');
  if (!mine.some(c => c.id === st.chart)) st.chart = (mine.find(c => c.planoAtivo) ?? mine[0] ?? d.grupo[0]).id;
  const cor = r => corCenario(d.grupo, r.id);
  const cards = sorted.map((r, i) => {
    const best = pc.melhor === r.id, delta = r.patrimonio - top.patrimonio, c = r.composicao;
    return `<article class="scard ${best ? 'best' : ''}">
    <div class="row" style="align-items:flex-start"><div style="min-width:0"><h3 style="display:flex;align-items:center;gap:8px"><i class="dot" style="background:${cor(r)}"></i>${esc(r.nome)}</h3><div class="sub">${descRegra(r.regra)}</div></div>
    ${best ? `<span class="tag best">${ic('check', 12)} Melhor em ${hzl.toLowerCase()}</span>` : r.referencia ? '<span class="tag">referência</span>' : tie ? '' : `<span class="tag">${i + 1}º</span>`}</div>
    <div><div class="kicker" style="margin-bottom:4px">Patrimônio ${hz === 'hoje' ? 'hoje' : 'em ' + pc.rotulo}</div><div class="row" style="align-items:baseline"><div class="pat">${R(r.patrimonio, 0)}</div><div class="sub" style="font-weight:700;color:${delta < -0.5 ? 'var(--f1)' : 'var(--ink2)'}">${tie ? 'igual aos demais' : best ? 'maior valor' : RS(delta, 0) + ' vs. o melhor'}</div></div></div>
    ${compBar(r, todos)}
    <div class="grid2" style="gap:10px"><div class="kv"><small>Saldo devedor</small><b>${R(c.divida, 0)}</b></div><div class="kv"><small>Carteira líquida de IR</small><b>${R(c.carteira, 0)}</b></div><div class="kv"><small>Quitação</small><b>${rot(r)}</b></div><div class="kv"><small>FGTS usado</small><b>${R(r.fgtsUsado, 0)}</b></div></div></article>`;
  }).join('');
  const hdr = sorted.map(r => `<th class="${pc.melhor === r.id ? 'best' : ''}"><span style="display:inline-flex;align-items:center;gap:5px"><i class="dot" style="background:${cor(r)}"></i>${r.referencia ? 'Sem extra' : esc(r.nome)}</span></th>`).join('');
  const line = (l, f, cls) => `<tr><td>${l}</td>${sorted.map(r => `<td class="${pc.melhor === r.id ? 'best' : ''} ${cls && cls(r) ? 'neg' : ''}">${f(r)}</td>`).join('')}</tr>`;
  const sec = t => `<tr class="sec"><td colspan="${sorted.length + 1}">${t}</td></tr>`;
  const eco = (r, f) => (r.economizado ? f(r.economizado) : '—');
  const table = `<div class="tablewrap" tabindex="0" aria-label="Tabela comparativa"><table><thead><tr><th>${hzl}</th>${hdr}</tr></thead><tbody>
   ${sec('Patrimônio')}${line('Patrimônio', r => '<b>' + R(r.patrimonio, 0) + '</b>')}${line('Imóvel líquido', r => R(r.composicao.imovelLiquido, 0))}${line('− Dívida', r => '−' + R(r.composicao.divida, 0), r => r.composicao.divida > 0)}${line('Carteira (líq. IR)', r => R(r.composicao.carteira, 0))}${line('FGTS', r => R(r.composicao.fgts, 0))}
   ${sec('Custo e uso')}${line('Custo do bolso', r => R(r.custoBolso, 0))}${line('FGTS usado', r => R(r.fgtsUsado, 0))}${todos.some(r => r.fgtsPrestacoes > 0) ? line('· nas prestações', r => R(r.fgtsPrestacoes, 0)) : ''}${line('Quitação', rot)}
   ${sec('Até quitar')}${line('Juros pagos', r => R(r.jurosPagos, 0))}${line('TR paga', r => R(r.trPaga, 0))}${line('Juros economizados', r => eco(r, e => R(e.juros, 0)))}${line('TR economizada', r => eco(r, e => R(e.tr, 0)))}${line('Anos a menos', r => eco(r, e => e.anos.toLocaleString('pt-BR', { maximumFractionDigits: 1 })))}
  </tbody></table></div>`;
  const g = graficos(d, sg, st.chart, st.infl), selNome = esc(d.grupo.find(c => c.id === st.chart).nome);
  return `
  <div class="ctrl" id="ctrl">
    <div class="seg" role="group" aria-label="Horizonte">${HZ.map(h => `<button data-act="hz" data-v="${h[0]}" aria-pressed="${st.hz === h[0]}">${h[1]}</button>`).join('')}</div>
    <div class="seg" role="group" aria-label="Inflação"><button data-act="infl" data-v="0" aria-pressed="${!st.infl}">Nominal</button><button data-act="infl" data-v="1" aria-pressed="${st.infl}">Em reais de hoje</button></div>
  </div>
  <div class="card flat" style="padding:12px 14px;gap:6px;flex-direction:row;align-items:center"><span class="tag ok">${ic('check', 12)} Custo do bolso igual</span><span class="sub" style="flex:1">${R((todos.find(r => !r.referencia) ?? todos[0]).custoBolso, 0)} em todos os seus cenários${todos.some(r => r.referencia) && !tie ? `; a referência paga só as parcelas (${R(todos.find(r => r.referencia).custoBolso, 0)}) e não investe o extra` : ''}${tie ? '. Hoje todos partem do real.' : ''}${st.infl ? ` Valores a preços de hoje (IPCA ${PC((d.premPlano.ipcaAA ?? 0) * 100)} a.a.).` : ''}</span></div>
  ${tie || !second || gap >= 1 ? '' : `<div class="sub" style="padding:0 4px">Diferença de ${PC(gap, 2)} entre o 1º e o 2º. Olhe também os outros horizontes antes de decidir.</div>`}
  <div style="display:flex;flex-direction:column;gap:12px">${cards}</div>
  <div class="legend" style="padding:0 4px"><span><i class="dot" style="background:var(--s1)"></i>Imóvel líquido</span><span><i class="dot" style="background:var(--s2)"></i>− Dívida</span><span><i class="dot" style="background:var(--s3)"></i>Carteira</span><span><i class="dot" style="background:var(--s4)"></i>FGTS</span><span>▼ patrimônio</span></div>
  <article class="card"><div class="kicker">Linha a linha</div>${table}<div class="sub">Juros e TR somam todo o contrato até a quitação de cada cenário${st.infl ? ', cada mês trazido a preços de hoje' : ''}.</div></article>
  <article class="card"><div><div class="kicker">Gráficos</div><div class="sub">Veja o cenário:</div></div><div class="chips" role="group" aria-label="Cenário dos gráficos">${mine.map(c => `<button class="chip" data-act="chart" data-v="${c.id}" aria-pressed="${st.chart === c.id}">${esc(c.nome)}</button>`).join('')}</div></article>
  <article class="card"><div><div class="h2">Saldo devedor por ano</div><div class="sub">${selNome} contra o contrato sem amortização extra</div></div>${g.c1}
    <div class="legend"><span><i class="dot" style="background:${corCenario(d.grupo, st.chart)}"></i>${selNome}</span><span><i class="dot" style="background:var(--ink3)"></i>Sem amortização extra</span></div></article>
  <article class="card"><div><div class="h2">Composição da parcela por ano</div><div class="sub">Quanto de cada ano vai para quê</div></div>${g.c2}
    <div class="legend"><span><i class="dot" style="background:var(--s3)"></i>Amortização</span><span><i class="dot" style="background:var(--s1)"></i>Juros</span><span><i class="dot" style="background:var(--s2)"></i>TR</span><span><i class="dot" style="background:var(--s4)"></i>Seguros + taxas</span></div></article>
  <article class="card"><div><div class="h2">Dívida × carteira</div><div class="sub">${g.cruz ? `As curvas se cruzam em <b style="color:var(--ink)">${g.cruz}</b> no cenário ${selNome}` : `As curvas não se cruzam no cenário ${selNome}`}</div></div>${g.c3}
    <div class="legend"><span><i class="dot" style="background:var(--s2)"></i>Saldo devedor</span><span><i class="dot" style="background:var(--s3)"></i>Carteira líquida de IR</span><span><i class="dot" style="background:var(--ink);border-radius:50%"></i>Cruzamento</span></div></article>`;
}

export async function montarComparativo(el) {
  const d = await carregarDados();
  if (!d) return (el.innerHTML = '<article class="card"><div class="h2">Sem parcelas lançadas</div><div class="sub">Lance a primeira parcela na aba Lançar para comparar os cenários.</div></article>');
  const sg = seriesGraficos(d);
  const desenhar = () => {
    const y = window.scrollY;
    el.innerHTML = comparativoView(d, painelComparativo(d, st.hz, st.infl), sg);
    document.documentElement.style.setProperty('--tbh', ($('.topbar')?.offsetHeight ?? 66) + 'px');
    attachHover(el);
    window.scrollTo(0, y);
  };
  el.onclick = ev => {
    const b = ev.target.closest('[data-act]'); if (!b) return;
    const v = b.dataset.v;
    if (b.dataset.act === 'hz') st.hz = v === 'hoje' || v === 'quitacao' ? v : +v;
    else if (b.dataset.act === 'infl') st.infl = v === '1';
    else if (b.dataset.act === 'chart') st.chart = v;
    else return;
    desenhar();
  };
  desenhar();
}
