-- 0410 — Fluxos "igual ManyChat" (23/11/2026): RASCUNHO × PUBLICADO.
-- Fluxo já publicado guarda a edição em grafo_rascunho; os motores (Rel e MKT)
-- continuam lendo só `grafo` até o editor "Publicar" (grafo := rascunho, rascunho := null).
alter table public.rel_fluxos add column if not exists grafo_rascunho jsonb;
alter table public.mkt_fluxos add column if not exists grafo_rascunho jsonb;
