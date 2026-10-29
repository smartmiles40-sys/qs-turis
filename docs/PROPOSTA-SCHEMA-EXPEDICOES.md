# Proposta de schema — Expedições (redesign 29/10)

**Nada aqui foi aplicado.** São os itens [SCHEMA] que apareceram na Central (spec §2.2) e valem também para o Cockpit (spec §3.3). Aplicar só com o ok do Bruno, como migration nova em `supabase/migrations/` (próximo número livre).

## 1. Baixa das ações do Roteiro do Líder

**Por quê:** a regra "Ação do Roteiro do Líder de dia já passado sem baixa" (Atenção) e o botão `Dar baixa` do cockpit precisam saber se a ação foi resolvida. Hoje `roteiro_lider_dias` só tem `alerta_nivel`, `alerta_texto`, `alerta_acao`, `alerta_responsavel`. Sem isso, a regra está implementada mas **desligada** (`baixada: null` em `lib/alertas/dadosAlertas.ts`). Se fosse ligada assim, todo dia passado com alerta viraria aviso.

```sql
alter table public.roteiro_lider_dias
  add column if not exists resolvida_em  timestamptz,
  add column if not exists resolvida_por uuid references public.usuarios(id) on delete set null;

comment on column public.roteiro_lider_dias.resolvida_em  is 'Baixa da ação do dia (alerta_acao). Null = aberta.';
comment on column public.roteiro_lider_dias.resolvida_por is 'Quem deu a baixa.';
```

A RLS da tabela (0160, `exp_tem_acesso` / `is_readonly`) já cobre o update. Depois de aplicar:

- `dadosAlertas.ts`: ler `resolvida_em` e trocar `baixada: null` por `baixada: d.resolvida_em != null`;
- a aba Roteiro do Líder: hoje, salvar o dia sem nível de alerta apaga texto, ação e responsável. Decidir se a baixa limpa o alerta ou só marca `resolvida_em` (recomendado: só marcar, para guardar o histórico).

## 2. (Opcional) Número da apólice visível

Não é schema novo: `passageiro_requisitos.numero` já existe e a gaveta do Seguro não mostra. Para a Central, "apólice" = requisito `Seguro` (não dispensado) com `arquivo_id`. Fica registrado para o agente do Cockpit.

## Fora do escopo (dado que falta e não é desta etapa)

- Ritmo de vendas (spec §3.3, Vendendo): não há histórico de `status_reserva`.
- Fuso da cidade do dia, hotel como entidade: ver `MAPA-EXPEDICOES.md` › Lacunas.
