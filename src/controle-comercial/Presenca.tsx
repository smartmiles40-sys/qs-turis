// src/controle-comercial/Presenca.tsx
// -----------------------------------------------------------------------------
// O "HEARTBEAT" DA MESA DO SUPERVISOR (Bruno, 28/10/2026 — "vermos quem está
// online e o que estão fazendo").
//
// Montado UMA vez no SdrLayout e no CloserApp (<Presenca tela=… leadId=… />).
// Não desenha nada. Grava a própria linha em qs_presenca pela RPC
// qs_presenca_bater (0215):
//   • a cada 60 s, só com a aba VISÍVEL (aba escondida = uma batida avisando
//     "aba em segundo plano" e silêncio até voltar);
//   • na troca de tela/lead (com 3 s de folga, pra não bater a cada clique);
//   • quando a ligação começa ou termina (webfone ou ligação oficial).
//
// Custo: uma chamada pequena por minuto por pessoa — nada de Realtime (o loop
// de Realtime do Dashboard esgotou o egress em 19/10). Se a 0215 ainda não foi
// aplicada, a primeira resposta "função não existe" desliga a batida até
// recarregar a página: sem erro repetido no console.
// -----------------------------------------------------------------------------
import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { subscribeWebphone } from "@/lib/webphone";
import { assinarLigacaoAtual } from "@/lib/qs/waCall";

const INTERVALO_MS = 60_000;
const FOLGA_TROCA_MS = 3_000;

/** Nome legível de cada tela (o que a Mesa mostra em "Está em…"). */
const ROTULO_TELA: Record<string, string> = {
  painel: "Painel (fila do dia)", "minha-agenda": "Minha agenda", whatsapp: "WhatsApp", leads: "Lista de leads",
  "lead-detail": "Ficha de um lead", cadencias: "Cadências", "cadencia-criar": "Cadências", "cadencia-editar": "Cadências",
  dashboard: "Desempenho", analises: "Análises e metas", "monitor-leads": "Distribuição de leads", reunioes: "Reuniões",
  declaracao: "Declaração", historicos: "Históricos", cobertura: "Cobertura", "atendimento-ia": "Atendimento IA",
  solicitacoes: "Solicitações", propostas: "Propostas", configuracoes: "Configurações",
  "closer:pipeline": "Pipeline (closer)", "closer:inicio": "Pipeline (closer)", "closer:reunioes": "Reuniões (closer)",
  "closer:agenda": "Agenda (closer)", "closer:painel": "Atividades (closer)", "closer:whatsapp": "WhatsApp (closer)",
  "closer:leads": "Leads (closer)", "closer:lead": "Ficha de um lead (closer)", "closer:desempenho": "Desempenho (closer)",
  "closer:solicitacoes": "Solicitações (closer)", "closer:propostas": "Propostas (closer)", "closer:proposta-nova": "Montando proposta",
  "closer:contrato": "Modelo de contrato", "closer:negocio": "Cartão de um cliente",
};
export const rotuloDaTela = (t: string | null | undefined) => (t ? ROTULO_TELA[t] ?? t : "—");

interface Ligacao { ativa: boolean; com: string | null }

// Uma batida por vez no app inteiro (SdrLayout e CloserApp nunca montam juntos,
// mas o desligamento por "função não existe" vale pra sessão).
let desligado = false;

async function bater(tela: string, leadId: string | null, lig: Ligacao) {
  if (desligado) return;
  const visivel = document.visibilityState === "visible";
  const acao = lig.ativa
    ? `Em ligação${lig.com ? ` com ${lig.com}` : ""}`
    : !visivel ? "Aba do QS em segundo plano"
    : `Em ${rotuloDaTela(tela)}`;
  const { error } = await supabase.rpc("qs_presenca_bater", {
    p_tela: tela, p_acao: acao, p_lead: leadId, p_aba_visivel: visivel, p_em_ligacao: lig.ativa,
  });
  if (error && (error.code === "PGRST202" || error.code === "42883" || /does not exist|could not find/i.test(error.message))) {
    desligado = true; // 0215 não aplicada: para de tentar
  }
}

export default function Presenca({ tela, leadId }: { tela: string; leadId?: string | null }) {
  const atual = useRef({ tela, leadId: leadId ?? null });
  const lig = useRef<{ web: Ligacao; oficial: Ligacao }>({ web: { ativa: false, com: null }, oficial: { ativa: false, com: null } });
  const ligacao = (): Ligacao => (lig.current.web.ativa ? lig.current.web : lig.current.oficial);
  const agora = () => void bater(atual.current.tela, atual.current.leadId, ligacao()).catch(() => { /* rede: tenta no próximo minuto */ });

  // Troca de tela/lead: bate com folga de 3 s.
  useEffect(() => {
    atual.current = { tela, leadId: leadId ?? null };
    const t = window.setTimeout(agora, FOLGA_TROCA_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tela, leadId]);

  // Relógio de 60 s + aba visível/escondida.
  useEffect(() => {
    agora();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") agora(); }, INTERVALO_MS);
    const onVis = () => agora();
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ligação começou/terminou: bate na hora (só quando o "está em ligação" muda).
  useEffect(() => {
    const mudou = (antes: boolean, depois: boolean) => { if (antes !== depois) agora(); };
    const offWeb = subscribeWebphone((s) => {
      const antes = lig.current.web.ativa;
      const ativa = s.status === "in_call" || s.status === "ringing" || s.status === "connecting";
      lig.current.web = { ativa, com: s.peerName || s.peerNumber || null };
      mudou(antes, ativa);
    });
    const offOficial = assinarLigacaoAtual((e) => {
      const antes = lig.current.oficial.ativa;
      lig.current.oficial = { ativa: e.ativa, com: e.leadName || e.phone || null };
      mudou(antes, e.ativa);
    });
    return () => { offWeb(); offOficial(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
