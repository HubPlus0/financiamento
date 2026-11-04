// Tela Config: contrato e dados iniciais (formulário), premissas (premissas.js) e backup.
import { obter, salvar, exportarTudo, importarTudo, contagens, valorCompra } from '../db.js';
import { montarPremissas } from './premissas.js';
import { depositoFGTS } from '../scenario.js';
import { somaMeses } from '../engine.js';
import { $, R, num, nBR, esc, ic, toast, rotuloMes } from './comum.js';

// [grupo, campo, rótulo, tipo, dica, unidade]. tipo: n = número, i = inteiro, p = taxa guardada em decimal e mostrada em %, t = texto, d = data
const CAMPOS = [
  ['contrato', 'numeroContrato', 'Número do contrato', 't', '', ''],
  ['contrato', 'dataAssinatura', 'Assinatura', 'd', '', ''],
  ['contrato', 'valorFinanciado', 'Valor financiado', 'n', '', 'R$'],
  ['contrato', 'prazoOriginal', 'Prazo original', 'i', '', 'meses'],
  ['contrato', 'taxaNominalAA', 'Juros nominais', 'p', '', '% a.a.'],
  ['contrato', 'sistema', 'Sistema', 't', 'PRICE', ''],
  ['contrato', 'indexador', 'Indexador', 't', 'TR', ''],
  ['contrato', 'diaVencimento', 'Dia do vencimento', 'i', '', 'dia'],
  ['contrato', 'taxaOperacional', 'Taxa operacional', 'n', '', 'R$'],
  ['contrato', 'valorAvaliacao', 'Valor de avaliação', 'n', '', 'R$'],
  ['inicial', 'entradaDinheiro', 'Entrada em dinheiro', 'n', '', 'R$'],
  ['inicial', 'entradaFGTS', 'Entrada com FGTS', 'n', '', 'R$'],
  ['inicial', 'documentacao', 'Documentação', 'n', 'ITBI, cartório, registro (obrigatório)', 'R$'],
  ['inicial', 'saldoFGTSAtual', 'Saldo inicial do FGTS', 'n', 'preencha uma vez, com a data do extrato', 'R$'], // nome antigo do campo
  ['inicial', 'dataSaldoFGTS', 'Data do saldo inicial', 'd', '', ''],
];
const pct2dec = x => Number((x / 100).toPrecision(12));
const mostrar = (v, t) => (v == null ? '' : t === 'p' ? nBR(v * 100, 4) : t === 'n' ? nBR(v, 2) : v);
const linha = (g, c, r, t, dica, u, cfg) => `<div class="settingrow"><label for="c-${g}-${c}">${r}<span class="src">${esc(dica)}</span></label>
  <div class="inp"><input id="c-${g}-${c}" name="${g}.${c}" ${t === 'd' ? 'type="date"' : t === 't' ? 'type="text"' : t === 'i' ? 'inputmode="numeric"' : 'inputmode="decimal" data-max="4"'} value="${esc(mostrar(cfg[g][c], t))}"${c === 'documentacao' ? ' required' : ''}><span>${u}</span></div></div>`;
const cartao = (tit, sub, g, cfg) => `<div><div class="kicker">${tit}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>${CAMPOS.filter(x => x[0] === g).map(x => linha(...x, cfg)).join('')}`;

export async function montarConfig(el) {
  const cfg = await obter('config', 'config');
  const n = await contagens();
  el.innerHTML = `<form id="cfg-form" style="display:contents" autocomplete="off">
    <article class="card">${cartao('Contrato', '', 'contrato', cfg)}</article>
    <article class="card">${cartao('Dados iniciais', 'Preenchidos uma vez. Entram no patrimônio e no quanto gastei.', 'inicial', cfg)}
      <div><div style="font-weight:600">Valor médio por mês no FGTS</div><div class="sub">Quanto entra no FGTS por mês, em média. Cada valor vale do mês dele em diante; os meses antes continuam com o valor anterior. Quando aumentar, adicione o valor novo.</div></div>
      <div id="cfg-dep"></div>
      <div class="sub" style="font-weight:600;color:var(--ink)">Novo valor médio: a partir de qual mês e o valor</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><div class="inp sm" style="flex:1 1 140px"><input type="month" id="dep-mes" aria-label="A partir de (mês e ano)"></div><div class="inp sm" style="flex:1 1 120px"><span>R$</span><input id="dep-val" inputmode="decimal" aria-label="Valor médio por mês" placeholder="0,00"></div><button class="btn" type="button" id="dep-add" style="min-height:44px">Adicionar</button></div>
      <div class="sub" id="cfg-fg"></div>
      <div class="row" style="padding-top:4px"><span class="sub">Valor de compra do imóvel (calculado)</span><b id="cfg-vc"></b></div>
      <button class="btn primary block" type="submit">Salvar dados</button></article>
  </form>
  <div id="premissas" style="display:contents"></div>
  <article class="card"><div><div class="kicker">Backup</div><div class="sub">Os dados ficam só neste aparelho. Exporte para um arquivo e guarde no Drive.</div></div>
    <div class="sub" id="cfg-arm"></div>
    <dl class="dl" style="margin:0"><dt>Parcelas lançadas</dt><dd>${n.parcelasReais}</dd><dt>Amortizações extras</dt><dd>${n.amortizacoesReais}</dd><dt>Cenários</dt><dd>${n.cenarios}</dd><dt>Versões guardadas</dt><dd>${n.versoes}</dd></dl>
    <button class="btn primary block" id="cfg-exp" type="button">${ic('dl', 18)} Exportar backup</button>
    <button class="btn block" id="cfg-imp" type="button">${ic('ul', 18)} Importar backup</button>
    <div id="impbox" class="cutbox" hidden>Importar <b>substitui tudo</b> o que está neste aparelho. Escolha o arquivo e confirme.<div style="display:flex;gap:8px;margin-top:10px"><input type="file" id="impfile" accept="application/json,.json" style="flex:1;min-width:0"><button class="btn" id="impok" type="button" style="min-height:44px">Substituir</button></div></div></article>`;

  Promise.all([navigator.storage?.persisted?.(), navigator.storage?.estimate?.()]).then(([p, e]) => {
    $('#cfg-arm', el).textContent = `Armazenamento persistente: ${p ? 'sim' : 'não'}${e?.usage != null ? ` · usado: ${nBR(e.usage / 1048576, 1)} MB` : ''}`;
  }).catch(() => {});
  const form = $('#cfg-form', el);
  const ler = () => {
    const novo = structuredClone(cfg); // preserva campos que o formulário não mostra
    CAMPOS.forEach(([g, c, , t]) => {
      const v = form.elements[`${g}.${c}`].value.trim();
      novo[g][c] = v === '' ? null : t === 'n' || t === 'i' ? num(v) : t === 'p' ? (num(v) == null ? null : pct2dec(num(v))) : v;
    });
    return novo;
  };
  // FGTS: quanto cresce por mês e em 24 meses (uma janela), com 3% a.a. e o 13º em dobro em dezembro; sem TR (é pequena)
  const fgtsHint = ({ saldoFGTSAtual: s, dataSaldoFGTS: dt, depositoMensalFGTS: dep, depositosFGTS: depositos }) => {
    if (s == null || !dep) return 'Com o saldo inicial e um valor médio por mês cadastrados, o app soma sozinho, mês a mês, esse valor e o rendimento, e desconta os usos do FGTS que você lançar.';
    const r = 1.03 ** (1 / 12) - 1, fg = { deposito: dep, depositos }, hoje = new Date().toISOString().slice(0, 7);
    let v = s, c = (dt ?? new Date().toISOString()).slice(0, 7);
    for (let k = 1; k <= 24; k++) { c = somaMeses(c + '-01', 1).slice(0, 7); v = v * (1 + r) + depositoFGTS(fg, c) * (c.endsWith('-12') ? 2 : 1); }
    return `A partir do saldo inicial, o app soma sozinho o valor médio de cada mês e o rendimento e desconta os usos que você lançar. Hoje o FGTS cresce cerca de <b>${R(depositoFGTS(fg, hoje) + s * r)}</b> por mês (valor médio + 3% a.a.; dezembro em dobro); 24 meses depois da data do saldo inicial, sem usos, chega a cerca de <b>${R(v, 0)}</b>.`;
  };
  const calc = () => { const c = ler(); $('#cfg-vc', el).textContent = R(valorCompra(c)); $('#cfg-fg', el).innerHTML = fgtsHint(c.inicial); };
  form.addEventListener('input', calc);
  calc();
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const novo = ler();
    if (novo.inicial.documentacao == null) return toast('Documentação é obrigatória.', 4500);
    await salvar('config', novo);
    Object.assign(cfg, novo);
    toast('Dados salvos.');
  });

  // depósitos do FGTS: lista [{desde, valor}] gravada na hora (não depende do "Salvar dados");
  // depositoMensalFGTS espelha o mais recente (estimativa acima e cadastros antigos, sem lista)
  const listaDep = () => {
    const h = cfg.inicial.depositosFGTS ?? [], antigo = !h.length && cfg.inicial.depositoMensalFGTS != null;
    $('#cfg-dep', el).innerHTML = (antigo ? [{ desde: null, valor: cfg.inicial.depositoMensalFGTS }] : h).map(d => `<div class="row" style="min-height:44px;border-bottom:1px solid var(--line)"><span>${d.desde ? `a partir de <b>${rotuloMes(d.desde)}</b>` : 'todos os meses'}</span><span><b>${R(d.valor)}</b> <button type="button" class="btn" style="min-height:36px;padding:0 12px;margin-left:6px" data-dep="${d.desde ?? ''}" aria-label="Apagar o valor ${d.desde ? 'de ' + rotuloMes(d.desde) : ''}">×</button></span></div>`).join('')
      || '<div class="sub">Nenhum valor cadastrado.</div>';
  };
  const gravarDep = async lista => {
    const novo = structuredClone(cfg), h = lista.sort((a, b) => (a.desde < b.desde ? -1 : 1));
    novo.inicial.depositosFGTS = h;
    novo.inicial.depositoMensalFGTS = h.at(-1)?.valor ?? null;
    await salvar('config', novo);
    Object.assign(cfg, novo);
    listaDep(); calc();
  };
  $('#dep-add', el).onclick = async () => {
    const desde = $('#dep-mes', el).value, valor = num($('#dep-val', el).value);
    if (!desde || !(valor > 0)) return toast('Informe o mês e o valor médio.', 4500);
    await gravarDep([...(cfg.inicial.depositosFGTS ?? []).filter(d => d.desde !== desde), { desde, valor }]); // mesmo mês substitui
    $('#dep-mes', el).value = ''; $('#dep-val', el).value = '';
    toast(`${R(valor)} por mês a partir de ${rotuloMes(desde)}.`);
  };
  $('#cfg-dep', el).onclick = async e => {
    const b = e.target.closest('[data-dep]'); if (!b) return;
    await gravarDep((cfg.inicial.depositosFGTS ?? []).filter(d => d.desde !== b.dataset.dep));
    toast('Valor apagado.');
  };
  listaDep();

  $('#cfg-exp', el).onclick = async () => {
    const b = await exportarTudo();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(b, null, 2)], { type: 'application/json' }));
    a.download = `financiamento-${new Date().toISOString().slice(0, 10)}.backup.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Backup exportado.');
  };
  $('#cfg-imp', el).onclick = () => { const x = $('#impbox', el); x.hidden = !x.hidden; };
  $('#impok', el).onclick = async () => {
    const f = $('#impfile', el).files[0];
    if (!f) return toast('Escolha o arquivo do backup.', 4500);
    try {
      await importarTudo(JSON.parse(await f.text()));
      location.reload();
    } catch (err) { toast('Falha ao importar: ' + err.message, 6000); }
  };

  await montarPremissas($('#premissas', el));
}
