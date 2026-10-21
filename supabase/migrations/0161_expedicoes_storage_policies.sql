-- 0161 · Arquivos das Expedições abertos/enviados direto pelo QS (o app antigo passava pelo servidor).
-- Mesma regra das tabelas: vê quem tem exp_tem_acesso(); envia/apaga quem não é só leitura. APLICADA 21/10.
create policy exp_arquivos_ler on storage.objects for select to authenticated
  using (bucket_id in ('arquivos-expedicoes', 'pasta_public') and exp_tem_acesso());
create policy exp_arquivos_enviar on storage.objects for insert to authenticated
  with check (bucket_id in ('arquivos-expedicoes', 'pasta_public') and exp_tem_acesso() and not is_readonly());
create policy exp_arquivos_trocar on storage.objects for update to authenticated
  using (bucket_id in ('arquivos-expedicoes', 'pasta_public') and exp_tem_acesso() and not is_readonly());
create policy exp_arquivos_apagar on storage.objects for delete to authenticated
  using (bucket_id in ('arquivos-expedicoes', 'pasta_public') and exp_tem_acesso() and not is_readonly());
