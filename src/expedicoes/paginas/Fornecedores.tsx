// src/expedicoes/paginas/Fornecedores.tsx
// Fornecedores (app antigo: app/(app)/fornecedores/ — FornecedoresTabela,
// FornecedorDrawer, actions.ts): busca, filtro por tipo, tabela, criar/editar na
// gaveta e excluir (bloqueado se o fornecedor estiver em algum custo). Atualiza
// sozinha (realtime). Correção: a coluna "Histórico" conta as expedições REAIS em
// que o fornecedor aparece nos custos (no antigo lia dados fictícios).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Botao, Campo, Entrada, Vazio } from "@/rel/ui";
import { useExp } from "../contexto";
import { BotaoExcluir, Busca, Carregando, Gaveta, Selo, useAoVivo, type Tom } from "../ui";
import { lerTudo, supabase, traduzirErro } from "../lib/banco";
import { MOEDAS, STATUS_FORNECEDOR, TIPO_FORNECEDOR } from "../lib/constants";
import type { FornecedorRow, StatusFornecedor, TipoFornecedor } from "../lib/database";

const TOM_STATUS: Record<StatusFornecedor, Tom> = { Ativo: "ok", Pausado: "aviso", Bloqueado: "erro" };

export default function Fornecedores() {
  const { somenteLeitura } = useExp();
  const [lista, setLista] = useState<FornecedorRow[] | null>(null);
  const [historico, setHistorico] = useState<Record<string, number>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState<string | null>(null);
  const [gaveta, setGaveta] = useState<{ aberta: boolean; f: FornecedorRow | null }>({ aberta: false, f: null });

  const carregar = useCallback(async () => {
    try {
      const [fs, custos] = await Promise.all([
        lerTudo<FornecedorRow>("fornecedores"),
        lerTudo<{ id: string; fornecedor_id: string | null; expedicao_id: string }>("custos", (q) => q.not("fornecedor_id", "is", null), "id, fornecedor_id, expedicao_id"),
      ]);
      const porForn = new Map<string, Set<string>>();
      for (const c of custos) { if (!c.fornecedor_id) continue; const s = porForn.get(c.fornecedor_id) ?? new Set(); s.add(c.expedicao_id); porForn.set(c.fornecedor_id, s); }
      setHistorico(Object.fromEntries([...porForn].map(([k, s]) => [k, s.size])));
      setLista(fs.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))); setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "fornecedores" }], carregar, 300);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (lista ?? []).filter((f) => {
      if (tipo && f.tipo !== tipo) return false;
      if (q && !`${f.nome} ${f.contato_nome ?? ""} ${f.destino_cidade ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lista, busca, tipo]);

  const excluir = async (f: FornecedorRow) => {
    const { count, error } = await supabase.from("custos").select("id", { count: "exact", head: true }).eq("fornecedor_id", f.id);
    if (error) throw new Error(traduzirErro(error.message));
    if ((count ?? 0) > 0) throw new Error(`Fornecedor usado em ${count} custo(s). Remova ou substitua antes.`);
    const { error: e2 } = await supabase.from("fornecedores").delete().eq("id", f.id);
    if (e2) throw new Error(traduzirErro(e2.message));
    void carregar();
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-[22px] font-bold" style={{ color: "var(--ink)" }}>Fornecedores</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>{lista ? `${filtrados.length} de ${lista.length}` : "…"}</p>
        </div>
        <div className="w-full sm:w-64"><Busca valor={busca} onMudar={setBusca} placeholder="Buscar (nome, contato, cidade)…  [/]" /></div>
        {!somenteLeitura && <Botao variante="primario" onClick={() => setGaveta({ aberta: true, f: null })}>+ Novo fornecedor</Botao>}
      </header>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide mr-1" style={{ color: "var(--ink3)" }}>Tipo:</span>
        <Chip ativo={tipo === null} onClick={() => setTipo(null)}>Todos</Chip>
        {TIPO_FORNECEDOR.map((t) => <Chip key={t} ativo={tipo === t} onClick={() => setTipo(tipo === t ? null : t)}>{t}</Chip>)}
      </div>

      {erro && <p className="text-[13px]" style={{ color: "var(--err-ink)" }}>{erro}</p>}
      {!lista ? <Carregando /> : lista.length === 0 ? (
        <div className="rel-card">
          <Vazio titulo="Nenhum fornecedor ainda" texto="Hotéis, DMCs, transportes e guias dos destinos. Cadastre os parceiros para usar nos custos e pagamentos das expedições."
            acao={!somenteLeitura ? <Botao variante="primario" onClick={() => setGaveta({ aberta: true, f: null })}>Novo fornecedor</Botao> : undefined} />
        </div>
      ) : filtrados.length === 0 ? (
        <div className="rel-card py-10 text-center text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum resultado.</div>
      ) : (
        <div className="rel-card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px]" style={{ color: "var(--ink3)" }}>
                {["Nome", "Tipo", "Cidade / Destino", "Contato", "WhatsApp", "Moeda", "Status", "Histórico", ""].map((h, i) => <th key={i} className={`px-3 py-2 font-semibold ${h === "Histórico" ? "text-right" : ""}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((f) => {
                const usado = historico[f.id] ?? 0;
                return (
                  <tr key={f.id} className="border-t rel-linha" style={{ borderColor: "var(--line)" }}>
                    <td className="px-3 py-2 font-semibold" style={{ color: "var(--ink)" }}>{f.nome}</td>
                    <td className="px-3 py-2"><Selo tom="lista">{f.tipo}</Selo></td>
                    <td className="px-3 py-2" style={{ color: "var(--ink2)" }}>{f.destino_cidade ?? "—"}</td>
                    <td className="px-3 py-2">
                      <div className="text-[12.5px]">{f.contato_nome ?? "—"}</div>
                      {f.contato_email && <div className="text-[11px]" style={{ color: "var(--ink3)" }}>{f.contato_email}</div>}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-[12.5px] whitespace-nowrap">{f.contato_whatsapp ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{f.moeda_padrao}</td>
                    <td className="px-3 py-2"><Selo tom={TOM_STATUS[f.status] ?? "neutro"}>{f.status}</Selo></td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap" style={{ color: "var(--ink3)" }}>{usado} expediç{usado === 1 ? "ão" : "ões"}</td>
                    <td className="px-2 py-2 whitespace-nowrap text-right">
                      {!somenteLeitura && <button className="p-1" aria-label="Editar fornecedor" title="Editar" style={{ color: "var(--ink3)" }} onClick={() => setGaveta({ aberta: true, f })}>✎</button>}
                      <BotaoExcluir titulo={`Excluir "${f.nome}"?`} sucesso="Fornecedor excluído" onConfirmar={() => excluir(f)}
                        descricao="Remove o fornecedor da base. Não dá pra desfazer." />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <GavetaFornecedor aberta={gaveta.aberta} fornecedor={gaveta.f} onFechar={() => setGaveta({ aberta: false, f: null })} onSalvo={() => { setGaveta({ aberta: false, f: null }); void carregar(); }} />
    </div>
  );
}

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: string }) {
  return (
    <button onClick={onClick} aria-pressed={ativo} className="px-2.5 py-1 rounded-full text-[12px] font-semibold border"
      style={ativo ? { background: "var(--ink)", color: "var(--bg)", borderColor: "var(--ink)" } : { background: "var(--card)", color: "var(--ink2)", borderColor: "var(--line)" }}>
      {children}
    </button>
  );
}

type Form = {
  nome: string; tipo: TipoFornecedor; status: StatusFornecedor; destino_cidade: string; moeda_padrao: string;
  contato_nome: string; contato_email: string; contato_whatsapp: string; politica_pagamento: string; observacoes: string;
};
const VAZIO: Form = { nome: "", tipo: "DMC", status: "Ativo", destino_cidade: "", moeda_padrao: "BRL", contato_nome: "", contato_email: "", contato_whatsapp: "", politica_pagamento: "", observacoes: "" };
const deRow = (f: FornecedorRow): Form => ({
  nome: f.nome, tipo: f.tipo, status: f.status, destino_cidade: f.destino_cidade ?? "", moeda_padrao: f.moeda_padrao,
  contato_nome: f.contato_nome ?? "", contato_email: f.contato_email ?? "", contato_whatsapp: f.contato_whatsapp ?? "",
  politica_pagamento: f.politica_pagamento ?? "", observacoes: f.observacoes ?? "",
});

function GavetaFornecedor({ aberta, fornecedor, onFechar, onSalvo }: { aberta: boolean; fornecedor: FornecedorRow | null; onFechar: () => void; onSalvo: () => void }) {
  const { avisar } = useExp();
  const [form, setForm] = useState<Form>(VAZIO);
  const [inicial, setInicial] = useState<Form>(VAZIO);
  const [erros, setErros] = useState<Partial<Record<keyof Form, string>>>({});
  const [salvando, setSalvando] = useState(false);
  const editando = Boolean(fornecedor);

  useEffect(() => {
    if (!aberta) return;
    const f = fornecedor ? deRow(fornecedor) : VAZIO;
    setForm(f); setInicial(f); setErros({});
  }, [aberta, fornecedor]);

  const mudou = JSON.stringify(form) !== JSON.stringify(inicial);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((s) => ({ ...s, [k]: v }));

  const salvar = async () => {
    const e: Partial<Record<keyof Form, string>> = {};
    if (form.nome.trim().length < 2) e.nome = "Nome obrigatório";
    if (form.contato_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contato_email.trim())) e.contato_email = "E-mail inválido";
    setErros(e);
    if (Object.keys(e).length) return;
    const t = (s: string) => s.trim() || null;
    const dados = {
      nome: form.nome.trim(), tipo: form.tipo, status: form.status, moeda_padrao: form.moeda_padrao || "BRL",
      destino_cidade: t(form.destino_cidade), contato_nome: t(form.contato_nome), contato_email: t(form.contato_email),
      contato_whatsapp: t(form.contato_whatsapp), politica_pagamento: t(form.politica_pagamento), observacoes: t(form.observacoes),
    };
    setSalvando(true);
    const { error } = fornecedor
      ? await supabase.from("fornecedores").update(dados).eq("id", fornecedor.id)
      : await supabase.from("fornecedores").insert(dados);
    setSalvando(false);
    if (error) { avisar(traduzirErro(error.message), "erro"); return; }
    avisar(editando ? "Fornecedor atualizado" : "Fornecedor criado");
    onSalvo();
  };

  return (
    <Gaveta aberta={aberta} titulo={editando ? "Editar fornecedor" : "Novo fornecedor"} onFechar={onFechar} largura={520}
      rodape={<>
        <Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={salvando || (editando && !mudou)} onClick={salvar}>{salvando ? "Salvando…" : editando ? "Salvar alterações" : "Criar fornecedor"}</Botao>
      </>}>
      <div className="space-y-3">
        <Campo rotulo="Nome" erro={erros.nome}><Entrada autoFocus value={form.nome} placeholder="Andean DMC" onChange={(e) => set("nome", e.target.value)} /></Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Tipo"><select className="rel-input" value={form.tipo} onChange={(e) => set("tipo", e.target.value as TipoFornecedor)}>{TIPO_FORNECEDOR.map((x) => <option key={x}>{x}</option>)}</select></Campo>
          <Campo rotulo="Status"><select className="rel-input" value={form.status} onChange={(e) => set("status", e.target.value as StatusFornecedor)}>{STATUS_FORNECEDOR.map((x) => <option key={x}>{x}</option>)}</select></Campo>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Cidade / Destino"><Entrada value={form.destino_cidade} placeholder="Cusco" onChange={(e) => set("destino_cidade", e.target.value)} /></Campo>
          <Campo rotulo="Moeda padrão"><select className="rel-input" value={form.moeda_padrao} onChange={(e) => set("moeda_padrao", e.target.value)}>{MOEDAS.map((x) => <option key={x}>{x}</option>)}</select></Campo>
        </div>
        <p className="pt-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>Contato</p>
        <Campo rotulo="Nome do contato"><Entrada value={form.contato_nome} placeholder="Diego Quispe" onChange={(e) => set("contato_nome", e.target.value)} /></Campo>
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="E-mail" erro={erros.contato_email}><Entrada type="email" value={form.contato_email} placeholder="contato@..." onChange={(e) => set("contato_email", e.target.value)} /></Campo>
          <Campo rotulo="WhatsApp"><Entrada value={form.contato_whatsapp} placeholder="+51 984 123 456" onChange={(e) => set("contato_whatsapp", e.target.value)} /></Campo>
        </div>
        <Campo rotulo="Política de pagamento"><Entrada value={form.politica_pagamento} placeholder="30% sinal, 70% até 30 dias antes" onChange={(e) => set("politica_pagamento", e.target.value)} /></Campo>
        <Campo rotulo="Observações"><textarea className="rel-input" rows={3} value={form.observacoes} onChange={(e) => set("observacoes", e.target.value)} /></Campo>
      </div>
    </Gaveta>
  );
}
