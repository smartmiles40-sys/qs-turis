// src/expedicoes/portal/LiberarTodos.tsx
// Card do admin: libera o ExpedAmigo pra todos os passageiros ativos e mostra
// as senhas provisórias (app antigo: LiberarTodosCard + liberarExpedamigoTodos).
// A gravação é a função exp_liberar_expedamigo_todos (0170, security definer,
// só admin) — acesso_senhas não é visível pelo navegador.
import { useState } from "react";
import { Botao } from "@/rel/ui";
import { useExp } from "../contexto";
import { formatarCpf } from "../lib/cpf";
import { IconeSvg } from "../drive/icones";
import { liberarExpedamigoTodos, type ResultadoLiberar } from "./dados";

export function LiberarTodos({ expedicaoId }: { expedicaoId: string }) {
  const { avisar } = useExp();
  const [confirmar, setConfirmar] = useState(false);
  const [indo, setIndo] = useState(false);
  const [r, setR] = useState<ResultadoLiberar | null>(null);

  async function liberar() {
    setIndo(true);
    try {
      const res = await liberarExpedamigoTodos(expedicaoId);
      setR(res);
      avisar(`ExpedAmigo liberado para ${res.total} passageiro(s)`);
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível liberar", "erro"); }
    finally { setIndo(false); setConfirmar(false); }
  }
  function copiar() {
    if (!r) return;
    const txt = r.senhas.map((s) => `${s.nome} — CPF ${formatarCpf(s.cpf)} — senha ${s.senha}`).join("\n");
    navigator.clipboard.writeText(txt).then(() => avisar("Lista copiada")).catch(() => avisar("Não foi possível copiar", "erro"));
  }

  return (
    <section className="rounded-2xl p-4" style={{ border: "1px solid #FCD34D", background: "rgba(254, 243, 199, .35)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "#FEF3C7", color: "#92400E" }}><IconeSvg nome="chave" /></span>
          <div>
            <h3 className="text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>Liberar portal para todos</h3>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink3)" }}>Libera o ExpedAmigo de todos os passageiros desta expedição (menos os cancelados) e gera a senha provisória de quem ainda não tem.</p>
          </div>
        </div>
        {!confirmar ? (
          <Botao variante="primario" onClick={() => setConfirmar(true)} disabled={indo}><IconeSvg nome="chave" /> Liberar para todos</Botao>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: "var(--ink2)" }}>Confirmar?</span>
            <Botao variante="primario" onClick={() => void liberar()} disabled={indo}>{indo ? "Liberando…" : "Sim, liberar"}</Botao>
            <Botao onClick={() => setConfirmar(false)} disabled={indo}>Cancelar</Botao>
          </div>
        )}
      </div>

      {r && (
        <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
              <strong style={{ color: "#166534" }}>{r.total} liberados</strong>
              {r.ja_tinham_senha > 0 && <> · {r.ja_tinham_senha} já tinham senha própria</>}
              {r.senhas.length > 0 && <> · {r.senhas.length} com senha provisória</>}
            </p>
            {r.senhas.length > 0 && <Botao onClick={copiar}><IconeSvg nome="copiar" /> Copiar lista</Botao>}
          </div>
          {r.senhas.length > 0 && (
            <div className="mt-2 max-h-72 overflow-auto rounded-lg border" style={{ borderColor: "var(--line)" }}>
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0" style={{ background: "var(--card2)" }}>
                  <tr>{["Passageiro", "CPF", "Senha provisória"].map((h) => <th key={h} className="px-2 py-1.5 text-left text-[10.5px] uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {r.senhas.map((s) => (
                    <tr key={s.cpf} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="px-2 py-1">{s.nome}</td>
                      <td className="px-2 py-1 font-mono">{formatarCpf(s.cpf)}</td>
                      <td className="px-2 py-1 font-mono font-bold">{s.senha}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px]" style={{ color: "var(--ink3)" }}>Repasse a senha provisória para cada viajante — no 1º acesso ele troca por uma própria.</p>
        </div>
      )}
    </section>
  );
}
