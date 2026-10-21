// src/expedicoes/portal/RoteiroInline.tsx
// "Roteiro dia a dia" do portal (app antigo: RoteiroInline, DiaInline,
// FotosRoteiro, PasseiosOpcionaisDia e PasseioOpcionalCard do PortalEditor).
// Edita direto na lista e salva cada campo ao sair dele. Cada dia tem fotos
// (arquivos "Foto roteiro") e até 3 passeios opcionais (foto "Foto passeio
// opcional", título, descritivo, tipo opcional/adicional e link do WhatsApp).
// Correções em relação ao antigo: a data do "Adicionar dia" não pula por fuso,
// título vazio não é gravado (a coluna é obrigatória) e excluir o dia apaga as
// fotos do Storage em vez de deixá-las órfãs.
import { useRef, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { Botao, Campo, Entrada } from "@/rel/ui";
import { useExp } from "../contexto";
import { BotaoExcluir, Cartao } from "../ui";
import type { ArquivoRow, PasseioOpcionalRow, RoteiroDiaFotoRow, RoteiroDiaRow } from "../lib/database";
import { formatDate } from "../lib/utils";
import { enviarArquivo, excluirArquivo } from "../drive/arquivos";
import { IconeSvg } from "../drive/icones";
import { Titulo } from "./Anexos";
import { adicionarFotoRoteiro, atualizarItem, colunasParaSegmento, criarItem, excluirDia, excluirItem, segmentoParaColunas, type ConteudoPortal } from "./dados";

export type Par = { value: string; label: string };
const MAX_PASSEIOS = 3;

export function RoteiroInline({ expedicaoId, c, links, paresExtensao, segmentoLabel, onMudou }: {
  expedicaoId: string; c: ConteudoPortal; links: Record<string, string>;
  paresExtensao: Par[]; segmentoLabel: (ext: string | null, base: boolean) => string | null; onMudou: () => void;
}) {
  const { avisar } = useExp();
  const [ocupado, setOcupado] = useState(false);
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const alternar = (id: string) => setAbertos((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function adicionar(base?: RoteiroDiaRow) {
    setOcupado(true);
    const maxDia = c.roteiro.reduce((m, d) => Math.max(m, d.dia ?? 0), 0);
    const ultima = c.roteiro.map((d) => d.data).filter(Boolean).sort().pop() ?? null;
    const proxData = ultima ? format(addDays(parseISO(String(ultima).slice(0, 10)), 1), "yyyy-MM-dd") : null;
    const valores = base
      ? { dia: maxDia + 1, data: base.data, titulo: base.titulo, cidade: base.cidade, refeicoes: base.refeicoes, hospedagem: base.hospedagem, descricao: base.descricao, extensao_id: base.extensao_id, apenas_sem_extensao: base.apenas_sem_extensao }
      : { dia: maxDia + 1, data: proxData, titulo: `Dia ${maxDia + 1}`, cidade: null, refeicoes: null, hospedagem: null, descricao: null, extensao_id: null, apenas_sem_extensao: false };
    try {
      const id = await criarItem("roteiro_dias", expedicaoId, valores);
      setAbertos((s) => new Set(s).add(id));
      if (base) avisar("Dia duplicado (fotos e passeios não são copiados)");
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao adicionar", "erro"); }
    finally { setOcupado(false); }
  }

  return (
    <Cartao titulo={<Titulo icone="calendario" titulo="Roteiro dia a dia" texto="Clique num dia pra editar aqui mesmo — salva sozinho ao sair do campo. A ordem no portal segue a data." />}
      acao={<Botao variante="primario" onClick={() => void adicionar()} disabled={ocupado}><IconeSvg nome="mais" /> {ocupado ? "Adicionando…" : "Adicionar dia"}</Botao>}>
      {c.roteiro.length === 0 ? (
        <p className="rounded-lg border border-dashed py-6 text-center text-[12px]" style={{ borderColor: "var(--line)", color: "var(--ink3)" }}>Nenhum dia ainda. Clique em “Adicionar dia”.</p>
      ) : (
        <ul className="space-y-1.5">
          {c.roteiro.map((d) => (
            <DiaInline key={d.id} expedicaoId={expedicaoId} dia={d} c={c} links={links}
              fotos={c.fotos.filter((f) => f.roteiro_dia_id === d.id)}
              passeios={c.passeiosOpcionais.filter((p) => p.roteiro_dia_id === d.id)}
              paresExtensao={paresExtensao} segmento={segmentoLabel(d.extensao_id, d.apenas_sem_extensao)}
              aberto={abertos.has(d.id)} onAlternar={() => alternar(d.id)} onDuplicar={() => void adicionar(d)} onMudou={onMudou} />
          ))}
        </ul>
      )}
    </Cartao>
  );
}

type CampoDia = "dia" | "data" | "titulo" | "cidade" | "refeicoes" | "hospedagem" | "descricao";

function DiaInline({ expedicaoId, dia, c, links, fotos, passeios, paresExtensao, segmento, aberto, onAlternar, onDuplicar, onMudou }: {
  expedicaoId: string; dia: RoteiroDiaRow; c: ConteudoPortal; links: Record<string, string>;
  fotos: RoteiroDiaFotoRow[]; passeios: PasseioOpcionalRow[]; paresExtensao: Par[]; segmento: string | null;
  aberto: boolean; onAlternar: () => void; onDuplicar: () => void; onMudou: () => void;
}) {
  const { avisar } = useExp();
  const temExtensoes = paresExtensao.length > 2;
  const inicial = (): Record<CampoDia, string> => ({
    dia: String(dia.dia ?? ""), data: dia.data ? String(dia.data).slice(0, 10) : "", titulo: dia.titulo ?? "", cidade: dia.cidade ?? "",
    refeicoes: dia.refeicoes ?? "", hospedagem: dia.hospedagem ?? "", descricao: dia.descricao ?? "",
  });
  const [v, setV] = useState(inicial);
  const salvo = useRef(inicial());
  const [status, setStatus] = useState<"" | "salvando" | "salvo">("");

  async function salvar(k: CampoDia) {
    if (v[k] === salvo.current[k]) return;
    if (k === "titulo" && !v.titulo.trim()) { avisar("O título do dia não pode ficar vazio", "erro"); setV((s) => ({ ...s, titulo: salvo.current.titulo })); return; }
    const valor = k === "dia" ? (parseInt(v.dia, 10) || 1) : (v[k].trim() === "" ? null : v[k]);
    setStatus("salvando");
    try {
      await atualizarItem("roteiro_dias", dia.id, { [k]: valor });
      salvo.current = { ...salvo.current, [k]: v[k] };
      if (k === "dia" && String(valor) !== v.dia) setV((s) => ({ ...s, dia: String(valor) }));
      setStatus("salvo");
      setTimeout(() => setStatus(""), 1300);
      if (k === "data" || k === "dia") onMudou(); // reordena a lista
    } catch (e) { setStatus(""); avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro"); }
  }
  async function mudarSegmento(valor: string) {
    try { await atualizarItem("roteiro_dias", dia.id, segmentoParaColunas(valor)); onMudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao vincular ao segmento", "erro"); }
  }

  const campo = (k: CampoDia) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value })), onBlur: () => void salvar(k) });
  const nF = fotos.length, nP = passeios.length;

  return (
    <li className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--line)", background: "var(--card)" }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onAlternar} className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={aberto}>
          <span className="flex h-6 min-w-[2.1rem] items-center justify-center rounded px-1 text-[11px] font-bold text-white" style={{ background: "#1F2937" }}>D{v.dia || "?"}</span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 truncate text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
              {v.titulo || "—"}
              {segmento && <span className="inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "#EDE9FE", color: "#5B21B6" }}><IconeSvg nome="rota" tamanho={10} />{segmento}</span>}
            </span>
            <span className="block truncate text-[11px]" style={{ color: "var(--ink3)" }}>
              {v.data ? formatDate(v.data) : "sem data"}{v.cidade ? ` · ${v.cidade}` : ""}{nF ? ` · ${nF} foto${nF === 1 ? "" : "s"}` : ""}{nP ? ` · ${nP} passeio${nP === 1 ? "" : "s"} opcional${nP === 1 ? "" : "is"}` : ""}
            </span>
          </span>
        </button>
        {status && <span className="text-[11px] flex-shrink-0" style={{ color: status === "salvo" ? "#16A34A" : "var(--ink3)" }}>{status === "salvando" ? "salvando…" : "✓ salvo"}</span>}
        <button type="button" onClick={onDuplicar} title="Duplicar dia" aria-label="Duplicar dia" className="p-1.5 rounded-md hover:bg-[var(--card2)]" style={{ color: "var(--ink2)" }}><IconeSvg nome="copiar" /></button>
        <BotaoExcluir titulo="Excluir este dia?" sucesso="Dia excluído"
          descricao={nF || nP ? `As ${nF} foto(s) e ${nP} passeio(s) opcional(is) deste dia também serão apagados. Não dá pra desfazer.` : undefined}
          onConfirmar={async () => { await excluirDia(dia, c); onMudou(); }} />
        <button type="button" onClick={onAlternar} aria-label="Abrir/fechar" className="p-1.5 rounded-md hover:bg-[var(--card2)]" style={{ color: "var(--ink2)", transform: aberto ? "rotate(90deg)" : undefined, transition: "transform .15s" }}><IconeSvg nome="seta" /></button>
      </div>

      {aberto && (
        <div className="space-y-3 border-t p-3" style={{ borderColor: "var(--line)" }}>
          <div className="grid grid-cols-[84px_1fr] gap-2">
            <Campo rotulo="Dia"><Entrada inputMode="numeric" {...campo("dia")} /></Campo>
            <Campo rotulo="Data"><Entrada type="date" {...campo("data")} /></Campo>
          </div>
          <Campo rotulo="Título"><Entrada placeholder="Ex.: Chegada em Cusco" {...campo("titulo")} /></Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Campo rotulo="Cidade"><Entrada {...campo("cidade")} /></Campo>
            <Campo rotulo="Refeições"><Entrada placeholder="Café, Almoço" {...campo("refeicoes")} /></Campo>
          </div>
          <Campo rotulo="Hospedagem"><Entrada {...campo("hospedagem")} /></Campo>
          {temExtensoes && (
            <Campo rotulo="Faz parte de" dica="Dia de extensão aparece só para quem contratou. “Só quem não fez extensão” é para o final do grupo base (último dia/volta), que some para quem estende.">
              <select className="rel-input" value={colunasParaSegmento(dia.extensao_id, dia.apenas_sem_extensao)} onChange={(e) => void mudarSegmento(e.target.value)}>
                {paresExtensao.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Campo>
          )}
          <Campo rotulo="Descrição"><textarea className="rel-input" rows={4} {...campo("descricao")} /></Campo>
          <div className="border-t pt-3" style={{ borderColor: "var(--line)" }}>
            <FotosDia expedicaoId={expedicaoId} diaId={dia.id} fotos={fotos} arquivos={c.arquivos} links={links} onMudou={onMudou} />
          </div>
          <div className="border-t pt-3" style={{ borderColor: "var(--line)" }}>
            <PasseiosOpcionaisDia expedicaoId={expedicaoId} diaId={dia.id} passeios={passeios} arquivos={c.arquivos} links={links} onMudou={onMudou} />
          </div>
          <p className="text-[11px]" style={{ color: "var(--ink3)" }}>As mudanças salvam sozinhas ao sair de cada campo.</p>
        </div>
      )}
    </li>
  );
}

function FotosDia({ expedicaoId, diaId, fotos, arquivos, links, onMudou }: {
  expedicaoId: string; diaId: string; fotos: RoteiroDiaFotoRow[]; arquivos: Map<string, ArquivoRow>; links: Record<string, string>; onMudou: () => void;
}) {
  const { avisar } = useExp();
  const [enviando, setEnviando] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  async function enviar(lista: FileList | null) {
    const fs = Array.from(lista ?? []);
    if (!fs.length) return;
    let falhas = 0;
    for (const [i, f] of fs.entries()) {
      setEnviando(`${i + 1}/${fs.length}`);
      try {
        const a = await enviarArquivo({ expedicaoId, categoria: "Outros", descricao: "Foto roteiro", arquivo: f });
        try { await adicionarFotoRoteiro(expedicaoId, diaId, a.id); } catch (e) { await excluirArquivo(a.id).catch(() => {}); throw e; }
      } catch (e) { falhas++; avisar(e instanceof Error ? e.message : "Falha no envio", "erro"); }
    }
    setEnviando(null);
    if (ref.current) ref.current.value = "";
    if (!falhas) avisar("Fotos atualizadas");
    onMudou();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: "var(--ink)" }}><IconeSvg nome="imagem" tamanho={13} /> Fotos do dia</span>
        <Botao onClick={() => ref.current?.click()} disabled={Boolean(enviando)}><IconeSvg nome="upload" tamanho={13} /> {enviando ? `Enviando ${enviando}…` : "Enviar fotos"}</Botao>
        <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => void enviar(e.target.files)} />
      </div>
      {fotos.length === 0 ? <p className="text-[11px]" style={{ color: "var(--ink3)" }}>Nenhuma foto ainda.</p> : (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {fotos.map((f) => {
            const a = arquivos.get(f.arquivo_id);
            const url = a ? links[a.storage_path] : undefined;
            return (
              <div key={f.id} className="group relative aspect-square overflow-hidden rounded-lg border" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
                {url ? <img src={url} alt={f.legenda ?? "Foto do roteiro"} className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full items-center justify-center text-[10px]" style={{ color: "var(--ink3)" }}>…</span>}
                <button type="button" aria-label="Remover foto" title="Remover foto"
                  onClick={async () => { try { await excluirArquivo(f.arquivo_id); avisar("Foto removida"); onMudou(); } catch (e) { avisar(e instanceof Error ? e.message : "Erro ao remover", "erro"); } }}
                  className="absolute right-1 top-1 rounded-full p-1 text-white sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100" style={{ background: "rgba(0,0,0,.6)" }}>
                  <IconeSvg nome="x" tamanho={12} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PasseiosOpcionaisDia({ expedicaoId, diaId, passeios, arquivos, links, onMudou }: {
  expedicaoId: string; diaId: string; passeios: PasseioOpcionalRow[]; arquivos: Map<string, ArquivoRow>; links: Record<string, string>; onMudou: () => void;
}) {
  const { avisar } = useExp();
  const [ocupado, setOcupado] = useState(false);
  const cheio = passeios.length >= MAX_PASSEIOS;
  async function adicionar() {
    setOcupado(true);
    try { await criarItem("passeios_opcionais", expedicaoId, { roteiro_dia_id: diaId, titulo: null, descricao: null, foto_arquivo_id: null, whatsapp_url: null, tipo: "opcional" }); onMudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao adicionar", "erro"); }
    finally { setOcupado(false); }
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-bold" style={{ color: "var(--ink)" }}><IconeSvg nome="brilho" tamanho={13} /> Passeios opcionais deste dia</span>
        <Botao onClick={() => void adicionar()} disabled={ocupado || cheio}><IconeSvg nome="mais" tamanho={13} /> {cheio ? "Máx. 3" : ocupado ? "Adicionando…" : "Adicionar passeio"}</Botao>
      </div>
      <p className="text-[11px]" style={{ color: "var(--ink3)" }}>Ofertas para o dia livre. Aparecem no portal do passageiro; quando ele compra, você marca no perfil dele e o passeio entra “confirmado” no lugar do dia livre.</p>
      {passeios.length === 0 ? <p className="text-[11px]" style={{ color: "var(--ink3)" }}>Nenhum passeio opcional neste dia.</p> : (
        <div className="space-y-2">{passeios.map((p) => <PasseioOpcionalCard key={p.id} expedicaoId={expedicaoId} passeio={p} arquivos={arquivos} links={links} onMudou={onMudou} />)}</div>
      )}
    </div>
  );
}

function PasseioOpcionalCard({ expedicaoId, passeio, arquivos, links, onMudou }: {
  expedicaoId: string; passeio: PasseioOpcionalRow; arquivos: Map<string, ArquivoRow>; links: Record<string, string>; onMudou: () => void;
}) {
  const { avisar } = useExp();
  const ref = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const inicial = () => ({ titulo: passeio.titulo ?? "", descricao: passeio.descricao ?? "", whatsapp_url: passeio.whatsapp_url ?? "" });
  const [v, setV] = useState(inicial);
  const salvo = useRef(inicial());
  const foto = passeio.foto_arquivo_id ? arquivos.get(passeio.foto_arquivo_id) : undefined;
  const urlFoto = foto ? links[foto.storage_path] : undefined;

  async function salvar(k: keyof ReturnType<typeof inicial>) {
    if (v[k] === salvo.current[k]) return;
    const valor = v[k].trim();
    if (k === "whatsapp_url" && valor && !/^https?:\/\//i.test(valor)) avisar("Atenção: o link do WhatsApp costuma começar com https://wa.me/ — confira.", "erro");
    try { await atualizarItem("passeios_opcionais", passeio.id, { [k]: valor === "" ? null : valor }); salvo.current = { ...salvo.current, [k]: v[k] }; }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao salvar", "erro"); }
  }
  async function mudarTipo(tipo: string) {
    try { await atualizarItem("passeios_opcionais", passeio.id, { tipo }); onMudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Erro ao mudar o tipo", "erro"); }
  }
  async function enviarFoto(f: File | undefined) {
    if (!f) return;
    setEnviando(true);
    try {
      const a = await enviarArquivo({ expedicaoId, categoria: "Outros", descricao: "Foto passeio opcional", arquivo: f });
      try { await atualizarItem("passeios_opcionais", passeio.id, { foto_arquivo_id: a.id }); } catch (e) { await excluirArquivo(a.id).catch(() => {}); throw e; }
      avisar("Foto anexada");
      onMudou();
    } catch (e) { avisar(e instanceof Error ? e.message : "Falha no envio", "erro"); }
    finally { setEnviando(false); if (ref.current) ref.current.value = ""; }
  }
  async function removerFoto() {
    if (!passeio.foto_arquivo_id) return;
    try { await atualizarItem("passeios_opcionais", passeio.id, { foto_arquivo_id: null }); await excluirArquivo(passeio.foto_arquivo_id).catch(() => {}); avisar("Foto removida"); onMudou(); }
    catch (e) { avisar(e instanceof Error ? e.message : "Falha ao remover", "erro"); }
  }

  return (
    <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: "#C4B5FD", background: "rgba(237, 233, 254, .35)" }}>
      <div className="flex items-start gap-2.5">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border" style={{ borderColor: "var(--line)", background: "var(--card2)" }}>
          {passeio.foto_arquivo_id ? (
            <>
              {urlFoto ? <img src={urlFoto} alt="Foto do passeio" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-[10px]" style={{ color: "var(--ink3)" }}>…</span>}
              <button type="button" onClick={() => void removerFoto()} aria-label="Remover foto" className="absolute right-0.5 top-0.5 rounded-full p-0.5 text-white" style={{ background: "rgba(0,0,0,.6)" }}><IconeSvg nome="x" tamanho={11} /></button>
            </>
          ) : (
            <button type="button" onClick={() => ref.current?.click()} disabled={enviando} className="flex h-full w-full flex-col items-center justify-center gap-0.5 text-[10px] hover:bg-[var(--card)]" style={{ color: "var(--ink3)" }}>
              <IconeSvg nome="imagem" />{enviando ? "…" : "Foto"}
            </button>
          )}
          <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => void enviarFoto(e.target.files?.[0])} />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <Entrada aria-label="Título do passeio" value={v.titulo} placeholder="Título (ex.: Balonismo na Capadócia)" onChange={(e) => setV((s) => ({ ...s, titulo: e.target.value }))} onBlur={() => void salvar("titulo")} />
          <textarea aria-label="Descritivo do passeio" className="rel-input" rows={2} value={v.descricao} placeholder="Descritivo do passeio" onChange={(e) => setV((s) => ({ ...s, descricao: e.target.value }))} onBlur={() => void salvar("descricao")} />
        </div>
        <BotaoExcluir titulo="Excluir este passeio opcional?" sucesso="Passeio removido"
          descricao="Se algum passageiro já comprou, a compra marcada no perfil dele também some."
          onConfirmar={async () => { await excluirItem("passeios_opcionais", passeio.id, [passeio.foto_arquivo_id]); onMudou(); }} />
      </div>
      <select aria-label="Tipo do passeio" className="rel-input" style={{ padding: "6px 10px", fontSize: 12.5, width: "auto" }} value={passeio.tipo ?? "opcional"} onChange={(e) => void mudarTipo(e.target.value)}>
        <option value="opcional">Opcional — substitui o dia inteiro</option>
        <option value="adicional">Adicional — não substitui o dia</option>
      </select>
      <div className="flex items-center gap-1.5">
        <span style={{ color: "#16A34A" }}><IconeSvg nome="whatsapp" /></span>
        <Entrada aria-label="Link do WhatsApp" value={v.whatsapp_url} placeholder="Link do WhatsApp (https://wa.me/55…)" onChange={(e) => setV((s) => ({ ...s, whatsapp_url: e.target.value }))} onBlur={() => void salvar("whatsapp_url")} />
      </div>
      {(passeio.tipo ?? "opcional") === "adicional" && (
        <p className="text-[11px]" style={{ color: "var(--ink3)" }}>É oferecido no portal com o WhatsApp; quando adquirido, aparece como “adquirido” <strong>sem</strong> substituir o dia no roteiro.</p>
      )}
    </div>
  );
}
