# Expedições → QS · Fase 1 (banco)

O banco do Sistema de Expedições (`bnbpsuenlokhljrkvlke`) passa a morar no QS (`eabfjomrnucymduqnbci`).
Mesmos nomes de tabelas, então o app antigo continua funcionando só trocando 3 variáveis na Vercel.
O banco antigo **não é tocado**: se algo der errado, basta voltar as variáveis.

## Já feito (21/10, à tarde)
- 0160a/b/c aplicadas no QS (estrutura completa: 34 tabelas, 67 FKs, 70 índices, gatilhos, view, realtime, 2 buckets).
- Ensaio da cópia: 34/34 tabelas com a mesma contagem; FKs validaram tudo (nenhum dado órfão).
- Arquivos: `copiar-arquivos.mjs` (só copia o que falta; à noite leva só os novos).
- Permissões testadas: SDR não vê nada · Relacionamento só vê · Operações/Financeiro/admin veem e editam.

## Antes da troca
1. Criar login no QS pra quem usa o app antigo e ainda não tem (mesmo e-mail):
   `carolina_taketomi@yahoo.com.br` (admin) · `contato@setuforeuvou.com` (admin) ·
   `larissa.souza@agenciasetuforeuvou.com` (operacional) · `glaucia.sousa@agenciasetuforeuvou.com` (leitura).
   A recópia da noite liga cada um ao id do QS automaticamente.
2. Avisar o time: ~30 min sem mexer no sistema de expedições.

## A troca (nessa ordem)
1. `04_noite_antes.sql` no QS (solta FKs, desliga gatilhos).
2. `node scripts/expedicoes-fase1/copiar-dados.mjs --limpar` (apaga o ensaio e recopia; termina conferindo).
3. `05_noite_depois.sql` + `02_fks.sql` no QS (religa gatilhos e FKs; se uma FK falhar, há dado órfão novo — corrigir antes).
4. `node scripts/expedicoes-fase1/copiar-arquivos.mjs` (só os arquivos novos; termina conferindo).
5. Vercel, projeto do sistema de expedições → Environment Variables (Production):
   - `NEXT_PUBLIC_SUPABASE_URL` = URL do QS
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon do QS
   - `SUPABASE_SERVICE_ROLE_KEY` = service role do QS
   → Redeploy.
6. Testar: login no app antigo (com a **senha do QS**), abrir uma expedição, baixar um arquivo,
   rooming, portal `/amigo` com um CPF, formulário `/inscricao`.

## Se der errado
Voltar as 3 variáveis pros valores antigos e fazer Redeploy. O banco antigo ficou intacto
(só não terá o que for feito durante a janela).

## Depois (Fase 2+)
- `scripts/importar-expedicoes.mjs` (rel_expedicoes_vinculo) lê o banco antigo: passar a ler as tabelas locais.
- Apagar `EXPEDICOES_SECRET_KEY` do `.env` quando nada mais ler o banco antigo.
