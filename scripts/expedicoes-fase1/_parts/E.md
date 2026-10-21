
---

# Parte E — Consolidação: componentes, constantes, riscos, ordem sugerida

## E.1 Páginas × complexidade (linhas aproximadas da UI + actions/libs dedicadas)

| Página | Linhas | Complexidade | Observação |
|---|---|---|---|
| Shell/nav/papéis (layout, Sidebar, Header, CommandPalette, atalhos) | ~800 | Baixa | Todos os papéis veem o menu inteiro; trava só por RLS (Parte A §1–2) |
| Dashboard | ~290 + data | Média | KPIs dependem do motor de prontidão e de `checklist_itens` (corte de 1000) |
| Expedições (lista) + Pacotes | ~1.500 | Média | Cards/tabela, reordenar drag, criar/editar drawers; pacote = `tipo='pacote'` (0060) |
| Expedição overview (`[id]`) | ~700 | Média | Header, abas, DocumentosPendentes, realtime |
| `[id]/passageiros` + `[paxId]` | ~5.000 + actions | **Muito alta** | Tabela inline, prontidão, import CSV, ExpedAmigo, extensões/passeios, grupos G1/G2, mudar expedição |
| `[id]/grupos` | ~280 | Baixa | Sem link no menu de abas (só URL) |
| `[id]/rooming` | ~2.050 + actions | **Muito alta** | dnd-kit, hotéis/trechos/extensões, conexões, automático, XLSX |
| `[id]/checklist` | ~975 + template | Alta | Template SOP 23 processos + 57 subtarefas, prazos relativos ao embarque |
| `[id]/documentos` (Drive) | ~700 | Média | Storage `arquivos-expedicoes` via API service role |
| `[id]/links` | ~340 | Baixa | CRUD simples |
| `[id]/portal` (editor ExpedAmigo) | ~1.600 | Alta | Contrato de dados com `/amigo` (manter compatível) |
| `[id]/roteiro-lider` | ~400 | Média | Contrato com `/lider` + offline |
| `/passageiros` (global, "Clube") | ~1.200 | Alta | Pessoa = agrupamento por CPF/bx/email/nome; XLSX; import global |
| `/clientes` | ~470 | Média | XLSX server-side |
| `/fornecedores` | ~580 | Baixa | CRUD; coluna Histórico conta dados fictícios |
| `/inscricoes` | ~1.100 + core 479 | **Alta** | Aprovar = multi-tabela + n8n/Bitrix + signed URL → Edge Function |
| `/acessos-expedamigo` | ~200 + libs | Média | `acesso_senhas`/links sem RLS → Edge Function |
| `/avisos` | ~150 | Baixa (UI) | Recalcula prontidão de tudo a cada load (alimenta badge do menu) |
| `/configuracoes` | ~360 | Média | auth.admin → Edge Function obrigatória |

## E.2 Componentes que valem portar
- `components/tables/EditableCell.tsx`, `EditableSelectCell.tsx`, `DataTable.tsx` — padrão "planilha turbinada" (Tab/Enter salva, Esc cancela).
- `PassageirosTabela.tsx` (842) + `ProntidaoPaxDrawer.tsx` (885) + `EditarPassageiroDrawer.tsx` (596) + `SaudeCampos.tsx` (213).
- `RoomingBoard.tsx` (1366) + drawers de quarto/hotel/conexão.
- `ChecklistTabela.tsx` (814) — árvore processo → subtarefas.
- `components/arquivos/Drive.tsx` (323), `PassaporteAnexo.tsx` (92), `lib/comprimir-imagem.ts` (70).
- `PortalEditor.tsx` (1295).
- `components/layout/CommandPalette.tsx` (cmdk), `GlobalShortcuts.tsx`, `components/ui/*` (Drawer, ConfirmDeleteButton, LiveBadge, ProgressRing, FilterPopover, StatPill).
- Libs puras (portáveis quase sem mudança, com testes vitest): `lib/prontidao/regras.ts` + `requisitos-destino.ts` + `template.ts` + `vacina-sync.ts`, `lib/processos/template.ts`, `lib/csv/passageiros-import.ts` (+test), `lib/cpf.ts` (+test), `lib/fidelidade.ts` (+test), `lib/saude.ts`, `lib/rooming/acompanhante.ts`, `lib/alertas/regras.ts` (+test), `lib/portal-voos.ts`, `lib/utils.ts`, `lib/constants.ts`.

## E.3 Arquivos de constantes / dados fixos no código
- `lib/constants.ts` — status, labels, cores, opções (copiado na Parte A §3).
- `lib/prontidao/requisitos-destino.ts` — **catálogo de requisitos por destino que vale** (a tabela `requisitos_destino` e a view `vw_prontidao_passageiro` estão desatualizadas) — Parte B.
- `lib/prontidao/template.ts`, `lib/prontidao/regras.ts` — Parte B.
- `lib/processos/template.ts` — template SOP do checklist (Parte C §3; contém "Imprimir … pra Luis").
- `lib/saude.ts` — 13 perguntas de saúde (Parte B).
- `lib/fidelidade.ts` — níveis (Parte B).
- `lib/csv/passageiros-import.ts` — aliases de colunas do CSV (Parte B).
- `lib/bitrix/mapping.ts`, `stage-mapping.ts` — campos `UF_CRM_*` e estágios (Partes A/B).
- `lib/dev-grupos-egito.ts` — divisão G1/G2 do Egito por fragmentos de nome (dado pessoal no código → trocar por update em `passageiros.grupo_id`).
- `lib/mock-data.ts`, `lib/data/arquivos-mock.ts` — só modo dev; não portar.

## E.4 Riscos principais (consolidados das 4 partes)
1. **Escalada de privilégio em `usuarios`** — policy `auth_all_update` deixa qualquer autenticado fazer `update usuarios set papel='admin'`; fora da trava `is_readonly()` (0046). Fechar ANTES de expor o SPA (RPC protegida/trigger).
2. **Service role em ~20 pontos** (§0.2) — Storage, senhas/links ExpedAmigo (`acesso_senhas` e links curtos sem nenhuma policy), aprovar/recusar inscrição, reset de senha (auth.admin), compras, portal, roteiro do líder. Precisam de Edge Functions/RPCs `security definer` ou policies novas; bucket `arquivos-expedicoes` não tem storage policies em migration.
3. **Segredos dos tokens** — tokens de inscrição e de 1º acesso são assinados com `SUPABASE_SERVICE_ROLE_KEY`; Edge Functions precisam usar o mesmo segredo, e girar a chave invalida links já enviados.
4. **"Pessoa" não é tabela** — identidade calculada (`cpf:` → `bx:` → `email:` → `nome:`); edição pessoal propaga para todas as linhas `passageiros` da pessoa baixando a tabela inteira. Virar RPC transacional.
5. **Motor de prontidão em TS** roda sobre tudo em várias telas (layout, dashboard, avisos/badge). Decidir: portar o TS idêntico ou mover p/ view/RPC SQL. Regras sutis: seguro/aéreo/vacina só ok com anexo; passaporte vem de `passageiros.passaporte_arquivo_id`; contrato nunca bloqueia; líder dispensa só contrato; expedição Concluída = todos aptos.
6. **Requisitos não gerados** para pax vindos do Bitrix (webhook sem sessão, RLS bloqueia, erro engolido) e para aprovações feitas por `relacionamento`; tipos novos do catálogo nunca chegam a pax antigos. Sugerido: trigger no banco.
7. **Corte silencioso de 1000 linhas** (PostgREST) em `listPessoas`, `getResumoProcessos`, requisitos de `getProntidaoExpedicao`, arquivos de passageiros, busca por CPF na aprovação. Paginar no SPA.
8. **Escritas não atômicas** — criar expedição + checklist, gerar checklist (2 inserts), reordenar (N updates), alocação de quarto (delete+insert, capacidade só no front). Recomendado RPCs.
9. **Realtime incompleto** — `passageiro_quarto` e `grupos_expedicao` fora da publicação; `passageiro_quarto` com policies que aceitam anon; `extensoes`/`passageiro_extensao` fora da trava readonly.
10. **Contratos com apps que ficam no antigo** — `/amigo` lê `"__base__"` → `apenas_sem_extensao=true`, `grupo_id`/`passageiro_id` dos voos, e `arquivos.descricao` como etiqueta ("Documento do líder", "Ingresso Machu Picchu"); `/lider` idem. O Drive novo não deve deixar apagar esses arquivos de sistema.
11. **Bugs a NÃO replicar** — CSV usa `quarto_id` antigo; "Remover divisão" apaga todos os grupos; mudar expedição deixa compras/extensões/arquivos na antiga; `/api/bitrix/expedicao-sync` não gera checklist (RLS) e zera `pax_planejados`/`preco_venda_brl`; cron conclui expedição sem confirmar pax; botão "Sync Bitrix" do header não faz nada; numeração de quartos instável; status de quarto sem efeito; senha de reset fraca (`Setur@`+4 dígitos).
12. **Câmbio (excluído)** — única dependência fora da tela: criar custo em moeda estrangeira lê taxa de `cambios` (fallback 1.0). As actions de custos/pagamentos não são chamadas por nenhuma tela hoje (código morto).

## E.5 Ordem sugerida de rebuild
1. Segurança do banco (usuarios RLS, policies faltantes, storage policies, trigger de usuário novo em `auth.users`, trigger de requisitos).
2. Shell + lista de expedições/pacotes + overview.
3. Passageiros da expedição + prontidão (maior valor e maior risco).
4. Checklist, Links, Documentos (Edge Function de Storage).
5. Rooming.
6. Globais: Passageiros/Clube, Fornecedores, Clientes, Avisos, Dashboard.
7. Inscrições, Acessos ExpedAmigo, Configurações (dependem de Edge Functions).
8. Portal editor + Roteiro do líder (respeitando contrato com `/amigo` e `/lider`).
