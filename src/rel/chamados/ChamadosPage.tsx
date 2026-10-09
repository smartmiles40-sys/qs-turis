// src/rel/chamados/ChamadosPage.tsx
// -----------------------------------------------------------------------------
// CHAMADOS do Relacionamento: os pedidos que não se resolvem na hora. A lista
// abre nos ABERTOS, em ordem de prazo — o que vence primeiro fica em cima.
// Vencido aparece em vermelho, vence hoje em amarelo.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  PRIORIDADES, STATUS_CHAMADO, listarChamados, resolverChamado, situacaoDoPrazo,
  type Chamado, type FiltroChamado,
} from "../lib/pos";
import { Aviso, Botao, Campo, Etiqueta, Modal, Vazio } from "../ui";
import ChamadoModal from "./ChamadoModal";

const FILTROS: { id: FiltroChamado; rotulo: string }[] = [
  { id: "abertos", rotulo: "Abertos" },
  { id: "meus", rotulo: "Meus" },
  { id: "vencidos", rotulo: "Vencidos" },
  { id: "resolvidos", rotulo: "Resolvidos" },
];

const TOM_PRIORIDADE = { urgente: "erro", alta: "aviso", normal: "neutro", baixa: "neutro" } as const;

export default function ChamadosPage({ onAbrirCliente, onAbrirViagem, onAbrirConversa }: {
  onAbrirCliente: (id: string) => void;
  onAbrirViagem: (id: string) => void;
  onAbrirConversa: (id: string) => void;
}) {
  const { currentUser } = useQsAuth();
  const [filtro, setFiltro] = useState<FiltroChamado>("abertos");
  const [lista, setLista] = useState<Chamado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Chamado | null>(null);
  const [novo, setNovo] = useState(false);
  const [resolvendo, setResolvendo] = useState<Chamado | null>(null);
  const [resolucao, setResolucao] = useState("");

  const carregar = useCallback(async () => {
    try { setLista(await listarChamados(filtro, currentUser?.id ?? "")); setErro(null); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não consegui carregar os chamados."); setLista([]); }
  }, [filtro, currentUser?.id]);

  useEffect(() => { setLista(null); void carregar(); }, [carregar]);

  async function confirmarResolver() {
    if (!resolvendo) return;
    if (!resolucao.trim()) return;
    try { await resolverChamado(resolvendo.id, resolucao); setResolvendo(null); setResolucao(""); void carregar(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não resolveu."); }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Chamados</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Pedidos do cliente com dono e prazo — trocar voo, segunda via, reclamação.</p>
        </div>
        <Botao variante="primario" onClick={() => setNovo(true)}>+ Novo chamado</Botao>
      </div>

      <div className="flex gap-1 mb-4 overflow-x-auto">
        {FILTROS.map((f) => (
          <button key={f.id} onClick={() => setFiltro(f.id)} className="px-3 py-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap"
            style={filtro === f.id ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { color: "var(--ink3)" }}>
            {f.rotulo}
          </button>
        ))}
      </div>

      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}

      <div className="rel-card overflow-hidden">
        {lista === null ? (
          <p className="p-5 text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        ) : lista.length === 0 ? (
          <Vazio
            titulo={filtro === "vencidos" ? "Nenhum chamado vencido" : filtro === "resolvidos" ? "Nenhum chamado resolvido ainda" : "Nenhum chamado aqui"}
            texto={filtro === "abertos" ? "Quando um cliente pedir algo que leva tempo, abra um chamado — ele ganha dono e prazo." : undefined}
          />
        ) : (
          <ul>
            {lista.map((c, i) => {
              const p = situacaoDoPrazo(c.prazo, c.status);
              return (
                <li key={c.id} className="px-4 py-3 flex flex-wrap items-start gap-3" style={{ borderTop: i ? "1px solid var(--line2)" : undefined }}>
                  <button className="flex-1 min-w-[220px] text-left" onClick={() => setEditando(c)}>
                    <span className="block text-sm font-semibold" style={{ color: "var(--ink)" }}>
                      <span style={{ color: "var(--ink3)" }}>#{c.numero}</span> {c.assunto}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 mt-1">
                      <Etiqueta tom={TOM_PRIORIDADE[c.prioridade]}>{PRIORIDADES[c.prioridade].rotulo}</Etiqueta>
                      <Etiqueta tom={p.tom === "neutro" ? "neutro" : p.tom}>⏱ {p.texto}</Etiqueta>
                      {c.status !== "aberto" && <Etiqueta tom={c.status === "resolvido" ? "rel" : "neutro"}>{STATUS_CHAMADO[c.status]}</Etiqueta>}
                      <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{c.responsavel?.name ? `· ${c.responsavel.name.split(" ")[0]}` : "· sem responsável"}</span>
                    </span>
                    {c.status === "resolvido" && c.resolucao && (
                      <span className="block text-[12px] mt-1" style={{ color: "var(--ink2)" }}>✓ {c.resolucao}</span>
                    )}
                  </button>
                  <span className="flex flex-wrap items-center gap-1.5 text-[12px]">
                    {c.cliente_id && c.cliente && (
                      <button className="underline" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirCliente(c.cliente_id!)}>{c.cliente.nome}</button>
                    )}
                    {c.viagem_id && c.viagem && (
                      <button className="underline" style={{ color: "var(--ink2)" }} onClick={() => onAbrirViagem(c.viagem_id!)}>{c.viagem.titulo}</button>
                    )}
                    {c.conversa_id && (
                      <button className="underline" style={{ color: "var(--ink2)" }} onClick={() => onAbrirConversa(c.conversa_id!)}>conversa</button>
                    )}
                    {c.status !== "resolvido" && (
                      <Botao onClick={() => { setResolvendo(c); setResolucao(""); }}>Resolver</Botao>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ChamadoModal
        aberto={novo || !!editando}
        chamado={editando}
        onFechar={() => { setNovo(false); setEditando(null); }}
        onSalvo={() => { setNovo(false); setEditando(null); void carregar(); }}
      />

      <Modal
        aberto={!!resolvendo}
        titulo={resolvendo ? `Resolver #${resolvendo.numero}` : "Resolver"}
        onFechar={() => setResolvendo(null)}
        rodape={<><Botao variante="fantasma" onClick={() => setResolvendo(null)}>Cancelar</Botao><Botao variante="primario" disabled={!resolucao.trim()} onClick={confirmarResolver}>Resolver</Botao></>}
      >
        <Campo rotulo="Como foi resolvido?" dica="Fica no histórico do cliente.">
          <textarea className="rel-input" rows={3} value={resolucao} onChange={(e) => setResolucao(e.target.value)} autoFocus />
        </Campo>
      </Modal>
    </div>
  );
}
