// src/expedicoes/passageiros/SaudeCampos.tsx
// Questionário de saúde (app antigo: passageiros/SaudeCampos.tsx + lib/saude.ts).
// Controlado (value/onChange); é dado da PESSOA — salvo junto com o formulário do
// passageiro, propaga pras outras expedições dela. Clicar no botão já marcado limpa.
// "Sim" no certificado de febre amarela permite anexar o arquivo.
import { useRef, useState } from "react";
import { Botao, Entrada } from "@/rel/ui";
import { useExp } from "../contexto";
import { PERGUNTAS_SAUDE } from "../lib/saude";
import type { SaudePassageiro } from "../lib/database";
import { arquivoPorId, enviarArquivo } from "./dados";
import { Opcao, useVerArquivo } from "./pecas";

type Chave = keyof SaudePassageiro;

export default function SaudeCampos({ value, onChange, expedicaoId, passageiroId }: {
  value: SaudePassageiro; onChange: (v: SaudePassageiro) => void; expedicaoId: string | null; passageiroId: string | null;
}) {
  const { somenteLeitura } = useExp();
  const set = (c: Chave, v: string) => onChange({ ...value, [c]: v });
  return (
    <div className="space-y-2.5">
      {PERGUNTAS_SAUDE.map((q) => {
        const val = value[q.campo] ?? "";
        return (
          <div key={q.campo} className="rounded-lg p-2.5 space-y-1.5" style={{ border: "1px solid var(--line)" }}>
            <p className="text-[12.5px] leading-snug" style={{ color: "var(--ink)" }}>{q.pergunta}</p>
            <div className="flex gap-1.5">
              {(["Sim", "Não"] as const).map((o) => (
                <Opcao key={o} ativo={val === o} cor={o === "Sim" ? "neutro" : "neutro"} disabled={somenteLeitura} onClick={() => set(q.campo, val === o ? "" : o)}>{o}</Opcao>
              ))}
            </div>
            {val === "Sim" && q.detalheCampo && (
              <label className="block">
                <span className="block text-[11.5px] mb-1" style={{ color: "var(--ink3)" }}>{q.detalhePergunta}</span>
                <Entrada value={value[q.detalheCampo] ?? ""} disabled={somenteLeitura} onChange={(e) => set(q.detalheCampo as Chave, e.target.value)} />
              </label>
            )}
            {val === "Sim" && q.detalhe2Campo && (
              <label className="block">
                <span className="block text-[11.5px] mb-1" style={{ color: "var(--ink3)" }}>{q.detalhe2Pergunta}</span>
                <Entrada value={value[q.detalhe2Campo] ?? ""} disabled={somenteLeitura} onChange={(e) => set(q.detalhe2Campo as Chave, e.target.value)} />
              </label>
            )}
            {q.campo === "vacina_febre_amarela" && val === "Sim" && expedicaoId && passageiroId && (
              <AnexoCertificado expedicaoId={expedicaoId} passageiroId={passageiroId} arquivoId={value.vacina_febre_amarela_arquivo_id ?? ""}
                onChange={(id) => set("vacina_febre_amarela_arquivo_id", id)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function AnexoCertificado({ expedicaoId, passageiroId, arquivoId, onChange }: { expedicaoId: string; passageiroId: string; arquivoId: string; onChange: (id: string) => void }) {
  const { avisar, somenteLeitura } = useExp();
  const { ver, visor } = useVerArquivo();
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <div className="pt-1">
      <span className="block text-[11.5px] mb-1" style={{ color: "var(--ink3)" }}>Certificado da vacina (anexo)</span>
      {arquivoId ? (
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className="flex-1" style={{ color: "#166534" }}>✓ Certificado anexado</span>
          <Botao onClick={async () => { const a = await arquivoPorId(arquivoId); if (a) void ver(a); else avisar("Arquivo não encontrado", "erro"); }}>Ver</Botao>
          {!somenteLeitura && <Botao onClick={() => onChange("")}>Remover</Botao>}
        </div>
      ) : !somenteLeitura && (
        <>
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setEnviando(true);
            try {
              const a = await enviarArquivo(f, { expedicaoId, passageiroId, categoria: "Documentos pessoais", descricao: "Certificado Internacional de Vacinação — Febre Amarela" });
              onChange(a.id);
              avisar("Certificado anexado — clique em Salvar para confirmar");
            } catch (er) { avisar(er instanceof Error ? er.message : "Erro ao anexar", "erro"); }
            finally { setEnviando(false); e.target.value = ""; }
          }} />
          <Botao disabled={enviando} onClick={() => input.current?.click()}>{enviando ? "Enviando…" : "Anexar certificado"}</Botao>
        </>
      )}
      {visor}
    </div>
  );
}
