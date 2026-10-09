// src/rel/viagens/AlertasPage.tsx
// -----------------------------------------------------------------------------
// ALERTAS — o que precisa de atenção, numa lista só (view rel_alertas, 0103):
// passaporte que vence antes de 6 meses da volta, expedição sem passaporte na
// ficha, tarefa da jornada atrasada, link de documentos parado, chamado
// vencido, aniversário chegando e embarque na semana.
//
// Não guarda nada: a lista é recalculada a cada abertura. Resolveu a causa
// (atualizou o passaporte, fez a tarefa), o alerta some sozinho.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { dataBR, listarAlertas, type Alerta } from "../lib/viagens";
import { Aviso, Etiqueta, Vazio } from "../ui";

const TIPOS: Record<Alerta["tipo"], { rotulo: string; dica: string }> = {
  passaporte: { rotulo: "Passaporte vencendo", dica: "Vence antes de 6 meses depois da volta." },
  sem_passaporte: { rotulo: "Sem passaporte", dica: "Expedição em até 6 meses e nenhum passaporte na ficha." },
  tarefa: { rotulo: "Tarefas atrasadas", dica: "Da jornada do cliente." },
  documentos: { rotulo: "Documentos parados", dica: "Link mandado há mais de 7 dias e nada recebido." },
  chamado: { rotulo: "Chamados vencidos", dica: "Passaram do prazo e não foram resolvidos." },
  embarque: { rotulo: "Embarques na semana", dica: "Conferir se está tudo pronto." },
  aniversario: { rotulo: "Aniversários", dica: "Nos próximos 7 dias — boa hora pra mandar uma mensagem." },
};
const ORDEM: Alerta["tipo"][] = ["passaporte", "sem_passaporte", "chamado", "tarefa", "documentos", "embarque", "aniversario"];
const TOM = { alta: "erro", media: "aviso", baixa: "neutro" } as const;
const ROTULO_GRAV = { alta: "urgente", media: "atenção", baixa: "lembrete" } as const;

export default function AlertasPage({ onAbrirViagem, onAbrirCliente }: { onAbrirViagem: (id: string) => void; onAbrirCliente: (id: string) => void }) {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tipo, setTipo] = useState<Alerta["tipo"] | "todos">("todos");

  useEffect(() => {
    listarAlertas().then(setAlertas).catch((e) => { setErro(e instanceof Error ? e.message : "Não carregou."); setAlertas([]); });
  }, []);

  const porTipo = useMemo(() => {
    const m = new Map<Alerta["tipo"], Alerta[]>();
    for (const a of alertas ?? []) m.set(a.tipo, [...(m.get(a.tipo) ?? []), a]);
    return m;
  }, [alertas]);
  const urgentes = (alertas ?? []).filter((a) => a.gravidade === "alta").length;

  function abrir(a: Alerta) {
    if (a.viagem_id && a.tipo !== "aniversario") onAbrirViagem(a.viagem_id);
    else if (a.cliente_id) onAbrirCliente(a.cliente_id);
  }

  const tiposVisiveis = ORDEM.filter((t) => (tipo === "todos" || t === tipo) && porTipo.get(t)?.length);

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Alertas</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
          {alertas === null ? "Calculando…" : alertas.length === 0 ? "Nada pedindo atenção agora." : `${alertas.length} ite${alertas.length > 1 ? "ns" : "m"}${urgentes ? ` · ${urgentes} urgente${urgentes > 1 ? "s" : ""}` : ""}. Resolveu a causa, o alerta some sozinho.`}
        </p>
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {alertas && alertas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setTipo("todos")} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold"
            style={tipo === "todos" ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)", border: "1px solid var(--line)" }}>
            Todos ({alertas.length})
          </button>
          {ORDEM.filter((t) => porTipo.get(t)?.length).map((t) => (
            <button key={t} onClick={() => setTipo(t)} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold"
              style={tipo === t ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)", border: "1px solid var(--line)" }}>
              {TIPOS[t].rotulo} ({porTipo.get(t)!.length})
            </button>
          ))}
        </div>
      )}

      {alertas && alertas.length === 0 && (
        <div className="rel-card"><Vazio titulo="Tudo certo por aqui" texto="Passaportes, tarefas, documentos e chamados em dia." /></div>
      )}

      {tiposVisiveis.map((t) => (
        <section key={t} className="rel-card overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{TIPOS[t].rotulo}</h2>
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>{TIPOS[t].dica}</p>
          </div>
          <ul>
            {porTipo.get(t)!.map((a, i) => (
              <li key={`${t}-${i}`} style={{ borderTop: "1px solid var(--line2)" }}>
                <button onClick={() => abrir(a)} className="rel-linha w-full text-left px-4 py-2.5 flex items-start gap-3">
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px]" style={{ color: "var(--ink)" }}>{a.titulo}</span>
                    {a.detalhe && <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>{a.detalhe}</span>}
                  </span>
                  {a.data && <span className="text-[12px] whitespace-nowrap" style={{ color: "var(--ink3)" }}>{dataBR(a.data)}</span>}
                  <Etiqueta tom={TOM[a.gravidade]}>{ROTULO_GRAV[a.gravidade]}</Etiqueta>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
