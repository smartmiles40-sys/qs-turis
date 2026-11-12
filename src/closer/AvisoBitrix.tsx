// src/closer/AvisoBitrix.tsx
// -----------------------------------------------------------------------------
// O AVISO DE PENDÊNCIA DO BITRIX no cartão do closer (revisão 12/11/2026).
//
// Antes a tela só falava do Bitrix quando dava ERRO e prometia "o QS tenta de
// novo sozinho a cada hora" — mas o reenvio automático depende da env
// CLOSER_CRON_BITRIX_LIGADO na Vercel, que estava desligada: 129 cartões
// ficaram "pendentes" sem ninguém ver. Agora:
//   • pendente → "Ainda não foi pro Bitrix (pendente desde …)" + "Enviar agora";
//   • erro     → "Bitrix não atualizou: <motivo>" + "Enviar agora";
//   • o texto só promete nova tentativa automática se ela estiver ligada
//     (acao 'config' → reenvioAutomatico).
// -----------------------------------------------------------------------------
import { Botao, Etiqueta } from "@/rel/ui";
import { dataHoraBr, espelharNoBitrix, useConfigDaArea, type Negocio } from "./lib";

export default function AvisoBitrix({ n, ocupado, rodar }: {
  n: Negocio;
  ocupado: boolean;
  rodar: (f: () => Promise<void>, ok?: string) => Promise<void>;
}) {
  const cfg = useConfigDaArea();
  if (n.bitrix_status !== "pendente" && n.bitrix_status !== "erro") return null;
  const desde = n.bitrix_pendente_em ?? n.etapa_em ?? null;
  const automatico = cfg?.reenvioAutomatico === true;
  return (
    <div className="mt-2 text-[12px] space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        {n.bitrix_status === "erro"
          ? <Etiqueta tom="erro">Bitrix não atualizou</Etiqueta>
          : <Etiqueta tom="aviso">Ainda não foi pro Bitrix</Etiqueta>}
        <Botao variante="fantasma" disabled={ocupado} onClick={() => void rodar(async () => {
          const r = await espelharNoBitrix(n.id);
          if (!r.ok) throw new Error(r.mensagem || "O Bitrix não aceitou.");
        }, "Bitrix atualizado.")}>Enviar agora</Botao>
      </div>
      <p style={{ color: "var(--ink3)" }}>Pendente desde {dataHoraBr(desde)}.</p>
      {n.bitrix_status === "erro" && n.bitrix_erro && <p style={{ color: "var(--err-ink)" }}>Falhou: {n.bitrix_erro}</p>}
      <p style={{ color: "var(--ink3)" }}>
        {automatico
          ? (n.bitrix_status === "erro" ? "O QS tenta de novo sozinho a cada hora." : "O QS envia sozinho em até 10 minutos.")
          : "O envio automático está desligado: clique em \"Enviar agora\" para mandar."}
      </p>
    </div>
  );
}
