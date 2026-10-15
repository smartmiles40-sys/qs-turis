// src/rel/viagens/ArquivosViagem.tsx
// -----------------------------------------------------------------------------
// ARQUIVOS DA VIAGEM, VISUAL (15/10/2026). Bruno: "todos os arquivos para
// conseguir abrir, de uma forma visual". Uma grade com miniatura de cada
// arquivo (foto aparece, PDF vira cartão) separada por tipo; clicar abre ali
// mesmo, em tela cheia. Junta o que é da viagem e os documentos pessoais de
// quem viaja (passaporte, visto…). Enviar, aprovar e pedir ao cliente continuam
// no "Gerenciar documentos", logo abaixo.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { TIPOS_DOC, abrirDocumento, listarDocumentos, type Documento, type TipoDocumento } from "../lib/viagens";
import { Aviso, Modal } from "../ui";

const ORDEM: TipoDocumento[] = ["bilhete", "voucher", "seguro", "passaporte", "visto", "vacina", "rg_cnh", "contrato", "comprovante", "foto", "outro"];
const ehImagem = (d: Documento) => /^image\/(jpeg|png|webp|gif)$/.test(String(d.mime || "")) || /\.(jpe?g|png|webp|gif)$/i.test(d.arquivo_nome || d.arquivo_path);
const ehPdf = (d: Documento) => d.mime === "application/pdf" || /\.pdf$/i.test(d.arquivo_nome || d.arquivo_path);

export default function ArquivosViagem({ viagemId, pessoas, versao = 0 }: { viagemId: string; pessoas: { id: string; nome: string }[]; versao?: number }) {
  const [docs, setDocs] = useState<Documento[] | null>(null);
  const [miniaturas, setMiniaturas] = useState<Record<string, string>>({});
  const [aberto, setAberto] = useState<{ d: Documento; url: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const idsPessoas = pessoas.map((p) => p.id).join(",");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const listas = await Promise.all([
          listarDocumentos({ viagemId }),
          ...pessoas.map((p) => listarDocumentos({ clienteId: p.id })),
        ]);
        // documento pessoal de outra viagem (bilhete antigo…) não entra; passaporte/visto/vacina/RG entram
        const pessoais = new Set<TipoDocumento>(["passaporte", "visto", "vacina", "rg_cnh"]);
        const m = new Map<string, Documento>();
        listas.forEach((l, i) => l.forEach((d) => {
          if (d.status === "recusado") return;
          if (i === 0 || d.viagem_id === viagemId || (!d.viagem_id && pessoais.has(d.tipo))) m.set(d.id, d);
        }));
        const todos = [...m.values()];
        if (!vivo) return;
        setDocs(todos);
        // miniaturas das fotos: um pedido só, links de 1h
        const imgs = todos.filter(ehImagem);
        if (imgs.length) {
          const { data } = await supabase.storage.from("rel-documentos").createSignedUrls(imgs.map((d) => d.arquivo_path), 3600);
          const mapa: Record<string, string> = {};
          (data ?? []).forEach((r, i) => { if (r.signedUrl) mapa[imgs[i].id] = r.signedUrl; });
          if (vivo) setMiniaturas(mapa);
        }
      } catch (e) {
        if (vivo) { setErro(e instanceof Error ? e.message : "Não carregou os arquivos."); setDocs([]); }
      }
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viagemId, idsPessoas, versao]);

  const nomeDe = useMemo(() => new Map(pessoas.map((p) => [p.id, p.nome.split(" ")[0]])), [pessoas]);
  const grupos = useMemo(() => {
    const g = new Map<TipoDocumento, Documento[]>();
    for (const d of docs ?? []) g.set(d.tipo, [...(g.get(d.tipo) ?? []), d]);
    return ORDEM.filter((t) => g.has(t)).map((t) => [t, g.get(t)!] as const);
  }, [docs]);

  async function abrir(d: Documento) {
    setErro(null);
    try { setAberto({ d, url: await abrirDocumento(d) }); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não abriu."); }
  }

  if (docs === null) return <div className="h-24 rounded-xl animate-pulse" style={{ background: "var(--card2)" }} />;
  return (
    <div className="space-y-3">
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {docs.length === 0 && <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhum arquivo ainda. Envie em "Gerenciar documentos" ou peça ao cliente pelo link.</p>}
      {grupos.map(([tipo, lista]) => (
        <section key={tipo}>
          <h3 className="text-[11px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--ink2)" }}>{TIPOS_DOC[tipo]} <span style={{ color: "var(--ink3)" }}>{lista.length}</span></h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
            {lista.map((d) => (
              <li key={d.id}>
                <button onClick={() => void abrir(d)} className="w-full text-left rounded-lg overflow-hidden group focus-visible:outline-2"
                  style={{ border: "1px solid var(--line)", background: "var(--card2)" }} aria-label={`Abrir ${d.arquivo_nome || TIPOS_DOC[d.tipo]}`}>
                  <span className="block aspect-[4/3] relative overflow-hidden">
                    {miniaturas[d.id]
                      ? <img src={miniaturas[d.id]} alt="" loading="lazy" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                      : (
                        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1" style={{ color: ehPdf(d) ? "#DC2626" : "var(--ink3)" }}>
                          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                          <span className="text-[10px] font-bold">{ehPdf(d) ? "PDF" : (d.arquivo_nome?.split(".").pop() || "ARQ").toUpperCase().slice(0, 4)}</span>
                        </span>
                      )}
                    {d.status === "recebido" && <span className="absolute top-1 right-1 text-[9.5px] font-bold px-1.5 py-0.5 rounded" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>a conferir</span>}
                  </span>
                  <span className="block px-1.5 py-1 text-[11px] truncate" style={{ color: "var(--ink)" }}>
                    {nomeDe.get(d.cliente_id) ? <b>{nomeDe.get(d.cliente_id)} · </b> : null}{d.descricao || d.arquivo_nome || TIPOS_DOC[d.tipo]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Modal aberto={!!aberto} titulo={aberto ? (aberto.d.arquivo_nome || TIPOS_DOC[aberto.d.tipo]) : ""} onFechar={() => setAberto(null)} largura={1100}
        rodape={aberto ? <a href={aberto.url} target="_blank" rel="noreferrer" className="text-[13px] font-semibold underline" style={{ color: "var(--rel-ink)" }}>Abrir em outra aba / baixar</a> : undefined}>
        {aberto && (ehImagem(aberto.d)
          ? <img src={aberto.url} alt={aberto.d.arquivo_nome || ""} className="max-w-full max-h-[75vh] mx-auto rounded" />
          : ehPdf(aberto.d)
            ? <iframe src={aberto.url} title={aberto.d.arquivo_nome || "documento"} className="w-full rounded" style={{ height: "75vh", border: "1px solid var(--line)" }} />
            : <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Esse formato não abre aqui — use o link abaixo.</p>)}
      </Modal>
    </div>
  );
}
