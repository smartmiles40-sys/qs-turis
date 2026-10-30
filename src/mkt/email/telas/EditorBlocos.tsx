// Editor por blocos (compartilhado por Campanhas e Modelos). Os blocos editáveis
// e, se a tela não tiver a prévia no lado dela (semPrevia), a prévia real do HTML.
// O rodapé (com o descadastro) é fixo: não sai e fica sempre por último.
import { useMemo } from "react";
import { blocoNovo, ROTULO_BLOCO, type Alinhamento, type Bloco, type Coluna } from "../lib/blocos";
import { Area, Botao, Campo, Entrada, Escolha, PreviaEmail } from "../ui";

/** O que dá pra pôr (o rodapé não: ele já existe e é obrigatório). */
const TIPOS: { tipo: Bloco["tipo"]; icone: string }[] = [
  { tipo: "titulo", icone: "T" }, { tipo: "texto", icone: "¶" }, { tipo: "imagem", icone: "▣" }, { tipo: "botao", icone: "▭" },
  { tipo: "colunas", icone: "▥" }, { tipo: "divisor", icone: "—" }, { tipo: "espaco", icone: "↕" },
];

function Alinhar({ valor, onChange }: { valor?: Alinhamento; onChange: (a: Alinhamento) => void }) {
  return (
    <Escolha value={valor ?? "esquerda"} onChange={(e) => onChange(e.target.value as Alinhamento)} aria-label="Alinhamento">
      <option value="esquerda">À esquerda</option>
      <option value="centro">Centralizado</option>
      <option value="direita">À direita</option>
    </Escolha>
  );
}

function EditarColuna({ c, onChange, nome }: { c: Coluna; onChange: (c: Coluna) => void; nome: string }) {
  return (
    <div className="space-y-2">
      <Campo rotulo={`${nome}: imagem (https)`}><Entrada value={c.imagem ?? ""} onChange={(e) => onChange({ ...c, imagem: e.target.value })} placeholder="https://…" /></Campo>
      <Campo rotulo={`${nome}: texto`}><Area rows={3} value={c.texto ?? ""} onChange={(e) => onChange({ ...c, texto: e.target.value })} /></Campo>
    </div>
  );
}

function EditarBloco({ b, onChange }: { b: Bloco; onChange: (b: Bloco) => void }) {
  switch (b.tipo) {
    case "titulo":
      return (
        <div className="grid sm:grid-cols-[1fr_140px_140px] gap-2">
          <Entrada value={b.texto} onChange={(e) => onChange({ ...b, texto: e.target.value })} aria-label="Título" />
          <Escolha value={b.nivel ?? 1} onChange={(e) => onChange({ ...b, nivel: Number(e.target.value) === 2 ? 2 : 1 })} aria-label="Tamanho">
            <option value={1}>Grande</option><option value={2}>Médio</option>
          </Escolha>
          <Alinhar valor={b.alinhar} onChange={(a) => onChange({ ...b, alinhar: a })} />
        </div>
      );
    case "texto":
      return (
        <div className="space-y-2">
          <Area rows={5} value={b.texto} onChange={(e) => onChange({ ...b, texto: e.target.value })} aria-label="Texto" />
          <div className="flex flex-wrap items-center gap-2 text-[11px]" style={{ color: "var(--ink2)" }}>
            <span>**negrito** · [texto](https://link) · {"{{primeiro_nome}}"} · {"{{nome}}"} · {"{{email}}"} · {"{{campo}}"}</span>
            <div className="w-40 ml-auto"><Alinhar valor={b.alinhar} onChange={(a) => onChange({ ...b, alinhar: a })} /></div>
          </div>
        </div>
      );
    case "imagem":
      return (
        <div className="grid sm:grid-cols-2 gap-2">
          <Campo rotulo="Endereço da imagem (https)"><Entrada value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} placeholder="https://…/foto.jpg" /></Campo>
          <Campo rotulo="Texto alternativo"><Entrada value={b.alt ?? ""} onChange={(e) => onChange({ ...b, alt: e.target.value })} /></Campo>
          <Campo rotulo="Link ao clicar (opcional)"><Entrada value={b.link ?? ""} onChange={(e) => onChange({ ...b, link: e.target.value })} placeholder="https://…" /></Campo>
          <Campo rotulo="Largura (px, até 536)"><Entrada type="number" min={40} max={536} value={b.largura ?? 536} onChange={(e) => onChange({ ...b, largura: Number(e.target.value) })} /></Campo>
        </div>
      );
    case "botao":
      return (
        <div className="grid sm:grid-cols-2 gap-2">
          <Campo rotulo="Texto do botão"><Entrada value={b.texto} onChange={(e) => onChange({ ...b, texto: e.target.value })} /></Campo>
          <Campo rotulo="Link"><Entrada value={b.url} onChange={(e) => onChange({ ...b, url: e.target.value })} placeholder="https://…" /></Campo>
          <Campo rotulo="Cor"><Entrada type="color" value={b.cor ?? "#0E7C6A"} onChange={(e) => onChange({ ...b, cor: e.target.value })} /></Campo>
          <Campo rotulo="Posição"><Alinhar valor={b.alinhar} onChange={(a) => onChange({ ...b, alinhar: a })} /></Campo>
        </div>
      );
    case "colunas":
      return (
        <div className="grid sm:grid-cols-2 gap-3">
          <EditarColuna nome="Esquerda" c={b.esquerda} onChange={(c) => onChange({ ...b, esquerda: c })} />
          <EditarColuna nome="Direita" c={b.direita} onChange={(c) => onChange({ ...b, direita: c })} />
        </div>
      );
    case "espaco":
      return <Campo rotulo="Altura (px)"><Entrada type="number" min={4} max={120} value={b.altura ?? 24} onChange={(e) => onChange({ ...b, altura: Number(e.target.value) })} /></Campo>;
    case "rodape":
      return (
        <Campo rotulo="Frase do rodapé (opcional)" dica="O CNPJ, o endereço e o link de descadastro entram sozinhos (Conexão › Remetente).">
          <Entrada value={b.texto ?? ""} onChange={(e) => onChange({ ...b, texto: e.target.value })} />
        </Campo>
      );
    default:
      return <p className="text-xs" style={{ color: "var(--ink2)" }}>Linha divisória.</p>;
  }
}

export function EditorBlocos({ blocos, onChange, html, semPrevia }: { blocos: Bloco[]; onChange: (b: Bloco[]) => void; html: string; semPrevia?: boolean }) {
  // Rodapé sempre existe e sempre por último (o renderEmail também garante no HTML).
  const corpo = blocos.filter((b) => b.tipo !== "rodape");
  const rodapeAuto = useMemo(() => blocoNovo("rodape"), []);
  const rodape = blocos.find((b) => b.tipo === "rodape") ?? rodapeAuto;
  const ordenados = [...corpo, rodape];
  const por = (lista: Bloco[]) => onChange([...lista.filter((b) => b.tipo !== "rodape"), rodape]);
  const adicionar = (tipo: Bloco["tipo"]) => por([...corpo, blocoNovo(tipo)]);
  const mover = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= corpo.length) return;
    const c = [...corpo];
    [c[i], c[j]] = [c[j], c[i]];
    por(c);
  };

  const editor = (
    <div className="space-y-3">
      {ordenados.map((b, i) => {
        const fixo = b.tipo === "rodape";
        return (
          <div key={b.id} className="rel-card p-3" style={fixo ? { background: "var(--card2)" } : undefined}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>{ROTULO_BLOCO[b.tipo]}</span>
              {fixo ? <span className="text-[11px]" style={{ color: "var(--ink3)" }}>· obrigatório, sempre no fim</span> : (
                <div className="ml-auto flex gap-1">
                  <Botao variante="fantasma" aria-label="Subir bloco" onClick={() => mover(i, -1)} disabled={i === 0}>↑</Botao>
                  <Botao variante="fantasma" aria-label="Descer bloco" onClick={() => mover(i, 1)} disabled={i >= corpo.length - 1}>↓</Botao>
                  <Botao variante="fantasma" aria-label="Duplicar bloco" onClick={() => por([...corpo.slice(0, i + 1), { ...b, id: blocoNovo(b.tipo).id }, ...corpo.slice(i + 1)])}>⧉</Botao>
                  <Botao variante="fantasma" aria-label="Remover bloco" onClick={() => por(corpo.filter((x) => x.id !== b.id))}>✕</Botao>
                </div>
              )}
            </div>
            <EditarBloco b={b} onChange={(nb) => onChange(ordenados.map((x) => (x.id === b.id ? nb : x)))} />
          </div>
        );
      })}
      <div className="rel-card p-3" style={{ borderStyle: "dashed" }}>
        <div className="text-xs font-semibold mb-2" style={{ color: "var(--ink2)" }}>Adicionar bloco</div>
        <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
          {TIPOS.map((t) => (
            <button key={t.tipo} type="button" onClick={() => adicionar(t.tipo)}
              className="flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-semibold hover:opacity-90"
              style={{ border: "1px solid var(--line)", background: "var(--card)", color: "var(--ink2)" }}>
              <span aria-hidden className="text-[17px] leading-none" style={{ color: "var(--rel-ink)" }}>{t.icone}</span>
              {ROTULO_BLOCO[t.tipo]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
  if (semPrevia) return editor;
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-4">
      {editor}
      <div className="lg:sticky lg:top-4 self-start"><PreviaEmail html={html} /></div>
    </div>
  );
}
