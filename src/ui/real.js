import { gerarVersoes } from './versoes.js';

// Chamada depois de qualquer gravação do lado real: versão nova de todos os cenários, depois recarrega a tela. Devolve quantas versões gravou.
export const aoMudarReal = async () => {
  const n = await gerarVersoes('lancamento-real');
  dispatchEvent(new Event('hashchange'));
  return n;
};
