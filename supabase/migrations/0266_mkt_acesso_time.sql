-- 0266 — Marketing: ACESSO COMPLETO DO TIME (04/11/2026)
-- -----------------------------------------------------------------------------
-- Bruno (04/11): a área de Marketing com "todas as funções" pro time — quem é
-- do Marketing cria, edita, APROVA, dispara e configura em todas as telas.
--
-- O QUE BLOQUEAVA (conferido no banco vivo em 04/11, só SELECT):
--   • O gatilho "somente leitura" do papel marketing (qs_bloqueia_espectador,
--     0036/0126) NÃO está em nenhuma tabela mkt_* — só nas qs_* do Comercial.
--     As policies mkt_* usam mkt_tem_acesso() (admin, papel marketing ou setor
--     marketing) e deixam criar/editar. Isso estava certo.
--   • O que travava era mkt_eh_aprovador() (0240): pro papel marketing só
--     valia com o papel 'gestor' gravado em mkt_equipe — e mkt_equipe está
--     VAZIA. Rafaellen e Carol: mkt_eh_aprovador = false. Por causa disso elas
--     não conseguiam:
--       - aprovar / devolver card (mkt_aprovar, mkt_devolver, gatilho
--         mkt_cards_antes: "Só o gestor de Marketing aprova");
--       - mexer nas colunas do Quadro (policy mkt_colunas_gerir);
--       - apagar card, anexo ou comentário de outra pessoa (mkt_pode_gerir);
--       - definir os papéis do time em Ajustes › Equipe (mkt_definir_papeis);
--       - e, com a 0265, as travas/verba/destino do Tráfego › Meta Ads
--         (mkt_trafego_pode_editar e mkt_pode_gerir usam a mesma função).
--   • Central de Solicitações: "Tipos e prazos" do Marketing só admin/gestor
--     (qs_sol_tipos_mudar = qs_gestor_do_setor). O papel marketing não ajusta
--     os tipos de pedido que o próprio setor recebe.
--
-- O QUE MUDA:
--   1) mkt_eh_aprovador(): quem tem acesso ao Marketing aprova (admin, papel
--      marketing, ou setor marketing — que já inclui o gestor com a área).
--      mkt_equipe continua existindo pros papéis Orgânico/Tráfego (menu e quem
--      recebe aviso), mas deixa de ser a chave da aprovação.
--      Efeito colateral CONSCIENTE: mkt_aprovadores() (quem leva o aviso
--      "card esperando aprovação") passa a ser o time (Rafaellen, Carol) em
--      vez de cair nos admins — os admins só recebem quando não há ninguém.
--   2) qs_solicitacao_tipos: quem é do Marketing edita os tipos com
--      setor = 'marketing' (só os dele; os dos outros setores seguem do gestor).
--
-- O QUE CONTINUA SÓ ADMIN DE PROPÓSITO (não mexido aqui; decisão do Bruno):
--   • Grupos: ligar o envio real (envio_ligado / MKT_GRUPOS_ENVIO), trocar a
--     instância do chip, desconectar (api/mkt-grupos.js).
--   • WhatsApp: definir o número oficial do Marketing (api/_mktDisparo.js).
--   • Tráfego: a pausa real das campanhas na Meta (env MKT_TRAFEGO_PAUSA_LIGADA).
--
-- Não depende da 0265 (pode ser aplicada antes ou depois). Só arquivo:
-- aplicar com o ok do Bruno.
-- -----------------------------------------------------------------------------

-- 1) Quem aprova = quem tem acesso ao Marketing. Mesma assinatura (as policies,
--    gatilhos e RPCs da 0240–0245 e da 0265 continuam chamando ela).
create or replace function public.mkt_eh_aprovador(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from qs_users u
     where u.id = p_user and u.is_active
       and (u.role in ('admin', 'marketing') or 'marketing' = any(coalesce(u.setores, '{}')))
  );
$$;

-- 2) Tipos de pedido do Marketing: o próprio Marketing ajusta.
drop policy if exists qs_sol_tipos_mkt on qs_solicitacao_tipos;
create policy qs_sol_tipos_mkt on qs_solicitacao_tipos for all to authenticated
  using (setor = 'marketing' and (select mkt_tem_acesso()))
  with check (setor = 'marketing' and (select mkt_tem_acesso()));

-- -----------------------------------------------------------------------------
-- ROLLBACK (manual, se precisar):
--   drop policy if exists qs_sol_tipos_mkt on qs_solicitacao_tipos;
--   create or replace function public.mkt_eh_aprovador(p_user uuid) returns boolean
--   language sql stable security definer set search_path = public as $$
--     select exists (select 1 from qs_users u where u.id = p_user and u.is_active and (
--       u.role = 'admin'
--       or (u.role = 'gestor' and 'marketing' = any(coalesce(u.setores, '{}')))
--       or ((u.role = 'marketing' or 'marketing' = any(coalesce(u.setores, '{}')))
--           and exists (select 1 from mkt_equipe e where e.user_id = u.id and 'gestor' = any(e.papeis)))));
--   $$;
-- -----------------------------------------------------------------------------
