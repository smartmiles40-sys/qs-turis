// src/rel/agenda/EventoModal.tsx
// -----------------------------------------------------------------------------
// Criar / editar um compromisso da agenda (0123).
//
// Quem pode mexer: o dono, ou a gestora/admin (a RLS confere de novo). Pra
// quem não pode, o modal vira só leitura — e o privado de outra pessoa mostra
// apenas o horário ("Ocupado").
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { buscarClientes, type Cliente } from "../lib/clientes";
import {
  TIPOS_EVENTO, apagarEvento, diaIso, fmtSP, horaHHMM, juntar, mesmoDia, salvarEvento, somarDias,
  type Evento, type EventoForm, type PessoaDoTime, type TipoEvento,
} from "../lib/agenda";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";

export interface RascunhoEvento { inicio: Date; fim: Date; dono_id: string; dia_inteiro?: boolean }

export default function EventoModal({ aberto, evento, rascunho, meuId, gestor, time, onFechar, onSalvo, onAbrirCliente, onAbrirViagem, onAbrirConversa }: {
  aberto: boolean;
  /** Evento existente (editar/ver) — ou null pra um novo a partir do rascunho. */
  evento: Evento | null;
  rascunho: RascunhoEvento | null;
  meuId: string;
  gestor: boolean;
  time: PessoaDoTime[];
  onFechar: () => void;
  onSalvo: () => void;
  onAbrirCliente?: (id: string) => void;
  onAbrirViagem?: (id: string) => void;
  onAbrirConversa?: (id: string) => void;
}) {
  const [f, setF] = useState<EventoForm | null>(null);
  const [dia, setDia] = useState("");
  const [hIni, setHIni] = useState("09:00");
  const [hFim, setHFim] = useState("10:00");
  const [clienteNome, setClienteNome] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Cliente[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmarApagar, setConfirmarApagar] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setErro(null); setConfirmarApagar(false); setBusca(""); setAchados([]);
    if (evento) {
      const i = new Date(evento.inicio);
      const fi = new Date(evento.fim);
      setF({
        id: evento.id, dono_id: evento.dono_id, titulo: evento.titulo, descricao: evento.descricao,
        inicio: evento.inicio, fim: evento.fim, dia_inteiro: evento.dia_inteiro, tipo: evento.tipo,
        privado: evento.privado, cliente_id: evento.cliente_id, viagem_id: evento.viagem_id,
        conversa_id: evento.conversa_id, local: evento.local, link: evento.link,
      });
      setDia(diaIso(i)); setHIni(horaHHMM(i)); setHFim(horaHHMM(fi));
      setClienteNome(evento.cliente_nome);
    } else if (rascunho) {
      setF({
        dono_id: rascunho.dono_id, titulo: "", descricao: null, inicio: rascunho.inicio.toISOString(), fim: rascunho.fim.toISOString(),
        dia_inteiro: !!rascunho.dia_inteiro, tipo: "reuniao", privado: false, cliente_id: null, local: null, link: null,
      });
      setDia(diaIso(rascunho.inicio)); setHIni(horaHHMM(rascunho.inicio)); setHFim(horaHHMM(rascunho.fim));
      setClienteNome(null);
    }
  }, [aberto, evento, rascunho]);

  useEffect(() => {
    if (!aberto || busca.trim().length < 2) { setAchados([]); return; }
    const t = setTimeout(() => { buscarClientes(busca, 8).then(setAchados).catch(() => setAchados([])); }, 250);
    return () => clearTimeout(t);
  }, [busca, aberto]);

  if (!f) return null;
  const podeMexer = gestor || f.dono_id === meuId;
  const mascarado = !!evento?.mascarado;
  const somenteLeitura = !podeMexer || mascarado;
  const mudar = (campos: Partial<EventoForm>) => setF((x) => (x ? { ...x, ...campos } : x));

  async function salvar() {
    if (!f) return;
    if (!f.titulo.trim()) { setErro("Dê um título ao compromisso."); return; }
    if (!dia) { setErro("Escolha a data."); return; }
    const inicio = f.dia_inteiro ? juntar(dia, "00:00") : juntar(dia, hIni);
    let fim = f.dia_inteiro ? somarDias(juntar(dia, "00:00"), 1) : juntar(dia, hFim);
    // Fim igual ou antes do início = termina no dia seguinte (ex.: 22h–01h).
    if (!f.dia_inteiro && fim <= inicio) fim = somarDias(fim, 1);
    setSalvando(true); setErro(null);
    try {
      await salvarEvento({ ...f, inicio: inicio.toISOString(), fim: fim.toISOString() });
      onSalvo();
    } catch (e) { setErro(e instanceof Error ? e.message : "Não salvei."); }
    finally { setSalvando(false); }
  }

  async function apagar() {
    if (!f?.id) return;
    setSalvando(true); setErro(null);
    try { await apagarEvento(f.id); onSalvo(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não apaguei."); }
    finally { setSalvando(false); }
  }

  const donoNome = time.find((p) => p.id === f.dono_id)?.name || evento?.dono_nome || "—";
  const quando = new Date(f.inicio);
  const ate = new Date(f.fim);

  if (somenteLeitura) {
    return (
      <Modal aberto={aberto} titulo={mascarado ? "Ocupado" : f.titulo || "Compromisso"} onFechar={onFechar}
        rodape={<Botao onClick={onFechar}>Fechar</Botao>}>
        <div className="space-y-2 text-[14px]" style={{ color: "var(--ink2)" }}>
          <p><b style={{ color: "var(--ink)" }}>{donoNome}</b> · {TIPOS_EVENTO[f.tipo].rotulo}</p>
          <p>
            {fmtSP(quando, { weekday: "long", day: "2-digit", month: "long" })}
            {f.dia_inteiro ? " · dia inteiro" : ` · ${horaHHMM(quando)}–${horaHHMM(ate)}${mesmoDia(quando, ate) ? "" : " (+1 dia)"}`}
          </p>
          {mascarado && <Aviso>Compromisso particular — só o horário aparece pra você.</Aviso>}
          {!mascarado && f.local && <p>📍 {f.local}</p>}
          {!mascarado && f.link && <p>🔗 <a href={f.link} target="_blank" rel="noreferrer" className="underline" style={{ color: "var(--rel-ink)" }}>{f.link}</a></p>}
          {!mascarado && f.descricao && <p className="whitespace-pre-wrap">{f.descricao}</p>}
          {!mascarado && <Atalhos f={f} clienteNome={clienteNome} onAbrirCliente={onAbrirCliente} onAbrirViagem={onAbrirViagem} onAbrirConversa={onAbrirConversa} onFechar={onFechar} />}
          {!mascarado && !podeMexer && <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Só {donoNome.split(" ")[0]} ou a gestora mudam este compromisso.</p>}
        </div>
      </Modal>
    );
  }

  return (
    <Modal aberto={aberto} titulo={f.id ? "Editar compromisso" : "Novo compromisso"} onFechar={onFechar} largura={600}
      rodape={
        <div className="flex w-full items-center gap-2">
          {f.id && !confirmarApagar && <Botao variante="perigo" onClick={() => setConfirmarApagar(true)} disabled={salvando}>Apagar</Botao>}
          {f.id && confirmarApagar && (
            <span className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
              Apagar mesmo?
              <Botao variante="perigo" onClick={() => void apagar()} disabled={salvando}>Sim, apagar</Botao>
              <Botao variante="fantasma" onClick={() => setConfirmarApagar(false)}>Não</Botao>
            </span>
          )}
          <span className="flex-1" />
          <Botao onClick={onFechar} disabled={salvando}>Cancelar</Botao>
          <Botao variante="primario" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar"}</Botao>
        </div>
      }>
      <div className="space-y-3">
        <Campo rotulo="Título">
          <Entrada value={f.titulo} onChange={(e) => mudar({ titulo: e.target.value })} placeholder="Ex.: Reunião de pré-embarque com a família Silva" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void salvar(); } }} />
        </Campo>

        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Tipo">
          {(Object.keys(TIPOS_EVENTO) as TipoEvento[]).map((t) => (
            <button key={t} role="radio" aria-checked={f.tipo === t} onClick={() => mudar({ tipo: t })}
              className="h-8 px-3 rounded-full text-[12.5px] font-semibold border inline-flex items-center gap-1.5"
              style={f.tipo === t
                ? { background: TIPOS_EVENTO[t].cor, color: "#fff", borderColor: TIPOS_EVENTO[t].cor }
                : { borderColor: "var(--line)", color: "var(--ink2)" }}>
              <span className="w-2 h-2 rounded-full" style={{ background: f.tipo === t ? "#fff" : TIPOS_EVENTO[t].cor }} aria-hidden />
              {TIPOS_EVENTO[t].rotulo}
            </button>
          ))}
        </div>

        {gestor && (
          <Campo rotulo="Agenda de">
            <select className="rel-input" value={f.dono_id} onChange={(e) => mudar({ dono_id: e.target.value })}>
              {time.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id === meuId ? " (eu)" : ""}</option>)}
            </select>
          </Campo>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
          <div className="col-span-2">
            <Campo rotulo="Data"><Entrada type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></Campo>
          </div>
          {!f.dia_inteiro && (
            <>
              <Campo rotulo="Início"><Entrada type="time" step={900} value={hIni} onChange={(e) => {
                const novo = e.target.value;
                // Mantém a duração ao mexer no início (como no Google Agenda).
                // A duração conta a virada do dia (23h–01h = 2h); passar da meia-noite vira "+1 dia".
                const bruto = juntar("2000-01-01", hFim).getTime() - juntar("2000-01-01", hIni).getTime();
                const dur = bruto > 0 ? bruto : bruto + 86_400_000;
                setHIni(novo);
                if (novo && dur < 86_400_000) setHFim(horaHHMM(new Date(juntar("2000-01-01", novo).getTime() + dur)));
              }} /></Campo>
              <Campo rotulo={hFim && hIni && hFim <= hIni ? "Fim (+1 dia)" : "Fim"}><Entrada type="time" step={900} value={hFim} onChange={(e) => setHFim(e.target.value)} /></Campo>
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={f.dia_inteiro} onChange={(e) => {
            mudar({ dia_inteiro: e.target.checked });
            // Saindo do dia inteiro com 00:00–00:00: começa num horário que faz sentido.
            if (!e.target.checked && hIni === hFim) { setHIni("09:00"); setHFim("10:00"); }
          }} /> Dia inteiro
        </label>

        <Campo rotulo="Cliente (opcional)">
          {f.cliente_id ? (
            <div className="flex items-center gap-2">
              <span className="rel-card px-3 py-1.5 text-[13px] font-semibold flex-1 truncate" style={{ color: "var(--ink)" }}>{clienteNome || "Cliente"}</span>
              <Botao variante="fantasma" onClick={() => { mudar({ cliente_id: null }); setClienteNome(null); }}>Tirar</Botao>
            </div>
          ) : (
            <div className="relative">
              <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, CPF ou telefone" />
              {achados.length > 0 && (
                <ul className="rel-card absolute z-10 left-0 right-0 mt-1 max-h-56 overflow-y-auto shadow-lg">
                  {achados.map((c) => (
                    <li key={c.id}>
                      <button className="rel-linha w-full text-left px-3 py-2 text-[13px]" style={{ color: "var(--ink)" }}
                        onClick={() => { mudar({ cliente_id: c.id }); setClienteNome(c.nome); setBusca(""); setAchados([]); if (!f.titulo.trim()) mudar({ cliente_id: c.id, titulo: c.nome }); }}>
                        {c.nome}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Campo>

        <div className="grid sm:grid-cols-2 gap-2">
          <Campo rotulo="Local"><Entrada value={f.local || ""} onChange={(e) => mudar({ local: e.target.value })} placeholder="Escritório, aeroporto…" /></Campo>
          <Campo rotulo="Link"><Entrada value={f.link || ""} onChange={(e) => mudar({ link: e.target.value })} placeholder="https://meet.google.com/…" /></Campo>
        </div>
        <Campo rotulo="Descrição">
          <textarea className="rel-input min-h-[80px]" value={f.descricao || ""} onChange={(e) => mudar({ descricao: e.target.value })} />
        </Campo>
        <label className="flex items-start gap-2 text-[13px]" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" className="mt-0.5" checked={f.privado} onChange={(e) => mudar({ privado: e.target.checked })} />
          <span><b>Particular</b> — o time vê só "Ocupado" nesse horário (a gestora vê tudo).</span>
        </label>
        {f.id && <Atalhos f={f} clienteNome={clienteNome} onAbrirCliente={onAbrirCliente} onAbrirViagem={onAbrirViagem} onAbrirConversa={onAbrirConversa} onFechar={onFechar} />}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

function Atalhos({ f, clienteNome, onAbrirCliente, onAbrirViagem, onAbrirConversa, onFechar }: {
  f: EventoForm; clienteNome: string | null; onFechar: () => void;
  onAbrirCliente?: (id: string) => void; onAbrirViagem?: (id: string) => void; onAbrirConversa?: (id: string) => void;
}) {
  const botoes = [
    f.cliente_id && onAbrirCliente ? <Botao key="c" variante="fantasma" onClick={() => { onFechar(); onAbrirCliente(f.cliente_id!); }}>Abrir ficha{clienteNome ? ` de ${clienteNome.split(" ")[0]}` : ""}</Botao> : null,
    f.viagem_id && onAbrirViagem ? <Botao key="v" variante="fantasma" onClick={() => { onFechar(); onAbrirViagem(f.viagem_id!); }}>Abrir viagem</Botao> : null,
    f.conversa_id && onAbrirConversa ? <Botao key="w" variante="fantasma" onClick={() => { onFechar(); onAbrirConversa(f.conversa_id!); }}>Abrir conversa</Botao> : null,
  ].filter(Boolean);
  return botoes.length ? <div className="flex flex-wrap gap-2">{botoes}</div> : null;
}
