import { obter, salvar, importarTudo } from '../db.js';
import { montarConfig } from './config.js';
import { montarStatus } from './status.js';
import { montarComparativo } from './comparativo.js';
import { montarLancar } from './lancar.js';
import { montarCenarios } from './cenarios.js';
import { garantirInicial, gerarPendentes } from './versoes.js';
import { $, $$, ic, esc, PC, toast, formatarAoSair } from './comum.js';

const montar = {
  status: el => montarStatus(el),
  lancar: (el, cfg) => montarLancar(el, cfg),
  cenarios: el => montarCenarios(el),
  comparativo: el => montarComparativo(el),
  config: el => montarConfig(el),
};
// [hash, rótulo da aba, ícone, título, subtítulo]; o subtítulo do Status vem do contrato
const TELAS = [
  ['status', 'Status', 'status', 'Status', null],
  ['lancar', 'Lançar', 'lancar', 'Lançar mês', 'Dois campos e um toque'],
  ['cenarios', 'Cenário', 'cenario', 'Editor de cenário', 'Mês a mês, com a prévia sempre à vista'],
  ['comparativo', 'Comparar', 'comparar', 'Comparativo', 'Mesmo custo do bolso em todos os cenários'],
  ['config', 'Config', 'config', 'Config e premissas', 'Tudo editável. Nada sai do aparelho.'],
];
const subContrato = cfg => {
  const c = cfg?.contrato ?? {};
  const sis = c.sistema === 'PRICE' ? 'Tabela Price' : c.sistema ?? '';
  return [sis && c.indexador ? `${sis} + ${c.indexador}` : sis, c.taxaNominalAA != null ? `${PC(c.taxaNominalAA * 100)} a.a.` : ''].filter(Boolean).join(' · ');
};

async function mostrar() {
  const alvo = TELAS.find(t => t[0] === location.hash.slice(1)) ?? TELAS[0];
  const cfg = await obter('config', 'config');
  $$('main > section').forEach(s => { s.hidden = s.id !== alvo[0]; });
  $('#ttl').textContent = alvo[3];
  $('#sub').textContent = alvo[4] ?? subContrato(cfg);
  $('#tabs').innerHTML = TELAS.map(t => `<a href="#${t[0]}" ${t[0] === alvo[0] ? 'aria-current="page"' : ''}>${ic(t[2], 24)}<span>${t[1]}</span></a>`).join('');
  const dock = $('#dock');
  dock.hidden = alvo[0] !== 'cenarios';
  if (dock.hidden) dock.innerHTML = '';
  document.body.classList.toggle('has-dock', !dock.hidden);
  document.documentElement.style.setProperty('--tbh', $('.topbar').offsetHeight + 'px');
  const el = document.getElementById(alvo[0]);
  try { await montar[alvo[0]](el, cfg); } catch (e) {
    console.error(e);
    el.innerHTML = `<article class="card"><div class="h2">Não foi possível montar a tela</div><div class="sub">${esc(e.message)}</div></article>`;
  }
}

function primeiraAbertura() {
  $('.tabbar').hidden = true;
  $('.topbar').hidden = true;
  $('main').innerHTML = `<article class="card" style="margin-top:24px"><div><div class="kicker">Financiamento</div><div class="h2">Nenhum dado neste aparelho</div></div>
    <div class="sub">Importe um backup para continuar de onde parou, ou comece vazio e preencha o contrato na aba Config.</div>
    <div class="field"><label for="ini-imp">Importar arquivo</label><div class="inp sm"><input id="ini-imp" type="file" accept=".json,application/json" style="font-size:14px"></div></div>
    <button class="btn block" id="ini-vazio">Começar vazio</button></article>`;
  $('#ini-imp').onchange = async e => {
    try {
      await importarTudo(JSON.parse(await e.target.files[0].text()));
      location.hash = '#status';
      location.reload();
    } catch (err) { toast('Falha ao importar: ' + err.message, 6000); }
  };
  $('#ini-vazio').onclick = async () => {
    const nulos = cs => Object.fromEntries(cs.split(' ').map(c => [c, null]));
    await salvar('config', { id: 'config',
      contrato: { ...nulos('dataAssinatura valorFinanciado prazoOriginal taxaNominalAA diaVencimento taxaOperacional valorAvaliacao'), sistema: 'PRICE', indexador: 'TR' },
      inicial: nulos('entradaDinheiro entradaFGTS documentacao saldoFGTSAtual dataSaldoFGTS depositoMensalFGTS') });
    location.hash = '#config';
    location.reload();
  };
}

navigator.storage?.persist?.().catch(() => {}); // pede armazenamento persistente, sem bloquear
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
formatarAoSair();

if (await obter('config', 'config')) {
  await garantirInicial();
  addEventListener('hashchange', async () => { window.scrollTo(0, 0); await gerarPendentes().catch(console.error); mostrar(); });
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') gerarPendentes().catch(console.error); });
  mostrar();
} else primeiraAbertura();
