-- docs/ops-espelho-comparar.sql (06/11/2026)
-- Comparação antigo (bnbpsuenlokhljrkvlke) × QS (eabfjomrnucymduqnbci), tabela a tabela.
-- Rode ESTA MESMA consulta nos dois bancos (SQL Editor do Supabase) e compare as colunas
-- "linhas" e "assinatura" (md5 da lista de chaves). Tudo igual = espelho em dia.
-- Diferenças ESPERADAS:
--   · audit_log: o QS tem mais (histórico próprio do QS, ~1.619 linhas de 23–30/10); o espelho não apaga.
--   · expedamigo_acessos: o antigo pode ter alguns a mais (acessos dos últimos 5 min, antes da próxima rodada).
-- Qualquer outra diferença: olhe exp_espelho_estado (ultimo_erro) e os logs "[expedicoes] espelho:" na Vercel.

select 'acesso_links' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.acesso_links
union all select 'acesso_senhas' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(cpf::text, ',' order by cpf::text collate "C"),'')),8) as assinatura from public.acesso_senhas
union all select 'arquivos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.arquivos
union all select 'audit_log' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.audit_log
union all select 'cambios' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(moeda::text, ',' order by moeda::text collate "C"),'')),8) as assinatura from public.cambios
union all select 'checklist_itens' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.checklist_itens
union all select 'compras_bitrix' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.compras_bitrix
union all select 'custos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.custos
union all select 'documentos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.documentos
union all select 'expedamigo_acessos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.expedamigo_acessos
union all select 'expedicao_avisos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.expedicao_avisos
union all select 'expedicao_info' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.expedicao_info
union all select 'expedicao_passeios' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.expedicao_passeios
union all select 'expedicao_voos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.expedicao_voos
union all select 'expedicoes' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.expedicoes
union all select 'extensoes' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.extensoes
union all select 'fornecedores' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.fornecedores
union all select 'grupos_expedicao' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.grupos_expedicao
union all select 'inscricoes_decisoes' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.inscricoes_decisoes
union all select 'inscricoes_pendentes' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.inscricoes_pendentes
union all select 'links_expedicao' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.links_expedicao
union all select 'pagamentos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.pagamentos
union all select 'passageiro_extensao' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.passageiro_extensao
union all select 'passageiro_quarto' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.passageiro_quarto
union all select 'passageiro_requisitos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.passageiro_requisitos
union all select 'passageiros' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.passageiros
union all select 'passeio_opcional_compras' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.passeio_opcional_compras
union all select 'passeios_opcionais' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.passeios_opcionais
union all select 'quartos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.quartos
union all select 'requisitos_destino' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.requisitos_destino
union all select 'roteiro_dia_fotos' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.roteiro_dia_fotos
union all select 'roteiro_dias' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.roteiro_dias
union all select 'roteiro_lider_dias' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(id::text, ',' order by id::text collate "C"),'')),8) as assinatura from public.roteiro_lider_dias
union all select 'usuarios' as tabela, count(*) as linhas, left(md5(coalesce(string_agg(lower(email)::text, ',' order by lower(email)::text collate "C"),'')),8) as assinatura from public.usuarios
union all select '* fotos (passageiros.foto_arquivo_id)', count(foto_arquivo_id), null from public.passageiros
union all select '* passaportes (passageiros.passaporte_arquivo_id)', count(passaporte_arquivo_id), null from public.passageiros
union all select '* vouchers expedicoes', count(hospedagem_voucher_arquivo_id), null from public.expedicoes
union all select '* vouchers extensoes', count(hospedagem_voucher_arquivo_id), null from public.extensoes order by 1; 

-- No QS, estado do espelho por tabela (ultimo_erro tem que ficar vazio):
-- select tabela, linhas_total, ultima_leva_em, ultimo_erro, ultimo_erro_em from exp_espelho_estado order by tabela;
