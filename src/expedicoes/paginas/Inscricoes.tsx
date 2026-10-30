// src/expedicoes/paginas/Inscricoes.tsx
// Fila de aprovação das inscrições do formulário público (app antigo:
// app/(app)/inscricoes — InscricoesPendentes + DecisoesLog). O formulário
// /inscricao continua no app antigo e grava inscricoes_pendentes do mesmo jeito.
// Aprovar/recusar/restaurar/excluir = funções SQL atômicas da 0163 (no antigo era
// service role). Quem decide: useExp().podeDecidirInscricao (Relacionamento
// também); restaurar/excluir só quem edita. O log de decisões aparece pro admin.
//
// 29/10 — pedidos da Carol, trazidos do app antigo (711f772, 66369ee, fe8ff18):
//  · filtro "Só com alerta de saúde" (com contador);
//  · TRIAGEM DE SAÚDE nas inscrições com "Sim": anotação que o time vê antes de
//    aprovar + caixinha "Preciso emitir e enviar a receita" (vai pro passageiro na
//    aprovação → menu Receitas). Precisa da 0223; sem ela a caixa nem aparece;
//  · fila AGRUPADA POR EXPEDIÇÃO, cada grupo abre/fecha, por data de embarque.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Botao, Modal, Vazio, Aviso } from "@/rel/ui";
import { useExp } from "../contexto";
import { Busca, Carregando, Cartao, Selo, useAoVivo } from "../ui";
import { supabase, lerTudo, listarExpedicoes } from "../lib/banco";
import { formatDate, formatDateTime } from "../lib/utils";
import { formatarCpf } from "../lib/cpf";
import { PERGUNTAS_SAUDE } from "../lib/saude";
import { MAX_UPLOAD_BYTES } from "../lib/constants";
import { requisitosDoDestino } from "../lib/prontidao/requisitos-destino";
import { REQUISITOS_DE_COLUNA } from "../lib/prontidao/regras";
import type { ExpedicaoRow, InscricaoPendenteRow } from "../lib/database";
import { abrirArquivo, chamarRotaAdmin, nomeSeguro, rpc, useEhAdminExp } from "./_admin/comum";
import ReceitasAEnviar from "@/rel/clientes/ficha/ReceitasAEnviar";

type Dados = Record<string, unknown>;
type Decisao = { id: string; expedicao_id: string | null; cpf: string | null; nome_completo: string | null; acao: string; motivo: string | null; decidido_por_nome: string | null; created_at: string };

const ACOES: Record<string, { rotulo: string; tom: "ok" | "erro" | "lista" | "neutro" }> = {
  aprovada: { rotulo: "Aprovada", tom: "ok" },
  recusada: { rotulo: "Recusada", tom: "erro" },
  restaurada: { rotulo: "Restaurada", tom: "lista" },
  excluida: { rotulo: "Excluída", tom: "neutro" },
};

const txt = (d: Dados, k: string) => (d[k] == null || d[k] === "" ? null : String(d[k]));
const simNao = (v: unknown) => (typeof v === "boolean" ? (v ? "Sim" : "Não") : null);

function Link({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} className="font-semibold underline-offset-2 hover:underline" style={{ color: "var(--rel-ink)" }}>{children}</button>;
}

function Linha({ rotulo, valor }: { rotulo: string; valor: ReactNode }) {
  if (valor === null || valor === undefined || valor === "") return null;
  return (
    <div className="flex gap-2 text-[12.5px]">
      <span className="w-44 shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</span>
      <span className="flex-1 break-words" style={{ color: "var(--ink)" }}>{valor}</span>
    </div>
  );
}
function Grupo({ titulo, children }: { titulo: string; children: ReactNode[] | ReactNode }) {
  const tem = (Array.isArray(children) ? children : [children]).some((c) => c !== null && c !== undefined && c !== false && c !== "");
  if (!tem) return null;
  return (
    <div className="space-y-1">
      <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: "var(--ink3)" }}>{titulo}</div>
      {children}
    </div>
  );
}

export default function Inscricoes() {
  const { somenteLeitura, podeDecidirInscricao, ir, avisar } = useExp();
  const ehAdmin = useEhAdminExp();
  const [linhas, setLinhas] = useState<InscricaoPendenteRow[] | null>(null);
  const [exps, setExps] = useState<Map<string, ExpedicaoRow>>(new Map());
  const [decisoes, setDecisoes] = useState<Decisao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const [verRecusadas, setVerRecusadas] = useState(false);
  const [verLog, setVerLog] = useState(false);
  const [recusando, setRecusando] = useState<InscricaoPendenteRow | null>(null);
  const [excluindo, setExcluindo] = useState<InscricaoPendenteRow | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [soSaude, setSoSaude] = useState(false);
  const [fechados, setFechados] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      const [ins, ex] = await Promise.all([lerTudo<InscricaoPendenteRow>("inscricoes_pendentes"), listarExpedicoes()]);
      setLinhas(ins);
      setExps(new Map(ex.map((e) => [e.id, e])));
      setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : "Erro ao carregar"); }
  }, []);
  const carregarLog = useCallback(async () => {
    const { data } = await supabase.from("inscricoes_decisoes")
      .select("id,expedicao_id,cpf,nome_completo,acao,motivo,decidido_por_nome,created_at")
      .order("created_at", { ascending: false }).limit(300);
    setDecisoes((data ?? []) as Decisao[]);
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { if (ehAdmin) void carregarLog(); }, [ehAdmin, carregarLog]);
  useAoVivo([{ tabela: "inscricoes_pendentes" }], () => { void carregar(); if (ehAdmin) void carregarLog(); });

  const ordenar = (a: InscricaoPendenteRow, b: InscricaoPendenteRow) => (b.recusada_em ?? b.created_at).localeCompare(a.recusada_em ?? a.created_at);
  const todasPendentes = useMemo(() => (linhas ?? []).filter((l) => l.status !== "recusada").sort(ordenar), [linhas]);
  const comAlerta = useMemo(() => todasPendentes.filter(temAlertaSaude), [todasPendentes]);
  const pendentes = soSaude ? comAlerta : todasPendentes;
  // 0223 aplicada? (a coluna vem no select *)
  const temTriagem = (linhas ?? []).some((l) => "comentario_saude" in l);
  // Fila por expedição, a que embarca primeiro em cima.
  const grupos = useMemo(() => {
    const m = new Map<string, InscricaoPendenteRow[]>();
    for (const it of pendentes) m.set(it.expedicao_id, [...(m.get(it.expedicao_id) ?? []), it]);
    return [...m.entries()].sort(([a], [b]) => (exps.get(a)?.data_embarque ?? "9999").localeCompare(exps.get(b)?.data_embarque ?? "9999"));
  }, [pendentes, exps]);
  const alternarGrupo = (id: string) => setFechados((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const recusadas = useMemo(() => (linhas ?? []).filter((l) => l.status === "recusada").sort(ordenar), [linhas]);

  const alternar = (id: string) => setAbertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const abrir = (id: string) => abrirArquivo(id).catch((e) => avisar(e instanceof Error ? e.message : "Não abriu o arquivo", "erro"));

  async function aprovar(it: InscricaoPendenteRow) {
    const exp = exps.get(it.expedicao_id);
    setOcupado(it.id);
    try {
      // modelos de requisito do destino (catálogo do front, igual ao antigo)
      const modelos = requisitosDoDestino(exp?.destino ?? "").filter((t) => !REQUISITOS_DE_COLUNA.has(t.tipo))
        .map((t) => ({ tipo: t.tipo, descricao: t.descricao, obrigatoriedade: t.obrigatoriedade, bloqueia_embarque: t.bloqueia_embarque, observacoes: t.observacoes ?? null }));
      const r = await rpc<{ passageiro_id: string; nome: string }>("exp_inscricao_aprovar", { p_id: it.id, p_requisitos: modelos });
      avisar(`${r?.nome ?? it.nome_completo ?? "Inscrição"} aprovado(a)`);
      // Bitrix (via n8n), melhor esforço — nunca desfaz a aprovação.
      if (r?.passageiro_id) chamarRotaAdmin("exp_inscricao_bitrix", { passageiro_id: r.passageiro_id }).catch(() => { /* fica no log da Vercel */ });
      await carregar();
      if (ehAdmin) void carregarLog();
    } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível aprovar", "erro"); }
    finally { setOcupado(null); }
  }

  async function restaurar(it: InscricaoPendenteRow) {
    setOcupado(it.id);
    try { await rpc("exp_inscricao_restaurar", { p_id: it.id }); avisar("Inscrição voltou pra fila"); await carregar(); if (ehAdmin) void carregarLog(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível restaurar", "erro"); }
    finally { setOcupado(null); }
  }

  if (erro) return <Aviso tom="erro">{erro}</Aviso>;
  if (!linhas) return <Carregando />;

  const card = (it: InscricaoPendenteRow, recusada: boolean) => {
    const d = (it.dados ?? {}) as Dados;
    const exp = exps.get(it.expedicao_id);
    const nome = it.nome_completo ?? txt(d, "nome_completo") ?? "—";
    const saude = (d.saude && typeof d.saude === "object" ? d.saude : {}) as Record<string, string>;
    const alertaSaude = temAlertaSaude(it);
    const aberto = abertos.has(it.id);
    const endereco = ["endereco_rua", "endereco_numero", "endereco_complemento", "endereco_bairro", "endereco_cidade", "endereco_estado"].map((k) => txt(d, k)).filter(Boolean).join(", ");
    const cert = saude.vacina_febre_amarela_arquivo_id;
    return (
      <div key={it.id} className="rel-card p-3.5 space-y-2.5" style={recusada ? { opacity: 0.92 } : undefined}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-bold" style={{ color: "var(--ink)" }}>{nome}</div>
            <div className="text-[11.5px]" style={{ color: "var(--ink3)" }}>
              CPF {formatarCpf(it.cpf)} · {formatDate(it.created_at)}
              {recusada ? (it.recusada_em ? ` · recusada ${formatDate(it.recusada_em)}` : "") : " · Aguardando aprovação"}
            </div>
          </div>
          {recusada ? <Selo tom="erro">Recusada</Selo> : <Selo tom={it.passaporte_arquivo_id ? "ok" : "aviso"}>{it.passaporte_arquivo_id ? "Passaporte" : "Sem anexo"}</Selo>}
        </div>

        <div className="rounded-lg px-2.5 py-1.5 text-[12.5px]" style={{ background: "var(--card2)" }}>
          <div className="font-semibold" style={{ color: "var(--ink)" }}>{exp?.nome ?? "—"}</div>
          <div className="text-[11.5px]" style={{ color: "var(--ink3)" }}>{exp?.destino ?? "—"}{exp?.data_embarque ? ` · embarque ${formatDate(exp.data_embarque)}` : ""}</div>
        </div>

        {!recusada && alertaSaude && (
          temTriagem
            ? <TriagemSaude it={it} pode={podeDecidirInscricao} saude={saude} onSalvo={carregar} />
            : <Aviso>Respostas de saúde marcadas com "Sim" — <strong>verificar com a Carol</strong> antes de aprovar.</Aviso>
        )}

        {recusada && (it.motivo_recusa || it.recusa_arquivo_id) && (
          <div className="rounded-lg px-2.5 py-1.5 text-[12.5px] space-y-1" style={{ background: "var(--err-bg)", color: "var(--err-ink)" }}>
            <div className="text-[10.5px] font-bold uppercase tracking-wide">Motivo da recusa</div>
            {it.motivo_recusa && <div className="whitespace-pre-wrap break-words" style={{ color: "var(--ink)" }}>{it.motivo_recusa}</div>}
            {it.recusa_arquivo_id && <Link onClick={() => abrir(it.recusa_arquivo_id!)}>Ver anexo do motivo</Link>}
          </div>
        )}

        {aberto && (
          <div className="space-y-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
            <Grupo titulo="Dados pessoais">
              <Linha rotulo="Nome" valor={nome} />
              <Linha rotulo="CPF" valor={formatarCpf(it.cpf)} />
              <Linha rotulo="Nascimento" valor={it.data_nascimento ? formatDate(it.data_nascimento) : null} />
              <Linha rotulo="E-mail" valor={txt(d, "email")} />
              <Linha rotulo="Telefone" valor={txt(d, "telefone")} />
            </Grupo>
            <Grupo titulo="Endereço">
              <Linha rotulo="Endereço" valor={endereco || null} />
              <Linha rotulo="CEP" valor={txt(d, "endereco_cep")} />
            </Grupo>
            <Grupo titulo="Passaporte">
              <Linha rotulo="Número" valor={txt(d, "passaporte")} />
              <Linha rotulo="Validade" valor={txt(d, "validade_passaporte") ? formatDate(txt(d, "validade_passaporte")) : null} />
              <Linha rotulo="Anexo" valor={it.passaporte_arquivo_id ? <Link onClick={() => abrir(it.passaporte_arquivo_id!)}>Ver passaporte</Link> : <span style={{ color: "var(--warn-ink)" }}>sem anexo</span>} />
            </Grupo>
            <Grupo titulo="Contato de emergência">
              <Linha rotulo="Nome" valor={txt(d, "contato_emergencia_nome")} />
              <Linha rotulo="Telefone" valor={txt(d, "contato_emergencia_fone")} />
              <Linha rotulo="Vínculo" valor={txt(d, "contato_emergencia_vinculo")} />
            </Grupo>
            <Grupo titulo="Preferências de voo">
              <Linha rotulo="Marcar assento" valor={simNao(d.pref_marcar_assento)} />
              <Linha rotulo="Upgrade de classe" valor={txt(d, "pref_upgrade_classe")} />
            </Grupo>
            <Grupo titulo="Experiência de viagem">
              <Linha rotulo="Já viajou internac." valor={simNao(d.ja_viajou_internacional)} />
              <Linha rotulo="Países visitados" valor={txt(d, "paises_visitados")} />
            </Grupo>
            <Grupo titulo="Acompanhante(s)">
              <Linha rotulo="Acompanhante(s)" valor={txt(d, "acompanhante_nome")} />
              <Linha rotulo="Vínculo" valor={txt(d, "acompanhante_vinculo")} />
              <Linha rotulo="Dividir quarto/cama" valor={txt(d, "acompanhante_divide_quarto")} />
              <Linha rotulo="Dividir quarto com" valor={txt(d, "acompanhante_dividir_com")} />
            </Grupo>
            <Grupo titulo="Perfil & conexões">
              <Linha rotulo="Profissão" valor={txt(d, "profissao")} />
              <Linha rotulo="Como se descreve em grupo" valor={txt(d, "descricao_grupo")} />
              <Linha rotulo="O que mais te anima" valor={txt(d, "anima_expedicao")} />
              <Linha rotulo="Significado especial" valor={txt(d, "significado")} />
              <Linha rotulo="Instagram" valor={txt(d, "instagram")} />
              <Linha rotulo="Camiseta" valor={txt(d, "camiseta")} />
              <Linha rotulo="Música preferida" valor={txt(d, "musica")} />
              <Linha rotulo="Foto do viajante" valor={it.foto_arquivo_id ? <Link onClick={() => abrir(it.foto_arquivo_id!)}>Ver foto</Link> : null} />
            </Grupo>
            <Grupo titulo="Saúde">
              {PERGUNTAS_SAUDE.map((q) => {
                const resp = saude[q.campo];
                if (!resp) return null;
                const extra = [q.detalheCampo ? saude[q.detalheCampo] : "", q.detalhe2Campo ? saude[q.detalhe2Campo] : ""].filter(Boolean).join(" · ");
                return <Linha key={q.campo} rotulo={q.pergunta} valor={extra ? `${resp} — ${extra}` : resp} />;
              })}
              <Linha rotulo="Certificado Febre Amarela" valor={cert ? <Link onClick={() => abrir(cert)}>Ver certificado</Link> : null} />
            </Grupo>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Botao variante="fantasma" onClick={() => alternar(it.id)}>{aberto ? "Esconder dados" : "Ver todos os dados"}</Botao>
          <Botao variante="fantasma" onClick={() => ir("expedicoes", `${it.expedicao_id}/passageiros`)}>Passageiros da expedição ↗</Botao>
          <span className="flex-1" />
          {!recusada && podeDecidirInscricao && (
            <>
              <Botao variante="perigo" disabled={ocupado === it.id} onClick={() => setRecusando(it)}>Recusar</Botao>
              <Botao variante="primario" disabled={ocupado === it.id} onClick={() => aprovar(it)}>{ocupado === it.id ? "Aprovando…" : "Aprovar"}</Botao>
            </>
          )}
          {recusada && !somenteLeitura && (
            <>
              <Botao variante="perigo" disabled={ocupado === it.id} onClick={() => setExcluindo(it)}>Excluir</Botao>
              <Botao disabled={ocupado === it.id} onClick={() => restaurar(it)}>Restaurar</Botao>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-2 flex-wrap">
        <h1 className="text-[20px] font-bold" style={{ color: "var(--ink)" }}>Inscrições pendentes</h1>
        <Selo tom={todasPendentes.length ? "aviso" : "neutro"}>{todasPendentes.length}</Selo>
        <span className="flex-1" />
        <button type="button" onClick={() => setSoSaude((v) => !v)} aria-pressed={soSaude}
          className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold"
          style={soSaude ? { background: "var(--warn-bg)", color: "var(--warn-ink)", border: "1px solid var(--warn-ink)" } : { background: "var(--card)", color: "var(--ink2)", border: "1px solid var(--line)" }}>
          Só com alerta de saúde ({comAlerta.length})
        </button>
      </header>

      {/* 30/10: o alerta das receitas (0223) mora aqui; cada linha abre a ficha da pessoa, aba Saúde */}
      <ReceitasAEnviar />

      {pendentes.length === 0
        ? <Vazio titulo={soSaude ? "Nenhuma inscrição com alerta de saúde." : "Nenhuma inscrição pendente no momento."} texto="As inscrições do formulário público aparecem aqui para aprovar ou recusar." />
        : grupos.map(([expId, its]) => {
          const exp = exps.get(expId);
          const fechado = fechados.has(expId);
          const nSaude = its.filter(temAlertaSaude).length;
          return (
            <section key={expId} className="space-y-3">
              <button type="button" onClick={() => alternarGrupo(expId)} aria-expanded={!fechado}
                className="w-full flex items-center gap-2 text-left border-b pb-1.5" style={{ borderColor: "var(--line)" }}>
                <span style={{ color: "var(--ink3)" }}>{fechado ? "▸" : "▾"}</span>
                <span className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{exp?.nome ?? "Expedição"}</span>
                <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{exp?.data_embarque ? `embarque ${formatDate(exp.data_embarque)}` : "sem data"}</span>
                <Selo tom="aviso">{its.length}</Selo>
                {nSaude > 0 && <Selo tom="erro">{nSaude} com saúde</Selo>}
              </button>
              {!fechado && <div className="grid gap-3 lg:grid-cols-2">{its.map((it) => card(it, false))}</div>}
            </section>
          );
        })}

      {recusadas.length > 0 && (
        <section className="space-y-3">
          <button type="button" onClick={() => setVerRecusadas((v) => !v)} className="text-[13.5px] font-bold" style={{ color: "var(--ink2)" }}>
            {verRecusadas ? "▾" : "▸"} Recusadas ({recusadas.length})
          </button>
          {verRecusadas && <div className="grid gap-3 lg:grid-cols-2">{recusadas.map((it) => card(it, true))}</div>}
        </section>
      )}

      {ehAdmin && (
        <section className="space-y-3">
          <button type="button" onClick={() => setVerLog((v) => !v)} className="text-[13.5px] font-bold" style={{ color: "var(--ink2)" }}>
            {verLog ? "▾" : "▸"} Histórico de decisões ({decisoes.length})
          </button>
          {verLog && <LogDecisoes decisoes={decisoes} exps={exps} />}
        </section>
      )}

      <ModalRecusa it={recusando} exp={recusando ? exps.get(recusando.expedicao_id) : undefined} onFechar={() => setRecusando(null)}
        onFeito={async () => { setRecusando(null); avisar("Inscrição movida para Recusadas"); await carregar(); if (ehAdmin) void carregarLog(); }} />

      <Modal aberto={!!excluindo} titulo="Excluir definitivamente" onFechar={() => setExcluindo(null)} largura={460}
        rodape={<>
          <Botao onClick={() => setExcluindo(null)}>Cancelar</Botao>
          <Botao variante="perigo" disabled={!!ocupado} onClick={async () => {
            if (!excluindo) return;
            setOcupado(excluindo.id);
            try {
              const caminhos = await rpc<string[]>("exp_inscricao_excluir", { p_id: excluindo.id });
              if (caminhos?.length) await supabase.storage.from("arquivos-expedicoes").remove(caminhos);
              avisar("Inscrição excluída");
              setExcluindo(null);
              await carregar(); if (ehAdmin) void carregarLog();
            } catch (e) { avisar(e instanceof Error ? e.message : "Não foi possível excluir", "erro"); }
            finally { setOcupado(null); }
          }}>Excluir de vez</Botao>
        </>}>
        <p className="text-[13.5px]" style={{ color: "var(--ink2)" }}>
          Excluir DEFINITIVAMENTE a inscrição de <strong>{excluindo?.nome_completo ?? "—"}</strong>? Isso apaga os dados e os anexos
          (passaporte, foto, certificado, anexo do motivo) — não dá pra desfazer. Anexo que já estiver no cadastro de algum passageiro é mantido.
        </p>
      </Modal>
    </div>
  );
}

/** Alguma resposta de saúde "Sim" (a vacina de febre amarela não conta como alerta). */
function temAlertaSaude(it: InscricaoPendenteRow): boolean {
  const d = (it.dados ?? {}) as Dados;
  const saude = (d.saude && typeof d.saude === "object" ? d.saude : {}) as Record<string, string>;
  return PERGUNTAS_SAUDE.some((q) => q.campo !== "vacina_febre_amarela" && saude[q.campo] === "Sim");
}

/** Triagem de saúde (Carol): o que veio "Sim", a anotação e o lembrete de receita. */
function TriagemSaude({ it, pode, saude, onSalvo }: { it: InscricaoPendenteRow; pode: boolean; saude: Record<string, string>; onSalvo: () => void }) {
  const { avisar } = useExp();
  const [texto, setTexto] = useState(it.comentario_saude ?? "");
  const [receita, setReceita] = useState(!!it.receita_pendente);
  const [indo, setIndo] = useState(false);
  useEffect(() => { setTexto(it.comentario_saude ?? ""); setReceita(!!it.receita_pendente); }, [it.comentario_saude, it.receita_pendente]);
  const sins = PERGUNTAS_SAUDE.filter((q) => q.campo !== "vacina_febre_amarela" && saude[q.campo] === "Sim");
  const mudouTexto = texto.trim() !== (it.comentario_saude ?? "").trim();

  async function salvar(rec: boolean) {
    setIndo(true);
    try {
      await rpc("exp_inscricao_triagem_saude", { p_id: it.id, p_comentario: texto, p_receita: rec });
      avisar("Triagem de saúde salva");
      onSalvo();
    } catch (e) { avisar(e instanceof Error ? e.message : "Não salvou a triagem", "erro"); setReceita(!!it.receita_pendente); }
    finally { setIndo(false); }
  }

  return (
    <div className="rounded-lg px-3 py-2.5 space-y-2 text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--ink)" }}>
      <div className="text-[10.5px] font-bold uppercase tracking-wide" style={{ color: "var(--warn-ink)" }}>Triagem de saúde</div>
      <ul className="space-y-0.5">
        {sins.map((q) => {
          const extra = [q.detalheCampo ? saude[q.detalheCampo] : "", q.detalhe2Campo ? saude[q.detalhe2Campo] : ""].filter(Boolean).join(" · ");
          return <li key={q.campo}><strong>{q.curto}</strong>{extra ? `: ${extra}` : ""}</li>;
        })}
      </ul>
      {pode ? (
        <>
          <textarea className="rel-input" rows={2} value={texto} maxLength={2000} onChange={(e) => setTexto(e.target.value)}
            placeholder={'Anotação da triagem — ex.: "receita já emitida", "não precisa de receita"'} />
          <div className="flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={receita} disabled={indo} onChange={(e) => { setReceita(e.target.checked); void salvar(e.target.checked); }} />
              Preciso emitir e enviar a receita
            </label>
            <span className="flex-1" />
            {mudouTexto && <Botao disabled={indo} onClick={() => void salvar(receita)}>{indo ? "Salvando…" : "Salvar anotação"}</Botao>}
          </div>
        </>
      ) : (
        <>
          {it.comentario_saude
            ? <p className="whitespace-pre-wrap"><strong>Anotação:</strong> {it.comentario_saude}</p>
            : <p>Sem anotação da triagem ainda — <strong>verificar com a Carol</strong> antes de aprovar.</p>}
          {it.receita_pendente && <p>Receita a emitir e enviar</p>}
        </>
      )}
    </div>
  );
}

function ModalRecusa({ it, exp, onFechar, onFeito }: { it: InscricaoPendenteRow | null; exp?: ExpedicaoRow; onFechar: () => void; onFeito: () => void }) {
  const { avisar } = useExp();
  const [motivo, setMotivo] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [indo, setIndo] = useState(false);
  useEffect(() => { setMotivo(""); setArquivo(null); }, [it?.id]);
  if (!it) return null;

  async function confirmar() {
    if (!it || !motivo.trim()) return;
    if (arquivo && arquivo.size > MAX_UPLOAD_BYTES) { avisar("O anexo passa de 15 MB.", "erro"); return; }
    setIndo(true);
    let caminho: string | null = null;
    try {
      let p_arquivo: Record<string, unknown> | null = null;
      if (arquivo) {
        caminho = `${it.expedicao_id}/inscricoes/recusas/${crypto.randomUUID()}-${nomeSeguro(arquivo.name)}`;
        const up = await supabase.storage.from("arquivos-expedicoes").upload(caminho, arquivo, { contentType: arquivo.type || undefined, upsert: false });
        if (up.error) throw new Error(`Não subiu o anexo: ${up.error.message}`);
        p_arquivo = { storage_path: caminho, nome: arquivo.name, mime: arquivo.type || null, tamanho_bytes: arquivo.size };
      }
      await rpc("exp_inscricao_recusar", { p_id: it.id, p_motivo: motivo.trim(), p_arquivo });
      onFeito();
    } catch (e) {
      if (caminho) await supabase.storage.from("arquivos-expedicoes").remove([caminho]).catch(() => undefined);
      avisar(e instanceof Error ? e.message : "Não foi possível recusar", "erro");
    } finally { setIndo(false); }
  }

  return (
    <Modal aberto titulo="Recusar inscrição" onFechar={onFechar} largura={520}
      rodape={<>
        <Botao onClick={onFechar}>Cancelar</Botao>
        <Botao variante="perigo" disabled={!motivo.trim() || indo} onClick={confirmar}>{indo ? "Recusando…" : "Confirmar recusa"}</Botao>
      </>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          <strong>{it.nome_completo ?? "—"}</strong> · {exp?.nome ?? "—"}. A inscrição não é apagada: vai para "Recusadas", de onde dá pra restaurar.
        </p>
        <label className="block">
          <span className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Motivo da recusa (obrigatório)</span>
          <textarea className="rel-input" rows={4} value={motivo} onChange={(e) => setMotivo(e.target.value)}
            placeholder="Ex.: passaporte vencido, vaga preenchida, dados inconsistentes…" />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Anexo (opcional — imagem ou PDF, até 15 MB)</span>
          <input type="file" accept="image/*,application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="text-[12.5px]" />
        </label>
      </div>
    </Modal>
  );
}

function LogDecisoes({ decisoes, exps }: { decisoes: Decisao[]; exps: Map<string, ExpedicaoRow> }) {
  const [busca, setBusca] = useState("");
  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return decisoes;
    return decisoes.filter((d) => [d.nome_completo, d.cpf, d.decidido_por_nome, d.expedicao_id ? exps.get(d.expedicao_id)?.nome : "", ACOES[d.acao]?.rotulo]
      .filter(Boolean).join(" ").toLowerCase().includes(q));
  }, [decisoes, busca, exps]);
  return (
    <Cartao>
      <div className="mb-3"><Busca valor={busca} onMudar={setBusca} placeholder="Buscar por nome, CPF, expedição, quem decidiu…" /></div>
      {filtradas.length === 0 ? <p className="text-[13px] py-4 text-center" style={{ color: "var(--ink3)" }}>Nenhuma decisão registrada ainda.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left" style={{ color: "var(--ink3)" }}>
                {["Quando", "Ação", "Passageiro", "CPF", "Expedição", "Quem decidiu", "Motivo"].map((h) => <th key={h} className="py-1.5 pr-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtradas.map((d) => (
                <tr key={d.id} className="border-t align-top" style={{ borderColor: "var(--line)" }}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{formatDateTime(d.created_at)}</td>
                  <td className="py-1.5 pr-3"><Selo tom={ACOES[d.acao]?.tom ?? "neutro"}>{ACOES[d.acao]?.rotulo ?? d.acao}</Selo></td>
                  <td className="py-1.5 pr-3">{d.nome_completo ?? "—"}</td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{d.cpf ? formatarCpf(d.cpf) : "—"}</td>
                  <td className="py-1.5 pr-3">{d.expedicao_id ? exps.get(d.expedicao_id)?.nome ?? "—" : "—"}</td>
                  <td className="py-1.5 pr-3">{d.decidido_por_nome ?? "—"}</td>
                  <td className="py-1.5 pr-3 max-w-[260px]"><span className="line-clamp-2">{d.motivo ?? ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Cartao>
  );
}
