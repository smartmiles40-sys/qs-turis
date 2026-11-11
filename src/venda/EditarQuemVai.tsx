// src/venda/EditarQuemVai.tsx
// -----------------------------------------------------------------------------
// "QUEM VAI" NO CARTÃO DO CLOSER (sprint final, decisão 1 do Bruno — 11/11/2026):
// o closer cadastra quem vai junto AINDA EM NEGOCIAÇÃO, direto no cartão.
//   salvar → venda_familia_salvar (cria a venda em "negociação" se não existir;
//            quem sai = passageiro cancelado, a vaga volta)
//          → POST /api/closer {acao:'espelhar'} (cada pessoa ganha o card filho no
//            Bitrix, na mesma coluna do pai).
// O titular não aparece pra editar: é o cliente do cartão (a RPC sempre põe).
// Regras puras: ./vendaFinal (problemaQuemVai, familiaParaPayload).
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Aviso, Botao, Campo, Entrada, Modal } from "@/rel/ui";
import { espelharNoBitrix } from "@/closer/lib";
import { novaChave } from "@/propostas/lib";
import { salvarFamilia } from "./api";
import { VINCULOS_VIAJANTE, type VinculoViajante } from "./vendaRegras";
import { familiaParaPayload, problemaQuemVai, type PessoaQuemVai } from "./vendaFinal";
import type { PessoaFamilia } from "./familiaRegras";

const daFamilia = (p: PessoaFamilia): PessoaQuemVai => ({
  chave: p.id, pessoa_id: p.id, cliente_id: p.cliente_id, nome: p.nome ?? "",
  vinculo: ((p.vinculo ?? "") in VINCULOS_VIAJANTE ? p.vinculo : "") as VinculoViajante,
  cpf: p.cpf ?? "", nascimento: (p.nascimento ?? "").slice(0, 10), email: p.email ?? "", telefone: p.telefone ?? "", valor: p.valor,
});
const nova = (): PessoaQuemVai => ({ chave: novaChave(), nome: "", vinculo: "", cpf: "", nascimento: "", email: "", telefone: "" });

export default function EditarQuemVai({ negocioId, titular, pessoas, onFechar, onSalvo }: {
  negocioId: string;
  titular: string;
  /** Quem já está na pasta (venda_familia), sem o titular e sem quem já saiu. */
  pessoas: PessoaFamilia[];
  onFechar: () => void;
  onSalvo: (r: { tom: "ok" | "aviso"; t: string }) => void;
}) {
  const [lista, setLista] = useState<PessoaQuemVai[]>(() => {
    const l = pessoas.filter((p) => !p.comprador && !p.removida_em).map(daFamilia);
    return l.length ? l : [nova()];
  });
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const ativas = lista.filter((p) => !p.removida);
  const mudar = (chave: string, p: Partial<PessoaQuemVai>) => setLista((l) => l.map((x) => (x.chave === chave ? { ...x, ...p } : x)));
  // Quem já foi gravado sai marcado (a RPC cancela o passageiro); quem nunca foi gravado só some.
  const tirar = (x: PessoaQuemVai) => setLista((l) => (x.pessoa_id ? l.map((y) => (y.chave === x.chave ? { ...y, removida: true } : y)) : l.filter((y) => y.chave !== x.chave)));

  async function salvar() {
    // Linha nova totalmente em branco não conta.
    const limpa = lista.filter((p) => p.pessoa_id || p.removida || p.nome.trim() || p.vinculo || p.cpf.trim() || p.email.trim() || p.telefone.trim());
    const prob = problemaQuemVai(limpa);
    if (prob) { setErro(prob); return; }
    setErro(null); setSalvando(true);
    try {
      await salvarFamilia(familiaParaPayload(negocioId, limpa));
      const qtd = limpa.filter((p) => !p.removida).length;
      const b = await espelharNoBitrix(negocioId).catch((e: Error) => ({ ok: false, status: "erro", mensagem: e.message }));
      const base = qtd ? `Quem vai salvo: ${titular || "o titular"} + ${qtd} pessoa${qtd > 1 ? "s" : ""}.` : "Quem vai salvo: só o titular.";
      if (b && !b.ok && b.status === "erro") onSalvo({ tom: "aviso", t: `${base} Gravado no QS, mas o Bitrix recusou: ${b.mensagem ?? "sem motivo"}. O QS tenta de novo sozinho.` });
      else onSalvo({ tom: "ok", t: `${base}${qtd ? " Cada pessoa ganha o card dela no Bitrix, ligado ao do cliente." : ""}` });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto titulo="Quem vai nesta venda" onFechar={onFechar} largura={760}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar} disabled={salvando}>Cancelar</Botao>
        <Botao variante="primario" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar quem vai"}</Botao>
      </>}>
      <div className="space-y-3">
        <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
          Coloque quem vai junto com <b>{titular || "o cliente"}</b> (titular) — mesmo ainda em negociação. Cada pessoa ganha o card
          dela no Bitrix, ligado a este, e os dados já chegam no Subir venda e no contrato. CPF, nascimento e e-mail podem vir depois.
        </p>
        {ativas.map((p, n) => (
          <div key={p.chave} className="rounded-xl p-3" style={{ border: "1px solid var(--line)" }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[13.5px] font-bold flex-1" style={{ color: "var(--ink)" }}>Pessoa {n + 1}</span>
              <Botao variante="fantasma" onClick={() => tirar(p)}>Tirar</Botao>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Campo rotulo="Nome completo *"><Entrada value={p.nome} onChange={(e) => mudar(p.chave, { nome: e.target.value })} /></Campo>
              <Campo rotulo={`É o quê de ${titular || "quem comprou"}? *`}>
                <select className="rel-input" value={p.vinculo} onChange={(e) => mudar(p.chave, { vinculo: e.target.value as VinculoViajante })}>
                  <option value="">Escolha…</option>
                  {Object.entries(VINCULOS_VIAJANTE).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
                </select>
              </Campo>
              <Campo rotulo="CPF"><Entrada inputMode="numeric" placeholder="000.000.000-00" value={p.cpf} onChange={(e) => mudar(p.chave, { cpf: e.target.value })} /></Campo>
              <Campo rotulo="Nascimento"><Entrada type="date" value={p.nascimento} onChange={(e) => mudar(p.chave, { nascimento: e.target.value })} /></Campo>
              <Campo rotulo="E-mail"><Entrada type="email" value={p.email} onChange={(e) => mudar(p.chave, { email: e.target.value })} /></Campo>
              <Campo rotulo="WhatsApp"><Entrada inputMode="tel" value={p.telefone} onChange={(e) => mudar(p.chave, { telefone: e.target.value })} /></Campo>
            </div>
          </div>
        ))}
        <button type="button" className="text-[13px] font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => setLista((l) => [...l, nova()])}>
          + Adicionar pessoa
        </button>
        {lista.some((p) => p.removida) && (
          <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
            Saem ao salvar: {lista.filter((p) => p.removida).map((p) => p.nome || "sem nome").join(", ")} — se já tinham vaga na expedição, a vaga volta.{" "}
            <button type="button" className="underline" onClick={() => setLista((l) => l.map((x) => ({ ...x, removida: false })))}>desfazer</button>
          </p>
        )}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
