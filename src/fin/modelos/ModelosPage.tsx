// src/fin/modelos/ModelosPage.tsx
// -----------------------------------------------------------------------------
// MODELOS DE MENSAGEM do Financeiro (Bruno, 19/10/2026: "coloca em algum lugar
// pro próprio funcionário subir as mensagens pra aprovar — só dentro da área
// do Financeiro").
//
// Qualquer pessoa do Financeiro escreve o modelo e manda pra aprovação da Meta
// aqui. Sai no número do Relacionamento (o Financeiro fala por ele), o nome
// sempre começa com fin_ — por isso só aparece no envio do Financeiro, nunca no
// do Relacionamento. Excluir: só a gestão do Financeiro ou o admin.
// O /api/wa-config (area=financeiro) confere tudo isso de novo.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { statusDoNumero, type NumeroRel } from "@/rel/lib/whatsapp";
import { podeGerirArea } from "@/rel/equipe/permissao";
import ModelosDoNumero from "@/rel/whatsapp/ModelosDoNumero";
import { Aviso } from "../ui";

export default function ModelosPage() {
  const { currentUser } = useQsAuth();
  const [numero, setNumero] = useState<NumeroRel | null | undefined>(undefined);
  useEffect(() => { statusDoNumero().then(setNumero).catch(() => setNumero(null)); }, []);

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Modelos de mensagem</h1>
        <p className="text-[13px] mt-0.5" style={{ color: "var(--ink3)" }}>
          Escreva a mensagem e mande pra aprovação da Meta. Depois de <b>Aprovado</b>, ela aparece em Conversas → modelo, pra todo o Financeiro usar.
        </p>
      </div>
      <div className="rel-card p-4 text-[13px] space-y-1.5" style={{ color: "var(--ink2)" }}>
        <p><b>Quando usar:</b> pra falar com o cliente <b>depois de 24h</b> sem resposta dele, ou pra começar uma conversa. É o único jeito que a Meta deixa.</p>
        <p><b>Campos que mudam</b> (nome, valor, data, link): escreva {"{{1}}"}, {"{{2}}"}… no texto e diga o que é cada um. Não termine a mensagem com um campo — a Meta recusa.</p>
        <p><b>Utilidade</b> = cobrança, pagamento, contrato da viagem que o cliente comprou. A Meta analisa em minutos ou algumas horas.</p>
      </div>
      {numero === undefined ? <div className="rel-card h-32 animate-pulse" /> :
        !numero?.conectado ? <Aviso>O número de WhatsApp do Relacionamento não está conectado — peça ao admin pra conectar antes de criar modelos.</Aviso> : (
          <ModelosDoNumero n={{ phoneId: "", numero: numero.numero || "" }} area="financeiro"
            podeEditar podeExcluir={podeGerirArea(currentUser, "financeiro")} />
        )}
    </div>
  );
}
