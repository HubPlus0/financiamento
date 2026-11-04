// Lê todos os stores e monta o `dados` dos painéis (cálculo em src/paineis.js).
import { listar } from '../db.js';
import { ler } from './versoes.js';
import { preparar } from '../paineis.js';

export async function carregarDados(extra = {}) {
  const d = await ler();
  return preparar({ ...d, versoes: await listar('versoes'), ...extra });
}
