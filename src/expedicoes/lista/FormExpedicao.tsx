// src/expedicoes/lista/FormExpedicao.tsx
// Nova expedição/pacote (gera o checklist padrão junto, numa transação — 0162)
// e Editar (mesmos campos do app antigo). Concluir confirma os passageiros.
import { useEffect, useMemo, useState } from "react";
import { Botao, Campo, Entrada } from "@/rel/ui";
import { Gaveta } from "../ui";
import { useExp } from "../contexto";
import { supabase, traduzirErro } from "../lib/banco";
import { generateExpedicaoCodigo } from "../lib/utils";
import { STATUS_EXPEDICAO } from "../lib/constants";
import { REQUISITOS_POR_DESTINO } from "../lib/prontidao/requisitos-destino";
import { construirChecklistPadrao } from "../lib/processos/template";
import type { ExpedicaoRow, PapelUsuario } from "../lib/database";

const DESTINOS = Object.keys(REQUISITOS_POR_DESTINO);

export function rotulosDoTipo(tipo: "expedicao" | "pacote") {
  return tipo === "pacote"
    ? { titulo: "Pacotes", sing: "pacote", plur: "pacotes", novo: "Novo pacote" }
    : { titulo: "Expedições", sing: "expedição", plur: "expedições", novo: "Nova expedição" };
}

/** "Concluída" confirma todos os passageiros não cancelados (regra do app antigo). */
export async function aoConcluir(expedicaoId: string) {
  await supabase.from("passageiros").update({ status_reserva: "Confirmado" })
    .eq("expedicao_id", expedicaoId).neq("status_reserva", "Cancelado");
}

export async function salvarCampoExpedicao(id: string, campo: string, valor: unknown) {
  const { error } = await supabase.from("expedicoes").update({ [campo]: valor }).eq("id", id);
  if (error) throw new Error(traduzirErro(error.message));
  if (campo === "status" && valor === "Concluída") await aoConcluir(id);
}

export function NovaExpedicao({ aberta, tipo, onFechar, onCriada }: {
  aberta: boolean; tipo: "expedicao" | "pacote"; onFechar: () => void; onCriada: (id: string) => void;
}) {
  const { usuarios, avisar } = useExp();
  const r = rotulosDoTipo(tipo);
  const vazio = { nome: "", destino: "", data_embarque: "", data_retorno: "", op: "", com: "", pax: "20" };
  const [f, setF] = useState(vazio);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [sufixo] = useState(() => Math.random().toString(36).slice(2, 6).toUpperCase());
  useEffect(() => { if (aberta) { setF(vazio); setErro(null); } }, [aberta]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = f.destino && f.data_embarque ? generateExpedicaoCodigo(f.destino, f.data_embarque) : "";
  const codigo = tipo === "pacote" ? (base ? `PAC-${base}-${sufixo}` : "") : base;

  const criar = async () => {
    if (f.nome.trim().length < 3) return setErro("Nome: mínimo 3 caracteres.");
    if (f.destino.trim().length < 2) return setErro("Informe o destino.");
    if (!f.data_embarque || !f.data_retorno) return setErro("Informe embarque e retorno.");
    if (f.data_retorno < f.data_embarque) return setErro("O retorno não pode ser antes do embarque.");
    const pax = Number(f.pax);
    if (!Number.isInteger(pax) || pax < 1) return setErro("Pax planejados: mínimo 1.");
    setErro(null); setSalvando(true);
    try {
      let itens: unknown[] = [];
      if (tipo === "expedicao") {
        // Responsável padrão = primeiro usuário de cada papel (igual ao antigo).
        const porPapel: Partial<Record<PapelUsuario, string>> = {};
        for (const u of usuarios) if (!porPapel[u.papel]) porPapel[u.papel] = u.id;
        const linhas = construirChecklistPadrao({ expedicaoId: "x", dataEmbarque: f.data_embarque, responsavelPorPapel: porPapel });
        const idReal = new Map(linhas.map((l) => [l.id, crypto.randomUUID()]));
        itens = linhas.map((l) => ({ id: idReal.get(l.id), etapa: l.etapa, tarefa: l.tarefa, responsavel_id: l.responsavel_id, prazo: l.prazo,
          prioridade: l.prioridade, parent_id: l.parent_id ? idReal.get(l.parent_id) : null, ordem: l.ordem }));
      }
      const { data, error } = await supabase.rpc("exp_criar_expedicao", {
        p_exp: { codigo, nome: f.nome.trim(), destino: f.destino.trim(), data_embarque: f.data_embarque, data_retorno: f.data_retorno,
          responsavel_operacional_id: f.op, responsavel_comercial_id: f.com, pax_planejados: pax, tipo },
        p_itens: itens,
      });
      if (error) throw new Error(traduzirErro(error.message));
      avisar(tipo === "pacote" ? `Pacote criado · ${codigo}` : `Expedição criada · ${codigo} · checklist padrão gerado`);
      onCriada(data as string);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao criar");
    } finally { setSalvando(false); }
  };

  return (
    <Gaveta aberta={aberta} titulo={r.novo} subtitulo={codigo ? <span className="font-mono">{tipo === "pacote" ? codigo.replace(sufixo, "••••") : codigo}</span> : undefined}
      onFechar={onFechar} rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={criar}>{salvando ? "Criando…" : "Criar"}</Botao></>}>
      <div className="space-y-3.5">
        <Campo rotulo="Nome"><Entrada value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Ex.: Peru Sagrado — Agosto" /></Campo>
        <Campo rotulo="Destino" dica="Cadastrados aparecem como sugestão (com condicionais próprias); outros destinos caem nos requisitos internacionais padrão.">
          <Entrada list="exp-destinos" value={f.destino} onChange={(e) => setF({ ...f, destino: e.target.value })} />
          <datalist id="exp-destinos">{DESTINOS.map((d) => <option key={d} value={d} />)}</datalist>
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo rotulo="Embarque"><Entrada type="date" value={f.data_embarque} onChange={(e) => setF({ ...f, data_embarque: e.target.value })} /></Campo>
          <Campo rotulo="Retorno"><Entrada type="date" value={f.data_retorno} onChange={(e) => setF({ ...f, data_retorno: e.target.value })} /></Campo>
        </div>
        <SelectResponsaveis op={f.op} com={f.com} onOp={(v) => setF({ ...f, op: v })} onCom={(v) => setF({ ...f, com: v })} />
        <Campo rotulo="Pax planejados"><Entrada type="number" min={1} value={f.pax} onChange={(e) => setF({ ...f, pax: e.target.value })} /></Campo>
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          {tipo === "expedicao"
            ? "O checklist padrão (23 processos operacionais das 5 fases, com prazos calculados a partir do embarque) é gerado automaticamente."
            : "Pacote personalizado: sem checklist de grupo, rooming nem roteiro do líder."}
        </p>
        {erro && <p className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      </div>
    </Gaveta>
  );
}

function SelectResponsaveis({ op, com, onOp, onCom }: { op: string; com: string; onOp: (v: string) => void; onCom: (v: string) => void }) {
  const { usuarios } = useExp();
  const ops = useMemo(() => usuarios.filter((u) => u.papel === "operacional" || u.papel === "admin"), [usuarios]);
  const coms = useMemo(() => usuarios.filter((u) => u.papel === "comercial" || u.papel === "admin"), [usuarios]);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Campo rotulo="Resp. operacional">
        <select className="rel-input" value={op} onChange={(e) => onOp(e.target.value)}>
          <option value="">— sem responsável —</option>
          {ops.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
      </Campo>
      <Campo rotulo="Resp. comercial">
        <select className="rel-input" value={com} onChange={(e) => onCom(e.target.value)}>
          <option value="">— sem responsável —</option>
          {coms.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
      </Campo>
    </div>
  );
}

export function EditarExpedicao({ exp, onFechar, onSalva }: { exp: ExpedicaoRow | null; onFechar: () => void; onSalva: () => void }) {
  const { avisar } = useExp();
  const [f, setF] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!exp) return;
    setErro(null);
    setF({
      nome: exp.nome, destino: exp.destino, data_embarque: exp.data_embarque, data_retorno: exp.data_retorno, status: exp.status,
      pax_planejados: String(exp.pax_planejados ?? 0), pax_cortesia: String(exp.pax_cortesia ?? 0), preco_venda_brl: String(exp.preco_venda_brl ?? 0),
      observacoes: exp.observacoes ?? "", op: exp.responsavel_operacional_id ?? "", com: exp.responsavel_comercial_id ?? "",
    });
  }, [exp]);
  if (!exp) return null;
  const salvar = async () => {
    if ((f.nome ?? "").trim().length < 3) return setErro("Nome: mínimo 3 caracteres.");
    if ((f.destino ?? "").trim().length < 2) return setErro("Informe o destino.");
    if (f.data_retorno < f.data_embarque) return setErro("O retorno não pode ser antes do embarque.");
    const nums = ["pax_planejados", "pax_cortesia", "preco_venda_brl"].map((k) => Number(String(f[k]).replace(",", ".")));
    if (nums.some((n) => Number.isNaN(n) || n < 0)) return setErro("Números não podem ser negativos.");
    setErro(null); setSalvando(true);
    try {
      const { error } = await supabase.from("expedicoes").update({
        nome: f.nome.trim(), destino: f.destino.trim(), data_embarque: f.data_embarque, data_retorno: f.data_retorno, status: f.status,
        pax_planejados: Math.trunc(nums[0]), pax_cortesia: Math.trunc(nums[1]), preco_venda_brl: nums[2],
        observacoes: f.observacoes.trim() || null, responsavel_operacional_id: f.op || null, responsavel_comercial_id: f.com || null,
      }).eq("id", exp.id);
      if (error) throw new Error(traduzirErro(error.message));
      if (f.status === "Concluída") await aoConcluir(exp.id);
      avisar(exp.tipo === "pacote" ? "Pacote atualizado" : "Expedição atualizada");
      onSalva();
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao salvar"); } finally { setSalvando(false); }
  };
  const campo = (k: string, rotulo: string, tipo = "text") => (
    <Campo rotulo={rotulo}><Entrada type={tipo} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Campo>
  );
  return (
    <Gaveta aberta titulo={`Editar ${exp.tipo === "pacote" ? "pacote" : "expedição"}`} subtitulo={<span className="font-mono">{exp.codigo}</span>} onFechar={onFechar}
      rodape={<><Botao onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : "Salvar alterações"}</Botao></>}>
      <div className="space-y-3.5">
        {campo("nome", "Nome")}
        {campo("destino", "Destino")}
        <div className="grid grid-cols-2 gap-3">{campo("data_embarque", "Embarque", "date")}{campo("data_retorno", "Retorno", "date")}</div>
        <Campo rotulo="Status">
          <select className="rel-input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            {STATUS_EXPEDICAO.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Campo>
        <div className="grid grid-cols-3 gap-3">{campo("pax_planejados", "Pax planejados", "number")}{campo("pax_cortesia", "Cortesias", "number")}{campo("preco_venda_brl", "Preço (R$)", "number")}</div>
        <SelectResponsaveis op={f.op ?? ""} com={f.com ?? ""} onOp={(v) => setF({ ...f, op: v })} onCom={(v) => setF({ ...f, com: v })} />
        <Campo rotulo="Observações"><textarea className="rel-input" rows={3} value={f.observacoes ?? ""} onChange={(e) => setF({ ...f, observacoes: e.target.value })} /></Campo>
        {f.status === "Concluída" && exp.status !== "Concluída" && (
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Ao concluir, todos os passageiros não cancelados viram “Confirmado”.</p>
        )}
        {erro && <p className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      </div>
    </Gaveta>
  );
}
