// src/preview/AgendaPreview.tsx
// -----------------------------------------------------------------------------
// Página de PREVIEW LOCAL da Agenda (mês), servida em
// http://localhost:3000/agenda-preview.html no `npm run dev`.
//
// Renderiza a tela REAL com dados de mentira (prop `demo`): sem login, sem banco
// e sem gravar nada. Cobre os casos chatos — dia lotado (+N mais), reunião que
// passou sem desfecho, especialista herdado do texto livre, reunião sem dono —
// e tem um botão de MODO NOTURNO pra conferir o tema escuro sem logar.
// Nada disso entra no build de produção (o build só empacota o index.html).
// -----------------------------------------------------------------------------

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import AgendaMes, { type AgendaDemo } from "../components/sdr/agenda/AgendaMes";
import type { Meeting, MeetingSal, MeetingStatus, SdrUser } from "../components/sdr/types";

const hoje = new Date();
const em = (h: number, m = 0): string => {
  const d = new Date(hoje);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const closer = (id: string, name: string): SdrUser => ({
  id, name, email: `${id}@exemplo.com`, role: "closer", is_active: true, created_at: em(0),
});

const CLOSERS = [closer("c1", "Talita Carvalho"), closer("c2", "Bruno Matheus"), closer("c3", "John Italo")];

let seq = 0;
function reuniao(
  closerId: string | null,
  lead: string,
  h: number,
  min: number,
  dur: number,
  status: MeetingStatus,
  extras: { link?: boolean; sal?: MeetingSal; owner?: string } = {}
): Meeting {
  seq += 1;
  return {
    id: `m${seq}`,
    lead_id: `lead${seq}`,
    owner_id: "sdr1",
    closer_id: closerId,
    title: null,
    scheduled_at: em(h, min),
    ends_at: em(h + Math.floor((min + dur) / 60), (min + dur) % 60),
    duration_min: dur,
    location: "Google Meet",
    meeting_link: extras.link ? "https://meet.google.com/abc-defg-hij" : null,
    notes: null,
    status,
    sal: extras.sal ?? null,
    lead_name: lead,
    scheduled_by: "Mariana · SDR",
    meeting_owner: extras.owner ?? null,
    created_at: em(8),
  };
}

const DEMO: AgendaDemo = {
  closers: CLOSERS,
  configs: [],
  meetings: [
    reuniao("c1", "Roselene Pereira", 10, 30, 60, "realizada", { link: true, sal: "aceito" }),
    reuniao("c1", "Jessica Melo", 14, 0, 60, "agendada", { link: true }),
    reuniao("c1", "Andréia Calles", 9, 0, 60, "no_show"),
    // sobreposição: dois cards dividindo a coluna
    reuniao("c1", "Gésica Camila", 15, 30, 60, "confirmada", { link: true }),
    reuniao("c1", "Acácio Carmo", 16, 0, 30, "agendada"),
    reuniao("c2", "João Vitor", 13, 30, 60, "reagendada"),
    reuniao("c2", "Ariadny Lazinski", 18, 0, 60, "agendada", { link: true }),
    reuniao("c2", "Marcos Pellini", 19, 0, 60, "confirmada", { link: true }),
    reuniao("c3", "Nicoly Harumi", 11, 0, 60, "realizada", { link: true, sal: "recusado" }),
    reuniao("c3", "Daniel Adan", 12, 0, 60, "cancelada"),
    reuniao("c3", "Manoel Sales", 14, 0, 60, "agendada", { link: true }),
    // coluna herdada do texto livre (sem closer_id) — o caso real de hoje
    reuniao(null, "Milena Duarte", 15, 0, 60, "agendada", { owner: "Victor Maldonado" }),
    reuniao(null, "Bruno Sidney Pinheiro", 17, 30, 60, "agendada", { owner: "Victor Maldonado" }),
    // sem responsável nenhum
    reuniao(null, "Lead órfão da integração", 9, 30, 30, "agendada"),
  ],
};

// ── Mês: as mesmas reuniões, espalhadas pelas semanas ───────────────────────
// A visão de mês só mostra o que interessa nela (volume, quem, e o que passou
// sem desfecho), então o demo precisa de dias diferentes — não só "hoje".

function noDia(offsetDias: number, h: number, min = 0): string {
  const d = new Date(hoje);
  d.setDate(d.getDate() + offsetDias);
  d.setHours(h, min, 0, 0);
  return d.toISOString();
}

const DEMO_MES: AgendaDemo = {
  ...DEMO,
  meetings: [
    ...DEMO.meetings,
    // Passado sem desfecho: é o alerta âmbar que a tela precisa gritar.
    { ...reuniao("c1", "Karine Ribeiro", 10, 0, 60, "agendada"), id: "x1", scheduled_at: noDia(-6, 10), ends_at: noDia(-6, 11) },
    { ...reuniao("c2", "Elias Furtado", 15, 0, 60, "confirmada"), id: "x2", scheduled_at: noDia(-3, 15), ends_at: noDia(-3, 16) },
    // Passado resolvido
    { ...reuniao("c3", "Simone Vieira", 9, 0, 60, "realizada", { sal: "aceito" }), id: "x3", scheduled_at: noDia(-8, 9), ends_at: noDia(-8, 10) },
    { ...reuniao("c1", "Otávio Prado", 16, 0, 60, "no_show"), id: "x4", scheduled_at: noDia(-2, 16), ends_at: noDia(-2, 17) },
    // Futuro
    { ...reuniao("c2", "Larissa Amaral", 11, 0, 60, "agendada", { link: true }), id: "x5", scheduled_at: noDia(2, 11), ends_at: noDia(2, 12) },
    { ...reuniao("c3", "Rafael Nunes", 14, 0, 60, "agendada"), id: "x6", scheduled_at: noDia(2, 14), ends_at: noDia(2, 15) },
    { ...reuniao("c1", "Priscila Tavares", 9, 30, 60, "confirmada"), id: "x7", scheduled_at: noDia(2, 9, 30), ends_at: noDia(2, 10, 30) },
    // Dia lotado: dispara o "+N mais"
    { ...reuniao("c1", "Cliente A", 8, 0, 30, "agendada"), id: "x8", scheduled_at: noDia(5, 8), ends_at: noDia(5, 8) },
    { ...reuniao("c2", "Cliente B", 9, 0, 30, "agendada"), id: "x9", scheduled_at: noDia(5, 9), ends_at: noDia(5, 9) },
    { ...reuniao("c3", "Cliente C", 10, 0, 30, "agendada"), id: "x10", scheduled_at: noDia(5, 10), ends_at: noDia(5, 10) },
    { ...reuniao(null, "Cliente D", 11, 0, 30, "agendada", { owner: "Victor Maldonado" }), id: "x11", scheduled_at: noDia(5, 11), ends_at: noDia(5, 11) },
    { ...reuniao("c1", "Cliente E", 12, 0, 30, "agendada"), id: "x12", scheduled_at: noDia(5, 12), ends_at: noDia(5, 12) },
    // Semana seguinte
    { ...reuniao("c2", "Heloísa Braga", 17, 0, 60, "agendada"), id: "x13", scheduled_at: noDia(9, 17), ends_at: noDia(9, 18) },
    { ...reuniao("c3", "Wanderson Luz", 13, 0, 60, "cancelada"), id: "x14", scheduled_at: noDia(12, 13), ends_at: noDia(12, 14) },
  ],
};

function Preview() {
  // O preview também serve pra conferir o MODO NOTURNO sem precisar logar: o
  // tema é uma classe no <html>, então basta alterná-la aqui.
  const [escuro, setEscuro] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", escuro);
    document.documentElement.style.colorScheme = escuro ? "dark" : "light";
  }, [escuro]);

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setEscuro((v) => !v)}
          className="rounded-lg border border-gray-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
        >
          {escuro ? "☀️ Modo claro" : "🌙 Modo noturno"}
        </button>
        <p className="text-sm text-gray-500">
          Preview local da <b>Agenda</b> — dados de mentira, nada é gravado.
        </p>
      </div>

      <AgendaMes demo={DEMO_MES} onOpenLead={(id) => console.log("[preview] abrir lead", id)} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>
);
