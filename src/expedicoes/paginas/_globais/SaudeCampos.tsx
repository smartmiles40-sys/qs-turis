// src/expedicoes/paginas/_globais/SaudeCampos.tsx
// Questionário de saúde do perfil global (app antigo: passageiros/SaudeCampos.tsx):
// Sim/Não por pergunta (lib/saude.ts) + detalhe quando "Sim" + anexo do
// Certificado de Febre Amarela (sobe na linha-âncora da pessoa). Controlado.
import { useState } from "react";
import { Botao, Entrada } from "@/rel/ui";
import { useExp } from "../../contexto";
import { PERGUNTAS_SAUDE } from "../../lib/saude";
import { abrirArquivo, subirDocumentoPessoal } from "./pessoaAcoes";

type Saude = Record<string, string>;

export function SaudeCampos({ valor, onMudar, expedicaoId, passageiroId, leitura }: {
  valor: Saude; onMudar: (v: Saude) => void; expedicaoId: string | null; passageiroId: string | null; leitura: boolean;
}) {
  const set = (campo: string, v: string) => onMudar({ ...valor, [campo]: v });
  return (
    <div className="space-y-2.5">
      {PERGUNTAS_SAUDE.map((q) => {
        const val = valor[q.campo] ?? "";
        return (
          <div key={q.campo} className="rounded-lg border p-2.5 space-y-1.5" style={{ borderColor: "var(--line)" }}>
            <p className="text-[12.5px] leading-snug font-semibold" style={{ color: "var(--ink)" }}>{q.pergunta}</p>
            <div className="flex gap-1.5" role="group" aria-label={q.curto}>
              {(["Sim", "Não"] as const).map((opt) => (
                <button type="button" key={opt} disabled={leitura} aria-pressed={val === opt} onClick={() => set(q.campo, val === opt ? "" : opt)}
                  className="px-3 py-1 rounded-md border text-[12px] font-semibold disabled:cursor-default"
                  style={val === opt ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" } : { background: "var(--card)", color: "var(--ink2)", borderColor: "var(--line)" }}>
                  {opt}
                </button>
              ))}
            </div>
            {q.detalheCampo && val === "Sim" && (
              <label className="block">
                <span className="block text-[11px] mb-1" style={{ color: "var(--ink3)" }}>{q.detalhePergunta}</span>
                <Entrada disabled={leitura} value={valor[q.detalheCampo] ?? ""} onChange={(e) => set(q.detalheCampo!, e.target.value)} />
              </label>
            )}
            {q.detalhe2Campo && val === "Sim" && (
              <label className="block">
                <span className="block text-[11px] mb-1" style={{ color: "var(--ink3)" }}>{q.detalhe2Pergunta}</span>
                <Entrada disabled={leitura} value={valor[q.detalhe2Campo] ?? ""} onChange={(e) => set(q.detalhe2Campo!, e.target.value)} />
              </label>
            )}
            {q.campo === "vacina_febre_amarela" && val === "Sim" && expedicaoId && passageiroId && (
              <AnexoCertificado expedicaoId={expedicaoId} passageiroId={passageiroId} leitura={leitura}
                arquivoId={valor.vacina_febre_amarela_arquivo_id ?? ""} onMudar={(id) => set("vacina_febre_amarela_arquivo_id", id)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AnexoCertificado({ expedicaoId, passageiroId, arquivoId, onMudar, leitura }: {
  expedicaoId: string; passageiroId: string; arquivoId: string; onMudar: (id: string) => void; leitura: boolean;
}) {
  const { avisar } = useExp();
  const [indo, setIndo] = useState(false);
  const anexar = async (f: File) => {
    setIndo(true);
    try { onMudar(await subirDocumentoPessoal(expedicaoId, passageiroId, f, "Certificado Internacional de Vacinação — Febre Amarela")); avisar("Certificado anexado — clique em Salvar para confirmar"); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao anexar", "erro"); }
    finally { setIndo(false); }
  };
  return (
    <div className="pt-1">
      <span className="block text-[11px] mb-1" style={{ color: "var(--ink3)" }}>Certificado da vacina (anexo)</span>
      {arquivoId ? (
        <div className="flex items-center gap-2 rounded-md border p-2" style={{ borderColor: "var(--line)" }}>
          <span className="flex-1 text-[13px] font-semibold" style={{ color: "#16A34A" }}>✓ Certificado anexado</span>
          <Botao type="button" onClick={() => abrirArquivo(arquivoId).catch((e) => avisar(e.message, "erro"))}>Ver</Botao>
          {!leitura && <Botao type="button" onClick={() => onMudar("")}>Remover</Botao>}
        </div>
      ) : leitura ? <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Sem anexo.</span> : (
        <label className="flex items-center justify-center rounded-md border border-dashed px-3 py-2 text-[13px] cursor-pointer rel-linha" style={{ borderColor: "var(--line)", opacity: indo ? 0.6 : 1 }}>
          <input type="file" accept="image/*,application/pdf" className="hidden" disabled={indo}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void anexar(f); e.target.value = ""; }} />
          {indo ? "Anexando…" : "Anexar certificado"}
        </label>
      )}
    </div>
  );
}
