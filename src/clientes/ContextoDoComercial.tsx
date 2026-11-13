// src/clientes/ContextoDoComercial.tsx
// -----------------------------------------------------------------------------
// "DO COMERCIAL" (visão cruzada, 13/11/2026) — na ficha do cliente do Rel e na
// gaveta da pessoa no Ops. Somente leitura: por onde a pessoa chegou (origem/
// UTM), por que desistiu (motivo de perda), e, por lead: o negócio do closer,
// as respostas do formulário da LP, as notas do SDR e as reuniões (com notas,
// desfecho, gravação e transcrição).
//
// Reaproveita o que já existe — nada duplicado:
//   • <ReunioesDoCliente somenteLeitura> — lê qs_meetings direto (a RLS deixa
//     qualquer usuário ativo ler reuniões e transcrições).
//   • <RespostasDoFormulario respostasProntas> — as respostas vêm do cache pela
//     RPC (o /api/lead-formulario dá 403 pra quem não é do Comercial).
// Os leads, as notas e o negócio vêm da pessoa_contexto_comercial (0382); o
// motivo de perda consolidado e a origem, da cliente_resumo_setores (0381).
// Sem as migrations (ou sem acesso) o bloco simplesmente não aparece.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import ReunioesDoCliente from "@/controle-comercial/ReunioesDoCliente";
import RespostasDoFormulario from "@/components/sdr/leads/RespostasDoFormulario";
import { contextoComercial, resumoDaPessoa } from "./visaoCruzada";
import { ETAPA_NEGOCIO, dataCurta, textoOrigem, type ContextoComercial, type ResumoSetores } from "./visaoCruzadaRegras";

const SEM_RESPOSTAS: ContextoComercial["leads"][number]["respostas"] = [];
const tx = { forte: "var(--text)", medio: "var(--muted)", fraco: "var(--subtle)" };
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export default function ContextoDoComercial({ clienteId, titulo = "Do Comercial" }: { clienteId: string; titulo?: string }) {
  const [d, setD] = useState<{ ctx: ContextoComercial | null; resumo: ResumoSetores | null } | null>(null);

  useEffect(() => {
    let vivo = true;
    setD(null);
    void Promise.all([contextoComercial(clienteId), resumoDaPessoa(clienteId)])
      .then(([ctx, resumo]) => { if (vivo) setD({ ctx, resumo }); });
    return () => { vivo = false; };
  }, [clienteId]);

  const leads = d?.ctx?.leads ?? [];
  if (!d || !leads.length) return null;

  const origem = textoOrigem(d.resumo?.origem ?? leads[leads.length - 1]);
  const chegou = d.resumo?.origem?.chegou_em ?? leads[leads.length - 1]?.chegou_em ?? null;
  const motivo = d.resumo?.motivo_perda ?? null;

  return (
    <section aria-label={titulo} style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: tx.forte, flex: 1 }}>{titulo}</h3>
        <span style={{ fontSize: 12, color: tx.fraco }}>somente leitura</span>
      </div>

      {(origem || motivo || chegou) && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
          {(origem || chegou) && (
            <span><span style={{ color: tx.medio }}>Chegou por: </span>
              <b style={{ color: tx.forte }}>{origem || "origem não informada"}</b>
              {chegou && <span style={{ color: tx.medio }}> · {dataCurta(chegou)}</span>}
            </span>
          )}
          {motivo && <span><span style={{ color: tx.medio }}>Motivo de perda: </span><b style={{ color: tx.forte }}>{motivo}</b></span>}
        </div>
      )}

      {leads.map((l, i) => (
        <details key={l.id} open={i === 0} style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <summary style={{ cursor: "pointer", fontSize: 13, color: tx.forte, display: "flex", flexWrap: "wrap", gap: 6 }}>
            <b>{l.nome || "Lead"}</b>
            <span style={{ color: tx.medio }}>
              {[l.chegou_em ? `chegou ${dataCurta(l.chegou_em)}` : null, l.status, l.dono ? `SDR ${l.dono.split(" ")[0]}` : null,
                l.negocio ? `${ETAPA_NEGOCIO[l.negocio.etapa] ?? l.negocio.etapa}${l.negocio.closer ? ` com ${l.negocio.closer.split(" ")[0]}` : ""}` : null]
                .filter(Boolean).join(" · ")}
            </span>
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
            {(l.negocio?.motivo_perda || l.motivo_perda) && (
              <p style={{ margin: 0, fontSize: 12.5, color: tx.medio }}>
                Perda: <b style={{ color: tx.forte }}>{l.negocio?.motivo_perda || l.motivo_perda}</b>
              </p>
            )}
            {textoOrigem(l) && i > 0 && <p style={{ margin: 0, fontSize: 12.5, color: tx.medio }}>Origem: {textoOrigem(l)}</p>}
            <RespostasDoFormulario leadId={l.id} variante="ficha" respostasProntas={l.respostas ?? SEM_RESPOSTAS} />
            {l.notas?.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: tx.fraco }}>Notas do Comercial</span>
                {l.notas.map((n) => (
                  <div key={n.id} style={{ fontSize: 12.5, color: tx.medio }}>
                    <span style={{ color: tx.fraco }}>{dataHora(n.criado_em)}{n.autor ? ` · ${n.autor.split(" ")[0]}` : ""}: </span>
                    <span style={{ whiteSpace: "pre-wrap", color: tx.forte }}>{n.texto}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: tx.fraco }}>Reuniões</span>
              <ReunioesDoCliente leadId={l.id} somenteLeitura />
            </div>
          </div>
        </details>
      ))}
    </section>
  );
}
