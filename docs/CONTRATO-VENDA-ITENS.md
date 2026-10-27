# Contrato comum: venda → itens por tipo → viagem → app do cliente (27/10/2026)

O Bruno quer um caminho só para os dados da venda:

**Venda (Comercial) → itens por tipo → Viagem (Relacionamento) → App da viagem (cliente)**

O closer preenche uma vez. O mesmo item vira componente da viagem no Rel e aparece pro cliente no app.

## Catálogo de tipos (fonte única)
- `src/propostas/lib.ts` → `TipoItem` + `TIPOS`, com os campos de cada tipo.
- Esse é o catálogo de TODOS os itens: proposta, venda, componente da viagem e app.
- Tipos que faltam e serão acrescentados lá, pela frente Venda: `expedicao` e `concierge`.
- Mapa tipo → "Tipo de venda" do Bitrix (`UF_CRM_1743296167520`): `TIPOS_DE_VENDA`, em `src/components/sdr/agenda/DesfechoVenda.tsx`.
  - aereo=71 · pacote=67 · expedicao=69 · hospedagem=77 · seguro=73
  - passeio/transfer/trem/carro=75 · concierge=229 · cruzeiro=325 · resto=79
- Ninguém cria outro catálogo paralelo.

## Tabela `qs_venda_itens` (migration 0207 — dona: frente Venda)

| coluna | tipo | nota |
|---|---|---|
| id | uuid pk | |
| negocio_id | uuid → qs_closer_negocios(id) on delete cascade, NULL ok | a venda; NULL quando o Rel lança item avulso |
| viagem_id | uuid → rel_viagens(id) on delete set null | preenchido na consolidação ou pelo Rel |
| cliente_id | uuid → rel_clientes(id) on delete set null | quem comprou |
| tipo | text, check no catálogo acima | |
| nome | text not null | ex.: "Voo GRU → NRT" |
| data_inicio, data_fim | date | as duas datas do tipo (`TIPOS[tipo].datas`) |
| dados | jsonb not null default '{}' | os `campos` do tipo, chave = `CampoTipo.chave` |
| passageiros | jsonb not null default '[]' | `[{ cliente_id?, nome }]` |
| valor | numeric(12,2) | preço de venda |
| custo | numeric(12,2) | custo, opcional |
| fornecedor | text | |
| status | text default 'vendido' | check: vendido · emitido · cancelado |
| ordem | int default 0 | |
| criado_por | uuid → qs_users default auth.uid() | |
| criado_em, atualizado_em | timestamptz | |

O Rel e o app do cliente só LEEM essa tabela e escrevem `status`, `dados` e `viagem_id` (emissão, localizador, voucher). Quem pode o quê fica nas RLS da 0207.

## Números de migration reservados (pra não colidir)
- 0207 — Venda (qs_venda_itens, pré-venda no qs_closer_negocios)
- 0208 — Relacionamento (componentes da viagem, faxina)
- 0209 — Discador (log de tentativas, config)
- 0210 — App do cliente (acesso do cliente às viagens dele)

## Regras para todos
- NADA aplicado no banco de produção e nada de push ou deploy. As migrations ficam só escritas.
- Leitura do banco (SELECT) pode.
- Não chamar Bitrix, WhatsApp, VoxFree ou n8n pra gravar.
- `npx tsc -b` limpo antes de entregar.
