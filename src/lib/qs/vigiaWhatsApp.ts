// src/lib/qs/vigiaWhatsApp.ts
// -----------------------------------------------------------------------------
// A PERNA DE DENTRO DO APP do vigia dos números de WhatsApp.
//
// O problema que isto resolve não é "o número caiu" — isso o monitor já sabia
// detectar. É "ninguém ficou sabendo". Em 17/08 o agendador externo parou de
// bater na rota do vigia e o sistema ficou dois dias sem ronda nenhuma, mudo.
// E há um caso em que o alerta por WhatsApp NUNCA vai funcionar: quando o
// problema é justamente o servidor de WhatsApp — não há por onde mandar o
// aviso de que não há por onde mandar.
//
// Por isso o aviso também entra por um canal que não depende do WhatsApp: a
// tela do QS, que o time tem aberta o dia inteiro. E a mesma chamada que
// pergunta "está tudo no ar?" faz o servidor rodar a ronda, então enquanto
// houver alguém trabalhando o vigia está vivo — sem agendador, sem segredo.
//
// A trava de 10 minutos mora no servidor: cinco SDRs com o QS aberto não viram
// cinco chamadas à Evolution.
// -----------------------------------------------------------------------------

import { supabase } from "@/lib/supabase";

const INTERVALO_MS = 5 * 60_000;
/** Falha mais velha que isto é história, não incidente. */
const FALHA_RECENTE_MS = 20 * 60_000;

export type SaudeWhatsApp = {
  caidas: string[];
  /** Não consegui nem falar com o servidor da Evolution. */
  semServidor: boolean;
  verificadoEm: string | null;
};

type Listener = (saude: SaudeWhatsApp | null) => void;
const listeners = new Set<Listener>();

let ultima: SaudeWhatsApp | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function avisar(s: SaudeWhatsApp | null) {
  ultima = s;
  listeners.forEach((l) => {
    try { l(s); } catch { /* um listener quebrado não derruba os outros */ }
  });
}

/**
 * A CADÊNCIA DA GLÓRIA PEGA CARONA NESTA MESMA BATIDA.
 *
 * Ela precisa da mesma coisa que o vigia: alguém acionando o servidor de tempos
 * em tempos, sem depender de agendador externo (que já morreu calado uma vez).
 * O trabalho de verdade é do servidor, com trava de 5 minutos no banco — aqui é
 * só a batida. Falhou, não importa: a próxima mensagem que chegar no webhook
 * também aciona a fila.
 */
async function baterNaCadenciaDaGloria(token: string): Promise<void> {
  try {
    await fetch("/api/gloria-toques", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    /* rede oscilando não é problema da cadência */
  }
}

async function verificar(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    // Sem sessão não há o que vigiar — e a rota recusaria de qualquer forma.
    if (!token) return;

    void baterNaCadenciaDaGloria(token);

    const r = await fetch("/api/wa-vigia", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!r.ok) return;
    const j = await r.json();

    const falha = j?.falha?.em ? Date.parse(j.falha.em) : null;
    const semServidor = !!falha && Date.now() - falha < FALHA_RECENTE_MS;
    const caidas: string[] = Array.isArray(j?.caidas) ? j.caidas : [];

    // Nada errado → null, e o aviso some sozinho quando o número volta.
    avisar(caidas.length || semServidor
      ? { caidas, semServidor, verificadoEm: j?.verificadoEm ?? null }
      : null);
  } catch {
    // Rede da SDR oscilando não é queda de WhatsApp. Silêncio é a resposta
    // certa: alerta que grita por engano é alerta que o time aprende a ignorar.
  }
}

/**
 * Liga a vigilância. Chamar UMA vez (SdrLayout). Devolve o desligamento.
 * Roda ao abrir, a cada 5 min e quando a aba volta pro primeiro plano.
 */
export function vigiarWhatsApp(onSaude: Listener): () => void {
  listeners.add(onSaude);
  if (ultima) onSaude(ultima);

  const aoVoltar = () => { if (!document.hidden) void verificar(); };
  if (!timer) {
    void verificar();
    // Aba escondida não pergunta: o navegador estrangula o timer e, pior, seria
    // gastar chamada por uma tela que ninguém está vendo.
    timer = setInterval(() => { if (!document.hidden) void verificar(); }, INTERVALO_MS);
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
  }

  return () => {
    listeners.delete(onSaude);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    }
  };
}
