// src/solicitacoes/FormServico.tsx
// Os campos do pedido de SERVIÇO (0203): assento, remarcação, bagagem, nome,
// check-in, emissão, alteração, cancelamento, documentos. Os campos de cada tipo
// estão em servico.ts; aqui só desenha (e o "de leitura", no cartão aberto).
import { Campo, Entrada } from "@/rel/ui";
import { Chips, Grupo } from "./FormCotacao";
import { CAMPOS_DO_TIPO, linhasDoServico, type CampoServico, type FormServico, type ValorCampo } from "./servico";

function UmCampo({ c, valor, onMudar }: { c: CampoServico; valor: ValorCampo | undefined; onMudar: (v: ValorCampo) => void }) {
  const rotulo = `${c.rotulo}${c.obrigatorio ? "" : " (opcional)"}`;
  if (c.tipo === "escolha" || c.tipo === "varios") {
    const atual = c.tipo === "varios" ? (Array.isArray(valor) ? valor : []) : (typeof valor === "string" ? valor : "");
    return (
      <Grupo rotulo={rotulo} dica={c.dica}>
        <Chips rotulo={c.rotulo} varios={c.tipo === "varios"} opcoes={c.opcoes ?? []} valor={atual}
          onMudar={(k) => {
            if (c.tipo === "varios") { const l = atual as string[]; onMudar(l.includes(k) ? l.filter((x) => x !== k) : [...l, k]); }
            else onMudar(atual === k ? "" : k);
          }} />
      </Grupo>
    );
  }
  const texto = typeof valor === "string" ? valor : "";
  return (
    <Campo rotulo={rotulo} dica={c.dica}>
      {c.tipo === "textarea"
        ? <textarea className="rel-input" rows={3} maxLength={3000} value={texto} placeholder={c.placeholder} onChange={(e) => onMudar(e.target.value)} />
        : <Entrada type={c.tipo === "data" ? "date" : "text"} value={texto} maxLength={300} placeholder={c.placeholder} onChange={(e) => onMudar(e.target.value)} />}
    </Campo>
  );
}

export default function FormServicoCampos({ tipoId, f, onMudar }: { tipoId: string; f: FormServico; onMudar: (f: FormServico) => void }) {
  const campos = CAMPOS_DO_TIPO[tipoId] ?? [];
  return (
    <fieldset className="rel-card p-3 grid sm:grid-cols-2 gap-x-3 gap-y-3">
      {campos.map((c) => (
        <div key={c.id} className={c.largo || c.tipo === "escolha" || c.tipo === "varios" ? "sm:col-span-2" : ""}>
          <UmCampo c={c} valor={f.campos[c.id]} onMudar={(v) => onMudar({ ...f, campos: { ...f.campos, [c.id]: v } })} />
        </div>
      ))}
    </fieldset>
  );
}

/** O formulário preenchido, de leitura (no cartão aberto). */
export function VerServico({ tipoId, f }: { tipoId: string; f: FormServico }) {
  const linhas = linhasDoServico(tipoId, f);
  if (!linhas.length) return null;
  return (
    <dl className="rounded-xl p-3 grid sm:grid-cols-2 gap-x-4 gap-y-1.5" style={{ background: "var(--card2)" }}>
      {linhas.map(([r, v]) => (
        <div key={r} className={`text-[13px] leading-snug ${v.length > 40 || v.includes("\n") ? "sm:col-span-2" : ""}`}>
          <dt className="inline font-semibold" style={{ color: "var(--ink2)" }}>{r}: </dt>
          <dd className="inline whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
