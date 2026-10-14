// src/rel/whatsapp/ModelosDoNumero.tsx
// -----------------------------------------------------------------------------
// MODELOS DE MENSAGEM de um número COEX (cada número tem a própria conta na
// Meta, com os próprios modelos). Saiu de WhatsAppPage em 14/10/2026 pra ser
// usado também na tela Modelos do Relacionamento (a Tainara padroniza dali).
//
// Fora da janela de 24h (ou na 1ª mensagem) a Meta só deixa enviar modelo
// APROVADO. Os disparos e automações do Relacionamento usam estes.
// Quem cria/exclui: admin ou gestor (o /api/wa-config confere de novo).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import type { NumeroMeta } from "@/lib/qs/metaConexao";
import { criarModeloNaMeta, excluirModeloNaMeta, listarModelosAdmin, type WaModeloAdmin } from "@/lib/qs/waInbox";
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

export default function ModelosDoNumero({ n, onCopiar, ocupadoFora = false, podeEditar = true }: {
  n: Pick<NumeroMeta, "phoneId" | "numero">;
  /** Botão "Copiar modelos do Comercial" (só na tela de conexão). */
  onCopiar?: () => void;
  ocupadoFora?: boolean;
  /** false = só lista (quem não é gestora/admin). */
  podeEditar?: boolean;
}) {
  const [modelos, setModelos] = useState<WaModeloAdmin[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({ nome: "", categoria: "UTILITY" as "UTILITY" | "MARKETING", corpo: "", rodape: "" });
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  // 14/10: exemplo de cada {{n}} — a Meta usa pra aprovar e recusa quando não combina com o texto.
  const [exemplos, setExemplos] = useState<Record<string, string>>({});
  const [topo, setTopo] = useState<Topo>("nenhum");
  const [titulo, setTitulo] = useState("");
  // Arquivo de EXEMPLO do topo — o revisor da Meta vê; no envio vai o de verdade.
  const [arquivoTopo, setArquivoTopo] = useState<File | null>(null);

  const carregar = useCallback(async () => {
    const r = await listarModelosAdmin(n.phoneId);
    setModelos(r.modelos);
    setErro(r.error || null);
  }, [n.phoneId]);
  useEffect(() => { void carregar(); }, [carregar]);

  async function criar() {
    const nome = form.nome.trim().toLowerCase().replace(/\s+/g, "_");
    if (!NOME_OK.test(nome)) { setErroForm("Nome só com letras minúsculas, números e _ (ex.: lembrete_embarque)."); return; }
    if (form.corpo.trim().length < 5) { setErroForm("Escreva o texto da mensagem."); return; }
    if (numeros.some((v) => !exemploDe(v).trim())) { setErroForm("Preencha o exemplo de cada campo — a Meta usa pra aprovar."); return; }
    if (topo === "TEXT" && !titulo.trim()) { setErroForm("Escreva o título do topo (ou escolha Topo: nenhum)."); return; }
    if (topo === "TEXT" && /{{/.test(titulo)) { setErroForm("O título do topo não aceita campos {{n}} por aqui — escreva um texto fixo."); return; }
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
    }, n.phoneId);
    setSalvando(false);
    if (!r.ok) { setErroForm(r.error || "A Meta recusou."); return; }
    setNovo(false);
    setForm({ nome: "", categoria: "UTILITY", corpo: "", rodape: "" });
    setExemplos({});
    setTopo("nenhum"); setTitulo(""); setArquivoTopo(null);
    await carregar();
  }

  async function excluir(m: WaModeloAdmin) {
    setConfirmar(null);
    const r = await excluirModeloNaMeta(m.nome, n.phoneId);
    if (!r.ok) setErro(r.error || "Não consegui excluir.");
    await carregar();
  }

  // Variáveis {{1}}, {{2}}… que aparecem no texto, pra lembrar do exemplo.
  const numeros = [...new Set([...form.corpo.matchAll(/{{\s*(\d+)\s*}}/g)].map((m) => m[1]))].sort((x, y) => Number(x) - Number(y));
  const exemploDe = (v: string) => exemplos[v] ?? (v === "1" ? "Maria" : "");

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
      {modelos === null ? <div className="h-16 rounded-lg animate-pulse" style={{ background: "var(--line)" }} /> :
        modelos.length === 0 ? <p className="text-sm" style={{ color: "var(--ink3)" }}>Nenhum modelo nesta conta ainda.</p> : (
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {modelos.map((m) => {
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
                    {m.motivo && <p className="text-[12px] mt-1" style={{ color: "var(--err-ink)" }}>Motivo da Meta: {m.motivo}</p>}
                  </div>
                  {podeEditar && (confirmar === chave ? (
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
          <Campo rotulo="Nome (só minúsculas, números e _)" dica="Ex.: lembrete_embarque, feliz_aniversario">
            <Entrada value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="lembrete_embarque" />
          </Campo>
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
              <option value="IMAGE">Imagem (JPG ou PNG)</option>
              <option value="VIDEO">Vídeo (MP4)</option>
              <option value="DOCUMENT">Documento (PDF)</option>
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
                  <Entrada value={exemploDe(v)} onChange={(e) => setExemplos((p) => ({ ...p, [v]: e.target.value }))}
                    aria-label={`Exemplo de {{${v}}}`} placeholder="Exemplo (obrigatório)" />
                </div>
              ))}
            </div>
          )}
          <Campo rotulo="Rodapé (opcional)">
            <Entrada value={form.rodape} onChange={(e) => setForm({ ...form, rodape: e.target.value })} placeholder="Se Tu For, Eu Vou! Viagens" />
          </Campo>
          <Aviso>A Meta analisa cada modelo: costuma levar de alguns minutos a algumas horas. Só dá pra usar depois de <b>Aprovado</b>.</Aviso>
          {erroForm && <Aviso tom="erro">{erroForm}</Aviso>}
        </div>
      </Modal>
    </section>
  );
}
