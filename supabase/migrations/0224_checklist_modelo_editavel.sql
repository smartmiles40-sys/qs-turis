-- 0224_checklist_modelo_editavel.sql
-- NÃO APLICADA. Escrita em 30/10/2026 (V2). Aplicar só com o ok do Bruno.
--
-- CHECKLIST PADRÃO EDITÁVEL (pedido do Bruno, 30/10):
--   1) dizer PARA QUEM é cada tarefa: o setor e o responsável padrão (uma pessoa fixa
--      ou "o responsável operacional/comercial da expedição");
--   2) Operações cria, edita, reordena e desativa as tarefas do padrão SEM código, e
--      toda expedição nova já nasce com elas;
--   3) as expedições em andamento recebem as tarefas novas por um botão ("aplicar às
--      expedições em andamento"), que mostra uma prévia antes de gravar.
--
-- Respeita o "checklist único" (5808ed2): as tarefas da expedição continuam em
-- checklist_itens (processo de topo + subtarefas por parent_id, fase = etapa, ordem
-- dentro da fase). Aqui só ENTRA:
--   • exp_checklist_modelo: o padrão, na mesma forma (topo + subtarefas por parent_id);
--   • 5 colunas opcionais em checklist_itens: modelo_id (de qual tarefa do padrão veio),
--     setor, criado_por, concluido_por e concluido_em (quem marcou feita e quando);
--   • exp_checklist_modelo_aplicar(...): UMA função pra gerar o checklist de uma
--     expedição nova, completar as em andamento e montar a prévia (p_simular).
-- Nada que já existe é reescrito: exp_criar_expedicao e exp_gerar_checklist ficam iguais.
--
-- Semente: o padrão de hoje (lib/processos/template.ts). As 23 tarefas de Operações
-- entram ATIVAS, com as subtarefas e o mesmo prazo que o código calcula (D-N do
-- embarque: a referência da fase, menos 2 dias a cada tarefa seguinte da mesma fase).
-- As 11 sugestões de Comercial, Financeiro e Relacionamento entram INATIVAS, pro
-- Bruno ligar.
--
-- Quem edita o padrão: ops_tem_acesso() (admin ou setor operacional no QS).
-- Quem lê: exp_tem_acesso() (as mesmas pessoas que leem as expedições).
-- Auditoria: criado_por, criado_em, atualizado_por e atualizado_em, mais o gatilho
-- audit_change() (audit_log, o mesmo das expedições).
--
-- Idempotente: if not exists, create or replace, on conflict (chave) do nothing.
-- O front funciona SEM ela: cai no padrão do código, como hoje.

-- ── 1) o modelo ─────────────────────────────────────────────────────────────
create table if not exists public.exp_checklist_modelo (
  id uuid primary key default gen_random_uuid(),
  -- chave estável da semente (ops-01, ops-02-s01, sug-03…). Tarefa criada na tela fica sem chave.
  chave text unique,
  parent_id uuid references public.exp_checklist_modelo(id) on delete cascade,
  titulo text not null check (length(btrim(titulo)) >= 2),
  descricao text,
  etapa public.etapa_checklist not null,
  setor text not null default 'operacional'
    check (setor in ('operacional', 'comercial', 'financeiro', 'relacionamento')),
  -- responsável padrão: uma pessoa fixa OU um papel na expedição (nenhum dos dois = só o setor)
  responsavel_usuario_id uuid references public.usuarios(id) on delete set null,
  responsavel_papel text check (responsavel_papel in ('resp_operacional', 'resp_comercial')),
  -- prazo relativo: prazo = data de referência − prazo_dias (30 = D-30; −7 = D+7).
  -- Na subtarefa, nulo = o mesmo prazo do processo.
  prazo_dias integer,
  prazo_referencia text not null default 'embarque' check (prazo_referencia in ('embarque', 'retorno')),
  prioridade public.prioridade not null default 'Média',
  ordem integer not null default 0,
  ativo boolean not null default true,
  tipo_produto text not null default 'expedicao' check (tipo_produto in ('expedicao', 'pacote', 'ambos')),
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_por uuid default auth.uid(),
  atualizado_em timestamptz not null default now(),
  constraint exp_ck_modelo_um_responsavel check (responsavel_usuario_id is null or responsavel_papel is null)
);
create index if not exists exp_checklist_modelo_parent_idx on public.exp_checklist_modelo(parent_id);
create index if not exists exp_checklist_modelo_etapa_idx on public.exp_checklist_modelo(etapa, ordem);

create or replace function public._exp_ck_modelo_carimbo()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.criado_por := coalesce(new.criado_por, auth.uid());
    new.criado_em := coalesce(new.criado_em, now());
  else
    new.criado_por := old.criado_por;   -- quem criou não muda
    new.criado_em := old.criado_em;
  end if;
  new.atualizado_por := auth.uid();
  new.atualizado_em := now();
  -- a subtarefa herda a fase, o setor e o tipo do processo
  if new.parent_id is not null then
    select p.etapa, p.setor, p.tipo_produto into new.etapa, new.setor, new.tipo_produto
      from exp_checklist_modelo p where p.id = new.parent_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_exp_ck_modelo_carimbo on public.exp_checklist_modelo;
create trigger trg_exp_ck_modelo_carimbo before insert or update on public.exp_checklist_modelo
  for each row execute function public._exp_ck_modelo_carimbo();

-- mudou fase/setor/tipo do processo → as subtarefas acompanham
create or replace function public._exp_ck_modelo_filhas()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.parent_id is null and (new.etapa, new.setor, new.tipo_produto) is distinct from (old.etapa, old.setor, old.tipo_produto) then
    update exp_checklist_modelo set etapa = new.etapa where parent_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists trg_exp_ck_modelo_filhas on public.exp_checklist_modelo;
create trigger trg_exp_ck_modelo_filhas after update on public.exp_checklist_modelo
  for each row execute function public._exp_ck_modelo_filhas();

drop trigger if exists trg_exp_ck_modelo_audit on public.exp_checklist_modelo;
create trigger trg_exp_ck_modelo_audit after insert or update or delete on public.exp_checklist_modelo
  for each row execute function public.audit_change();

alter table public.exp_checklist_modelo enable row level security;
drop policy if exists exp_ck_modelo_ler on public.exp_checklist_modelo;
create policy exp_ck_modelo_ler on public.exp_checklist_modelo for select to authenticated
  using ((select exp_tem_acesso()));
drop policy if exists exp_ck_modelo_ops on public.exp_checklist_modelo;
create policy exp_ck_modelo_ops on public.exp_checklist_modelo for all to authenticated
  using ((select ops_tem_acesso())) with check ((select ops_tem_acesso()));
revoke all on public.exp_checklist_modelo from anon;
grant select, insert, update, delete on public.exp_checklist_modelo to authenticated;

-- ── 2) checklist_itens: de onde veio, setor, quem criou, quem/quando concluiu ──
alter table public.checklist_itens
  add column if not exists modelo_id uuid references public.exp_checklist_modelo(id) on delete set null,
  add column if not exists setor text check (setor in ('operacional', 'comercial', 'financeiro', 'relacionamento')),
  add column if not exists criado_por uuid default auth.uid(),
  add column if not exists concluido_por uuid,
  add column if not exists concluido_em timestamptz;
create index if not exists checklist_itens_modelo_idx on public.checklist_itens(modelo_id);

create or replace function public._exp_ck_item_conclusao()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'Concluído' and (tg_op = 'INSERT' or old.status is distinct from 'Concluído') then
    new.concluido_por := auth.uid();
    new.concluido_em := now();
  elsif new.status <> 'Concluído' then
    new.concluido_por := null;
    new.concluido_em := null;
  elsif tg_op = 'UPDATE' then
    new.concluido_por := old.concluido_por;
    new.concluido_em := old.concluido_em;
  end if;
  return new;
end $$;

drop trigger if exists trg_exp_ck_item_conclusao on public.checklist_itens;
create trigger trg_exp_ck_item_conclusao before insert or update of status on public.checklist_itens
  for each row execute function public._exp_ck_item_conclusao();

-- ── 3) semente: o padrão de hoje ────────────────────────────────────────────
-- (chave, chave do pai, título, fase, setor, papel, prazo_dias, referência, prioridade, ordem, ativo)
create temp table if not exists _seed_0224 (
  chave text, pai text, titulo text, etapa text, setor text, papel text, dias int, ref text, prioridade text, ordem int, ativo boolean
);
truncate _seed_0224;
insert into _seed_0224 values
  ('ops-01', null, 'Atualizar Planilha de Controle da Expedição', 'Após o fechamento', 'operacional', 'resp_operacional', 300, 'embarque', 'Média', 1, true),
  ('ops-02', null, 'Criar alerta do voo principal e fazer emissão', '12 a 6 meses', 'operacional', 'resp_operacional', 240, 'embarque', 'Crítica', 1, true),
  ('ops-02-s01', 'ops-02', 'Criar alerta de preço do voo principal', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 1, true),
  ('ops-02-s02', 'ops-02', 'Acompanhar variação de tarifa', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 2, true),
  ('ops-02-s03', 'ops-02', 'Definir melhor data de emissão', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 3, true),
  ('ops-02-s04', 'ops-02', 'Emitir bilhetes do voo principal', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 4, true),
  ('ops-02-s05', 'ops-02', 'Conferir localizadores', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 5, true),
  ('ops-03', null, 'Monitorar e reservar hotéis', '12 a 6 meses', 'operacional', 'resp_operacional', 238, 'embarque', 'Alta', 2, true),
  ('ops-03-s01', 'ops-03', 'Levantar opções de hotel por cidade', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 1, true),
  ('ops-03-s02', 'ops-03', 'Comparar tarifas e política de cancelamento', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 2, true),
  ('ops-03-s03', 'ops-03', 'Fazer pré-reserva', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 3, true),
  ('ops-03-s04', 'ops-03', 'Confirmar reserva', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 4, true),
  ('ops-03-s05', 'ops-03', 'Salvar confirmação', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 5, true),
  ('ops-04', null, 'Falar com fornecedores para reservar passeios', '12 a 6 meses', 'operacional', 'resp_operacional', 236, 'embarque', 'Alta', 3, true),
  ('ops-04-s01', 'ops-04', 'Listar passeios do roteiro', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 1, true),
  ('ops-04-s02', 'ops-04', 'Cotar com fornecedores/DMC', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 2, true),
  ('ops-04-s03', 'ops-04', 'Reservar passeios', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 3, true),
  ('ops-04-s04', 'ops-04', 'Confirmar disponibilidade', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 4, true),
  ('ops-05', null, 'Comprar voos internos', '12 a 6 meses', 'operacional', 'resp_operacional', 234, 'embarque', 'Alta', 4, true),
  ('ops-05-s01', 'ops-05', 'Mapear trechos internos do roteiro', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 1, true),
  ('ops-05-s02', 'ops-05', 'Emitir voos internos', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 2, true),
  ('ops-06', null, 'Alimentar Planilha Controle de Expedições', '12 a 6 meses', 'operacional', 'resp_operacional', 232, 'embarque', 'Média', 5, true),
  ('ops-06-s01', 'ops-06', 'Lançar custos reservados', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 1, true),
  ('ops-06-s02', 'ops-06', 'Atualizar status de cada item', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 2, true),
  ('ops-07', null, 'Checar hospedagens mais baratas', '12 a 6 meses', 'operacional', 'resp_operacional', 230, 'embarque', 'Média', 6, true),
  ('ops-07-s01', 'ops-07', 'Revisar tarifas atuais', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 1, true),
  ('ops-07-s02', 'ops-07', 'Comparar alternativas', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 2, true),
  ('ops-07-s03', 'ops-07', 'Trocar se houver economia', '12 a 6 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 3, true),
  ('ops-08', null, 'Conferir se todos os voos estão confirmados', '6 a 2 meses', 'operacional', 'resp_operacional', 120, 'embarque', 'Crítica', 1, true),
  ('ops-08-s01', 'ops-08', 'Conferir voo principal', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 1, true),
  ('ops-08-s02', 'ops-08', 'Conferir voos internos', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 2, true),
  ('ops-08-s03', 'ops-08', 'Validar localizadores', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 3, true),
  ('ops-08-s04', 'ops-08', 'Conferir bagagem incluída', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 4, true),
  ('ops-08-s05', 'ops-08', 'Conferir assentos', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 5, true),
  ('ops-09', null, 'Salvar nova confirmação de hospedagem', '6 a 2 meses', 'operacional', 'resp_operacional', 118, 'embarque', 'Alta', 2, true),
  ('ops-09-s01', 'ops-09', 'Solicitar reconfirmação aos hotéis', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 1, true),
  ('ops-09-s02', 'ops-09', 'Salvar vouchers atualizados', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 2, true),
  ('ops-10', null, 'Confirmar passeios e horários dos transfers', '6 a 2 meses', 'operacional', 'resp_operacional', 116, 'embarque', 'Alta', 3, true),
  ('ops-10-s01', 'ops-10', 'Confirmar horários de transfer com DMC', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 1, true),
  ('ops-11', null, 'Travel Design', '6 a 2 meses', 'operacional', 'resp_operacional', 114, 'embarque', 'Média', 4, true),
  ('ops-11-s01', 'ops-11', 'Montar roteiro visual day-by-day', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 1, true),
  ('ops-11-s02', 'ops-11', 'Revisar com o time', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 2, true),
  ('ops-12', null, 'Confirmar com clientes documentação', '6 a 2 meses', 'operacional', 'resp_operacional', 112, 'embarque', 'Alta', 5, true),
  ('ops-12-s01', 'ops-12', 'Conferir validade de passaportes', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 1, true),
  ('ops-12-s02', 'ops-12', 'Conferir necessidade de visto', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 2, true),
  ('ops-13', null, 'Caixa Brinde e Logomarca', '6 a 2 meses', 'operacional', 'resp_operacional', 110, 'embarque', 'Baixa', 6, true),
  ('ops-13-s01', 'ops-13', 'Definir itens da caixa de brinde', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Baixa', 1, true),
  ('ops-13-s02', 'ops-13', 'Aprovar arte da logomarca', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Baixa', 2, true),
  ('ops-13-s03', 'ops-13', 'Solicitar produção', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Baixa', 3, true),
  ('ops-13-s04', 'ops-13', 'Conferir recebimento', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Baixa', 4, true),
  ('ops-13-s05', 'ops-13', 'Separar por passageiro', '6 a 2 meses', 'operacional', 'resp_operacional', null, 'embarque', 'Baixa', 5, true),
  ('ops-14', null, 'Conferir se todos os voos estão confirmados', '2 meses a 15 dias', 'operacional', 'resp_operacional', 35, 'embarque', 'Crítica', 1, true),
  ('ops-14-s01', 'ops-14', 'Reconferir voo principal', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 1, true),
  ('ops-14-s02', 'ops-14', 'Reconferir voos internos', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 2, true),
  ('ops-14-s03', 'ops-14', 'Validar localizadores', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 3, true),
  ('ops-14-s04', 'ops-14', 'Conferir alterações de malha', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 4, true),
  ('ops-14-s05', 'ops-14', 'Conferir assentos', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Crítica', 5, true),
  ('ops-15', null, 'Verificar última possibilidade de troca de hospedagens', '2 meses a 15 dias', 'operacional', 'resp_operacional', 33, 'embarque', 'Média', 2, true),
  ('ops-15-s01', 'ops-15', 'Revisar tarifas finais', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 1, true),
  ('ops-15-s02', 'ops-15', 'Trocar se houver ganho real', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 2, true),
  ('ops-15-s03', 'ops-15', 'Atualizar vouchers', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 3, true),
  ('ops-16', null, 'Confirmar passeios e horários dos Transfers', '2 meses a 15 dias', 'operacional', 'resp_operacional', 31, 'embarque', 'Alta', 3, true),
  ('ops-16-s01', 'ops-16', 'Reconfirmar horários com DMC', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 1, true),
  ('ops-17', null, 'Receber Travel Design', '2 meses a 15 dias', 'operacional', 'resp_operacional', 29, 'embarque', 'Média', 4, true),
  ('ops-17-s01', 'ops-17', 'Receber arte final do Travel Design', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 1, true),
  ('ops-17-s02', 'ops-17', 'Revisar conteúdo', '2 meses a 15 dias', 'operacional', 'resp_operacional', null, 'embarque', 'Média', 2, true),
  ('ops-18', null, 'Colocar todas as informações no app', '2 meses a 15 dias', 'operacional', 'resp_operacional', 27, 'embarque', 'Alta', 5, true),
  ('ops-19', null, 'Checar restrições alimentares para voo e preferência de assentos pagos', '2 meses a 15 dias', 'operacional', 'resp_operacional', 25, 'embarque', 'Média', 6, true),
  ('ops-20', null, 'Imprimir todas as reservas de passagens pra Luis', 'Na semana', 'operacional', 'resp_operacional', 5, 'embarque', 'Alta', 1, true),
  ('ops-20-s01', 'ops-20', 'Imprimir bilhetes aéreos', 'Na semana', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 1, true),
  ('ops-21', null, 'Imprimir todas as hospedagens por pessoa', 'Na semana', 'operacional', 'resp_operacional', 3, 'embarque', 'Alta', 2, true),
  ('ops-21-s01', 'ops-21', 'Imprimir vouchers de hospedagem por passageiro', 'Na semana', 'operacional', 'resp_operacional', null, 'embarque', 'Alta', 1, true),
  ('ops-22', null, 'Imprimir os vouchers dos passeios para líderes', 'Na semana', 'operacional', 'resp_operacional', 1, 'embarque', 'Alta', 3, true),
  ('ops-23', null, 'Reunião de apresentação da Expedição', 'Na semana', 'operacional', 'resp_operacional', -1, 'embarque', 'Crítica', 4, true),
  ('sug-01', null, 'Passar a venda para Operações com a ficha completa', 'Após o fechamento', 'comercial', 'resp_comercial', 300, 'embarque', 'Alta', 101, false),
  ('sug-02', null, 'Acompanhar vagas e fechar o grupo', '12 a 6 meses', 'comercial', 'resp_comercial', 240, 'embarque', 'Alta', 101, false),
  ('sug-03', null, 'Encerrar vendas e avisar Operações das últimas vagas', '6 a 2 meses', 'comercial', 'resp_comercial', 120, 'embarque', 'Média', 101, false),
  ('sug-04', null, 'Lançar contrato e plano de pagamento de cada passageiro', 'Após o fechamento', 'financeiro', null, 300, 'embarque', 'Alta', 102, false),
  ('sug-05', null, 'Cobrar parcelas em atraso', '6 a 2 meses', 'financeiro', null, 120, 'embarque', 'Alta', 102, false),
  ('sug-06', null, 'Confirmar quitação de todos os passageiros', '2 meses a 15 dias', 'financeiro', null, 35, 'embarque', 'Crítica', 101, false),
  ('sug-07', null, 'Fechar o custo real da expedição', 'Pós-viagem', 'financeiro', null, -7, 'retorno', 'Média', 101, false),
  ('sug-08', null, 'Boas-vindas e entrada no grupo do WhatsApp', 'Após o fechamento', 'relacionamento', null, 300, 'embarque', 'Alta', 103, false),
  ('sug-09', null, 'Cobrar passaporte, documentos e preferências dos passageiros', '6 a 2 meses', 'relacionamento', null, 120, 'embarque', 'Alta', 103, false),
  ('sug-10', null, 'Mensagem de véspera com horários e checklist de mala', 'Na semana', 'relacionamento', null, 1, 'embarque', 'Alta', 101, false),
  ('sug-11', null, 'Pesquisa de satisfação e convite para a próxima expedição', 'Pós-viagem', 'relacionamento', null, -7, 'retorno', 'Média', 102, false);

insert into public.exp_checklist_modelo (chave, titulo, etapa, setor, responsavel_papel, prazo_dias, prazo_referencia, prioridade, ordem, ativo, tipo_produto)
select s.chave, s.titulo, s.etapa::etapa_checklist, s.setor, s.papel, s.dias, s.ref, s.prioridade::prioridade, s.ordem, s.ativo, 'expedicao'
  from _seed_0224 s where s.pai is null
on conflict (chave) do nothing;

insert into public.exp_checklist_modelo (chave, parent_id, titulo, etapa, setor, responsavel_papel, prazo_dias, prazo_referencia, prioridade, ordem, ativo, tipo_produto)
select s.chave, p.id, s.titulo, s.etapa::etapa_checklist, s.setor, s.papel, s.dias, s.ref, s.prioridade::prioridade, s.ordem, s.ativo, 'expedicao'
  from _seed_0224 s join public.exp_checklist_modelo p on p.chave = s.pai
 where s.pai is not null
on conflict (chave) do nothing;

drop table if exists _seed_0224;

-- ── 4) liga as tarefas que JÁ existem nas expedições ao padrão (fase + título) ──
-- Assim o "aplicar às em andamento" não duplica o que o código já gerou.
update public.checklist_itens c
   set modelo_id = m.id, setor = coalesce(c.setor, m.setor)
  from public.exp_checklist_modelo m
 where c.modelo_id is null and c.parent_id is null and m.parent_id is null
   and c.etapa = m.etapa and lower(btrim(c.tarefa)) = lower(btrim(m.titulo));

-- tarefa que alguém trocou de fase (hoje: 3 "Atualizar Planilha…" em 12 a 6 meses e
-- 3 "Reunião de apresentação…" em Pós-viagem): liga pelo título, se ele é único no padrão
-- e a expedição ainda não tem outra tarefa ligada a ele.
update public.checklist_itens c
   set modelo_id = m.id, setor = coalesce(c.setor, m.setor)
  from public.exp_checklist_modelo m
 where c.modelo_id is null and c.parent_id is null and m.parent_id is null
   and lower(btrim(c.tarefa)) = lower(btrim(m.titulo))
   and not exists (select 1 from public.exp_checklist_modelo o where o.parent_id is null and o.id <> m.id
                    and lower(btrim(o.titulo)) = lower(btrim(m.titulo)))
   and not exists (select 1 from public.checklist_itens j where j.expedicao_id = c.expedicao_id and j.modelo_id = m.id);

update public.checklist_itens c
   set modelo_id = m.id, setor = coalesce(c.setor, m.setor)
  from public.checklist_itens pai, public.exp_checklist_modelo m
 where c.modelo_id is null and c.parent_id = pai.id and pai.modelo_id is not null
   and m.parent_id = pai.modelo_id and lower(btrim(c.tarefa)) = lower(btrim(m.titulo));

-- ── 5) aplicar o padrão (gerar / completar / prévia) ────────────────────────
-- p_expedicoes: quais expedições (nulo = todas em andamento: não canceladas e que ainda não voltaram).
-- p_modelo_ids: só estes PROCESSOS do padrão, com as subtarefas ativas deles (nulo = todos os ativos).
-- p_simular: true = só devolve o que entraria (a prévia), sem gravar.
-- Entra só o que falta: o processo do padrão que a expedição não tem (nem pelo
-- modelo_id, nem pela mesma fase + título) e a subtarefa nova de um processo que ela
-- já tem. Nada é apagado nem alterado. security invoker: valem as policies de checklist_itens.
create or replace function public.exp_checklist_modelo_aplicar(
  p_expedicoes uuid[] default null,
  p_modelo_ids uuid[] default null,
  p_simular boolean default false
)
returns table (o_expedicao uuid, o_codigo text, o_nome text, o_modelo uuid, o_tarefa text, o_etapa text, o_sub boolean, o_prazo date, o_responsavel uuid)
language plpgsql set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  e record; m record; s record;
  v_pai uuid; v_novo boolean; v_prazo date; v_prazo_sub date; v_resp uuid; v_ordem int; v_ref date;
begin
  for e in
    select x.* from expedicoes x
     where (p_expedicoes is null
            and x.status::text <> 'Cancelada'
            and coalesce(x.data_retorno, x.data_embarque, v_hoje) >= v_hoje)
        or x.id = any(p_expedicoes)
     order by x.data_embarque nulls last, x.codigo
  loop
    for m in
      select * from exp_checklist_modelo mm
       where mm.parent_id is null
         and (case when p_modelo_ids is null then mm.ativo else mm.id = any(p_modelo_ids) end)
         and (mm.tipo_produto = 'ambos' or mm.tipo_produto = coalesce(e.tipo, 'expedicao'))
       order by mm.etapa, mm.ordem, mm.criado_em
    loop
      v_ref := case m.prazo_referencia when 'retorno' then e.data_retorno else e.data_embarque end;
      v_prazo := case when v_ref is null or m.prazo_dias is null then null else v_ref - m.prazo_dias end;
      v_resp := case
        when m.responsavel_usuario_id is not null then m.responsavel_usuario_id
        when m.responsavel_papel = 'resp_operacional' then coalesce(e.responsavel_operacional_id,
               (select u.id from usuarios u where u.papel = 'operacional' order by u.nome limit 1))
        when m.responsavel_papel = 'resp_comercial' then e.responsavel_comercial_id
        else null end;

      select c.id into v_pai from checklist_itens c
       where c.expedicao_id = e.id and c.parent_id is null
         and (c.modelo_id = m.id
              or (c.etapa = m.etapa and lower(btrim(c.tarefa)) = lower(btrim(m.titulo)))
              -- ou só pelo título, se ele é único no padrão (tarefa que alguém trocou de fase)
              or (c.modelo_id is null and lower(btrim(c.tarefa)) = lower(btrim(m.titulo))
             and not exists (select 1 from exp_checklist_modelo o where o.parent_id is null and o.id <> m.id
                              and lower(btrim(o.titulo)) = lower(btrim(m.titulo)))))
       order by (c.modelo_id = m.id) desc nulls last, (c.etapa = m.etapa) desc
       limit 1;
      v_novo := v_pai is null;

      if v_novo then
        if not p_simular then
          select coalesce(max(c.ordem), 0) + 1 into v_ordem from checklist_itens c
           where c.expedicao_id = e.id and c.parent_id is null and c.etapa = m.etapa;
          insert into checklist_itens (expedicao_id, etapa, tarefa, responsavel_id, status, prazo, prioridade, parent_id, ordem, observacoes, modelo_id, setor)
          values (e.id, m.etapa, m.titulo, v_resp, 'Pendente', v_prazo, m.prioridade, null, v_ordem, m.descricao, m.id, m.setor)
          returning id into v_pai;
        end if;
        o_expedicao := e.id; o_codigo := e.codigo; o_nome := e.nome; o_modelo := m.id; o_tarefa := m.titulo;
        o_etapa := m.etapa::text; o_sub := false; o_prazo := v_prazo; o_responsavel := v_resp;
        return next;
      end if;

      for s in
        select * from exp_checklist_modelo ss
         where ss.parent_id = m.id and ss.ativo
         order by ss.ordem, ss.criado_em
      loop
        if v_novo or not exists (
          select 1 from checklist_itens c
           where c.parent_id = v_pai and (c.modelo_id = s.id or lower(btrim(c.tarefa)) = lower(btrim(s.titulo)))
        ) then
          v_prazo_sub := case when v_ref is null or s.prazo_dias is null then v_prazo else v_ref - s.prazo_dias end;
          if not p_simular then
            select coalesce(max(c.ordem), 0) + 1 into v_ordem from checklist_itens c where c.parent_id = v_pai;
            insert into checklist_itens (expedicao_id, etapa, tarefa, responsavel_id, status, prazo, prioridade, parent_id, ordem, observacoes, modelo_id, setor)
            values (e.id, m.etapa, s.titulo, coalesce(s.responsavel_usuario_id, v_resp), 'Pendente', v_prazo_sub, s.prioridade,
                    v_pai, v_ordem, s.descricao, s.id, m.setor);
          end if;
          o_expedicao := e.id; o_codigo := e.codigo; o_nome := e.nome; o_modelo := s.id; o_tarefa := s.titulo;
          o_etapa := m.etapa::text; o_sub := true; o_prazo := v_prazo_sub; o_responsavel := coalesce(s.responsavel_usuario_id, v_resp);
          return next;
        end if;
      end loop;
    end loop;
  end loop;
end $$;
revoke all on function public.exp_checklist_modelo_aplicar(uuid[], uuid[], boolean) from public, anon;
grant execute on function public.exp_checklist_modelo_aplicar(uuid[], uuid[], boolean) to authenticated;

-- reordenar o padrão de uma vez (arrastar na tela)
create or replace function public.exp_checklist_modelo_reordenar(p_ids uuid[])
returns void language sql set search_path = public as $$
  update exp_checklist_modelo m set ordem = o.pos
    from unnest(p_ids) with ordinality as o(id, pos)
   where m.id = o.id;
$$;
revoke all on function public.exp_checklist_modelo_reordenar(uuid[]) from public, anon;
grant execute on function public.exp_checklist_modelo_reordenar(uuid[]) to authenticated;

-- realtime (o editor do padrão e a aba atualizam sozinhos)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'exp_checklist_modelo') then
    execute 'alter publication supabase_realtime add table public.exp_checklist_modelo';
  end if;
end $$;

-- Conferência depois de aplicar:
--   select setor, ativo, count(*) filter (where parent_id is null) processos, count(*) filter (where parent_id is not null) subtarefas
--     from exp_checklist_modelo group by 1, 2 order by 1, 2;     -- operacional/true = 23 processos + 51 subtarefas; 11 inativas
--   select count(*) total, count(modelo_id) ligadas from checklist_itens;
--   select * from exp_checklist_modelo_aplicar(null, null, true);  -- prévia: o que falta nas em andamento

-- ── ROLLBACK (rodar nesta ordem) ────────────────────────────────────────────
-- do $$ begin
--   if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'exp_checklist_modelo') then
--     execute 'alter publication supabase_realtime drop table public.exp_checklist_modelo'; end if; end $$;
-- drop function if exists public.exp_checklist_modelo_reordenar(uuid[]);
-- drop function if exists public.exp_checklist_modelo_aplicar(uuid[], uuid[], boolean);
-- drop trigger if exists trg_exp_ck_item_conclusao on public.checklist_itens;
-- drop function if exists public._exp_ck_item_conclusao();
-- drop index if exists public.checklist_itens_modelo_idx;
-- alter table public.checklist_itens
--   drop column if exists modelo_id, drop column if exists setor, drop column if exists criado_por,
--   drop column if exists concluido_por, drop column if exists concluido_em;
-- drop table if exists public.exp_checklist_modelo cascade;   -- leva os gatilhos, as policies e os índices
-- drop function if exists public._exp_ck_modelo_carimbo();
-- drop function if exists public._exp_ck_modelo_filhas();
-- (as tarefas que a função já gravou em checklist_itens ficam: são tarefas normais.)
