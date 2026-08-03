// src/preview/AgendaPreview.tsx
// -----------------------------------------------------------------------------
// Página de PREVIEW LOCAL da agenda por especialista, servida em
// http://localhost:3000/agenda-preview.html no `npm run dev`.
//
// Renderiza o AgendaClosers REAL com dados de mentira (prop `demo`): sem login,
// sem banco e sem gravar nada. Serve pra ver o layout — inclusive os casos
// chatos: reunião sobreposta, reunião pendente de desfecho, coluna herdada do
// texto livre e fora-do-expediente hachurado.
// Nada disso entra no build de produção (o build só empacota o index.html).
// -----------------------------------------------------------------------------

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import AgendaClosers, { type AgendaDemo } from "../components/sdr/agenda/AgendaClosers";
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
  availability: [
    // Talita atende 9–12 e 13–18 (o almoço vira hachura entre as duas janelas)
    ...[1, 2, 3, 4, 5].flatMap((weekday) => [
      { id: `a${weekday}a`, closer_id: "c1", weekday, start_time: "09:00:00", end_time: "12:00:00" },
      { id: `a${weekday}b`, closer_id: "c1", weekday, start_time: "13:00:00", end_time: "18:00:00" },
    ]),
    // Bruno só à tarde
    ...[0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      id: `b${weekday}`, closer_id: "c2", weekday, start_time: "13:00:00", end_time: "20:00:00",
    })),
    // Domingo/sábado da Talita: sem janela nenhuma → sem hachura (é o padrão)
  ],
  blocks: [
    { id: "bl1", closer_id: "c2", starts_at: em(16, 0), ends_at: em(17, 0), reason: "Compromisso pessoal" },
  ],
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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-gray-50 p-4">
      <p className="mb-3 text-sm text-gray-500">
        Preview local da <b>Agenda por especialista</b> — dados de mentira, nada é gravado.
      </p>
      <AgendaClosers demo={DEMO} onOpenLead={(id) => console.log("[preview] abrir lead", id)} />
    </div>
  </StrictMode>
);
