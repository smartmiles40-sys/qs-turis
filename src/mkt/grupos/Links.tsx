// src/mkt/grupos/Links.tsx — aba "Links": o LINK INTELIGENTE de grupo (0342), a
// função de lançamento do SendFlow. Um endereço (qs…/g/japao-2027) que manda cada
// pessoa pro primeiro grupo que ainda tem vaga; quando todos lotam, mostra
// "grupos lotados" ou o QS cria o próximo grupo sozinho.
//   #mkt/grupos?aba=links                  → lista
//   #mkt/grupos?aba=links&link=nova        → criar · &editar=<id> → editar
//   #mkt/grupos?aba=links&link=<id>        → grupos do link + relatório
import { useCallback, useEffect, useMemo, useState } from "react";
import { Vazio } from "@/rel/ui";
import { quando, type Grupo } from "./lib";
import { useBases } from "./useBases";
import { useParam } from "./navegar";
import { BotaoGrande, Campo, Chave, Escolha, LinhaChave, Nota, SeloBolinha, cor } from "./pecas";
import { Avatar } from "./Grupos";
import { CampoFoto, CriarGrupoModal, GerenciarGrupoModal } from "./GerenciarGrupo";
import {
  LINK_NOVO, apagarLink, buscarConvite, completar, contarAgora, criarProximoAgora, lerItensDosLinks, lerLinks, lerRelatorio,
  mudarGrupoNoLink, porGrupoNoLink, salvarLink, tirarGrupoDoLink, ultimosDias, urlDoLink,
  type CliqueDia, type LinkGrupo, type LinkGrupos, type MembrosDia,
} from "./linkLib";
import { ROTULO_SITUACAO, situacaoDosGrupos, slugDe, slugValido, type Situacao } from "./linkRegras";

const TOM_SITUACAO: Record<Situacao, "ok" | "aviso" | "erro" | "neutro"> = {
  recebendo: "ok", fila: "neutro", lotado: "aviso", sem_convite: "erro", saiu: "erro", desligado: "neutro",
};
const num = (n: number) => n.toLocaleString("pt-BR");

function useLinks() {
  const bases = useBases();
  const [links, setLinks] = useState<LinkGrupos[]>([]);
  const [itens, setItens] = useState<LinkGrupo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [pronto, setPronto] = useState(false);
  const recarregar = useCallback(async () => {
    try {
      const [l, i] = await Promise.all([lerLinks(), lerItensDosLinks(), bases.recarregar()]);
      setLinks(l); setItens(i); setErro(null);
    } catch (e) { setErro((e as Error).message); }
    finally { setPronto(true); }
  }, [bases.recarregar]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void recarregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { links, itens, grupos: bases.grupos, erro: erro || bases.erro, pronto: pronto && bases.pronto, recarregar };
}

export default function LinksAba() {
  const dados = useLinks();
  const [link, setLink] = useParam("link");
  const [editar, setEditar] = useParam("editar");
  if (!dados.pronto) return <div className="gr-cartao p-6 text-[14px]" style={{ color: cor.ink3 }}>Carregando links…</div>;
  if (link === "nova" || editar) {
    const atual = editar ? dados.links.find((l) => l.id === editar) || null : null;
    return <EditorLink link={atual} onFechar={(id) => { setEditar(null); setLink(id); void dados.recarregar(); }} />;
  }
  const aberto = link ? dados.links.find((l) => l.id === link) : null;
  if (aberto) return <DetalheLink link={aberto} itens={dados.itens} grupos={dados.grupos} onVoltar={() => setLink(null)} onEditar={() => setEditar(aberto.id)} onMudou={dados.recarregar} />;
  return <ListaLinks {...dados} onAbrir={setLink} onNovo={() => setLink("nova")} />;
}

// ── Lista ──────────────────────────────────────────────────────────────────
function ListaLinks({ links, itens, grupos, erro, onAbrir, onNovo }: {
  links: LinkGrupos[]; itens: LinkGrupo[]; grupos: Grupo[]; erro: string | null; onAbrir: (id: string) => void; onNovo: () => void;
}) {
  return (
    <div className="pb-10">
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] font-semibold" style={{ color: cor.ink }}>Links de grupo</h2>
          <p className="mt-1 text-[14px]" style={{ color: cor.ink3 }}>
            Um link só para divulgar (bio, anúncio, live). Cada pessoa cai no primeiro grupo que ainda tem vaga; quando um lota, o próximo começa a receber.
          </p>
        </div>
        <BotaoGrande onClick={onNovo}>+ Novo link</BotaoGrande>
      </div>
      {erro && <div className="mb-4"><Nota tom="erro" icone="⚠️">{erro}</Nota></div>}
      {links.length === 0 ? (
        <div className="gr-cartao"><Vazio titulo="Nenhum link ainda" texto="Crie o primeiro: dê um nome, escolha os grupos e quantas pessoas cabem em cada um." /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {links.map((l) => {
            const gs = situacaoDosGrupos(l, completar(itens.filter((i) => i.link_id === l.id), grupos));
            const ativos = gs.filter((g) => g.ativo && !g.saiu_em);
            const cap = ativos.reduce((s, g) => s + g.capacidadeEfetiva, 0);
            const ocup = ativos.reduce((s, g) => s + Math.min(g.capacidadeEfetiva, g.membros ?? 0), 0);
            const recebendo = gs.find((g) => g.situacao === "recebendo");
            return (
              <button key={l.id} type="button" onClick={() => onAbrir(l.id)} className="gr-cartao gr-cartao-clicavel p-4 text-left">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold" style={{ color: cor.ink }}>{l.nome}</div>
                    <div className="truncate text-[12.5px]" style={{ color: cor.ink3 }}>/g/{l.slug}</div>
                  </div>
                  {!l.ativo ? <SeloBolinha tom="neutro">Pausado</SeloBolinha>
                    : recebendo ? <SeloBolinha tom="ok" pulso>Recebendo</SeloBolinha>
                      : ativos.length ? <SeloBolinha tom="aviso">Lotado</SeloBolinha> : <SeloBolinha tom="erro">Sem grupo</SeloBolinha>}
                </div>
                <Barra valor={ocup} total={cap} />
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]" style={{ color: cor.ink2 }}>
                  <span><b className="tabular-nums">{num(ocup)}</b> de {num(cap)} vagas</span>
                  <span>{gs.length} grupo{gs.length === 1 ? "" : "s"}</span>
                  <span><b className="tabular-nums">{num(l.cliques)}</b> cliques</span>
                </div>
                {recebendo && <div className="mt-1 truncate text-[12px]" style={{ color: cor.ink3 }}>Agora: {recebendo.nome || "grupo"}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Barra({ valor, total, pendente = 0 }: { valor: number; total: number; pendente?: number }) {
  const pct = total ? Math.min(100, (valor / total) * 100) : 0;
  const pctP = total ? Math.min(100 - pct, (pendente / total) * 100) : 0;
  return (
    <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full" style={{ background: cor.card2 }} role="img" aria-label={`${Math.round(pct)}% ocupado`}>
      <span style={{ width: `${pct}%`, background: pct >= 100 ? "var(--amber, #f59e0b)" : "var(--rel)" }} />
      {pctP > 0 && <span style={{ width: `${pctP}%`, background: "var(--rel)", opacity: 0.35 }} title="Cliques que ainda não foram contados como membros" />}
    </div>
  );
}

// ── Editor ─────────────────────────────────────────────────────────────────
function EditorLink({ link, onFechar }: { link: LinkGrupos | null; onFechar: (id: string | null) => void }) {
  const [f, setF] = useState(() => (link ? { ...LINK_NOVO, ...link } : { ...LINK_NOVO }));
  const [slugMexido, setSlugMexido] = useState(Boolean(link));
  const [admins, setAdmins] = useState((link?.modelo_admins || []).join("\n"));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [apagando, setApagando] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const adminsLimpos = admins.split(/[\n,;]+/).map((s) => s.replace(/\D/g, "")).filter(Boolean).map((d) => (d.length === 10 || d.length === 11 ? `55${d}` : d));
  const adminRuim = adminsLimpos.find((d) => d.length < 12 || d.length > 15);
  const erros: string[] = [];
  if (!f.nome.trim()) erros.push("Dê um nome ao link.");
  if (!slugValido(f.slug)) erros.push("Endereço: de 3 a 60 letras, números e hífen.");
  if (!(f.capacidade >= 1 && f.capacidade <= 5000)) erros.push("Vagas por grupo: de 1 a 5000.");
  if (f.ao_lotar === "criar_grupo") {
    if (!String(f.modelo_nome || "").trim()) erros.push("Diga o nome dos grupos novos.");
    if (!adminsLimpos.length) erros.push("Ponha pelo menos um admin nos grupos novos.");
  }
  if (adminRuim) erros.push(`Número de admin inválido: ${adminRuim}`);

  async function salvar() {
    setOcupado(true); setErro(null);
    try {
      const campos = {
        slug: f.slug, nome: f.nome.trim(), ativo: f.ativo, capacidade: Number(f.capacidade), ao_lotar: f.ao_lotar,
        mensagem_lotado: f.mensagem_lotado?.trim() || null, titulo_publico: f.titulo_publico?.trim() || null, descricao_publica: f.descricao_publica?.trim() || null,
        modelo_nome: f.modelo_nome?.trim() || null, modelo_descricao: f.modelo_descricao?.trim() || null, modelo_foto_url: f.modelo_foto_url || null,
        modelo_admins: [...new Set(adminsLimpos)], modelo_so_admins_enviam: f.modelo_so_admins_enviam, modelo_so_admins_editam: f.modelo_so_admins_editam,
        criar_ao_pct: Number(f.criar_ao_pct), limite_auto: Number(f.limite_auto),
      };
      const salvo = await salvarLink(campos, link?.id);
      onFechar(salvo.id);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }
  async function apagar() {
    if (!link) return;
    setOcupado(true);
    try { await apagarLink(link.id); onFechar(null); } catch (e) { setErro((e as Error).message); setOcupado(false); }
  }

  return (
    <div className="mx-auto max-w-[720px] pb-10">
      <button type="button" className="mb-3 text-[13px] font-semibold" style={{ color: cor.relInk }} onClick={() => onFechar(link?.id || null)}>← Voltar</button>
      <h2 className="mb-5 text-[20px] font-semibold" style={{ color: cor.ink }}>{link ? "Editar link" : "Novo link de grupo"}</h2>
      <div className="gr-cartao p-5">
        <Campo rotulo="Nome" dica="(só o time vê)">
          <input className="rel-input" maxLength={80} value={f.nome} placeholder="Ex.: Lançamento Japão 2027"
            onChange={(e) => { set("nome", e.target.value); if (!slugMexido) set("slug", slugDe(e.target.value)); }} />
        </Campo>
        <Campo rotulo="Endereço do link" dica="(o que você divulga)">
          <div className="flex items-center gap-1 rounded-xl px-3" style={{ background: cor.card2, border: "1px solid var(--line)" }}>
            <span className="shrink-0 text-[13px]" style={{ color: cor.ink3 }}>{window.location.host}/g/</span>
            <input className="min-w-0 flex-1 bg-transparent py-2 text-[14px] outline-none" style={{ color: cor.ink }} value={f.slug} maxLength={60}
              onChange={(e) => { setSlugMexido(true); set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); }} aria-label="Endereço" />
          </div>
          {link && link.slug !== f.slug && <p className="mt-1.5 text-[12px]" style={{ color: "var(--warn-ink)" }}>Trocar o endereço quebra o link que já foi divulgado.</p>}
        </Campo>
        <Campo rotulo="Vagas por grupo" dica="(o WhatsApp aceita até 1024 em grupo comum; dá pra mudar grupo a grupo depois)">
          <input className="rel-input" style={{ maxWidth: 160 }} type="number" min={1} max={5000} value={f.capacidade} onChange={(e) => set("capacidade", Number(e.target.value))} />
        </Campo>
        <div className="mb-5">
          <LinhaChave titulo="Link ligado" texto="Desligado, quem clica vê a mensagem de lotado." ligada={f.ativo} onChange={(v) => set("ativo", v)} />
        </div>

        <Campo rotulo="Quando todos os grupos lotarem">
          <div className="flex flex-wrap gap-2">
            <Escolha ativo={f.ao_lotar === "pagina"} onClick={() => set("ao_lotar", "pagina")}>Mostrar “grupos lotados”</Escolha>
            <Escolha ativo={f.ao_lotar === "criar_grupo"} onClick={() => set("ao_lotar", "criar_grupo")}>Criar o próximo grupo sozinho</Escolha>
          </div>
        </Campo>
        <Campo rotulo="Mensagem de grupos lotados" dica="(opcional)">
          <textarea className="rel-input" rows={2} maxLength={500} value={f.mensagem_lotado || ""} onChange={(e) => set("mensagem_lotado", e.target.value)}
            placeholder="Todos os grupos estão cheios. Fique de olho no nosso Instagram: logo abrimos mais vagas." />
        </Campo>

        {f.ao_lotar === "criar_grupo" && (
          <div className="mb-5 rounded-xl p-4" style={{ background: cor.card2, border: "1px solid var(--line)" }}>
            <div className="mb-3 text-[14px] font-semibold" style={{ color: cor.ink }}>Modelo dos grupos novos</div>
            <Campo rotulo="Nome" dica="({n} vira o número do grupo)">
              <input className="rel-input" maxLength={100} value={f.modelo_nome || ""} onChange={(e) => set("modelo_nome", e.target.value)} placeholder="Japão 2027 #{n}" />
            </Campo>
            <Campo rotulo="Descrição"><textarea className="rel-input" rows={3} maxLength={2048} value={f.modelo_descricao || ""} onChange={(e) => set("modelo_descricao", e.target.value)} /></Campo>
            <Campo rotulo="Foto"><CampoFoto url={f.modelo_foto_url} onUrl={(u) => set("modelo_foto_url", u)} /></Campo>
            <Campo rotulo="Admins" dica="(um número por linha, com DDD)">
              <textarea className="rel-input" rows={2} value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder="11 99999-8888" />
            </Campo>
            <div className="mb-4 flex flex-col gap-2">
              <LinhaChave titulo="Só admins mandam mensagem" texto="" ligada={f.modelo_so_admins_enviam} onChange={(v) => set("modelo_so_admins_enviam", v)} />
              <LinhaChave titulo="Só admins mudam nome, foto e descrição" texto="" ligada={f.modelo_so_admins_editam} onChange={(v) => set("modelo_so_admins_editam", v)} />
            </div>
            <div className="flex flex-wrap gap-4">
              <Campo rotulo="Criar quando o último chegar a" className="mb-0">
                <div className="flex items-center gap-1.5"><input className="rel-input" style={{ width: 90 }} type="number" min={50} max={100} value={f.criar_ao_pct} onChange={(e) => set("criar_ao_pct", Number(e.target.value))} /><span style={{ color: cor.ink3 }}>%</span></div>
              </Campo>
              <Campo rotulo="No máximo" className="mb-0">
                <div className="flex items-center gap-1.5"><input className="rel-input" style={{ width: 90 }} type="number" min={0} max={50} value={f.limite_auto} onChange={(e) => set("limite_auto", Number(e.target.value))} /><span style={{ color: cor.ink3 }}>grupos novos</span></div>
              </Campo>
            </div>
            <p className="mt-3 text-[12px]" style={{ color: cor.ink3 }}>
              A criação sozinha só acontece com a chave MKT_GRUPOS_LINK_AUTO=1 ligada pelo Bruno. Sem ela, use “Criar o próximo grupo agora” no link.
            </p>
          </div>
        )}

        <details className="mb-5">
          <summary className="cursor-pointer text-[13px] font-semibold" style={{ color: cor.ink }}>Como aparece quando alguém compartilha o link</summary>
          <div className="pt-3">
            <Campo rotulo="Título"><input className="rel-input" maxLength={80} value={f.titulo_publico || ""} onChange={(e) => set("titulo_publico", e.target.value)} placeholder={f.nome || "Grupo do WhatsApp"} /></Campo>
            <Campo rotulo="Frase"><input className="rel-input" maxLength={200} value={f.descricao_publica || ""} onChange={(e) => set("descricao_publica", e.target.value)} placeholder="Entre no grupo oficial da live" /></Campo>
          </div>
        </details>

        {(erro || (erros.length > 0 && f.nome)) && <div className="mb-4"><Nota tom="erro" icone="⚠️">{erro || erros.join(" ")}</Nota></div>}
        <div className="flex flex-wrap items-center gap-2">
          <BotaoGrande disabled={ocupado || erros.length > 0} onClick={() => void salvar()}>{ocupado ? "Salvando…" : link ? "Salvar" : "Criar link"}</BotaoGrande>
          <BotaoGrande variante="secundario" onClick={() => onFechar(link?.id || null)}>Cancelar</BotaoGrande>
          {link && (apagando ? (
            <span className="flex items-center gap-2 text-[13px]" style={{ color: cor.ink3 }}>
              Apagar o link e o relatório dele? (os grupos continuam)
              <BotaoGrande pequeno variante="perigo" style={{ border: "1px solid var(--err-line)" }} onClick={() => void apagar()}>Sim, apagar</BotaoGrande>
              <BotaoGrande pequeno variante="secundario" onClick={() => setApagando(false)}>Não</BotaoGrande>
            </span>
          ) : <BotaoGrande variante="perigo" onClick={() => setApagando(true)}>Apagar link</BotaoGrande>)}
        </div>
      </div>
    </div>
  );
}

// ── Detalhe: grupos do link + relatório ────────────────────────────────────
function DetalheLink({ link, itens, grupos, onVoltar, onEditar, onMudou }: {
  link: LinkGrupos; itens: LinkGrupo[]; grupos: Grupo[]; onVoltar: () => void; onEditar: () => void; onMudou: () => Promise<void>;
}) {
  const doLink = useMemo(() => situacaoDosGrupos(link, completar(itens.filter((i) => i.link_id === link.id), grupos)), [link, itens, grupos]);
  const [rel, setRel] = useState<{ cliques: CliqueDia[]; membros: MembrosDia[] } | null>(null);
  const [msg, setMsg] = useState<{ tom: "rel" | "erro" | "aviso"; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [adicionar, setAdicionar] = useState("");
  const [criando, setCriando] = useState(false);
  const [gerenciar, setGerenciar] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const url = urlDoLink(link.slug);
  const jids = doLink.map((g) => g.grupo_jid).join(",");

  const lerRel = useCallback(async () => {
    try { setRel(await lerRelatorio(link.id, jids ? jids.split(",") : [], 30)); } catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); }
  }, [link.id, jids]);
  useEffect(() => { void lerRel(); }, [lerRel]);

  async function rodar(chave: string, f: () => Promise<string | void>) {
    setOcupado(chave); setMsg(null);
    try { const t = await f(); await onMudou(); await lerRel(); if (t) setMsg({ tom: "rel", texto: t }); }
    catch (e) { setMsg({ tom: "erro", texto: (e as Error).message }); }
    finally { setOcupado(null); }
  }

  const disponiveis = grupos.filter((g) => !g.saiu_em && !doLink.some((x) => x.grupo_jid === g.jid));
  async function porGrupo(jid: string) {
    await rodar("add", async () => {
      const ordem = Math.max(0, ...doLink.map((g) => g.ordem)) + 1;
      await porGrupoNoLink(link.id, jid, ordem);
      const g = grupos.find((x) => x.jid === jid);
      if (!g?.link_convite) {
        try { const r = await buscarConvite(jid); if (!r.link) return "Grupo adicionado, mas sem link de convite: o chip precisa ser admin dele."; }
        catch (e) { return `Grupo adicionado, mas não li o link de convite (${(e as Error).message}). O chip precisa ser admin.`; }
      }
      setAdicionar("");
      return "Grupo adicionado no fim da fila.";
    });
  }
  async function mover(i: number, d: -1 | 1) {
    const a = doLink[i]; const b = doLink[i + d];
    if (!a || !b) return;
    await rodar(`mover-${a.grupo_jid}`, async () => {
      // ordens únicas e na sequência (evita empate quando vinham iguais)
      const nova = doLink.map((g) => g.grupo_jid);
      [nova[i], nova[i + d]] = [nova[i + d], nova[i]];
      await Promise.all(nova.map((jid, k) => (doLink.find((g) => g.grupo_jid === jid)?.ordem === k + 1 ? null : mudarGrupoNoLink(link.id, jid, { ordem: k + 1 }))));
    });
  }

  // números do relatório
  const dias = useMemo(() => ultimosDias(30), []);
  const hoje = dias[dias.length - 1];
  const porDia = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of rel?.cliques || []) m.set(c.dia, (m.get(c.dia) || 0) + c.cliques);
    return dias.map((d) => ({ dia: d, cliques: m.get(d) || 0 }));
  }, [rel, dias]);
  const lotadosDia = (rel?.cliques || []).filter((c) => !c.grupo_jid).reduce((s, c) => s + c.cliques, 0);
  const movPorGrupo = useMemo(() => {
    const m = new Map<string, { entradas: number; saidas: number }>();
    for (const x of rel?.membros || []) { const a = m.get(x.grupo_jid) || { entradas: 0, saidas: 0 }; a.entradas += x.entradas; a.saidas += x.saidas; m.set(x.grupo_jid, a); }
    return m;
  }, [rel]);
  const ativos = doLink.filter((g) => g.ativo && !g.saiu_em);
  const membros = ativos.reduce((s, g) => s + (g.membros ?? 0), 0);
  const vagas = ativos.reduce((s, g) => s + Math.max(0, g.capacidadeEfetiva - (g.membros ?? 0)), 0);
  const entradas = [...movPorGrupo.values()].reduce((s, x) => s + x.entradas, 0);
  const saidas = [...movPorGrupo.values()].reduce((s, x) => s + x.saidas, 0);
  const grupoAberto = gerenciar ? grupos.find((g) => g.jid === gerenciar) : null;

  return (
    <div className="pb-10">
      <button type="button" className="mb-3 text-[13px] font-semibold" style={{ color: cor.relInk }} onClick={onVoltar}>← Todos os links</button>
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-semibold" style={{ color: cor.ink }}>{link.nome}</h2>
            {link.ativo ? <SeloBolinha tom="ok">Ligado</SeloBolinha> : <SeloBolinha tom="neutro">Pausado</SeloBolinha>}
          </div>
          <div className="mt-2 flex max-w-[560px] items-center gap-2 rounded-xl px-3 py-2" style={{ background: cor.card2, border: "1px solid var(--line)" }}>
            <code className="min-w-0 flex-1 truncate text-[13px]" style={{ color: cor.ink }}>{url}</code>
            <BotaoGrande pequeno onClick={() => { void navigator.clipboard.writeText(url).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); }, () => setMsg({ tom: "erro", texto: "Não consegui copiar — selecione e copie à mão." })); }}>{copiado ? "Copiado ✓" : "Copiar"}</BotaoGrande>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 text-[13px]" style={{ color: cor.ink2 }}>
            <Chave ligada={link.ativo} rotulo="Link ligado" disabled={Boolean(ocupado)} onChange={(v) => void rodar("ativo", async () => { await salvarLink({ ativo: v }, link.id); })} />
            {link.ativo ? "Ligado" : "Pausado"}
          </span>
          <BotaoGrande pequeno variante="secundario" onClick={onEditar}>✏️ Editar</BotaoGrande>
          <BotaoGrande pequeno variante="secundario" disabled={Boolean(ocupado)} onClick={() => void rodar("contar", async () => {
            const r = await contarAgora(link.id);
            if (r.parado) throw new Error(r.parado);
            return `Contei ${r.contados ?? 0} grupo(s) no WhatsApp${r.falhas ? ` · ${r.falhas} falharam` : ""}.`;
          })}>{ocupado === "contar" ? "Contando…" : "🔄 Contar membros agora"}</BotaoGrande>
        </div>
      </div>

      {msg && <div className="mb-4"><Nota tom={msg.tom} icone={msg.tom === "erro" ? "⚠️" : "✅"}>{msg.texto}</Nota></div>}
      {link.ultimo_erro && <div className="mb-4"><Nota tom="aviso" icone="⚠️">Última criação de grupo: {link.ultimo_erro}</Nota></div>}

      {/* números */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Numero rotulo="Cliques (total)" valor={num(link.cliques)} />
        <Numero rotulo="Cliques hoje" valor={num(porDia.find((d) => d.dia === hoje)?.cliques || 0)} />
        <Numero rotulo="Pessoas nos grupos" valor={num(membros)} />
        <Numero rotulo="Vagas livres" valor={num(vagas)} />
      </div>

      <div className="gr-cartao mb-4 p-4">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold" style={{ color: cor.ink }}>Cliques por dia</h3>
          <span className="text-[12px]" style={{ color: cor.ink3 }}>
            últimos 30 dias{lotadosDia ? ` · ${num(lotadosDia)} encontraram tudo lotado` : ""} · {num(entradas)} entradas · {num(saidas)} saídas
          </span>
        </div>
        <GraficoCliques dados={porDia} />
      </div>

      {/* grupos do link */}
      <div className="gr-cartao overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--line)" }}>
          <h3 className="flex-1 text-[14px] font-semibold" style={{ color: cor.ink }}>Grupos, na ordem em que enchem</h3>
          <select className="rel-input min-w-0" style={{ maxWidth: 260 }} value={adicionar} onChange={(e) => setAdicionar(e.target.value)} aria-label="Grupo para adicionar">
            <option value="">Adicionar grupo que já existe…</option>
            {disponiveis.map((g) => <option key={g.jid} value={g.jid}>{g.nome || g.jid}{g.eu_admin === false ? " (chip não é admin)" : ""}</option>)}
          </select>
          <BotaoGrande pequeno disabled={!adicionar || Boolean(ocupado)} onClick={() => void porGrupo(adicionar)}>Adicionar</BotaoGrande>
          <BotaoGrande pequeno variante="secundario" onClick={() => setCriando(true)}>+ Criar grupo novo</BotaoGrande>
          {link.modelo_nome && (link.modelo_admins || []).length > 0 && (
            <BotaoGrande pequeno variante="secundario" disabled={Boolean(ocupado)} onClick={() => void rodar("proximo", async () => {
              const r = await criarProximoAgora(link.id);
              return `Criei “${r.grupo.nome}” e pus no fim da fila.${r.grupo.avisos.length ? ` Atenção: ${r.grupo.avisos.join(" · ")}` : ""}`;
            })}>{ocupado === "proximo" ? "Criando…" : "Criar o próximo pelo modelo"}</BotaoGrande>
          )}
        </div>
        {doLink.length === 0 ? (
          <Vazio titulo="Nenhum grupo neste link" texto="Adicione um grupo em que o chip do Marketing é admin, ou crie um novo." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]" style={{ color: cor.ink }}>
              <thead>
                <tr className="text-left text-[11.5px] uppercase tracking-[0.06em]" style={{ color: cor.ink3 }}>
                  <th className="px-3 py-2 font-semibold">Ordem</th>
                  <th className="px-3 py-2 font-semibold">Grupo</th>
                  <th className="px-3 py-2 font-semibold">Ocupação</th>
                  <th className="px-3 py-2 text-right font-semibold">Cliques</th>
                  <th className="px-3 py-2 text-right font-semibold" title="Últimos 30 dias (pelo aviso do WhatsApp)">Entraram</th>
                  <th className="px-3 py-2 text-right font-semibold" title="Últimos 30 dias">Saíram</th>
                  <th className="px-3 py-2 font-semibold">Vagas</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {doLink.map((g, i) => {
                  const mov = movPorGrupo.get(g.grupo_jid) || { entradas: 0, saidas: 0 };
                  return (
                    <tr key={g.grupo_jid} style={{ borderTop: "1px solid var(--line)", opacity: g.ativo ? 1 : 0.6 }}>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1">
                          <span className="w-5 tabular-nums" style={{ color: cor.ink3 }}>{i + 1}</span>
                          <button type="button" className="gr-icone-btn" style={{ width: 26, height: 26 }} aria-label="Subir" disabled={i === 0 || Boolean(ocupado)} onClick={() => void mover(i, -1)}>▲</button>
                          <button type="button" className="gr-icone-btn" style={{ width: 26, height: 26 }} aria-label="Descer" disabled={i === doLink.length - 1 || Boolean(ocupado)} onClick={() => void mover(i, 1)}>▼</button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Avatar grupo={{ nome: g.nome, foto_url: g.foto_url }} tamanho={28} />
                          <div className="min-w-0">
                            <div className="max-w-[220px] truncate font-semibold">{g.nome || g.grupo_jid}</div>
                            <div className="mt-0.5 flex flex-wrap gap-1">
                              <SeloBolinha tom={TOM_SITUACAO[g.situacao]} pulso={g.situacao === "recebendo"}>{ROTULO_SITUACAO[g.situacao]}</SeloBolinha>
                              {g.criado_auto && <span className="text-[11px]" style={{ color: cor.ink3 }}>criado sozinho</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2" style={{ minWidth: 140 }}>
                        <div className="tabular-nums">{num(g.membros ?? 0)} / {num(g.capacidadeEfetiva)}{g.pendentes ? <span style={{ color: cor.ink3 }}> (+{g.pendentes})</span> : null}</div>
                        <Barra valor={g.membros ?? 0} total={g.capacidadeEfetiva} pendente={g.pendentes} />
                        <div className="mt-1 text-[11px]" style={{ color: cor.ink3 }}>contado {quando(g.contado_em)}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(g.cliques)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(mov.entradas)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(mov.saidas)}</td>
                      <td className="px-3 py-2">
                        <input className="rel-input" style={{ width: 84 }} type="number" min={1} max={5000} placeholder={String(link.capacidade)} aria-label="Vagas deste grupo"
                          defaultValue={g.capacidade ?? ""} onBlur={(e) => {
                            const v = e.target.value === "" ? null : Number(e.target.value);
                            if (v === g.capacidade || (v !== null && !(v >= 1 && v <= 5000))) return;
                            void rodar(`cap-${g.grupo_jid}`, async () => { await mudarGrupoNoLink(link.id, g.grupo_jid, { capacidade: v }); });
                          }} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <button type="button" className="gr-icone-btn" title={g.ativo ? "Parar de mandar gente pra este grupo" : "Voltar a mandar gente"} aria-label={g.ativo ? "Desligar no link" : "Ligar no link"} disabled={Boolean(ocupado)}
                            onClick={() => void rodar(`ativo-${g.grupo_jid}`, async () => { await mudarGrupoNoLink(link.id, g.grupo_jid, { ativo: !g.ativo }); })}>{g.ativo ? "⏸" : "▶"}</button>
                          <button type="button" className="gr-icone-btn" title="Gerenciar o grupo (convite, pessoas, dados)" aria-label="Gerenciar o grupo" disabled={!grupos.some((x) => x.jid === g.grupo_jid) || Boolean(g.saiu_em)} onClick={() => setGerenciar(g.grupo_jid)}>⚙</button>
                          <button type="button" className="gr-icone-btn" title="Tirar do link (o grupo continua existindo)" aria-label="Tirar do link" disabled={Boolean(ocupado)}
                            onClick={() => void rodar(`tirar-${g.grupo_jid}`, async () => { await tirarGrupoDoLink(link.id, g.grupo_jid); return "Grupo tirado do link."; })}>✕</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="mt-3 text-[12px]" style={{ color: cor.ink3 }}>
        Os membros são contados no WhatsApp a cada poucos minutos. Entre uma contagem e outra, cada clique novo ocupa uma vaga “provisória” (+N) — por isso o próximo grupo pode começar a receber um pouco antes. Entradas e saídas chegam pelo aviso do WhatsApp (webhook do chip).
      </p>

      {criando && <CriarGrupoModal linkId={link.id} nomeSugerido={link.modelo_nome ? link.modelo_nome.split("{n}").join(String(doLink.length + 1)) : ""}
        onCriado={async () => { await onMudou(); }} onFechar={() => setCriando(false)} />}
      {grupoAberto && <GerenciarGrupoModal grupo={grupoAberto} onFechar={() => setGerenciar(null)} onMudou={onMudou} />}
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="gr-cartao px-4 py-3">
      <div className="text-[12px]" style={{ color: cor.ink3 }}>{rotulo}</div>
      <div className="mt-0.5 text-[22px] font-semibold tabular-nums" style={{ color: cor.ink }}>{valor}</div>
    </div>
  );
}

/** Barras finas, uma por dia (uma série só: sem legenda; o título diz o que é). Passar o mouse mostra o número. */
function GraficoCliques({ dados }: { dados: { dia: string; cliques: number }[] }) {
  const [foco, setFoco] = useState<number | null>(null);
  const max = Math.max(1, ...dados.map((d) => d.cliques));
  const total = dados.reduce((s, d) => s + d.cliques, 0);
  const rotulo = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  if (!total) return <p className="py-6 text-center text-[13px]" style={{ color: cor.ink3 }}>Nenhum clique nos últimos 30 dias.</p>;
  const f = foco !== null ? dados[foco] : null;
  return (
    <div>
      <div className="h-5 text-[12px] tabular-nums" style={{ color: cor.ink2 }} aria-live="polite">
        {f ? <><b>{rotulo(f.dia)}</b>: {num(f.cliques)} clique{f.cliques === 1 ? "" : "s"}</> : <>{num(total)} cliques no período · máximo {num(max)} num dia</>}
      </div>
      <div className="flex h-[120px] items-end gap-[2px]" role="img" aria-label={`Cliques por dia: total ${total}`} onMouseLeave={() => setFoco(null)}>
        {dados.map((d, i) => (
          <div key={d.dia} className="flex h-full flex-1 cursor-default items-end" onMouseEnter={() => setFoco(i)} onFocus={() => setFoco(i)} tabIndex={-1} title={`${rotulo(d.dia)}: ${d.cliques}`}>
            <div className="w-full rounded-t-[4px]" style={{ height: `${d.cliques ? Math.max(3, (d.cliques / max) * 100) : 0}%`, background: "var(--rel)", opacity: foco === null || foco === i ? 1 : 0.45 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] tabular-nums" style={{ color: cor.ink3, borderTop: "1px solid var(--line)" }}>
        <span>{rotulo(dados[0].dia)}</span><span>{rotulo(dados[Math.floor(dados.length / 2)].dia)}</span><span>hoje</span>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12px]" style={{ color: cor.ink3 }}>Ver em tabela</summary>
        <table className="mt-2 text-[12px] tabular-nums" style={{ color: cor.ink2 }}>
          <tbody>{dados.filter((d) => d.cliques).map((d) => <tr key={d.dia}><td className="pr-4">{rotulo(d.dia)}</td><td className="text-right">{num(d.cliques)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
