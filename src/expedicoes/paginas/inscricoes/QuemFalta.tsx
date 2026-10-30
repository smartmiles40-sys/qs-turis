// src/expedicoes/paginas/inscricoes/QuemFalta.tsx
// -----------------------------------------------------------------------------
// FORMULÁRIO: QUEM JÁ RESPONDEU × QUEM FALTA (Bruno, 30/10) — por expedição E por
// pacote, com contagem regressiva até o embarque e o lembrete pronto pra copiar.
// Nada é enviado daqui: copia a mensagem (e, pra admin, gera o link curto /a/ do
// ExpedAmigo pela exp_amigo_gerar_link da 0164, o mesmo da tela Acessos).
//
// "Respondeu" = questionário de saúde preenchido OU a regra do app antigo
// (passageiros/dados.ts → preencheuFormulario). Inscrição do formulário ainda na
// fila de aprovação (mesmo CPF) conta como "respondeu, aguardando aprovação".
//
// PACOTES personalizados (rel_viagens, serviço pacote) só recebem o formulário
// quando viram uma `expedicoes` tipo 'pacote' (rel_viagens.expedicoes_id, 0112):
// o botão "Abrir formulário do pacote" chama exp_pacote_abrir_inscricao (0225).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Vazio } from "@/rel/ui";
import { useExp } from "../../contexto";
import { Carregando, Selo, useAoVivo } from "../../ui";
import { supabase, lerTudo } from "../../lib/banco";
import { esquecer } from "../../lib/cache";
import { dataSP } from "../../lib/fase.ts";
import { formatDate } from "../../lib/utils";
import { soDigitosCpf } from "../../lib/cpf";
import { PORTAL_ANTIGO_URL, copiar, rpc, useEhAdminExp } from "../_admin/comum";
import { diasAte, expedicoesFuturas, lerPassageiros, respondeuFormulario, textoDias, urgencia, type Pax } from "../../lib/saudeFila";
import type { ExpedicaoRow } from "../../lib/database";

interface Linha {
  exp: ExpedicaoRow; dias: number | null;
  respondeu: Pax[]; aguardando: Pax[]; faltam: Pax[]; inscricoesSemPax: number;
}
interface PacoteSolto { id: string; titulo: string; destino: string | null; data_embarque: string | null; cliente_nome: string | null; qtd_passageiros: number | null; dias: number | null }

const COR = { erro: "var(--err-ink)", aviso: "var(--warn-ink)", neutro: "var(--line)" } as const;

export function mensagemLembrete(nome: string, exp: ExpedicaoRow, dias: number | null, link: string): string {
  const primeiro = (nome || "").trim().split(/\s+/)[0] || nome;
  const pacote = exp.tipo === "pacote";
  const quando = exp.data_embarque ? ` — embarque em ${formatDate(exp.data_embarque)}${dias != null && dias >= 0 ? ` (faltam ${dias} dias)` : ""}` : "";
  return `Oi, ${primeiro}! Tudo bem?

Falta só o seu *formulário de inscrição* da ${pacote ? "sua viagem" : "Expedição"} *${exp.nome}*${quando}.

É por ele que a gente organiza documentos, quartos e os cuidados de saúde e alimentação com antecedência. Leva uns 10 minutinhos:
${link}

Entre com seu CPF e senha; o formulário aparece ao abrir o roteiro. Qualquer dúvida, é só chamar aqui! 💚`;
}

export default function QuemFalta() {
  const { avisar, ir, somenteLeitura } = useExp();
  const ehAdmin = useEhAdminExp();
  const hoje = dataSP(new Date());
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [soltos, setSoltos] = useState<PacoteSolto[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<"todos" | "expedicao" | "pacote">("todos");
  const [soPendentes, setSoPendentes] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const exps = await expedicoesFuturas(hoje);
      const [pax, ins] = await Promise.all([
        lerPassageiros(exps.map((e) => e.id)),
        lerTudo<{ expedicao_id: string; cpf: string | null }>("inscricoes_pendentes", (q) => q.eq("status", "pendente"), "id,expedicao_id,cpf"),
      ]);
      const cpfsFila = new Map<string, Set<string>>();
      for (const i of ins) {
        const s = cpfsFila.get(i.expedicao_id) ?? new Set<string>();
        if (i.cpf) s.add(soDigitosCpf(i.cpf));
        cpfsFila.set(i.expedicao_id, s);
      }
      const porExp = new Map<string, Pax[]>();
      for (const p of pax) if (p.expedicao_id) porExp.set(p.expedicao_id, [...(porExp.get(p.expedicao_id) ?? []), p]);
      const out: Linha[] = exps.map((exp) => {
        const l = porExp.get(exp.id) ?? [];
        const fila = cpfsFila.get(exp.id) ?? new Set<string>();
        const respondeu: Pax[] = [], aguardando: Pax[] = [], faltam: Pax[] = [];
        for (const p of l) {
          if (respondeuFormulario(p)) respondeu.push(p);
          else if (p.cpf && fila.has(soDigitosCpf(p.cpf))) aguardando.push(p);
          else faltam.push(p);
        }
        const cpfsPax = new Set(l.map((p) => (p.cpf ? soDigitosCpf(p.cpf) : "")).filter(Boolean));
        const inscricoesSemPax = [...fila].filter((c) => !cpfsPax.has(c)).length;
        faltam.sort((a, b) => a.nome_completo.localeCompare(b.nome_completo, "pt-BR"));
        return { exp, dias: diasAte(hoje, exp.data_embarque), respondeu, aguardando, faltam, inscricoesSemPax };
      }).sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999));
      setLinhas(out);

      // Pacotes personalizados futuros ainda sem `expedicoes` ligada.
      const [{ data: vs }, { data: lig }] = await Promise.all([
        supabase.from("rel_viagens_v").select("id,titulo,destino,data_embarque,cliente_nome,qtd_passageiros")
          .eq("servico", "pacote").neq("status", "arquivada").gte("data_embarque", hoje).limit(500),
        supabase.from("rel_viagens").select("id,expedicoes_id").not("expedicoes_id", "is", null).limit(2000),
      ]);
      const ligadas = new Set((lig ?? []).map((r) => (r as { id: string }).id));
      setSoltos(((vs ?? []) as Omit<PacoteSolto, "dias">[]).filter((v) => !ligadas.has(v.id))
        .map((v) => ({ ...v, dias: diasAte(hoje, v.data_embarque) }))
        .sort((a, b) => (a.dias ?? 9999) - (b.dias ?? 9999)));
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, [hoje]);
  useEffect(() => { void carregar(); }, [carregar]);
  useAoVivo([{ tabela: "passageiros" }, { tabela: "inscricoes_pendentes" }], () => { void carregar(); }, 2000);

  const visiveis = useMemo(() => (linhas ?? []).filter((l) =>
    (filtro === "todos" || (filtro === "pacote" ? l.exp.tipo === "pacote" : l.exp.tipo !== "pacote"))
    && (!soPendentes || l.faltam.length > 0 || (l.respondeu.length + l.aguardando.length === 0))), [linhas, filtro, soPendentes]);

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!linhas) return <Carregando />;

  const totPax = linhas.reduce((s, l) => s + l.respondeu.length + l.aguardando.length + l.faltam.length, 0);
  const totResp = linhas.reduce((s, l) => s + l.respondeu.length, 0);
  const totAg = linhas.reduce((s, l) => s + l.aguardando.length, 0);
  const totFaltam = linhas.reduce((s, l) => s + l.faltam.length, 0);
  const urgentes = linhas.filter((l) => (l.dias ?? 999) <= 45).reduce((s, l) => s + l.faltam.length, 0);

  async function copiarLembrete(p: Pax, l: Linha) {
    let link = `${PORTAL_ANTIGO_URL}/amigo`;
    if (ehAdmin) {
      setOcupado(p.id);
      try {
        const r = await rpc<{ codigo: string }>("exp_amigo_gerar_link", { p_passageiro_id: p.id, p_liberar: true });
        link = `${PORTAL_ANTIGO_URL}/a/${r.codigo}`;
      } catch { /* sem o link curto: vai o do portal */ }
      finally { setOcupado(null); }
    }
    avisar((await copiar(mensagemLembrete(p.nome_completo, l.exp, l.dias, link))) ? `Lembrete de ${p.nome_completo.split(" ")[0]} copiado — cole no WhatsApp` : "Não consegui copiar", "ok");
  }

  async function copiarLista(l: Linha) {
    const txt = [`${l.exp.nome} — ${textoDias(l.dias)}. Faltam ${l.faltam.length} formulário(s):`,
      ...l.faltam.map((p) => `• ${p.nome_completo}${p.telefone ? ` — ${p.telefone}` : ""}`)].join("\n");
    avisar((await copiar(txt)) ? "Lista de quem falta copiada" : "Não consegui copiar", "ok");
  }

  async function abrirPacote(v: PacoteSolto) {
    setOcupado(v.id);
    try {
      await rpc<string>("exp_pacote_abrir_inscricao", { p_viagem: v.id });
      esquecer("expedicoes");
      avisar("Formulário do pacote aberto — o titular já aparece na lista de quem falta");
      await carregar();
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      avisar(/exp_pacote_abrir_inscricao|function|schema cache/i.test(m) ? "Falta aplicar a migration 0225 pra abrir formulário de pacote." : m || "Não abriu o formulário", "erro");
    } finally { setOcupado(null); }
  }

  const chip = (id: typeof filtro, rotulo: string) => (
    <button key={id} type="button" aria-pressed={filtro === id} onClick={() => setFiltro(id)} className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
      style={filtro === id ? { background: "var(--rel)", color: "#fff", border: "1px solid var(--rel)" } : { background: "var(--card)", color: "var(--ink2)", border: "1px solid var(--line)" }}>{rotulo}</button>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <Numero valor={totFaltam} rotulo="ainda não responderam" cor="var(--err-ink)" />
        <Numero valor={urgentes} rotulo="faltam em viagens de até 45 dias" cor="var(--warn-ink)" />
        <Numero valor={totAg} rotulo="responderam, aguardando aprovação" cor="#5B21B6" />
        <Numero valor={totResp} rotulo={`já responderam (de ${totPax})`} cor="#166534" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {chip("todos", "Tudo")}{chip("expedicao", "Expedições")}{chip("pacote", "Pacotes")}
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-[12.5px] cursor-pointer" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} /> Só viagens com alguém faltando
        </label>
      </div>

      {visiveis.length === 0 && (filtro !== "pacote" || soltos.length === 0)
        ? <Vazio titulo="Todo mundo já respondeu o formulário." texto="Quando entrar passageiro novo numa viagem que ainda não embarcou, ele aparece aqui até responder." />
        : <div className="grid gap-3 lg:grid-cols-2">
          {visiveis.map((l) => {
            const total = l.respondeu.length + l.aguardando.length + l.faltam.length;
            const pct = total ? Math.round(((l.respondeu.length + l.aguardando.length) / total) * 100) : 0;
            const tom = l.faltam.length ? urgencia(l.dias) : "neutro";
            const abertoAqui = aberto === l.exp.id;
            return (
              <section key={l.exp.id} className="rel-card p-3.5 space-y-2.5" style={{ borderLeft: `4px solid ${COR[tom]}` }}>
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{l.exp.nome}</div>
                    <div className="text-[12px]" style={{ color: "var(--ink3)" }}>
                      {l.exp.tipo === "pacote" ? "Pacote" : "Expedição"}{l.exp.data_embarque ? ` · embarque ${formatDate(l.exp.data_embarque)}` : ""}
                    </div>
                  </div>
                  <Selo tom={tom === "neutro" ? "neutro" : tom}>{textoDias(l.dias)}</Selo>
                </div>
                <div>
                  <div className="h-2.5 rounded-full overflow-hidden flex" style={{ background: "var(--card2)" }} role="img" aria-label={`${l.respondeu.length + l.aguardando.length} de ${total} responderam`}>
                    <div style={{ width: `${total ? (l.respondeu.length / total) * 100 : 0}%`, background: "#16A34A" }} />
                    <div style={{ width: `${total ? (l.aguardando.length / total) * 100 : 0}%`, background: "#8B5CF6" }} />
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[12px]" style={{ color: "var(--ink2)" }}>
                    <span><strong>{l.respondeu.length}</strong> responderam</span>
                    {l.aguardando.length > 0 && <span><strong>{l.aguardando.length}</strong> aguardando aprovação</span>}
                    <span style={{ color: l.faltam.length ? "var(--err-ink)" : undefined }}><strong>{l.faltam.length}</strong> faltam</span>
                    <span style={{ color: "var(--ink3)" }}>{pct}% de {total}</span>
                    {l.inscricoesSemPax > 0 && <span style={{ color: "#5B21B6" }}>+{l.inscricoesSemPax} inscrição(ões) nova(s) na fila</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {l.faltam.length > 0 && <Botao variante={abertoAqui ? "secundario" : "primario"} onClick={() => setAberto(abertoAqui ? null : l.exp.id)}>{abertoAqui ? "Fechar" : `Ver quem falta (${l.faltam.length})`}</Botao>}
                  {l.faltam.length > 0 && <Botao variante="fantasma" onClick={() => void copiarLista(l)}>Copiar lista</Botao>}
                  <Botao variante="fantasma" onClick={() => ir(l.exp.tipo === "pacote" ? "pacotes" : "expedicoes", `${l.exp.id}/passageiros`)}>Passageiros ↗</Botao>
                </div>
                {abertoAqui && (
                  <ul className="border-t pt-2 space-y-1.5" style={{ borderColor: "var(--line)" }}>
                    {l.faltam.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                        <span className="font-semibold flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>{p.nome_completo}</span>
                        <span style={{ color: "var(--ink3)" }}>{p.telefone ?? "sem telefone"}</span>
                        <Botao disabled={ocupado === p.id} onClick={() => void copiarLembrete(p, l)}>{ocupado === p.id ? "Gerando…" : "Copiar lembrete"}</Botao>
                      </li>
                    ))}
                    <li className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
                      {ehAdmin ? "O lembrete leva o link curto de 1º acesso (/a/), válido por 30 dias." : "O lembrete leva o link do portal (CPF + senha). O link curto de 1º acesso é só pra admin."} Nada é enviado daqui.
                    </li>
                  </ul>
                )}
              </section>
            );
          })}
        </div>}

      {filtro !== "expedicao" && soltos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[14px] font-bold" style={{ color: "var(--ink)", margin: 0 }}>Pacotes personalizados sem formulário ({soltos.length})</h2>
          <p className="text-[12.5px]" style={{ color: "var(--ink3)", margin: 0 }}>
            Pacotes vendidos que ainda não têm o formulário de inscrição. "Abrir formulário" cria a viagem nas Expedições (tipo pacote) com o titular como passageiro; depois é só mandar o lembrete.
          </p>
          <div className="grid gap-2 lg:grid-cols-2">
            {soltos.map((v) => {
              const tom = urgencia(v.dias);
              return (
                <div key={v.id} className="rel-card px-3.5 py-2.5 flex flex-wrap items-center gap-2" style={{ borderLeft: `4px solid ${COR[tom]}` }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-bold truncate" style={{ color: "var(--ink)" }}>{v.titulo}</div>
                    <div className="text-[12px]" style={{ color: "var(--ink3)" }}>{[v.cliente_nome, v.destino, v.data_embarque ? formatDate(v.data_embarque) : null, v.qtd_passageiros ? `${v.qtd_passageiros} pax` : null].filter(Boolean).join(" · ")}</div>
                  </div>
                  <Selo tom={tom === "neutro" ? "neutro" : tom}>{textoDias(v.dias)}</Selo>
                  <Botao disabled={somenteLeitura || ocupado === v.id} onClick={() => void abrirPacote(v)}>{ocupado === v.id ? "Abrindo…" : "Abrir formulário"}</Botao>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Numero({ valor, rotulo, cor }: { valor: number; rotulo: string; cor: string }) {
  return (
    <div className="rel-card p-3.5" style={{ borderLeft: `4px solid ${valor ? cor : "var(--line)"}` }}>
      <div className="text-[26px] font-bold leading-none" style={{ color: valor ? cor : "var(--ink3)" }}>{valor}</div>
      <div className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>{rotulo}</div>
    </div>
  );
}
