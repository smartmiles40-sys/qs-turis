// src/mkt/disparos/DisparosMktPage.tsx
// -----------------------------------------------------------------------------
// DISPAROS DO MARKETING (0242) — o SendFlow dentro do QS.
//
// Mesmo motor do Comercial e do Rel (api/disparos.js, setor "marketing"):
// modelo APROVADO pela Meta, pelo número NOVO do Marketing (dentro da WABA do
// QS), com ritmo, janela, simulação, pausar/retomar e funil. A mais: público
// da base de contatos (listas/tags) ou das bases do QS, e AGENDAR data/hora.
// Recorrências e sequências têm telas próprias, sobre esta mesma fila.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, EmptyState, Page, PageHeader, ProgressBar, Segmented } from "@/components/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  acaoCampanha, contagens, criarCampanha, descreverPublico, lerConfig, listarCampanhas, previa as pedirPrevia,
  type Campanha, type ConfigDisparo, type MapaVariaveis, type Previa, type StatusCampanha, type StatusEnvio,
} from "@/lib/qs/disparos";
import ModelosDisparo from "@/components/sdr/disparos/ModelosDisparo";
import { PainelCampanha } from "@/components/sdr/disparos/DisparosPage";
import { Campo, INPUT, INPUT_ESTILO, Modal } from "@/components/sdr/disparos/pecas";
import { agendar, conferirNumero, desagendar, salvarNumero, type PublicoMkt } from "./api";
import { CaixaPreviaMkt, ModeloEVariaveis, PublicoMktForm, variaveisOk } from "./pecasMkt";
import { DIAS_CURTOS } from "./regras";

const STATUS: Record<StatusCampanha, { rotulo: string; tom?: "ok" | "warn" | "danger" | "info" }> = {
  rascunho: { rotulo: "rascunho" },
  agendada: { rotulo: "agendada", tom: "info" },
  enviando: { rotulo: "enviando", tom: "info" },
  pausada: { rotulo: "pausada", tom: "warn" },
  cancelada: { rotulo: "cancelada", tom: "danger" },
  concluida: { rotulo: "concluída", tom: "ok" },
};

/** "2026-11-02T09:00" (input datetime-local, horário de quem usa) → ISO. */
const localParaIso = (v: string) => (v ? new Date(v).toISOString() : "");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// ── Nova campanha ───────────────────────────────────────────────────────────

function NovaCampanhaMkt({ cfg, onFechar, onCriada }: { cfg: ConfigDisparo; onFechar: () => void; onCriada: () => void }) {
  const aprovados = cfg.modelos.filter((m) => m.status === "aprovado" && m.setor === "marketing");
  const [passo, setPasso] = useState(1);
  const [nome, setNome] = useState("");
  const [modeloNome, setModeloNome] = useState("");
  const [mapa, setMapa] = useState<MapaVariaveis>({});
  const [publico, setPublico] = useState<PublicoMkt>({ fonte: "contatos" });
  const [quando, setQuando] = useState<"depois" | "agendar">("depois");
  const [hora, setHora] = useState("");
  const [pv, setPv] = useState<Previa | null>(null);
  const [contando, setContando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const modelo = aprovados.find((m) => m.nome === modeloNome) ?? null;

  useEffect(() => {
    if (passo !== 2) return;
    setContando(true);
    const t = setTimeout(() => {
      pedirPrevia("marketing", publico).then(setPv).catch((e) => notifyError(e instanceof Error ? e.message : "Falhou.")).finally(() => setContando(false));
    }, 450);
    return () => clearTimeout(t);
  }, [publico, passo]);

  const ok1 = nome.trim().length >= 2 && variaveisOk(modelo, mapa);
  const ok3 = quando === "depois" || (!!hora && new Date(hora).getTime() > Date.now() + 60_000);

  async function criar() {
    if (!modelo) return;
    setSalvando(true);
    try {
      const { campanha } = await criarCampanha("marketing", { nome: nome.trim(), modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, params: mapa, publico });
      if (quando === "agendar") {
        await agendar(campanha.id, localParaIso(hora));
        notifySuccess(`Agendada pra ${dataHora(localParaIso(hora))}.`);
      } else notifySuccess("Campanha criada como rascunho. Clique em Iniciar quando quiser.");
      onCriada();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não criou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo={`Nova campanha do Marketing · passo ${passo} de 3`} onFechar={onFechar} largura={780}
      rodape={<>
        {passo > 1 && <Button variant="ghost" onClick={() => setPasso(passo - 1)}>Voltar</Button>}
        {passo === 1 && <Button variant="primary" disabled={!ok1} onClick={() => setPasso(2)}>Escolher público</Button>}
        {passo === 2 && <Button variant="primary" disabled={!pv?.total} onClick={() => setPasso(3)}>Quando enviar</Button>}
        {passo === 3 && <Button variant="primary" disabled={!ok3 || salvando} onClick={() => void criar()}>{salvando ? "Criando…" : quando === "agendar" ? "Criar e agendar" : "Criar campanha"}</Button>}
      </>}>
      {passo === 1 && (
        <>
          <Campo rotulo="Nome da campanha (só o time vê)">
            <input className={INPUT} style={INPUT_ESTILO} value={nome} autoFocus onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Lançamento Japão 2027 — base de lives" />
          </Campo>
          <ModeloEVariaveis aprovados={aprovados} modeloNome={modeloNome} setModeloNome={setModeloNome} mapa={mapa} setMapa={setMapa} fonte={publico.fonte} />
        </>
      )}
      {passo === 2 && (
        <>
          <PublicoMktForm p={publico} set={setPublico} />
          <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
            Saem sozinhos: quem pediu pra parar (no Comercial, no Rel ou ao Marketing), telefone inválido, números proibidos e do time,
            quem está em conversa nas últimas 24 h e quem recebeu disparo do Marketing nos últimos {cfg.ritmo.intervalo_dias} dias.
          </p>
          <CaixaPreviaMkt pv={pv} carregando={contando} />
        </>
      )}
      {passo === 3 && modelo && (
        <>
          <Campo rotulo="Quando">
            <div className="flex flex-wrap gap-4 text-[13.5px]" style={{ color: "var(--text)" }}>
              <label className="flex items-center gap-2"><input type="radio" checked={quando === "depois"} onChange={() => setQuando("depois")} /> Fica em rascunho — eu clico em Iniciar</label>
              <label className="flex items-center gap-2"><input type="radio" checked={quando === "agendar"} onChange={() => setQuando("agendar")} /> Agendar data e hora</label>
            </div>
          </Campo>
          {quando === "agendar" && (
            <Campo rotulo="Data e hora (horário de Brasília)" dica="Na hora marcada o QS monta a fila com quem bater no filtro NAQUELE momento; a fila anda no ritmo e na janela abaixo.">
              <input type="datetime-local" className={INPUT} style={INPUT_ESTILO} value={hora} onChange={(e) => setHora(e.target.value)} />
            </Campo>
          )}
          <dl className="text-[13px] space-y-1" style={{ color: "var(--text)" }}>
            <div><dt className="inline font-semibold">Campanha: </dt><dd className="inline">{nome}</dd></div>
            <div><dt className="inline font-semibold">Modelo: </dt><dd className="inline">{modelo.nome}</dd></div>
            <div><dt className="inline font-semibold">Público: </dt><dd className="inline">{descreverPublico("marketing", publico)} — <b>{pv?.total ?? 0}</b> hoje</dd></div>
            <div><dt className="inline font-semibold">Número: </dt><dd className="inline">{cfg.numeroMkt ? (cfg.numeroMkt.numero || cfg.numeroMkt.phone_number_id) : "— ainda não definido"}</dd></div>
            <div><dt className="inline font-semibold">Ritmo: </dt><dd className="inline">até {cfg.ritmo.por_hora}/hora e {cfg.ritmo.por_dia}/dia, {cfg.ritmo.inicio}–{cfg.ritmo.fim} ({cfg.ritmo.dias.map((d) => DIAS_CURTOS[d]).join(", ")})</dd></div>
          </dl>
          {cfg.simulacao && <Alert tone="info">Modo simulação: a fila anda e o painel mostra tudo, mas nenhuma mensagem sai.</Alert>}
        </>
      )}
    </Modal>
  );
}

// ── Número do Marketing (admin) ─────────────────────────────────────────────

function NumeroForm({ cfg, ehAdmin, onSalvo }: { cfg: ConfigDisparo; ehAdmin: boolean; onSalvo: () => void }) {
  const [id, setId] = useState(cfg.numeroMkt?.phone_number_id ?? "");
  const [numero, setNumero] = useState(cfg.numeroMkt?.numero ?? "");
  const [conferido, setConferido] = useState<string | null>(null);
  return (
    <div className="qs-card p-4 space-y-3 max-w-[620px]">
      <p className="text-[13.5px]" style={{ color: "var(--text)" }}>
        O Marketing dispara por um número <b>só dele</b>, dentro da mesma conta (WABA) da Meta que o QS já usa — sem aprovar outra API.
        Sem número aqui, nada do Marketing entra na fila.
      </p>
      <ol className="text-[12.5px] list-decimal pl-5 space-y-0.5" style={{ color: "var(--muted)" }}>
        <li>No WhatsApp Manager da conta do QS: Telefones → Adicionar número (um chip novo, que NÃO esteja no WhatsApp do celular).</li>
        <li>Confirme por SMS, registre e copie o <b>Phone number ID</b>.</li>
        <li>Cole aqui. As mensagens que chegam nele não viram lead nem caem no chat dos SDRs.</li>
      </ol>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Phone number ID"><input className={INPUT} style={INPUT_ESTILO} disabled={!ehAdmin} value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} placeholder="Ex.: 123456789012345" /></Campo>
        <Campo rotulo="Número (só pra exibir)"><input className={INPUT} style={INPUT_ESTILO} disabled={!ehAdmin} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="+55 11 …" /></Campo>
      </div>
      {ehAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={async () => { try { await salvarNumero(id, numero); notifySuccess(id ? "Número do Marketing salvo." : "Número removido: o Marketing não envia."); onSalvo(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } }}>Salvar</Button>
          {cfg.numeroMkt && <Button onClick={async () => {
            try { const r = await conferirNumero(); setConferido(r.ok ? `OK na Meta: ${JSON.stringify(r.numero)}` : `Não confere: ${r.motivo}`); }
            catch (e) { setConferido(e instanceof Error ? e.message : "Falhou."); }
          }}>Conferir na Meta</Button>}
        </div>
      ) : <p className="text-[12px]" style={{ color: "var(--subtle)" }}>Só admin define o número.</p>}
      {conferido && <p className="text-[12.5px] break-all" style={{ color: "var(--muted)" }}>{conferido}</p>}
      <p className="text-[12px]" style={{ color: "var(--subtle)" }}>
        O ritmo (por hora/dia, janela) é o mesmo do disparo do QS e vale POR NÚMERO: {cfg.ritmo.por_hora}/hora, {cfg.ritmo.por_dia}/dia, {cfg.ritmo.inicio}–{cfg.ritmo.fim}.
        Número novo começa com limite baixo na Meta: não suba antes de a qualidade estar verde.
      </p>
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

type Aba = "campanhas" | "modelos" | "numero";

export default function DisparosMktPage() {
  const { currentUser } = useQsAuth();
  const ehAdmin = currentUser?.role === "admin";
  const [aba, setAba] = useState<Aba>("campanhas");
  const [cfg, setCfg] = useState<ConfigDisparo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lista, setLista] = useState<Campanha[] | null>(null);
  const [cont, setCont] = useState<Record<string, Partial<Record<StatusEnvio, number>>>>({});
  const [nova, setNova] = useState(false);
  const [vendo, setVendo] = useState<Campanha | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [agendando, setAgendando] = useState<Campanha | null>(null);
  const [hora, setHora] = useState("");

  const carregar = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([lerConfig("marketing"), listarCampanhas("marketing")]);
      setCfg(c); setLista(l); setErro(null);
      setCont(await contagens(l.filter((x) => !["rascunho", "agendada"].includes(x.status)).slice(0, 20).map((x) => x.id)));
    } catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); setLista([]); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { const t = setInterval(() => void carregar(), 60_000); return () => clearInterval(t); }, [carregar]);

  async function agir(acao: "iniciar" | "pausar" | "retomar" | "cancelar" | "apagar" | "desagendar", c: Campanha) {
    if (acao === "cancelar" && !window.confirm(`Cancelar "${c.nome}"? Quem ainda não recebeu não recebe mais.`)) return;
    if (acao === "iniciar" && !window.confirm(`Iniciar "${c.nome}"? A fila começa a andar na próxima janela de envio.`)) return;
    setOcupado(c.id);
    try {
      if (acao === "desagendar") await desagendar(c.id);
      else {
        const r = await acaoCampanha(acao, c.id);
        if (acao === "iniciar") notifySuccess(`${r.total ?? 0} na fila${r.simulacao ? " (simulação)" : ""}.`);
      }
      await carregar();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(null); }
  }

  const abas = useMemo(() => [
    { value: "campanhas" as Aba, label: "Campanhas" },
    { value: "modelos" as Aba, label: "Modelos" },
    { value: "numero" as Aba, label: "Número" },
  ], []);

  return (
    <Page>
      <PageHeader title="Disparos WhatsApp" subtitle="Modelo aprovado pela Meta, pelo número do Marketing, pra base de contatos e pras bases do QS."
        actions={aba === "campanhas" && cfg ? <Button variant="primary" onClick={() => setNova(true)}>+ Nova campanha</Button> : undefined} />
      {cfg?.simulacao && <Alert tone="info">Modo simulação ligado: nada sai de verdade. Desligar é decisão do Bruno (docs/DISPARO-EM-MASSA.md).</Alert>}
      {cfg && !cfg.simulacao && !cfg.envioRealPlugado && <Alert tone="warn">Simulação desligada, mas o envio real ainda não está plugado — a fila fica parada.</Alert>}
      {cfg && !cfg.numeroMkt && <Alert tone="warn">O Marketing ainda não tem número. Dá pra montar campanhas, recorrências e sequências; nada entra na fila até o admin definir o número (aba Número).</Alert>}
      {erro && <Alert tone="danger">{erro}</Alert>}
      <Segmented options={abas} value={aba} onChange={setAba} label="Seções do disparo do Marketing" />

      {aba === "modelos" && cfg && <ModelosDisparo setor="marketing" modelos={cfg.modelos} podeEditar onMudou={() => void carregar()} />}
      {aba === "numero" && cfg && <NumeroForm cfg={cfg} ehAdmin={ehAdmin} onSalvo={() => void carregar()} />}

      {aba === "campanhas" && (lista === null ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p>
        : lista.length === 0 ? (
          <div className="qs-card"><EmptyState title="Nenhuma campanha ainda" description="Ex.: avisar a lista da live do Japão que as vagas de 2027 abriram, segunda às 10h."
            action={cfg ? <Button variant="primary" onClick={() => setNova(true)}>Criar a primeira</Button> : undefined} /></div>
        ) : (
          <ul className="space-y-3">
            {lista.map((c) => {
              const st = STATUS[c.status];
              const k = cont[c.id] ?? {};
              const feitos = (k.enviado ?? 0) + (k.erro ?? 0) + (k.pulado ?? 0);
              const total = feitos + (k.pendente ?? 0);
              return (
                <li key={c.id} className="qs-card p-4 space-y-2.5">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>{c.nome}</p>
                      <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
                        {c.modelo_nome} · {descreverPublico("marketing", c.publico)}
                        {c.recorrencia_id ? " · recorrência" : ""}{c.sequencia_id ? " · sequência" : ""} · criada {new Date(c.criado_em).toLocaleDateString("pt-BR")}
                      </p>
                      {c.status === "agendada" && c.agendada_para && <p className="text-[12.5px]" style={{ color: "var(--text)" }}>Sai em {dataHora(c.agendada_para)}</p>}
                      {c.ultimo_erro && <p className="text-[12.5px] qs-tone-danger">{c.ultimo_erro}</p>}
                    </div>
                    <Badge tone={st.tom} dot>{st.rotulo}</Badge>
                  </div>
                  {!["rascunho", "agendada"].includes(c.status) && total > 0 && (
                    <>
                      <ProgressBar value={(feitos / total) * 100} label="Progresso da fila" />
                      <p className="text-[12px] qs-num" style={{ color: "var(--subtle)" }}>
                        {k.enviado ?? 0} enviados · {k.respondeu ?? 0} responderam · {k.pendente ?? 0} na fila · {k.pulado ?? 0} pulados · {k.erro ?? 0} erros
                      </p>
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {c.status === "rascunho" && <Button variant="primary" size="sm" disabled={!!ocupado} onClick={() => void agir("iniciar", c)}>Iniciar agora</Button>}
                    {c.status === "rascunho" && <Button size="sm" disabled={!!ocupado} onClick={() => { setAgendando(c); setHora(""); }}>Agendar</Button>}
                    {c.status === "agendada" && <Button size="sm" disabled={!!ocupado} onClick={() => void agir("desagendar", c)}>Desagendar</Button>}
                    {c.status === "enviando" && <Button size="sm" disabled={!!ocupado} onClick={() => void agir("pausar", c)}>Pausar</Button>}
                    {c.status === "pausada" && <Button variant="primary" size="sm" disabled={!!ocupado} onClick={() => void agir("retomar", c)}>Retomar</Button>}
                    {["enviando", "pausada", "agendada"].includes(c.status) && <Button variant="destructive" size="sm" disabled={!!ocupado} onClick={() => void agir("cancelar", c)}>Cancelar</Button>}
                    {!["rascunho", "agendada"].includes(c.status) && <Button variant="ghost" size="sm" onClick={() => setVendo(c)}>Funil</Button>}
                    {c.status === "rascunho" && <Button variant="ghost" size="sm" disabled={!!ocupado} onClick={() => void agir("apagar", c)}>Apagar</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      {nova && cfg && <NovaCampanhaMkt cfg={cfg} onFechar={() => setNova(false)} onCriada={() => { setNova(false); void carregar(); }} />}
      {vendo && <PainelCampanha c={vendo} onFechar={() => setVendo(null)} />}
      {agendando && (
        <Modal aberto titulo={`Agendar · ${agendando.nome}`} onFechar={() => setAgendando(null)} largura={460}
          rodape={<>
            <Button variant="ghost" onClick={() => setAgendando(null)}>Fechar</Button>
            <Button variant="primary" disabled={!hora || new Date(hora).getTime() < Date.now() + 60_000} onClick={async () => {
              try { await agendar(agendando.id, localParaIso(hora)); notifySuccess("Agendada."); setAgendando(null); void carregar(); }
              catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
            }}>Agendar</Button>
          </>}>
          <Campo rotulo="Data e hora (horário de Brasília)"><input type="datetime-local" className={INPUT} style={INPUT_ESTILO} value={hora} onChange={(e) => setHora(e.target.value)} /></Campo>
        </Modal>
      )}
    </Page>
  );
}
