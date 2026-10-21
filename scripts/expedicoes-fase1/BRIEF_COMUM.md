# Brief comum — rebuild do Sistema de Expedições dentro do QS

Pedido do Bruno (dono da agência, iniciante em código, fala português): "tudo que existir no sistema
antigo também existir nesse". Estamos recriando as telas internas do app antigo (Next.js 15, clonado em
`/tmp/sx` no Git Bash — `C:\Users\BRUNOO~1\AppData\Local\Temp\sx` ou rode `ls /tmp/sx`; se não existir,
`git clone https://github.com/smartmiles40-sys/sistema-expedicoes /tmp/sx`) dentro do QS
(`C:\Users\Bruno Oliveira\.claude\qs-turis`, React 18 + TS + Vite + Tailwind, Supabase `eabfjomrnucymduqnbci`).

## Fonte da verdade
- `scripts/expedicoes-fase1/SPEC_SISTEMA_ANTIGO.md` — spec funcional completa (leia a SUA seção inteira +
  a seção 0 e a "Riscos/bugs para não replicar"). Na dúvida, leia o código original em /tmp/sx.
- Paridade de FUNCIONALIDADE (tudo que a tela antiga faz), com a cara do QS. Não copie os bugs listados.

## O banco
- As tabelas do app antigo JÁ EXISTEM no banco do QS com os MESMOS nomes/colunas (migração 0160), com os
  dados reais copiados. Tipos em `src/expedicoes/lib/database.ts`.
- RLS: `exp_tem_acesso()` (ler), `is_readonly()` bloqueia escrita, `exp_eh_admin()`. `acesso_links` e
  `acesso_senhas` não têm policy (só service role).
- Storage: buckets `arquivos-expedicoes` e `pasta_public` (policies na 0161).
- O que no app antigo usava SERVICE ROLE vira: função SQL `security definer` com checagem
  (`exp_tem_acesso()` / `not is_readonly()` / `exp_eh_admin()`) OU uma rota `api/*.js` da Vercel do QS
  (veja como as existentes em `api/` validam o JWT do usuário) — só quando precisar do Auth admin.
- Escrita que no antigo eram vários inserts soltos → uma função SQL (atômica).
- Migrações: arquivo em `supabase/migrations/NNNN_nome.sql` com o número que te foi DADO, e aplique com
  a ferramenta MCP `mcp__claude_ai_Supabase__apply_migration` (project_id `eabfjomrnucymduqnbci`). SÓ
  ADITIVO: criar função/trigger/índice/policy. Não altere/apague coluna, não mexa em dados.
  NÃO grave dados de teste no banco (é produção) — confira com SELECTs somente.
- Teto de 1000 linhas do PostgREST: use `lerTudo`/`lerPorIds` de `src/expedicoes/lib/banco.ts`.

## O que já existe (use, NÃO edite — outros agentes trabalham em paralelo)
- `src/expedicoes/lib/*` (regras portadas: prontidao/, processos/template.ts, fidelidade, cpf, saude,
  alertas/regras, rooming/acompanhante, portal-voos, csv/passageiros-import, comprimir-imagem, utils,
  constants, pessoas, banco.ts, agregados.ts).
- `src/expedicoes/ui.tsx`: PilulaStatus, Selo, Anel, Gaveta (drawer lateral), BotaoExcluir (confirma;
  some no só-leitura), CelulaEditavel, CelulaEscolha, Abas, Carregando, Cartao, useAoVivo (realtime),
  Busca. `@/rel/ui`: Botao, Campo (é um <label> — não embrulhe grupos de botões nele), Entrada, Modal,
  Avatar, Etiqueta, Vazio, Aviso.
- `src/expedicoes/contexto.tsx` → `useExp()` = { somenteLeitura, podeDecidirInscricao, usuarios,
  recarregarUsuarios, ir(tela, caminho?), avisar(texto, tom) }. Sempre respeite `somenteLeitura`
  (esconde botões de editar/criar/excluir).
- `src/expedicoes/detalhe/ExpedicaoDetalhe.tsx`: abas recebem `PropsAba = { exp, sub, onMudou }`;
  `sub` = resto do endereço `#ops/expedicoes/<id>/<aba>/<sub...>`. Navegar: `ir("expedicoes", \`${exp.id}/<aba>/...\`)`
  (pacote: `ir("pacotes", ...)`). `onMudou()` recarrega o cabeçalho.
- Exemplos de estilo pronto: `src/expedicoes/lista/ExpedicoesLista.tsx`, `detalhe/VisaoGeral.tsx`.
- Cores via CSS vars: --bg --card --card2 --ink --ink2 --ink3 --line --rel --rel-ink --rel-soft
  --warn-bg --warn-ink --err-bg --err-ink. Dark mode já funciona por elas. Operações = âmbar.
- Libs instaladas: date-fns 4, @dnd-kit/core + sortable + utilities, exceljs (carregue com
  `await import("exceljs")`).

## Regras
- Mexa SÓ nos arquivos/pastas que são seus (listados no seu pedido). Componentes auxiliares: crie dentro
  da sua pasta. Se precisar de algo num arquivo compartilhado, NÃO edite — diga no relatório final.
- Textos da interface em português do Brasil, linguagem simples. Comentários curtos no topo dos arquivos
  no padrão dos existentes (o que é, de onde veio no app antigo).
- Typecheck: `npx tsc --noEmit -p tsconfig.app.json` — zere os erros dos SEUS arquivos (erros em arquivos
  de outros agentes podem aparecer enquanto eles trabalham; ignore).
- Proibido: `git commit`/`push`, mexer na Vercel, mandar WhatsApp/e-mail, gravar dados no banco.
- Relatório final (curto): o que ficou pronto, o que ficou de fora e por quê, migrações aplicadas,
  e qualquer coisa que precise ser ligada em arquivo compartilhado.
