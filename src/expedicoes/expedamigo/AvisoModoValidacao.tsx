// src/expedicoes/expedamigo/AvisoModoValidacao.tsx
// Faixa do MODO VALIDAÇÃO (EXP_ESPELHO_LIGADO=1): o espelho copia o banco antigo →
// QS e o portal ainda lê o antigo, então um link criado só no QS não abriria.
// Gerar/resetar ficam desligados; copiar um link que já existe continua valendo.
import { Aviso } from "@/rel/ui";
import { useModoValidacaoAmigo } from "./servidor";

export default function AvisoModoValidacao({ modoValidacao }: { modoValidacao?: boolean }) {
  const v = useModoValidacaoAmigo(modoValidacao);
  if (v !== true) return null;
  return (
    <Aviso>
      <b>Modo validação</b> — o banco do sistema antigo ainda é o oficial (o espelho copia de lá pra cá a cada 5 min).
      Um link gerado aqui não abriria no portal, então <b>gerar e resetar o acesso estão desligados</b>: use o sistema antigo até a virada.
      Copiar a mensagem com um link que já existe continua liberado.
    </Aviso>
  );
}
