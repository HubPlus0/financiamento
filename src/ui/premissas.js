import { listar, salvar } from '../db.js';
import { trVinculada } from '../invest.js';
import { PADRAO_FGTS_PRESTACAO } from '../scenario.js';
import { gerarVersoes } from './versoes.js';
import { $, esc, PC, nBR, num, toast } from './comum.js';

// [caminho, rótulo, tipo, unidade, dica, casas, opções]. tipo: p = taxa guardada em decimal e mostrada em %, n = número,
// b = liga/desliga, s = lista de opções [[valor, texto]].
const BASE_FP = [['encargo', 'Prestação total (A+J, seguros e taxa)'], ['aj', 'Só A+J']];
const JANELA_FP = [['naoAfeta', 'Não afeta os 24 meses'], ['reiniciaNoFim', 'Reinicia os 24 meses no fim'], ['bloqueiaDurante', 'Bloqueia a amortização durante']];
const GRUPOS = [
  ['Selic e investimento', [
    ['selic.atual', 'Selic atual', 'p', '% a.a.'], ['selic.longoPrazo', 'Selic de longo prazo', 'p', '% a.a.'],
    ['selic.anosAteLongoPrazo', 'Anos até lá', 'n', 'anos'], ['cdiSpread', 'CDI = Selic + spread', 'p', 'p.p.', 'CDB, CDI = Selic − 0,10 p.p.'],
    ['pctCDI', '% do CDI', 'p', '%'], ['isentoIR', 'Investimento isento de IR', 'b', '', 'IR regressivo de 22,5% a 15%']]],
  ['Imóvel e inflação', [
    ['valorizacaoImovelAA', 'Valorização do imóvel', 'p', '% a.a.'], ['custoVendaPct', 'Custo de venda', 'p', '%', 'corretagem'],
    ['irGanhoCapitalImovel', 'IR de ganho de capital do imóvel', 'b', '', '15%, conservador'], ['ipcaAA', 'IPCA', 'p', '% a.a.']]],
  ['FGTS', [['fgtsRendAA', 'Rendimento do FGTS (mais TR)', 'p', '% a.a.'],
    ['fgtsPrestacaoPct', 'FGTS nas prestações: até', 'p', '% da prestação', 'teto do pedido = % × prestação × 12; sai todo do FGTS no pedido'],
    ['fgtsPrestacaoBase', 'FGTS nas prestações: o percentual é sobre', 's', '', '', null, BASE_FP],
    ['fgtsPrestacaoJanela', 'FGTS nas prestações e a amortização com FGTS', 's', '', '', null, JANELA_FP]]],
  ['Seguros', [['mipTaxa', 'MIP (taxa sobre o saldo)', 'p', '%', '', 6], ['dfiTaxa', 'DFI (taxa sobre o imóvel)', 'p', '%', '', 6]]],
];
const TODOS = GRUPOS.flatMap(g => g[1]);
const pegar = (o, c) => c.split('.').reduce((x, k) => x?.[k], o);
const por = (o, c, v) => { const ks = c.split('.'); const u = ks.pop(); ks.reduce((x, k) => x[k], o)[u] = v; };
const pct2dec = x => Number((x / 100).toPrecision(12));

export async function montarPremissas(el) {
  const salva = (await listar('premissas')).find(p => p.id === 'padrao');
  const prem = salva && { ...PADRAO_FGTS_PRESTACAO, ...salva }; // premissas antigas, sem o FGTS nas prestações, ganham os padrões
  if (!prem?.trMensal) return (el.innerHTML = '<article class="card"><div class="kicker">Premissas</div><div class="sub">As premissas são criadas na primeira abertura com dados lançados.</div></article>');
  const vinc = prem.trMensal.modo === 'vinculadaSelic';
  const src = c => (prem.origem?.[c] ? `${prem.origem[c]}` : '');
  const set = (id, rot, v, u, dica, max = 4, nome = id) => `<div class="settingrow"><label for="p-${id}">${rot}<span class="src">${esc(dica ?? '')}</span></label><div class="inp"><input id="p-${id}" name="${nome}" inputmode="decimal" data-max="${max}" value="${nBR(v, max)}"><span>${u}</span></div></div>`;
  const tg = (c, rot, on, dica) => `<div class="toggle"><label style="font-weight:600;font-size:14px;display:flex;flex-direction:column">${rot}${dica ? `<span class="src">${esc(dica)}</span>` : ''}</label><button type="button" class="sw" role="switch" aria-checked="${!!on}" aria-label="${rot}" data-sw="${c}"></button></div>`;
  const sel = (c, rot, v, ops, dica) => `<div class="settingrow"><label for="p-${c}">${rot}<span class="src">${esc(dica ?? '')}</span></label><div class="inp"><select id="p-${c}" name="${c}" style="font-size:16px">${ops.map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div></div>`;
  const trAtual = vinc && prem.selic ? trVinculada(prem.trMensal, prem.selic.atual) : null;
  el.innerHTML = `<form class="card" id="pr-form" autocomplete="off"><div><div class="kicker">Premissas</div><div class="sub">Conjunto <b style="color:var(--ink)">${esc(prem.nome ?? 'Padrão')}</b></div></div>
    <div class="kicker" style="margin-top:4px">Juros e TR</div>
    ${vinc ? `${set('trPiso', 'TR: piso da Selic', prem.trMensal.piso * 100, '% a.a.', 'TR = fator × (Selic − piso)', 4, 'trPiso')}${set('trFator', 'TR: fator', prem.trMensal.fator, '', src('trMensal'), 6, 'trFator')}
      ${trAtual != null ? `<div class="row"><span class="sub">TR mensal na Selic atual</span><b>${PC(trAtual * 100, 3)}</b></div>` : ''}`
    : `<div class="field"><label for="p-trMensal">TR mensal, curva (uma linha por ponto: AAAA-MM valor)</label><div class="inp"><textarea id="p-trMensal" name="trMensal" rows="3">${esc(prem.trMensal.pontos.map(p => `${p.desde} ${p.valor}`).join('\n'))}</textarea></div><div class="hint">${esc(src('trMensal'))}</div></div>`}
    ${GRUPOS.map(([tit, cs]) => `<div class="kicker" style="margin-top:8px">${tit}</div>${cs.map(([c, r, t, u, dica, max, ops]) => t === 'b' ? tg(c, r, pegar(prem, c), dica)
      : t === 's' ? sel(c, r, pegar(prem, c), ops, [dica, src(c)].filter(Boolean).join(' · '))
      : set(c, r, t === 'p' ? pegar(prem, c) * 100 : pegar(prem, c), u, [dica, src(c)].filter(Boolean).join(' · '), max ?? 4, c)).join('')}`).join('')}
    <button class="btn primary block" type="submit">Salvar premissas</button><div class="hint">Salvar cria uma versão nova de cada cenário. As antigas ficam guardadas.</div></form>`;

  const f = $('#pr-form', el);
  f.addEventListener('click', e => { const b = e.target.closest('.sw'); if (b) b.setAttribute('aria-checked', b.getAttribute('aria-checked') !== 'true'); });
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const novo = structuredClone(prem), v = c => num(f.elements[c].value);
    if (vinc) novo.trMensal = { modo: 'vinculadaSelic', piso: pct2dec(v('trPiso') ?? 0), fator: v('trFator') ?? 0 };
    else try {
      novo.trMensal = { modo: 'curva', pontos: f.elements.trMensal.value.trim().split('\n').map(l => {
        const [desde, valor] = l.trim().split(/\s+/);
        if (!/^\d{4}-\d{2}$/.test(desde) || !Number.isFinite(+valor)) throw new Error(`Ponto inválido: "${l}"`);
        return { desde, valor: +valor };
      }) };
    } catch (err) { return toast(err.message, 5000); }
    for (const [c, , t] of TODOS) {
      if (t === 'b') por(novo, c, f.querySelector(`[data-sw="${c}"]`).getAttribute('aria-checked') === 'true');
      else if (t === 's') por(novo, c, f.elements[c].value);
      else { const x = v(c); if (x == null) return toast('Confira os números: há um campo vazio ou inválido.', 5000); por(novo, c, t === 'p' ? pct2dec(x) : x); }
    }
    await salvar('premissas', novo);
    const ids = (await listar('cenarios')).filter(c => c.premissasId === novo.id).map(c => c.id);
    const n = await gerarVersoes('edicao-premissa', ids);
    toast(`Premissas salvas. ${n} ${n === 1 ? 'versão nova' : 'versões novas'}.`, 4000);
  });
}
