// src/mkt/agendamento/LinksAgendamento.tsx
// -----------------------------------------------------------------------------
// MARKETING › LINKS DE AGENDAMENTO (0354, Bruno 10/11/2026)
//   "todo mundo fica me pedindo para criar links de agendamentos com os SDRs e
//    Closers. O que eu quero é o pessoal do marketing conseguir criar esses
//    links e já deixar traqueado tudo"
//
// Cada link = o /agendar/ de sempre (rodízio de closer, ou ligação com o SDR)
// + expedição + origem + UTMs + um código (&l=). Quem agenda por ele:
//   • o lead do QS guarda as UTMs (qs_leads.utm_*) e a "Fonte" = origem;
//   • o negócio do Bitrix nasce com UTM_SOURCE…UTM_TERM (card que já existia
//     ganha só nos campos vazios);
//   • o agendamento conta no link (agendados / realizadas / no-show aqui).
//   #mkt/links-agendamento            → lista
//   #mkt/links-agendamento/novo       → criar · /<id> → editar e ver os agendamentos
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Vazio } from "@/rel/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { irMkt, useRotaMkt } from "../navegacao";
import { Cabecalho } from "../conteudo/ui";
import { ultimoDiaPermitido } from "@/lib/qs/limiteAgendamento";
import {
  arquivarLink, lerLinks, lerResumo, lerUsos, salvarLink, sugestoesDeExpedicao,
  type LinkAgendamento, type ResumoLink, type UsoLink,
} from "./api";
import {
  FONTES_UTM, FORM_VAZIO, MEIOS_UTM, NOME_TIPO, OPCOES_DIAS_UTEIS, TIPOS_LINK, problemasDoForm, urlDoLink,
  type LinkForm, type TipoLink,
} from "./regras";

const ROTA = "links-agendamento";
const base = () => (typeof window !== "undefined" ? window.location.origin : "https://qs.setuforeuvouviagens.com.br");
const dataBr = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "—");

const rotuloDiasUteis = (n: number) => (n === 1 ? "até 1 dia útil" : `até ${n} dias úteis`);

/** "Se alguém abrir hoje, consegue marcar até sexta-feira, 13/11." — a mesma conta do servidor. */
function exemploDiasUteis(n: number): string {
  const [a, mm, d] = ultimoDiaPermitido(new Date(), n).split("-").map(Number);
  const dia = new Date(Date.UTC(a, mm - 1, d)).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
  return `Se alguém abrir hoje, consegue marcar até ${dia}.`;
}

async function copiar(texto: string) {
  try { await navigator.clipboard.writeText(texto); notifySuccess("Link copiado."); }
  catch { notifyError("Não consegui copiar — selecione o link e copie à mão."); }
}

export default function LinksAgendamento() {
  const rota = useRotaMkt();
  const sub = rota.id || null;
  const [links, setLinks] = useState<LinkAgendamento[] | null>(null);
  const [resumo, setResumo] = useState<Map<string, ResumoLink>>(new Map());
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([lerLinks(), lerResumo()]);
      setLinks(l); setResumo(r); setErro(null);
    } catch (e) { setErro((e as Error).message); setLinks([]); }
  }, []);
  useEffect(() => { void recarregar(); }, [recarregar]);

  if (links === null) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando links…</p>;
  if (sub === "novo") return <Editor link={null} onFechar={(id) => { void recarregar(); irMkt(ROTA, id); }} />;
  const aberto = sub ? links.find((l) => l.id === sub) : null;
  if (sub && aberto) return <Editor link={aberto} resumo={resumo.get(aberto.id)} onFechar={() => { void recarregar(); irMkt(ROTA); }} />;
  return <Lista links={links} resumo={resumo} erro={erro} />;
}

// ── Lista ──────────────────────────────────────────────────────────────────
function Lista({ links, resumo, erro }: { links: LinkAgendamento[]; resumo: Map<string, ResumoLink>; erro: string | null }) {
  const [busca, setBusca] = useState("");
  const [verArquivados, setVerArquivados] = useState(false);
  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return links.filter((l) => (verArquivados ? !!l.arquivado_em : !l.arquivado_em))
      .filter((l) => !q || [l.nome, l.expedicao, l.utm_campaign, l.utm_source, l.origem].some((v) => (v || "").toLowerCase().includes(q)));
  }, [links, busca, verArquivados]);

  return (
    <div className="max-w-6xl mx-auto">
      <Cabecalho titulo="Links de agendamento"
        texto="Crie o link de agendamento com closer ou SDR já com as UTMs. Quem agenda por ele chega no QS e no Bitrix com a origem certa."
        acoes={<Botao variante="primario" onClick={() => irMkt(ROTA, "novo")}>+ Novo link</Botao>} />
      {erro && <div className="mb-3"><Aviso tom="erro">{erro}</Aviso></div>}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <Entrada placeholder="Buscar por nome, campanha, expedição…" value={busca} onChange={(e) => setBusca(e.target.value)}
          className="!py-1.5 !text-[13px] sm:!w-72" aria-label="Buscar" />
        <label className="text-[13px] flex items-center gap-1.5" style={{ color: "var(--ink2)" }}>
          <input type="checkbox" checked={verArquivados} onChange={(e) => setVerArquivados(e.target.checked)} /> Ver arquivados
        </label>
      </div>
      {visiveis.length === 0 ? (
        <Vazio titulo={verArquivados ? "Nenhum link arquivado" : "Nenhum link ainda"}
          texto={verArquivados ? undefined : "Clique em \"+ Novo link\", escolha closer ou SDR, preencha as UTMs e copie."}
          acao={verArquivados ? undefined : <Botao variante="primario" onClick={() => irMkt(ROTA, "novo")}>+ Novo link</Botao>} />
      ) : (
        <ul className="space-y-2">
          {visiveis.map((l) => {
            const r = resumo.get(l.id);
            const url = urlDoLink(base(), l);
            return (
              <li key={l.id} className="rel-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" className="text-[14px] font-bold text-left flex-1 min-w-[180px] hover:underline" style={{ color: "var(--ink)" }}
                    onClick={() => irMkt(ROTA, l.id)}>{l.nome}</button>
                  <Etiqueta tom={l.tipo === "closer" ? "rel" : "neutro"}>{NOME_TIPO[l.tipo]}</Etiqueta>
                  {l.expedicao && <Etiqueta>{l.expedicao}</Etiqueta>}
                  <Etiqueta>{rotuloDiasUteis(l.dias_uteis ?? 3)}</Etiqueta>
                  <span className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
                    <b>{r?.agendados ?? 0}</b> agendado(s){r?.ultimos_7d ? ` · ${r.ultimos_7d} em 7 dias` : ""}
                    {l.tipo === "closer" && r && r.agendados > 0 ? ` · ${r.realizadas} realizada(s) · ${r.no_show} no-show` : ""}
                  </span>
                  <Botao onClick={() => void copiar(url)}>Copiar link</Botao>
                </div>
                <p className="text-[12px] mt-1 break-all" style={{ color: "var(--ink3)" }}>
                  {[l.utm_source && `source: ${l.utm_source}`, l.utm_medium && `medium: ${l.utm_medium}`, l.utm_campaign && `campaign: ${l.utm_campaign}`, l.utm_content && `content: ${l.utm_content}`]
                    .filter(Boolean).join(" · ")}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Criar / editar ─────────────────────────────────────────────────────────
function formDoLink(l: LinkAgendamento | null): LinkForm {
  if (!l) return FORM_VAZIO;
  return {
    nome: l.nome, tipo: l.tipo, expedicao: l.expedicao ?? "", origem: l.origem ?? "",
    utm_source: l.utm_source ?? "", utm_medium: l.utm_medium ?? "", utm_campaign: l.utm_campaign ?? "",
    utm_content: l.utm_content ?? "", utm_term: l.utm_term ?? "", dias: l.dias ? String(l.dias) : "",
    dias_uteis: (l.dias_uteis === 1 || l.dias_uteis === 2 ? l.dias_uteis : 3), tema_stfv: l.tema_stfv,
  };
}

function Editor({ link, resumo, onFechar }: { link: LinkAgendamento | null; resumo?: ResumoLink; onFechar: (id?: string) => void }) {
  const [f, setF] = useState<LinkForm>(() => formDoLink(link));
  const [salvando, setSalvando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [expedicoes, setExpedicoes] = useState<string[]>([]);
  useEffect(() => { sugestoesDeExpedicao().then(setExpedicoes).catch(() => undefined); }, []);
  const m = (p: Partial<LinkForm>) => setF((x) => ({ ...x, ...p }));
  const problemas = problemasDoForm(f);

  // Prévia: o link como vai sair (no editar, com o código de verdade).
  const previa = urlDoLink(base(), {
    codigo: link?.codigo ?? "(codigo)", tipo: f.tipo, expedicao: f.expedicao.trim() || null, origem: f.origem.trim() || null,
    utm_source: f.utm_source.trim().toLowerCase().replace(/\s+/g, "-") || null, utm_medium: f.utm_medium.trim().toLowerCase().replace(/\s+/g, "-") || null,
    utm_campaign: f.utm_campaign.trim().replace(/\s+/g, "-") || null, utm_content: f.utm_content.trim().replace(/\s+/g, "-") || null,
    utm_term: f.utm_term.trim().replace(/\s+/g, "-") || null, dias: f.dias.trim() ? Number(f.dias) : null, dias_uteis: f.dias_uteis, tema_stfv: f.tema_stfv,
  });

  async function salvar() {
    setTentou(true);
    if (problemas.length) return;
    setSalvando(true);
    try {
      const s = await salvarLink(f, link?.id);
      notifySuccess(link ? "Link salvo." : "Link criado — já pode copiar.");
      if (!link) await copiar(urlDoLink(base(), s));
      onFechar(s.id);
    } catch (e) { notifyError((e as Error).message); }
    finally { setSalvando(false); }
  }

  async function arquivar() {
    if (!link) return;
    setSalvando(true);
    try { await arquivarLink(link.id, !link.arquivado_em); notifySuccess(link.arquivado_em ? "Link reativado." : "Link arquivado (para de contar no link)."); onFechar(); }
    catch (e) { notifyError((e as Error).message); }
    finally { setSalvando(false); }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="fantasma" onClick={() => onFechar()}>← Links</Botao>
        <h1 className="text-xl font-bold flex-1" style={{ color: "var(--ink)" }}>{link ? link.nome : "Novo link de agendamento"}</h1>
        {link?.arquivado_em && <Etiqueta tom="aviso">Arquivado</Etiqueta>}
      </div>

      {link && (
        <section className="rel-card p-4 space-y-2">
          <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>O link</p>
          <p className="text-[12.5px] break-all rounded-lg p-2" style={{ background: "var(--card2)", color: "var(--ink2)" }}>{urlDoLink(base(), link)}</p>
          <div className="flex flex-wrap gap-2">
            <Botao variante="primario" onClick={() => void copiar(urlDoLink(base(), link))}>Copiar link</Botao>
            <Botao onClick={() => window.open(urlDoLink(base(), link), "_blank", "noopener")}>Abrir</Botao>
          </div>
          <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
            <b>{resumo?.agendados ?? 0}</b> agendamento(s) por este link
            {link.tipo === "closer" && resumo && resumo.agendados > 0 ? ` · ${resumo.realizadas} reunião(ões) realizada(s) · ${resumo.no_show} no-show` : ""}
            {resumo?.ultimo_em ? ` · último em ${dataBr(resumo.ultimo_em)}` : ""}
          </p>
        </section>
      )}

      <section className="rel-card p-4 space-y-4">
        <Campo rotulo="Nome do link *" dica="Só pra vocês acharem depois. Ex.: Japão 2027 — stories 10/11">
          <Entrada value={f.nome} onChange={(e) => m({ nome: e.target.value })} aria-invalid={tentou && f.nome.trim().length < 2} />
        </Campo>

        <div>
          <p className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--ink)" }}>Agendar com *</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {TIPOS_LINK.map((t) => (
              <button key={t.id} type="button" onClick={() => m({ tipo: t.id as TipoLink })}
                className="text-left rounded-xl p-3 transition"
                style={{ border: `2px solid ${f.tipo === t.id ? "var(--rel)" : "var(--line)"}`, background: f.tipo === t.id ? "var(--card2)" : "transparent" }}>
                <span className="block text-[13.5px] font-bold" style={{ color: "var(--ink)" }}>{t.rotulo}</span>
                <span className="block text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>{t.texto}</span>
              </button>
            ))}
          </div>
          <p className="text-[12px] mt-1.5" style={{ color: "var(--ink3)" }}>Quem atende é escolhido sozinho (rodízio).</p>
        </div>

        <div>
          <p className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--ink)" }}>Até quando dá pra marcar *</p>
          <div className="flex flex-wrap gap-2">
            {OPCOES_DIAS_UTEIS.map((o) => (
              <button key={o.n} type="button" onClick={() => m({ dias_uteis: o.n })} aria-pressed={f.dias_uteis === o.n}
                className="rounded-xl px-3 py-2 text-[13.5px] font-semibold"
                style={{ border: `2px solid ${f.dias_uteis === o.n ? "var(--rel)" : "var(--line)"}`, background: f.dias_uteis === o.n ? "var(--card2)" : "transparent", color: "var(--ink)" }}>
                {o.rotulo}
              </button>
            ))}
          </div>
          <p className="text-[12px] mt-1.5" style={{ color: "var(--ink3)" }}>
            Conta a partir do dia em que a pessoa abre o link, só de segunda a sexta. {exemploDiasUteis(f.dias_uteis)}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Expedição / interesse" dica="Vai no título da reunião e no card. Opcional.">
            <Entrada list="mkt-ag-expedicoes" value={f.expedicao} onChange={(e) => m({ expedicao: e.target.value })} placeholder="Ex.: Japão" />
            <datalist id="mkt-ag-expedicoes">{expedicoes.map((x) => <option key={x} value={x} />)}</datalist>
          </Campo>
          <Campo rotulo="Origem (Fonte no QS)" dica="Como o time vê de onde veio. Sem = &quot;Autoagendamento&quot;.">
            <Entrada value={f.origem} onChange={(e) => m({ origem: e.target.value })} placeholder="Ex.: Instagram - Stories" />
          </Campo>
        </div>
      </section>

      <section className="rel-card p-4 space-y-3">
        <div>
          <h2 className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>UTMs (vão pro QS e pro Bitrix)</h2>
          <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Espaços viram "-". Source e medium ficam em minúsculas.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="utm_source *" dica="De onde vem: instagram, whatsapp, email…">
            <Entrada list="mkt-ag-fontes" value={f.utm_source} onChange={(e) => m({ utm_source: e.target.value })} aria-invalid={tentou && !f.utm_source.trim()} />
            <datalist id="mkt-ag-fontes">{FONTES_UTM.map((x) => <option key={x} value={x} />)}</datalist>
          </Campo>
          <Campo rotulo="utm_medium" dica="O formato: bio, stories, direct, grupo, cpc…">
            <Entrada list="mkt-ag-meios" value={f.utm_medium} onChange={(e) => m({ utm_medium: e.target.value })} />
            <datalist id="mkt-ag-meios">{MEIOS_UTM.map((x) => <option key={x} value={x} />)}</datalist>
          </Campo>
          <Campo rotulo="utm_campaign *" dica="A campanha: japao-2027, black-friday…">
            <Entrada value={f.utm_campaign} onChange={(e) => m({ utm_campaign: e.target.value })} aria-invalid={tentou && !f.utm_campaign.trim()} />
          </Campo>
          <Campo rotulo="utm_content" dica="Qual peça: video-depoimento, story-1…">
            <Entrada value={f.utm_content} onChange={(e) => m({ utm_content: e.target.value })} />
          </Campo>
          <Campo rotulo="utm_term" dica="Opcional (palavra-chave, público…)">
            <Entrada value={f.utm_term} onChange={(e) => m({ utm_term: e.target.value })} />
          </Campo>
        </div>
      </section>

      <details className="rel-card p-4">
        <summary className="text-[13.5px] font-semibold cursor-pointer" style={{ color: "var(--ink)" }}>Opções avançadas</summary>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <label className="text-[13px] flex items-center gap-2" style={{ color: "var(--ink2)" }}>
            <input type="checkbox" checked={f.tema_stfv} onChange={(e) => m({ tema_stfv: e.target.checked })} /> Cores das LPs (tema STFV)
          </label>
        </div>
      </details>

      <section className="rel-card p-4 space-y-2">
        <p className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{link ? "Como o link fica com as mudanças" : "Prévia do link"}</p>
        <p className="text-[12px] break-all" style={{ color: "var(--ink3)" }}>{previa}</p>
        {link && <p className="text-[12px]" style={{ color: "var(--ink3)" }}>O código ({link.codigo}) não muda: se o link já foi divulgado, copie de novo depois de salvar.</p>}
      </section>

      {tentou && problemas.length > 0 && <Aviso tom="erro">{problemas.join(" ")}</Aviso>}

      <div className="flex flex-wrap gap-2">
        <Botao variante="primario" disabled={salvando} onClick={() => void salvar()}>{link ? "Salvar" : "Criar e copiar o link"}</Botao>
        <Botao variante="fantasma" disabled={salvando} onClick={() => onFechar()}>Cancelar</Botao>
        {link && <Botao variante="fantasma" disabled={salvando} onClick={() => void arquivar()}>{link.arquivado_em ? "Reativar" : "Arquivar"}</Botao>}
      </div>

      {link && <Agendamentos linkId={link.id} />}
    </div>
  );
}

function Agendamentos({ linkId }: { linkId: string }) {
  const [usos, setUsos] = useState<UsoLink[] | null>(null);
  useEffect(() => { lerUsos(linkId).then(setUsos).catch(() => setUsos([])); }, [linkId]);
  if (!usos) return null;
  return (
    <section className="rel-card p-4">
      <h2 className="text-[14px] font-bold mb-2" style={{ color: "var(--ink)" }}>Agendamentos por este link ({usos.length})</h2>
      {usos.length === 0 ? (
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Ninguém agendou por este link ainda.</p>
      ) : (
        <ul className="text-[12.5px] space-y-1" style={{ color: "var(--ink2)" }}>
          {usos.map((u) => (
            <li key={u.id} className="flex flex-wrap gap-2">
              <span>{dataBr(u.criado_em)}</span>
              <Etiqueta>{NOME_TIPO[u.tipo as TipoLink] ?? u.tipo}</Etiqueta>
              <span>marcou para {dataBr(u.quando)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
