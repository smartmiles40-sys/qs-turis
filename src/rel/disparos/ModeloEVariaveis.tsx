// src/rel/disparos/ModeloEVariaveis.tsx
// Escolher o modelo aprovado e dizer de onde vem cada {{n}} — usado na
// campanha e na automação. A prévia mostra como o cliente vai ler.
import { useEffect, useState } from "react";
import { listarModelos, type Modelo } from "../lib/whatsapp";
import { FONTES, preverTexto, variaveisDoCorpo, type Fonte, type MapaVariaveis } from "../lib/disparos";
import { Aviso, Campo, Entrada } from "../ui";

export function useModelos() {
  const [modelos, setModelos] = useState<Modelo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    listarModelos()
      .then((l) => setModelos(l.filter((m) => !m.precisaMidia)))
      .catch((e) => { setModelos([]); setErro(e instanceof Error ? e.message : "Não consegui ler os modelos."); });
  }, []);
  return { modelos, erro };
}

/** Mapa inicial: {{1}} = primeiro nome, o resto em branco (texto fixo). */
export function mapaPadrao(corpo: string, atual: MapaVariaveis = {}): MapaVariaveis {
  const out: MapaVariaveis = {};
  for (const v of variaveisDoCorpo(corpo)) out[v] = atual[v] ?? (v === "1" ? { fonte: "nome" } : { fonte: "texto", valor: "" });
  return out;
}

export default function ModeloEVariaveis({ modelos, erro, modeloNome, modeloIdioma, mapa, onModelo, onMapa, fontesProibidas = [] }: {
  modelos: Modelo[] | null;
  erro: string | null;
  modeloNome: string;
  modeloIdioma: string;
  mapa: MapaVariaveis;
  onModelo: (m: Modelo) => void;
  onMapa: (m: MapaVariaveis) => void;
  /** Ex.: aniversário não tem viagem → sem destino/data/link da pesquisa. */
  fontesProibidas?: Fonte[];
}) {
  const escolhido = modelos?.find((m) => m.nome === modeloNome && m.idioma === modeloIdioma) ?? null;
  const fontes = FONTES.filter((f) => !fontesProibidas.includes(f.id));

  if (modelos === null) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando modelos aprovados…</p>;

  return (
    <div className="space-y-3">
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {modelos.length === 0 && !erro && (
        <Aviso>
          Nenhum modelo aprovado no número do Relacionamento. Crie em <b>Comercial → Configurações → Modelos da Meta →
          "Mensagens de: Relacionamento"</b> e espere a Meta aprovar.
        </Aviso>
      )}
      {modelos.length > 0 && (
        <Campo rotulo="Modelo aprovado">
          <select
            className="rel-input"
            value={escolhido ? `${escolhido.nome}|${escolhido.idioma}` : ""}
            onChange={(e) => {
              const m = modelos.find((x) => `${x.nome}|${x.idioma}` === e.target.value);
              if (m) { onModelo(m); onMapa(mapaPadrao(m.corpo, mapa)); }
            }}
          >
            <option value="">Escolha…</option>
            {modelos.map((m) => <option key={`${m.nome}|${m.idioma}`} value={`${m.nome}|${m.idioma}`}>{m.nome}{m.categoria ? ` · ${m.categoria.toLowerCase()}` : ""}</option>)}
          </select>
        </Campo>
      )}
      {escolhido && (
        <>
          {variaveisDoCorpo(escolhido.corpo).map((v) => {
            const cfg = mapa[v] ?? { fonte: "texto" as Fonte, valor: "" };
            return (
              <div key={v} className="grid grid-cols-1 sm:grid-cols-[90px_1fr_1fr] gap-2 items-center">
                <span className="text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>{`{{${v}}}`}</span>
                <select className="rel-input" value={cfg.fonte} onChange={(e) => onMapa({ ...mapa, [v]: { fonte: e.target.value as Fonte, valor: cfg.valor } })}>
                  {fontes.map((f) => <option key={f.id} value={f.id}>{f.rotulo}</option>)}
                </select>
                {cfg.fonte === "texto"
                  ? <Entrada value={cfg.valor ?? ""} placeholder="Escreva o texto" onChange={(e) => onMapa({ ...mapa, [v]: { fonte: "texto", valor: e.target.value } })} />
                  : <span className="text-[12px]" style={{ color: "var(--ink3)" }}>ex.: {FONTES.find((f) => f.id === cfg.fonte)?.dica}</span>}
              </div>
            );
          })}
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Como o cliente vai ler</p>
            <div className="rounded-2xl px-3 py-2 text-[14px] whitespace-pre-wrap" style={{ background: "var(--wa-soft)", color: "var(--wa-ink)" }}>
              {preverTexto(escolhido.corpo, mapa)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Tudo preenchido? (texto fixo vazio = não) */
export function mapaCompleto(corpo: string | undefined, mapa: MapaVariaveis) {
  if (!corpo) return false;
  return variaveisDoCorpo(corpo).every((v) => mapa[v] && (mapa[v].fonte !== "texto" || (mapa[v].valor ?? "").trim()));
}
