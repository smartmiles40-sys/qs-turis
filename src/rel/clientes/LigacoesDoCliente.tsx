// src/rel/clientes/LigacoesDoCliente.tsx
// -----------------------------------------------------------------------------
// "De onde veio e onde mais aparece" (0151): o lead do Comercial que virou
// este cliente, os grupos do WhatsApp em que ele está, os atendimentos do
// Financeiro e em quantas viagens vai como passageiro. Some se não houver nada.
// -----------------------------------------------------------------------------
import type { ReactNode } from "react";
import type { LigacoesCliente } from "../lib/clientes";
import { Etiqueta } from "../ui";

const data = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const CAMPO: Record<string, string> = {
  cpf: "CPF", email: "e-mail", telefone: "telefone", nascimento: "nascimento", passaporte: "passaporte", passaporte_validade: "validade do passaporte",
};
const FONTE: Record<string, string> = { bitrix_contato: "contato do Bitrix", venda: "venda no Bitrix", "bitrix_contato+venda": "Bitrix" };

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="py-2">
      <p className="text-[12px] mb-1" style={{ color: "var(--ink3)" }}>{titulo}</p>
      {children}
    </div>
  );
}

export default function LigacoesDoCliente({ l }: { l: LigacoesCliente }) {
  const tem = l.leads.length || l.grupos.length || l.financeiro.length || l.passageiro_em || l.cruzamentos.length;
  if (!tem) return null;
  return (
    <section className="rel-card p-4 sm:p-5" aria-label="Ligações do cliente">
      <h2 className="text-[13px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--ink2)" }}>De onde veio e onde aparece</h2>
      <div className="divide-y" style={{ borderColor: "var(--line2)" }}>
        {l.leads.length > 0 && (
          <Bloco titulo={l.leads.length > 1 ? `Leads no Comercial (${l.leads.length})` : "Lead no Comercial"}>
            <ul className="space-y-1">
              {l.leads.map((x) => (
                <li key={x.id} className="text-[13px] flex flex-wrap items-center gap-x-1.5" style={{ color: "var(--ink)" }}>
                  <b>{x.nome || "—"}</b>
                  <span style={{ color: "var(--ink3)" }}>
                    · chegou {data(x.criado_em)}{x.fonte ? ` · ${x.fonte}` : ""}{x.dono ? ` · com ${x.dono.split(" ")[0]}` : ""}
                  </span>
                  {x.status && <Etiqueta>{x.status}</Etiqueta>}
                  <span className="text-[11px]" style={{ color: "var(--ink3)" }}>(pelo {x.por === "venda" ? "negócio da venda" : x.por})</span>
                </li>
              ))}
            </ul>
          </Bloco>
        )}
        {(l.passageiro_em > 0 || l.comprador_em > 0) && (
          <Bloco titulo="Viagens">
            <p className="text-[13px]" style={{ color: "var(--ink)" }}>
              Comprou {l.comprador_em} · vai como passageiro em mais {l.passageiro_em}
            </p>
          </Bloco>
        )}
        {l.grupos.length > 0 && (
          <Bloco titulo={`Grupos do WhatsApp (${l.grupos.length})`}>
            <div className="flex flex-wrap gap-1.5">
              {l.grupos.map((g) => <Etiqueta key={g.jid} tom="rel">{g.nome || "Grupo sem nome"}</Etiqueta>)}
            </div>
          </Bloco>
        )}
        {l.financeiro.length > 0 && (
          <Bloco titulo={`Atendimentos do Financeiro (${l.financeiro.length})`}>
            <ul className="space-y-0.5">
              {l.financeiro.map((f) => (
                <li key={f.id} className="text-[13px]" style={{ color: "var(--ink)" }}>
                  #{f.numero} {f.motivo ?? "—"} <span style={{ color: "var(--ink3)" }}>· {f.status} · {data(f.criado_em)}</span>
                </li>
              ))}
            </ul>
          </Bloco>
        )}
        {l.cruzamentos.length > 0 && (
          <Bloco titulo="Completado sozinho pelo cruzamento da base">
            <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
              {l.cruzamentos.map((x) => `${CAMPO[x.campo] ?? x.campo} (do ${FONTE[x.fonte] ?? x.fonte}, ${data(x.em)})`).join(" · ")}
            </p>
          </Bloco>
        )}
      </div>
    </section>
  );
}
