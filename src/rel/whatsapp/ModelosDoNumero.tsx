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
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";

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
    setSalvando(true);
    setErroForm(null);
    const r = await criarModeloNaMeta({ nome, categoria: form.categoria, idioma: "pt_BR", corpo: form.corpo.trim(), rodape: form.rodape.trim() || undefined }, n.phoneId);
    setSalvando(false);
    if (!r.ok) { setErroForm(r.error || "A Meta recusou."); return; }
    setNovo(false);
    setForm({ nome: "", categoria: "UTILITY", corpo: "", rodape: "" });
    await carregar();
  }

  async function excluir(m: WaModeloAdmin) {
    setConfirmar(null);
    const r = await excluirModeloNaMeta(m.nome, n.phoneId);
    if (!r.ok) setErro(r.error || "Não consegui excluir.");
    await carregar();
  }

  // Variáveis {{1}}, {{2}}… que aparecem no texto, pra lembrar do exemplo.
  const variaveis = Array.from(new Set(form.corpo.match(/\{\{\d+\}\}/g) || []));

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
          <Campo rotulo="Texto" dica={'Ex.: "Olá {{1}}! Faltam 7 dias pro seu embarque para {{2}}. Qualquer dúvida, é só chamar aqui."'}>
            <textarea className="rel-input w-full" rows={5} value={form.corpo} onChange={(e) => setForm({ ...form, corpo: e.target.value })} />
          </Campo>
          {variaveis.length > 0 && (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
              Campos que mudam: {variaveis.join(", ")} — quem envia preenche na hora (ex.: {"{{1}}"} = nome do cliente, {"{{2}}"} = destino).
            </p>
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
