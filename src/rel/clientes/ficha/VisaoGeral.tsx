// src/rel/clientes/ficha/VisaoGeral.tsx
// -----------------------------------------------------------------------------
// Aba "Visão geral" da ficha (spec 29/10): Documentos, Endereço, Viagem (com a
// trilha Venda → Contrato → Pagamento → Documentos → Embarque) e os 4 últimos
// eventos da linha do tempo.
//
// Endereço fica em LEITURA; o formulário só abre no clique e é o MESMO cadastro
// único de todos os setores (CadastroPessoa, 0213) — CEP preenche rua, bairro,
// cidade e UF pelo ViaCEP, como já era.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Btn, Card, StatusChip, Timeline, type TimelineItem } from "@/components/ui";
import CadastroPessoa from "@/clientes/cadastro/CadastroPessoa";
import type { Pessoa } from "@/clientes/cadastro";
import { formatarCpf, formatarData, mesesParaVencer, type Cliente } from "../../lib/clientes";
import { cpfMascarado, type EnderecoResumo } from "./ProntaParaEmbarcar";
import type { ProximaViagem, TomEtapa } from "./dados";

export function resumoEndereco(p: Pessoa | null): EnderecoResumo | null {
  if (!p) return null;
  const partes = [
    [p.endereco_rua, p.endereco_numero].filter(Boolean).join(", ") + (p.endereco_complemento ? ` – ${p.endereco_complemento}` : ""),
    p.endereco_bairro,
    [p.endereco_cidade, p.endereco_estado].filter(Boolean).join("/"),
    p.endereco_cep ? `CEP ${p.endereco_cep.replace(/^(\d{5})(\d{3})$/, "$1-$2")}` : null,
  ].map((x) => (x ?? "").trim()).filter(Boolean);
  return { linha: partes.length ? partes.join(" · ") : null, completo: !!(p.endereco_rua && p.endereco_numero && p.endereco_cidade && p.endereco_cep) };
}

const TOM_CHIP: Record<TomEtapa, "ok" | "warn" | "danger" | "neutral"> = { ok: "ok", warn: "warn", danger: "danger", neutral: "neutral" };

function Documentos({ c, onSubirFoto, semFoto }: { c: Cliente; onSubirFoto: () => void; semFoto: boolean | null }) {
  const [verCpf, setVerCpf] = useState(false);
  const meses = mesesParaVencer(c.passaporte_validade);
  const falta = <StatusChip tone="warn">Faltando</StatusChip>;
  return (
    <Card title="Documentos">
      <dl className="fc-dl fc-dl--grade">
        <div className="fc-dl__r">
          <dt>CPF</dt>
          <dd>
            {c.cpf ? (
              <span className="fc-inline">
                <span className="qs-num">{verCpf ? formatarCpf(c.cpf) : cpfMascarado(c.cpf)}</span>
                <button type="button" className="fc-link fc-link--btn" onClick={() => setVerCpf((v) => !v)} aria-pressed={verCpf}>
                  {verCpf ? "Ocultar" : "Mostrar"}
                </button>
              </span>
            ) : falta}
          </dd>
        </div>
        <div className="fc-dl__r"><dt>Nascimento</dt><dd>{c.nascimento ? formatarData(c.nascimento) : falta}</dd></div>
        <div className="fc-dl__r"><dt>Passaporte</dt><dd>{c.passaporte || falta}</dd></div>
        <div className="fc-dl__r">
          <dt>Validade</dt>
          <dd>
            {c.passaporte_validade ? (
              <span className="fc-inline">
                {formatarData(c.passaporte_validade)}
                {meses !== null && meses < 0 && <StatusChip tone="danger">Vencido</StatusChip>}
                {meses !== null && meses >= 0 && meses < 6 && <StatusChip tone="warn">Vence em menos de 6 meses</StatusChip>}
              </span>
            ) : falta}
          </dd>
        </div>
      </dl>
      <div className={`fc-upload${semFoto ? " fc-upload--falta" : ""}`}>
        <span className="fc-upload__tx">
          <span className="fc-bloco__t">Foto do passaporte</span>
          <span className="fc-bloco__s">{semFoto ? "Ao subir a foto, número e validade são lidos sozinhos" : "Enviada — confira e troque na aba Documentos"}</span>
        </span>
        <Btn size="sm" onClick={onSubirFoto}>{semFoto ? "Subir foto" : "Ver documentos"}</Btn>
      </div>
    </Card>
  );
}

function Endereco({ clienteId, pessoa, bloqueado, onPedir, pedindo, onMudou }: {
  clienteId: string; pessoa: Pessoa | null | undefined; bloqueado: boolean; onPedir: () => void; pedindo: "nao" | "pedindo" | "pedido"; onMudou: () => void;
}) {
  const [editando, setEditando] = useState(false);
  const r = resumoEndereco(pessoa ?? null);
  const podeEditar = !bloqueado && !!pessoa?.pode_editar;
  return (
    <Card title="Endereço" action={pessoa && !r?.completo && !editando ? <StatusChip tone="warn">{r?.linha ? "Incompleto" : "Faltando"}</StatusChip> : undefined}>
      {pessoa === undefined ? <p className="fc-p">Carregando…</p>
        : pessoa === null ? <p className="fc-p">O cadastro único (0213) não respondeu — o endereço aparece aqui quando voltar.</p>
          : editando ? (
            <div>
              <CadastroPessoa clienteId={clienteId} secoes={["endereco"]} embutido onMudou={() => onMudou()} />
              <div className="fc-acoes" style={{ marginTop: 10 }}><Btn size="sm" variant="ghost" onClick={() => setEditando(false)}>Fechar</Btn></div>
            </div>
          ) : r?.linha ? (
            <>
              <p className="fc-endereco">{r.linha}</p>
              {podeEditar && (
                <div className="fc-acoes" style={{ marginTop: 10 }}>
                  <Btn size="sm" onClick={() => setEditando(true)}>Editar endereço</Btn>
                  {!r.completo && <Btn size="sm" variant="ghost" onClick={onPedir} disabled={pedindo !== "nao"}>{pedindo === "pedido" ? "Pedido ✓" : "Pedir à cliente"}</Btn>}
                </div>
              )}
            </>
          ) : (
            <>
              <p className="fc-p">Ainda não temos o endereço. Ele entra no contrato e é usado para envio de kits e encomendas.</p>
              {podeEditar && (
                <div className="fc-acoes" style={{ marginTop: 10 }}>
                  <Btn size="sm" onClick={() => setEditando(true)}>Adicionar endereço</Btn>
                  <Btn size="sm" onClick={onPedir} disabled={pedindo !== "nao"}>{pedindo === "pedido" ? "Pedido ✓" : pedindo === "pedindo" ? "Pedindo…" : "Pedir à cliente"}</Btn>
                </div>
              )}
            </>
          )}
    </Card>
  );
}

function ViagemCard({ proxima, etapas, onVerViagens }: { proxima: ProximaViagem | null; etapas: { rotulo: string; tom: TomEtapa; dica: string }[]; onVerViagens: () => void }) {
  return (
    <Card title="Viagem" action={<button type="button" className="fc-link fc-link--btn" onClick={onVerViagens}>Ver todas as viagens</button>}>
      {proxima ? (
        <div className="fc-viagem">
          <span className="fc-viagem__n">{proxima.nome}</span>
          <span className="fc-viagem__s">
            {[proxima.grupo, `${formatarData(proxima.ida)}${proxima.volta ? ` a ${formatarData(proxima.volta)}` : ""}`].filter(Boolean).join(" · ")}
          </span>
        </div>
      ) : <p className="fc-p">Nenhuma viagem à frente. As viagens que já aconteceram estão na aba Viagens.</p>}
      {proxima && (
        <ol className="fc-trilha" aria-label="Etapas da viagem">
          {etapas.map((e) => (
            <li key={e.rotulo} title={e.dica}>
              <StatusChip tone={TOM_CHIP[e.tom]}>{e.rotulo}</StatusChip>
              <span className="fc-trilha__d">{e.dica}</span>
            </li>
          ))}
        </ol>
      )}
      {/* ENCAIXAR: <ContratoDoCliente clienteId={clienteId} /> — o componente de contrato por cliente
          (feito à parte). Quando existir, a etapa "Contrato" da trilha passa a ler dele
          (statusDaViagem(..., contrato) em dados.ts já aceita esse status). */}
    </Card>
  );
}

export default function VisaoGeral(p: {
  c: Cliente; pessoa: Pessoa | null | undefined; semFoto: boolean | null; bloqueado: boolean;
  proxima: ProximaViagem | null; etapas: { rotulo: string; tom: TomEtapa; dica: string }[];
  timeline: TimelineItem[];
  pedirEndereco: () => void; pedindoEndereco: "nao" | "pedindo" | "pedido";
  onIrAba: (aba: "documentos" | "viagens" | "historico") => void; onMudou: () => void;
}) {
  return (
    <div className="fc-geral">
      <div className="fc-geral__2">
        <Documentos c={p.c} semFoto={p.semFoto} onSubirFoto={() => p.onIrAba("documentos")} />
        <Endereco clienteId={p.c.id} pessoa={p.pessoa} bloqueado={p.bloqueado} onPedir={p.pedirEndereco} pedindo={p.pedindoEndereco} onMudou={p.onMudou} />
      </div>
      <ViagemCard proxima={p.proxima} etapas={p.etapas} onVerViagens={() => p.onIrAba("viagens")} />
      <Card title="Linha do tempo" action={<button type="button" className="fc-link fc-link--btn" onClick={() => p.onIrAba("historico")}>Histórico completo</button>}>
        <Timeline items={p.timeline.slice(0, 4)} />
      </Card>
    </div>
  );
}
