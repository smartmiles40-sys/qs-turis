// src/expedicoes/lista/pacotes/PacotesPersonalizados.tsx
// -----------------------------------------------------------------------------
// PACOTES (Bruno, 29/10): "a parte dos pacotes tem que ficar parecida com a do
// Relacionamento — o operacional deve garantir e ter ciência de TODOS os pacotes
// personalizados; todos compartilhando a mesma experiência e informações".
//
// Antes, Operações só via os 4 pacotes cadastrados como expedição; os ~120
// pacotes personalizados vendidos (Bitrix → rel_viagens, serviço "pacote") só
// existiam no Relacionamento. Agora a tela lê a MESMA fonte do Rel (view
// rel_viagens_v; Ops já lê pela policy rel_viagens_ops_ler) e abre a MESMA ficha
// da viagem (rel/viagens/ViagemPage). Quem edita continua sendo o Relacionamento
// (o banco só deixa ele); Operações vê tudo.
//
// Layout igual ao da Central de Expedições: busca + cartões, separados em
// Em viagem · Próximos (por ano) · Sem data · Já voltaram. Os pacotes cadastrados
// como expedição seguem embaixo (lista antiga, que tem passageiros/rooming).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState, type KeyboardEvent as KE } from "react";
import { SearchInput } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { periodo, quandoEmbarca, type Viagem } from "@/rel/lib/viagens";
import { Carregando, useAoVivo } from "../../ui";
import ExpedicoesLista from "../ExpedicoesLista";
import "../central/central.css";

type Pacote = Pick<Viagem, "id" | "titulo" | "destino" | "data_embarque" | "data_retorno" | "status" | "fase" | "dias_para_embarque"
  | "cliente_nome" | "responsavel_nome" | "passageiros" | "qtd_passageiros" | "tarefas_atrasadas" | "tarefas_pendentes" | "proximo_voo_em">;

const COLUNAS = "id,titulo,destino,data_embarque,data_retorno,status,fase,dias_para_embarque,cliente_nome,responsavel_nome,passageiros,qtd_passageiros,tarefas_atrasadas,tarefas_pendentes,proximo_voo_em";

async function lerPacotes(): Promise<Pacote[]> {
  const { data, error } = await supabase.from("rel_viagens_v").select(COLUNAS)
    .eq("servico", "pacote").neq("status", "arquivada").order("data_embarque", { ascending: true, nullsFirst: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []) as Pacote[];
}

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Abre a ficha da viagem na área em que a pessoa está (#rel/viagem ou #ops/viagem). */
function abrirViagem(id: string) {
  const area = window.location.hash.startsWith("#rel") ? "rel" : "ops";
  window.location.hash = `#${area}/viagem/${encodeURIComponent(id)}`;
}

export default function PacotesPersonalizados() {
  const [lista, setLista] = useState<Pacote[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [verConcluidos, setVerConcluidos] = useState(false);

  const carregar = () => { lerPacotes().then((l) => { setLista(l); setErro(null); }).catch((e) => setErro(e instanceof Error ? e.message : "Não carregou")); };
  useEffect(carregar, []);
  // Venda nova do Bitrix ou mudança feita pelo Relacionamento → atualiza aqui também.
  useAoVivo([{ tabela: "rel_viagens" }], carregar, 500);

  const filtrados = useMemo(() => {
    const q = semAcento(busca.trim());
    if (!q) return lista ?? [];
    return (lista ?? []).filter((p) => semAcento(`${p.titulo} ${p.destino ?? ""} ${p.cliente_nome ?? ""} ${p.responsavel_nome ?? ""}`).includes(q));
  }, [lista, busca]);

  const emViagem = filtrados.filter((p) => p.status === "ativa" && p.fase === "em_viagem");
  const proximos = filtrados.filter((p) => p.status === "ativa" && p.fase === "antes");
  const semData = filtrados.filter((p) => p.status === "ativa" && p.fase === "sem_data");
  const voltaram = filtrados.filter((p) => p.status === "ativa" && p.fase === "concluida").reverse();
  const cancelados = filtrados.filter((p) => p.status === "cancelada");
  const porAno = new Map<string, Pacote[]>();
  for (const p of proximos) { const a = p.data_embarque?.slice(0, 4) ?? "—"; porAno.set(a, [...(porAno.get(a) ?? []), p]); }

  const ativos = (lista ?? []).filter((p) => p.status === "ativa" && p.fase !== "concluida").length;

  return (
    <div className="cx-page">
      <header className="cx-head">
        <div>
          <h1>Pacotes personalizados</h1>
          <p>{lista ? `${ativos} em andamento · ${emViagem.length} em viagem agora` : "…"} · os mesmos do Relacionamento (vendas de pacote do Bitrix)</p>
        </div>
      </header>
      {erro && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{erro}</p>}
      {!lista ? <Carregando /> : (
        <>
          <section className="cx-bar" aria-label="Busca">
            <div className="cx-bar__f">
              <SearchInput placeholder="Buscar por cliente, destino, pacote ou responsável" value={busca}
                onChange={(e) => setBusca(e.target.value)} aria-label="Buscar pacote" autoFocus />
            </div>
          </section>
          <div className="cx-anos">
            <Bloco titulo="Em viagem agora" itens={emViagem} />
            {[...porAno.entries()].map(([a, ps]) => <Bloco key={a} titulo={`Próximos · ${a}`} itens={ps} />)}
            <Bloco titulo="Sem data de embarque" dica="o Relacionamento ainda precisa pôr a data" itens={semData} />
            {voltaram.length > 0 && (
              <section className="cx-ano">
                <h2 className="cx-ano__h">Já voltaram<span className="cx-sec__n">{voltaram.length}</span>
                  <button type="button" className="cx-ano__c" style={{ background: "none", border: 0, cursor: "pointer", textDecoration: "underline" }}
                    onClick={() => setVerConcluidos((v) => !v)}>{verConcluidos ? "esconder" : "mostrar"}</button>
                </h2>
                {verConcluidos && <Cartoes itens={voltaram} />}
              </section>
            )}
            <Bloco titulo="Cancelados" itens={cancelados} />
            {!filtrados.length && <div className="cx-sec cx-vazio">Nenhum pacote com essa busca.</div>}
          </div>
        </>
      )}
      <details className="cx-sec" style={{ padding: "12px 16px" }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Pacotes cadastrados como expedição (com passageiros, rooming e ExpedAmigo)</summary>
        <div style={{ marginTop: 12 }}><ExpedicoesLista tipo="pacote" /></div>
      </details>
    </div>
  );
}

function Bloco({ titulo, dica, itens }: { titulo: string; dica?: string; itens: Pacote[] }) {
  if (!itens.length) return null;
  return (
    <section className="cx-ano" aria-label={titulo}>
      <h2 className="cx-ano__h">{titulo}<span className="cx-sec__n">{itens.length}</span>{dica && <span className="cx-ano__c">{dica}</span>}</h2>
      <Cartoes itens={itens} />
    </section>
  );
}

function Cartoes({ itens }: { itens: Pacote[] }) {
  return <ul className="cx-cards">{itens.map((p) => <Cartao key={p.id} p={p} />)}</ul>;
}

function Cartao({ p }: { p: Pacote }) {
  const tecla = (ev: KE) => { if (ev.key === "Enter") abrirViagem(p.id); };
  const pax = p.passageiros || p.qtd_passageiros || 0;
  const chip = p.fase === "em_viagem" ? { bg: "var(--fase-em_viagem-bg, var(--info-bg))", fg: "var(--fase-em_viagem-fg, var(--info))" }
    : p.fase === "antes" && (p.dias_para_embarque ?? 99) <= 15 ? { bg: "var(--warn-bg)", fg: "var(--warn)" }
    : { bg: "var(--surface-2)", fg: "var(--muted)" };
  return (
    <li className={`cx-card${p.fase === "concluida" || p.status === "cancelada" ? " cx-card--fim" : ""}`} tabIndex={0}
      onClick={() => abrirViagem(p.id)} onKeyDown={tecla} aria-label={`Abrir ${p.titulo}`}>
      <div className="cx-card__nome"><span className="cx-card__t">{p.cliente_nome ?? p.titulo}</span></div>
      <div className="cx-card__meta">
        <span>{p.destino ?? p.titulo}</span>
        {pax > 0 && <span>· {pax} pax</span>}
      </div>
      <div className="cx-card__datas">{periodo(p)}</div>
      <span className="cx-chip" style={{ background: chip.bg, color: chip.fg }}>{p.status === "cancelada" ? "Cancelado" : quandoEmbarca(p)}</span>
      <div className="cx-card__ocl">
        <span>{p.responsavel_nome ? `Rel: ${p.responsavel_nome.split(" ")[0]}` : "sem dono no Rel"}</span>
        <span style={p.tarefas_atrasadas ? { color: "var(--danger)", fontWeight: 600 } : undefined}>
          {p.tarefas_atrasadas ? `${p.tarefas_atrasadas} atrasada${p.tarefas_atrasadas > 1 ? "s" : ""}` : p.tarefas_pendentes ? `${p.tarefas_pendentes} pendente${p.tarefas_pendentes > 1 ? "s" : ""}` : ""}
        </span>
      </div>
    </li>
  );
}
