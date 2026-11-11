// src/venda/TrechosAereo.tsx
// -----------------------------------------------------------------------------
// Trechos do aéreo da venda — origem e destino SÓ com código IATA (Bruno 11/11/2026:
// "De: GRU para: Europa" não serve mais). Cada voo é um trecho: ida, volta,
// conexões e voos internos. Regras e formato gravado em src/venda/iata.ts.
//
// Campo de aeroporto com autocompletar: digita "lis" ou "Lisboa" → LIS · Lisboa.
// Texto livre ("Europa", "Itália") fica marcado em vermelho e bloqueia o
// "Consolidar venda" (Salvar/Reservar só avisam). Venda antiga com o texto
// escrito à mão aparece aqui convertida, com o que não deu pra entender pendente.
// -----------------------------------------------------------------------------
import { useId, useMemo, useState } from "react";
import { Aviso, Campo, Entrada } from "@/rel/ui";
import { CLASSES_VOO } from "@/propostas/lib";
import {
  avisosDoAereo, buscarAeroportos, comTrechos, lerIata, lerTrechos, problemasDoAereo, rotuloAeroporto, tipoDoTrecho, trechoVendaVazio,
  type SentidoTrecho, type TrechoVenda,
} from "./iata";

const SENTIDOS: Record<SentidoTrecho, string> = { ida: "Ida", volta: "Volta", interno: "Voo interno" };

/** Campo de UM aeroporto: aceita só código IATA (o texto livre fica pendente, em vermelho). */
function CampoIata({ rotulo, codigo, texto, onMudar }: {
  rotulo: string; codigo: string; texto?: string;
  onMudar: (p: { codigo: string; texto?: string }) => void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const opcoes = useMemo(() => (editando ? buscarAeroportos(editando) : []), [editando]);
  const leitura = codigo ? lerIata(codigo) : texto ? lerIata(texto) : null;
  const erro = !codigo && texto ? (leitura?.mensagem ?? "Use o código IATA de 3 letras.") : null;
  const aviso = codigo && leitura?.status === "fora_lista" ? leitura.mensagem : null;
  const mostrado = editando ?? (codigo ? rotuloAeroporto(codigo) : texto ?? "");

  function escolher(c: string) { onMudar({ codigo: c }); setEditando(null); setAberto(false); }
  function confirmar() {
    if (editando == null) return;
    const l = lerIata(editando);
    const igual = l.codigo ? l.codigo === codigo && !texto : l.status === "vazio" ? !codigo && !texto : !codigo && editando.trim() === (texto ?? "");
    if (igual) { setEditando(null); setAberto(false); return; } // nada mudou
    if (l.status === "vazio") onMudar({ codigo: "" });
    else if (l.codigo) onMudar({ codigo: l.codigo });
    else onMudar({ codigo: "", texto: editando.trim() });
    setEditando(null); setAberto(false);
  }

  return (
    <Campo rotulo={rotulo} erro={erro} dica={aviso ?? "Código do aeroporto (ex.: GRU, LIS, NRT)"}>
      <div className="relative">
        <Entrada value={mostrado} placeholder="Digite o código ou a cidade" autoComplete="off" role="combobox"
          aria-expanded={aberto && opcoes.length > 0} aria-controls={id} aria-invalid={!!erro}
          style={erro ? { borderColor: "var(--err-line)" } : undefined}
          onFocus={() => { setEditando(codigo || texto || ""); setAberto(true); }}
          onChange={(e) => { setEditando(e.target.value); setAberto(true); }}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); if (opcoes[0] && aberto) escolher(opcoes[0].codigo); else confirmar(); }
            if (e.key === "Escape") { setEditando(null); setAberto(false); }
          }} />
        {aberto && opcoes.length > 0 && (
          <ul id={id} role="listbox" className="absolute z-20 left-0 right-0 mt-1 rounded-lg border shadow-lg max-h-64 overflow-auto"
            style={{ background: "var(--card)", borderColor: "var(--line)" }}>
            {opcoes.map((o) => (
              <li key={o.codigo} role="option" aria-selected={o.codigo === codigo}>
                <button type="button" className="w-full text-left px-3 py-1.5 text-[13px] hover:opacity-80"
                  style={{ color: "var(--ink)" }}
                  onMouseDown={(e) => { e.preventDefault(); escolher(o.codigo); }}>
                  <b>{o.codigo}</b> · {o.cidade}{o.pais && o.pais !== "Brasil" ? `, ${o.pais}` : ""}
                  <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>{o.nome}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Campo>
  );
}

/** Editor dos trechos de um item (aéreo; pacote/outro "Inclui aéreo"). Guarda em dados.trechos (JSON texto). */
export default function TrechosAereo({ dados, dataIda, dataVolta, onDados }: {
  dados: Record<string, string>;
  dataIda?: string;
  dataVolta?: string;
  onDados: (d: Record<string, string>) => void;
}) {
  const trechos = useMemo(() => lerTrechos(dados), [dados]);
  const doTextoAntigo = !dados.trechos && !!dados.voos?.trim();
  const lista = trechos.length ? trechos : [trechoVendaVazio("ida", dataIda ?? "")];
  const problemas = problemasDoAereo(trechos);
  const avisos = avisosDoAereo(trechos);

  const gravar = (ts: TrechoVenda[]) => onDados(comTrechos(dados, ts.map((t) => ({ ...t, tipo: tipoDoTrecho(t, t.sentido === "interno") }))));
  const mudar = (n: number, p: Partial<TrechoVenda>) => gravar(lista.map((t, i) => (i === n ? { ...t, ...p } : t)));
  const lado = (n: number, qual: "origem" | "destino", v: { codigo: string; texto?: string }) => {
    const p: Partial<TrechoVenda> = qual === "origem"
      ? { origem_codigo: v.codigo, origem: "", origem_texto: v.codigo ? undefined : v.texto }
      : { destino_codigo: v.codigo, destino: "", destino_texto: v.codigo ? undefined : v.texto };
    mudar(n, p);
  };
  function adicionar(sentido: SentidoTrecho) {
    const ult = lista[lista.length - 1];
    const novo = trechoVendaVazio(sentido, sentido === "volta" ? dataVolta ?? "" : "");
    if (sentido === "volta") {
      // Volta = o caminho de ida ao contrário (o closer confere).
      const ida = lista.filter((t) => t.sentido === "ida");
      novo.origem_codigo = ida[ida.length - 1]?.destino_codigo ?? "";
      novo.destino_codigo = ida[0]?.origem_codigo ?? "";
    } else if (ult?.destino_codigo) novo.origem_codigo = ult.destino_codigo; // conexão / próximo voo sai de onde o anterior chegou
    gravar([...lista, novo]);
  }

  return (
    <div className="sm:col-span-2 space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold" style={{ color: "var(--ink2)" }}>Trechos do voo (código IATA do aeroporto)</span>
        <span className="text-[11px]" style={{ color: "var(--ink3)" }}>Um por voo: ida, volta, conexões e voos internos. Nada de "Europa" ou "Itália" — escolha o aeroporto.</span>
      </div>
      {doTextoAntigo && (
        <Aviso tom="aviso">
          Esta venda tinha os voos escritos à mão: <i>“{dados.voos}”</i>. Converti o que deu; confira e corrija o que estiver em vermelho.
        </Aviso>
      )}
      {lista.map((t, n) => (
        <div key={n} className="rounded-lg border p-3 grid grid-cols-2 sm:grid-cols-4 gap-2" style={{ borderColor: "var(--line)" }}>
          <div className="col-span-2 sm:col-span-4 flex items-center gap-2">
            <span className="text-[12.5px] font-bold" style={{ color: "var(--ink)" }}>Trecho {n + 1}</span>
            <select className="rel-input text-[12.5px]" style={{ width: "auto", paddingTop: 4, paddingBottom: 4 }} value={t.sentido} aria-label={`Sentido do trecho ${n + 1}`}
              onChange={(e) => mudar(n, { sentido: e.target.value as SentidoTrecho })}>
              {Object.entries(SENTIDOS).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
            </select>
            {t.tipo === "voo_interno" && t.sentido !== "interno" && <span className="text-[11px]" style={{ color: "var(--ink3)" }}>voo interno</span>}
            <span className="flex-1" />
            {lista.length > 1 && (
              <button type="button" className="text-[12px] font-semibold" style={{ color: "var(--ink3)" }}
                onClick={() => gravar(lista.filter((_, i) => i !== n))}>Tirar</button>
            )}
          </div>
          <CampoIata rotulo="Origem" codigo={t.origem_codigo} texto={t.origem_texto} onMudar={(v) => lado(n, "origem", v)} />
          <CampoIata rotulo="Destino" codigo={t.destino_codigo} texto={t.destino_texto} onMudar={(v) => lado(n, "destino", v)} />
          <Campo rotulo="Data"><Entrada type="date" value={t.data} onChange={(e) => mudar(n, { data: e.target.value })} /></Campo>
          <Campo rotulo="Saída"><Entrada type="time" value={t.hora_saida} onChange={(e) => mudar(n, { hora_saida: e.target.value })} /></Campo>
          <Campo rotulo="Chegada"><Entrada type="time" value={t.hora_chegada} onChange={(e) => mudar(n, { hora_chegada: e.target.value })} /></Campo>
          <Campo rotulo="Companhia"><Entrada value={t.companhia} placeholder="Ex.: LATAM" onChange={(e) => mudar(n, { companhia: e.target.value })} /></Campo>
          <Campo rotulo="Nº do voo"><Entrada value={t.numero} placeholder="Ex.: LA 8084" onChange={(e) => mudar(n, { numero: e.target.value.toUpperCase() })} /></Campo>
          <Campo rotulo="Classe">
            <select className="rel-input" value={t.classe} onChange={(e) => mudar(n, { classe: e.target.value })}>
              {["", ...CLASSES_VOO].map((c) => <option key={c} value={c}>{c || "Escolha…"}</option>)}
            </select>
          </Campo>
        </div>
      ))}
      <div className="flex flex-wrap gap-3">
        <button type="button" className="text-[12.5px] font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => adicionar("ida")}>+ Trecho / conexão</button>
        <button type="button" className="text-[12.5px] font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => adicionar("volta")}>+ Volta</button>
        <button type="button" className="text-[12.5px] font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => adicionar("interno")}>+ Voo interno</button>
      </div>
      {trechos.length > 0 && problemas.length > 0 && (
        <Aviso tom="erro">
          Falta o código IATA — sem isso a venda não consolida:
          <ul className="list-disc pl-5 mt-1">{problemas.map((p) => <li key={p}>{p.replace(/^Aéreo: /, "")}</li>)}</ul>
        </Aviso>
      )}
      {avisos.length > 0 && (
        <Aviso tom="aviso"><ul className="list-disc pl-5">{avisos.map((p) => <li key={p}>{p.replace(/^Aéreo: /, "")}</li>)}</ul></Aviso>
      )}
    </div>
  );
}
