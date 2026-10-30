// src/rel/clientes/ficha/ReceitasAEnviar.tsx
// -----------------------------------------------------------------------------
// O ALERTA operacional das receitas (0223), sem tela própria (Bruno, 30/10: "as
// Receitas têm que ficar vinculadas SOMENTE dentro da ficha do cliente").
// Mostra, nas Inscrições, só as receitas que já entraram na janela de 20 dias e
// não foram enviadas. Cada linha leva pra FICHA da pessoa, aba Saúde — lá se marca
// "enviada" / "não precisa" e fica o histórico.
// Sem a 0223 ou sem nada pra enviar: não desenha nada.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { listarReceitas, naJanela, type Receita } from "@/expedicoes/lib/receitas";
import { dataSP } from "@/expedicoes/lib/fase.ts";
import { formatDate } from "@/expedicoes/lib/utils";
import { useAoVivo } from "@/expedicoes/ui";

/** Endereço da ficha na área atual (#rel/cliente/<id> ou #ops/ficha/<id>), já na aba Saúde. */
export function hashDaFicha(clienteId: string, aba = "saude"): string {
  const rel = window.location.hash.startsWith("#rel");
  return `${rel ? `#rel/cliente/${clienteId}` : `#ops/ficha/${clienteId}`}?aba=${aba}`;
}

export default function ReceitasAEnviar() {
  const [lista, setLista] = useState<Receita[]>([]);
  const carregar = useCallback(async () => {
    try { setLista((await listarReceitas(dataSP(new Date()))).filter((r) => naJanela(r) && !r.enviadaEm)); }
    catch { setLista([]); } // sem a 0223: o bloco some
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "passageiros" }], () => { void carregar(); }, 800);

  if (!lista.length) return null;
  const hoje = dataSP(new Date());
  return (
    <section aria-label="Receitas a enviar" className="rel-card p-3.5 space-y-2" style={{ borderColor: "var(--warn-ink)" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-[14px] font-bold" style={{ color: "var(--ink)", margin: 0 }}>Receitas a enviar ({lista.length})</h2>
        <span className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          faltam 20 dias ou menos pro embarque · marque "enviada" na ficha da pessoa (aba Saúde)
        </span>
      </div>
      <ul className="space-y-1.5" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {lista.map((r) => {
          const atrasada = !!r.limite && r.limite < hoje;
          const meds = [r.saude.medicamento_diario_qual, r.saude.problema_saude_qual].filter(Boolean).join(" · ");
          return (
            <li key={r.passageiroId} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-semibold" style={{ color: "var(--ink)" }}>{r.nome}</span>
              <span style={{ color: "var(--ink3)" }}>
                {r.exp.nome}{r.exp.data_embarque ? ` · embarque ${formatDate(r.exp.data_embarque)}` : ""}
                {r.limite ? ` · ${atrasada ? "prazo passou em" : "enviar até"} ${formatDate(r.limite)}` : ""}
                {meds ? ` · ${meds}` : ""}
              </span>
              <span className="flex-1" />
              {r.clienteId
                ? <a className="font-semibold underline" style={{ color: "var(--rel-ink)" }} href={hashDaFicha(r.clienteId)}>Abrir ficha ›</a>
                : <span style={{ color: "var(--ink3)" }}>passageiro sem ficha — ligue em "Arrumar cadastros"</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
