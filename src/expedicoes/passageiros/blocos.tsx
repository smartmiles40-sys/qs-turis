// src/expedicoes/passageiros/blocos.tsx
// Blocos do passageiro reusados na gaveta e no perfil completo (app antigo:
// PassaporteAnexo.tsx, "Quarto e acompanhante", "Perfil & conexões",
// PasseiosOpcionaisCompra.tsx, ExtensoesCompra.tsx, MudarExpedicao.tsx).
import { useEffect, useRef, useState } from "react";
import { Botao } from "@/rel/ui";
import { useExp } from "../contexto";
import { listarExpedicoes, supabase } from "../lib/banco";
import { conferirAcompanhante } from "../lib/rooming/acompanhante";
import { formatDate } from "../lib/utils";
import type { AlocacaoQuartoRow, ArquivoRow, ExpedicaoRow, PassageiroRow, QuartoRow } from "../lib/database";
import {
  atualizarPassageiro, enviarArquivo, extensoesDoPax, marcarExtensao, marcarPasseio, moverPassageiro, passeiosDoPax,
  type ItemCompra,
} from "./dados";
import { useVerArquivo } from "./pecas";

export function Bloco({ titulo, children, dica }: { titulo: string; children: React.ReactNode; dica?: string }) {
  return (
    <section className="rounded-xl p-3.5" style={{ border: "1px solid var(--line)" }}>
      <h4 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>{titulo}</h4>
      {dica && <p className="text-[11.5px] mt-0.5" style={{ color: "var(--ink3)" }}>{dica}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Passaporte: 1 por pessoa (passageiros.passaporte_arquivo_id, propaga entre as reservas). */
export function PassaporteAnexo({ exp, pax, arquivos, onMudou }: { exp: ExpedicaoRow; pax: PassageiroRow; arquivos: ArquivoRow[]; onMudou: () => void }) {
  const { avisar, somenteLeitura } = useExp();
  const { ver, visor } = useVerArquivo();
  const input = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const arq = pax.passaporte_arquivo_id ? arquivos.find((a) => a.id === pax.passaporte_arquivo_id) : null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="font-semibold" style={{ color: "var(--ink)" }}>Passaporte:</span>
      {pax.passaporte_arquivo_id ? (
        <>
          <span style={{ color: "#166534" }}>✓ Anexado</span>
          {arq && <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => void ver(arq)}>Ver</button>}
          {!somenteLeitura && <button style={{ color: "var(--err-ink)" }} onClick={async () => {
            try { await atualizarPassageiro(pax.id, { passaporte_arquivo_id: null }); onMudou(); } catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); }
          }}>Remover</button>}
        </>
      ) : somenteLeitura ? <span style={{ color: "var(--ink3)" }}>não anexado</span> : (
        <>
          <input ref={input} type="file" accept="image/*,application/pdf" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setEnviando(true);
            try {
              const a = await enviarArquivo(f, { expedicaoId: exp.id, passageiroId: pax.id, categoria: "Documentos pessoais", descricao: "Passaporte — prontidão" });
              await atualizarPassageiro(pax.id, { passaporte_arquivo_id: a.id });
              avisar("Passaporte anexado — disponível em todas as expedições do passageiro.");
              onMudou();
            } catch (er) { avisar(er instanceof Error ? er.message : "Erro ao anexar", "erro"); }
            finally { setEnviando(false); e.target.value = ""; }
          }} />
          <Botao disabled={enviando} onClick={() => input.current?.click()}>{enviando ? "Enviando…" : "Anexar passaporte"}</Botao>
        </>
      )}
      {visor}
    </div>
  );
}

export function QuartoAcompanhante({ pax, quartos, alocacoes, todos }: { pax: PassageiroRow; quartos: QuartoRow[]; alocacoes: AlocacaoQuartoRow[]; todos: PassageiroRow[] }) {
  const meusQuartos = alocacoes.filter((a) => a.passageiro_id === pax.id).map((a) => quartos.find((q) => q.id === a.quarto_id)).filter((q): q is QuartoRow => !!q);
  const ids = new Set(meusQuartos.map((q) => q.id));
  const companheiros = [...new Set(alocacoes.filter((a) => ids.has(a.quarto_id) && a.passageiro_id !== pax.id)
    .map((a) => todos.find((p) => p.id === a.passageiro_id)?.nome_completo).filter((n): n is string => !!n))];
  const conf = meusQuartos.length ? conferirAcompanhante(pax.acompanhante_nome, companheiros) : "sem_indicacao";
  return (
    <div className="text-[13px] space-y-2" style={{ color: "var(--ink2)" }}>
      <div>
        <p className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Alocado no Rooming</p>
        {meusQuartos.length ? (
          <>
            <ul>{meusQuartos.map((q) => <li key={q.id}>{q.hotel_cidade || "Hotel"} · Quarto {q.numero} ({q.tipo})</li>)}</ul>
            <p>{companheiros.length ? `Divide com: ${companheiros.join(", ")}` : "Sozinho no quarto"}</p>
          </>
        ) : <p>Ainda não alocado em nenhum quarto (aba Rooming).</p>}
      </div>
      <div>
        <p className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Indicado na inscrição</p>
        {pax.acompanhante_nome ? (
          <>
            <p>Acompanhante(s): {pax.acompanhante_nome}</p>
            {pax.acompanhante_vinculo && <p>Vínculo: {pax.acompanhante_vinculo}</p>}
            {pax.acompanhante_divide_quarto && <p>Dividir quarto/cama: {pax.acompanhante_divide_quarto}</p>}
            {pax.acompanhante_dividir_com && <p>Prefere dividir com: {pax.acompanhante_dividir_com}</p>}
          </>
        ) : <p>🧍 Viaja sozinho — não indicou acompanhante</p>}
        {conf === "bate" && <p style={{ color: "#166534" }}>✓ Bate — está no mesmo quarto que o indicado.</p>}
        {conf === "nao_bate" && <p style={{ color: "#C2410C" }}>⚠ Não bate — o acompanhante indicado não está neste quarto.</p>}
      </div>
    </div>
  );
}

export function PerfilConexoes({ pax, fotoUrl }: { pax: PassageiroRow; fotoUrl?: string | null }) {
  const pv = pax.perfil_viajante ?? {};
  const itens: [string, string | undefined][] = [
    ["Profissão", pv.profissao], ["Como se descreve em grupo", pv.descricao_grupo], ["O que mais te anima", pv.anima_expedicao],
    ["Significado da expedição", pv.significado], ["Instagram", pv.instagram], ["Camiseta", pv.camiseta], ["Música preferida", pv.musica],
  ];
  const preenchidos = itens.filter(([, v]) => v && v.trim());
  if (!preenchidos.length && !fotoUrl) return null;
  return (
    <Bloco titulo="Perfil & conexões">
      <div className="flex gap-3">
        {fotoUrl && <img src={fotoUrl} alt="" className="w-24 h-24 rounded-xl object-cover flex-shrink-0" />}
        <dl className="text-[13px] space-y-1">
          {preenchidos.map(([r, v]) => <div key={r}><dt className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{r}</dt><dd style={{ color: "var(--ink)" }}>{v}</dd></div>)}
        </dl>
      </div>
    </Bloco>
  );
}

function ListaCompras({ titulo, dica, carregar, marcar, rotuloMarcado }: {
  titulo: string; dica: string; carregar: () => Promise<ItemCompra[]>; marcar: (id: string, v: boolean) => Promise<void>; rotuloMarcado: string;
}) {
  const { somenteLeitura, avisar } = useExp();
  const [itens, setItens] = useState<ItemCompra[] | null>(null);
  useEffect(() => { carregar().then(setItens).catch(() => setItens([])); }, [carregar]);
  if (!itens || itens.length === 0) return null;
  return (
    <Bloco titulo={titulo} dica={dica}>
      <ul className="space-y-1.5">
        {itens.map((i) => (
          <li key={i.id}>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5" checked={i.marcado} disabled={somenteLeitura} onChange={async (e) => {
                const v = e.target.checked;
                setItens((l) => l!.map((x) => (x.id === i.id ? { ...x, marcado: v } : x)));
                try { await marcar(i.id, v); } catch (er) {
                  setItens((l) => l!.map((x) => (x.id === i.id ? { ...x, marcado: !v } : x)));
                  avisar(er instanceof Error ? er.message : "Erro", "erro");
                }
              }} />
              <span className="flex-1">
                <span style={{ color: "var(--ink)" }}>{i.titulo}</span>
                {i.detalhe && <span className="block text-[11.5px]" style={{ color: "var(--ink3)" }}>{i.detalhe}</span>}
              </span>
              {i.marcado && <span className="text-[11.5px] font-semibold" style={{ color: "#166534" }}>{rotuloMarcado} ✓</span>}
            </label>
          </li>
        ))}
      </ul>
    </Bloco>
  );
}

export function PasseiosEExtensoes({ expId, paxId }: { expId: string; paxId: string }) {
  const [cargaP] = useState(() => () => passeiosDoPax(expId, paxId));
  const [cargaE] = useState(() => () => extensoesDoPax(expId, paxId));
  return (
    <>
      <ListaCompras titulo="✨ Passeios opcionais" rotuloMarcado="comprou" carregar={cargaP} marcar={(id, v) => marcarPasseio(paxId, id, v)}
        dica='Marque o que o passageiro comprou. O passeio marcado aparece "confirmado" no portal dele (no lugar do dia livre).' />
      <ListaCompras titulo="Extensões da viagem" rotuloMarcado="contratou" carregar={cargaE} marcar={(id, v) => marcarExtensao(paxId, id, v)}
        dica="Marque as extensões que este passageiro contratou. Os dias e voos da extensão só aparecem no portal de quem contratou." />
    </>
  );
}

/** "Mudar de expedição" — corrige a expedição sem perder os dados (leva arquivos, voos próprios e compras equivalentes). */
export function MudarExpedicao({ exp, pax, onMovido }: { exp: ExpedicaoRow; pax: PassageiroRow; onMovido: (novaId: string) => void }) {
  const { avisar, somenteLeitura } = useExp();
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<ExpedicaoRow[]>([]);
  const [alvo, setAlvo] = useState("");
  const [indo, setIndo] = useState(false);
  if (somenteLeitura) return null;
  if (!aberto) {
    return <button className="text-[12.5px] underline" style={{ color: "var(--ink2)" }} title="Corrigir a expedição sem perder os dados"
      onClick={async () => {
        setAberto(true);
        try { setLista((await listarExpedicoes(exp.tipo === "pacote" ? "pacote" : "expedicao")).filter((e) => e.id !== exp.id).sort((a, b) => a.data_embarque.localeCompare(b.data_embarque))); }
        catch { setLista([]); }
      }}>Mudar de expedição</button>;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="rel-input" style={{ maxWidth: 260 }} value={alvo} onChange={(e) => setAlvo(e.target.value)} aria-label="Mover para">
        <option value="">Mover para…</option>
        {lista.map((e) => <option key={e.id} value={e.id}>{e.nome} · {formatDate(e.data_embarque)}</option>)}
      </select>
      <Botao variante="primario" disabled={!alvo || indo} onClick={async () => {
        setIndo(true);
        try { await moverPassageiro(pax.id, alvo); avisar("Passageiro movido de expedição — dados preservados"); onMovido(alvo); }
        catch (e) { avisar(e instanceof Error ? e.message : "Erro", "erro"); } finally { setIndo(false); }
      }}>{indo ? "Movendo…" : "Mover"}</Botao>
      <Botao variante="fantasma" onClick={() => setAberto(false)}>Cancelar</Botao>
    </div>
  );
}

/** Liberação no portal do viajante (só admin). A senha fica na tela "Acessos ExpedAmigo". */
export function LiberarExpedAmigo({ pax, onMudou }: { pax: PassageiroRow; onMudou: () => void }) {
  const { avisar } = useExp();
  const [lib, setLib] = useState(Boolean(pax.liberado_expedamigo));
  return (
    <Bloco titulo="ExpedAmigo (portal do viajante)" dica="Login e senha do viajante ficam na tela Acessos ExpedAmigo.">
      <div className="flex items-center gap-3 text-[13px]">
        <span className="flex-1" style={{ color: lib ? "#166534" : "var(--ink2)" }}>{lib ? "Liberado — aparece no portal do viajante" : "Não liberado — oculto no portal"}</span>
        <Botao onClick={async () => {
          const v = !lib; setLib(v);
          try { await atualizarLiberado(pax.id, v); onMudou(); }
          catch (e) { setLib(!v); avisar(e instanceof Error ? e.message : "Erro", "erro"); }
        }}>{lib ? "Bloquear" : "Liberar ExpedAmigo"}</Botao>
      </div>
    </Bloco>
  );
}

async function atualizarLiberado(id: string, v: boolean) {
  const { error } = await supabase.from("passageiros").update({ liberado_expedamigo: v }).eq("id", id);
  if (error) throw new Error(error.message);
}
