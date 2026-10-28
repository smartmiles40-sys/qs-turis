// src/clientes/cadastro/CadastroDoLead.tsx
// -----------------------------------------------------------------------------
// O cadastro do cliente a partir de um LEAD (SDR e Closer, 0213). O lead aponta pra
// pessoa (qs_leads.cliente_id). Três situações:
//   • já ligado            → mostra o CadastroPessoa;
//   • achei uma ficha com o mesmo telefone/e-mail → pergunta "é a mesma pessoa?"
//     (não liga sozinho: família divide celular);
//   • nada                 → botão "Começar o cadastro" (cria a ficha com nome,
//     telefone e e-mail do lead). Só cria quando alguém pede — abrir o lead não cria.
//
// modo="inline": o formulário direto na tela (ficha do lead do SDR).
// modo="cartao": uma linha com o que falta + botão que abre o formulário num modal
//                (painel do cartão do closer, coluna estreita).
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Aviso, Botao, Etiqueta, Modal } from "@/rel/ui";
import CadastroPessoa from "./CadastroPessoa";
import {
  CadastroInativo, buscarOuCriarPessoa, lerPessoa, ligarLeadAPessoa, oQueFalta, pessoaDoLead,
  type Pessoa, type PessoaDoLead,
} from "./api";

const CORES = `
.cadp-lead { --rel: #0E7C6A; --rel-hover: #0B6B5C; --rel-ink: #0B6B5C; --rel-soft: #E4F4EF; }
html.dark .cadp-lead { --rel-ink: #3CCFB3; --rel-soft: rgba(43, 192, 166, .14); }
`;

export default function CadastroDoLead({ leadId, modo = "inline", dataViagem }: { leadId: string; modo?: "inline" | "cartao"; dataViagem?: string | null }) {
  const [d, setD] = useState<PessoaDoLead | null>(null);
  const [estado, setEstado] = useState<"carregando" | "ok" | "inativo" | "erro">("carregando");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [resumo, setResumo] = useState<Pessoa | null>(null);
  const [modal, setModal] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await pessoaDoLead(leadId);
      setD(r); setEstado("ok"); setErro(null);
      if (r.clienteId && modo === "cartao") setResumo(await lerPessoa(r.clienteId).catch(() => null));
    } catch (e) {
      if (e instanceof CadastroInativo) { setEstado("inativo"); return; }
      setEstado("erro"); setErro(e instanceof Error ? e.message : "Não consegui abrir o cadastro.");
    }
  }, [leadId, modo]);
  useEffect(() => { setEstado("carregando"); void carregar(); }, [carregar]);

  async function rodar(fn: () => Promise<void>) {
    setOcupado(true); setErro(null);
    try { await fn(); await carregar(); } catch (e) { setErro(e instanceof Error ? e.message : "Não deu certo. Tente de novo."); }
    finally { setOcupado(false); }
  }

  const titulo = <p className="text-sm font-semibold mb-2" style={{ color: "var(--ink)" }}>Cadastro do cliente</p>;
  let conteudo: ReactNode;

  if (estado === "carregando") conteudo = <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Carregando o cadastro…</p>;
  else if (estado === "inativo") conteudo = <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>Cadastro do cliente: aguardando ativação no banco (0213).</p>;
  else if (estado === "erro" || !d) conteudo = <Aviso tom="erro">{erro ?? "Não consegui abrir o cadastro."}</Aviso>;
  else if (!d.clienteId) {
    conteudo = (
      <div className="space-y-2">
        {d.sugestao ? (
          <>
            <Aviso>
              Achei a ficha de <b>{d.sugestao.nome}</b> ({d.sugestao.motivo ?? "mesmos dados"}). É a mesma pessoa deste lead?
            </Aviso>
            <div className="flex flex-wrap gap-2">
              <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(() => ligarLeadAPessoa(leadId, d.sugestao!.id))}>Sim, usar esta ficha</Botao>
              <Botao disabled={ocupado} onClick={() => void rodar(async () => {
                const nova = await buscarOuCriarPessoa({ nome: d.lead.nome || "Sem nome", telefone: d.lead.telefone, email: d.lead.email }, { soCriar: true });
                if (nova) await ligarLeadAPessoa(leadId, nova.id);
              })}>Não, é outra pessoa</Botao>
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
              Ainda sem cadastro. Nome, nascimento, CPF, passaporte, endereço e quem viaja junto — o que você preencher aqui
              já vale pro Relacionamento e pro Operações.
            </p>
            <Botao variante="primario" disabled={ocupado} onClick={() => void rodar(async () => { await pessoaDoLead(leadId, { criar: true }); })}>
              {ocupado ? "Abrindo…" : "Começar o cadastro"}
            </Botao>
          </>
        )}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    );
  } else if (modo === "inline") {
    conteudo = <CadastroPessoa clienteId={d.clienteId} dataViagem={dataViagem} />;
  } else {
    const falta = oQueFalta(resumo);
    const n = resumo?.acompanhantes.length ?? 0;
    conteudo = (
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {resumo && (falta.length ? <Etiqueta tom="aviso">Falta {falta.length}</Etiqueta> : <Etiqueta tom="rel">Cadastro completo</Etiqueta>)}
          {n > 0 && <Etiqueta>+{n} viaja{n > 1 ? "m" : ""} junto</Etiqueta>}
        </div>
        {falta.length > 0 && <p className="text-[12px]" style={{ color: "var(--ink3)" }}>{falta.join(", ")}</p>}
        <Botao variante={falta.length ? "primario" : "secundario"} onClick={() => setModal(true)}>
          {falta.length ? "Preencher cadastro" : "Ver cadastro"}
        </Botao>
        <Modal aberto={modal} titulo={resumo?.nome ? `Cadastro · ${resumo.nome}` : "Cadastro do cliente"} largura={680}
          onFechar={() => { setModal(false); void carregar(); }}>
          <CadastroPessoa clienteId={d.clienteId} dataViagem={dataViagem} onMudou={setResumo} />
        </Modal>
      </div>
    );
  }

  return (
    <div className="cadp-lead">
      <style>{CORES}</style>
      {modo === "inline"
        ? <div className="rounded-xl p-5" style={{ background: "var(--card)", border: "1px solid var(--line)" }}>{titulo}{conteudo}</div>
        : conteudo}
    </div>
  );
}
