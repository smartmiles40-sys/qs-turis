// src/rel/atendimento/VinculoGrupo.tsx
// -----------------------------------------------------------------------------
// GRUPO ↔ VIAGEM (28/10/2026, 0219). O grupo do WhatsApp fica ligado à
// expedição (grupo da turma) ou à viagem do cliente (família, lua de mel), e
// aparece dentro da viagem. A sugestão sai do NOME do grupo × nome/destino da
// expedição (sugerirExpedicoes em ../lib/grupos): destino, turma G1/G2, ano e mês.
//   • VinculoDoGrupo        — no painel do grupo (um grupo)
//   • VincularGruposModal   — todos os grupos sem vínculo, com a melhor sugestão
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Modal } from "../ui";
import {
  buscarViagensParaVinculo, expedicoesParaVinculo, sugerirExpedicoes, vincularGrupo, viagemPorId,
  type ExpedicaoVinculo, type Grupo, type ViagemVinculo,
} from "../lib/grupos";
import { FotoGrupo, nomeDoGrupo } from "./GrupoExtras";

let cacheExp: Promise<ExpedicaoVinculo[]> | null = null;
const expedicoes = () => (cacheExp ??= expedicoesParaVinculo().catch((e) => { cacheExp = null; throw e; }));
const dataBR = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { month: "short", year: "numeric" }) : "");
const campo = { background: "var(--wa-head)", color: "var(--wa-txt)", border: "1px solid var(--wa-line)" } as const;

export function VinculoDoGrupo({ grupo, onMudou, abrirViagem }: { grupo: Grupo; onMudou: () => void; abrirViagem?: (id: string) => void }) {
  const [exps, setExps] = useState<ExpedicaoVinculo[]>([]);
  const [viagem, setViagem] = useState<ViagemVinculo | null>(null);
  const [mudando, setMudando] = useState(false);
  const [busca, setBusca] = useState("");
  const [viagens, setViagens] = useState<ViagemVinculo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { expedicoes().then(setExps).catch(() => setErro("Não consegui carregar as expedições.")); }, []);
  useEffect(() => { if (grupo.viagem_id) viagemPorId(grupo.viagem_id).then(setViagem).catch(() => null); else setViagem(null); }, [grupo.viagem_id]);
  useEffect(() => {
    if (!mudando || busca.trim().length < 2) { setViagens([]); return; }
    const t = setTimeout(() => void buscarViagensParaVinculo(busca).then(setViagens), 300);
    return () => clearTimeout(t);
  }, [busca, mudando]);

  const atual = exps.find((e) => e.id === grupo.expedicao_id) || null;
  const sugestoes = useMemo(() => sugerirExpedicoes(grupo.nome || "", exps, 3), [grupo.nome, exps]);
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? exps.filter((e) => `${e.nome} ${e.destino || ""}`.toLowerCase().includes(q)).slice(0, 12) : [];
  }, [busca, exps]);

  async function ligar(v: { expedicaoId?: string | null; viagemId?: string | null }) {
    setErro(null);
    try { await vincularGrupo(grupo.jid, v); setMudando(false); setBusca(""); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
  }

  const linha = "w-full text-left px-2.5 py-1.5 rounded-lg text-[13px] wa-item";
  return (
    <div className="space-y-2">
      {(atual || viagem) && !mudando ? (
        <div className="rounded-lg px-3 py-2 text-[13.5px]" style={{ background: "var(--wa-head)", color: "var(--wa-txt)" }}>
          {atual && <p>✈️ <b>{atual.nome}</b> <span style={{ color: "var(--wa-meta)" }}>{dataBR(atual.data_embarque)}</span></p>}
          {viagem && (
            <p>🧳 {abrirViagem ? <button className="font-semibold underline" onClick={() => abrirViagem(viagem.id)}>{viagem.titulo}</button> : <b>{viagem.titulo}</b>}
              {" "}<span style={{ color: "var(--wa-meta)" }}>{dataBR(viagem.data_embarque)}</span></p>
          )}
          <div className="flex gap-3 mt-1">
            <button className="text-[12.5px] font-semibold" style={{ color: "var(--wa-green-ink)" }} onClick={() => setMudando(true)}>Trocar</button>
            <button className="text-[12.5px]" style={{ color: "var(--wa-meta)" }} onClick={() => { if (window.confirm("Tirar o vínculo deste grupo?")) void ligar({}); }}>Desvincular</button>
          </div>
        </div>
      ) : (
        <>
          {!mudando && <p className="text-[12.5px]" style={{ color: "var(--wa-meta)" }}>Sem viagem ligada.</p>}
          {sugestoes.length > 0 && (
            <div>
              <p className="text-[11.5px] uppercase tracking-wide font-semibold mb-1" style={{ color: "var(--wa-meta)" }}>Sugestões pelo nome do grupo</p>
              {sugestoes.map((s) => (
                <button key={s.expedicao.id} className={linha} style={{ color: "var(--wa-txt)" }} onClick={() => void ligar({ expedicaoId: s.expedicao.id })}>
                  ✈️ {s.expedicao.nome} <span style={{ color: "var(--wa-meta)" }}>· {dataBR(s.expedicao.data_embarque)} · {s.motivo}</span>
                </button>
              ))}
            </div>
          )}
          {!mudando
            ? <button className="text-[12.5px] font-semibold" style={{ color: "var(--wa-green-ink)" }} onClick={() => setMudando(true)}>Escolher expedição ou viagem…</button>
            : (
              <div className="space-y-1">
                <input className="w-full px-3 py-2 rounded-lg text-[13.5px]" style={campo} placeholder="Buscar expedição, viagem ou cliente (ex.: Tailândia G3, Sobreira)"
                  value={busca} onChange={(e) => setBusca(e.target.value)} autoFocus aria-label="Buscar expedição ou viagem" />
                {filtradas.map((e) => (
                  <button key={e.id} className={linha} style={{ color: "var(--wa-txt)" }} onClick={() => void ligar({ expedicaoId: e.id })}>
                    ✈️ {e.nome} <span style={{ color: "var(--wa-meta)" }}>· {dataBR(e.data_embarque)}</span>
                  </button>
                ))}
                {viagens.map((v) => (
                  <button key={v.id} className={linha} style={{ color: "var(--wa-txt)" }} onClick={() => void ligar({ viagemId: v.id, expedicaoId: v.expedicoes_id })}>
                    🧳 {v.titulo} <span style={{ color: "var(--wa-meta)" }}>· {dataBR(v.data_embarque)}{v.destino ? ` · ${v.destino}` : ""}</span>
                  </button>
                ))}
                <button className="text-[12.5px]" style={{ color: "var(--wa-meta)" }} onClick={() => { setMudando(false); setBusca(""); }}>Cancelar</button>
              </div>
            )}
        </>
      )}
      {erro && <p className="text-[12.5px]" style={{ color: "var(--red)" }}>{erro}</p>}
    </div>
  );
}

/** Todos os grupos SEM vínculo, cada um com a melhor sugestão. "Ligar" um a um ou todos os marcados. */
export function VincularGruposModal({ aberto, grupos, onFechar, onMudou }: { aberto: boolean; grupos: Grupo[]; onFechar: () => void; onMudou: () => void }) {
  const [exps, setExps] = useState<ExpedicaoVinculo[]>([]);
  const [feitos, setFeitos] = useState<Set<string>>(new Set());
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => { if (aberto) { setFeitos(new Set()); setErro(null); expedicoes().then(setExps).catch(() => setErro("Não consegui carregar as expedições.")); } }, [aberto]);

  const linhas = useMemo(() => grupos.filter((g) => !g.expedicao_id && !g.viagem_id)
    .map((g) => ({ g, s: sugerirExpedicoes(g.nome || "", exps, 1)[0] }))
    .filter((x) => x.s)
    .sort((a, b) => b.s.pontos - a.s.pontos), [grupos, exps]);
  // já vem marcado quem tem sugestão forte (destino + turma ou ano)
  useEffect(() => { setMarcados(new Set(linhas.filter((x) => x.s.pontos >= 6).map((x) => x.g.jid))); }, [linhas]);
  const semVinculo = grupos.filter((g) => !g.expedicao_id && !g.viagem_id).length;

  async function ligar(lista: { jid: string; exp: string }[]) {
    setSalvando(true); setErro(null);
    const ok = new Set(feitos);
    for (const x of lista) {
      try { await vincularGrupo(x.jid, { expedicaoId: x.exp }); ok.add(x.jid); }
      catch (e) { setErro(e instanceof Error ? e.message : "Algum não salvou."); }
    }
    setFeitos(ok); setSalvando(false); onMudou();
  }
  const pendentes = linhas.filter((x) => marcados.has(x.g.jid) && !feitos.has(x.g.jid));

  return (
    <Modal aberto={aberto} titulo="Ligar grupos às expedições" onFechar={onFechar} largura={720}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Fechar</Botao>
        <Botao variante="primario" disabled={!pendentes.length || salvando} onClick={() => void ligar(pendentes.map((x) => ({ jid: x.g.jid, exp: x.s.expedicao.id })))}>
          {salvando ? "Ligando…" : `Ligar marcados (${pendentes.length})`}
        </Botao>
      </>}>
      <p className="text-[13px] mb-3" style={{ color: "var(--ink2)" }}>
        {semVinculo} grupo(s) sem viagem. A sugestão compara o nome do grupo com as expedições (destino, G1/G2, ano e mês) — confira antes de ligar.
        Grupos sem sugestão (gestão de milhas, parceiros…) ficam de fora; pra esses, abra o grupo e escolha à mão.
      </p>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <ul className="divide-y" style={{ borderColor: "var(--line2)" }}>
        {linhas.map(({ g, s }) => (
          <li key={g.jid} className="flex items-center gap-3 py-2">
            <input type="checkbox" aria-label={`Ligar ${nomeDoGrupo(g)}`} disabled={feitos.has(g.jid)} checked={marcados.has(g.jid) || feitos.has(g.jid)}
              onChange={(e) => setMarcados((m) => { const n = new Set(m); if (e.target.checked) n.add(g.jid); else n.delete(g.jid); return n; })} />
            <FotoGrupo grupo={g} tamanho={32} />
            <span className="flex-1 min-w-0">
              <span className="block truncate text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{nomeDoGrupo(g)}</span>
              <span className="block truncate text-[12.5px]" style={{ color: "var(--ink3)" }}>→ {s.expedicao.nome} · {dataBR(s.expedicao.data_embarque)} <i>({s.motivo})</i></span>
            </span>
            {feitos.has(g.jid)
              ? <span className="text-[12px] font-semibold" style={{ color: "var(--rel-ink)" }}>ligado ✓</span>
              : <Botao variante="fantasma" disabled={salvando} onClick={() => void ligar([{ jid: g.jid, exp: s.expedicao.id }])}>Ligar</Botao>}
          </li>
        ))}
        {!linhas.length && <li className="py-6 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma sugestão nova.</li>}
      </ul>
    </Modal>
  );
}
