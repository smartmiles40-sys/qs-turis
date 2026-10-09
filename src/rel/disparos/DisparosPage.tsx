// src/rel/disparos/DisparosPage.tsx
// -----------------------------------------------------------------------------
// CAMPANHAS de disparo do Relacionamento (Fase 4).
//
// Assistente em 3 passos: modelo + variáveis → público (com prévia de quantos
// recebem) → confirmar e enviar. O envio roda em lotes de 20 com a barra de
// progresso; dá pra pausar e retomar. Fechar a aba PAUSA de fato (ninguém
// mais chama o próximo lote) — é só abrir e clicar em "Continuar".
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useRef, useState } from "react";
import {
  apagarCampanha, criarCampanha, descreverPublico, enviarLote, envios, listarCampanhas, MESES, pausarCampanha,
  prepararCampanha, previaPublico, retomarCampanha,
  type Campanha, type Envio, type MapaVariaveis, type PreviaPublico, type Publico,
} from "../lib/disparos";
import { formatarTelefone } from "../lib/clientes";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal, Vazio } from "../ui";
import ModeloEVariaveis, { mapaCompleto, useModelos } from "./ModeloEVariaveis";

const STATUS: Record<Campanha["status"], { rotulo: string; tom: "neutro" | "rel" | "aviso" | "erro" }> = {
  rascunho: { rotulo: "rascunho", tom: "neutro" },
  enviando: { rotulo: "enviando", tom: "aviso" },
  pausada: { rotulo: "pausada", tom: "neutro" },
  concluida: { rotulo: "concluída", tom: "rel" },
};

function Barra({ c }: { c: Pick<Campanha, "total" | "enviados" | "falhas" | "pulados"> }) {
  const feitos = c.enviados + c.falhas + c.pulados;
  const pct = c.total ? Math.round((feitos / c.total) * 100) : 0;
  return (
    <div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--line)" }}>
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: "var(--rel)" }} />
      </div>
      <p className="text-[11px] mt-1 tabular-nums" style={{ color: "var(--ink3)" }}>
        {c.enviados} enviadas · {c.falhas} falharam · {c.pulados} puladas · de {c.total}
      </p>
    </div>
  );
}

// ── Assistente ──────────────────────────────────────────────────────────────

function NovaCampanha({ aberto, onFechar, onCriada }: { aberto: boolean; onFechar: () => void; onCriada: (c: Campanha) => void }) {
  const { modelos, erro: erroModelos } = useModelos();
  const [passo, setPasso] = useState(1);
  const [nome, setNome] = useState("");
  const [modelo, setModelo] = useState<{ nome: string; idioma: string; corpo: string } | null>(null);
  const [mapa, setMapa] = useState<MapaVariaveis>({});
  const [publico, setPublico] = useState<Publico>({ tipo: "viagem", fase: "antes" });
  const [previa, setPrevia] = useState<PreviaPublico | null>(null);
  const [carregandoPrevia, setCarregandoPrevia] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setPasso(1); setNome(""); setModelo(null); setMapa({}); setPublico({ tipo: "viagem", fase: "antes" }); setPrevia(null); setErro(null);
  }, [aberto]);

  // Prévia do público (espera a pessoa parar de mexer).
  useEffect(() => {
    if (!aberto || passo !== 2) return;
    setCarregandoPrevia(true);
    const t = setTimeout(() => {
      previaPublico(publico).then(setPrevia).catch((e) => setErro(e instanceof Error ? e.message : "Falhou.")).finally(() => setCarregandoPrevia(false));
    }, 400);
    return () => clearTimeout(t);
  }, [publico, passo, aberto]);

  const set = <K extends keyof Publico>(k: K, v: Publico[K]) => setPublico((p) => ({ ...p, [k]: v }));
  // Sem viagem no público, destino/data/link da pesquisa não têm de onde vir.
  const semViagem = publico.tipo !== "viagem";
  const usaFonteDeViagem = Object.values(mapa).some((m) => ["destino", "data_embarque", "link_pesquisa"].includes(m.fonte));

  async function criar() {
    if (!modelo) return;
    setSalvando(true);
    setErro(null);
    try {
      const c = await criarCampanha({ nome: nome.trim(), modelo_nome: modelo.nome, modelo_idioma: modelo.idioma, params: mapa, publico });
      onCriada(c);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui criar.");
    } finally {
      setSalvando(false);
    }
  }

  const podeAvancar1 = nome.trim().length >= 2 && !!modelo && mapaCompleto(modelo.corpo, mapa);

  return (
    <Modal
      aberto={aberto}
      titulo={`Nova campanha · passo ${passo} de 3`}
      onFechar={onFechar}
      largura={640}
      rodape={
        <>
          {passo > 1 && <Botao variante="fantasma" onClick={() => setPasso(passo - 1)}>Voltar</Botao>}
          {passo === 1 && <Botao variante="primario" disabled={!podeAvancar1} onClick={() => setPasso(2)}>Escolher público</Botao>}
          {passo === 2 && <Botao variante="primario" disabled={!previa?.total || (semViagem && usaFonteDeViagem)} onClick={() => setPasso(3)}>Revisar</Botao>}
          {passo === 3 && <Botao variante="primario" disabled={salvando} onClick={criar}>{salvando ? "Criando…" : "Criar campanha"}</Botao>}
        </>
      }
    >
      <div className="space-y-4">
        {passo === 1 && (
          <>
            <Campo rotulo="Nome da campanha (só o time vê)">
              <Entrada value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Lembrete de documentos — Japão Março" autoFocus />
            </Campo>
            <ModeloEVariaveis
              modelos={modelos} erro={erroModelos}
              modeloNome={modelo?.nome ?? ""} modeloIdioma={modelo?.idioma ?? ""}
              mapa={mapa}
              onModelo={(m) => setModelo({ nome: m.nome, idioma: m.idioma, corpo: m.corpo })}
              onMapa={setMapa}
            />
          </>
        )}

        {passo === 2 && (
          <>
            <Campo rotulo="Quem recebe">
              <select className="rel-input" value={publico.tipo} onChange={(e) => setPublico({ tipo: e.target.value as Publico["tipo"] })}>
                <option value="viagem">Passageiros de viagens</option>
                <option value="aniversariantes_mes">Aniversariantes do mês</option>
                <option value="todos">Todos os clientes</option>
              </select>
            </Campo>
            {publico.tipo === "viagem" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Campo rotulo="Expedição (contém)"><Entrada value={publico.expedicao ?? ""} onChange={(e) => set("expedicao", e.target.value)} placeholder="Ex.: Japão" /></Campo>
                <Campo rotulo="Destino (contém)"><Entrada value={publico.destino ?? ""} onChange={(e) => set("destino", e.target.value)} placeholder="Ex.: Islândia" /></Campo>
                <Campo rotulo="Embarque a partir de"><Entrada type="date" value={publico.embarque_de ?? ""} onChange={(e) => set("embarque_de", e.target.value)} /></Campo>
                <Campo rotulo="Embarque até"><Entrada type="date" value={publico.embarque_ate ?? ""} onChange={(e) => set("embarque_ate", e.target.value)} /></Campo>
                <Campo rotulo="Momento da viagem">
                  <select className="rel-input" value={publico.fase ?? ""} onChange={(e) => set("fase", e.target.value as Publico["fase"])}>
                    <option value="">Qualquer</option>
                    <option value="antes">Ainda vão viajar</option>
                    <option value="em_viagem">Estão viajando</option>
                    <option value="concluida">Já voltaram</option>
                  </select>
                </Campo>
              </div>
            )}
            {publico.tipo === "aniversariantes_mes" && (
              <Campo rotulo="Mês">
                <select className="rel-input" value={publico.mes ?? new Date().getMonth() + 1} onChange={(e) => set("mes", Number(e.target.value))}>
                  {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </select>
              </Campo>
            )}
            {semViagem && usaFonteDeViagem && (
              <Aviso tom="erro">O modelo usa destino, data de embarque ou link da pesquisa — isso só existe com público "Passageiros de viagens".</Aviso>
            )}
            <div className="rel-card p-3">
              {carregandoPrevia ? (
                <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Contando…</p>
              ) : previa ? (
                <>
                  <p className="text-[14px]" style={{ color: "var(--ink)" }}>
                    <b className="text-lg">{previa.total}</b> cliente{previa.total === 1 ? "" : "s"} vão receber.
                    {(previa.optout > 0 || previa.semTelefone > 0) && (
                      <span className="text-[12px]" style={{ color: "var(--ink3)" }}> ({previa.optout} pediram pra não receber · {previa.semTelefone} sem telefone — ficam de fora)</span>
                    )}
                  </p>
                  {previa.amostra.length > 0 && (
                    <p className="text-[12px] mt-1" style={{ color: "var(--ink3)" }}>
                      Ex.: {previa.amostra.map((a) => a.nome.split(" ")[0]).join(", ")}{previa.total > previa.amostra.length ? "…" : ""}
                    </p>
                  )}
                </>
              ) : null}
            </div>
          </>
        )}

        {passo === 3 && modelo && (
          <>
            <dl className="text-[13px] space-y-1.5" style={{ color: "var(--ink)" }}>
              <div><dt className="inline font-semibold">Campanha: </dt><dd className="inline">{nome}</dd></div>
              <div><dt className="inline font-semibold">Modelo: </dt><dd className="inline">{modelo.nome}</dd></div>
              <div><dt className="inline font-semibold">Público: </dt><dd className="inline">{descreverPublico(publico)} — <b>{previa?.total ?? 0}</b> clientes</dd></div>
            </dl>
            <Aviso>
              Só modelo aprovado. Quem pediu pra parar não recebe. <b>Marketing em excesso derruba a qualidade do número</b> —
              e número com qualidade baixa passa a ter limite de envio (inclusive pro atendimento).
            </Aviso>
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>A campanha é criada como rascunho. O envio começa quando você clicar em "Enviar" na lista.</p>
          </>
        )}

        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}

// ── Envios de uma campanha ──────────────────────────────────────────────────

function ListaEnvios({ campanha, onFechar }: { campanha: Campanha | null; onFechar: () => void }) {
  const [lista, setLista] = useState<Envio[] | null>(null);
  useEffect(() => {
    if (!campanha) return;
    setLista(null);
    envios({ campanhaId: campanha.id }).then(setLista).catch(() => setLista([]));
  }, [campanha]);
  const tom = { enviado: "rel", falhou: "erro", pulado: "neutro", pendente: "aviso" } as const;
  return (
    <Modal aberto={!!campanha} titulo={`Envios · ${campanha?.nome ?? ""}`} onFechar={onFechar} largura={620}>
      {lista === null ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
        : lista.length === 0 ? <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum envio ainda.</p>
        : (
          <ul className="space-y-1">
            {lista.map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-[13px] py-1.5" style={{ borderBottom: "1px solid var(--line2)", color: "var(--ink)" }}>
                <span className="flex-1 min-w-0">
                  <span className="font-semibold">{e.cliente?.nome ?? "—"}</span>
                  <span className="ml-2 text-[12px]" style={{ color: "var(--ink3)" }}>{formatarTelefone(e.telefone)}</span>
                  {e.motivo && <span className="block text-[12px]" style={{ color: "var(--ink3)" }}>{e.motivo}</span>}
                </span>
                <Etiqueta tom={tom[e.status]}>{e.status}</Etiqueta>
              </li>
            ))}
          </ul>
        )}
    </Modal>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────

export default function DisparosPage() {
  const [lista, setLista] = useState<Campanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [vendo, setVendo] = useState<Campanha | null>(null);
  const [rodando, setRodando] = useState<string | null>(null);
  const parar = useRef(false);

  const carregar = useCallback(async () => {
    try { setLista(await listarCampanhas()); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não consegui carregar."); setLista([]); }
  }, []);
  useEffect(() => { void carregar(); }, [carregar]);
  // Sair da tela interrompe o laço (o servidor guarda onde parou).
  useEffect(() => () => { parar.current = true; }, []);

  /** Manda lote atrás de lote até acabar, pausar ou dar erro. */
  async function enviar(c: Campanha) {
    setErro(null);
    setRodando(c.id);
    parar.current = false;
    try {
      if (c.status === "rascunho") await prepararCampanha(c.id);
      else if (c.status === "pausada") await retomarCampanha(c.id);
      await carregar();
      for (;;) {
        if (parar.current) break;
        const p = await enviarLote(c.id);
        await carregar();
        if (p.acabou) break;
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "O envio parou.");
    } finally {
      setRodando(null);
      await carregar();
    }
  }

  async function pausar(c: Campanha) {
    parar.current = true;
    try { await pausarCampanha(c.id); } catch { /* o laço já parou */ }
    await carregar();
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Disparos</h1>
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Mensagem em massa pelo WhatsApp do Relacionamento, sempre com modelo aprovado pela Meta.</p>
        </div>
        <Botao variante="primario" onClick={() => setNova(true)}>+ Nova campanha</Botao>
      </div>

      <Aviso>Só modelo aprovado. Quem pediu pra parar não recebe. Marketing em excesso derruba a qualidade do número.</Aviso>
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {lista === null ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : lista.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhuma campanha ainda" texto="Ex.: avisar todos os passageiros de uma expedição sobre a reunião de apresentação." acao={<Botao variante="primario" onClick={() => setNova(true)}>Criar a primeira</Botao>} /></div>
      ) : (
        <ul className="space-y-3">
          {lista.map((c) => {
            const st = STATUS[c.status];
            const aqui = rodando === c.id;
            return (
              <li key={c.id} className="rel-card p-4 space-y-2.5">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-bold" style={{ color: "var(--ink)" }}>{c.nome}</p>
                    <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
                      {c.modelo_nome} · {descreverPublico(c.publico)} · criada {new Date(c.criado_em).toLocaleDateString("pt-BR")}
                    </p>
                  </div>
                  <Etiqueta tom={st.tom}>{aqui ? "enviando…" : st.rotulo}</Etiqueta>
                </div>
                {c.status !== "rascunho" && <Barra c={c} />}
                <div className="flex flex-wrap gap-2">
                  {c.status === "rascunho" && <Botao variante="primario" disabled={!!rodando} onClick={() => void enviar(c)}>Enviar</Botao>}
                  {(c.status === "pausada" || (c.status === "enviando" && !aqui)) && (
                    <Botao variante="primario" disabled={!!rodando} onClick={() => void enviar(c)}>Continuar</Botao>
                  )}
                  {aqui && <Botao onClick={() => void pausar(c)}>Pausar</Botao>}
                  {c.status !== "rascunho" && <Botao variante="fantasma" onClick={() => setVendo(c)}>Ver envios</Botao>}
                  {c.status === "rascunho" && (
                    <Botao variante="fantasma" onClick={async () => { await apagarCampanha(c.id).catch(() => null); void carregar(); }}>Apagar</Botao>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <NovaCampanha aberto={nova} onFechar={() => setNova(false)} onCriada={() => { setNova(false); void carregar(); }} />
      <ListaEnvios campanha={vendo} onFechar={() => setVendo(null)} />
    </div>
  );
}
