# Financiamento: regras para quem mexe no código

PWA pessoal de acompanhamento do financiamento imobiliário da Caixa (Tabela Price + TR), em JavaScript puro, sem build.
Motor em `src/engine.js`, cenários e projeção em `src/scenario.js`, FGTS e carteira em `src/invest.js`, patrimônio e
gastos em `src/patrimonio.js`, persistência em `src/db.js`, telas em `src/ui/*.js`. Testes: `node tests/<arquivo>.test.js`.
Código, comentários e textos da UI em português.

## Regra nº 1: nunca commitar informação pessoal

Este repositório não guarda nenhum dado real do usuário. Nunca entra num commit:

- backups do app (`*.backup.json`, `financiamento-*.json`) ou qualquer JSON exportado pelo app;
- qualquer arquivo em `seed/` (o histórico real usado pelos testes de backtest fica só na máquina);
- número do contrato, nome, CPF, endereço do imóvel;
- valores reais: saldo devedor, parcelas, encargos, amortizações, saldo e depósitos do FGTS, salário, carteira;
- datas reais do contrato (assinatura, vencimentos, pagamentos, extratos);
- extratos, PDFs e planilhas da Caixa ou do FGTS.

Testes, exemplos, comentários e mensagens de commit usam **só números inventados** (ex.: saldo de 100.000, taxa de
12% a.a., competências em 2030). Os testes que precisam do histórico real leem `seed/` e são pulados sem ele.

**Antes de cada commit**, confira o diff (`git diff --cached`) contra esta lista. Na dúvida, não commite e pergunte.
O `.gitignore` já ignora `seed/`, os backups e extratos; não force (`git add -f`) nada que ele ignore.
