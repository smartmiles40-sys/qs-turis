// src/rel/chamados/ChamadoModal.tsx
// -----------------------------------------------------------------------------
// Abrir / editar um CHAMADO: o pedido do cliente que não se resolve na hora
// (trocar voo, segunda via de voucher, reclamação). Tem dono e prazo.
//
// O prazo nasce da prioridade (urgente 4h, alta 1 dia, normal 3 dias, baixa
// 7 dias) e pode ser mudado à mão. Abrir de dentro de uma conversa ou da ficha
// já vem com o cliente (e a viagem) preenchidos.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { buscarClientes, carregarCliente, type Cliente } from "../lib/clientes";
import {
  PRIORIDADES, STATUS_CHAMADO, deInputLocal, equipeRelacionamento, paraInputLocal, salvarChamado,
  type Chamado, type Prioridade, type StatusChamado,
} from "../lib/pos";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";

interface Props {
  aberto: boolean;
  onFechar: () => void;
  onSalvo: (c: Chamado) => void;
  chamado?: Chamado | null;
  inicial?: { clienteId?: string | null; viagemId?: string | null; conversaId?: string | null; assunto?: string };
}

const prazoPela = (p: Prioridade) => new Date(Date.now() + PRIORIDADES[p].horas * 3600_000).toISOString();

export default function ChamadoModal({ aberto, onFechar, onSalvo, chamado, inicial }: Props) {
  const { currentUser } = useQsAuth();
  const [assunto, setAssunto] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prioridade, setPrioridade] = useState<Prioridade>("normal");
  const [prazo, setPrazo] = useState("");
  const [prazoManual, setPrazoManual] = useState(false);
  const [status, setStatus] = useState<StatusChamado>("aberto");
  const [resolucao, setResolucao] = useState("");
  const [responsavel, setResponsavel] = useState<string>("");
  const [cliente, setCliente] = useState<Pick<Cliente, "id" | "nome"> | null>(null);
  const [viagemId, setViagemId] = useState<string>("");
  const [viagens, setViagens] = useState<{ id: string; titulo: string; data_embarque: string | null }[]>([]);
  const [busca, setBusca] = useState("");
  const [opcoes, setOpcoes] = useState<Cliente[]>([]);
  const [equipe, setEquipe] = useState<{ id: string; name: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Abre limpo (ou com o chamado / o contexto de quem abriu).
  useEffect(() => {
    if (!aberto) return;
    setErro(null);
    setBusca("");
    setAssunto(chamado?.assunto ?? inicial?.assunto ?? "");
    setDescricao(chamado?.descricao ?? "");
    const p = chamado?.prioridade ?? "normal";
    setPrioridade(p);
    setPrazo(paraInputLocal(chamado?.prazo ?? prazoPela(p)));
    setPrazoManual(Boolean(chamado));
    setStatus(chamado?.status ?? "aberto");
    setResolucao(chamado?.resolucao ?? "");
    setResponsavel(chamado ? chamado.responsavel_id ?? "" : currentUser?.id ?? "");
    setViagemId(chamado?.viagem_id ?? inicial?.viagemId ?? "");
    const idCliente = chamado?.cliente_id ?? inicial?.clienteId ?? null;
    setCliente(null);
    if (idCliente) carregarCliente(idCliente).then((c) => c && setCliente({ id: c.id, nome: c.nome })).catch(() => undefined);
    equipeRelacionamento().then(setEquipe).catch(() => setEquipe([]));
    // Só ao ABRIR (ou trocar de chamado): `inicial` costuma chegar como objeto
    // novo a cada render de quem chama — depender dele zeraria o formulário
    // enquanto a pessoa digita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, chamado?.id]);

  // Prioridade mudou e ninguém mexeu no prazo à mão: o prazo acompanha.
  useEffect(() => {
    if (aberto && !prazoManual) setPrazo(paraInputLocal(prazoPela(prioridade)));
  }, [prioridade, prazoManual, aberto]);

  // Viagens do cliente escolhido (pra ligar o chamado a uma delas).
  useEffect(() => {
    if (!cliente) { setViagens([]); return; }
    supabase.from("rel_viagem_passageiros").select("viagem:rel_viagens(id, titulo, data_embarque)").eq("cliente_id", cliente.id)
      .then(({ data }) => {
        const vs = ((data ?? []) as unknown as { viagem: { id: string; titulo: string; data_embarque: string | null } | null }[])
          .map((x) => x.viagem).filter((v): v is { id: string; titulo: string; data_embarque: string | null } => !!v)
          .sort((a, b) => String(b.data_embarque).localeCompare(String(a.data_embarque)));
        setViagens(vs);
      });
  }, [cliente]);

  useEffect(() => {
    if (!busca.trim()) { setOpcoes([]); return; }
    const t = setTimeout(() => { buscarClientes(busca, 8).then(setOpcoes).catch(() => setOpcoes([])); }, 250);
    return () => clearTimeout(t);
  }, [busca]);

  async function salvar() {
    if (assunto.trim().length < 3) { setErro("Escreva o assunto (ex.: \"Trocar data do voo de volta\")."); return; }
    if (status === "resolvido" && !resolucao.trim()) { setErro("Conte como foi resolvido — fica no histórico do cliente."); return; }
    setSalvando(true);
    setErro(null);
    try {
      const salvo = await salvarChamado({
        assunto, descricao, prioridade, prazo: deInputLocal(prazo),
        cliente_id: cliente?.id ?? null, viagem_id: viagemId || null,
        conversa_id: chamado?.conversa_id ?? inicial?.conversaId ?? null,
        responsavel_id: responsavel || null, status, resolucao,
      }, chamado?.id);
      onSalvo(salvo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não salvou.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo={chamado ? `Chamado #${chamado.numero}` : "Novo chamado"}
      onFechar={onFechar}
      largura={600}
      rodape={
        <>
          <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primario" onClick={salvar} disabled={salvando}>{salvando ? "Salvando…" : chamado ? "Salvar" : "Abrir chamado"}</Botao>
        </>
      }
    >
      <div className="space-y-4">
        <Campo rotulo="Assunto *">
          <Entrada value={assunto} onChange={(e) => setAssunto(e.target.value)} maxLength={140} placeholder="Ex.: Trocar a data do voo de volta" autoFocus={!chamado} />
        </Campo>
        <Campo rotulo="Detalhes">
          <textarea className="rel-input" rows={3} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="O que o cliente pediu, o que já foi feito…" />
        </Campo>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="Prioridade">
            <select className="rel-input" value={prioridade} onChange={(e) => setPrioridade(e.target.value as Prioridade)}>
              {(Object.keys(PRIORIDADES) as Prioridade[]).map((p) => (
                <option key={p} value={p}>{PRIORIDADES[p].rotulo} — prazo {PRIORIDADES[p].horas < 24 ? `${PRIORIDADES[p].horas}h` : `${PRIORIDADES[p].horas / 24} dia${PRIORIDADES[p].horas > 24 ? "s" : ""}`}</option>
              ))}
            </select>
          </Campo>
          <Campo rotulo="Prazo">
            <Entrada type="datetime-local" value={prazo} onChange={(e) => { setPrazo(e.target.value); setPrazoManual(true); }} />
          </Campo>
          <Campo rotulo="Responsável">
            <select className="rel-input" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
              <option value="">Ninguém ainda</option>
              {equipe.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Campo>
          {chamado && (
            <Campo rotulo="Situação">
              <select className="rel-input" value={status} onChange={(e) => setStatus(e.target.value as StatusChamado)}>
                {(Object.keys(STATUS_CHAMADO) as StatusChamado[]).map((s) => <option key={s} value={s}>{STATUS_CHAMADO[s]}</option>)}
              </select>
            </Campo>
          )}
        </div>

        {/* Cliente e viagem */}
        <div className="rounded-xl p-3.5 space-y-3" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
          {cliente ? (
            <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
              <span className="flex-1">Cliente: <b>{cliente.nome}</b></span>
              <button className="text-xs underline" style={{ color: "var(--ink3)" }} onClick={() => { setCliente(null); setViagemId(""); }}>trocar</button>
            </div>
          ) : (
            <div className="relative">
              <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Cliente (nome, CPF ou telefone) — opcional" />
              {opcoes.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rel-card shadow-lg overflow-hidden">
                  {opcoes.map((c) => (
                    <button key={c.id} className="rel-linha w-full text-left px-3 py-2 text-[13px]" style={{ color: "var(--ink)" }}
                      onClick={() => { setCliente({ id: c.id, nome: c.nome }); setBusca(""); }}>
                      {c.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {cliente && viagens.length > 0 && (
            <select className="rel-input" value={viagemId} onChange={(e) => setViagemId(e.target.value)}>
              <option value="">Sem viagem específica</option>
              {viagens.map((v) => <option key={v.id} value={v.id}>{v.titulo}{v.data_embarque ? ` — ${v.data_embarque.split("-").reverse().join("/")}` : ""}</option>)}
            </select>
          )}
        </div>

        {status === "resolvido" && (
          <Campo rotulo="Como foi resolvido *">
            <textarea className="rel-input" rows={2} value={resolucao} onChange={(e) => setResolucao(e.target.value)} />
          </Campo>
        )}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
