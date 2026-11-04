// Gravação de versões (nunca há update/delete em `versoes`). Lê tudo do DB, calcula e grava uma versão por cenário.
import { listar, salvar, obter } from '../db.js';
import { estadoReal, criarVersao, projetarGrupo, premissasPadrao } from '../scenario.js';
import { replayHistorico } from '../engine.js';

export const ler = async () => {
  const [config, parcelas, extras, fgtsReal, premissas, orcamentos, cenarios] =
    await Promise.all([obter('config', 'config'), ...['parcelasReais', 'amortizacoesReais', 'fgtsReal', 'premissas', 'orcamentos', 'cenarios'].map(listar)]);
  return { config, parcelas, extras, fgtsReal, premissas, orcamentos, cenarios };
};

// Edição de cenário não grava versão na hora: marca pendente e grava uma por cenário ao trocar de cenário, sair da tela ou ocultar a página.
const pendentes = new Set();
export const marcarPendentes = ids => ids.forEach(id => pendentes.add(id));
export async function gerarPendentes() {
  if (!pendentes.size) return 0;
  const ids = [...pendentes]; pendentes.clear();
  return gerarVersoes('edicao-cenario', ids);
}

/** Versão nova por cenário (todos, ou só os de `cenarioIds`). Cada grupo (orçamento) é projetado junto. Devolve quantas gravou. */
export async function gerarVersoes(motivo, cenarioIds) {
  if (motivo === 'lancamento-real') pendentes.clear(); // a versão do lançamento já cobre
  const d = await ler();
  if (!d.parcelas.length) return 0;
  const agora = new Date().toISOString();
  const premissasPorId = Object.fromEntries(d.premissas.map(p => [p.id, p]));
  let n = 0;
  for (const orcamento of d.orcamentos) {
    const grupo = d.cenarios.filter(c => c.orcamentoId === orcamento.id && premissasPorId[c.premissasId]);
    if (!grupo.length) continue;
    const estado = estadoReal({ ...d, premissas: premissasPorId[grupo[0].premissasId] });
    const projecoes = projetarGrupo(estado, grupo, orcamento, premissasPorId);
    for (const cenario of grupo.filter(c => !cenarioIds || cenarioIds.includes(c.id))) {
      await salvar('versoes', criarVersao({ cenario, motivo, estado, orcamento, premissas: premissasPorId[cenario.premissasId], agora, meses: projecoes[cenario.id] }));
      n++;
    }
  }
  return n;
}

const REFERENCIA = { nome: 'Contrato sem amortização extra', planoAtivo: false, regra: 'referencia', fixo: true, usarValorDeCorte: false, meses: {} };

/** Primeira abertura com dados: premissa padrão, orçamento "Padrão", referência e cenário "Plano" (+ versões `criacao`). Bancos antigos ganham só a referência. */
export async function garantirInicial() {
  const d = await ler();
  if (!d.config || !d.parcelas.length) return;
  if (d.cenarios.length) { // migração: grupo sem referência ganha uma
    const novos = [];
    for (const o of d.orcamentos.filter(o => !d.cenarios.some(c => c.orcamentoId === o.id && c.regra === 'referencia'))) {
      const irmao = d.cenarios.find(c => c.orcamentoId === o.id);
      if (irmao) novos.push(await salvar('cenarios', { ...REFERENCIA, orcamentoId: o.id, premissasId: irmao.premissasId }));
    }
    if (novos.length) await gerarVersoes('criacao', novos.map(c => c.id));
    return;
  }
  const atual = d.premissas.find(p => p.id === 'padrao') ?? {};
  // o replay só precisa das taxas de seguro; sem elas usa as calibradas de premissasPadrao
  const base = premissasPadrao({ meses: [] }, atual);
  const linhaReal = replayHistorico(d.config, d.parcelas, d.extras, base);
  const { origem, ...padrao } = premissasPadrao(linhaReal, atual);
  const prem = await salvar('premissas', { ...padrao, ...atual, origem: { ...origem, ...atual.origem },
    trMensal: atual.trMensal ?? padrao.trMensal, selic: atual.selic ?? padrao.selic });
  const orc = await salvar('orcamentos', { nome: 'Padrão', meses: {} });
  const ref = await salvar('cenarios', { ...REFERENCIA, orcamentoId: orc.id, premissasId: prem.id });
  const cen = await salvar('cenarios', { nome: 'Plano', orcamentoId: orc.id, premissasId: prem.id, planoAtivo: true, regra: 'manual', usarValorDeCorte: false, meses: {} });
  await gerarVersoes('criacao', [ref.id, cen.id]);
}
