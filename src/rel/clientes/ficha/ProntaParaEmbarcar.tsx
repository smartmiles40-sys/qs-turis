// src/rel/clientes/ficha/ProntaParaEmbarcar.tsx
// -----------------------------------------------------------------------------
// "Pronta para embarcar?" (spec 29/10): o anel com o % do cadastro e o checklist
// em dois grupos — Cadastro e Contrato e embarque.
// 30/10 (revisão): o anel usa a completude ÚNICA da ficha (completudeProximaViagem,
// a mesma do card "Cadastro" e da faixa) e "validade do passaporte" só fica feita
// se passa na regra dos 6 meses. Item faltando tem
// "Pedir", que vira solicitação pro Relacionamento ligada a esta ficha.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Btn, ChecklistItem, ProgressRing, StatusChip } from "@/components/ui";
import type { Setor } from "@/solicitacoes/lib";
import { formatarData, formatarTelefone, type Cliente } from "../../lib/clientes";
import { ITENS_PEDIVEIS, pedirItem, pedirTudo, type ItemPedivel } from "./pedirACliente";
import type { Completude } from "./regras";

/** "292.•••.•••-72" — só o começo e o fim. */
export function cpfMascarado(cpf: string | null | undefined): string {
  const d = (cpf ?? "").replace(/\D/g, "");
  if (d.length !== 11) return cpf ?? "";
  return `${d.slice(0, 3)}.•••.•••-${d.slice(9)}`;
}

export interface EnderecoResumo { linha: string | null; completo: boolean }

interface Item { chave: string; rotulo: string; feito: boolean; valor?: string | null; dica: string }

export function itensDoChecklist(c: Cliente, semFoto: boolean | null, endereco: EnderecoResumo | null, comp?: Completude): { cadastro: Item[]; contrato: Item[] } {
  const validade = comp?.itens.find((i) => i.chave === "passaporte_validade");
  const cadastro: Item[] = [
    { chave: "cpf", rotulo: "CPF", feito: !!c.cpf, valor: cpfMascarado(c.cpf), dica: "necessário para contrato e emissão" },
    { chave: "telefone", rotulo: "Telefone", feito: !!c.telefone, valor: formatarTelefone(c.telefone), dica: "WhatsApp para avisos da viagem" },
    { chave: "email", rotulo: "E-mail", feito: !!c.email, valor: c.email, dica: "para vouchers e contrato" },
    { chave: "nascimento", rotulo: "Data de nascimento", feito: !!c.nascimento, valor: formatarData(c.nascimento), dica: "necessária para emitir passagem" },
    { chave: "passaporte", rotulo: "Nº do passaporte", feito: !!c.passaporte, valor: c.passaporte, dica: "lido da foto do passaporte" },
    { chave: "passaporte_validade", rotulo: "Validade do passaporte", feito: validade ? validade.ok : !!c.passaporte_validade,
      valor: c.passaporte_validade ? `${formatarData(c.passaporte_validade)}${validade?.motivo ? ` · ${validade.motivo}` : ""}` : null, dica: "mínimo de 6 meses após a volta" },
    // semFoto null = a métrica não carregou: como antes, não conta como faltando
    { chave: "doc_passaporte", rotulo: "Foto do passaporte", feito: semFoto !== true, valor: semFoto === null ? "não deu pra conferir agora" : "enviada", dica: "frente legível, sem reflexo" },
  ];
  const contrato: Item[] = [
    { chave: "endereco", rotulo: "Endereço", feito: !!endereco?.completo, valor: endereco?.linha, dica: endereco?.linha ? `incompleto: ${endereco.linha}` : "entra no contrato e no envio de kits" },
    { chave: "lgpd", rotulo: "Consentimento LGPD", feito: !!c.lgpd_consentimento_em, valor: c.lgpd_consentimento_em ? `aceito em ${new Date(c.lgpd_consentimento_em).toLocaleDateString("pt-BR")}` : null, dica: "termo de uso de dados e comunicação" },
  ];
  return { cadastro, contrato };
}

type EstadoPedido = { [chave: string]: "pedindo" | "pedido" | undefined };

export default function ProntaParaEmbarcar({ c, nome, semFoto, endereco, deSetor, bloqueado, comp, onPreencher, onPedido }: {
  c: Cliente;
  /** Nome limpo (parseClientName). */
  nome: string;
  semFoto: boolean | null;
  endereco: EnderecoResumo | null;
  deSetor: Setor;
  /** Ficha juntada a outra: só leitura. */
  bloqueado?: boolean;
  /** a completude única da ficha (completudeProximaViagem) — o anel mostra o MESMO % do card */
  comp?: Completude;
  onPreencher: () => void;
  onPedido: () => void;
}) {
  const [estado, setEstado] = useState<EstadoPedido>({});
  const [msg, setMsg] = useState<{ tom: "ok" | "danger"; t: string } | null>(null);
  const { cadastro, contrato } = itensDoChecklist(c, semFoto, endereco, comp);
  const faltaCad = cadastro.filter((i) => !i.feito).length;
  const pct = comp ? comp.pct : Math.round(((cadastro.length - faltaCad) / cadastro.length) * 100);
  const faltando = [...cadastro, ...contrato].filter((i) => !i.feito);

  async function pedir(itens: ItemPedivel[], chaves: string[]) {
    setMsg(null);
    setEstado((e) => ({ ...e, ...Object.fromEntries(chaves.map((k) => [k, "pedindo"])) }));
    try {
      const n = itens.length;
      if (n === 1) await pedirItem({ clienteId: c.id, nome, deSetor, item: itens[0] });
      else await pedirTudo({ clienteId: c.id, nome, deSetor, itens });
      setEstado((e) => ({ ...e, ...Object.fromEntries(chaves.map((k) => [k, "pedido"])) }));
      setMsg({ tom: "ok", t: n === 1 ? "Pedido criado em Solicitações do Relacionamento." : `Pedido com ${n} itens criado em Solicitações do Relacionamento.` });
      onPedido();
    } catch (e) {
      setEstado((x) => ({ ...x, ...Object.fromEntries(chaves.map((k) => [k, undefined])) }));
      setMsg({ tom: "danger", t: e instanceof Error ? e.message : "Não consegui criar o pedido." });
    }
  }

  const botaoPedir = (i: Item) => {
    const st = estado[i.chave];
    if (bloqueado || !ITENS_PEDIVEIS[i.chave]) return null;
    if (st === "pedido") return <StatusChip tone="ok">Pedido</StatusChip>;
    return (
      <Btn size="sm" disabled={st === "pedindo"} aria-label={`Pedir ${i.rotulo.toLowerCase()} à cliente`}
        onClick={() => void pedir([ITENS_PEDIVEIS[i.chave]], [i.chave])}>
        {st === "pedindo" ? "Pedindo…" : "Pedir"}
      </Btn>
    );
  };

  const pendentesDePedir = faltando.filter((i) => ITENS_PEDIVEIS[i.chave] && estado[i.chave] !== "pedido");
  const grupo = (titulo: string, itens: Item[]) => (
    <div className="fc-grupo">
      <div className="fc-grupo__h">
        <span>{titulo}</span>
        <span className="qs-num">{itens.filter((i) => i.feito).length} de {itens.length}</span>
      </div>
      {itens.map((i) => (
        <ChecklistItem key={i.chave} label={i.rotulo} done={i.feito} value={i.valor} hint={i.dica} action={botaoPedir(i)} />
      ))}
    </div>
  );

  return (
    <section className="qs-card2" aria-labelledby="fc-pronta">
      <div className="fc-pronta__h">
        <div className="fc-pronta__tit">
          <ProgressRing value={pct} label={`Cadastro ${pct}% completo`} />
          <div>
            <h2 id="fc-pronta" className="fc-h2">Pronta para embarcar?</h2>
            <p className="fc-sub">
              {faltando.length === 0 ? "Tudo que a viagem pede está aqui." : `Falta${faltando.length > 1 ? "m" : ""} ${faltando.length} ite${faltando.length > 1 ? "ns" : "m"} entre cadastro, contrato e embarque`}
            </p>
          </div>
        </div>
        {!bloqueado && faltando.length > 0 && (
          <div className="fc-acoes">
            <Btn onClick={onPreencher}>Preencher agora</Btn>
            <Btn variant="positive" disabled={!pendentesDePedir.length || pendentesDePedir.some((i) => estado[i.chave] === "pedindo")}
              onClick={() => void pedir(pendentesDePedir.map((i) => ITENS_PEDIVEIS[i.chave]), pendentesDePedir.map((i) => i.chave))}>
              Pedir tudo à cliente
            </Btn>
          </div>
        )}
      </div>
      {msg && <p className={`fc-msg qs-tone-${msg.tom}`} role={msg.tom === "danger" ? "alert" : "status"}>{msg.t}</p>}
      <div className="fc-grupos">
        {grupo("Cadastro", cadastro)}
        {grupo("Contrato e embarque", contrato)}
      </div>
    </section>
  );
}
