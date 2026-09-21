# Oportunidade futura (21/09/2026)

O cliente quer, mas não agora. O closer registra **quando** retomar, **quem**
retoma e **o que o cliente disse** — e o QS cuida do resto.

## Onde fica o botão

- Agenda do dia → painel da reunião → **Oportunidade futura** (ao lado de Desistência)
- Modal da reunião → **Oportunidade futura**
- Ficha do lead → **Oportunidade futura** (closer, gestor, admin)

## O que acontece

| Quando | QS | Bitrix |
|---|---|---|
| Ao registrar | atividades abertas do lead encerradas; nota na ficha; faixa roxa no topo do lead | card → **Comercial 1 › Oportunidade futura** + comentário |
| No dia (SDR) | lead volta a ser do SDR; atividade de WhatsApp às 9h na fila dele, com o motivo | card → **Pré-Vendas › Follow-up 1**, responsável = SDR |
| No dia (closer) | atividade às 9h na fila do closer | card → **Comercial 1 › Em Negociação** |

"No dia" é feito pelo cron da Vercel (de hora em hora) e também quando alguém
abre a fila de atividades. Na ficha dá pra **Devolver agora** ou **Cancelar**.

O SDR automático é o que trouxe o lead (último que passou pro closer). Se não
achar, a tela pede pra escolher.

## Arquivos

- `supabase/migrations/0083_oportunidade_futura.sql` — tabela `qs_oportunidades_futuras`
- `api/oportunidade-futura.js` — registrar / devolver / cancelar / cron
- `src/components/sdr/leads/OportunidadeFuturaModal.tsx` — formulário + faixa
- IDs das colunas do Bitrix no topo de `api/oportunidade-futura.js` (`COLUNA`)
