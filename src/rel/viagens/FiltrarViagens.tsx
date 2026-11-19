// src/rel/viagens/FiltrarViagens.tsx
// -----------------------------------------------------------------------------
// Aba FILTRAR das Viagens (Bruno, 19/11: "filtrar todos os serviços, quem tem
// interno e etc… principalmente data"). Um painel de filtros que combinam:
// data (qual data + período), serviço vendido, o que tem no roteiro (voo
// interno, hotel, transfer…), situação, dono e busca. O resultado é uma tabela
// que abre a viagem no clique e baixa em CSV. O filtro fica guardado no
// navegador. Regras em src/rel/lib/filtroViagens.ts (com teste).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  CAMPOS_DATA, FILTRO_PADRAO, PERIODOS, SERVICOS_FILTRO, SITUACOES, TEM_NO_ROTEIRO, intervaloDoPeriodo, lerFiltro, quantosAtivos,
  type FiltroAvancado, type ServicoFiltro, type TemNoRoteiro,
} from "../lib/filtroViagens";
import { filtrarViagens, type ResultadoFiltro } from "../lib/filtroViagensDados";
import { FASES, SERVICOS, TIPOS_VIAGEM, dataBR, hojeSP, listarEquipeRel, proximoVoo, type Viagem } from "../lib/viagens";
import { Aviso, Botao, Entrada, Etiqueta, Vazio } from "../ui";
import { TOM_FASE } from "./ViagensDoCliente";
import { ProximoVooCurto } from "./ProximoVoo";

const CHAVE = "rel_viagens_filtro";

function Chip({ ativo, onClick, children, title }: { ativo: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={ativo} title={title}
      className="rel-linha px-3 py-1.5 rounded-lg text-[12px] font-semibold whitespace-nowrap"
      style={ativo ? { background: "var(--rel-soft)", color: "var(--rel-ink)", boxShadow: "inset 0 0 0 1px var(--rel)" } : { color: "var(--ink2)", boxShadow: "inset 0 0 0 1px var(--line)" }}>
      {children}
    </button>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3 py-2.5" style={{ borderTop: "1px solid var(--line2)" }}>
      <span className="text-[11px] font-bold uppercase tracking-wide sm:w-[120px] sm:pt-2 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</span>
      <div className="flex flex-wrap items-center gap-1.5 min-w-0">{children}</div>
    </div>
  );
}

const alternar = <T,>(l: T[], x: T) => (l.includes(x) ? l.filter((y) => y !== x) : [...l, x]);
const servicoDe = (v: Viagem) => (v.servico ? SERVICOS[v.servico] : v.acompanhamento === "classificar" ? "Sem classificação" : TIPOS_VIAGEM[v.tipo]);

function baixarCsv(lista: Viagem[]) {
  const cab = ["Cliente", "Viagem", "Serviço", "Ida", "Volta", "Próximo voo", "Voos internos", "Voos", "Passageiros", "Dono", "Situação", "Venda", "Nº Bitrix"];
  const esc = (x: unknown) => { const s = x == null ? "" : String(x); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const linhas = lista.map((v) => [
    v.cliente_nome, v.titulo, servicoDe(v), dataBR(v.data_embarque), dataBR(v.data_retorno), v.proximo_voo_em ? proximoVoo(v).quando : "",
    v.voos_internos ?? 0, v.voos_total ?? 0, v.passageiros, v.responsavel_nome ?? "", FASES[v.fase], dataBR(v.data_venda), v.bitrix_deal_id ?? "",
  ].map(esc).join(";"));
  // BOM: o Excel abre com acento certo; ";" é o separador do Excel em pt-BR
  const blob = new Blob(["﻿" + [cab.join(";"), ...linhas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `viagens-${hojeSP()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function FiltrarViagens({ onAbrirViagem, onAbrirCliente }: { onAbrirViagem: (id: string) => void; onAbrirCliente: (id: string) => void }) {
  const { currentUser } = useQsAuth();
  const hoje = hojeSP();
  const [f, setF] = useState<FiltroAvancado>(() => { try { return lerFiltro(localStorage.getItem(CHAVE)); } catch { return FILTRO_PADRAO; } });
  const mudar = (p: Partial<FiltroAvancado>) => setF((x) => ({ ...x, ...p }));
  useEffect(() => { try { localStorage.setItem(CHAVE, JSON.stringify({ ...f, busca: "" })); } catch { /* sem localStorage */ } }, [f]);

  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => { listarEquipeRel().then(setEquipe).catch(() => setEquipe([])); }, []);

  const intervalo = intervaloDoPeriodo(f, hoje);
  const datasInvertidas = !!(intervalo.de && intervalo.ate && intervalo.ate < intervalo.de);

  const [res, setRes] = useState<ResultadoFiltro | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (datasInvertidas) return;
    let vivo = true;
    setRes(null);
    const t = setTimeout(() => {
      filtrarViagens(f, hoje, currentUser?.id ?? "")
        .then((r) => { if (vivo) { setRes(r); setErro(null); } })
        .catch((e) => { if (vivo) { setErro(e instanceof Error ? e.message : "Não carregou."); setRes({ lista: [], total: 0, cortado: false }); } });
    }, f.busca ? 300 : 0);
    return () => { vivo = false; clearTimeout(t); };
  }, [f, hoje, currentUser?.id, datasInvertidas]);

  const pessoas = useMemo(() => (res ? res.lista.reduce((s, v) => s + Math.max(v.passageiros || 1, 1), 0) : 0), [res]);
  const ativos = quantosAtivos(f);
  const textoPeriodo = intervalo.de || intervalo.ate
    ? `${intervalo.de ? dataBR(intervalo.de) : "…"} a ${intervalo.ate ? dataBR(intervalo.ate) : "…"}`
    : "qualquer data";

  return (
    <div className="max-w-6xl mx-auto">
      <section className="rel-card px-4 pb-1 mb-4" aria-label="Filtros">
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <h2 className="text-[13px] font-bold" style={{ color: "var(--ink)" }}>Filtrar viagens</h2>
          {ativos > 0 && <button className="underline text-[12px]" style={{ color: "var(--ink3)" }} onClick={() => setF(FILTRO_PADRAO)}>Limpar filtros</button>}
        </div>

        <Linha rotulo="Data">
          <select className="rel-input" style={{ width: "auto" }} value={f.campo} aria-label="Qual data"
            onChange={(e) => mudar({ campo: e.target.value as FiltroAvancado["campo"] })}>
            {CAMPOS_DATA.map((c) => <option key={c.id} value={c.id} title={c.dica}>{c.rotulo}</option>)}
          </select>
          {PERIODOS.map((p) => (
            <Chip key={p.id} ativo={f.periodo === p.id} onClick={() => mudar(p.id === "livre" && !f.de ? { periodo: p.id, de: intervalo.de ?? hoje, ate: intervalo.ate ?? hoje } : { periodo: p.id })}>{p.rotulo}</Chip>
          ))}
          {f.periodo === "livre" && (
            <span className="flex flex-wrap items-center gap-1.5 text-[12px]" style={{ color: "var(--ink2)" }}>
              de <input type="date" className="rel-input" style={{ width: 150 }} value={f.de} onChange={(e) => mudar({ de: e.target.value })} aria-label="De" />
              até <input type="date" className="rel-input" style={{ width: 150 }} value={f.ate} onChange={(e) => mudar({ ate: e.target.value })} aria-label="Até" />
            </span>
          )}
          <span className="text-[11.5px] w-full" style={{ color: "var(--ink3)" }}>
            {CAMPOS_DATA.find((c) => c.id === f.campo)?.dica} · {textoPeriodo}
          </span>
        </Linha>

        <Linha rotulo="Serviço">
          <Chip ativo={!f.servicos.length} onClick={() => mudar({ servicos: [] })}>Todos</Chip>
          {SERVICOS_FILTRO.map((s) => (
            <Chip key={s.id} ativo={f.servicos.includes(s.id)} onClick={() => mudar({ servicos: alternar<ServicoFiltro>(f.servicos, s.id) })}>{s.rotulo}</Chip>
          ))}
        </Linha>

        <Linha rotulo="Tem no roteiro">
          <Chip ativo={!f.tem.length} onClick={() => mudar({ tem: [] })}>Tanto faz</Chip>
          {TEM_NO_ROTEIRO.map((t) => (
            <Chip key={t.id} ativo={f.tem.includes(t.id)} title={t.dica}
              onClick={() => {
                let tem = alternar<TemNoRoteiro>(f.tem, t.id);
                // "nenhum voo" não combina com "voo interno"/"algum voo"
                if (t.id === "sem_voo" && tem.includes("sem_voo")) tem = tem.filter((x) => x !== "voo" && x !== "voo_interno");
                if ((t.id === "voo" || t.id === "voo_interno") && tem.includes(t.id)) tem = tem.filter((x) => x !== "sem_voo");
                mudar({ tem });
              }}>{t.rotulo}</Chip>
          ))}
          {f.tem.length > 1 && <span className="text-[11.5px]" style={{ color: "var(--ink3)" }}>precisa ter todos os marcados</span>}
        </Linha>

        <Linha rotulo="Situação · dono">
          <select className="rel-input" style={{ width: "auto" }} value={f.situacao} aria-label="Situação"
            onChange={(e) => mudar({ situacao: e.target.value as FiltroAvancado["situacao"] })}>
            {SITUACOES.map((s) => <option key={s.id} value={s.id}>{s.rotulo}</option>)}
          </select>
          <select className="rel-input" style={{ width: "auto" }} value={f.dono} aria-label="Quem cuida" onChange={(e) => mudar({ dono: e.target.value })}>
            <option value="todos">Qualquer dono</option>
            <option value="minhas">As minhas</option>
            <option value="sem_dono">Sem dono</option>
            {equipe.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Linha>

        <Linha rotulo="Buscar">
          <div className="w-full sm:w-[420px]">
            <Entrada value={f.busca} onChange={(e) => mudar({ busca: e.target.value })} aria-label="Buscar viagens" placeholder="Viagem, destino, expedição, cliente ou nº do Bitrix" />
          </div>
        </Linha>
      </section>

      {datasInvertidas && <div className="mb-3"><Aviso tom="erro">O "até" está antes do "de".</Aviso></div>}
      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}

      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }} aria-live="polite">
          {res === null ? "Carregando…" : <>
            <b className="tabular-nums" style={{ color: "var(--ink)" }}>{res.total}</b> viage{res.total === 1 ? "m" : "ns"}
            {res.lista.length > 0 && <> · <span className="tabular-nums">{pessoas}</span> pessoa{pessoas === 1 ? "" : "s"}{res.cortado ? " (nas 500 primeiras)" : ""}</>}
          </>}
        </p>
        {res && res.lista.length > 0 && <Botao onClick={() => baixarCsv(res.lista)}>Baixar planilha (CSV)</Botao>}
      </div>
      {res?.cortado && <div className="mb-3"><Aviso tom="aviso">Mostrando as 500 primeiras de {res.total}. Encurte o período ou marque mais filtros.</Aviso></div>}

      {res && res.lista.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhuma viagem com esses filtros" texto="Troque o período, tire algum filtro ou clique em Limpar filtros." /></div>
      ) : res && (
        <div className="rel-card overflow-hidden">
          <div className="hidden lg:grid gap-3 px-4 py-2 text-[11px] font-bold uppercase tracking-wide" style={{ gridTemplateColumns: "minmax(0,2.2fr) 1fr 0.9fr 0.9fr 1.3fr 0.6fr 1fr 1fr", color: "var(--ink3)" }}>
            <span>Cliente · viagem</span><span>Serviço</span><span>Ida</span><span>Volta</span><span>Próximo voo</span><span>Internos</span><span>Dono</span><span>Situação</span>
          </div>
          <ul>
            {res.lista.map((v) => (
              <li key={v.id} style={{ borderTop: "1px solid var(--line2)" }}>
                <div role="link" tabIndex={0} aria-label={`Abrir viagem ${v.titulo}`} onClick={() => onAbrirViagem(v.id)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onAbrirViagem(v.id); } }}
                  className="rel-linha cursor-pointer px-4 py-2.5 grid gap-x-3 gap-y-1 items-center grid-cols-[1fr_auto] lg:[grid-template-columns:minmax(0,2.2fr)_1fr_0.9fr_0.9fr_1.3fr_0.6fr_1fr_1fr]">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold truncate" style={{ color: "var(--ink)" }}>
                      {v.cliente_id && v.cliente_nome
                        ? <button className="hover:underline" onClick={(e) => { e.stopPropagation(); onAbrirCliente(v.cliente_id!); }}>{v.cliente_nome}</button>
                        : (v.cliente_nome || "sem cliente")}
                      {v.passageiros > 1 && <span className="font-normal" style={{ color: "var(--ink3)" }}> + {v.passageiros - 1}</span>}
                    </p>
                    <p className="text-[12px] truncate" style={{ color: "var(--ink3)" }}>
                      {v.titulo}
                      <span className="lg:hidden"> · {servicoDe(v)} · {dataBR(v.data_embarque) || "sem data"}{v.data_retorno && v.data_retorno !== v.data_embarque ? ` a ${dataBR(v.data_retorno)}` : ""}{(v.voos_internos ?? 0) > 0 ? ` · ${v.voos_internos} interno${v.voos_internos === 1 ? "" : "s"}` : ""}</span>
                    </p>
                  </div>
                  <span className="hidden lg:block text-[12.5px] truncate" style={{ color: "var(--ink2)" }}>{servicoDe(v)}</span>
                  <span className="hidden lg:block text-[12.5px] tabular-nums" style={{ color: "var(--ink2)" }}>{dataBR(v.data_embarque) || "—"}</span>
                  <span className="hidden lg:block text-[12.5px] tabular-nums" style={{ color: "var(--ink2)" }}>{dataBR(v.data_retorno) || "—"}</span>
                  <ProximoVooCurto v={v} className="hidden lg:block text-left truncate" />
                  <span className="hidden lg:block text-[12.5px] tabular-nums" style={{ color: (v.voos_internos ?? 0) > 0 ? "var(--ink)" : "var(--ink3)" }}>
                    {(v.voos_internos ?? 0) > 0 ? `✈ ${v.voos_internos}` : "—"}
                  </span>
                  <span className="hidden lg:block text-[12.5px] truncate" style={{ color: v.responsavel_nome ? "var(--ink2)" : "var(--ink3)" }}>{v.responsavel_nome ?? "sem dono"}</span>
                  <span className="justify-self-end lg:justify-self-start"><Etiqueta tom={TOM_FASE[v.fase]}>{FASES[v.fase]}</Etiqueta></span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
