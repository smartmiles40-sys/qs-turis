-- 0051_transcricao_audio.sql
-- ---------------------------------------------------------------------------
-- GUARDA O TEXTO DO ÁUDIO NA PRÓPRIA MENSAGEM.
--
-- Pedido do Bruno (18/08): poder LER o áudio que o cliente mandou, em vez de
-- ouvir — áudio é o anexo mais comum da operação (342 de 400 numa amostra) — e
-- também transcrever o que o SDR grava, pra mandar o texto junto.
--
-- Por que uma coluna e não uma tabela: transcrição é atributo da mensagem, não
-- entidade própria. Fica junto, some junto, e a RLS que já protege a mensagem
-- protege o texto sem nenhuma regra nova.
--
-- A transcrição roda NA MÁQUINA do SDR (Whisper em WebAssembly, sem API e sem
-- custo — decisão do Bruno em 18/08). Guardar o resultado evita reprocessar: um
-- transcreveu, todo mundo que abrir a conversa depois lê na hora.
--
-- ADITIVA e opcional: sem esta migration o botão continua funcionando, só que o
-- texto não fica salvo e cada clique refaz a transcrição.
-- ---------------------------------------------------------------------------

alter table qs_wa_messages add column if not exists transcricao text;

comment on column qs_wa_messages.transcricao is
  'Texto do áudio desta mensagem (transcrição sob demanda). NULL = ainda não transcrito.';

-- Conferência depois de colar:
--   select count(*) from qs_wa_messages where transcricao is not null;
