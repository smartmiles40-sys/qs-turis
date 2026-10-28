// src/rel/vendas/NovaOportunidade.tsx
// -----------------------------------------------------------------------------
// Criar um cartão no Pipeline de vendas do Rel (0218). Usado pelo quadro (com
// busca de cliente), pela lista de Recompra e pela ficha do cliente (cliente já
// escolhido). Nada vai pro Comercial: o cliente fica com o Relacionamento.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { buscarClientes, type Cliente } from "../lib/clientes";
import { equipeRelacionamento, paraInputLocal, deInputLocal } from "../lib/pos";
import { criarOportunidade, PRODUTOS, type Oportunidade, type Origem } from "../lib/vendas";
import type { TipoItem } from "@/propostas/lib";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";

export default function NovaOportunidade({ aberto, onFechar, onCriada, cliente, viagemId, origem = "manual", sugestao }: {
  aberto: boolean;
  onFechar: () => void;
  onCriada: (o: Oportunidade) => void;
  /** Já escolhido (ficha/recompra). Sem ele, a tela pede pra buscar. */
  cliente?: { id: string; nome: string } | null;
  viagemId?: string | null;
  origem?: Origem;
  /** Texto inicial (ex.: "quer ir para: Japão" da pesquisa). */
  sugestao?: string | null;
}) {
  const { currentUser } = useQsAuth();
  const [busca, setBusca] = useState("");
  const [achados, setAchados] = useState<Cliente[]>([]);
  const [escolhido, setEscolhido] = useState<{ id: string; nome: string } | null>(null);
  const [titulo, setTitulo] = useState("");
  const [produto, setProduto] = useState<TipoItem | "">("");
  const [valor, setValor] = useState("");
  const [dono, setDono] = useState("");
  const [acao, setAcao] = useState("");
  const [acaoEm, setAcaoEm] = useState("");
  const [time, setTime] = useState<{ id: string; name: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    setEscolhido(cliente ?? null);
    setTitulo(sugestao ? `Quer ir para: ${sugestao}` : "");
    setProduto(""); setValor(""); setDono(currentUser?.id ?? ""); setErro(null);
    setAcao("Ligar pro cliente");
    const amanha = new Date(); amanha.setDate(amanha.getDate() + 1); amanha.setHours(10, 0, 0, 0);
    setAcaoEm(paraInputLocal(amanha.toISOString()));
    setBusca(""); setAchados([]);
    equipeRelacionamento().then(setTime).catch(() => setTime([]));
    // só ao ABRIR (o objeto `cliente` é recriado a cada render de quem chama)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  useEffect(() => {
    if (!aberto || escolhido || busca.trim().length < 2) { setAchados([]); return; }
    const t = setTimeout(() => { buscarClientes(busca, 8).then(setAchados).catch(() => setAchados([])); }, 250);
    return () => clearTimeout(t);
  }, [busca, escolhido, aberto]);

  async function criar() {
    if (!escolhido) { setErro("Escolha o cliente."); return; }
    if (titulo.trim().length < 3) { setErro("Conte o que o cliente quer: destino, época, produto."); return; }
    setSalvando(true); setErro(null);
    try {
      const o = await criarOportunidade({
        cliente_id: escolhido.id, viagem_id: viagemId ?? null, titulo, produto: produto || null,
        valor_estimado: valor ? Number(valor.replace(/\./g, "").replace(",", ".")) || null : null,
        dono_id: dono || null, origem, proxima_acao: acao, proxima_acao_em: deInputLocal(acaoEm),
      });
      onCriada(o);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui criar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal aberto={aberto} titulo="Nova oportunidade de venda" onFechar={onFechar} largura={560}
      rodape={<><Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao><Botao variante="primario" disabled={salvando} onClick={criar}>{salvando ? "Criando…" : "Criar no pipeline"}</Botao></>}>
      <div className="space-y-3">
        {escolhido ? (
          <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
            Cliente: <b style={{ color: "var(--ink)" }}>{escolhido.nome}</b>
            {!cliente && <button type="button" className="ml-2 underline text-[12px]" onClick={() => setEscolhido(null)}>trocar</button>}
          </p>
        ) : (
          <Campo rotulo="Cliente *">
            <Entrada value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome, telefone, CPF ou e-mail" autoFocus />
            {achados.length > 0 && (
              <ul className="mt-1 rel-card overflow-hidden">
                {achados.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="rel-linha w-full text-left px-3 py-2 text-[13px]" style={{ color: "var(--ink)" }}
                      onClick={() => setEscolhido({ id: c.id, nome: c.nome })}>{c.nome}</button>
                  </li>
                ))}
              </ul>
            )}
          </Campo>
        )}
        <Campo rotulo="O que o cliente quer? *">
          <Entrada value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Japão em março de 2027, casal" />
        </Campo>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo rotulo="Produto de interesse">
            <select className="rel-input" value={produto} onChange={(e) => setProduto(e.target.value as TipoItem | "")}>
              <option value="">Ainda não sei</option>
              {PRODUTOS.map((p) => <option key={p.id} value={p.id}>{p.emoji} {p.rotulo}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Valor estimado (R$)">
            <Entrada inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Ex.: 25000" />
          </Campo>
        </div>
        <Campo rotulo="Dono (quem vai vender)">
          <select className="rel-input" value={dono} onChange={(e) => setDono(e.target.value)}>
            <option value="">Sem dono por enquanto</option>
            {time.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === currentUser?.id ? " (eu)" : ""}</option>)}
          </select>
        </Campo>
        <div className="grid sm:grid-cols-[1fr_200px] gap-3">
          <Campo rotulo="Próxima ação"><Entrada value={acao} onChange={(e) => setAcao(e.target.value)} /></Campo>
          <Campo rotulo="Quando"><Entrada type="datetime-local" value={acaoEm} onChange={(e) => setAcaoEm(e.target.value)} /></Campo>
        </div>
        <p className="text-[12px]" style={{ color: "var(--ink3)" }}>Na hora da próxima ação, o dono recebe um lembrete no sino.</p>
        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
