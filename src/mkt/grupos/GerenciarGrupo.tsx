// src/mkt/grupos/GerenciarGrupo.tsx — CRIAR grupo pelo QS e GERENCIAR um grupo do
// chip do Marketing (0342): nome, descrição, foto, quem manda/edita, pessoas
// (adicionar, tirar, tornar admin), link de convite (renovar) e sair do grupo.
// Tudo passa pelo servidor (/api/mkt-grupos), que usa a instância do Marketing
// com a trava (nunca a do Relacionamento).
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/rel/ui";
import { api, subirArquivo, quando, type Grupo } from "./lib";
import { BotaoGrande, Campo, Escolha, LinhaChave, Nota, SeloBolinha, cor } from "./pecas";
import { Avatar } from "./Grupos";

// ── Foto (sobe pro bucket público mkt-grupos; a Evolution baixa pela URL) ──
export function CampoFoto({ url, onUrl }: { url: string | null; onUrl: (u: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [subindo, setSubindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function escolher(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { setErro("Use uma imagem JPG, PNG ou WebP."); return; }
    if (f.size > 5 * 1024 * 1024) { setErro("Imagem até 5 MB."); return; }
    setErro(null); setSubindo(true);
    try { onUrl((await subirArquivo(f)).url); } catch (e) { setErro((e as Error).message); }
    finally { setSubindo(false); if (ref.current) ref.current.value = ""; }
  }
  return (
    <div className="flex items-center gap-3">
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void escolher(e.target.files?.[0])} />
      {url ? <img src={url} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" /> : (
        <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-[22px]" style={{ background: cor.card2, border: "1.5px dashed var(--line)" }}>📷</span>
      )}
      <div className="flex flex-wrap gap-2">
        <BotaoGrande pequeno variante="secundario" disabled={subindo} onClick={() => ref.current?.click()}>{subindo ? "Enviando…" : url ? "Trocar foto" : "Escolher foto"}</BotaoGrande>
        {url && <BotaoGrande pequeno variante="perigo" onClick={() => onUrl(null)}>Tirar</BotaoGrande>}
      </div>
      {erro && <p className="text-[12px]" role="alert" style={{ color: "var(--err-ink)" }}>{erro}</p>}
    </div>
  );
}

export interface GrupoCriado { jid: string; nome: string; convite: string | null; avisos: string[] }

/** "+ Criar grupo": o grupo nasce pronto (foto, regras, admins e link de convite). */
export function CriarGrupoModal({ linkId, nomeSugerido, onCriado, onFechar }: {
  linkId?: string; nomeSugerido?: string; onCriado: (g: GrupoCriado) => void | Promise<void>; onFechar: () => void;
}) {
  const [nome, setNome] = useState(nomeSugerido || "");
  const [descricao, setDescricao] = useState("");
  const [foto, setFoto] = useState<string | null>(null);
  const [admins, setAdmins] = useState("");
  const [soAdminsEnviam, setSoAdminsEnviam] = useState(true);
  const [soAdminsEditam, setSoAdminsEditam] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<GrupoCriado | null>(null);

  async function criar() {
    setOcupado(true); setErro(null);
    try {
      const r = await api<{ grupo: GrupoCriado }>("criar_grupo", { nome, descricao, fotoUrl: foto, admins, soAdminsEnviam, soAdminsEditam, link_id: linkId });
      setFeito(r.grupo);
      await onCriado(r.grupo);
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  }

  if (feito) {
    return (
      <Modal aberto titulo="Grupo criado" onFechar={onFechar} largura={500} rodape={<BotaoGrande pequeno onClick={onFechar}>Pronto</BotaoGrande>}>
        <div className="flex flex-col gap-3 text-[14px]" style={{ color: cor.ink }}>
          <Nota icone="✅">“{feito.nome}” foi criado no WhatsApp{linkId ? " e já entrou na fila do link" : ""}.</Nota>
          {feito.convite && <LinhaCopiar texto={feito.convite} />}
          {feito.avisos.length > 0 && (
            <Nota tom="aviso" icone="⚠️">
              O grupo existe, mas uns passos não deram certo — confira em “Gerenciar”:
              <ul className="mt-1 list-disc pl-4">{feito.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
            </Nota>
          )}
        </div>
      </Modal>
    );
  }
  return (
    <Modal aberto titulo="Criar grupo no WhatsApp" onFechar={onFechar} largura={560}
      rodape={<>
        <BotaoGrande pequeno variante="secundario" onClick={onFechar}>Cancelar</BotaoGrande>
        <BotaoGrande pequeno disabled={ocupado || !nome.trim() || !admins.trim()} onClick={() => void criar()}>{ocupado ? "Criando…" : "Criar grupo"}</BotaoGrande>
      </>}>
      <Campo rotulo="Nome do grupo" dica="(até 100 letras)">
        <input className="rel-input" value={nome} maxLength={100} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Japão 2027 #1" />
      </Campo>
      <Campo rotulo="Descrição" dica="(opcional)">
        <textarea className="rel-input" rows={3} maxLength={2048} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Regras do grupo, link da live…" />
      </Campo>
      <Campo rotulo="Foto" dica="(opcional)"><CampoFoto url={foto} onUrl={setFoto} /></Campo>
      <Campo rotulo="Admins" dica="(um número por linha, com DDD — o WhatsApp exige pelo menos uma pessoa além do chip)">
        <textarea className="rel-input" rows={2} value={admins} onChange={(e) => setAdmins(e.target.value)} placeholder={"11 99999-8888\n11 98888-7777"} />
      </Campo>
      <div className="flex flex-col gap-2">
        <LinhaChave titulo="Só admins mandam mensagem" texto="Bom pra grupo de avisos e lançamento." ligada={soAdminsEnviam} onChange={setSoAdminsEnviam} />
        <LinhaChave titulo="Só admins mudam nome, foto e descrição" texto="Evita alguém trocar os dados do grupo." ligada={soAdminsEditam} onChange={setSoAdminsEditam} />
      </div>
      <p className="mt-3 text-[12px]" style={{ color: cor.ink3 }}>O chip do Marketing cria o grupo e fica de admin. Ninguém recebe mensagem por causa disso.</p>
      {erro && <div className="mt-3"><Nota tom="erro" icone="⚠️">{erro}</Nota></div>}
    </Modal>
  );
}

function LinhaCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: cor.card2, border: "1px solid var(--line)" }}>
      <code className="min-w-0 flex-1 truncate text-[13px]">{texto}</code>
      <BotaoGrande pequeno onClick={() => { void navigator.clipboard.writeText(texto).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); }, () => setErro(true)); }}>
        {copiado ? "Copiado ✓" : erro ? "Copie à mão" : "Copiar"}
      </BotaoGrande>
    </div>
  );
}

interface Pessoa { id: string; telefone: string | null; admin: string | null; nome: string | null }
interface Resultado { id: string; telefone: string | null; ok: boolean; motivo: string }
type Aba = "dados" | "pessoas" | "convite" | "sair";

/** Gerenciar um grupo do chip: dados, pessoas, convite e sair. */
export function GerenciarGrupoModal({ grupo, onFechar, onMudou }: { grupo: Grupo; onFechar: () => void; onMudou: () => Promise<void> }) {
  const [aba, setAba] = useState<Aba>("dados");
  return (
    <Modal aberto titulo={`Gerenciar “${grupo.nome || grupo.jid}”`} onFechar={onFechar} largura={620}
      rodape={<BotaoGrande pequeno variante="secundario" onClick={onFechar}>Fechar</BotaoGrande>}>
      <div className="mb-4 flex items-center gap-3">
        <Avatar grupo={grupo} tamanho={48} />
        <div className="flex flex-wrap gap-1.5">
          {grupo.eu_admin === true && <SeloBolinha tom="ok">Chip é admin</SeloBolinha>}
          {grupo.eu_admin === false && <SeloBolinha tom="aviso">Chip não é admin — quase nada aqui funciona</SeloBolinha>}
          <SeloBolinha tom="neutro">{grupo.participantes ?? "—"} pessoas</SeloBolinha>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
        <Escolha ativo={aba === "dados"} onClick={() => setAba("dados")}>✏️ Dados</Escolha>
        <Escolha ativo={aba === "pessoas"} onClick={() => setAba("pessoas")}>👥 Pessoas</Escolha>
        <Escolha ativo={aba === "convite"} onClick={() => setAba("convite")}>🔗 Convite</Escolha>
        <Escolha ativo={aba === "sair"} onClick={() => setAba("sair")}>🚪 Sair</Escolha>
      </div>
      {aba === "dados" && <AbaDados grupo={grupo} onMudou={onMudou} />}
      {aba === "pessoas" && <AbaPessoas grupo={grupo} onMudou={onMudou} />}
      {aba === "convite" && <AbaConvite grupo={grupo} onMudou={onMudou} />}
      {aba === "sair" && <AbaSair grupo={grupo} onMudou={onMudou} onSaiu={onFechar} />}
    </Modal>
  );
}

function AbaDados({ grupo, onMudou }: { grupo: Grupo; onMudou: () => Promise<void> }) {
  const [nome, setNome] = useState(grupo.nome || "");
  const [descricao, setDescricao] = useState(grupo.descricao || "");
  const [foto, setFoto] = useState<string | null>(grupo.foto_url);
  const [enviam, setEnviam] = useState(Boolean(grupo.so_admins_enviam));
  const [editam, setEditam] = useState(Boolean(grupo.so_admins_editam));
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ erro: boolean; texto: string } | null>(null);

  const mudancas: Record<string, unknown> = {};
  if (nome.trim() !== (grupo.nome || "")) mudancas.nome = nome.trim();
  if (descricao.trim() !== (grupo.descricao || "").trim()) mudancas.descricao = descricao.trim();
  if (foto && foto !== grupo.foto_url) mudancas.fotoUrl = foto;
  if (enviam !== Boolean(grupo.so_admins_enviam)) mudancas.soAdminsEnviam = enviam;
  if (editam !== Boolean(grupo.so_admins_editam)) mudancas.soAdminsEditam = editam;
  const n = Object.keys(mudancas).length;

  async function salvar() {
    setOcupado(true); setMsg(null);
    try { await api("editar_grupo", { jid: grupo.jid, ...mudancas }); await onMudou(); setMsg({ erro: false, texto: "Salvo no WhatsApp." }); }
    catch (e) { setMsg({ erro: true, texto: (e as Error).message }); }
    finally { setOcupado(false); }
  }
  return (
    <div>
      <Campo rotulo="Nome"><input className="rel-input" maxLength={100} value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
      <Campo rotulo="Descrição"><textarea className="rel-input" rows={4} maxLength={2048} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Campo>
      <Campo rotulo="Foto"><CampoFoto url={foto} onUrl={setFoto} /></Campo>
      <div className="mb-4 flex flex-col gap-2">
        <LinhaChave titulo="Só admins mandam mensagem" texto="As pessoas só leem." ligada={enviam} onChange={setEnviam} />
        <LinhaChave titulo="Só admins mudam nome, foto e descrição" texto="" ligada={editam} onChange={setEditam} />
      </div>
      {msg && <div className="mb-3"><Nota tom={msg.erro ? "erro" : "rel"} icone={msg.erro ? "⚠️" : "✅"}>{msg.texto}</Nota></div>}
      <BotaoGrande pequeno disabled={!n || ocupado || !nome.trim()} onClick={() => void salvar()}>{ocupado ? "Salvando…" : n ? `Salvar ${n} mudança${n > 1 ? "s" : ""}` : "Nada mudou"}</BotaoGrande>
    </div>
  );
}

function AbaPessoas({ grupo, onMudou }: { grupo: Grupo; onMudou: () => Promise<void> }) {
  const [lista, setLista] = useState<Pessoa[] | null>(null);
  const [busca, setBusca] = useState("");
  const [novos, setNovos] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ acao: string; itens: Resultado[] } | null>(null);
  const [confirmar, setConfirmar] = useState<Pessoa | null>(null);

  async function ler() {
    setErro(null);
    try { const r = await api<{ participantes: Pessoa[] }>("participantes", { jid: grupo.jid }); setLista(r.participantes); }
    catch (e) { setErro((e as Error).message); setLista([]); }
  }
  useEffect(() => { void ler(); }, [grupo.jid]); // eslint-disable-line react-hooks/exhaustive-deps

  async function mudar(tipo: "add" | "remove" | "promote" | "demote", pessoas: string[] | string, chave: string) {
    setOcupado(chave); setErro(null); setResultado(null);
    try {
      const r = await api<{ acao: string; resultado: Resultado[] }>("participante", { jid: grupo.jid, tipo, pessoas });
      setResultado({ acao: r.acao, itens: r.resultado });
      if (tipo === "add") setNovos("");
      await ler(); await onMudou();
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(null); setConfirmar(null); }
  }
  const b = busca.replace(/\D/g, "");
  const filtrada = (lista || []).filter((p) => !b || (p.telefone || p.id).includes(b));
  return (
    <div>
      <Campo rotulo="Adicionar pessoas" dica="(números com DDD, um por linha; até 50 por vez)">
        <textarea className="rel-input" rows={2} value={novos} onChange={(e) => setNovos(e.target.value)} placeholder="11 99999-8888" />
        <div className="mt-2 flex items-center gap-2">
          <BotaoGrande pequeno disabled={!novos.trim() || Boolean(ocupado)} onClick={() => void mudar("add", novos, "add")}>{ocupado === "add" ? "Adicionando…" : "+ Adicionar"}</BotaoGrande>
          <span className="text-[12px]" style={{ color: cor.ink3 }}>Quem bloqueia ser adicionado recebe só pelo link de convite.</span>
        </div>
      </Campo>
      {resultado && (
        <div className="mb-3">
          <Nota tom={resultado.itens.every((i) => i.ok) ? "rel" : "aviso"} icone={resultado.itens.every((i) => i.ok) ? "✅" : "⚠️"}>
            <b>{resultado.acao}:</b>
            <ul className="mt-1">{resultado.itens.map((i) => <li key={i.id}>{i.telefone ? `+${i.telefone}` : i.id} — {i.motivo}</li>)}</ul>
          </Nota>
        </div>
      )}
      {erro && <div className="mb-3"><Nota tom="erro" icone="⚠️">{erro}</Nota></div>}
      <div className="mb-2 flex items-center gap-2">
        <input className="rel-input min-w-0 flex-1" type="search" placeholder="🔍 Buscar pelo número" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar pessoa" />
        <BotaoGrande pequeno variante="secundario" onClick={() => { setLista(null); void ler(); }}>🔄</BotaoGrande>
      </div>
      {lista === null ? <p className="text-[13px]" style={{ color: cor.ink3 }}>Lendo as pessoas do grupo…</p> : (
        <>
          <p className="mb-1 text-[12px]" style={{ color: cor.ink3 }}>{lista.length} pessoas · {lista.filter((p) => p.admin).length} admins</p>
          <ul className="max-h-72 overflow-auto rounded-xl" style={{ border: "1px solid var(--line)" }}>
            {filtrada.slice(0, 300).map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]" style={{ borderBottom: "1px solid var(--line)", color: cor.ink }}>
                <span className="min-w-0 flex-1 truncate">{p.telefone ? `+${p.telefone}` : "Número oculto"}{p.nome ? <span style={{ color: cor.ink3 }}> · {p.nome}</span> : null}</span>
                {p.admin && <SeloBolinha tom="ok">{p.admin === "superadmin" ? "Dono" : "Admin"}</SeloBolinha>}
                {p.admin !== "superadmin" && (
                  <>
                    <button type="button" className="gr-icone-btn" style={{ width: "auto", padding: "0 8px", fontSize: 12 }} disabled={Boolean(ocupado)}
                      onClick={() => void mudar(p.admin ? "demote" : "promote", [p.id], p.id)}>{p.admin ? "Tirar admin" : "Tornar admin"}</button>
                    <button type="button" className="gr-icone-btn" title="Tirar do grupo" aria-label="Tirar do grupo" disabled={Boolean(ocupado)} onClick={() => setConfirmar(p)}>✕</button>
                  </>
                )}
              </li>
            ))}
            {filtrada.length > 300 && <li className="px-3 py-2 text-[12px]" style={{ color: cor.ink3 }}>Mostrando 300 de {filtrada.length}. Busque pelo número.</li>}
          </ul>
        </>
      )}
      {confirmar && (
        <div className="mt-3">
          <Nota tom="aviso" icone="⚠️">
            Tirar <b>{confirmar.telefone ? `+${confirmar.telefone}` : "esta pessoa"}</b> do grupo? Ela só volta pelo link de convite.
            <div className="mt-2 flex gap-2">
              <BotaoGrande pequeno variante="perigo" style={{ border: "1px solid var(--err-line)" }} disabled={Boolean(ocupado)} onClick={() => void mudar("remove", [confirmar.id], confirmar.id)}>Sim, tirar</BotaoGrande>
              <BotaoGrande pequeno variante="secundario" onClick={() => setConfirmar(null)}>Não</BotaoGrande>
            </div>
          </Nota>
        </div>
      )}
    </div>
  );
}

function AbaConvite({ grupo, onMudou }: { grupo: Grupo; onMudou: () => Promise<void> }) {
  const [link, setLink] = useState<string | null>(grupo.link_convite);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function rodar(acao: "convite" | "renovar_convite") {
    setOcupado(true); setErro(null);
    try { const r = await api<{ link: string | null }>(acao, { jid: grupo.jid }); setLink(r.link); await onMudou(); }
    catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); setConfirmar(false); }
  }
  return (
    <div className="flex flex-col gap-3 text-[14px]" style={{ color: cor.ink }}>
      {link ? <LinhaCopiar texto={link} /> : <p style={{ color: cor.ink3 }}>Nenhum link lido ainda.</p>}
      <div className="flex flex-wrap gap-2">
        <BotaoGrande pequeno variante="secundario" disabled={ocupado} onClick={() => void rodar("convite")}>🔄 Ler o link atual</BotaoGrande>
        <BotaoGrande pequeno variante="secundario" disabled={ocupado} onClick={() => setConfirmar(true)}>♻️ Gerar link novo</BotaoGrande>
      </div>
      {confirmar && (
        <Nota tom="aviso" icone="⚠️">
          O link atual <b>para de funcionar</b> na hora (posts, bio, mensagens antigas). Os links inteligentes do QS passam a usar o novo sozinhos.
          <div className="mt-2 flex gap-2">
            <BotaoGrande pequeno disabled={ocupado} onClick={() => void rodar("renovar_convite")}>{ocupado ? "Gerando…" : "Sim, gerar link novo"}</BotaoGrande>
            <BotaoGrande pequeno variante="secundario" onClick={() => setConfirmar(false)}>Não</BotaoGrande>
          </div>
        </Nota>
      )}
      {erro && <Nota tom="erro" icone="⚠️">{erro}</Nota>}
      <p className="text-[12px]" style={{ color: cor.ink3 }}>Só admin do grupo vê e troca o link. Lido em {quando(grupo.info_em)}.</p>
    </div>
  );
}

function AbaSair({ grupo, onMudou, onSaiu }: { grupo: Grupo; onMudou: () => Promise<void>; onSaiu: () => void }) {
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  async function sair() {
    setOcupado(true); setErro(null);
    try { await api("sair_grupo", { jid: grupo.jid, confirmar: texto }); await onMudou(); onSaiu(); }
    catch (e) { setErro((e as Error).message); setOcupado(false); }
  }
  return (
    <div className="flex flex-col gap-3 text-[14px]" style={{ color: cor.ink }}>
      <Nota tom="aviso" icone="🚪">
        O chip do Marketing <b>sai</b> do grupo “{grupo.nome || grupo.jid}”. Depois disso o QS não manda campanha, não conta membros e não mexe mais nele.
        Para voltar, alguém precisa adicionar o chip de novo. Se o chip for o único admin, o grupo fica sem admin.
      </Nota>
      <Campo rotulo="Digite SAIR para confirmar">
        <input className="rel-input" value={texto} onChange={(e) => setTexto(e.target.value)} aria-label="Confirmação" />
      </Campo>
      {erro && <Nota tom="erro" icone="⚠️">{erro}</Nota>}
      <div><BotaoGrande pequeno variante="perigo" style={{ border: "1px solid var(--err-line)" }} disabled={texto.trim().toLowerCase() !== "sair" || ocupado} onClick={() => void sair()}>{ocupado ? "Saindo…" : "Sair do grupo"}</BotaoGrande></div>
    </div>
  );
}
