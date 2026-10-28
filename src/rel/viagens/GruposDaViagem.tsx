// src/rel/viagens/GruposDaViagem.tsx
// -----------------------------------------------------------------------------
// Os GRUPOS DO WHATSAPP da viagem (28/10/2026, 0219): os ligados a esta viagem
// ou à expedição dela (o vínculo é feito em Grupos → dados do grupo, ou em
// "Ligar às viagens"). Clique abre o grupo no Relacionamento.
// Sem a 0219 no banco (ou sem grupo ligado) mostra só a dica, sem erro.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { gruposDaViagem, type Grupo } from "../lib/grupos";
import { Avatar } from "../ui";

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

export default function GruposDaViagem({ viagemId }: { viagemId: string }) {
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  useEffect(() => { gruposDaViagem(viagemId).then(setGrupos).catch(() => setGrupos([])); }, [viagemId]);
  const abrir = (jid: string) => { window.location.hash = `#rel/grupos/${encodeURIComponent(jid)}`; };

  return (
    <section className="rel-card p-4 sm:p-5">
      <h2 className="text-[13px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--ink2)" }}>Grupos do WhatsApp</h2>
      {grupos === null && <div className="h-10 rounded-lg animate-pulse" style={{ background: "var(--card2)" }} />}
      {grupos?.length === 0 && (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
          Nenhum grupo ligado. Em <button className="underline font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => { window.location.hash = "#rel/grupos"; }}>Grupos</button>, abra o grupo → dados do grupo → Viagem.
        </p>
      )}
      <ul>
        {grupos?.map((g) => (
          <li key={g.jid}>
            <button onClick={() => abrir(g.jid)} className="w-full text-left flex items-center gap-3 py-2" style={{ borderTop: "1px solid var(--line2)" }}>
              {g.foto_url
                ? <img src={g.foto_url} alt="" aria-hidden referrerPolicy="no-referrer" className="w-8 h-8 rounded-full object-cover flex-shrink-0" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                : <Avatar nome={g.nome || "Grupo"} tamanho={32} />}
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--ink)" }}>
                  {g.nome || "Grupo sem nome"}
                  {(g.nao_lidas ?? 0) > 0 && <span className="ml-2 text-[11px] font-bold px-1.5 rounded-full" style={{ background: "#00A884", color: "#fff" }}>{g.nao_lidas}</span>}
                </span>
                <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                  {[g.participantes ? `${g.participantes} participantes` : "", g.ultima_msg ? `${quando(g.ultima_msg_em)} · ${g.ultima_msg}` : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="text-[12.5px] font-semibold" style={{ color: "var(--rel-ink)" }}>Abrir</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
