// src/mkt/disparos/SequenciasPage.tsx
// -----------------------------------------------------------------------------
// SEQUÊNCIAS DO MARKETING (0242) — as "cadências" do SendFlow.
// Desde 30/10 é a seção "Sequências" da aba Disparos (DisparosMktPage.tsx);
// criar é pelo "+ Novo disparo" › Sequência de mensagens.
// Passo 1 no dia 0, passo 2 no dia 3, passo 3 no dia 7… contados da ENTRADA
// de cada pessoa. Entra pelo botão "Inscrever" (o público daquele momento) ou
// sozinha, ao entrar na lista-gatilho. Respondeu ou disse PARAR = sai.
// Cada passo vira uma campanha do dia, na mesma fila do disparo.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { Alert, Badge, Button, EmptyState } from "@/components/ui";
import { notifyError, notifySuccess } from "@/lib/qs/notify";
import { type ConfigDisparo, type MapaVariaveis } from "@/lib/qs/disparos";
import { Campo, INPUT, INPUT_ESTILO, Modal } from "@/components/sdr/disparos/pecas";
import {
  apagarSequencia, ativarSequencia, inscreverNaSequencia, listarInscricoes, listarSequencias, salvarSequencia, tirarInscricao,
  type Inscricao, type Passo, type PublicoMkt, type Sequencia,
} from "./api";
import { ModeloEVariaveis, PublicoMktForm, useListasETags, variaveisOk } from "./pecasMkt";
import { descreverSequencia, formatarTelefone } from "./regras";

// 04/11/2026: em Brasília (a hora dos passos é de Brasília), não no fuso do navegador.
const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

function Editor({ cfg, inicial, onFechar, onSalvo }: { cfg: ConfigDisparo; inicial: Sequencia | null; onFechar: () => void; onSalvo: () => void }) {
  const aprovados = cfg.modelos.filter((m) => m.status === "aprovado" && m.setor === "marketing");
  const { listas } = useListasETags();
  const [nome, setNome] = useState(inicial?.nome ?? "");
  const [descricao, setDescricao] = useState(inicial?.descricao ?? "");
  const [parar, setParar] = useState(inicial?.parar_se_responder ?? true);
  const [gatilho, setGatilho] = useState(inicial?.lista_gatilho_id ?? "");
  const [passos, setPassos] = useState<Passo[]>(inicial?.passos?.length ? inicial.passos : [{ dia_offset: 0, hora: "10:00", modelo_nome: "", modelo_idioma: "pt_BR", params: {} }]);
  const [salvando, setSalvando] = useState(false);
  const desc = descreverSequencia(passos);
  const okPassos = passos.every((p) => variaveisOk(aprovados.find((m) => m.nome === p.modelo_nome) ?? null, p.params));
  const muda = (i: number, x: Partial<Passo>) => setPassos(passos.map((p, j) => (j === i ? { ...p, ...x } : p)));

  async function salvar() {
    setSalvando(true);
    try {
      await salvarSequencia({ id: inicial?.id, nome: nome.trim(), descricao: descricao.trim() || null, parar_se_responder: parar, lista_gatilho_id: gatilho || null,
        passos: passos.map((p) => ({ ...p, modelo_idioma: aprovados.find((m) => m.nome === p.modelo_nome)?.idioma ?? "pt_BR" })) });
      notifySuccess("Sequência salva."); onSalvo();
    } catch (e) { notifyError(e instanceof Error ? e.message : "Não salvou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto titulo={inicial ? `Sequência · ${inicial.nome}` : "Nova sequência"} onFechar={onFechar} largura={820}
      rodape={<><Button variant="ghost" onClick={onFechar}>Fechar</Button>
        <Button variant="primary" disabled={nome.trim().length < 2 || !okPassos || !!desc.erro || salvando} onClick={() => void salvar()}>{salvando ? "Salvando…" : "Salvar"}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome"><input className={INPUT} style={INPUT_ESTILO} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Boas-vindas da live" /></Campo>
        <Campo rotulo="Entra sozinho quem entrar na lista" dica="Opcional. Sem lista, só pelo botão Inscrever.">
          <select className={INPUT} style={INPUT_ESTILO} value={gatilho} onChange={(e) => setGatilho(e.target.value)}>
            <option value="">— nenhuma —</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
        </Campo>
      </div>
      <Campo rotulo="Descrição (opcional)"><input className={INPUT} style={INPUT_ESTILO} value={descricao} onChange={(e) => setDescricao(e.target.value)} /></Campo>
      <label className="flex items-center gap-2 text-[13.5px]" style={{ color: "var(--text)" }}>
        <input type="checkbox" checked={parar} onChange={(e) => setParar(e.target.checked)} /> Quem responder sai da sequência (PARAR sempre tira)
      </label>
      <p className="text-[12.5px]" style={{ color: desc.erro ? "var(--danger, #b42318)" : "var(--muted)" }}>{desc.erro ?? desc.texto}</p>
      {passos.map((p, i) => (
        <div key={i} className="qs-card p-3 space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <p className="qs-label flex-1">Passo {i + 1}</p>
            <Campo rotulo="Dia (0 = o dia que entrou)"><input type="number" min={0} max={365} className={INPUT} style={{ ...INPUT_ESTILO, width: 110 }} value={p.dia_offset} onChange={(e) => muda(i, { dia_offset: Number(e.target.value) })} /></Campo>
            <Campo rotulo="Hora"><input type="time" className={INPUT} style={{ ...INPUT_ESTILO, width: 120 }} value={p.hora} onChange={(e) => muda(i, { hora: e.target.value })} /></Campo>
            {passos.length > 1 && <Button size="sm" variant="ghost" onClick={() => setPassos(passos.filter((_, j) => j !== i))}>Tirar</Button>}
          </div>
          <ModeloEVariaveis aprovados={aprovados} modeloNome={p.modelo_nome} setModeloNome={(n) => muda(i, { modelo_nome: n, params: {} })}
            mapa={p.params} setMapa={(m: MapaVariaveis) => muda(i, { params: m })} />
        </div>
      ))}
      <Button onClick={() => { const u = passos[passos.length - 1]; setPassos([...passos, { dia_offset: (u?.dia_offset ?? 0) + 3, hora: u?.hora ?? "10:00", modelo_nome: "", modelo_idioma: "pt_BR", params: {} }]); }}>+ Passo</Button>
      {inicial && <Alert tone="info">Mudar os passos vale pra quem já está dentro a partir do PRÓXIMO passo dela.</Alert>}
    </Modal>
  );
}

function Inscrever({ s, onFechar, onFeito }: { s: Sequencia; onFechar: () => void; onFeito: () => void }) {
  const [publico, setPublico] = useState<PublicoMkt>({ fonte: "contatos" });
  const [pv, setPv] = useState<{ total: number; excluidos?: { motivo: string; n: number }[] } | null>(null);
  const [andando, setAndando] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => { inscreverNaSequencia(s.id, publico, true).then(setPv).catch((e) => notifyError(e instanceof Error ? e.message : "Falhou.")); }, 450);
    return () => clearTimeout(t);
  }, [publico, s.id]);
  return (
    <Modal aberto titulo={`Inscrever em · ${s.nome}`} onFechar={onFechar} largura={760}
      rodape={<><Button variant="ghost" onClick={onFechar}>Fechar</Button>
        <Button variant="primary" disabled={!pv?.total || andando} onClick={async () => {
          setAndando(true);
          try { const r = await inscreverNaSequencia(s.id, publico); notifySuccess(`${r.inscritos ?? 0} entraram (quem já estava não entra de novo).`); onFeito(); }
          catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } finally { setAndando(false); }
        }}>{andando ? "Inscrevendo…" : `Inscrever ${pv?.total ?? 0}`}</Button></>}>
      <PublicoMktForm p={publico} set={setPublico} />
      {pv && (
        <div className="qs-card p-3 text-[13px]" style={{ color: "var(--text)" }}>
          <p><b className="qs-num">{pv.total}</b> podem entrar.</p>
          {(pv.excluidos ?? []).map((x) => <p key={x.motivo} style={{ color: "var(--muted)" }}>Saem {x.n} — {x.motivo}</p>)}
        </div>
      )}
      <p className="text-[12px]" style={{ color: "var(--subtle)" }}>O passo 1 sai no dia {s.passos[0]?.dia_offset ?? 0} às {s.passos[0]?.hora ?? "—"} (ou na próxima janela de envio).</p>
    </Modal>
  );
}

function Inscritos({ s, onFechar }: { s: Sequencia; onFechar: () => void }) {
  const [lista, setLista] = useState<Inscricao[] | null>(null);
  // 04/11/2026: se a leitura falhava, o modal ficava em "Carregando…" pra sempre.
  const [erro, setErro] = useState<string | null>(null);
  const carregar = useCallback(() => {
    listarInscricoes(s.id).then((l) => { setLista(l); setErro(null); })
      .catch((e) => { const m = e instanceof Error ? e.message : "Falhou."; setErro(m); notifyError(m); });
  }, [s.id]);
  useEffect(() => { carregar(); }, [carregar]);
  return (
    <Modal aberto titulo={`Quem está em · ${s.nome}`} onFechar={onFechar} largura={820}>
      {lista === null && erro ? <Alert tone="danger">Não consegui ler quem está na sequência: {erro}</Alert> : lista === null ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p> : lista.length === 0 ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Ninguém ainda.</p> : (
        <div className="qs-table-wrap"><table className="qs-table">
          <thead><tr><th>Nome</th><th>WhatsApp</th><th>Situação</th><th>Próximo</th><th></th></tr></thead>
          <tbody>{lista.map((i) => (
            <tr key={i.id}>
              <td>{i.nome ?? "—"}</td><td className="qs-num">{formatarTelefone(i.telefone)}</td>
              <td>{i.status}{i.motivo ? <span style={{ color: "var(--subtle)" }}> — {i.motivo}</span> : null}</td>
              <td className="text-[12px]">{i.status === "ativa" && i.proximo_em ? `passo ${i.proximo_passo} · ${dataHora(i.proximo_em)}` : "—"}</td>
              <td>{i.status === "ativa" && <Button size="sm" variant="ghost" onClick={async () => { try { await tirarInscricao(i.id); carregar(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } }}>Tirar</Button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Modal>
  );
}

/** A seção "Sequências" da aba Disparos. `criar` abre o editor de uma nova. */
export function SecaoSequencias({ cfg, versao, criar, onCriarFechou, onContar }: {
  cfg: ConfigDisparo; versao: number; criar: boolean; onCriarFechou: () => void; onContar?: (n: number) => void;
}) {
  const [lista, setLista] = useState<Sequencia[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<Sequencia | null>(null);
  const [inscrevendo, setInscrevendo] = useState<Sequencia | null>(null);
  const [vendo, setVendo] = useState<Sequencia | null>(null);

  const carregar = useCallback(async () => {
    try { const l = await listarSequencias(); setLista(l); setErro(null); onContar?.(l.length); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não carregou."); setLista([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { void carregar(); }, [carregar, versao]);

  return (
    <div className="space-y-3">
      {erro && <Alert tone="danger">{erro}</Alert>}
      {!cfg.numeroMkt && lista?.length ? <Alert tone="warn">O Marketing ainda não tem número: as inscrições esperam (nenhum passo é queimado) até o número existir.</Alert> : null}
      {lista === null ? <p className="text-[13px]" style={{ color: "var(--subtle)" }}>Carregando…</p>
        : lista.length === 0 ? <div className="qs-card"><EmptyState title="Nenhuma sequência" description="Ex.: quem entra na lista da live recebe o convite no dia 0, o roteiro no dia 2 e as vagas no dia 5. Crie pelo “+ Novo disparo” › Sequência de mensagens." /></div>
        : (
          <ul className="space-y-2">
            {lista.map((s) => (
              <li key={s.id} className="qs-card p-4 space-y-2">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold" style={{ color: "var(--text)" }}>{s.nome}</p>
                    <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>{descreverSequencia(s.passos).texto}{s.parar_se_responder ? " · sai quem responde" : ""}</p>
                    <p className="text-[12px] qs-num" style={{ color: "var(--subtle)" }}>
                      {s.contagem?.ativa ?? 0} dentro · {s.contagem?.concluida ?? 0} concluíram · {s.contagem?.saiu ?? 0} saíram
                    </p>
                  </div>
                  <Badge tone={s.ativa ? "ok" : undefined} dot>{s.ativa ? "ativa" : "parada"}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={s.ativa ? "secondary" : "primary"} onClick={async () => { try { await ativarSequencia(s.id, !s.ativa); void carregar(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); } }}>{s.ativa ? "Parar" : "Ativar"}</Button>
                  <Button size="sm" onClick={() => setInscrevendo(s)}>Inscrever</Button>
                  <Button size="sm" variant="ghost" onClick={() => setVendo(s)}>Quem está</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditando(s)}>Editar</Button>
                  <Button size="sm" variant="destructive" onClick={async () => {
                    if (!window.confirm(`Apagar "${s.nome}"? Quem está dentro para de receber.`)) return;
                    try { await apagarSequencia(s.id); void carregar(); } catch (e) { notifyError(e instanceof Error ? e.message : "Falhou."); }
                  }}>Apagar</Button>
                </div>
                {!s.ativa && (s.contagem?.ativa ?? 0) > 0 && <p className="text-[12px]" style={{ color: "var(--subtle)" }}>Parada: ninguém recebe o próximo passo até ativar.</p>}
              </li>
            ))}
          </ul>
        )}
      {(editando || criar) && <Editor cfg={cfg} inicial={editando} onFechar={() => { setEditando(null); onCriarFechou(); }} onSalvo={() => { setEditando(null); onCriarFechou(); void carregar(); }} />}
      {inscrevendo && <Inscrever s={inscrevendo} onFechar={() => setInscrevendo(null)} onFeito={() => { setInscrevendo(null); void carregar(); }} />}
      {vendo && <Inscritos s={vendo} onFechar={() => setVendo(null)} />}
    </div>
  );
}
