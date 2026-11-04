// Tela Lançar: parcela (2 campos + Detalhar), previsão congelada ao lado, amortização extra e saldo do FGTS.
import { listar, salvar } from '../db.js';
import { replayHistorico, lancarParcela, conferirExtra, proximoVencimento } from '../engine.js';
import { saldoFGTSReal, proximoUsoFGTS, podeUsarFGTS } from '../invest.js';
import { aoMudarReal } from './real.js';
import { $, R, RS, N, PC, nBR, num, esc, ic, dataBR, rotuloMes, toast } from './comum.js';

const hojeISO = () => new Date().toISOString().slice(0, 10);
const TEXTOS = /^(vencimento|dataPagamento|data|origem)$/;
/** Lê os campos nomeados do formulário: vazio some; datas e origem ficam texto; o resto é número pt-BR. */
const lerForm = f => Object.fromEntries([...new FormData(f)].filter(([, v]) => String(v).trim() !== '')
  .map(([k, v]) => [k, TEXTOS.test(k) ? v : num(v)]).filter(([, v]) => v != null));
const campo = (nome, rot, ph = '', unid = 'R$', pre = '') => `<div class="field"><label for="f-${pre}${nome}">${rot}</label><div class="inp sm"><span>${unid}</span><input id="f-${pre}${nome}" name="${nome}" inputmode="decimal" placeholder="${ph}" autocomplete="off"></div></div>`;
const data = (nome, rot, v, pre = '') => `<div class="field"><label for="f-${pre}${nome}">${rot}</label><div class="inp sm"><input id="f-${pre}${nome}" name="${nome}" type="date" value="${v ?? ''}"></div></div>`;
const avisos = l => l.map(a => `<div class="hint err">${esc(a)}</div>`).join('');

// Previsão congelada: versão mais recente do plano ativo criada antes deste lançamento (versoes: PRD §3.8).
function previsao(cenarios, versoes, competencia) {
  const ativos = new Set(cenarios.filter(c => c.planoAtivo).map(c => c.id));
  const agora = new Date().toISOString();
  const v = versoes.filter(x => ativos.has(x.cenarioId) && x.criadaEm < agora).sort((a, b) => (a.criadaEm < b.criadaEm ? 1 : -1))[0];
  return { prev: v?.meses.find(m => m.competencia === competencia), versao: v };
}

function tabela(r, prev, S) {
  const L = r?.registro;
  const linhas = [['Juros', prev?.juros, L?.juros], ['TR do mês', prev && prev.saldoCorrigido - prev.saldoInicial, L?.correcao], ['Amortização', prev?.amortizacao, L?.amortizacao],
    ['Seguros + taxa', prev && prev.mip + prev.dfi + prev.taxa, L && L.seguros + L.taxa], ['Saldo após o pagamento', prev?.saldoAposParcela, L?.saldoApos]];
  const corpo = linhas.map(([n, p, l], i) => {
    const df = p != null && l != null ? l - p : null, forte = i === 1 || i === 4;
    return `<tr><td>${n}</td><td>${p != null ? N(p) : '—'}</td><td><b>${l != null ? N(l) : '—'}</b></td><td class="${df != null && Math.abs(df) >= 0.05 && forte ? 'neg' : ''}" style="${forte ? 'font-weight:700' : ''}">${df == null ? '—' : Math.abs(df) < 0.005 ? '0,00' : RS(df).replace('R$ ', '')}</td></tr>`;
  }).join('');
  let nota = '';
  if (L) {
    const tr = L.calc.trMes * 100, dtr = prev ? tr - prev.trMes * 100 : null;
    nota = `TR do mês <b>${PC(tr, 3)}</b>${prev ? ` contra ${PC(prev.trMes * 100, 3)} previsto (${Math.abs(dtr) < 0.0005 ? '' : dtr >= 0 ? '+' : '−'}${nBR(Math.abs(dtr), 3)} p.p.), ${RS(S * dtr / 100)} no saldo` : ' (sem previsão congelada para este mês)'}. O mês entra na <b>Faixa ${L.calc.faixa}</b>.${avisos(r.avisos)}`;
  }
  return { corpo, nota };
}

export async function montarLancar(el, config) {
  const [parcelas, extras, fgts, premissas, cenarios, versoes] =
    await Promise.all(['parcelasReais', 'amortizacoesReais', 'fgtsReal', 'premissas', 'cenarios', 'versoes'].map(listar));
  const prem = premissas.find(p => p.id === 'padrao') ?? premissas[0];
  const linha = replayHistorico(config, parcelas, extras, prem);
  const venc = proximoVencimento(parcelas, config) ?? '';
  const proxFGTS = proximoUsoFGTS(fgts), saldoFGTS = saldoFGTSReal(fgts);
  const ultFGTS = fgts.filter(m => m.tipo === 'uso-amortizacao').map(m => m.data).sort().pop();
  const prev0 = venc ? previsao(cenarios, versoes, venc.slice(0, 7)) : {};
  const e = linha.estado;

  el.innerHTML = `
  <form class="card" id="lp" autocomplete="off">
    <div class="row"><div><div class="kicker">Lançar parcela</div><div class="h2" id="lp-mes">${venc ? rotuloMes(venc.slice(0, 7)) : '—'}</div></div><span class="tag warn" id="lp-venc">${venc ? 'Vence ' + dataBR(venc).slice(0, 5) : 'Informe o vencimento'}</span></div>
    <div class="sub">Saldo atual ${R(e.saldo)} · prazo ${e.prazo ?? '—'} meses · A+J ${R(e.pmt)}</div>
    <div class="field"><label for="f-pago">Valor pago</label><div class="inp"><span>R$</span><input id="f-pago" name="pago" inputmode="decimal" placeholder="${prev0.prev ? N(prev0.prev.encargo) : '0,00'}" autocomplete="off"></div></div>
    <div class="field"><label for="f-saldoApos">Saldo devedor depois do pagamento</label><div class="inp"><span>R$</span><input id="f-saldoApos" name="saldoApos" inputmode="decimal" placeholder="${prev0.prev ? N(prev0.prev.saldoAposParcela) : '0,00'}" autocomplete="off"></div><div class="hint">Está no app da Caixa, em Extrato do contrato.</div></div>
    <details class="det"><summary><span>Detalhar <span class="muted" style="font-weight:500">· opcional</span></span><span class="chev">${ic('chev', 20)}</span></summary>
      <div class="detbody">
        ${data('vencimento', 'Vencimento', venc)}${data('dataPagamento', 'Data do pagamento', '')}
        ${campo('devido', 'Valor devido')}${campo('amortizacao', 'Amortização')}${campo('juros', 'Juros')}${campo('correcao', 'Correção (TR)')}${campo('mip', 'MIP')}${campo('dfi', 'DFI')}${campo('taxa', 'Taxa')}
        <div class="hint" style="grid-column:1/-1">Se digitar a quebra da Caixa e ela diferir do cálculo em mais de R$ 0,05, o valor da Caixa vale e o app avisa.</div>
      </div></details>
    <button class="btn primary block" id="lp-ok" type="submit">Lançar parcela</button>
    <hr class="hr">
    <div class="row"><div class="kicker">Previsão congelada × lançado</div><span class="tag">${prev0.versao ? 'versão ' + new Date(prev0.versao.criadaEm).toLocaleDateString('pt-BR') : 'sem versão'}</span></div>
    <div class="tablewrap fit"><table><thead><tr><th>R$</th><th>Previsto</th><th>Lançado</th><th>Dif.</th></tr></thead><tbody id="lp-cmp"></tbody></table></div>
    <div class="cutbox" id="lp-note" hidden></div>
  </form>

  <form class="card" id="lx" autocomplete="off">
    <div><div class="kicker">Amortização extra</div><div class="sub">Lançamento separado da parcela. Reduz o prazo.</div></div>
    <div class="grid2">${data('data', 'Data', hojeISO(), 'x-')}${campo('valor', 'Valor', '0,00', 'R$', 'x-')}</div>
    <div class="field"><label>Origem do dinheiro</label><input type="hidden" name="origem" value="bolso"><div class="seg" id="lx-org" role="group"><button type="button" data-v="bolso" aria-pressed="true">Bolso</button><button type="button" data-v="fgts" aria-pressed="false">FGTS</button></div>
      <div class="hint err" id="lx-fgts" hidden></div></div>
    <div class="grid2">${campo('prazoNovo', 'Prazo novo (meses)', '', '', 'x-')}${campo('encargoNovo', 'Encargo novo', '', 'R$', 'x-')}</div>
    ${campo('ajNovo', 'A+J novo', '', 'R$', 'x-')}
    <details class="det"><summary><span>Detalhar <span class="muted" style="font-weight:500">· opcional</span></span><span class="chev">${ic('chev', 20)}</span></summary>
      <div class="detbody">${campo('mipNovo', 'MIP novo', '', 'R$', 'x-')}${campo('dfiNovo', 'DFI novo', '', 'R$', 'x-')}${campo('saldoApos', 'Saldo após', '', 'R$', 'x-')}</div></details>
    <div id="lx-out" style="display:flex;flex-direction:column;gap:8px"></div>
    <button class="btn primary block" type="submit">Lançar amortização</button>
  </form>

  <details class="card flat det"><summary><span>Saldo do FGTS <span class="muted" style="font-weight:500">· ${saldoFGTS == null ? 'não informado' : R(saldoFGTS)}</span></span><span class="chev">${ic('chev', 20)}</span></summary>
    <form id="lf" class="detbody" autocomplete="off">
      <div class="sub" style="grid-column:1/-1">Próxima amortização com FGTS: ${proxFGTS ? dataBR(proxFGTS) : 'livre'}.</div>
      ${campo('valor', 'Saldo informado', saldoFGTS == null ? '0,00' : N(saldoFGTS), 'R$', 'g-')}${data('data', 'Em', hojeISO(), 'g-')}
      <button class="btn block" style="grid-column:1/-1" type="submit">Atualizar saldo do FGTS</button></form></details>`;

  const lp = $('#lp', el), lx = $('#lx', el), lf = $('#lf', el);
  const calcP = () => {
    const x = lerForm(lp);
    return x.pago == null || x.saldoApos == null || !x.vencimento ? null : lancarParcela(linha, x, config, prem);
  };
  const atualizarP = () => {
    const r = calcP(), x = lerForm(lp);
    const { prev } = r ? previsao(cenarios, versoes, r.registro.competencia) : x.vencimento ? previsao(cenarios, versoes, x.vencimento.slice(0, 7)) : prev0;
    const t = tabela(r, prev, e.saldo);
    $('#lp-cmp', el).innerHTML = t.corpo;
    const nota = $('#lp-note', el); nota.innerHTML = t.nota; nota.hidden = !t.nota;
    if (x.vencimento) { $('#lp-mes', el).textContent = rotuloMes(x.vencimento.slice(0, 7)); $('#lp-venc', el).textContent = 'Vence ' + dataBR(x.vencimento).slice(0, 5); }
  };
  lp.addEventListener('input', atualizarP);
  atualizarP();
  lp.addEventListener('submit', async ev => {
    ev.preventDefault();
    const r = calcP();
    if (!r) return toast('Informe o valor pago e o saldo depois do pagamento.', 4500);
    if (parcelas.some(p => p.vencimento === r.registro.vencimento)) return toast('Esse vencimento já foi lançado.', 4500);
    await salvar('parcelasReais', r.registro);
    const n = await aoMudarReal();
    toast(`Parcela de ${rotuloMes(r.registro.competencia)} lançada. ${n} ${n === 1 ? 'cenário ganhou' : 'cenários ganharam'} uma versão nova.`, 4500);
  });

  const lerX = () => ({ ...lerForm(lx), primeiroVencApos: venc || undefined });
  const atualizarX = () => {
    const x = lerX(), out = $('#lx-out', el), av = [];
    const aviso = $('#lx-fgts', el);
    const semFGTS = x.origem === 'fgts' && x.data && !podeUsarFGTS(fgts, x.data);
    aviso.hidden = !semFGTS;
    if (semFGTS) aviso.textContent = `${ultFGTS ? `Último uso do FGTS foi em ${dataBR(ultFGTS)}. ` : ''}A janela abre em ${dataBR(proxFGTS)}. O app só avisa e deixa lançar, porque é o real.`;
    if (x.valor == null || !x.data) return (out.innerHTML = '');
    const c = conferirExtra(linha, x, config);
    av.push(...c.avisos);
    out.innerHTML = (c.bateu == null ? `<span class="tag">Prazo calculado: ${c.prazoCalculado} meses</span>`
      : c.bateu ? `<span class="tag ok">${ic('check', 13)} Prazo novo bate com o cálculo (${c.prazoCalculado} meses)</span>` : `<span class="tag warn">A Caixa informou ${x.prazoNovo}; o cálculo dá ${c.prazoCalculado}. Confira.</span>`)
      + `<span class="hint">A+J calculado ${R(c.ajCalculado)}</span>` + avisos(av);
  };
  lx.addEventListener('input', atualizarX);
  $('#lx-org', el).addEventListener('click', ev => {
    const b = ev.target.closest('button'); if (!b) return;
    lx.elements.origem.value = b.dataset.v;
    el.querySelectorAll('#lx-org button').forEach(x => x.setAttribute('aria-pressed', x === b));
    atualizarX();
  });
  lx.addEventListener('submit', async ev => {
    ev.preventDefault();
    const x = lerX();
    if (x.valor == null) return toast('Informe o valor da amortização.', 4500);
    await salvar('amortizacoesReais', x);
    if (x.origem === 'fgts') await salvar('fgtsReal', { data: x.data, tipo: 'uso-amortizacao', valor: x.valor });
    await aoMudarReal();
    toast('Amortização lançada.');
  });

  lf.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = lerForm(lf);
    if (f.valor == null) return toast('Informe o saldo do FGTS.', 4500);
    await salvar('fgtsReal', { data: f.data, tipo: 'saldo-informado', valor: f.valor });
    await aoMudarReal();
    toast('Saldo do FGTS atualizado.');
  });
}
