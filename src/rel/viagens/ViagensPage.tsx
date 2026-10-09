// src/rel/viagens/ViagensPage.tsx
// -----------------------------------------------------------------------------
// VIAGENS (Fase 3). Cada venda do Bitrix ("Em emissão" ou "Venda realizada")
// vira uma viagem aqui sozinha — a sincronização roda a cada 30 minutos, e o
// botão "Sincronizar com o Bitrix" puxa na hora. Também dá pra criar à mão.
//
// "Próximas" vem em ordem de embarque: é a fila de trabalho do pós-venda.
// Agrupar por expedição junta o grupo inteiro (ex.: Japão e China G2).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import {
  FASES, TIPOS_VIAGEM, criarViagem, importarDoBitrix, listarViagens, periodo, quandoEmbarca, sincronizarBitrix,
  type FiltroViagens, type ResultadoSync, type TipoViagem, type Viagem,
} from "../lib/viagens";
import { buscarClientes, type Cliente } from "../lib/clientes";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../ui";
import { TOM_FASE } from "./ViagensDoCliente";

const FILTROS: { id: FiltroViagens; rotulo: string }[] = [
  { id: "proximas", rotulo: "Próximas" },
  { id: "em_viagem", rotulo: "Em viagem" },
  { id: "concluidas", rotulo: "Concluídas" },
  { id: "canceladas", rotulo: "Canceladas" },
  { id: "todas", rotulo: "Todas" },
];

function resumoSync(r: ResultadoSync): string {
  const partes = [`${r.lidos} lido${r.lidos === 1 ? "" : "s"}`];
  if (r.criados) partes.push(`${r.criados} viagem(ns) nova(s)`);
  if (r.atualizados) partes.push(`${r.atualizados} atualizada(s)`);
  if (r.passageiros) partes.push(`${r.passageiros} acompanhante(s)`);
  if (r.cancelados) partes.push(`${r.cancelados} cancelada(s)`);
  if (r.erros) partes.push(`${r.erros} com erro`);
  return partes.join(" · ") + (r.completo ? "." : " — ainda tem mais; clique de novo para continuar.");
}

// ── Nova viagem (manual) ────────────────────────────────────────────────────

function NovaViagem({ aberto, onFechar, onCriada }: { aberto: boolean; onFechar: () => void; onCriada: (id: string) => void }) {
  const [f, setF] = useState({ titulo: "", destino: "", tipo: "pacote" as TipoViagem, data_embarque: "", data_retorno: "", valor: "" });
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<Cliente[]>([]);
  const [dealId, setDealId] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setF({ titulo: "", destino: "", tipo: "pacote", data_embarque: "", data_retorno: "", valor: "" });
    setCliente(null); setBusca(""); setDealId(""); setErro(null);
  }, [aberto]);
  useEffect(() => {
    if (!busca.trim()) { setOpcoes([]); return; }
    const t = setTimeout(() => { buscarClientes(busca, 8).then(setOpcoes).catch(() => setOpcoes([])); }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  async function criar() {
    if (f.titulo.trim().length < 2) { setErro("Dê um nome para a viagem (ex.: destino)."); return; }
    if (f.data_retorno && f.data_embarque && f.data_retorno < f.data_embarque) { setErro("A volta não pode ser antes da ida."); return; }
    setOcupado(true); setErro(null);
    try {
      const id = await criarViagem({
        titulo: f.titulo.trim(), destino: f.destino.trim() || null, tipo: f.tipo,
        data_embarque: f.data_embarque || null, data_retorno: f.data_retorno || null,
        valor: f.valor ? Number(f.valor.replace(/\./g, "").replace(",", ".")) || null : null,
        cliente_id: cliente?.id ?? null, data_venda: new Date().toISOString().slice(0, 10),
      });
      onCriada(id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não criou."); }
    finally { setOcupado(false); }
  }

  async function importar() {
    if (!dealId.replace(/\D/g, "")) { setErro("Digite o número do negócio no Bitrix."); return; }
    setOcupado(true); setErro(null);
    try {
      const r = await importarDoBitrix(dealId);
      if (r.viagemId) onCriada(r.viagemId);
      else setErro("O negócio foi lido, mas não virou viagem (sem contato ou sem dados de venda).");
    } catch (e) { setErro(e instanceof Error ? e.message : "Não importou."); }
    finally { setOcupado(false); }
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Nova viagem"
      onFechar={onFechar}
      largura={600}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" onClick={criar} disabled={ocupado}>{ocupado ? "Salvando…" : "Criar viagem"}</Botao></>}
    >
      <div className="space-y-4">
        <div className="rounded-xl p-3 space-y-2" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
          <p className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Já está no Bitrix? Traga pelo número do negócio:</p>
          <div className="flex gap-2">
            <Entrada value={dealId} onChange={(e) => setDealId(e.target.value)} placeholder="Ex.: 49655" inputMode="numeric" />
            <Botao onClick={importar} disabled={ocupado}>Importar</Botao>
          </div>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Ou crie à mão (venda que não passou pelo Bitrix):</p>
        <Campo rotulo="Nome da viagem *"><Entrada value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} placeholder="Ex.: Lua de mel em Portugal" /></Campo>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Destino"><Entrada value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })} /></Campo>
          <Campo rotulo="Tipo">
            <select className="rel-input" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value as TipoViagem })}>
              {(Object.keys(TIPOS_VIAGEM) as TipoViagem[]).map((t) => <option key={t} value={t}>{TIPOS_VIAGEM[t]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Ida"><Entrada type="date" value={f.data_embarque} onChange={(e) => setF({ ...f, data_embarque: e.target.value })} /></Campo>
          <Campo rotulo="Volta"><Entrada type="date" value={f.data_retorno} onChange={(e) => setF({ ...f, data_retorno: e.target.value })} /></Campo>
          <Campo rotulo="Valor (R$)"><Entrada value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} inputMode="decimal" placeholder="0,00" /></Campo>
        </div>
        <Campo rotulo="Cliente (quem comprou)">
          {cliente ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
              <b>{cliente.nome}</b>
              <button className="underline text-[12px]" style={{ color: "var(--ink3)" }} onClick={() => setCliente(null)}>trocar</button>
            </div>
          ) : (
            <div className="relative">
              <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar ficha por nome, CPF ou telefone" />
              {opcoes.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rel-card shadow-lg overflow-hidden">
                  {opcoes.map((c) => (
                    <button key={c.id} className="rel-linha w-full text-left px-3 py-2 text-[13px]" style={{ color: "var(--ink)" }}
                      onClick={() => { setCliente(c); setBusca(""); setOpcoes([]); }}>
                      {c.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Campo>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── Linha ───────────────────────────────────────────────────────────────────

function Linha({ v, onAbrir, onAbrirCliente }: { v: Viagem; onAbrir: () => void; onAbrirCliente: (id: string) => void }) {
  return (
    <li style={{ borderTop: "1px solid var(--line2)" }}>
      <div className="rel-linha flex items-center gap-3 px-4 py-3 cursor-pointer" onClick={onAbrir}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{v.titulo}</p>
          <p className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>
            {v.cliente_id && v.cliente_nome ? (
              <button className="underline" onClick={(e) => { e.stopPropagation(); onAbrirCliente(v.cliente_id!); }}>{v.cliente_nome}</button>
            ) : "sem cliente"}
            {v.passageiros > 1 ? ` + ${v.passageiros - 1}` : ""} · {periodo(v)} · {quandoEmbarca(v)}
          </p>
        </div>
        <span className="hidden sm:flex items-center gap-1.5 flex-shrink-0">
          {v.tarefas_atrasadas > 0 && <Etiqueta tom="erro">{v.tarefas_atrasadas} atrasada{v.tarefas_atrasadas > 1 ? "s" : ""}</Etiqueta>}
          {v.tarefas_total > 0 && <span className="text-[11px] tabular-nums" style={{ color: "var(--ink3)" }}>{v.tarefas_total - v.tarefas_pendentes}/{v.tarefas_total}</span>}
          <Etiqueta>{TIPOS_VIAGEM[v.tipo]}</Etiqueta>
          <Etiqueta tom={TOM_FASE[v.fase]}>{FASES[v.fase]}</Etiqueta>
        </span>
      </div>
    </li>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function ViagensPage({ onAbrirViagem, onAbrirCliente }: { onAbrirViagem: (id: string) => void; onAbrirCliente: (id: string) => void }) {
  const [filtro, setFiltro] = useState<FiltroViagens>("proximas");
  const [busca, setBusca] = useState("");
  const [lista, setLista] = useState<Viagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [agrupar, setAgrupar] = useState(false);
  const [sync, setSync] = useState<{ ocupado: boolean; msg: string | null; erro: boolean }>({ ocupado: false, msg: null, erro: false });
  const [nova, setNova] = useState(false);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    setLista(null);
    const t = setTimeout(() => {
      listarViagens(filtro, busca)
        .then((l) => { if (vivo) { setLista(l); setErro(null); } })
        .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : "Não carregou."); setLista([]); } });
    }, busca ? 300 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [filtro, busca, versao]);

  async function sincronizar() {
    setSync({ ocupado: true, msg: "Buscando vendas no Bitrix… (pode levar até 1 minuto)", erro: false });
    try {
      const r = await sincronizarBitrix();
      setSync({ ocupado: false, msg: resumoSync(r), erro: false });
      setVersao((x) => x + 1);
    } catch (e) {
      setSync({ ocupado: false, msg: e instanceof Error ? e.message : "Falhou.", erro: true });
    }
  }

  // Agrupado: por expedição (ou "Outras viagens"), na ordem da lista.
  const grupos = useMemo(() => {
    if (!lista || !agrupar) return null;
    const m = new Map<string, Viagem[]>();
    for (const v of lista) {
      const k = v.expedicao || "Outras viagens";
      m.set(k, [...(m.get(k) ?? []), v]);
    }
    return [...m.entries()].sort((a, b) => (a[0] === "Outras viagens" ? 1 : b[0] === "Outras viagens" ? -1 : 0));
  }, [lista, agrupar]);

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Viagens</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Toda venda do Bitrix vira viagem aqui, com a jornada do cliente até a volta.</p>
        </div>
        <div className="flex gap-2">
          <Botao onClick={sincronizar} disabled={sync.ocupado}>{sync.ocupado ? "Sincronizando…" : "Sincronizar com o Bitrix"}</Botao>
          <Botao variante="primario" onClick={() => setNova(true)}>+ Nova viagem</Botao>
        </div>
      </div>

      {sync.msg && <div className="mb-3"><Aviso tom={sync.erro ? "erro" : "ok"}>{sync.msg}</Aviso></div>}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex gap-1 rel-card p-1 overflow-x-auto">
          {FILTROS.map((f) => (
            <button key={f.id} onClick={() => setFiltro(f.id)} className="px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap"
              style={filtro === f.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)" }}>
              {f.rotulo}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={agrupar} onChange={(e) => setAgrupar(e.target.checked)} /> Agrupar por expedição
        </label>
      </div>
      <div className="mb-4">
        <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por viagem, destino, expedição, cliente ou nº do Bitrix" />
      </div>

      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}

      {lista === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="rel-card">
          <Vazio
            titulo={busca ? "Nenhuma viagem encontrada" : "Nenhuma viagem aqui"}
            texto={filtro === "proximas" && !busca ? "Clique em \"Sincronizar com o Bitrix\" para trazer as vendas — depois disso elas chegam sozinhas a cada 30 minutos." : undefined}
          />
        </div>
      ) : grupos ? (
        <div className="space-y-4">
          {grupos.map(([nome, vs]) => (
            <section key={nome} className="rel-card overflow-hidden">
              <h2 className="px-4 py-2.5 text-[13px] font-bold flex justify-between" style={{ color: "var(--ink)", background: "var(--card2)" }}>
                <span>{nome}</span>
                <span style={{ color: "var(--ink3)" }}>{vs.reduce((s, v) => s + (v.passageiros || 1), 0)} passageiro(s)</span>
              </h2>
              <ul>{vs.map((v) => <Linha key={v.id} v={v} onAbrir={() => onAbrirViagem(v.id)} onAbrirCliente={onAbrirCliente} />)}</ul>
            </section>
          ))}
        </div>
      ) : (
        <div className="rel-card overflow-hidden">
          <ul className="-mt-px">{lista.map((v) => <Linha key={v.id} v={v} onAbrir={() => onAbrirViagem(v.id)} onAbrirCliente={onAbrirCliente} />)}</ul>
        </div>
      )}
      {lista && lista.length >= 500 && (
        <p className="text-[12px] mt-2" style={{ color: "var(--ink3)" }}>Mostrando as 500 primeiras — use a busca.</p>
      )}

      <NovaViagem aberto={nova} onFechar={() => setNova(false)} onCriada={(id) => { setNova(false); onAbrirViagem(id); }} />
    </div>
  );
}
