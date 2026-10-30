// src/mkt/disparos/DisparosMktPage.tsx
// -----------------------------------------------------------------------------
// MARKETING › WHATSAPP › DISPAROS (0242) — o SendFlow dentro do QS, simples.
//
// Uma aba só pros três jeitos de mandar:
//   • Enviar uma vez        → campanha (rascunho, agora ou agendada)
//   • Repetir toda semana   → recorrência (o cron cria a campanha de cada vez)
//   • Sequência de mensagens→ passo 1 no dia 0, passo 2 no dia 3…
// e um "+ Novo disparo" em passos claros: Tipo → Para quem → Mensagem →
// Quando → Revisar, com a prévia do WhatsApp ao lado.
//
// Mesmo motor do Comercial e do Rel (api/disparos.js, setor "marketing"):
// SÓ modelo APROVADO pela Meta (disparo em massa é API oficial + template), pelo
// número do Marketing (qs_wa_numeros_meta.setor='marketing'), com ritmo,
// janela, simulação, pausar/retomar e funil. Quem pediu PARAR sai sozinho.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ProgressBar } from "@/components/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { useQsAuth } from "@/contexts/QsAuthContext";
import {
  acaoCampanha, contagens, criarCampanha, descreverPublico, lerConfig, listarCampanhas, preverTexto, previa as pedirPrevia,
  type Campanha, type ConfigDisparo, type MapaVariaveis, type ModeloDisparo, type Previa, type StatusCampanha, type StatusEnvio,
} from "@/lib/qs/disparos";
import ModelosDisparo from "@/components/sdr/disparos/ModelosDisparo";
import { PainelCampanha } from "@/components/sdr/disparos/DisparosPage";
import { Chips } from "@/components/sdr/disparos/pecas";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "@/rel/ui";
import { agendar, conferirNumero, desagendar, salvarNumero, salvarRecorrencia, type PublicoMkt } from "./api";
import { CaixaPreviaMkt, ModeloEVariaveis, PublicoMktForm, variaveisOk } from "./pecasMkt";
import { DIAS_CURTOS, descreverRecorrencia } from "./regras";
import { SecaoRecorrencias } from "./RecorrenciasPage";
import { SecaoSequencias } from "./SequenciasPage";
import PreviaWhatsApp from "./PreviaWhatsApp";

const STATUS: Record<StatusCampanha, { rotulo: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  rascunho: { rotulo: "rascunho", tom: "neutro" },
  agendada: { rotulo: "agendada", tom: "rel" },
  enviando: { rotulo: "enviando", tom: "rel" },
  pausada: { rotulo: "pausada", tom: "aviso" },
  cancelada: { rotulo: "cancelada", tom: "erro" },
  concluida: { rotulo: "concluída", tom: "neutro" },
};

/** "2026-11-02T09:00" (input datetime-local, horário de quem usa) → ISO. */
const localParaIso = (v: string) => (v ? new Date(v).toISOString() : "");
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);

type Tipo = "uma_vez" | "semanal" | "sequencia";
const TIPOS: { id: Tipo; titulo: string; texto: string; exemplo: string }[] = [
  { id: "uma_vez", titulo: "Enviar uma vez", texto: "Uma mensagem pra um público, agora ou numa data marcada.", exemplo: "Ex.: abriram as vagas do Japão 2027." },
  { id: "semanal", titulo: "Repetir toda semana", texto: "O mesmo modelo nos dias e hora que você escolher.", exemplo: "Ex.: toda segunda às 9h, as vagas da semana." },
  { id: "sequencia", titulo: "Sequência de mensagens", texto: "Passo 1 no dia que a pessoa entra, passo 2 dias depois…", exemplo: "Ex.: convite, roteiro no dia 2, vagas no dia 5." },
];

// ── Novo disparo (passo a passo) ────────────────────────────────────────────

const PASSOS = ["Para quem", "Mensagem", "Quando", "Revisar"] as const;

function NovoDisparo({ cfg, onFechar, onCriado, onSequencia }: { cfg: ConfigDisparo; onFechar: () => void; onCriado: (t: Tipo) => void; onSequencia: () => void }) {
  const aprovados = cfg.modelos.filter((m) => m.status === "aprovado" && m.setor === "marketing");
  const [tipo, setTipo] = useState<Tipo | null>(null);
  const [passo, setPasso] = useState(0);
  const [nome, setNome] = useState("");
  const [modeloNome, setModeloNome] = useState("");
  const [mapa, setMapa] = useState<MapaVariaveis>({});
  const [publico, setPublico] = useState<PublicoMkt>({ fonte: "contatos" });
  const [quando, setQuando] = useState<"rascunho" | "agora" | "agendar">("rascunho");
  const [hora, setHora] = useState("");
  const [dias, setDias] = useState<number[]>([1]);
  const [horaSemanal, setHoraSemanal] = useState("09:00");
  const [pv, setPv] = useState<Previa | null>(null);
  const [contando, setContando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const modelo = aprovados.find((m) => m.nome === modeloNome) ?? null;

  useEffect(() => {
    if (!tipo) return;
    setContando(true);
    const t = setTimeout(() => {
      pedirPrevia("marketing", publico).then(setPv).catch((e) => notifyError(erroDe(e, "Falhou."))).finally(() => setContando(false));
    }, 450);
    return () => clearTimeout(t);
  }, [publico, tipo]);

  const okPublico = !!pv?.total;
  const okMensagem = nome.trim().length >= 2 && variaveisOk(modelo, mapa);
  const okQuando = tipo === "semanal"
    ? dias.length > 0 && /^\d{2}:\d{2}$/.test(horaSemanal)
    : quando !== "agendar" || (!!hora && new Date(hora).getTime() > Date.now() + 60_000);
  const pode = [okPublico, okMensagem, okQuando, true][passo];

  function escolherTipo(t: Tipo) {
    if (t === "sequencia") { onSequencia(); return; }
    setTipo(t); setPasso(0);
  }

  async function criar() {
    if (!modelo || !tipo) return;
    setSalvando(true);
    try {
      if (tipo === "semanal") {
        await salvarRecorrencia({ nome: nome.trim(), modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, params: mapa, publico, dias_semana: dias, hora: horaSemanal, ativa: true });
        notifySuccess(`Pronto: ${descreverRecorrencia(dias, horaSemanal).toLowerCase()}.`);
      } else {
        if (quando === "agora" && !window.confirm(`Iniciar "${nome.trim()}" agora? A fila começa a andar na próxima janela de envio.`)) { setSalvando(false); return; }
        const { campanha } = await criarCampanha("marketing", { nome: nome.trim(), modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, params: mapa, publico });
        if (quando === "agendar") { await agendar(campanha.id, localParaIso(hora)); notifySuccess(`Agendada pra ${dataHora(localParaIso(hora))}.`); }
        else if (quando === "agora") { const r = await acaoCampanha("iniciar", campanha.id); notifySuccess(`${r.total ?? 0} na fila${r.simulacao ? " (simulação)" : ""}.`); }
        else notifySuccess("Salvo como rascunho. Clique em Iniciar quando quiser.");
      }
      onCriado(tipo);
    } catch (e) { notifyError(erroDe(e, "Não criou.")); }
    finally { setSalvando(false); }
  }

  if (!tipo) {
    return (
      <Modal aberto titulo="Novo disparo" onFechar={onFechar} largura={820}>
        <p className="mb-3 text-[13px]" style={{ color: "var(--ink3)" }}>Como você quer mandar?</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {TIPOS.map((t) => (
            <button key={t.id} type="button" onClick={() => escolherTipo(t.id)}
              className="rel-card flex flex-col gap-1.5 p-4 text-left transition-shadow hover:shadow-md">
              <IconeTipo tipo={t.id} />
              <span className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{t.titulo}</span>
              <span className="text-[12.5px] leading-snug" style={{ color: "var(--ink2)" }}>{t.texto}</span>
              <span className="text-[12px] leading-snug" style={{ color: "var(--ink3)" }}>{t.exemplo}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12px]" style={{ color: "var(--ink3)" }}>Todos saem pela API oficial da Meta, com modelo aprovado, pelo número do Marketing. Quem pediu PARAR nunca recebe.</p>
      </Modal>
    );
  }

  const tituloTipo = TIPOS.find((t) => t.id === tipo)!.titulo;
  return (
    <Modal aberto titulo={`${tituloTipo} · ${PASSOS[passo]}`} onFechar={onFechar} largura={1000}
      rodape={<>
        <Botao variante="fantasma" onClick={() => (passo === 0 ? setTipo(null) : setPasso(passo - 1))}>Voltar</Botao>
        {passo < 3
          ? <Botao variante="primario" disabled={!pode} onClick={() => setPasso(passo + 1)}>Continuar: {PASSOS[passo + 1]}</Botao>
          : <Botao variante="primario" disabled={salvando || !okPublico || !okMensagem || !okQuando} onClick={() => void criar()}>
              {salvando ? "Salvando…" : tipo === "semanal" ? "Criar disparo semanal" : quando === "agora" ? "Criar e iniciar" : quando === "agendar" ? "Criar e agendar" : "Salvar rascunho"}
            </Botao>}
      </>}>
      <Passos atual={passo} onIr={(i) => { if (i < passo) setPasso(i); }} />
      <div className="mt-4 grid gap-5 md:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-3">
          {passo === 0 && (
            <>
              <PublicoMktForm p={publico} set={setPublico} />
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                Saem sozinhos: quem pediu pra parar (no Comercial, no Rel ou ao Marketing), telefone inválido, números proibidos e do time,
                quem está em conversa nas últimas 24 h e quem recebeu disparo do Marketing nos últimos {cfg.ritmo.intervalo_dias} dias.
              </p>
              <CaixaPreviaMkt pv={pv} carregando={contando} />
            </>
          )}
          {passo === 1 && (
            <>
              <Campo rotulo="Nome do disparo (só o time vê)">
                <Entrada value={nome} autoFocus onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Lançamento Japão 2027 — base de lives" />
              </Campo>
              <p className="text-[12.5px] font-semibold" style={{ color: "var(--ink2)" }}>Modelo aprovado pela Meta</p>
              <ModeloEVariaveis aprovados={aprovados} modeloNome={modeloNome} setModeloNome={setModeloNome} mapa={mapa} setMapa={setMapa} fonte={publico.fonte} semBolha emCartoes />
            </>
          )}
          {passo === 2 && tipo === "uma_vez" && (
            <div className="space-y-3">
              <div role="radiogroup" aria-label="Quando enviar" className="grid gap-2 sm:grid-cols-3">
                {([["rascunho", "Depois", "Fica em rascunho; eu clico em Iniciar."], ["agora", "Agora", "Entra na fila já, no ritmo e na janela."], ["agendar", "Agendar", "Escolho o dia e a hora."]] as const).map(([id, t, d]) => (
                  <Opcao key={id} on={quando === id} onClick={() => setQuando(id)} titulo={t} texto={d} />
                ))}
              </div>
              {quando === "agendar" && (
                <Campo rotulo="Data e hora (horário de Brasília)" dica="Na hora marcada o QS monta a fila com quem bater no filtro NAQUELE momento.">
                  <Entrada type="datetime-local" value={hora} onChange={(e) => setHora(e.target.value)} className="!w-auto" />
                </Campo>
              )}
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Ritmo: até {cfg.ritmo.por_hora}/hora e {cfg.ritmo.por_dia}/dia, das {cfg.ritmo.inicio} às {cfg.ritmo.fim} ({cfg.ritmo.dias.map((d) => DIAS_CURTOS[d]).join(", ")}).</p>
            </div>
          )}
          {passo === 2 && tipo === "semanal" && (
            <div className="space-y-3">
              <Campo rotulo="Dias da semana"><Chips opcoes={DIAS_CURTOS.map((d, i) => ({ id: String(i), rotulo: d }))} valor={dias.map(String)} onChange={(v) => setDias(v.map(Number).sort())} /></Campo>
              <Campo rotulo="Hora (Brasília)"><Entrada type="time" value={horaSemanal} onChange={(e) => setHoraSemanal(e.target.value)} className="!w-32" /></Campo>
              <Aviso tom="ok">{descreverRecorrencia(dias, horaSemanal)}.</Aviso>
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                Cada vez o QS cria a campanha com quem bater no filtro naquele dia. Quem recebeu nos últimos {cfg.ritmo.intervalo_dias} dias fica de fora (o funil mostra quem saiu e por quê).
              </p>
            </div>
          )}
          {passo === 3 && modelo && (
            <dl className="rel-card divide-y text-[13px]" style={{ color: "var(--ink)", borderColor: "var(--line)" }}>
              <Linha rotulo="Tipo">{tituloTipo}</Linha>
              <Linha rotulo="Nome">{nome}</Linha>
              <Linha rotulo="Para quem">{descreverPublico("marketing", publico)} — <b>{pv?.total ?? 0}</b> pessoas hoje</Linha>
              <Linha rotulo="Modelo">{modelo.nome}</Linha>
              <Linha rotulo="Quando">{tipo === "semanal" ? descreverRecorrencia(dias, horaSemanal) : quando === "agendar" && hora ? dataHora(localParaIso(hora)) : quando === "agora" ? "Agora (próxima janela de envio)" : "Rascunho — inicio depois"}</Linha>
              <Linha rotulo="Número">{cfg.numeroMkt ? (cfg.numeroMkt.numero || cfg.numeroMkt.phone_number_id) : "ainda não definido — nada entra na fila"}</Linha>
            </dl>
          )}
          {passo === 3 && cfg.simulacao && <Aviso>Modo simulação: a fila anda e o funil mostra tudo, mas nenhuma mensagem sai.</Aviso>}
        </div>
        <PreviaDoModelo modelo={modelo} mapa={mapa} />
      </div>
    </Modal>
  );
}

function PreviaDoModelo({ modelo, mapa }: { modelo: ModeloDisparo | null; mapa: MapaVariaveis }) {
  return (
    <div className="md:sticky md:top-0 md:self-start">
      <PreviaWhatsApp vazio="Escolha o modelo no passo Mensagem pra ver como chega."
        baloes={modelo ? [{ titulo: modelo.cabecalho, texto: preverTexto(modelo.corpo, mapa), rodape: modelo.rodape, botoes: modelo.botaoParar !== false ? ["Parar de receber"] : undefined }] : []} />
    </div>
  );
}

function Passos({ atual, onIr }: { atual: number; onIr: (i: number) => void }) {
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="Passos">
      {PASSOS.map((p, i) => {
        const feito = i < atual;
        const agora = i === atual;
        return (
          <li key={p} className="flex items-center gap-2">
            <button type="button" onClick={() => onIr(i)} disabled={!feito} aria-current={agora ? "step" : undefined}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-semibold disabled:cursor-default"
              style={agora ? { background: "var(--rel)", color: "#fff" } : feito ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { background: "var(--card2)", color: "var(--ink3)" }}>
              <span className="tabular-nums">{feito ? "✓" : i + 1}</span> {p}
            </button>
            {i < PASSOS.length - 1 && <span aria-hidden style={{ color: "var(--line)" }}>—</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Opcao({ on, onClick, titulo, texto }: { on: boolean; onClick: () => void; titulo: string; texto: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} onClick={onClick} className="rounded-xl border p-3 text-left"
      style={on ? { borderColor: "var(--rel)", background: "var(--rel-soft)" } : { borderColor: "var(--line)", background: "var(--card)" }}>
      <span className="block text-[13.5px] font-semibold" style={{ color: on ? "var(--rel-ink)" : "var(--ink)" }}>{titulo}</span>
      <span className="block text-[12px] leading-snug" style={{ color: "var(--ink3)" }}>{texto}</span>
    </button>
  );
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 px-3 py-2" style={{ borderColor: "var(--line)" }}>
      <dt className="font-semibold" style={{ color: "var(--ink3)" }}>{rotulo}</dt><dd>{children}</dd>
    </div>
  );
}

const ICONE_TIPO: Record<Tipo, ReactNode> = {
  uma_vez: <><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></>,
  semanal: <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="M9 16l2 2 4-4" /></>,
  sequencia: <><circle cx="5" cy="6" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="18" r="2" /><path d="M6.5 7.5l4 3M13.5 13.5l4 3" /></>,
};
function IconeTipo({ tipo }: { tipo: Tipo }) {
  return (
    <span aria-hidden className="inline-flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: "var(--rel-soft)", color: "var(--rel-ink)" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{ICONE_TIPO[tipo]}</svg>
    </span>
  );
}

// ── Número do Marketing (admin) ─────────────────────────────────────────────

function NumeroForm({ cfg, ehAdmin, onSalvo }: { cfg: ConfigDisparo; ehAdmin: boolean; onSalvo: () => void }) {
  const [id, setId] = useState(cfg.numeroMkt?.phone_number_id ?? "");
  const [numero, setNumero] = useState(cfg.numeroMkt?.numero ?? "");
  const [conferido, setConferido] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-[13.5px]" style={{ color: "var(--ink)" }}>
        O Marketing dispara por um número <b>só dele</b>, dentro da mesma conta (WABA) da Meta que o QS já usa — sem aprovar outra API.
        Sem número aqui, nada do Marketing entra na fila.
      </p>
      <ol className="list-decimal space-y-0.5 pl-5 text-[12.5px]" style={{ color: "var(--ink2)" }}>
        <li>No WhatsApp Manager da conta do QS: Telefones → Adicionar número (um chip novo, que NÃO esteja no WhatsApp do celular).</li>
        <li>Confirme por SMS, registre e copie o <b>Phone number ID</b>.</li>
        <li>Cole aqui. As mensagens que chegam nele não viram lead nem caem no chat dos SDRs.</li>
      </ol>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Phone number ID"><Entrada disabled={!ehAdmin} value={id} onChange={(e) => setId(e.target.value.replace(/\D/g, ""))} placeholder="Ex.: 123456789012345" /></Campo>
        <Campo rotulo="Número (só pra exibir)"><Entrada disabled={!ehAdmin} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="+55 11 …" /></Campo>
      </div>
      {ehAdmin ? (
        <div className="flex flex-wrap gap-2">
          <Botao variante="primario" onClick={async () => { try { await salvarNumero(id, numero); notifySuccess(id ? "Número do Marketing salvo." : "Número removido: o Marketing não envia."); onSalvo(); } catch (e) { notifyError(erroDe(e, "Falhou.")); } }}>Salvar</Botao>
          {cfg.numeroMkt && <Botao onClick={async () => {
            try { const r = await conferirNumero(); setConferido(r.ok ? `OK na Meta: ${JSON.stringify(r.numero)}` : `Não confere: ${r.motivo}`); }
            catch (e) { setConferido(erroDe(e, "Falhou.")); }
          }}>Conferir na Meta</Botao>}
        </div>
      ) : <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Só admin define o número.</p>}
      {conferido && <p className="break-all text-[12.5px]" style={{ color: "var(--ink2)" }}>{conferido}</p>}
      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
        O ritmo (por hora/dia, janela) é o mesmo do disparo do QS e vale POR NÚMERO: {cfg.ritmo.por_hora}/hora, {cfg.ritmo.por_dia}/dia, {cfg.ritmo.inicio}–{cfg.ritmo.fim}.
        Número novo começa com limite baixo na Meta: não suba antes de a qualidade estar verde.
      </p>
    </div>
  );
}

// ── O que falta pra disparar ────────────────────────────────────────────────

function OQueFalta({ cfg, aprovados, onNumero, onModelos }: { cfg: ConfigDisparo; aprovados: number; onNumero: () => void; onModelos: () => void }) {
  const itens: { ok: boolean; texto: string; acao?: ReactNode }[] = [
    { ok: !!cfg.numeroMkt, texto: cfg.numeroMkt ? `Número do Marketing: ${cfg.numeroMkt.numero || cfg.numeroMkt.phone_number_id}` : "Cadastrar o número do Marketing (o admin faz uma vez)", acao: !cfg.numeroMkt ? <Botao onClick={onNumero}>Cadastrar número</Botao> : undefined },
    { ok: aprovados > 0, texto: aprovados ? `${aprovados} modelo(s) aprovado(s) pela Meta` : "Ter pelo menos um modelo aprovado pela Meta", acao: !aprovados ? <Botao onClick={onModelos}>Montar modelo</Botao> : undefined },
  ];
  if (itens.every((i) => i.ok)) return null;
  return (
    <div className="rel-card p-4">
      <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>Antes do primeiro disparo</p>
      <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Dá pra montar e agendar já; nada sai até estes itens estarem prontos.</p>
      <ul className="mt-2 space-y-2">
        {itens.map((i) => (
          <li key={i.texto} className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: "var(--ink)" }}>
            <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold"
              style={i.ok ? { background: "var(--rel-soft)", color: "var(--rel-ink)" } : { background: "var(--warn-bg)", color: "var(--warn-ink)" }}>{i.ok ? "✓" : "!"}</span>
            <span className="flex-1">{i.texto}</span>
            {i.acao}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Página (aba Disparos) ───────────────────────────────────────────────────

export default function DisparosMktPage() {
  const { currentUser } = useQsAuth();
  const ehAdmin = currentUser?.role === "admin";
  const [secao, setSecao] = useState<Tipo>("uma_vez");
  const [cfg, setCfg] = useState<ConfigDisparo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [lista, setLista] = useState<Campanha[] | null>(null);
  const [cont, setCont] = useState<Record<string, Partial<Record<StatusEnvio, number>>>>({});
  const [nova, setNova] = useState(false);
  const [novaSequencia, setNovaSequencia] = useState(false);
  const [vendo, setVendo] = useState<Campanha | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [agendando, setAgendando] = useState<Campanha | null>(null);
  const [hora, setHora] = useState("");
  const [modal, setModal] = useState<"modelos" | "numero" | null>(null);
  const [versao, setVersao] = useState(0);
  const [qtd, setQtd] = useState<{ semanal: number | null; sequencia: number | null }>({ semanal: null, sequencia: null });

  const carregar = useCallback(async () => {
    try {
      const [c, l] = await Promise.all([lerConfig("marketing"), listarCampanhas("marketing")]);
      setCfg(c); setLista(l); setErro(null);
      setCont(await contagens(l.filter((x) => !["rascunho", "agendada"].includes(x.status)).slice(0, 20).map((x) => x.id)));
    } catch (e) { setErro(erroDe(e, "Não carregou.")); setLista([]); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { const t = setInterval(() => void carregar(), 60_000); return () => clearInterval(t); }, [carregar]);

  async function agir(acao: "iniciar" | "pausar" | "retomar" | "cancelar" | "apagar" | "desagendar", c: Campanha) {
    if (acao === "cancelar" && !window.confirm(`Cancelar "${c.nome}"? Quem ainda não recebeu não recebe mais.`)) return;
    if (acao === "iniciar" && !window.confirm(`Iniciar "${c.nome}"? A fila começa a andar na próxima janela de envio.`)) return;
    if (acao === "apagar" && !window.confirm(`Apagar o rascunho "${c.nome}"?`)) return;
    setOcupado(c.id);
    try {
      if (acao === "desagendar") await desagendar(c.id);
      else {
        const r = await acaoCampanha(acao, c.id);
        if (acao === "iniciar") notifySuccess(`${r.total ?? 0} na fila${r.simulacao ? " (simulação)" : ""}.`);
      }
      await carregar();
    } catch (e) { notifyError(erroDe(e, "Falhou.")); }
    finally { setOcupado(null); }
  }

  const aprovados = cfg?.modelos.filter((m) => m.status === "aprovado" && m.setor === "marketing").length ?? 0;
  // Campanhas criadas por recorrência/sequência também aparecem em "Uma vez" (é onde fica o funil de cada envio).
  const contagemSecao: Record<Tipo, number | null> = { uma_vez: lista?.length ?? null, semanal: qtd.semanal, sequencia: qtd.sequencia };

  return (
    <div className="flex flex-col gap-4">
      {cfg?.simulacao && <Aviso>Modo simulação ligado: nada sai de verdade. Desligar é decisão do Bruno (docs/DISPARO-EM-MASSA.md).</Aviso>}
      {cfg && !cfg.simulacao && !cfg.envioRealPlugado && <Aviso>Simulação desligada, mas o envio real ainda não está plugado — a fila fica parada.</Aviso>}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {cfg && <OQueFalta cfg={cfg} aprovados={aprovados} onNumero={() => setModal("numero")} onModelos={() => setModal("modelos")} />}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Tipos de disparo" className="flex flex-wrap gap-1 rounded-xl p-1" style={{ background: "var(--card2)" }}>
          {TIPOS.map((t) => {
            const on = secao === t.id;
            const n = contagemSecao[t.id];
            return (
              <button key={t.id} type="button" role="tab" aria-selected={on} onClick={() => setSecao(t.id)}
                className="rounded-lg px-3 py-1.5 text-[13px] font-semibold"
                style={on ? { background: "var(--card)", color: "var(--rel-ink)", boxShadow: "0 1px 2px rgba(0,0,0,.08)" } : { color: "var(--ink2)" }}>
                {t.id === "uma_vez" ? "Uma vez" : t.id === "semanal" ? "Toda semana" : "Sequências"}
                {n !== null && <span className="ml-1.5 tabular-nums" style={{ color: "var(--ink3)" }}>{n}</span>}
              </button>
            );
          })}
        </div>
        <span className="flex-1" />
        <Botao variante="fantasma" onClick={() => setModal("modelos")} disabled={!cfg}>Modelos</Botao>
        <Botao variante="fantasma" onClick={() => setModal("numero")} disabled={!cfg}>Número</Botao>
        <Botao variante="primario" onClick={() => setNova(true)} disabled={!cfg}>+ Novo disparo</Botao>
      </div>

      {secao === "uma_vez" && (lista === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        : lista.length === 0 ? (
          <div className="rel-card"><Vazio titulo="Nenhum disparo ainda" texto="Ex.: avisar a lista da live do Japão que as vagas de 2027 abriram, segunda às 10h."
            acao={cfg ? <Botao variante="primario" onClick={() => setNova(true)}>Criar o primeiro</Botao> : undefined} /></div>
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {lista.map((c) => {
              const st = STATUS[c.status];
              const k = cont[c.id] ?? {};
              const feitos = (k.enviado ?? 0) + (k.erro ?? 0) + (k.pulado ?? 0);
              const total = feitos + (k.pendente ?? 0);
              return (
                <li key={c.id} className="rel-card space-y-2.5 p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>{c.nome}</p>
                      <p className="text-[12.5px]" style={{ color: "var(--ink2)" }}>
                        {c.modelo_nome} · {descreverPublico("marketing", c.publico)}
                      </p>
                      <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                        {c.recorrencia_id ? "da repetição semanal · " : ""}{c.sequencia_id ? "de uma sequência · " : ""}criada {new Date(c.criado_em).toLocaleDateString("pt-BR")}
                        {c.status === "agendada" && c.agendada_para ? ` · sai em ${dataHora(c.agendada_para)}` : ""}
                      </p>
                      {c.ultimo_erro && <p className="text-[12.5px]" style={{ color: "var(--err-ink)" }}>{c.ultimo_erro}</p>}
                    </div>
                    <Etiqueta tom={st.tom}>{st.rotulo}</Etiqueta>
                  </div>
                  {!["rascunho", "agendada"].includes(c.status) && total > 0 && (
                    <>
                      <ProgressBar value={(feitos / total) * 100} label="Progresso da fila" />
                      <p className="text-[12px] tabular-nums" style={{ color: "var(--ink3)" }}>
                        {k.enviado ?? 0} enviados · {k.respondeu ?? 0} responderam · {k.pendente ?? 0} na fila · {k.pulado ?? 0} pulados · {k.erro ?? 0} erros
                      </p>
                    </>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {c.status === "rascunho" && <Botao variante="primario" disabled={!!ocupado} onClick={() => void agir("iniciar", c)}>Iniciar agora</Botao>}
                    {c.status === "rascunho" && <Botao disabled={!!ocupado} onClick={() => { setAgendando(c); setHora(""); }}>Agendar</Botao>}
                    {c.status === "agendada" && <Botao disabled={!!ocupado} onClick={() => void agir("desagendar", c)}>Desagendar</Botao>}
                    {c.status === "enviando" && <Botao disabled={!!ocupado} onClick={() => void agir("pausar", c)}>Pausar</Botao>}
                    {c.status === "pausada" && <Botao variante="primario" disabled={!!ocupado} onClick={() => void agir("retomar", c)}>Retomar</Botao>}
                    {["enviando", "pausada", "agendada"].includes(c.status) && <Botao variante="perigo" disabled={!!ocupado} onClick={() => void agir("cancelar", c)}>Cancelar</Botao>}
                    {!["rascunho", "agendada"].includes(c.status) && <Botao variante="fantasma" onClick={() => setVendo(c)}>Ver funil</Botao>}
                    {c.status === "rascunho" && <Botao variante="fantasma" disabled={!!ocupado} onClick={() => void agir("apagar", c)}>Apagar</Botao>}
                  </div>
                </li>
              );
            })}
          </ul>
        ))}

      {cfg && (
        <div hidden={secao !== "semanal"}><SecaoRecorrencias cfg={cfg} versao={versao} onContar={(n) => setQtd((q) => ({ ...q, semanal: n }))} /></div>
      )}
      {cfg && (
        <div hidden={secao !== "sequencia"}>
          <SecaoSequencias cfg={cfg} versao={versao} criar={novaSequencia} onCriarFechou={() => setNovaSequencia(false)} onContar={(n) => setQtd((q) => ({ ...q, sequencia: n }))} />
        </div>
      )}

      {nova && cfg && (
        <NovoDisparo cfg={cfg} onFechar={() => setNova(false)}
          onSequencia={() => { setNova(false); setSecao("sequencia"); setNovaSequencia(true); }}
          onCriado={(t) => { setNova(false); setSecao(t); setVersao((v) => v + 1); void carregar(); }} />
      )}
      {vendo && <PainelCampanha c={vendo} onFechar={() => setVendo(null)} />}
      {agendando && (
        <Modal aberto titulo={`Agendar · ${agendando.nome}`} onFechar={() => setAgendando(null)} largura={460}
          rodape={<>
            <Botao variante="fantasma" onClick={() => setAgendando(null)}>Fechar</Botao>
            <Botao variante="primario" disabled={!hora || new Date(hora).getTime() < Date.now() + 60_000} onClick={async () => {
              try { await agendar(agendando.id, localParaIso(hora)); notifySuccess("Agendada."); setAgendando(null); void carregar(); }
              catch (e) { notifyError(erroDe(e, "Falhou.")); }
            }}>Agendar</Botao>
          </>}>
          <Campo rotulo="Data e hora (horário de Brasília)"><Entrada type="datetime-local" value={hora} onChange={(e) => setHora(e.target.value)} /></Campo>
        </Modal>
      )}
      {modal === "modelos" && cfg && (
        <Modal aberto titulo="Modelos do Marketing (aprovados pela Meta)" onFechar={() => setModal(null)} largura={960}>
          <ModelosDisparo setor="marketing" modelos={cfg.modelos} podeEditar onMudou={() => void carregar()} />
        </Modal>
      )}
      {modal === "numero" && cfg && (
        <Modal aberto titulo="Número do Marketing" onFechar={() => setModal(null)} largura={640}>
          <NumeroForm cfg={cfg} ehAdmin={ehAdmin} onSalvo={() => { setModal(null); void carregar(); }} />
        </Modal>
      )}
    </div>
  );
}
