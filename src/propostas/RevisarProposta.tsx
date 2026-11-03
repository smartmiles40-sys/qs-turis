// src/propostas/RevisarProposta.tsx
// -----------------------------------------------------------------------------
// Passo 2 da proposta (0290, Bruno 03/11/2026: "a parte do PDF ficou com muita
// coisa… quem for fazer vai ficar um pouco perdida"). Mostra SÓ o que importa:
//   1. o que conferir (o que a IA pediu, conflitos com o que você editou) e o
//      que falta preencher — em destaque, no topo;
//   2. a viagem (destino, datas, passageiros);
//   3. um resumo por seção (voos, hotel, dia a dia, preços / serviços / planos),
//      fechado quando está tudo certo e aberto quando tem coisa pra olhar;
//   4. "Mais opções" (recolhido): os textos fixos do padrão, foto, apresentação,
//      trocar de modelo — já vêm prontos e só abre quem quiser mexer.
// -----------------------------------------------------------------------------
import { Entrada } from "@/rel/ui";
import { brl, tituloDaProposta, totaisDaOpcao, type OpcaoProposta, type Proposta } from "./lib";
import { MODELOS, SECOES, linhas, type Conteudo, type DiaPacote, type HotelPacote, type ModeloProposta, type SeguradoraModelo } from "./modelos";
import ModeloEditor, { Bloco, CampoTexto, CartoesPreco, EditorDias, EditorHoteis, EditorSeguro, EditorServicos, EscolherModelo, MarcaIa } from "./ModeloEditor";
import { marcarConferido, marcasDe, pendencias, veioDaIa, type SecaoIa } from "./iaMescla";

const numero = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")) || 0);

function CampoViagem({ rotulo, ia, falta, children }: { rotulo: string; ia?: boolean; falta?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="flex items-center gap-1.5 text-xs font-semibold mb-1.5" style={{ color: falta ? "var(--warn-ink)" : "var(--ink2)" }}>
        {rotulo}{ia && <MarcaIa />}{falta && <span className="font-normal">· falta</span>}
      </span>
      <div className="rounded-lg" style={falta ? { boxShadow: "0 0 0 2px var(--warn-line)" } : undefined}>{children}</div>
    </label>
  );
}

export default function RevisarProposta({ p, mudar, trocarModelo }: {
  p: Proposta;
  mudar: (c: Partial<Proposta>) => void;
  trocarModelo: (m: ModeloProposta | null) => void;
}) {
  const modelo = p.modelo!;
  const c = p.conteudo;
  const setC = (x: Partial<Conteudo>) => mudar({ conteudo: { ...c, ...x } });
  const onOpcoes = (opcoes: OpcaoProposta[]) => mudar({ opcoes });
  const marcas = marcasDe(p);
  const conferir = marcas?.conferir ?? [];
  const falta = pendencias(p);
  const faltaTxt = new Set(falta.map((x) => x.texto));
  const alerta = (s: SecaoIa) => conferir.filter((x) => x.secao === s).length + falta.filter((x) => x.secao === s).length;
  const daIa = (s: SecaoIa) => !!marcas?.secoes?.includes(s);
  const campo = (chave: string) => SECOES[modelo].flatMap((s) => s.campos).find((f) => f.chave === chave)!;
  const texto = (chave: string) => <CampoTexto key={chave} c={campo(chave)} valor={c[chave]} onChange={(v) => setC({ [chave]: v })} />;
  const conferirDa = (s: SecaoIa) => {
    const l = conferir.map((x, n) => ({ x, n })).filter(({ x }) => x.secao === s);
    const f = falta.filter((x) => x.secao === s);
    if (!l.length && !f.length) return null;
    return (
      <ul className="rounded-lg px-3 py-2 space-y-1 text-[12.5px]" style={{ background: "var(--warn-bg)", color: "var(--warn-ink)" }}>
        {f.map((x, k) => <li key={`f${k}`}>• Falta: <b>{x.texto}</b></li>)}
        {l.map(({ x, n }) => <li key={n}>• <b>{x.campo}</b>: {x.motivo}</li>)}
      </ul>
    );
  };

  // resumos de uma linha (seção fechada)
  const nVoos = linhas(c.voos).filter((l) => !/^[#>]/.test(l)).length;
  const hoteis = ((c.hoteis ?? []) as HotelPacote[]).filter((h) => h.nome.trim());
  const dias = (c.dias ?? []) as DiaPacote[];
  const resumoPrecos = p.opcoes.map((o) => `${o.extra?.rotulo || o.titulo || "Preço"}: ${brl(totaisDaOpcao(o).total)}`).join(" · ");
  const itensServ = p.opcoes[0]?.itens ?? [];
  const segs = ((c.seguradoras ?? []) as SeguradoraModelo[]).filter((s) => s.nome.trim());

  return (
    <div className="space-y-3">
      {/* 1 · O que olhar */}
      {(conferir.length > 0 || falta.length > 0) ? (
        <section className="rounded-xl px-4 py-3 space-y-2" style={{ background: "var(--warn-bg)", border: "1px solid var(--warn-line)" }}>
          <p className="text-[14px] font-bold" style={{ color: "var(--warn-ink)" }}>
            {[conferir.length && `${conferir.length} pra conferir`, falta.length && `${falta.length} faltando`].filter(Boolean).join(" · ")}
          </p>
          {falta.length > 0 && <p className="text-[13px]" style={{ color: "var(--warn-ink)" }}>Falta: {falta.map((x) => x.texto).join(", ")}.</p>}
          {conferir.length > 0 && (
            <ul className="space-y-1.5">
              {conferir.map((x, n) => (
                <li key={n} className="flex items-start gap-2 text-[13px]" style={{ color: "var(--warn-ink)" }}>
                  <span className="flex-1"><b>{x.campo}</b>: {x.motivo}</span>
                  <button type="button" className="text-[12px] font-semibold underline-offset-2 hover:underline" onClick={() => mudar(marcarConferido(p, n))}>ok, conferi</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : marcas ? (
        <p className="text-[13px] px-1" style={{ color: "var(--rel-ink)" }}>Nada pendente: a IA preencheu e não tem nada pra conferir. Dê uma olhada no resumo e veja como o cliente vê.</p>
      ) : null}

      {/* 2 · A viagem */}
      <section className="rel-card p-4 space-y-3" style={alerta("viagem") ? { borderColor: "var(--warn-line)" } : undefined}>
        <h2 className="text-[15px] font-bold flex items-center gap-2" style={{ color: "var(--ink)" }}>A viagem {daIa("viagem") && <MarcaIa />}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <CampoViagem rotulo="Destino" ia={veioDaIa(p, "viagem.destino", p.destino)} falta={faltaTxt.has("Destino (ou título)")}>
            <Entrada value={p.destino} placeholder="Ex.: Cancún" onChange={(e) => mudar({ destino: e.target.value })} />
          </CampoViagem>
          <CampoViagem rotulo="Nome do cliente" ia={veioDaIa(p, "viagem.cliente_nome", p.cliente_nome)} falta={faltaTxt.has("Nome do cliente")}>
            <Entrada value={p.cliente_nome} onChange={(e) => mudar({ cliente_nome: e.target.value })} />
          </CampoViagem>
          <div className="grid grid-cols-2 gap-3">
            <CampoViagem rotulo="Ida" ia={veioDaIa(p, "viagem.data_ida", p.data_ida)} falta={faltaTxt.has("Data da ida")}>
              <Entrada type="date" value={p.data_ida} onChange={(e) => mudar({ data_ida: e.target.value })} />
            </CampoViagem>
            <CampoViagem rotulo="Volta" ia={veioDaIa(p, "viagem.data_volta", p.data_volta)} falta={faltaTxt.has("Data da volta")}>
              <Entrada type="date" value={p.data_volta} onChange={(e) => mudar({ data_volta: e.target.value })} />
            </CampoViagem>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <CampoViagem rotulo="Adultos" ia={veioDaIa(p, "viagem.adultos", p.adultos)} falta={faltaTxt.has("Passageiros")}>
              <Entrada type="number" min={0} value={p.adultos} onChange={(e) => mudar({ adultos: Math.max(0, Math.floor(numero(e.target.value))) })} />
            </CampoViagem>
            <CampoViagem rotulo="Crianças" ia={veioDaIa(p, "viagem.criancas", p.criancas)}>
              <Entrada type="number" min={0} value={p.criancas} onChange={(e) => mudar({ criancas: Math.max(0, Math.floor(numero(e.target.value))) })} />
            </CampoViagem>
            <CampoViagem rotulo="Bebês" ia={veioDaIa(p, "viagem.bebes", p.bebes)}>
              <Entrada type="number" min={0} value={p.bebes} onChange={(e) => mudar({ bebes: Math.max(0, Math.floor(numero(e.target.value))) })} />
            </CampoViagem>
          </div>
          <div className="sm:col-span-2">
            <CampoViagem rotulo={`Título (vazio = "${tituloDaProposta({ ...p, titulo: "" })}")`} ia={veioDaIa(p, "viagem.titulo", p.titulo)}>
              <Entrada value={p.titulo} placeholder="Ex.: Cancún all inclusive" onChange={(e) => mudar({ titulo: e.target.value })} />
            </CampoViagem>
          </div>
        </div>
      </section>

      {/* 3 · Resumo por seção (o que muda de proposta pra proposta) */}
      {modelo === "pacote" && (
        <>
          <Bloco titulo="Voos" resumo={nVoos ? `${nVoos} trecho${nVoos === 1 ? "" : "s"}` : "Sem voos (a seção não aparece pro cliente)"} ia={daIa("voos")} alerta={alerta("voos")} abertoInicial={alerta("voos") > 0}>
            {conferirDa("voos")}
            {texto("voos")}{texto("voos_nota")}
            <details><summary className="text-[13px] font-semibold cursor-pointer" style={{ color: "var(--ink2)" }}>Rota e quadros da capa</summary><div className="space-y-3 mt-2">{texto("rota")}{texto("capa_quadros")}</div></details>
          </Bloco>
          <Bloco titulo="Hospedagem" resumo={hoteis.length ? hoteis.map((h) => h.nome).join(" · ") : "Nenhum hotel"} ia={daIa("hoteis")} alerta={alerta("hoteis")} abertoInicial={alerta("hoteis") > 0}>
            {conferirDa("hoteis")}
            <EditorHoteis hoteis={(c.hoteis ?? []) as HotelPacote[]} onChange={(h) => setC({ hoteis: h })} />
          </Bloco>
          <Bloco titulo="Dia a dia" resumo={dias.length ? `${dias.length} dia${dias.length === 1 ? "" : "s"}` : "Sem dia a dia (opcional)"} ia={daIa("dias")} alerta={alerta("dias")} abertoInicial={alerta("dias") > 0}>
            {conferirDa("dias")}
            <EditorDias dias={dias} inicio={p.data_ida} onChange={(d) => setC({ dias: d })} />
          </Bloco>
          <Bloco titulo="Investimento (preços)" resumo={resumoPrecos} ia={daIa("precos")} alerta={alerta("precos")} abertoInicial={alerta("precos") > 0 || !marcas}>
            {conferirDa("precos")}
            <CartoesPreco p={p} onOpcoes={onOpcoes} />
          </Bloco>
        </>
      )}
      {modelo === "servicos" && (
        <>
          <Bloco titulo="Serviços (valor por pessoa)" resumo={itensServ.length ? itensServ.map((i) => `${i.nome || "Serviço"}: ${i.incluso ? "incluso" : brl(i.valor_total)}`).join(" · ") : "Nenhum serviço"}
            ia={daIa("servicos")} alerta={alerta("servicos")} abertoInicial={alerta("servicos") > 0 || !marcas}>
            {conferirDa("servicos")}
            <EditorServicos p={p} onOpcoes={onOpcoes} />
          </Bloco>
          <Bloco titulo="Voos e roteiro" resumo={[c.ida && "ida", c.retorno && "retorno", linhas(c.roteiro).length && `${linhas(c.roteiro).filter((l) => !l.startsWith("#")).length} dias`].filter(Boolean).join(" · ") || "Sem voos nem roteiro (opcional)"}
            ia={daIa("voos") || daIa("dias")} alerta={alerta("voos") + alerta("dias")} abertoInicial={alerta("voos") + alerta("dias") > 0}>
            {conferirDa("voos")}{conferirDa("dias")}
            {texto("ida")}{texto("roteiro")}{texto("retorno")}
          </Bloco>
          <Bloco titulo="Pagamento" resumo={String(c.pagamento || "") || "Sem forma de pagamento"} ia={veioDaIa(p, "textos.pagamento", c.pagamento)} alerta={0}>
            {texto("pagamento")}
          </Bloco>
        </>
      )}
      {modelo === "seguro" && (
        <>
          <Bloco titulo="Seguradoras e planos" resumo={`${p.opcoes.length} plano${p.opcoes.length === 1 ? "" : "s"}${segs.length ? ` · ${segs.map((s) => s.nome).join(", ")}` : ""}`}
            ia={daIa("seguros")} alerta={alerta("seguros")} abertoInicial={alerta("seguros") > 0 || !marcas}>
            {conferirDa("seguros")}
            <EditorSeguro p={p} onOpcoes={onOpcoes} onConteudo={setC} />
          </Bloco>
          <Bloco titulo="Comparativo e condições" resumo={`${linhas(c.comparativo).filter((l) => l.split("|").slice(1).some((x) => x.trim())).length} coberturas lado a lado`} ia={veioDaIa(p, "textos.comparativo", c.comparativo)}>
            {texto("comparativo")}{texto("condicoes_pagamento")}{texto("validade")}
          </Bloco>
        </>
      )}

      {/* 4 · Mais opções (recolhido) */}
      <details className="rel-card">
        <summary className="px-4 py-3 text-[14px] font-bold cursor-pointer" style={{ color: "var(--ink2)" }}>
          Mais opções <span className="font-normal text-[12.5px]" style={{ color: "var(--ink3)" }}>— textos do padrão (já vêm prontos), foto, apresentação, modelo</span>
        </summary>
        <div className="border-t px-4 py-4 space-y-4" style={{ borderColor: "var(--line)" }}>
          <div className="grid sm:grid-cols-2 gap-3">
            <CampoViagem rotulo="Foto da capa (link da imagem)"><Entrada value={p.capa_url} placeholder="https://…" onChange={(e) => mudar({ capa_url: e.target.value })} /></CampoViagem>
            <label className="flex items-center gap-2 text-[13px] self-end pb-2" style={{ color: "var(--ink2)" }}>
              <input type="checkbox" checked={p.esconder_precos} onChange={(e) => mudar({ esconder_precos: e.target.checked })} />
              Esconder o preço de cada serviço
            </label>
          </div>
          <CampoViagem rotulo="Apresentação (texto de abertura pro cliente)">
            <textarea className="rel-input" rows={3} value={p.apresentacao} onChange={(e) => mudar({ apresentacao: e.target.value })} />
          </CampoViagem>
          <ModeloEditor p={p} mudar={mudar} />
          <div className="space-y-2 pt-2">
            <p className="text-[13px] font-semibold" style={{ color: "var(--ink2)" }}>Modelo: {MODELOS[modelo].rotulo}</p>
            <EscolherModelo atual={p.modelo} onEscolher={trocarModelo} />
          </div>
        </div>
      </details>
    </div>
  );
}
