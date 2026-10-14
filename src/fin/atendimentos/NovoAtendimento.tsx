// src/fin/atendimentos/NovoAtendimento.tsx
// -----------------------------------------------------------------------------
// "+ NOVO ATENDIMENTO" — o Financeiro chama o cliente por conta própria
// (Bruno, 14/10/2026: "eles podem chamar pelo número?").
//
// Busca a ficha (nome, CPF, telefone) ou aceita só o número; abre o atendimento
// com origem "Financeiro" e já cai no detalhe, onde fica o "Chamar no WhatsApp"
// (que manda um modelo aprovado — a única forma de puxar conversa com quem não
// escreveu nas últimas 24h).
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { Aviso, Botao, Campo, Entrada, Modal } from "../../rel/ui";
import { buscarClientes, formatarTelefone, type Cliente } from "../../rel/lib/clientes";
import { MOTIVO_FIN, enviarAoFinanceiro, type MotivoFin } from "../lib/atendimentos";

export default function NovoAtendimento({ aberto, onFechar, onCriado }: {
  aberto: boolean; onFechar: () => void; onCriado: (id: string) => void;
}) {
  const [termo, setTermo] = useState("");
  const [lista, setLista] = useState<Cliente[]>([]);
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const [motivo, setMotivo] = useState<MotivoFin>("cobranca");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setTermo(""); setLista([]); setCliente(null); setTelefone(""); setNome(""); setMotivo("cobranca"); setDescricao(""); setErro(null);
  }, [aberto]);
  useEffect(() => {
    if (!aberto || cliente || termo.trim().length < 3) { setLista([]); return; }
    const t = setTimeout(() => { buscarClientes(termo, 8).then(setLista).catch(() => setLista([])); }, 250);
    return () => clearTimeout(t);
  }, [termo, aberto, cliente]);

  const digitos = telefone.replace(/\D/g, "");
  // Só o número já basta (Bruno, 14/10: "chamar só digitando o número"). O
  // assunto é opcional — sem ele, fica o motivo no histórico.
  const pronto = cliente ? !!cliente.telefone : digitos.length >= 10;

  async function criar() {
    if (!pronto) return;
    setSalvando(true); setErro(null);
    try {
      const id = await enviarAoFinanceiro({
        origem: "financeiro", motivo, descricao: descricao.trim() || MOTIVO_FIN[motivo],
        clienteId: cliente?.id ?? null,
        telefone: cliente ? cliente.telefone : (telefone.trim().startsWith("+") ? telefone.trim() : digitos),
        nome: cliente ? cliente.nome : nome.trim() || null,
      });
      onCriado(id);
    } catch (e) { setErro(e instanceof Error ? e.message : "Não criou."); }
    finally { setSalvando(false); }
  }

  return (
    <Modal aberto={aberto} titulo="Novo atendimento" onFechar={onFechar} largura={520}
      rodape={<><Botao onClick={onFechar} disabled={salvando}>Cancelar</Botao><Botao variante="primario" onClick={() => void criar()} disabled={!pronto || salvando}>{salvando ? "Criando…" : "Escolher modelo e chamar →"}</Botao></>}>
      <div className="space-y-4">
        {!cliente ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Campo rotulo="Número do WhatsApp" dica="Com DDD. Basta isso pra chamar.">
                <Entrada value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="11 91234-5678" inputMode="tel" autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter" && pronto) void criar(); }} />
              </Campo>
              <Campo rotulo="Nome (opcional)"><Entrada value={nome} onChange={(e) => setNome(e.target.value)} /></Campo>
            </div>
            <Campo rotulo="Ou busque a ficha do cliente" dica="Nome, CPF ou telefone — puxa as viagens e valores dele.">
              <Entrada value={termo} onChange={(e) => setTermo(e.target.value)} placeholder="Buscar ficha" />
            </Campo>
            {lista.length > 0 && (
              <ul className="rel-card overflow-hidden -mt-2">
                {lista.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => { setCliente(c); setLista([]); }} className="rel-linha w-full text-left px-3 py-2 text-[13px] flex justify-between gap-2" style={{ color: "var(--ink)" }}>
                      <span className="font-semibold truncate">{c.nome}</span>
                      <span style={{ color: "var(--ink3)" }}>{formatarTelefone(c.telefone) || "sem telefone"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <div className="rel-card p-3 flex items-center gap-3">
            <span className="flex-1 min-w-0">
              <span className="block font-semibold text-[14px] truncate" style={{ color: "var(--ink)" }}>{cliente.nome}</span>
              <span className="block text-[12.5px]" style={{ color: "var(--ink3)" }}>{formatarTelefone(cliente.telefone) || "Ficha sem telefone"}</span>
            </span>
            <Botao variante="fantasma" onClick={() => setCliente(null)}>Trocar</Botao>
          </div>
        )}
        {cliente && !cliente.telefone && <Aviso tom="erro">Essa ficha não tem telefone — não dá pra chamar no WhatsApp. Peça pro Relacionamento completar a ficha.</Aviso>}
        <Campo rotulo="Motivo">
          <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoFin)} className="w-full h-10 rounded-lg px-3 border text-[14px]"
            style={{ borderColor: "var(--line)", background: "var(--card)", color: "var(--ink)" }}>
            {(Object.entries(MOTIVO_FIN) as [MotivoFin, string][]).map(([k, r]) => <option key={k} value={k}>{r}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Do que se trata (opcional)" dica="Fica no histórico do atendimento (o cliente não vê).">
          <Entrada value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: parcela de outubro em aberto" />
        </Campo>
        <p className="text-[12.5px]" style={{ color: "var(--ink3)" }}>
          No próximo passo você escolhe o modelo aprovado e completa os campos dele — é o único jeito de a Meta deixar chamar quem não escreveu nas últimas 24h.
        </p>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
