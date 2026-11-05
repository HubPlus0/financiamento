// Apresentação compartilhada: formatos pt-BR, ícones, textos de faixa, toast e gráficos SVG feitos à mão. Sem regra de negócio.
import { rotuloMes } from '../paineis.js';
export { rotuloMes };

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- formatos
const nf = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const ok = v => v != null && Number.isFinite(v);
const sinal = (v, d) => (v < (d ? -0.005 : -0.5) ? '−' : '');
export const N = v => (ok(v) ? nf.format(v) : '—');
export const R = (v, d = 2) => (ok(v) ? sinal(v, d) + 'R$ ' + (d ? nf : nf0).format(Math.abs(v)) : '—');
export const RS = (v, d = 2) => (ok(v) ? (v > (d ? 0.005 : 0.5) ? '+' : sinal(v, d)) + 'R$ ' + (d ? nf : nf0).format(Math.abs(v)) : '—');
/** `v` já em pontos percentuais (12,5 -> "12,5%"). */
export const PC = (v, d = 2) => (ok(v) ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v) + '%' : '—');
/** Número pt-BR com até `max` casas (mínimo 2): campos de formulário. */
export const nBR = (v, max = 2) => (ok(v) ? new Intl.NumberFormat('pt-BR', { minimumFractionDigits: Math.min(2, max), maximumFractionDigits: max }).format(v) : '');
/** Texto digitado -> número (aceita "1.234,56", "1234,56" e "1234.56"); null se vazio ou inválido. */
export const num = s => {
  s = String(s ?? '').trim().replace(/\s/g, '').replace('−', '-').replace(/^R\$/, '');
  if (!s) return null;
  const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) && /^-?[\d.]+$/.test(t) ? n : null;
};
export const parse = s => num(s) ?? 0;
/** 'AAAA-MM-DD' -> '31/12/2030'. */
export const dataBR = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—');
/** Carimbo ISO (com hora) -> data local '31/12/2030'. */
export const dataHora = iso => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
/** 'AAAA-MM' -> posição no eixo (fim do mês, em anos). */
export const xDe = c => +c.slice(0, 4) + +c.slice(5, 7) / 12;
/** Posição no eixo -> 'mmm/aaaa'. */
export const rotX = x => { const t = Math.round(x * 12) - 1; return MES[((t % 12) + 12) % 12] + '/' + Math.floor(t / 12); };
/** 'fev/2036' -> posição no eixo. */
export const xDeRotulo = r => +r.slice(4) + (MES.indexOf(r.slice(0, 3)) + 1) / 12;
export const anosEMeses = n => `${Math.floor(n / 12)} anos e ${n % 12} ${n % 12 === 1 ? 'mês' : 'meses'}`;

// ---- regras de cenário em texto
export const nomeRegra = r => (r === 'manual' ? 'manual' : r === 'referencia' ? 'referência' : r === 'amortizarTudo' ? 'amortizar tudo' : r === 'investirTudo' ? 'investir tudo' : `dividir ${Math.round(r.dividir * 100)}%`);
export const descRegra = r => (r === 'referencia' ? 'Referência fixa: só as parcelas como assinadas, sem extra' : r === 'amortizarTudo' ? 'Todo o extra amortiza o prazo'
  : r === 'investirTudo' ? 'O extra vai inteiro para a carteira' : r === 'manual' ? 'Meses definidos por você, um a um'
  : `${Math.round(r.dividir * 100)}% do extra amortiza, o resto vai para a carteira`);
const CORES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s5)', 'var(--s7)', 'var(--s6)', 'var(--s4)'];
/** Cor estável do cenário: a referência é cinza; os demais seguem a ordem de criação. */
export const corCenario = (grupo, id) => {
  const c = grupo.find(x => x.id === id);
  if (!c || c.regra === 'referencia') return 'var(--ink3)';
  return CORES[grupo.filter(x => x.regra !== 'referencia').sort((a, b) => (a.criadoEm ?? '') < (b.criadoEm ?? '') ? -1 : 1).findIndex(x => x.id === id) % CORES.length];
};

// ---- ícones e faixas
const ICONES = {
  status: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
  lancar: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  cenario: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  comparar: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  f1: '<path d="M5 17 17 5M8 5h9v9"/>', f2: '<path d="M5 7l12 12M17 9v10H7" transform="translate(0 -3)"/>',
  f3: '<path d="M4.5 12.5 9.5 17.5 19.5 7"/>',
  left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>', chev: '<path d="M6 9l6 6 6-6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  amort: '<path d="M12 4v10M7.5 10 12 14.5 16.5 10M5 19h14"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
  flag: '<path d="M6 21V4M6 5h11l-2.5 4L17 13H6"/>',
  check: '<path d="M4.5 12.5 9.5 17.5 19.5 7"/>',
  dl: '<path d="M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14"/>', ul: '<path d="M12 16V5M7.5 9 12 4.5 16.5 9M5 20h14"/>',
};
export const ic = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n]}</svg>`;
export const FX = {
  1: ['Faixa 1', 'Saldo sobe', 'A amortização é menor que a TR: o saldo sobe mesmo pagando a parcela'],
  2: ['Faixa 2', 'Saldo cai, juros pesam', 'A amortização passou a TR, mas ainda é menor que os juros + TR'],
  3: ['Faixa 3', 'Passou os juros', 'A amortização passa os juros (somados à TR)'],
};
export const fbadge = f => `<span class="fb f${f}" title="${FX[f][0]}: ${FX[f][1]}">${ic('f' + f, 18)}</span>`;

let toastT;
export const toast = (m, ms = 2800) => {
  const t = $('#toast'); if (!t) return;
  t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
};

/** Formata campos decimais ao sair deles (instalado uma vez em app.js). */
export function formatarAoSair() {
  document.addEventListener('focusout', ev => {
    const t = ev.target;
    if (t.matches?.('.inp input[inputmode="decimal"]') && t.value.trim() && num(t.value) != null) t.value = nBR(num(t.value), +(t.dataset.max ?? 2));
  });
}

// ---- gráficos
function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
  return [1, 1.2, 1.6, 2, 2.4, 2.8, 3.2, 4, 4.8, 6, 8, 10].find(x => x >= m - 1e-9) * p;
}
const kfmt = v => (v >= 1e6 ? (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi' : v >= 1000 ? nf0.format(v / 1000) + ' mil' : nf0.format(v));
/** Valor de uma série [[x, y]] em x (linear entre pontos). */
export function interp(pts, x) {
  let a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) { a = pts[i - 1]; b = pts[i]; break; }
  const t = (x - a[0]) / ((b[0] - a[0]) || 1);
  return a[1] + (b[1] - a[1]) * Math.min(1, Math.max(0, t));
}
/** Quatro marcas de ano entre x0 e x1. */
export const marcasAno = (x0, x1) => [1, 2, 3, 4].map(k => Math.round(x0 + k * (x1 - x0) / 4));

const CH = {};
const frame = (id, cfg, svg) => { CH[id] = cfg; return `<div class="chart" data-chart="${id}">${svg}<div class="tip" hidden></div></div>`; };

/** o: { series: [{ pts: [[x, y]], color, dash, w, noend }], x0, x1, ymax, xt, dots: [{ x, y, color }], H, aria, tip(x) -> html } */
export function lineChart(id, o) {
  const W = 360, H = o.H || 200, L = 44, Rr = 10, T = 10, B = 24, pw = W - L - Rr, ph = H - T - B;
  const ymax = niceMax(o.ymax), xs = x => L + (x - o.x0) / (o.x1 - o.x0) * pw, ys = y => T + ph - (y / ymax) * ph;
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = ymax * k / 4, y = ys(v); g += `<line x1="${L}" x2="${W - Rr}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y + 3.5}" text-anchor="end">${kfmt(v)}</text>`; }
  o.xt.forEach(x => { g += `<text x="${xs(x)}" y="${H - 6}" text-anchor="middle">${x}</text>`; });
  const lines = o.series.filter(s => s.pts.length).map(s => `<path d="M${s.pts.map(p => xs(p[0]).toFixed(1) + ' ' + ys(p[1]).toFixed(1)).join(' L')}" fill="none" stroke="${s.color}" stroke-width="${s.w || 2.5}" stroke-linecap="round" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="5 5"' : ''}/>`).join('');
  const dots = (o.dots || []).map(d => `<circle cx="${xs(d.x)}" cy="${ys(d.y)}" r="5.5" fill="${d.color}" stroke="var(--surface)" stroke-width="2"/>`).join('');
  const ends = o.series.filter(s => !s.noend && s.pts.length).map(s => { const p = s.pts[s.pts.length - 1]; return `<circle cx="${xs(p[0])}" cy="${ys(p[1])}" r="3.5" fill="${s.color}" stroke="var(--surface)" stroke-width="1.5"/>`; }).join('');
  const cfg = { W, H, L, pw, xs, inv: px => o.x0 + (px - L) / pw * (o.x1 - o.x0), tip: o.tip, T, ph };
  return frame(id, cfg, `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">${g}${lines}${dots}${ends}<line class="xh" y1="${T}" y2="${T + ph}" stroke="var(--ink3)" stroke-dasharray="3 3" hidden/></svg>`);
}

/** Barras empilhadas por ano. o: { rows: [{ y, ... }], keys: [{ k, c }], every, aria, tip(i) -> html } */
export function stackChart(id, o) {
  if (!o.rows.length) return '';
  const W = 360, H = 210, L = 44, Rr = 8, T = 10, B = 24, pw = W - L - Rr, ph = H - T - B, n = o.rows.length;
  const tot = r => o.keys.reduce((a, k) => a + Math.max(0, r[k.k]), 0), ymax = niceMax(Math.max(...o.rows.map(tot))), ys = y => T + ph - (y / ymax) * ph, bw = pw / n, w = Math.max(4, bw - 3);
  let g = '';
  for (let k = 0; k <= 4; k++) { const v = ymax * k / 4, y = ys(v); g += `<line x1="${L}" x2="${W - Rr}" y1="${y}" y2="${y}" stroke="var(--line)"/><text x="${L - 6}" y="${y + 3.5}" text-anchor="end">${kfmt(v)}</text>`; }
  let bars = '';
  o.rows.forEach((r, i) => {
    let acc = 0; const x = L + i * bw + (bw - w) / 2;
    o.keys.forEach(k => { const v = r[k.k]; if (v <= 0) return; const y0 = ys(acc), y1 = ys(acc + v); bars += `<rect x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, y0 - y1).toFixed(1)}" fill="${k.c}" stroke="var(--surface)" stroke-width="1.2"/>`; acc += v; });
    if (i % o.every === 0 || i === n - 1) g += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${String(r.y).slice(2)}</text>`;
  });
  return frame(id, { W, H, L, pw, bw, n, tip: o.tip, bars: true, T, ph }, `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(o.aria)}">${g}${bars}<rect class="bh" y="${T}" height="${ph}" fill="var(--ink)" opacity=".07" hidden/></svg>`);
}

/** Tooltip por toque/ponteiro nos gráficos dentro de `root`. */
export function attachHover(root = document) {
  $$('.chart', root).forEach(el => {
    const c = CH[el.dataset.chart]; if (!c) return;
    const svg = $('svg', el), tip = $('.tip', el);
    const hide = () => { tip.hidden = true; const l = $('.xh', svg), b = $('.bh', svg); if (l) l.hidden = true; if (b) b.hidden = true; };
    const mv = e => {
      const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * c.W; let i, x;
      if (c.bars) { i = Math.min(c.n - 1, Math.max(0, Math.floor((px - c.L) / c.bw))); const b = $('.bh', svg); b.setAttribute('x', c.L + i * c.bw); b.setAttribute('width', c.bw); b.hidden = false; x = c.L + i * c.bw + c.bw / 2; }
      else { const xv = c.inv(Math.min(c.L + c.pw, Math.max(c.L, px))); i = xv; x = c.xs(xv); const l = $('.xh', svg); l.setAttribute('x1', x); l.setAttribute('x2', x); l.hidden = false; }
      const html = c.tip(i); if (!html) { hide(); return; }
      tip.innerHTML = html; tip.hidden = false;
      tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, x / c.W * r.width - tip.offsetWidth / 2)) + 'px'; tip.style.top = '4px';
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerdown', mv); el.addEventListener('pointerleave', hide);
  });
}

/** Rosca. items: [{ rotulo, valor, c }]; sel: índice destacado ou null. Cada arco leva data-act="seg" data-k. */
export function donut(items, total, sel) {
  const S = 220, c = S / 2, r = 84, sw = 30, C = 2 * Math.PI * r, t = total > 0 ? total : 1;
  let off = 0, arcs = '';
  items.forEach((it, k) => {
    const len = it.valor / t * C, gap = 2;
    arcs += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${it.c}" stroke-width="${sel === k ? sw + 6 : sw}" stroke-dasharray="${Math.max(0, len - gap)} ${C - len + gap}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})" data-act="seg" data-k="${k}" style="cursor:pointer" tabindex="0" role="button" aria-label="${esc(it.rotulo)}: ${R(it.valor)}"/>`;
    off += len;
  });
  const cur = sel == null ? { rotulo: 'gasto até hoje', valor: total } : items[sel];
  return `<svg viewBox="0 0 ${S} ${S}" style="width:min(100%,260px);margin:0 auto" role="img" aria-label="Composição de tudo o que foi gasto">${arcs}
   <text x="${c}" y="${c - 14}" text-anchor="middle" style="fill:var(--ink2);font-size:11.5px;font-family:var(--body);font-weight:600">${esc(cur.rotulo)}</text>
   <text x="${c}" y="${c + 10}" text-anchor="middle" style="fill:var(--ink);font:700 17px var(--disp)">${R(cur.valor)}</text>
   <text x="${c}" y="${c + 30}" text-anchor="middle" style="fill:var(--ink2);font-size:12px;font-family:var(--body)">${sel == null ? '' : PC(cur.valor / t * 100, 1) + ' do total'}</text></svg>`;
}
