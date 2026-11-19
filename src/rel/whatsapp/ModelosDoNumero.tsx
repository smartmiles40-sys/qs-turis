// src/rel/whatsapp/ModelosDoNumero.tsx
// -----------------------------------------------------------------------------
// MODELOS DE MENSAGEM de um número COEX (cada número tem a própria conta na
// Meta, com os próprios modelos). Saiu de WhatsAppPage em 14/10/2026 pra ser
// usado também na tela Modelos do Relacionamento (a Tainara padroniza dali).
//
// Fora da janela de 24h (ou na 1ª mensagem) a Meta só deixa enviar modelo
// APROVADO. Os disparos e automações do Relacionamento usam estes.
// Quem cria/exclui: admin ou gestor (o /api/wa-config confere de novo).
// area="financeiro" (19/10): a tela Modelos do Financeiro — qualquer pessoa do
// Financeiro manda pra aprovação, o nome sempre começa com fin_ e cada {{n}}
// ganha o rótulo "o que é" (a tela de envio mostra). Excluir: só a gestão.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import type { NumeroMeta } from "@/lib/qs/metaConexao";
import { criarModeloNaMeta, excluirModeloNaMeta, listarModelosAdmin, type BotaoModelo, type WaModeloAdmin } from "@/lib/qs/waInbox";
import { ACEITA_DO_TOPO, ROTULO_DO_TOPO, arquivoParaBase64, problemaDoArquivoDoTopo } from "@/lib/qs/modeloCampos";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";

/** O que vai no topo do modelo (14/10): nada, um título de texto ou um arquivo. */
type Topo = "nenhum" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";

const STATUS_MODELO: Record<string, { txt: string; tom: "rel" | "aviso" | "erro" | "neutro" }> = {
  APPROVED: { txt: "Aprovado", tom: "rel" },
  PENDING: { txt: "Em análise", tom: "aviso" },
  REJECTED: { txt: "Recusado", tom: "erro" },
  PAUSED: { txt: "Pausado", tom: "aviso" },
  DISABLED: { txt: "Desativado", tom: "erro" },
};

const NOME_OK = /^[a-z0-9_]{1,512}$/;

const TIPO_BOTAO: Record<BotaoModelo["tipo"], { rotulo: string; dica: string; icone: string }> = {
  resposta: { rotulo: "Resposta rápida", dica: "O cliente toca e a resposta volta pra conversa (ex.: Quero saber, Agora não). Nos fluxos, cada uma vira uma saída.", icone: "↩" },
  link: { rotulo: "Link", dica: "Abre um site. Endereço fixo, completo (https://…).", icone: "🔗" },
  ligar: { rotulo: "Ligar", dica: "Liga pro número que você puser.", icone: "📞" },
};

/** O problema dos botões (o servidor confere de novo), ou null. */
function problemaDosBotoes(bs: BotaoModelo[]): string | null {
  if (bs.length > 10) return "No máximo 10 botões.";
  if (bs.filter((b) => b.tipo === "link").length > 2) return "No máximo 2 botões de link.";
  if (bs.filter((b) => b.tipo === "ligar").length > 1) return "Só 1 botão de ligar.";
  const textos = new Set<string>();
  for (const b of bs) {
    const t = b.texto.trim();
    if (!t) return "Escreva o texto de cada botão.";
    if (t.length > 25) return `O botão "${t}" passa de 25 caracteres.`;
    if (textos.has(t.toLowerCase())) return `Dois botões com o texto "${t}".`;
    textos.add(t.toLowerCase());
    if (b.tipo === "link" && !/^https?:\/\/\S+\.\S+$/i.test((b.url ?? "").trim())) return `O link do botão "${t}" precisa ser completo (https://…).`;
    if (b.tipo === "link" && /{{/.test(b.url ?? "")) return `O link do botão "${t}" tem que ser fixo (sem {{1}}).`;
    if (b.tipo === "ligar" && (b.telefone ?? "").replace(/\D/g, "").length < 10) return `O telefone do botão "${t}" está incompleto (DDD + número).`;
  }
  return null;
}

export default function ModelosDoNumero({ n, onCopiar, ocupadoFora = false, podeEditar = true, podeExcluir = podeEditar, area }: {
  n: Pick<NumeroMeta, "phoneId" | "numero">;
  /** Botão "Copiar modelos do Comercial" (só na tela de conexão). */
  onCopiar?: () => void;
  ocupadoFora?: boolean;
  /** false = só lista (quem não é gestora/admin). */
  podeEditar?: boolean;
  podeExcluir?: boolean;
  area?: "financeiro";
}) {
  const prefixo = area === "financeiro" ? "fin_" : "";
  const [modelos, setModelos] = useState<WaModeloAdmin[] | null>(null);
  // O número é dividido com o Financeiro (19/10): os modelos fin_ ficam escondidos aqui
  // (eles têm a tela própria no Financeiro). Lista só de fin_ = é a tela do Financeiro.
  const [verFin, setVerFin] = useState(false);
  const nFin = (modelos ?? []).filter((m) => m.nome.startsWith("fin_")).length;
  const soFin = nFin > 0 && nFin === (modelos ?? []).length;
  const visiveis = (modelos ?? []).filter((m) => soFin || verFin || !m.nome.startsWith("fin_"));
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({ nome: "", categoria: "UTILITY" as "UTILITY" | "MARKETING", corpo: "", rodape: "" });
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  // 14/10: exemplo de cada {{n}} — a Meta usa pra aprovar e recusa quando não combina com o texto.
  const [exemplos, setExemplos] = useState<Record<string, string>>({});
  // O que é cada {{n}} — só no Financeiro (vai pra qs_wa_modelo_campos).
  const [rotulos, setRotulos] = useState<Record<string, string>>({});
  const [topo, setTopo] = useState<Topo>("nenhum");
  const [titulo, setTitulo] = useState("");
  // Arquivo de EXEMPLO do topo — o revisor da Meta vê; no envio vai o de verdade.
  const [arquivoTopo, setArquivoTopo] = useState<File | null>(null);
  const [botoes, setBotoes] = useState<BotaoModelo[]>([]);
  const mudarBotao = (i: number, m: Partial<BotaoModelo>) => setBotoes((bs) => bs.map((b, j) => (j === i ? { ...b, ...m } : b)));

  const carregar = useCallback(async () => {
    const r = await listarModelosAdmin(n.phoneId, area);
    setModelos(r.modelos);
    setErro(r.error || null);
  }, [n.phoneId, area]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    // No Financeiro o fin_ já vem fixo; se a pessoa digitou de novo, não duplica.
    const nome = prefixo + form.nome.trim().toLowerCase().replace(/\s+/g, "_").replace(/^fin_/, prefixo ? "" : "fin_");
    if (!NOME_OK.test(nome) || nome === prefixo) { setErroForm("Nome só com letras minúsculas, números e _ (ex.: lembrete_embarque)."); return; }
    if (form.corpo.trim().length < 5) { setErroForm("Escreva o texto da mensagem."); return; }
    if (numeros.some((v) => !exemploDe(v).trim())) { setErroForm("Preencha o exemplo de cada campo — a Meta usa pra aprovar."); return; }
    if (area && numeros.some((v) => !rotuloDe(v).trim())) { setErroForm("Diga o que é cada campo (ex.: Primeiro nome do cliente) — quem envia vê isso."); return; }
    if (topo === "TEXT" && !titulo.trim()) { setErroForm("Escreva o título do topo (ou escolha Topo: nenhum)."); return; }
    if (topo === "TEXT" && /{{/.test(titulo)) { setErroForm("O título do topo não aceita campos {{n}} por aqui — escreva um texto fixo."); return; }
    const pb = problemaDosBotoes(botoes);
    if (pb) { setErroForm(pb); return; }
    const ehArquivo = topo === "IMAGE" || topo === "VIDEO" || topo === "DOCUMENT";
    if (ehArquivo) {
      const p = problemaDoArquivoDoTopo(topo, arquivoTopo);
      if (p) { setErroForm(p); return; }
    }
    setSalvando(true);
    setErroForm(null);
    const maior = numeros.length ? Math.max(...numeros.map(Number)) : 0;
    const listaEx = Array.from({ length: maior }, (_, i) => exemploDe(String(i + 1)).trim());
    let midia: { formato: "IMAGE" | "VIDEO" | "DOCUMENT"; base64: string; mime: string; nome: string } | undefined;
    if (ehArquivo && arquivoTopo) {
      try { midia = { formato: topo, base64: await arquivoParaBase64(arquivoTopo), mime: arquivoTopo.type, nome: arquivoTopo.name }; }
      catch (e) { setSalvando(false); setErroForm(e instanceof Error ? e.message : "Não consegui ler o arquivo."); return; }
    }
    const r = await criarModeloNaMeta({
      nome, categoria: form.categoria, idioma: "pt_BR", corpo: form.corpo.trim(), rodape: form.rodape.trim() || undefined, exemplos: listaEx,
      cabecalho: topo === "TEXT" ? titulo.trim() : undefined, midia,
      campos: area ? Object.fromEntries(numeros.map((v) => [v, rotuloDe(v).trim()])) : undefined,
      botoes: botoes.length ? botoes.map((b) => ({ tipo: b.tipo, texto: b.texto.trim(), url: b.tipo === "link" ? (b.url ?? "").trim() : null, telefone: b.tipo === "ligar" ? b.telefone ?? "" : null })) : undefined,
    }, n.phoneId, area);
    setSalvando(false);
    if (!r.ok) { setErroForm(r.error || "A Meta recusou."); return; }
    setNovo(false);
    setForm({ nome: "", categoria: "UTILITY", corpo: "", rodape: "" });
    setExemplos({});
    setRotulos({});
    setTopo("nenhum"); setTitulo(""); setArquivoTopo(null); setBotoes([]);
    await carregar();
  }

  async function excluir(m: WaModeloAdmin) {
    setConfirmar(null);
    const r = await excluirModeloNaMeta(m.nome, n.phoneId, area);
    if (!r.ok) setErro(r.error || "Não consegui excluir.");
    await carregar();
  }

  // Variáveis {{1}}, {{2}}… que aparecem no texto, pra lembrar do exemplo.
  const numeros = [...new Set([...form.corpo.matchAll(/{{\s*(\d+)\s*}}/g)].map((m) => m[1]))].sort((x, y) => Number(x) - Number(y));
  const exemploDe = (v: string) => exemplos[v] ?? (v === "1" ? "Maria" : "");
  const rotuloDe = (v: string) => rotulos[v] ?? (v === "1" ? "Primeiro nome do cliente" : "");

  return (
    <section className="rel-card p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold" style={{ color: "var(--ink)" }}>Modelos de mensagem — {n.numero || n.phoneId}</h2>
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            Fora das 24h depois da última mensagem do cliente, a Meta só deixa enviar modelo aprovado. Use {"{{1}}"}, {"{{2}}"}… pros campos que mudam (nome, destino).
          </p>
        </div>
        {podeEditar && (
          <div className="flex gap-2">
            {onCopiar && <Botao disabled={ocupadoFora} onClick={onCopiar}>Copiar modelos do Comercial</Botao>}
            <Botao variante="primario" onClick={() => setNovo(true)}>+ Novo modelo</Botao>
          </div>
        )}
      </div>
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {!soFin && nFin > 0 && (
        <button onClick={() => setVerFin(!verFin)} aria-pressed={verFin} className="text-[12px] font-semibold underline" style={{ color: "var(--ink2)" }}>
          {verFin ? "Esconder" : "Mostrar"} os {nFin} modelo{nFin > 1 ? "s" : ""} do Financeiro (fin_)
        </button>
      )}
      {modelos === null ? <div className="h-16 rounded-lg animate-pulse" style={{ background: "var(--line)" }} /> :
        visiveis.length === 0 ? <p className="text-sm" style={{ color: "var(--ink3)" }}>Nenhum modelo nesta conta ainda.</p> : (
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {visiveis.map((m) => {
              const s = STATUS_MODELO[m.status] || { txt: m.status, tom: "neutro" as const };
              const chave = m.id || m.nome;
              return (
                <li key={chave} className="py-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{m.nome}</span>
                      <Etiqueta tom={s.tom}>{s.txt}</Etiqueta>
                      <Etiqueta>{m.categoria === "MARKETING" ? "Marketing" : m.categoria === "UTILITY" ? "Utilidade" : m.categoria}</Etiqueta>
                      {m.cabecalhoMidia && <Etiqueta>📎 {ROTULO_DO_TOPO[m.cabecalhoMidia.toUpperCase()] ?? m.cabecalhoMidia.toLowerCase()} no topo</Etiqueta>}
                    </div>
                    <p className="text-[13px] mt-1 whitespace-pre-wrap" style={{ color: "var(--ink2)" }}>{m.corpo}</p>
                    {!!m.botoes?.length && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {m.botoes.map((b, i) => (
                          <span key={i} className="rounded-full border px-2.5 py-0.5 text-[12px]" style={{ borderColor: "var(--line)", color: "var(--ink2)" }}
                            title={b.url || b.telefone || "Resposta rápida"}>{TIPO_BOTAO[b.tipo as BotaoModelo["tipo"]]?.icone ?? "•"} {b.texto}</span>
                        ))}
                      </div>
                    )}
                    {m.motivo && <p className="text-[12px] mt-1" style={{ color: "var(--err-ink)" }}>Motivo da Meta: {m.motivo}</p>}
                  </div>
                  {podeExcluir && (confirmar === chave ? (
                    <span className="flex items-center gap-1.5 flex-shrink-0">
                      <span className="text-[12px]" style={{ color: "var(--err-ink)" }}>Excluir? Disparos que usam param.</span>
                      <Botao variante="perigo" onClick={() => void excluir(m)}>Sim</Botao>
                      <Botao variante="fantasma" onClick={() => setConfirmar(null)}>Não</Botao>
                    </span>
                  ) : (
                    <Botao variante="fantasma" aria-label={`Excluir o modelo ${m.nome}`} onClick={() => setConfirmar(chave)}>Excluir</Botao>
                  ))}
                </li>
              );
            })}
          </ul>
        )}

      <Modal aberto={novo} titulo="Novo modelo de mensagem" onFechar={() => !salvando && setNovo(false)}
        rodape={<>
          <Botao disabled={salvando} onClick={() => setNovo(false)}>Cancelar</Botao>
          <Botao variante="primario" disabled={salvando} onClick={() => void criar()}>{salvando ? "Enviando…" : "Enviar pra aprovação da Meta"}</Botao>
        </>}>
        <div className="space-y-3">
          {prefixo ? (
            <Campo rotulo="Nome (só minúsculas, números e _)" dica="Ex.: parcela_pendente — todo modelo do Financeiro começa com fin_.">
              <div className="flex items-center rel-input w-full p-0 overflow-hidden">
                <span className="pl-3 font-mono" style={{ color: "var(--ink3)" }}>{prefixo}</span>
                <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="parcela_pendente" aria-label="Nome do modelo"
                  className="flex-1 min-w-0 bg-transparent px-0.5 py-2 font-mono text-[13px] outline-none" />
              </div>
            </Campo>
          ) : (
            <Campo rotulo="Nome (só minúsculas, números e _)" dica="Ex.: lembrete_embarque, feliz_aniversario">
              <Entrada value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="lembrete_embarque" />
            </Campo>
          )}
          <Campo rotulo="Tipo" dica="Utilidade = aviso sobre a viagem que o cliente comprou (aprova mais fácil, custa menos). Marketing = oferta, convite, data especial (custa mais por mensagem).">
            <select className="rel-input w-full" value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value as "UTILITY" | "MARKETING" })}>
              <option value="UTILITY">Utilidade — aviso da viagem</option>
              <option value="MARKETING">Marketing — oferta ou data especial</option>
            </select>
          </Campo>
          <Campo rotulo="Topo da mensagem (opcional)" dica="Imagem, vídeo ou PDF aparecem acima do texto. Na hora de enviar, quem manda escolhe o arquivo de verdade.">
            <select className="rel-input w-full" value={topo} onChange={(e) => { setTopo(e.target.value as Topo); setArquivoTopo(null); }}>
              <option value="nenhum">Nenhum</option>
              <option value="TEXT">Título (texto)</option>
              {!area && <>
                <option value="IMAGE">Imagem (JPG ou PNG)</option>
                <option value="VIDEO">Vídeo (MP4)</option>
                <option value="DOCUMENT">Documento (PDF)</option>
              </>}
            </select>
          </Campo>
          {topo === "TEXT" && (
            <Campo rotulo="Título do topo" dica="Até 60 caracteres, sem emoji.">
              <Entrada value={titulo} maxLength={60} onChange={(e) => setTitulo(e.target.value)} placeholder="Sua viagem está chegando" />
            </Campo>
          )}
          {(topo === "IMAGE" || topo === "VIDEO" || topo === "DOCUMENT") && (
            <Campo rotulo={`Arquivo de exemplo (${ROTULO_DO_TOPO[topo]}, até 3 MB)`}
              dica={arquivoTopo ? `${arquivoTopo.name} · ${(arquivoTopo.size / 1024 / 1024).toFixed(1)} MB` : "A Meta olha esse arquivo pra aprovar — use um parecido com o que vai mandar de verdade."}>
              <input type="file" accept={ACEITA_DO_TOPO[topo]} onChange={(e) => setArquivoTopo(e.target.files?.[0] ?? null)}
                className="block w-full text-[13px]" style={{ color: "var(--ink2)" }} />
            </Campo>
          )}
          <Campo rotulo="Texto" dica={'Ex.: "Olá {{1}}! Faltam 7 dias pro seu embarque para {{2}}. Qualquer dúvida, é só chamar aqui."'}>
            <textarea className="rel-input w-full" rows={5} value={form.corpo} onChange={(e) => setForm({ ...form, corpo: e.target.value })} />
          </Campo>
          {numeros.length > 0 && (
            <div className="rel-card p-3 space-y-2">
              <p className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Exemplo de cada campo</p>
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>A Meta usa pra aprovar — tem que combinar com o texto (ex.: {"{{1}}"} = Maria, {"{{2}}"} = Japão). Quem envia preenche o valor de verdade na hora.</p>
              {numeros.map((v) => (
                <div key={v} className="flex items-center gap-2">
                  <code className="text-[12px] px-1.5 py-1 rounded" style={{ background: "var(--line2)", color: "var(--ink2)" }}>{`{{${v}}}`}</code>
                  {area && (
                    <Entrada value={rotuloDe(v)} onChange={(e) => setRotulos((p) => ({ ...p, [v]: e.target.value }))}
                      aria-label={`O que é {{${v}}}`} placeholder="O que é (ex.: Valor da parcela)" />
                  )}
                  <Entrada value={exemploDe(v)} onChange={(e) => setExemplos((p) => ({ ...p, [v]: e.target.value }))}
                    aria-label={`Exemplo de {{${v}}}`} placeholder="Exemplo (obrigatório)" />
                </div>
              ))}
            </div>
          )}
          <Campo rotulo="Rodapé (opcional)">
            <Entrada value={form.rodape} onChange={(e) => setForm({ ...form, rodape: e.target.value })} placeholder="Se Tu For, Eu Vou! Viagens" />
          </Campo>
          <div className="rel-card p-3 space-y-2">
            <div>
              <p className="text-[12px] font-semibold" style={{ color: "var(--ink2)" }}>Botões (opcional)</p>
              <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Respostas rápidas, link pra um site ou botão de ligar, embaixo da mensagem. Até 10 botões (no máximo 2 links e 1 de ligar), texto até 25 letras, sem emoji.</p>
            </div>
            {botoes.map((b, i) => (
              <div key={i} className="rounded-lg p-2 space-y-1.5" style={{ background: "var(--line2)" }}>
                <div className="flex items-center gap-2">
                  <span className="text-[12px] font-semibold whitespace-nowrap" style={{ color: "var(--ink2)" }} title={TIPO_BOTAO[b.tipo].dica}>{TIPO_BOTAO[b.tipo].icone} {TIPO_BOTAO[b.tipo].rotulo}</span>
                  <Entrada value={b.texto} maxLength={25} aria-label={`Texto do botão ${i + 1}`}
                    placeholder={b.tipo === "resposta" ? "Ex.: Quero saber" : b.tipo === "link" ? "Ex.: Ver as datas" : "Ex.: Falar com a gente"}
                    onChange={(e) => mudarBotao(i, { texto: e.target.value })} />
                  <span className="text-[11px] tabular-nums" style={{ color: "var(--ink3)" }}>{b.texto.length}/25</span>
                  <button type="button" className="px-1.5 text-[16px] leading-none" style={{ color: "var(--ink3)" }} aria-label={`Tirar o botão ${i + 1}`}
                    onClick={() => setBotoes((bs) => bs.filter((_, j) => j !== i))}>×</button>
                </div>
                {b.tipo === "link" && <Entrada value={b.url ?? ""} inputMode="url" aria-label={`Link do botão ${i + 1}`} placeholder="https://seturforeuvou.com.br/datas-2027" onChange={(e) => mudarBotao(i, { url: e.target.value })} />}
                {b.tipo === "ligar" && <Entrada value={b.telefone ?? ""} inputMode="tel" aria-label={`Telefone do botão ${i + 1}`} placeholder="DDD + número" onChange={(e) => mudarBotao(i, { telefone: e.target.value })} />}
              </div>
            ))}
            {botoes.length < 10 && (
              <div className="flex flex-wrap gap-2">
                <Botao variante="fantasma" onClick={() => setBotoes((bs) => [...bs, { tipo: "resposta", texto: "" }])}>+ Resposta rápida</Botao>
                <Botao variante="fantasma" disabled={botoes.filter((b) => b.tipo === "link").length >= 2} onClick={() => setBotoes((bs) => [...bs, { tipo: "link", texto: "", url: "" }])}>+ Link</Botao>
                <Botao variante="fantasma" disabled={botoes.some((b) => b.tipo === "ligar")} onClick={() => setBotoes((bs) => [...bs, { tipo: "ligar", texto: "", telefone: "" }])}>+ Ligar</Botao>
              </div>
            )}
            {botoes.some((b) => b.tipo === "resposta") && botoes.some((b) => b.tipo !== "resposta") && (
              <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>A Meta mostra as respostas rápidas primeiro e depois os links/ligar — o QS já organiza.</p>
            )}
          </div>
          <Aviso>A Meta analisa cada modelo: costuma levar de alguns minutos a algumas horas. Só dá pra usar depois de <b>Aprovado</b>.</Aviso>
          {erroForm && <Aviso tom="erro">{erroForm}</Aviso>}
        </div>
      </Modal>
    </section>
  );
}
