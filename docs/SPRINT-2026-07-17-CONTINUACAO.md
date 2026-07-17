# Sprint 4 (noturna 16→17/07) — estado e plano de continuação

> Escrito pra qualquer sessão (Opus ou outra) retomar EXATAMENTE de onde parou.
> Pedido do Bruno: "sprint bem parruda, muito completa analisando e melhorando tudo".

## O que JÁ ESTÁ EM PRODUÇÃO
- **Sprint 3 Bloco A** — commit `88f7dd5`, pushado (deploy Vercel ok): 10 correções de
  integridade (metas period_start; MeetingsPage→Bitrix; cadência 0-atividades/fetch-falho/
  troca-encerra-plano-antigo/dia útil na geração inicial + espelho no api/_leads.js;
  auto-desativação bloqueada UI+api; watchdog de sessão desativada; ações em massa da
  LeadsPage medindo RLS via transferLead reformado).
- ⚠️ Migration nova pro Bruno aplicar: `supabase/migrations/0017_bloqueio_usuario_desativado.sql`.

## O que está NA ÁRVORE (WIP, commit local SEM push)
**Sprint 4 Onda A** — 6 agentes paralelos por área, TODOS caíram por limite de sessão
(~00h30 de 17/07) e foram retomados; o WIP pode estar entre "parcial" e "completo" por área.
Escopo por agente (itens = docs/SPRINT-2026-07-14.md, FASES 1-5 + docs/REVISAO-2026-07-13.md):

| Área (arquivos exclusivos) | Escopo | Último estado visto |
|---|---|---|
| A1 LeadDetailPage (+queries/types) | FASE 1 Leads completa: editar lead (updateQsLead), excluir no detalhe, notas CRUD (update/deleteQsNote), qs_contacts CRUD, closed_value no Ganho, temperatura editável, desvincular cadência (closeOpenCadenceTasks), próximas atividades, aba Reuniões rica c/ status→Bitrix "nota", reativar→Bitrix "nota", guards duplo-clique/erro-rede/fechado | estava no item 11/11 |
| A2 TasksPanel | editar/adiar tarefa (nextExecutionDay), desfazer conclusão (toast 10s), excluir extra, busca do modal sem leads fechados, motivos "Aguardando retorno"/"Horário inadequado" REAGENDAM, script_text visível + defaultText WhatsApp, handleSaveExtra/ConfirmMeeting medidos, atalhos p/ refs (stale closure), badge atrasada, classifyFor limpo/atalhos pausados, cadastro pelo painel usa inserted.owner_id, dropdown usa fetchAvailableCadences (A3) | estava no item 7/12 |
| A3 Cadências (CadencesPage/CreatePage/cadenceSweep/queries) | excluir (deleteQsCadence + efeitos), duplicar (novo duplicateSource.ts), congelar DE VERDADE + fetchAvailableCadences (A2/A6 usam), congelar por card, ver leads (modal), controles decorativos honestos (auto_loss_days no sweep SÓ se semântica inequívoca; senão esconder), builder (dia duplicado, confirmação) | início; CadencesPage/cadenceSweep/duplicateSource já tocados |
| A4 Dashboard/Metas (SdrDashboard/Ranking/Coverage/GoalsPage) | motivos de perda respeitam filtros; cap 1000 (filtro SQL + count head); % meta prorrateada; SLA sobre chegados no período; "Contatar agora" navega; meta duplicada bloqueada; meta de EQUIPE (owner null); meta de desativado; range custom UTC→local; 7 dias = 7; auto-refresh 60s + Promise.all; erros viram banner (não zeros); semântica meta na virada de mês | quase nada feito ainda |
| A5 Backend (api/*, vercel.json, n8n/README, serve.cjs, migration 0018) | dedupe inbound normalizado; inbound→em_prospeccao; chatapp-send rate-limit+log (qs_message_log na 0018 se preciso); admin-user rollback/ordem delete; bitrix-sync resolve bitrix_id server-side; vercel.json SÓ headers+maxDuration (sem mexer em build!); rest() timeout; lead-inbound sem err cru + valida UUID; README não religar polling; MESSAGE_TEXT_FIELD documentado; 0018 drop qs_users.password; lixo (package-lock 2/3.json, vite timestamp) deletado do disco; serve.cjs path traversal | api/* todos tocados + vercel.json criado |
| A6 LeadsPage | dup-check no cadastro (tel/email normalizados + "abrir lead"); arrived_at; dono manual (SDR=self, gestor escolhe; tarefas c/ inserted.owner_id); vínculo massa PULA fechados; filtro temperatura; seleção limpa ao filtrar; erro rede = estado c/ retry; paginação compacta; CSV não fechável no meio + dedupe contra o banco + aspas | estava no item 4/11 |

**Regras da sprint** (valem pra qualquer retomada):
- Agentes NUNCA rodam git/build/dev server; verificação central: `npx tsc -b --force` e `npm run build`.
- Toda gravação MEDE o que o banco aceitou (error + .select em update/delete sob RLS).
- Usar as funções órfãs de queries.ts em vez de Supabase inline (nota arquitetural do pente-fino).
- Migrations: 0017 já existe; 0018=A5; 0019=A4 se precisar; 0020=B3 se precisar.
- push origin main = DEPLOY. Só pushar com typecheck+build limpos.

## Próximas ondas (ainda NÃO começadas)
- **Onda B1 Reuniões/Notificações**: excluir reunião; agenda visível pro SDR (MENU_ACCESS
  em QsAuthContext:32 + RLS já isola); meeting_link clicável; remarcar com rastro
  (rescheduled_from ou status); sino: marcar lida/limpar (dismissed), navegar pro lead certo,
  "Reuniões de hoje", guard aba oculta, canAccessNav; lista com a PRÓXIMA no topo; select de
  lead com autocomplete (padrão do modal de atividade extra); quick-actions com disabled.
- **Onda B2 Settings/Auth**: trocar a própria senha (auth.updateUser no menu do avatar,
  SdrLayout:403); reabrir onboarding telefone; "Testar conexão" webfone (helpers prontos);
  seção status ChatApp/Bitrix; FASE 2 do Settings (toggles revertem+toast, 5 seções "Salvo ✓"
  mudas, addProduct disabled, arquivar motivo toast, callAdmin try/catch, confirm/alert→modal,
  validação client, início<fim); login "mostrar senha"; QsAuthContext.loadProfile distingue
  rede-caiu (retry, SEM derrubar nem mostrar aviso de desativado) de sem-perfil (derruba).
- **Onda B3 Analytics parte 2** (Bloco B da Sprint 3): telefonia real (log do webfone no
  banco: taxa de atendimento por horário, duração média por SDR); show-rate por fonte +
  antecedência; speed-to-lead por SDR/fonte; funil comparativo de SDRs lado a lado; R$ por
  fonte. Integrar na página de Desempenho/Análises de FUP (commit 421c26b) ou painel novo.
- **Onda C**: 2-3 agentes revisores adversariais no diff `88f7dd5..HEAD` (correção real,
  não estilo), consertar P0/P1, build final, commit+push, atualizar este doc como RELATÓRIO.
- **Final**: docs/SPRINT-2026-07-17.md (resumo pro Bruno + checklist: migrations 0017/0018+,
  itens antigos 0011-0014, envs), atualizar memória.

## Fora de escopo desta noite (próxima sprint)
Paginação server-side LeadsPage; refactor de performance do painel; Router/React Query;
outbox Bitrix; Google Agenda n8n (precisa Bruno); credenciais ChatApp (Bruno).
