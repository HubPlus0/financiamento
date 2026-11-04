// Tela Config: contrato e dados iniciais (formulário), premissas (premissas.js) e backup.
import { obter, salvar, exportarTudo, importarTudo, contagens, valorCompra } from '../db.js';
import { montarPremissas } from './premissas.js';
import { $, R, num, nBR, esc, ic, toast } from './comum.js';

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
  ['inicial', 'saldoFGTSAtual', 'Saldo atual do FGTS', 'n', '', 'R$'],
  ['inicial', 'dataSaldoFGTS', 'Data do saldo do FGTS', 'd', '', ''],
  ['inicial', 'depositoMensalFGTS', 'Depósito mensal no FGTS', 'n', '8% do salário', 'R$'],
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
  const calc = () => { $('#cfg-vc', el).textContent = R(valorCompra(ler())); };
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
