// Editor por blocos (compartilhado por Campanhas e Modelos). À esquerda os
// blocos editáveis; à direita a prévia real do HTML do e-mail (iframe sandbox).
import { useState } from "react";
import { blocoNovo, ROTULO_BLOCO, type Alinhamento, type Bloco, type Coluna } from "../lib/blocos";
import { Area, Botao, Campo, Entrada, Escolha } from "../ui";

const TIPOS: Bloco["tipo"][] = ["titulo", "texto", "imagem", "botao", "colunas", "divisor", "espaco", "rodape"];

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

export function EditorBlocos({ blocos, onChange, html }: { blocos: Bloco[]; onChange: (b: Bloco[]) => void; html: string }) {
  const [novo, setNovo] = useState<Bloco["tipo"]>("texto");
  const mover = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= blocos.length) return;
    const c = [...blocos];
    [c[i], c[j]] = [c[j], c[i]];
    onChange(c);
  };
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="space-y-3">
        {blocos.map((b, i) => (
          <div key={b.id} className="mke-card p-3">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>{ROTULO_BLOCO[b.tipo]}</span>
              <div className="ml-auto flex gap-1">
                <Botao variante="fantasma" aria-label="Subir bloco" onClick={() => mover(i, -1)} disabled={i === 0}>↑</Botao>
                <Botao variante="fantasma" aria-label="Descer bloco" onClick={() => mover(i, 1)} disabled={i === blocos.length - 1}>↓</Botao>
                <Botao variante="fantasma" aria-label="Duplicar bloco" onClick={() => onChange([...blocos.slice(0, i + 1), { ...b, id: blocoNovo(b.tipo).id }, ...blocos.slice(i + 1)])}>⧉</Botao>
                <Botao variante="fantasma" aria-label="Remover bloco" onClick={() => onChange(blocos.filter((x) => x.id !== b.id))}>✕</Botao>
              </div>
            </div>
            <EditarBloco b={b} onChange={(nb) => onChange(blocos.map((x) => (x.id === b.id ? nb : x)))} />
          </div>
        ))}
        <div className="flex gap-2">
          <Escolha value={novo} onChange={(e) => setNovo(e.target.value as Bloco["tipo"])} aria-label="Tipo de bloco" className="max-w-xs">
            {TIPOS.map((t) => <option key={t} value={t}>{ROTULO_BLOCO[t]}</option>)}
          </Escolha>
          <Botao onClick={() => onChange([...blocos.filter((b) => b.tipo !== "rodape"), blocoNovo(novo), ...blocos.filter((b) => b.tipo === "rodape" && novo !== "rodape")])}>
            + Adicionar bloco
          </Botao>
        </div>
      </div>
      <div className="lg:sticky lg:top-4 self-start">
        <div className="text-xs font-semibold mb-1" style={{ color: "var(--ink2)" }}>Prévia (como chega na caixa de entrada; variáveis aparecem cruas)</div>
        <iframe title="Prévia do e-mail" sandbox="" srcDoc={html} className="w-full rounded-xl" style={{ height: 640, border: "1px solid var(--line)", background: "#fff" }} />
      </div>
    </div>
  );
}
