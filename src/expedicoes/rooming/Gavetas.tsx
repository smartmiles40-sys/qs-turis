// src/expedicoes/rooming/Gavetas.tsx
// Gavetas laterais do Rooming (app antigo: NovoQuartoDrawer, QuartosAutomaticos-
// Drawer, EditarQuartoDrawer, DuplicarHotelDrawer e ConexaoViagemDrawer).
// Mudanças: o "Editar quarto" agora também troca a extensão; o status
// "cancelado" passou a valer (libera os hóspedes e o quarto não recebe ninguém);
// duplicar copia a extensão junto.
import { useEffect, useState } from "react";
import { Avatar, Botao, Campo, Entrada } from "@/rel/ui";
import { useExp } from "../contexto";
import { Gaveta } from "../ui";
import { TIPO_QUARTO } from "../lib/constants";
import type { PassageiroRow, QuartoRow } from "../lib/database";
import { atualizarQuarto, criarQuartos, duplicarQuartos, salvarConexao } from "./dados";
import { capacidade, quartoCancelado } from "./calculos";

const erroDe = (e: unknown) => (e instanceof Error ? e.message : "Algo deu errado");

function Escolha({ valor, onMudar, opcoes, rotulo }: { valor: string; onMudar: (v: string) => void; opcoes: { v: string; r: string }[]; rotulo: string }) {
  return (
    <select className="rel-input" aria-label={rotulo} value={valor} onChange={(e) => onMudar(e.target.value)}>
      {opcoes.map((o) => <option key={o.v} value={o.v}>{o.r}</option>)}
    </select>
  );
}

function CampoExtensao({ extensoes, valor, onMudar }: { extensoes: { id: string; nome: string }[]; valor: string; onMudar: (v: string) => void }) {
  if (!extensoes.length) return null;
  return (
    <Campo rotulo="Faz parte de" dica="Hotel de extensão: só quem contratou a extensão entra na alocação.">
      <Escolha rotulo="Faz parte de" valor={valor} onMudar={onMudar}
        opcoes={[{ v: "", r: "Grupo principal (todos)" }, ...extensoes.map((e) => ({ v: e.id, r: e.nome }))]} />
    </Campo>
  );
}

const OPCOES_TIPO = TIPO_QUARTO.map((t) => ({ v: t, r: `${t} (até ${capacidade(t)})` }));

// ---------------------------------------------------------------------------
// Novo quarto (1, com observações) e Criar quartos automáticos (vários)
// ---------------------------------------------------------------------------
export interface PrefillHotel { hotel_cidade: string; check_in: string; check_out: string; extensao_id: string | null }

export function GavetaCriarQuartos({ modo, expId, prefill, extensoes, onFechar, onSalvo }: {
  modo: "novo" | "auto" | null; expId: string; prefill: PrefillHotel | null; extensoes: { id: string; nome: string }[];
  onFechar: () => void; onSalvo: () => void;
}) {
  const { avisar } = useExp();
  const [hotel, setHotel] = useState("");
  const [ci, setCi] = useState("");
  const [co, setCo] = useState("");
  const [tipo, setTipo] = useState("Duplo");
  const [qtd, setQtd] = useState("5");
  const [ext, setExt] = useState("");
  const [obs, setObs] = useState("");
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!modo) return;
    setHotel(prefill?.hotel_cidade ?? ""); setCi((prefill?.check_in ?? "").slice(0, 10)); setCo((prefill?.check_out ?? "").slice(0, 10));
    setTipo("Duplo"); setQtd(prefill || modo === "novo" ? "1" : "5"); setExt(prefill?.extensao_id ?? ""); setObs(""); setErros({});
  }, [modo, prefill]);

  const auto = modo === "auto";
  async function salvar() {
    const e: Record<string, string> = {};
    const n = Number(qtd);
    if (auto) {
      if (!hotel.trim()) e.hotel = "Informe o hotel/cidade";
      if (!ci) e.ci = "Informe o check-in";
      if (!co) e.co = "Informe o check-out";
      if (!Number.isInteger(n) || n < 1) e.qtd = "Mínimo 1";
      else if (n > 100) e.qtd = "Máximo 100";
    }
    if (ci && co && co < ci) e.co = "O check-out não pode ser antes do check-in.";
    setErros(e);
    if (Object.keys(e).length) return;
    setSalvando(true);
    try {
      const criados = await criarQuartos({ expId, hotel, checkIn: ci, checkOut: co, tipo, quantidade: auto ? n : 1, extensaoId: ext || null, observacoes: auto ? null : obs });
      avisar(auto ? `${criados} quarto(s) criado(s)` : "Quarto criado");
      onSalvo(); onFechar();
    } catch (er) { avisar(erroDe(er), "erro"); } finally { setSalvando(false); }
  }

  const titulo = !auto ? "Novo quarto" : prefill ? "Adicionar quartos ao hotel" : "Criar quartos automaticamente";
  const sub = !auto
    ? "O número do quarto é dado automaticamente: o próximo da sequência do hotel."
    : prefill
      ? `Adiciona quartos a ${prefill.hotel_cidade || "este hotel"} (mesmas datas). Os números continuam a sequência do hotel.`
      : "Cria vários quartos do mesmo tipo para um hotel de uma vez. Os números continuam a sequência do hotel.";
  return (
    <Gaveta aberta={modo !== null} titulo={titulo} subtitulo={sub} onFechar={onFechar} largura={480}
      rodape={<>
        <Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Criando…" : auto ? "Criar quartos" : "Criar quarto"}</Botao>
      </>}>
      <div className="space-y-3">
        <Campo rotulo="Hotel / Cidade" erro={erros.hotel}>
          <Entrada value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="Hotel Casa Andina — Cusco" autoFocus />
        </Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Check-in" erro={erros.ci}><Entrada type="date" value={ci} onChange={(e) => setCi(e.target.value)} /></Campo>
          <Campo rotulo="Check-out" erro={erros.co}><Entrada type="date" value={co} min={ci || undefined} onChange={(e) => setCo(e.target.value)} /></Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Tipo do quarto"><Escolha rotulo="Tipo do quarto" valor={tipo} onMudar={setTipo} opcoes={OPCOES_TIPO} /></Campo>
          {auto && (
            <Campo rotulo="Quantos quartos" erro={erros.qtd}>
              <Entrada type="number" min={1} max={100} value={qtd} onChange={(e) => setQtd(e.target.value)} />
            </Campo>
          )}
        </div>
        <CampoExtensao extensoes={extensoes} valor={ext} onMudar={setExt} />
        {!auto && (
          <Campo rotulo="Observações">
            <textarea className="rel-input" rows={2} value={obs} onChange={(e) => setObs(e.target.value)} />
          </Campo>
        )}
      </div>
    </Gaveta>
  );
}

// ---------------------------------------------------------------------------
// Editar quarto
// ---------------------------------------------------------------------------
export function GavetaEditarQuarto({ quarto, ocupantes, extensoes, onFechar, onSalvo }: {
  quarto: QuartoRow | null; ocupantes: number; extensoes: { id: string; nome: string }[]; onFechar: () => void; onSalvo: () => void;
}) {
  const { avisar } = useExp();
  const inicial = () => ({
    tipo: quarto?.tipo ?? "Duplo", hotel: quarto?.hotel_cidade ?? "", ci: quarto?.check_in?.slice(0, 10) ?? "", co: quarto?.check_out?.slice(0, 10) ?? "",
    ext: quarto?.extensao_id ?? "", status: quarto && quartoCancelado(quarto) ? "cancelado" : "ativo", obs: quarto?.observacoes ?? "",
  });
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (quarto) setF(inicial()); }, [quarto]); // eslint-disable-line react-hooks/exhaustive-deps
  const mudou = quarto ? JSON.stringify(f) !== JSON.stringify(inicial()) : false;
  const set = (k: keyof ReturnType<typeof inicial>) => (v: string) => setF((s) => ({ ...s, [k]: v }));
  const cancelando = f.status === "cancelado" && quarto && !quartoCancelado(quarto) && ocupantes > 0;
  const mudaHotel = quarto && (f.hotel.trim().replace(/\s+/g, " ") !== (quarto.hotel_cidade ?? "").trim().replace(/\s+/g, " ")
    || f.ci !== (quarto.check_in ?? "").slice(0, 10) || f.co !== (quarto.check_out ?? "").slice(0, 10) || f.ext !== (quarto.extensao_id ?? ""));

  async function salvar() {
    if (!quarto) return;
    if (f.ci && f.co && f.co < f.ci) { avisar("O check-out não pode ser antes do check-in.", "erro"); return; }
    setSalvando(true);
    try {
      await atualizarQuarto({ quartoId: quarto.id, tipo: f.tipo, hotel: f.hotel, checkIn: f.ci, checkOut: f.co, extensaoId: f.ext || null, status: f.status, observacoes: f.obs });
      avisar("Quarto atualizado");
      onSalvo(); onFechar();
    } catch (er) { avisar(erroDe(er), "erro"); } finally { setSalvando(false); }
  }

  return (
    <Gaveta aberta={quarto !== null} titulo="Editar quarto" onFechar={onFechar} largura={480}
      rodape={<>
        <Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={salvando || !mudou} onClick={salvar}>{salvando ? "Salvando…" : "Salvar alterações"}</Botao>
      </>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Número</span>
            <div className="rel-input" style={{ background: "var(--card2)", color: "var(--ink2)" }}>Quarto {quarto?.numero ?? "—"}</div>
            <span className="block text-[11px] mt-1" style={{ color: "var(--ink3)" }}>Numeração automática — não editável.</span>
          </div>
          <Campo rotulo="Tipo"><Escolha rotulo="Tipo" valor={f.tipo} onMudar={set("tipo")} opcoes={OPCOES_TIPO} /></Campo>
        </div>
        <Campo rotulo="Hotel / Cidade"><Entrada value={f.hotel} onChange={(e) => set("hotel")(e.target.value)} /></Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Check-in"><Entrada type="date" value={f.ci} onChange={(e) => set("ci")(e.target.value)} /></Campo>
          <Campo rotulo="Check-out"><Entrada type="date" value={f.co} min={f.ci || undefined} onChange={(e) => set("co")(e.target.value)} /></Campo>
        </div>
        <CampoExtensao extensoes={extensoes} valor={f.ext} onMudar={set("ext")} />
        {mudaHotel && (
          <p className="text-[12px] rounded-lg px-3 py-2" style={{ background: "var(--card2)", color: "var(--ink2)" }}>
            O quarto vai para outro hotel e ganha o próximo número de lá. Quem já tiver quarto no hotel de destino continua no quarto que já tinha.
          </p>
        )}
        <Campo rotulo="Status">
          <Escolha rotulo="Status" valor={f.status} onMudar={set("status")} opcoes={[{ v: "ativo", r: "Ativo" }, { v: "cancelado", r: "Cancelado" }]} />
        </Campo>
        {cancelando && (
          <p className="text-[12px] rounded-lg px-3 py-2" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
            Ao cancelar, {ocupantes} passageiro(s) saem deste quarto e voltam para "Sem quarto". Quarto cancelado não recebe ninguém e não entra no Excel.
          </p>
        )}
        <Campo rotulo="Observações"><textarea className="rel-input" rows={2} value={f.obs} onChange={(e) => set("obs")(e.target.value)} /></Campo>
      </div>
    </Gaveta>
  );
}

// ---------------------------------------------------------------------------
// Duplicar quarto / hotel
// ---------------------------------------------------------------------------
export interface OrigemDuplicar { quartoIds: string[]; hotelOrigem: string | null }

export function GavetaDuplicar({ expId, origem, onFechar, onSalvo }: { expId: string; origem: OrigemDuplicar | null; onFechar: () => void; onSalvo: () => void }) {
  const { avisar } = useExp();
  const [hotel, setHotel] = useState("");
  const [ci, setCi] = useState("");
  const [co, setCo] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (origem) { setHotel(""); setCi(""); setCo(""); } }, [origem]);
  const umQuarto = (origem?.quartoIds.length ?? 0) === 1;
  const de = origem?.hotelOrigem ? ` de "${origem.hotelOrigem}"` : "";

  async function salvar() {
    if (!origem) return;
    if (ci && co && co < ci) { avisar("O check-out não pode ser antes do check-in.", "erro"); return; }
    setSalvando(true);
    try {
      const n = await duplicarQuartos(expId, origem.quartoIds, hotel, ci, co);
      avisar(umQuarto ? "Quarto duplicado com os mesmos passageiros" : `Hotel duplicado — ${n ?? 0} quarto(s) com os mesmos passageiros`);
      onSalvo(); onFechar();
    } catch (er) { avisar(erroDe(er), "erro"); } finally { setSalvando(false); }
  }

  return (
    <Gaveta aberta={origem !== null} titulo={umQuarto ? "Duplicar quarto" : "Duplicar hotel"} onFechar={onFechar} largura={480}
      subtitulo={umQuarto
        ? `Copia este quarto${de} para um novo hotel, com o(s) mesmo(s) passageiro(s). Não muda nada na origem.`
        : `Copia os ${origem?.quartoIds.length ?? 0} quarto(s)${de} para um novo hotel, com os mesmos passageiros. Não muda nada no hotel de origem.`}
      rodape={<>
        <Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={salvando || !hotel.trim()} onClick={salvar}>{salvando ? "Duplicando…" : "Duplicar"}</Botao>
      </>}>
      <div className="space-y-3">
        <Campo rotulo="Novo hotel / cidade"><Entrada value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="Ex.: Resort All Inclusive - Hurghada" autoFocus /></Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Check-in"><Entrada type="date" value={ci} onChange={(e) => setCi(e.target.value)} /></Campo>
          <Campo rotulo="Check-out"><Entrada type="date" value={co} min={ci || undefined} onChange={(e) => setCo(e.target.value)} /></Campo>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
          Se alguém já tiver quarto no hotel de destino, continua no quarto que já tinha (não é copiado de novo).
        </p>
      </div>
    </Gaveta>
  );
}

// ---------------------------------------------------------------------------
// Conexão "viajam juntas"
// ---------------------------------------------------------------------------
export function GavetaConexao({ expId, passageiros, membrosIniciais, onFechar, onSalvo }: {
  expId: string; passageiros: PassageiroRow[]; membrosIniciais: string[] | null; onFechar: () => void; onSalvo: () => void;
}) {
  const { avisar } = useExp();
  const editando = (membrosIniciais?.length ?? 0) > 0;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => { if (membrosIniciais) { setSel(new Set(membrosIniciais)); setBusca(""); } }, [membrosIniciais]);
  const alternar = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const termo = busca.trim().toLowerCase();
  const filtrados = passageiros
    .filter((p) => !termo || p.nome_completo.toLowerCase().includes(termo))
    .sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, "pt-BR"));

  async function salvar() {
    const selecionados = [...sel];
    if (!editando && selecionados.length < 2) { avisar("Selecione ao menos 2 pessoas que viajam juntas.", "erro"); return; }
    setSalvando(true);
    try {
      const removidos = (membrosIniciais ?? []).filter((id) => !sel.has(id));
      await salvarConexao(expId, removidos, selecionados.length >= 2 ? selecionados : []);
      avisar(editando ? "Conexão atualizada" : "Conexão criada");
      onSalvo(); onFechar();
    } catch (er) { avisar(erroDe(er), "erro"); } finally { setSalvando(false); }
  }

  return (
    <Gaveta aberta={membrosIniciais !== null} titulo={editando ? "Editar conexão" : "Nova conexão (viajam juntas)"} onFechar={onFechar} largura={460}
      subtitulo="Marque as pessoas que viajam juntas (casal, família, amigos). Elas ficam sempre no mesmo quarto."
      rodape={<>
        <Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : editando ? "Salvar conexão" : "Criar conexão"}</Botao>
      </>}>
      <input type="search" className="rel-input mb-2" placeholder="Buscar passageiro…" value={busca} onChange={(e) => setBusca(e.target.value)} />
      <p className="text-[11px] mb-2" style={{ color: "var(--ink3)" }}>
        {sel.size} selecionada(s){editando && sel.size < 2 ? " — com menos de 2, a conexão é desfeita" : ""}
      </p>
      <div className="space-y-1">
        {filtrados.map((p) => {
          const marcado = sel.has(p.id);
          return (
            <button key={p.id} type="button" onClick={() => alternar(p.id)}
              className="flex w-full items-center gap-2 rounded-lg p-2 text-left"
              style={{ border: `1px solid ${marcado ? "var(--rel)" : "var(--line)"}`, background: marcado ? "var(--rel-soft)" : "var(--card)" }}>
              <input type="checkbox" readOnly checked={marcado} tabIndex={-1} className="pointer-events-none" />
              <Avatar nome={p.nome_completo} tamanho={22} />
              <span className="flex-1 min-w-0">
                <span className="block text-[12.5px] font-semibold truncate" style={{ color: "var(--ink)" }}>{p.nome_completo}</span>
                <span className="block text-[10.5px]" style={{ color: "var(--ink3)" }}>{p.tipo}</span>
              </span>
            </button>
          );
        })}
        {filtrados.length === 0 && <p className="text-[12px] py-4 text-center" style={{ color: "var(--ink3)" }}>Nenhum passageiro encontrado.</p>}
      </div>
    </Gaveta>
  );
}
