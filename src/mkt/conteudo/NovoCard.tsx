// src/mkt/conteudo/NovoCard.tsx
// -----------------------------------------------------------------------------
// Criar um card (0240). Dois jeitos:
//   • "conteudo" — quem faz o conteúdo cria no quadro (coluna escolhida).
//   • "pedido"   — o Tráfego pede criativo/campanha/conteúdo pro Orgânico: cai na
//                  coluna de entrada, marcado como pedido, e o Orgânico recebe aviso.
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Aviso, Botao, Campo, Entrada, Modal } from "@/rel/ui";
import { useMkt } from "../contexto";
import { criarCard, erroDe, listarDestinos } from "./dados";
import { colunaAceitaCardNovo, colunaDeEntrada, lerTags } from "./regras";
import { NOME_ORIGEM, NOME_TIPO, TIPOS, type Coluna, type DestinoExp, type Origem, type TipoConteudo } from "./tipos";
import { SelectPessoa } from "./ui";

export default function NovoCard({ modo, colunas, colunaId, dataPublicacao, onFechar, onCriado }: {
  modo: "conteudo" | "pedido";
  colunas: Coluna[];
  /** Coluna pré-escolhida (o "+" de uma coluna do quadro). */
  colunaId?: string;
  /** Dia clicado no calendário. */
  dataPublicacao?: string;
  onFechar: () => void;
  onCriado: (id: string) => void;
}) {
  const { currentUser } = useQsAuth();
  const { meusPapeis } = useMkt();
  const pedido = modo === "pedido";
  const permitidas = useMemo(() => [...colunas].sort((a, b) => a.ordem - b.ordem).filter((k) => colunaAceitaCardNovo(k.tipo)), [colunas]);
  const entrada = colunaDeEntrada(colunas);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState<TipoConteudo>(pedido ? "criativo_anuncio" : "reels");
  // Quem é só do Tráfego cria como Tráfego; o resto, Orgânico.
  const [origem, setOrigem] = useState<Origem>(pedido || (meusPapeis.includes("trafego") && !meusPapeis.includes("organico")) ? "trafego" : "organico");
  const [coluna, setColuna] = useState<string>(colunaId && permitidas.some((k) => k.id === colunaId) ? colunaId : entrada?.id ?? "");
  const [responsavel, setResponsavel] = useState<string | null>(pedido ? null : currentUser?.id ?? null);
  const [prazo, setPrazo] = useState("");
  const [publicacao, setPublicacao] = useState(dataPublicacao ?? "");
  const [expedicao, setExpedicao] = useState("");
  const [destino, setDestino] = useState("");
  const [tags, setTags] = useState("");
  const [destinos, setDestinos] = useState<DestinoExp[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { listarDestinos().then(setDestinos).catch(() => setDestinos([])); }, []);

  async function criar() {
    if (!titulo.trim()) { setErro("Dê um título."); return; }
    const col = pedido ? entrada?.id : coluna;
    // 04/11/2026: a tela "Colunas do quadro" virou a aba Ajustes › Colunas (30/10).
    if (!col) { setErro("O quadro ainda não tem coluna de entrada (crie em Ajustes › Colunas)."); return; }
    setOcupado(true); setErro(null);
    try {
      const exp = destinos.find((d) => d.id === expedicao);
      const id = await criarCard({
        titulo: titulo.trim(), descricao: descricao.trim() || null, tipo, origem: pedido ? "trafego" : origem, coluna_id: col,
        eh_pedido: pedido, solicitante_id: pedido ? currentUser?.id ?? null : null, responsavel_id: responsavel,
        prazo: prazo || null, data_publicacao: publicacao || null, expedicao_id: exp?.id ?? null,
        destino: destino.trim() || exp?.destino || exp?.nome || null, tags: lerTags(tags), ordem: -Date.now() / 1000,
      });
      onCriado(id);
    } catch (e) { setErro(erroDe(e)); setOcupado(false); }
  }

  return (
    <Modal aberto titulo={pedido ? "Pedir ao Orgânico" : "Novo conteúdo"} onFechar={onFechar} largura={640}
      rodape={<>
        <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
        <Botao variante="primario" disabled={ocupado || !titulo.trim()} onClick={() => void criar()}>{pedido ? "Enviar pedido" : "Criar card"}</Botao>
      </>}>
      <div className="space-y-3">
        {pedido && (
          <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
            O pedido cai na coluna de entrada do quadro e o pessoal do Orgânico recebe o aviso. Antes de pedir, vale olhar a Biblioteca: pode já existir algo pronto pra reaproveitar.
          </p>
        )}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <Campo rotulo="Título">
          <Entrada autoFocus value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} placeholder={pedido ? "Ex.: Criativo Japão Outubro — remarketing" : "Ex.: Reels 5 motivos pra ir à Islândia"} />
        </Campo>
        <Campo rotulo={pedido ? "Briefing (objetivo, público, formato, referência)" : "Descrição / roteiro"}>
          <textarea className="rel-input" rows={4} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
        </Campo>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Campo rotulo="Tipo">
            <select className="rel-input" value={tipo} onChange={(e) => setTipo(e.target.value as TipoConteudo)}>
              {TIPOS.map((t) => <option key={t} value={t}>{NOME_TIPO[t]}</option>)}
            </select>
          </Campo>
          {!pedido && (
            <Campo rotulo="Área">
              <select className="rel-input" value={origem} onChange={(e) => setOrigem(e.target.value as Origem)}>
                {(["organico", "trafego"] as Origem[]).map((o) => <option key={o} value={o}>{NOME_ORIGEM[o]}</option>)}
              </select>
            </Campo>
          )}
          {!pedido && (
            <Campo rotulo="Etapa">
              <select className="rel-input" value={coluna} onChange={(e) => setColuna(e.target.value)}>
                {permitidas.map((k) => <option key={k.id} value={k.id}>{k.nome}</option>)}
              </select>
            </Campo>
          )}
          <Campo rotulo={pedido ? "Pra quem (opcional)" : "Responsável"}>
            <SelectPessoa valor={responsavel} onMudar={setResponsavel} vazio={pedido ? "O Orgânico decide" : "Ninguém"} />
          </Campo>
          <Campo rotulo={pedido ? "Precisa até" : "Prazo"}><Entrada type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></Campo>
          <Campo rotulo="Data de publicação"><Entrada type="date" value={publicacao} onChange={(e) => setPublicacao(e.target.value)} /></Campo>
          <Campo rotulo="Expedição / pacote">
            <select className="rel-input" value={expedicao} onChange={(e) => setExpedicao(e.target.value)}>
              <option value="">Nenhum</option>
              {destinos.map((d) => <option key={d.id} value={d.id}>{d.nome}{d.tipo === "pacote" ? " (pacote)" : ""}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Destino"><Entrada value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Ex.: Japão" /></Campo>
          <div className="sm:col-span-2">
            <Campo rotulo="Temas (tags)" dica="Separe por vírgula."><Entrada value={tags} onChange={(e) => setTags(e.target.value)} placeholder="cultura, depoimento, bastidores" /></Campo>
          </div>
        </div>
      </div>
    </Modal>
  );
}
