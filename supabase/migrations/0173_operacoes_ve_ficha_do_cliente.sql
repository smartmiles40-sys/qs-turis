-- 0173 — Operações VÊ a ficha do cliente (cadastro único, 0172). AGUARDA OK DO BRUNO.
-- Só leitura: o Operações edita dado pessoal pelo passageiro e o sincronismo da 0172 leva
-- pra ficha. WhatsApp NÃO entra aqui (continua só do Relacionamento/Financeiro).
-- rel_notas também NÃO: são particulares (0121 — só o dono lê).
-- Policies novas (permissivas) — as do Relacionamento continuam iguais.
do $$
declare t text;
begin
  foreach t in array array['rel_clientes', 'rel_documentos', 'rel_viagens', 'rel_viagem_trechos', 'rel_viagem_passageiros',
                           'rel_viagem_deals', 'rel_contatos', 'rel_expedicoes_vinculo'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_ops_ler', t);
      execute format('create policy %I on public.%I for select to authenticated using (ops_tem_acesso()%s)',
                     t || '_ops_ler', t, case when t = 'rel_documentos' then ' and copia_de is null' else '' end);
    end if;
  end loop;
end $$;

drop policy if exists rel_docs_ops_ler on storage.objects;
create policy rel_docs_ops_ler on storage.objects for select to authenticated
  using (bucket_id = 'rel-documentos' and ops_tem_acesso());
