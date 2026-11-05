// Tela Cenário: editor de meses do grupo (orçamento compartilhado) com gerenciamento de cenários. A projeção, a validação
// e a prévia vivem em scenario.js; aqui só se lê os campos, chama as funções e desenha.
import { salvar, apagar } from '../db.js';
import { somaMeses } from '../engine.js';
import { estadoReal, projetarGrupo, validarMes, previa, janelaFGTS, resumo, APORTE_MIN, definirFGTSPrestacao, regraFGTSPrestacao, FGTS_PRESTACAO_MESES } from '../scenario.js';
import { ler, gerarVersoes, marcarPendentes, gerarPendentes } from './versoes.js';
import { $, $$, esc, R, nBR, num, ic, rotuloMes, nomeRegra, toast } from './comum.js';

const somaMes = (c, n) => somaMeses(c + '-01', n).slice(0, 7);
const mesesEntre = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const ate = (x, f) => (x > f ? f : x);
const mesCurto = c => rotuloMes(c).replace('/20', '/');

// estado da tela (sobrevive às remontagens)
let selId = null, comp = null, painel = null, rasc = null; // rasc: valores digitados e ainda não confirmados

async function contexto() {
  const d = await ler();
  const orc = d.orcamentos[0];
  if (!d.parcelas.length || !orc) return null;
  const cens = d.cenarios.filter(c => c.orcamentoId === orc.id).sort((a, b) => (b.regra === 'referencia') - (a.regra === 'referencia'));
  if (!cens.length) return null;
  const pp = Object.fromEntries(d.premissas.map(p => [p.id, p]));
  const estado = estadoReal({ ...d, premissas: pp[cens[0].premissasId] });
  const proj = projetarGrupo(estado, cens, orc, pp);
  const ref = cens.find(c => c.regra === 'referencia') ?? cens[0];
  return { d, orc, cens, pp, estado, proj, fim: proj[ref.id].at(-1)?.competencia ?? estado.competencia };
}

const dupMeses = (proj, alvo) => (alvo.regra === 'manual' ? structuredClone(alvo.meses)
  : Object.fromEntries(proj[alvo.id].filter(m => m.amortBolso + m.amortFGTS + m.resgate > 0)
    .map(m => [m.competencia, { amortBolso: m.amortBolso, amortFGTS: m.amortFGTS, resgate: m.resgate, confirmado: true }])));

/** HTML do painel de criar / renomear / excluir. */
function painelHTML(ctx, cen) {
  const mine = ctx.cens.filter(c => c.regra !== 'referencia');
  if (painel === 'novo') return `<article class="card" style="border-color:var(--accent)"><div class="kicker" style="color:var(--accent-text)">Novo cenário</div>
   <div class="field"><label for="n-nome">Nome</label><div class="inp sm"><input id="n-nome" maxlength="40" placeholder="Ex.: Dividir 70%" style="font-size:16px"></div></div>
   <div class="field"><label for="n-mod">Começar de</label><div class="inp sm"><select id="n-mod" style="font-size:16px"><option value="dividir">Dividir (percentual)</option><option value="amort">Amortizar tudo</option><option value="inv">Investir tudo</option>${mine.map(c => `<option value="c:${c.id}">Cópia de ${esc(c.nome)}</option>`).join('')}</select></div></div>
   <div class="field" id="n-pctw"><label for="n-pct">Percentual do extra que amortiza</label><div class="inp sm"><input id="n-pct" inputmode="numeric" value="50" style="font-size:16px"><span>%</span></div><div class="hint">O resto do extra vai para a carteira. Depois você ajusta mês a mês.</div></div>
   <div class="grid2"><button class="btn" data-act="pcancel">Cancelar</button><button class="btn primary" data-act="ncreate">Criar cenário</button></div></article>`;
  if (painel === 'ren') return `<article class="card" style="border-color:var(--accent)"><div class="kicker" style="color:var(--accent-text)">Renomear cenário</div>
   <div class="field"><label for="n-nome">Novo nome</label><div class="inp sm"><input id="n-nome" maxlength="40" value="${esc(cen.nome)}" style="font-size:16px"></div></div>
   <div class="grid2"><button class="btn" data-act="pcancel">Cancelar</button><button class="btn primary" data-act="nren">Salvar nome</button></div></article>`;
  if (painel !== 'del') return '';
  const blocked = cen.regra === 'referencia' ? 'A referência não pode ser excluída.' : cen.planoAtivo ? 'Este é o plano ativo. Torne outro cenário o plano ativo antes de excluir.' : mine.length < 2 ? 'É preciso manter pelo menos um cenário.' : '';
  return `<article class="card" style="border-color:var(--f1)"><div class="kicker" style="color:var(--f1)">Excluir cenário</div>
   <div>${blocked ? `<b>${esc(cen.nome)}</b> não pode ser excluído. ${blocked}` : `Excluir <b>${esc(cen.nome)}</b>? Ele sai das telas e do comparativo. As versões que ele já gerou continuam guardadas no backup.`}</div>
   <div class="grid2"><button class="btn" data-act="pcancel">Cancelar</button><button class="btn primary" style="background:var(--f1);border-color:var(--f1);color:#fff" data-act="ndel" ${blocked ? 'disabled' : ''}>Excluir</button></div></article>`;
}

/** Bloco "FGTS nas prestações" do cenário: modo (desligado, período, automático), 1º pedido, renovação, valor e o que a projeção faz. */
function fgtsPrestacaoHTML(cen, ms, mes, comp, prem, estado) {
  if (cen.regra === 'referencia') return '';
  const fp = cen.fgtsPrestacao, rg = regraFGTSPrestacao(prem), pct = Math.round(rg.pct * 100), N = FGTS_PRESTACAO_MESES;
  const pedidos = ms.filter(m => m.fgtsPedido > 0), total = ms.reduce((s, m) => s + (m.fgtsPrestacao ?? 0), 0), ini = pedidos[0]?.competencia;
  const base = rg.base === 'aj' ? 'do A+J' : 'da prestação';
  const seg = (v, t) => `<button type="button" data-act="fp" data-v="${v}" aria-pressed="${(fp?.modo ?? 'off') === v}">${t}</button>`;
  const qtd = pedidos.length ? ` ${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'}, ${R(total, 0)} abatidos das prestações.` : '';
  let st = '';
  if (!estado.fgts) st = 'Sem saldo de FGTS informado: cadastre o saldo inicial na Config para usar.';
  else if (fp?.modo === 'periodo') st = `Primeiro pedido em <b>${rotuloMes(ini ?? fp.inicio)}</b>${fp.renovar ? ', e um novo ao fim de cada período, até quitar' : ''}.${qtd}`;
  else if (fp?.modo === 'auto') st = ini ? `Primeiro pedido em <b>${rotuloMes(ini)}</b>, depois da última amortização com FGTS, renovando até a quitação.${qtd}`
    : 'Neste cenário o FGTS ainda tem janela de amortização antes da quitação (ou nunca amortiza): o automático não pede.';
  if (estado.fgts?.credito) st += ` Pedido real em curso: ${R(estado.fgts.credito.porMes)} por mês por mais ${estado.fgts.credito.meses} ${estado.fgts.credito.meses === 1 ? 'mês' : 'meses'}.`;
  let doMes = '';
  if (mes?.fgtsPedido > 0) doMes = `Pedido neste mês: <b>${R(mes.fgtsPedido)}</b> saem do FGTS (o máximo seria ${R(mes.fgtsPedidoTeto)}). `;
  else if (mes?.fgtsPedidoTeto != null) doMes = `<span style="color:var(--f1)">Sem saldo de FGTS para o pedido neste mês.</span> `;
  if (mes?.fgtsPrestacaoMes) doMes += `Mês ${mes.fgtsPrestacaoMes} do período: abate <b>${R(mes.fgtsPrestacao)}</b> da parcela de ${R(mes.encargo)}; do bolso, <b>${R(mes.encargo - mes.fgtsPrestacao)}</b>. Falta abater ${R(mes.fgtsCredito)}.`;
  if (mes?.fgtsPedido > 0 && mes.fgtsPedido < Math.min(fp?.valor ?? Infinity, mes.fgtsPedidoTeto) - 0.005) doMes += ` <span style="color:var(--f1)">O saldo do FGTS não cobre o pedido todo.</span>`;
  return `<div class="field"><label>FGTS nas prestações</label>
    <div class="seg" role="group" aria-label="FGTS nas prestações">${seg('off', 'Desligado')}${seg('periodo', 'Por período')}${seg('auto', 'Automático')}</div>
    ${fp?.modo === 'periodo' ? `<div class="field"><label for="e-fpini">Mês do primeiro pedido</label><div class="inp sm"><input id="e-fpini" type="month" value="${fp.inicio}" style="font-size:16px"></div></div>
      <div class="toggle"><span>Pedir de novo ao fim de cada período<small class="sub" style="display:block">Um pedido a cada 12 meses, até quitar</small></span><button class="sw" role="switch" aria-checked="${!!fp.renovar}" aria-label="Pedir de novo ao fim de cada período" data-act="fprenov"></button></div>` : ''}
    ${fp ? `<div class="field"><label for="e-fpval">Valor de cada pedido</label><div class="inp sm"><span>R$</span><input id="e-fpval" inputmode="decimal" placeholder="o máximo possível" value="${fp.valor != null ? nBR(fp.valor) : ''}"></div></div>` : ''}
    ${st ? `<div class="hint">${st}</div>` : ''}${doMes ? `<div class="hint">${doMes}</div>` : ''}
    <div class="hint">Como na Caixa: você pede até ${pct}% ${base} × ${N} meses (ou o prazo restante), limitado ao saldo do FGTS <b>na hora do pedido</b>. O valor sai todo do FGTS e abate a prestação em partes iguais; os depósitos que entram depois ficam para o próximo pedido. O bolso liberado segue a regra do cenário (amortiza, divide ou vai para a carteira; no manual, vira aporte). O <b>automático</b> pede só depois da última janela de amortização, quando o FGTS ficaria parado de vez.</div></div>`;
}

function dockHTML(p, mes, manual, cen, ctx) {
  const q = manual ? p?.novaQuitacao : resumo(ctx.proj[cen.id]).quitacao;
  const cel = (t, v, title = '') => `<div${title ? ` title="${esc(title)}"` : ''}><small>${t}</small><b>${v}</b></div>`;
  const cels = manual
    ? [cel('Meses reduzidos', p ? `${p.mesesReduzidos} ${p.mesesReduzidos === 1 ? 'mês' : 'meses'}` : '—'), cel('Quitação', q ? rotuloMes(q) : '—'), cel('Nova parcela', R(p?.novaParcela)),
      cel('Patrimônio, 10 anos', p?.patrimonio != null ? R(p.patrimonio, 0) : '—', p?.deltaPatrimonio != null ? `${R(p.deltaPatrimonio, 0)} contra não amortizar` : '')]
    : [cel('Prazo restante', mes ? `${mes.prazoRestante} meses` : '—'), cel('Quitação', q ? rotuloMes(q) : '—'), cel('Parcela do mês', R(mes?.encargo)), cel('Aporte do mês', R(mes?.aporte))];
  return `<div class="pv" aria-live="polite">${cels.join('')}</div>`;
}

export async function montarCenarios(el) {
  const ctx = await contexto();
  const dock = $('#dock');
  if (!ctx) { dock.innerHTML = ''; return (el.innerHTML = '<article class="card"><div class="h2">Nenhum cenário ainda</div><div class="sub">Os cenários são criados na primeira abertura com parcelas lançadas.</div></article>'); }
  const { orc, cens, pp, estado, proj, fim } = ctx;
  const mine = cens.filter(c => c.regra !== 'referencia');
  const cen = cens.find(c => c.id === selId) ?? mine.find(c => c.planoAtivo && c.regra === 'manual') ?? mine[0] ?? cens[0];
  selId = cen.id;
  if (!comp || comp < estado.competencia) comp = estado.competencia;
  comp = ate(comp, fim);
  const prem = pp[cen.premissasId], manual = cen.regra === 'manual';
  const mes = proj[cen.id].find(m => m.competencia === comp), refMes = proj[cens.find(c => c.regra === 'referencia')?.id ?? cens[0].id].find(m => m.competencia === comp);
  const mo = orc.meses[comp] ?? {}, mc = manual ? cen.meses[comp] ?? {} : mes ?? {};
  const confirmado = c => (manual ? cen.meses[c]?.confirmado : orc.meses[c]?.confirmado);
  const bloq = mes?.fgtsLivreEm > comp, jan = janelaFGTS(proj[cen.id]);
  const vi = rasc && rasc.id === cen.id && rasc.comp === comp ? rasc : { extra: mo.extra ?? 0, amortBolso: mc.amortBolso ?? 0, amortFGTS: bloq ? 0 : mc.amortFGTS ?? 0, resgate: mc.resgate ?? 0 };
  const total = estado.prazo, n = mesesEntre(estado.competencia, comp) + 1;

  const ini = somaMes(comp, -2) < estado.competencia ? estado.competencia : somaMes(comp, -2);
  const strip = Array.from({ length: 14 }, (_, j) => somaMes(ini, j)).filter(c => c <= fim)
    .map(c => `<button class="sm-m ${confirmado(c) ? 'c' : ''} ${c === comp ? 'cur' : ''}" data-act="goto" data-c="${c}" aria-label="${rotuloMes(c)}${confirmado(c) ? ', confirmado' : ''}"><span>${mesCurto(c)}</span><i></i></button>`).join('');
  const reps = [['12 meses', 11], ['3 anos', 35], ['5 anos', 59], ['10 anos', 119]].map(([t, k]) => [t, somaMes(comp, k)]).filter(([, c]) => c > comp && c < fim);
  if (fim > comp) reps.push([`Até a quitação`, fim]);
  const opts = reps.map(([t, c]) => `<option value="${c}">${rotuloMes(c)} · ${t}</option>`).join('');

  el.innerHTML = `
  <div class="chips" role="group" aria-label="Cenário">${mine.map(c => `<button class="chip" data-act="scn" data-id="${c.id}" aria-pressed="${cen.id === c.id}">${esc(c.nome)}${c.planoAtivo ? ' ★' : ''}</button>`).join('')}<button class="chip" data-act="pnl" data-v="novo" style="border-style:dashed">+ Novo</button></div>${painelHTML(ctx, cen)}
  <article class="card">
    <div class="monthhero" id="mh"><button class="arrow" data-act="step" data-d="-1" aria-label="Mês anterior">${ic('left', 22)}</button>
      <div style="min-width:0"><div class="m">${rotuloMes(comp).replace('/', '<span style="color:var(--ink3)">/</span>')}</div><small>mês ${n} de ${total} · ${confirmado(comp) ? '<b style="color:var(--accent-text)">confirmado</b>' : 'pré-preenchido'}</small>
        <small>${mes?.faixa ? `Faixa ${mes.faixa} · ` : ''}parcela ${R(mes?.encargo)}${mes?.fgtsPrestacao > 0 ? ` (FGTS ${R(mes.fgtsPrestacao)})` : ''} · saldo após ${R(mes?.saldoFinal)}</small></div>
      <button class="arrow" data-act="step" data-d="1" aria-label="Próximo mês">${ic('right', 22)}</button></div>
    <div class="strip" id="strip">${strip}</div>
    <div class="legend"><span><i class="dot" style="background:var(--accent);border-radius:50%"></i>confirmado</span><span><i class="dot" style="border:2px solid var(--ink3);border-radius:50%;width:10px;height:10px"></i>pré-preenchido</span></div>
  </article>
  <article class="card">
    <div class="block-budget">
      <div class="row"><div class="kicker">Orçamento do mês</div><span class="tag warn">vale para todos os cenários</span></div>
      <div class="field"><label for="e-extra">Extra do mês, além da parcela</label><div class="inp"><span>R$</span><input id="e-extra" inputmode="decimal" value="${nBR(vi.extra)}"></div>
      <div class="hint" id="e-hint"></div></div>
    </div>
    <div class="block-scn">
      <div class="row"><div class="kicker" style="color:var(--accent-text)">Cenário · ${esc(cen.nome)}</div>${cen.planoAtivo ? '<span class="tag best">plano ativo</span>' : ''}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px"><button class="btn" style="min-height:44px;padding:0 14px" data-act="pnl" data-v="ren">Renomear</button><button class="btn" style="min-height:44px;padding:0 14px" data-act="dup">Duplicar</button>${cen.planoAtivo ? '' : '<button class="btn" style="min-height:44px;padding:0 14px" data-act="mkact">Tornar plano ativo</button>'}<button class="btn" style="min-height:44px;padding:0 14px;color:var(--f1)" data-act="pnl" data-v="del">Excluir</button></div>
      ${manual ? '' : `<div class="hint">Cenário de regra (${nomeRegra(cen.regra)}): o mês é derivado e fica só para leitura. Duplique para editar mês a mês.</div>`}
      <div class="field"><label for="e-amort">Amortizar com o bolso</label><div class="inp" id="w-amort"><span>R$</span><input id="e-amort" inputmode="decimal" value="${nBR(vi.amortBolso)}" ${manual ? '' : 'disabled'}></div><div class="hint err" id="e-errs" hidden></div></div>
      <div class="field"><label for="e-fgts">Amortizar com FGTS ${bloq ? `<span class="tag" style="margin-left:6px">${ic('lock', 12)} travado</span>` : ''}</label><div class="inp ${bloq ? 'lock' : ''}"><span>R$</span><input id="e-fgts" inputmode="decimal" value="${nBR(vi.amortFGTS)}" ${bloq || !manual ? 'disabled' : ''}></div>
      <div class="hint">${!jan ? 'Sem saldo de FGTS informado neste cenário.' : bloq ? `O FGTS só pode amortizar a cada 24 meses.${jan.ultimoUso ? ` O último uso foi em <b>${rotuloMes(jan.ultimoUso)}</b>,` : ''} a próxima janela abre em <b>${jan.abreEm ? rotuloMes(jan.abreEm) : 'data fora do horizonte'}</b>${jan.saldoProjetado != null ? ` com saldo projetado de ${R(jan.saldoProjetado, 0)}` : ''}.` : `Janela aberta. Saldo projetado neste cenário: ${R(mes?.fgtsDisponivel, 0)}.${manual && mes?.fgtsDisponivel > 0 ? ` <button class="btn" style="min-height:36px;padding:0 12px;margin-top:6px" data-act="fgtstudo">Usar o saldo todo</button>` : ''}`}${estado.fgts?.aviso ? ` ${esc(estado.fgts.aviso)}` : ''}</div>
      ${manual ? `<div class="toggle" style="margin-top:4px"><span>Repetir o FGTS a cada 24 meses<small class="sub" style="display:block">Depois do 1º uso que você confirmar, cada janela usa o saldo acumulado</small></span><button class="sw" role="switch" aria-checked="${!!cen.usarFGTS}" aria-label="Repetir o FGTS a cada 24 meses" data-act="fgtsrep"></button></div>` : ''}</div>
      ${fgtsPrestacaoHTML(cen, proj[cen.id], mes, comp, prem, estado)}
      <div class="field"><label for="e-resg">Resgatar da carteira para amortizar</label><div class="inp"><span>R$</span><input id="e-resg" inputmode="decimal" value="${nBR(vi.resgate)}" ${manual ? '' : 'disabled'}></div><div class="hint">Resgate sai do aporte mais antigo e não conta como custo novo.</div></div>
      <div class="cutbox"><div id="e-cut"></div>
        <div class="toggle" style="margin-top:4px"><span>Usar valor de corte</span><button class="sw" role="switch" aria-checked="${!!cen.usarValorDeCorte}" aria-label="Usar valor de corte" data-act="corte"></button></div></div>
      <div class="hint" id="e-aporte"></div>
    </div>
    <div class="field"><label for="e-rep">Repetir este valor até</label>
      <div style="display:flex;gap:8px"><div class="inp sm" style="flex:1"><select id="e-rep" ${opts ? '' : 'disabled'}>${opts}</select></div><button class="btn" id="e-repetir" data-act="repetir" ${opts ? '' : 'disabled'}>Repetir</button></div>
      <div class="hint">Só age quando você toca. Nada se espalha sozinho para os outros meses.</div></div>
  </article>`;
  dock.innerHTML = `<div class="in"><div id="dk-pv"></div><button class="btn primary block" id="e-ok" data-act="confirm">Confirmar e próximo</button></div>`;

  const vals = () => ({ extra: num($('#e-extra', el).value) ?? 0, amortBolso: num($('#e-amort', el).value) ?? 0, amortFGTS: num($('#e-fgts', el).value) ?? 0, resgate: num($('#e-resg', el).value) ?? 0 });
  const atualizar = () => {
    const v = vals(); rasc = { id: cen.id, comp, ...v };
    const val = manual ? validarMes(estado, cen, orc, prem, comp, v) : { ok: true, erros: [] };
    const p = manual ? previa(estado, cen, orc, prem, comp, v, 10) : null;
    const tv = v.amortBolso + v.amortFGTS + v.resgate;
    $('#e-hint', el).innerHTML = `Sai do bolso ${R((refMes?.encargo ?? 0) + v.extra)} (parcela ${R(refMes?.encargo)} + extra) em todos os cenários. O que muda é só para onde vai.`;
    $('#e-cut', el).innerHTML = manual && p ? `<b>${R(tv)} → ${p.mesesReduzidos} ${p.mesesReduzidos === 1 ? 'mês' : 'meses'}</b>; corte ${p.valorDeCorte == null ? '—' : R(p.valorDeCorte)}; <b>${R(Math.max(0, p.sobraParaCarteira))}</b> vão para a carteira.` : manual ? '—' : 'Valores derivados da regra do cenário.';
    $('#e-aporte', el).innerHTML = manual && p ? `Aporte do mês na carteira: <b>${R(Math.max(0, p.aporte))}</b> (orçamento menos parcela e amortização com o bolso${p.fgtsPrestacao > 0 ? `; o FGTS pagou ${R(p.fgtsPrestacao)} da parcela` : ''}).` : '';
    const er = $('#e-errs', el); er.hidden = !val.erros.length; er.innerHTML = val.erros.map(esc).join('<br>');
    $('#w-amort', el).classList.toggle('err', !!val.erros.length);
    $('#dk-pv').innerHTML = dockHTML(p, mes, manual, cen, ctx);
    $('#e-ok').disabled = !val.ok;
    $('#e-repetir', el).disabled = !val.ok || !opts;
  };
  el.oninput = ev => { if (ev.target.matches('#e-extra,#e-amort,#e-fgts,#e-resg')) atualizar(); };
  el.onchange = ev => {
    if (ev.target.id === 'n-mod') $('#n-pctw', el).hidden = ev.target.value !== 'dividir';
    if (ev.target.id === 'e-fpini' && /^\d{4}-\d{2}$/.test(ev.target.value)) mudarFP({ ...cen.fgtsPrestacao, inicio: ev.target.value }).catch(e => toast(e.message, 6000));
    if (ev.target.id === 'e-fpval') { const { valor: _, ...cfg } = cen.fgtsPrestacao, v = num(ev.target.value); mudarFP(v == null ? cfg : { ...cfg, valor: v }).catch(e => toast(e.message, 6000)); }
  };
  atualizar();
  $('#strip .cur', el)?.scrollIntoView({ inline: 'center', block: 'nearest' });

  // deslizar o mês grande troca de mês
  let x0 = null;
  el.onpointerdown = e => { x0 = e.target.closest('#mh') ? e.clientX : null; };
  el.onpointerup = e => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 40) { comp = ate(somaMes(comp, dx < 0 ? 1 : -1), fim); rasc = null; remontar(); } };

  const remontar = () => { const y = window.scrollY; return montarCenarios(el).then(() => window.scrollTo(0, y)); };
  // FGTS nas prestações: grava a opção do cenário (definirFGTSPrestacao recusa o que não vale) e redesenha
  const mudarFP = async cfg => { await salvar('cenarios', definirFGTSPrestacao(estado, cen, cfg)); marcarPendentes([cen.id]); rasc = null; await remontar(); };
  const acao = async (b, a) => {
    const alvo = cen, id = b.dataset.id;
    if (a === 'step') { const c = somaMes(comp, +b.dataset.d); if (c >= estado.competencia && c <= fim) { comp = c; rasc = null; } }
    else if (a === 'goto') { comp = b.dataset.c; rasc = null; }
    else if (a === 'scn') { await gerarPendentes(); selId = id; painel = null; rasc = null; }
    else if (a === 'pnl') painel = painel === b.dataset.v ? null : b.dataset.v;
    else if (a === 'pcancel') painel = null;
    else if (a === 'ncreate') {
      const m = $('#n-mod', el).value, pct = Math.min(99, Math.max(1, parseInt($('#n-pct', el).value) || 50)), nome = $('#n-nome', el).value.trim();
      let novo;
      if (m.startsWith('c:')) { const o = cens.find(c => c.id === m.slice(2)); novo = await duplicar(ctx, o, nome || `${o.nome} (cópia)`); }
      else {
        const regra = m === 'dividir' ? { dividir: pct / 100 } : m === 'amort' ? 'amortizarTudo' : 'investirTudo';
        novo = await salvar('cenarios', { nome: nome || (m === 'dividir' ? `Dividir ${pct}%` : m === 'amort' ? 'Amortizar tudo (novo)' : 'Investir tudo (novo)'), orcamentoId: orc.id, premissasId: cens[0].premissasId,
          planoAtivo: false, regra, usarFGTS: m === 'amort', usarValorDeCorte: false, meses: {} });
        await gerarVersoes('criacao', [novo.id]);
      }
      selId = novo.id; painel = null; rasc = null; toast(`Cenário "${novo.nome}" criado.`);
    } else if (a === 'nren') {
      const nome = $('#n-nome', el).value.trim();
      if (!nome) throw new Error('Digite um nome.');
      await salvar('cenarios', { ...alvo, nome }); painel = null; toast('Cenário renomeado.');
    } else if (a === 'dup') { const novo = await duplicar(ctx, alvo, `${alvo.nome} (cópia)`); selId = novo.id; rasc = null; toast('Cenário duplicado, com todos os meses.'); }
    else if (a === 'mkact') {
      for (const c of ctx.d.cenarios) if (c.planoAtivo !== (c.id === alvo.id)) await salvar('cenarios', { ...c, planoAtivo: c.id === alvo.id });
      toast(`${alvo.nome} agora é o plano ativo.`);
    } else if (a === 'ndel') { await apagar('cenarios', alvo.id); selId = null; painel = null; toast(`"${alvo.nome}" excluído. As versões antigas continuam guardadas.`); }
    else if (a === 'corte') { await salvar('cenarios', { ...alvo, usarValorDeCorte: !alvo.usarValorDeCorte }); marcarPendentes([alvo.id]); }
    else if (a === 'fgtsrep') { await salvar('cenarios', { ...alvo, usarFGTS: !alvo.usarFGTS }); marcarPendentes([alvo.id]); }
    else if (a === 'fp') { const v = b.dataset.v; return mudarFP(v === 'off' ? null : v === 'auto' ? { modo: 'auto', ...(alvo.fgtsPrestacao?.valor != null && { valor: alvo.fgtsPrestacao.valor }) } : { modo: 'periodo', inicio: alvo.fgtsPrestacao?.inicio ?? comp, renovar: !!alvo.fgtsPrestacao?.renovar, ...(alvo.fgtsPrestacao?.valor != null && { valor: alvo.fgtsPrestacao.valor }) }); }
    else if (a === 'fprenov') return mudarFP({ ...alvo.fgtsPrestacao, renovar: !alvo.fgtsPrestacao.renovar });
    else if (a === 'fgtstudo') { $('#e-fgts', el).value = nBR(Math.floor(mes.fgtsDisponivel * 100) / 100); atualizar(); return; }
    else if (a === 'confirm' || a === 'repetir') {
      const v = vals(), fimRep = a === 'repetir' ? $('#e-rep', el).value : comp, comps = [];
      for (let c = comp; c <= fimRep; c = somaMes(c, 1)) comps.push(c);
      await aplicar(ctx, alvo, comps, v, manual);
      const prox = ate(somaMes(fimRep, 1), fim);
      toast(a === 'repetir' ? `${comps.length} ${comps.length === 1 ? 'mês confirmado' : 'meses confirmados'}, de ${rotuloMes(comp)} até ${rotuloMes(fimRep)}.` : `${rotuloMes(comp)} confirmado. Abrindo ${rotuloMes(prox)} com os mesmos valores.`);
      comp = prox; rasc = null;
    } else return;
    await remontar();
  };
  const clique = async ev => {
    const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return;
    try { await acao(b, b.dataset.act); } catch (e) { toast(e.message, 6000); }
  };
  el.onclick = clique;
  dock.onclick = clique;
}

async function duplicar({ proj }, alvo, nome) {
  const { id: _, criadoEm, fixo, usarFGTS, ...resto } = alvo;
  const novo = await salvar('cenarios', { ...resto, nome, regra: 'manual', planoAtivo: false, meses: dupMeses(proj, alvo), ...(alvo.regra === 'manual' && { usarFGTS: alvo.usarFGTS }) });
  await gerarVersoes('criacao', [novo.id]);
  return novo;
}

/** Confirma `comps` com os valores `v`, deixa o mês seguinte pré-preenchido (não confirmado) e marca as versões como pendentes. */
async function aplicar({ orc, cens, pp, estado }, cen, comps, v, manual) {
  const prox = somaMes(comps.at(-1), 1);
  const orcN = structuredClone(orc), cenN = structuredClone(cen);
  const pre = (m, c, val) => { if (!m[c]?.confirmado) m[c] = { ...val, confirmado: false }; };
  comps.forEach(c => { orcN.meses[c] = { extra: v.extra, confirmado: true }; });
  pre(orcN.meses, prox, { extra: v.extra });
  if (manual) {
    comps.forEach((c, k) => { cenN.meses[c] = { amortBolso: v.amortBolso, amortFGTS: k ? 0 : v.amortFGTS, resgate: v.resgate, confirmado: true }; });
    pre(cenN.meses, prox, { amortBolso: v.amortBolso, amortFGTS: 0, resgate: v.resgate });
  }
  const val = validarMes(estado, cen, orc, pp[cen.premissasId], comps[0], v);
  if (!val.ok && manual) throw new Error(val.erros.join(' '));
  const novos = cens.map(c => (c.id === cen.id ? cenN : c));
  const proj = projetarGrupo(estado, novos, orcN, pp);
  for (const c of novos) {
    const ruim = proj[c.id].find(m => m.aporte < APORTE_MIN);
    if (ruim) throw new Error(`Aporte negativo em ${rotuloMes(ruim.competencia)} no cenário "${c.nome}" (${R(ruim.aporte)}): o orçamento não cobre as amortizações.`);
  }
  const orcMudou = comps.some(c => !(orc.meses[c]?.confirmado && orc.meses[c].extra === v.extra));
  await salvar('orcamentos', orcN);
  if (manual) await salvar('cenarios', cenN);
  marcarPendentes(orcMudou ? cens.map(c => c.id) : [cen.id]);
}
