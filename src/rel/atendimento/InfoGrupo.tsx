// src/rel/atendimento/InfoGrupo.tsx
// -----------------------------------------------------------------------------
// "DADOS DO GRUPO" igual ao WhatsApp (28/10/2026, 0219) — abre ao clicar no
// topo da conversa do grupo:
//   foto · nome · descrição (muda quem pode) · viagem ligada · mídia/docs ·
//   agendadas · link de convite · ajustes · participantes (adicionar, remover,
//   promover/tirar admin — só quando o número é admin).
// Nada aqui fala com pessoa pela ligação dos grupos: "Conversar no privado"
// abre o número oficial, e o convite é um link copiado.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AvatarWa } from "./waUi";
import MenuContexto, { ICO, posicaoDoEvento, type ItemMenu, type PosicaoMenu } from "./MenuContexto";
import { FotoGrupo, ListaAgendadas, nomeDoGrupo } from "./GrupoExtras";
import { VinculoDoGrupo } from "./VinculoGrupo";
import {
  ajustarGrupo, infoDoGrupo, linkDeConvite, midiasDoGrupo, mudarDescricaoDoGrupo, mudarFotoDoGrupo, mudarNomeDoGrupo, mudarParticipantes,
  type Grupo, type InfoGrupo as Info, type MensagemGrupo, type OperacaoParticipante, type Participante,
} from "../lib/grupos";

function Bloco({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-5 py-4" style={{ background: "var(--wa-list)", borderBottom: "8px solid var(--wa-head)" }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13.5px]" style={{ color: "var(--wa-meta)" }}>{titulo}</h3>
        {acao}
      </div>
      {children}
    </section>
  );
}
const btnVerde = "text-[13px] font-semibold";
const campo = { background: "var(--wa-head)", color: "var(--wa-txt)", border: "1px solid var(--wa-line)" } as const;

export default function InfoGrupo({ grupo, participantes, onFechar, onMudou, onRecarregarParticipantes, onPrivado, versaoAgendadas, onAgendar }: {
  grupo: Grupo; participantes: Participante[];
  onFechar: () => void; onMudou: () => void; onRecarregarParticipantes: () => void;
  onPrivado?: (telefone: string, nome: string) => void;
  versaoAgendadas: number; onAgendar: () => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editNome, setEditNome] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState<string | null>(null);
  const [convite, setConvite] = useState<string | null>(null);
  const [addTel, setAddTel] = useState<string | null>(null);
  const [buscaPart, setBuscaPart] = useState("");
  const [midias, setMidias] = useState<MensagemGrupo[] | null>(null);
  const [menu, setMenu] = useState<{ p: Participante; pos: PosicaoMenu } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const fotoRef = useRef<HTMLInputElement>(null);

  const ler = useCallback(async () => {
    setLendo(true); setErro(null);
    try { setInfo(await infoDoGrupo(grupo.jid)); onMudou(); onRecarregarParticipantes(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não consegui ler o grupo agora."); }
    setLendo(false);
  }, [grupo.jid]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void ler(); }, [ler]);
  useEffect(() => { midiasDoGrupo(grupo.jid).then(setMidias).catch(() => setMidias([])); }, [grupo.jid]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 3000); return () => clearTimeout(t); }, [aviso]);

  const souAdmin = info?.eu_admin ?? !!grupo.eu_admin;
  const podeEditarDados = souAdmin || (info ? !info.so_admins_editam : grupo.so_admins_editam === false);
  const descricao = info?.descricao ?? grupo.descricao;

  async function fazer(fn: () => Promise<unknown>, ok?: string, depois?: () => void) {
    setOcupado(true); setErro(null);
    try { await fn(); if (ok) setAviso(ok); depois?.(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    setOcupado(false);
  }

  async function participantesOp(op: OperacaoParticipante, tels: string[], rotulo: string) {
    setOcupado(true); setErro(null);
    try {
      const r = await mudarParticipantes(grupo.jid, op, tels);
      const ruins = r.resultado.filter((x) => !x.ok);
      if (ruins.length) setErro(ruins.map((x) => `+${x.telefone}: ${x.msg}`).join(" · "));
      else setAviso(rotulo);
      onRecarregarParticipantes(); onMudou();
    } catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    setOcupado(false);
  }

  const visiveis = useMemo(() => {
    const q = buscaPart.trim().toLowerCase();
    const l = q ? participantes.filter((p) => p.nome.toLowerCase().includes(q) || p.telefone.includes(q.replace(/\D/g, "") || "§")) : participantes;
    return [...l].sort((a, b) => Number(!!b.admin) - Number(!!a.admin));
  }, [participantes, buscaPart]);

  function itensDoParticipante(p: Participante): ItemMenu[] {
    const primeiro = p.nome.split(" ")[0];
    const itens: ItemMenu[] = [];
    if (onPrivado) itens.push({ rotulo: `Conversar no privado com ${primeiro}`, icone: ICO.contato, onClick: () => onPrivado(p.telefone, p.nome) });
    itens.push({ rotulo: "Copiar telefone", icone: ICO.copiar, onClick: () => void navigator.clipboard?.writeText(`+${p.telefone}`).then(() => setAviso("Telefone copiado.")) });
    if (souAdmin) {
      itens.push({ tipo: "separador" });
      if (p.admin) itens.push({ rotulo: "Tirar de admin", icone: ICO.etiqueta, onClick: () => void participantesOp("demote", [p.telefone], `${primeiro} não é mais admin.`) });
      else itens.push({ rotulo: "Promover a admin", icone: ICO.estrela, onClick: () => void participantesOp("promote", [p.telefone], `${primeiro} agora é admin.`) });
      itens.push({ rotulo: `Remover ${primeiro} do grupo`, icone: ICO.resolver, perigo: true, onClick: () => { if (window.confirm(`Remover ${p.nome} do grupo "${nomeDoGrupo(grupo)}"?`)) void participantesOp("remove", [p.telefone], `${primeiro} saiu do grupo.`); } });
    }
    return itens;
  }

  const fotos = (midias || []).filter((m) => m.tipo === "imagem" || m.tipo === "video").slice(0, 12);
  const docs = (midias || []).filter((m) => m.tipo === "arquivo").slice(0, 8);

  return (
    <aside className="flex flex-col min-h-0 h-full w-full lg:w-[400px] lg:flex-shrink-0 border-l" style={{ borderColor: "var(--wa-line)", background: "var(--wa-head)" }} aria-label="Dados do grupo">
      <header className="flex items-center gap-4 px-4 py-3.5 wa-cab" style={{ borderBottom: "1px solid var(--wa-line)" }}>
        <button className="wa-icone p-1.5" onClick={onFechar} aria-label="Fechar dados do grupo">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        <h2 className="text-[16px] flex-1" style={{ color: "var(--wa-txt)" }}>Dados do grupo</h2>
        <button className="wa-icone px-2 py-1 text-[12.5px]" onClick={() => void ler()} disabled={lendo} title="Ler de novo no WhatsApp">{lendo ? "Lendo…" : "Atualizar"}</button>
      </header>

      <div className="flex-1 overflow-y-auto min-h-0">
        {(erro || aviso) && (
          <p className="px-5 py-2 text-[12.5px]" style={{ background: erro ? "#FDE2E1" : "var(--wa-list)", color: erro ? "#B42318" : "var(--wa-green-ink)" }}>{erro || aviso}</p>
        )}

        {/* foto + nome */}
        <section className="px-5 py-6 text-center" style={{ background: "var(--wa-list)", borderBottom: "8px solid var(--wa-head)" }}>
          <button type="button" className="relative inline-block rounded-full group" disabled={!podeEditarDados || ocupado} onClick={() => fotoRef.current?.click()}
            aria-label={podeEditarDados ? "Trocar foto do grupo" : "Foto do grupo"} title={podeEditarDados ? "Trocar foto do grupo" : undefined}>
            <FotoGrupo grupo={{ nome: grupo.nome, foto_url: info?.foto_url ?? grupo.foto_url }} tamanho={160} />
            {podeEditarDados && <span className="absolute inset-0 rounded-full items-center justify-center text-[13px] font-semibold hidden group-hover:flex" style={{ background: "rgba(0,0,0,.45)", color: "#fff" }}>Trocar foto</span>}
          </button>
          <input ref={fotoRef} type="file" hidden accept="image/jpeg,image/png" onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (f) void fazer(() => mudarFotoDoGrupo(grupo.jid, f), "Foto trocada.", () => void ler());
          }} />
          {editNome === null ? (
            <p className="mt-3 text-[22px] break-words" style={{ color: "var(--wa-txt)" }}>
              {nomeDoGrupo({ nome: info?.nome ?? grupo.nome })}
              {podeEditarDados && <button className="wa-icone ml-2 p-1 align-middle" aria-label="Mudar nome do grupo" onClick={() => setEditNome(info?.nome ?? grupo.nome ?? "")}>✏️</button>}
            </p>
          ) : (
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void fazer(() => mudarNomeDoGrupo(grupo.jid, editNome), "Nome trocado.", () => { setEditNome(null); void ler(); }); }}>
              <input className="flex-1 px-3 py-2 rounded-lg text-[15px]" style={campo} value={editNome} maxLength={100} onChange={(e) => setEditNome(e.target.value)} autoFocus aria-label="Nome do grupo" />
              <button type="submit" className="wa-verde rounded-lg px-3 text-[13px] font-semibold" disabled={ocupado}>Salvar</button>
              <button type="button" className="wa-icone px-2" onClick={() => setEditNome(null)} aria-label="Cancelar">✕</button>
            </form>
          )}
          <p className="text-[14px] mt-1" style={{ color: "var(--wa-meta)" }}>
            {info?.comunidade ? "Comunidade" : "Grupo"} · {info?.participantes ?? grupo.participantes ?? participantes.length} participantes
            {souAdmin ? " · você é admin" : ""}
          </p>
        </section>

        <Bloco titulo="Descrição" acao={podeEditarDados && editDesc === null ? <button className={btnVerde} style={{ color: "var(--wa-green-ink)" }} onClick={() => setEditDesc(descricao || "")}>Editar</button> : undefined}>
          {editDesc === null
            ? <p className="text-[14px] whitespace-pre-wrap break-words" style={{ color: descricao ? "var(--wa-txt)" : "var(--wa-meta)" }}>{descricao || "Sem descrição."}</p>
            : (
              <div className="space-y-2">
                <textarea className="w-full px-3 py-2 rounded-lg text-[14px]" rows={5} maxLength={2048} style={campo} value={editDesc} onChange={(e) => setEditDesc(e.target.value)} aria-label="Descrição do grupo" autoFocus />
                <div className="flex gap-2 justify-end">
                  <button className="wa-icone px-3 py-1.5 text-[13px]" onClick={() => setEditDesc(null)}>Cancelar</button>
                  <button className="wa-verde rounded-lg px-3 py-1.5 text-[13px] font-semibold" disabled={ocupado}
                    onClick={() => void fazer(() => mudarDescricaoDoGrupo(grupo.jid, editDesc), "Descrição salva.", () => { setEditDesc(null); void ler(); })}>Salvar</button>
                </div>
              </div>
            )}
        </Bloco>

        <Bloco titulo="Viagem">
          <VinculoDoGrupo grupo={grupo} onMudou={onMudou} abrirViagem={(id) => { window.location.hash = `#rel/viagem/${id}`; }} />
        </Bloco>

        <Bloco titulo={`Mídia e documentos${midias ? ` · ${midias.length >= 120 ? "120+" : midias.length}` : ""}`}>
          {!midias ? <p className="text-[12.5px]" style={{ color: "var(--wa-meta)" }}>Carregando…</p>
            : !midias.length ? <p className="text-[12.5px]" style={{ color: "var(--wa-meta)" }}>Nada ainda.</p>
            : (
              <>
                {fotos.length > 0 && (
                  <div className="grid grid-cols-4 gap-1 mb-2">
                    {fotos.map((m) => (
                      <a key={m.id} href={m.anexo_url!} target="_blank" rel="noreferrer" className="block aspect-square rounded overflow-hidden bg-black/10" title={new Date(m.criado_em).toLocaleString("pt-BR")}>
                        {m.tipo === "imagem"
                          ? <img src={m.anexo_url!} alt={m.texto || "foto do grupo"} loading="lazy" className="w-full h-full object-cover" />
                          : <video src={m.anexo_url!} muted preload="metadata" className="w-full h-full object-cover" />}
                      </a>
                    ))}
                  </div>
                )}
                {docs.map((m) => (
                  <a key={m.id} href={m.anexo_url!} target="_blank" rel="noreferrer" className="flex items-center gap-2 py-1.5 text-[13px] hover:underline" style={{ color: "var(--wa-txt)" }}>
                    📄 <span className="truncate flex-1">{m.anexo_nome || "documento"}</span>
                    <span className="text-[11.5px]" style={{ color: "var(--wa-meta)" }}>{new Date(m.criado_em).toLocaleDateString("pt-BR")}</span>
                  </a>
                ))}
              </>
            )}
        </Bloco>

        <Bloco titulo="Mensagens agendadas" acao={<button className={btnVerde} style={{ color: "var(--wa-green-ink)" }} onClick={onAgendar}>+ Agendar</button>}>
          <ListaAgendadas jid={grupo.jid} versao={versaoAgendadas} />
        </Bloco>

        {souAdmin && (
          <Bloco titulo="Convidar por link">
            {convite ? (
              <div className="space-y-2">
                <p className="text-[13.5px] break-all" style={{ color: "var(--wa-green-ink)" }}>{convite}</p>
                <div className="flex flex-wrap gap-3">
                  <button className={btnVerde} style={{ color: "var(--wa-green-ink)" }} onClick={() => void navigator.clipboard?.writeText(convite).then(() => setAviso("Link copiado. Mande pelo número oficial."))}>Copiar link</button>
                  <button className="text-[13px]" style={{ color: "#B42318" }} disabled={ocupado}
                    onClick={() => { if (window.confirm("Gerar um link novo? O link antigo para de funcionar.")) void fazer(async () => setConvite((await linkDeConvite(grupo.jid, true)).url), "Link novo gerado."); }}>Gerar link novo</button>
                </div>
              </div>
            ) : (
              <button className={btnVerde} style={{ color: "var(--wa-green-ink)" }} disabled={ocupado} onClick={() => void fazer(async () => setConvite((await linkDeConvite(grupo.jid)).url))}>🔗 Ver link de convite</button>
            )}
            <p className="text-[11.5px] mt-1.5" style={{ color: "var(--wa-meta)" }}>O link é só copiado — pra mandar pra alguém, use a conversa no número oficial.</p>
          </Bloco>
        )}

        {souAdmin && info && (
          <Bloco titulo="Ajustes do grupo">
            <label className="flex items-center justify-between gap-3 py-1.5 text-[14px]" style={{ color: "var(--wa-txt)" }}>
              Só admins mandam mensagens
              <input type="checkbox" checked={info.so_admins_enviam} disabled={ocupado}
                onChange={(e) => void fazer(() => ajustarGrupo(grupo.jid, e.target.checked ? "announcement" : "not_announcement"), "Ajuste salvo.", () => void ler())} />
            </label>
            <label className="flex items-center justify-between gap-3 py-1.5 text-[14px]" style={{ color: "var(--wa-txt)" }}>
              Só admins mudam nome, foto e descrição
              <input type="checkbox" checked={info.so_admins_editam} disabled={ocupado}
                onChange={(e) => void fazer(() => ajustarGrupo(grupo.jid, e.target.checked ? "locked" : "unlocked"), "Ajuste salvo.", () => void ler())} />
            </label>
          </Bloco>
        )}

        <Bloco titulo={`${participantes.length} participantes`} acao={souAdmin && addTel === null ? <button className={btnVerde} style={{ color: "var(--wa-green-ink)" }} onClick={() => setAddTel("")}>+ Adicionar</button> : undefined}>
          {addTel !== null && (
            <form className="mb-3 space-y-1.5" onSubmit={(e) => {
              e.preventDefault();
              const tels = addTel.split(/[,;\n]+/).map((t) => t.replace(/\D/g, "")).filter((t) => t.length >= 10);
              if (!tels.length) { setErro("Digite o telefone com DDD."); return; }
              void participantesOp("add", tels, tels.length > 1 ? "Participantes adicionados." : "Participante adicionado.").then(() => setAddTel(null));
            }}>
              <input className="w-full px-3 py-2 rounded-lg text-[14px]" style={campo} value={addTel} onChange={(e) => setAddTel(e.target.value)} autoFocus
                placeholder="Telefone com DDD (vários: separe por vírgula)" aria-label="Telefone pra adicionar" inputMode="tel" />
              <div className="flex gap-2 justify-end">
                <button type="button" className="wa-icone px-3 py-1.5 text-[13px]" onClick={() => setAddTel(null)}>Cancelar</button>
                <button type="submit" className="wa-verde rounded-lg px-3 py-1.5 text-[13px] font-semibold" disabled={ocupado}>{ocupado ? "Adicionando…" : "Adicionar"}</button>
              </div>
              <p className="text-[11.5px]" style={{ color: "var(--wa-meta)" }}>Se a pessoa não deixa ser adicionada por quem não é contato, o WhatsApp recusa — aí copie o link de convite e mande pelo número oficial.</p>
            </form>
          )}
          {participantes.length > 8 && (
            <input className="w-full px-3 py-1.5 rounded-lg text-[13.5px] mb-2" style={campo} placeholder="Pesquisar participante" value={buscaPart} onChange={(e) => setBuscaPart(e.target.value)} aria-label="Pesquisar participante" />
          )}
          {!souAdmin && <p className="text-[11.5px] mb-1" style={{ color: "var(--wa-meta)" }}>O número do Relacionamento não é admin aqui — adicionar/remover gente só com um admin.</p>}
          <ul>
            {visiveis.map((p) => (
              <li key={p.telefone}>
                <button className="wa-item w-full text-left flex items-center gap-3 px-1 py-2 rounded-lg" onClick={(e) => setMenu({ p, pos: posicaoDoEvento(e) })} onContextMenu={(e) => { e.preventDefault(); setMenu({ p, pos: posicaoDoEvento(e) }); }}>
                  <AvatarWa nome={p.nome} tamanho={38} />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-[14.5px]" style={{ color: "var(--wa-txt)" }}>{p.nome}</span>
                    <span className="block text-[12px]" style={{ color: "var(--wa-meta)" }}>+{p.telefone}</span>
                  </span>
                  {p.admin && <span className="text-[11px] px-1.5 py-0.5 rounded" style={{ background: "rgba(0,168,132,.12)", color: "var(--wa-green-ink)" }}>{p.admin === "superadmin" ? "criador" : "admin"}</span>}
                </button>
              </li>
            ))}
          </ul>
          {participantes.length === 0 && <p className="text-[12.5px]" style={{ color: "var(--wa-meta)" }}>Lista ainda não lida — clique em Atualizar.</p>}
        </Bloco>
      </div>

      <MenuContexto pos={menu?.pos ?? null} itens={menu ? itensDoParticipante(menu.p) : []} onFechar={() => setMenu(null)} rotulo="Opções do participante" />
    </aside>
  );
}
