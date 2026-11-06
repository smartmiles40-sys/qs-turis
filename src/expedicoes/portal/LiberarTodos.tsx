// src/expedicoes/portal/LiberarTodos.tsx
// Card do admin: libera o ExpedAmigo pra todos os passageiros ativos e devolve
// UM LINK MÁGICO por pessoa que ainda não criou a própria senha (06/11/2026 —
// antes gerava senha provisória pela 0170; o antigo mudou em f6326c6).
// A gravação é no servidor (POST /api/expedicoes?acao=amigo-liberar-todos, só admin).
// NADA é enviado a ninguém: a lista volta pra quem clicou repassar (copiar ou
// abrir o WhatsApp de cada um). Em modo validação o servidor recusa (423) e o
// botão fica desligado — libera-se pelo sistema antigo até a virada.
import { useState } from "react";
import { Botao } from "@/rel/ui";
import { useExp } from "../contexto";
import { formatarCpf } from "../lib/cpf";
import { IconeSvg } from "../drive/icones";
import { ModoValidacaoErro, pedirLiberarTodos, useModoValidacaoAmigo, type ResultadoLiberarTodos } from "../expedamigo/servidor";
import { montarLinkWhatsapp, montarMensagemOnboarding } from "../expedamigo/acessoAmigo";

export function LiberarTodos({ expedicaoId }: { expedicaoId: string }) {
  const { avisar } = useExp();
  const validacao = useModoValidacaoAmigo();
  const [confirmar, setConfirmar] = useState(false);
  const [indo, setIndo] = useState(false);
  const [r, setR] = useState<ResultadoLiberarTodos | null>(null);

  async function liberar() {
    setIndo(true);
    try {
      const res = await pedirLiberarTodos(expedicaoId);
      setR(res);
      avisar(`ExpedAmigo liberado para ${res.total} passageiro(s)`);
    } catch (e) {
      avisar(e instanceof ModoValidacaoErro ? e.message : e instanceof Error ? e.message : "Não foi possível liberar", "erro");
    } finally { setIndo(false); setConfirmar(false); }
  }
  const mensagem = (l: ResultadoLiberarTodos["links"][number]) => montarMensagemOnboarding(l.nome, r?.expedicao, l.link);
  function copiarLista() {
    if (!r) return;
    const txt = r.links.map((l) => `${l.nome} — CPF ${formatarCpf(l.cpf)} — ${l.link}`).join("\n");
    navigator.clipboard.writeText(txt).then(() => avisar("Lista copiada")).catch(() => avisar("Não foi possível copiar", "erro"));
  }
  function copiarMensagem(l: ResultadoLiberarTodos["links"][number]) {
    navigator.clipboard.writeText(mensagem(l)).then(() => avisar("Mensagem copiada")).catch(() => avisar("Não foi possível copiar", "erro"));
  }

  return (
    <section className="rounded-2xl p-4" style={{ border: "1px solid #FCD34D", background: "rgba(254, 243, 199, .35)" }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: "#FEF3C7", color: "#92400E" }}><IconeSvg nome="chave" /></span>
          <div>
            <h3 className="text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>Liberar portal para todos</h3>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--ink3)" }}>
              Libera o ExpedAmigo de todos os passageiros desta expedição (menos os cancelados) e gera o link de acesso de quem ainda não criou senha. Ninguém recebe nada automático.
            </p>
            {validacao && <p className="mt-1 text-[12px] font-semibold" style={{ color: "var(--warn-ink)" }}>Em validação: libere pelo sistema atual até a virada.</p>}
          </div>
        </div>
        {!confirmar ? (
          <Botao variante="primario" onClick={() => setConfirmar(true)} disabled={indo || validacao !== false}><IconeSvg nome="chave" /> Liberar para todos</Botao>
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
              {r.links.length > 0 && <> · {r.links.length} com link de acesso</>}
              {r.sem_cpf > 0 && <> · {r.sem_cpf} sem CPF (sem link)</>}
            </p>
            {r.links.length > 0 && <Botao onClick={copiarLista}><IconeSvg nome="copiar" /> Copiar lista</Botao>}
          </div>
          {r.links.length > 0 && (
            <div className="mt-2 max-h-72 overflow-auto rounded-lg border" style={{ borderColor: "var(--line)" }}>
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0" style={{ background: "var(--card2)" }}>
                  <tr>{["Passageiro", "CPF", "Link", ""].map((h) => <th key={h} className="px-2 py-1.5 text-left text-[10.5px] uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {r.links.map((l) => {
                    const wa = montarLinkWhatsapp(l.telefone, mensagem(l));
                    return (
                      <tr key={l.cpf} className="border-t" style={{ borderColor: "var(--line)" }}>
                        <td className="px-2 py-1">{l.nome}</td>
                        <td className="px-2 py-1 font-mono">{formatarCpf(l.cpf)}</td>
                        <td className="px-2 py-1 font-mono text-[11.5px] break-all">{l.link}</td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {wa && <a className="underline mr-2" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
                          <button type="button" className="underline" onClick={() => copiarMensagem(l)}>Copiar mensagem</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-[11px]" style={{ color: "var(--ink3)" }}>Cada pessoa abre o link e cria a própria senha. O link vale 30 dias.</p>
        </div>
      )}
    </section>
  );
}
