// src/rel/clientes/ClienteFicha.tsx
// -----------------------------------------------------------------------------
// A ficha do cliente: documentos, contato, família e o histórico de mudanças.
// É aqui que as próximas fases vão pendurar viagens, documentos e conversas.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import {
  PARENTESCOS, carregarCliente, carregarFamilia, carregarHistorico, formatarCpf, formatarData,
  formatarTelefone, idade, mesesParaVencer, type Auditoria, type Cliente,
} from "../lib/clientes";
import { Aviso, Avatar, Botao, Etiqueta } from "../ui";
import ClienteForm from "./ClienteForm";
import ModeloModal from "../atendimento/ModeloModal";
import { conversasDoCliente, duracao, horaCurta, type Conversa } from "../lib/whatsapp";

// Nomes amigáveis dos campos, pro histórico ler como gente.
const CAMPOS: Record<string, string> = {
  nome: "nome", cpf: "CPF", passaporte: "passaporte", passaporte_validade: "validade do passaporte",
  nascimento: "nascimento", telefone: "telefone", email: "e-mail", titular_id: "família",
  parentesco: "parentesco", bitrix_contato_id: "ID do Bitrix", observacoes: "observações",
  lgpd_consentimento_em: "consentimento LGPD", mesclado_em_id: "junção",
};

function mudancas(a: Auditoria): string {
  if (a.acao === "INSERT") return "criou a ficha";
  if (a.acao === "JUNTAR") return `juntou a ficha repetida de ${(a.antes?.nome as string) ?? "outra pessoa"} nesta`;
  if (a.acao === "DELETE") return "apagou a ficha";
  const antes = a.antes ?? {};
  const depois = a.depois ?? {};
  const campos = Object.keys(CAMPOS).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
  if (!campos.length) return "salvou sem mudanças";
  if (campos.includes("mesclado_em_id")) return "juntou esta ficha a outra";
  return `alterou ${campos.map((k) => CAMPOS[k]).join(", ")}`;
}

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-3 py-2">
      <dt className="text-[12px] sm:w-40 flex-shrink-0" style={{ color: "var(--ink3)" }}>{rotulo}</dt>
      <dd className="text-[14px] min-w-0 break-words" style={{ color: "var(--ink)" }}>{children || <span style={{ color: "var(--ink3)" }}>—</span>}</dd>
    </div>
  );
}

function Secao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="rel-card p-4 sm:p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink2)" }}>{titulo}</h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

export default function ClienteFicha({ id, onAbrir, onVoltar, onAbrirConversa }: {
  id: string; onAbrir: (id: string) => void; onVoltar: () => void; onAbrirConversa: (conversaId: string) => void;
}) {
  const [c, setC] = useState<Cliente | null>(null);
  const [titular, setTitular] = useState<Cliente | null>(null);
  const [familia, setFamilia] = useState<Cliente[]>([]);
  const [historico, setHistorico] = useState<Auditoria[]>([]);
  const [usuarios, setUsuarios] = useState<Record<string, string>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [novoFamiliar, setNovoFamiliar] = useState(false);
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [mandarModelo, setMandarModelo] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const cli = await carregarCliente(id);
      if (!cli) { setErro("Ficha não encontrada."); return; }
      setC(cli);
      setErro(null);
      const idTitular = cli.titular_id ?? cli.id;
      conversasDoCliente(cli.id).then(setConversas).catch(() => setConversas([]));
      const [tit, fam, hist] = await Promise.all([
        cli.titular_id ? carregarCliente(cli.titular_id) : Promise.resolve(null),
        carregarFamilia(idTitular),
        carregarHistorico(cli.id),
      ]);
      setTitular(tit);
      setFamilia(fam.filter((m) => m.id !== cli.id));
      setHistorico(hist);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui abrir a ficha.");
    }
  }, [id]);

  useEffect(() => { setC(null); void carregar(); }, [carregar]);

  useEffect(() => {
    supabase.from("qs_users").select("id, name").then(({ data }) => {
      setUsuarios(Object.fromEntries((data ?? []).map((u: { id: string; name: string }) => [u.id, u.name])));
    });
  }, []);

  if (erro) return <div className="max-w-3xl mx-auto"><Aviso tom="erro">{erro}</Aviso></div>;
  if (!c) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando ficha…</p>;

  const meses = mesesParaVencer(c.passaporte_validade);
  const anos = idade(c.nascimento);
  const ehTitular = !c.titular_id;
  const fone = c.telefone ?? "";

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onVoltar} className="inline-flex items-center gap-1 text-[13px] font-semibold" style={{ color: "var(--ink3)" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
        Clientes
      </button>

      {c.mesclado_em_id && (
        <Aviso>
          Esta ficha era repetida e foi juntada a outra.{" "}
          <button className="underline font-semibold" onClick={() => onAbrir(c.mesclado_em_id!)}>Abrir a ficha que ficou</button>
        </Aviso>
      )}

      {/* Cabeçalho */}
      <div className="rel-card p-4 sm:p-5 flex flex-wrap items-center gap-4">
        <Avatar nome={c.nome} tamanho={52} />
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold leading-tight" style={{ color: "var(--ink)" }}>{c.nome}</h1>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {anos !== null && <Etiqueta>{anos} anos</Etiqueta>}
            {c.titular_id && titular && <Etiqueta tom="rel">{PARENTESCOS[c.parentesco ?? "outro"]} de {titular.nome.split(" ")[0]}</Etiqueta>}
            {ehTitular && familia.length > 0 && <Etiqueta tom="rel">Titular · {familia.length} familiar{familia.length > 1 ? "es" : ""}</Etiqueta>}
            {c.lgpd_consentimento_em ? <Etiqueta tom="rel">LGPD ok</Etiqueta> : <Etiqueta tom="aviso">Sem consentimento LGPD</Etiqueta>}
          </div>
        </div>
        {!c.mesclado_em_id && <Botao onClick={() => setEditando(true)}>Editar</Botao>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Secao titulo="Documentos">
          <dl>
            <Linha rotulo="CPF">{c.cpf && formatarCpf(c.cpf)}</Linha>
            <Linha rotulo="Nascimento">{c.nascimento && formatarData(c.nascimento)}</Linha>
            <Linha rotulo="Passaporte">{c.passaporte}</Linha>
            <Linha rotulo="Validade">
              {c.passaporte_validade && (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {formatarData(c.passaporte_validade)}
                  {meses !== null && meses < 0 && <Etiqueta tom="erro">vencido</Etiqueta>}
                  {meses !== null && meses >= 0 && meses < 6 && <Etiqueta tom="aviso">vence em menos de 6 meses</Etiqueta>}
                </span>
              )}
            </Linha>
          </dl>
        </Secao>

        <Secao titulo="Contato">
          <dl>
            <Linha rotulo="Telefone">
              {fone && (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {formatarTelefone(fone)}
                  <a href={`https://wa.me/${fone}`} target="_blank" rel="noreferrer" className="text-[12px] font-semibold underline" style={{ color: "var(--rel-ink)" }}>WhatsApp</a>
                </span>
              )}
            </Linha>
            <Linha rotulo="E-mail">{c.email && <a href={`mailto:${c.email}`} className="underline">{c.email}</a>}</Linha>
            <Linha rotulo="Bitrix">{c.bitrix_contato_id && `Contato #${c.bitrix_contato_id}`}</Linha>
          </dl>
        </Secao>
      </div>

      {/* Família */}
      <Secao
        titulo="Família"
        acao={ehTitular && !c.mesclado_em_id ? (
          <Botao variante="fantasma" onClick={() => setNovoFamiliar(true)} style={{ color: "var(--rel-ink)" }}>+ Adicionar familiar</Botao>
        ) : undefined}
      >
        {!ehTitular && titular && (
          <button onClick={() => onAbrir(titular.id)} className="rel-linha w-full flex items-center gap-3 p-2 -mx-2 rounded-lg text-left">
            <Avatar nome={titular.nome} tamanho={32} />
            <span className="flex-1 text-sm" style={{ color: "var(--ink)" }}><b>{titular.nome}</b> <span style={{ color: "var(--ink3)" }}>· titular</span></span>
          </button>
        )}
        {familia.map((m) => (
          <button key={m.id} onClick={() => onAbrir(m.id)} className="rel-linha w-full flex items-center gap-3 p-2 -mx-2 rounded-lg text-left">
            <Avatar nome={m.nome} tamanho={32} />
            <span className="flex-1 text-sm" style={{ color: "var(--ink)" }}>
              {m.nome} <span style={{ color: "var(--ink3)" }}>· {PARENTESCOS[m.parentesco ?? "outro"]}</span>
            </span>
          </button>
        ))}
        {ehTitular && familia.length === 0 && (
          <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>
            Ninguém ligado ainda. Cônjuge, filhos e amigos que viajam juntos entram aqui — cada um com a própria ficha.
          </p>
        )}
      </Secao>

      {c.observacoes && (
        <Secao titulo="Observações">
          <p className="text-[14px] whitespace-pre-wrap py-1" style={{ color: "var(--ink)" }}>{c.observacoes}</p>
        </Secao>
      )}

      {/* WhatsApp do Relacionamento (Fase 2) */}
      <Secao
        titulo="WhatsApp"
        acao={!c.mesclado_em_id && c.telefone ? (
          conversas.some((x) => x.janela_aberta)
            ? <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => onAbrirConversa(conversas.find((x) => x.janela_aberta)!.id)}>Abrir conversa</Botao>
            : <Botao variante="fantasma" style={{ color: "var(--rel-ink)" }} onClick={() => setMandarModelo(true)}>Mandar mensagem</Botao>
        ) : undefined}
      >
        {!c.telefone ? (
          <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Sem telefone na ficha.</p>
        ) : conversas.length === 0 ? (
          <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Nenhuma conversa ainda pelo WhatsApp do Relacionamento.</p>
        ) : conversas.map((cv) => (
          <button key={cv.id} onClick={() => onAbrirConversa(cv.id)} className="rel-linha w-full flex items-center gap-3 p-2 -mx-2 rounded-lg text-left">
            <span className="flex-1 min-w-0">
              <span className="block text-[13px] truncate" style={{ color: "var(--ink)" }}>{cv.ultima_mensagem || "—"}</span>
              <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>
                {horaCurta(cv.atualizado_em)} · {cv.estado === "resolvida" ? "resolvida" : cv.aguardando_desde ? `esperando há ${duracao(cv.minutos_esperando)}` : "em andamento"}
                {cv.atendente_nome ? ` · ${cv.atendente_nome.split(" ")[0]}` : ""}
              </span>
            </span>
            {cv.nao_lidas > 0 && <Etiqueta tom="rel">{cv.nao_lidas}</Etiqueta>}
          </button>
        ))}
      </Secao>

      {/* Próximas fases: deixam claro onde as coisas vão aparecer */}
      <Secao titulo="Viagens e documentos">
        <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>
          Chega na Fase 3: as viagens deste cliente (criadas a partir da venda no Bitrix) e os documentos enviados por link.
        </p>
      </Secao>

      <Secao titulo="Histórico da ficha">
        {historico.length === 0 ? (
          <p className="text-[13px] py-2" style={{ color: "var(--ink3)" }}>Sem registros.</p>
        ) : (
          <ol className="space-y-2 py-1">
            {historico.map((h) => (
              <li key={h.id} className="text-[13px] flex flex-wrap gap-x-1.5" style={{ color: "var(--ink)" }}>
                <b>{(h.por && usuarios[h.por]) || "Sistema"}</b>
                <span>{mudancas(h)}</span>
                <span style={{ color: "var(--ink3)" }}>· {new Date(h.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
              </li>
            ))}
          </ol>
        )}
      </Secao>

      <ClienteForm
        aberto={editando}
        cliente={c}
        onFechar={() => setEditando(false)}
        onSalvo={() => { setEditando(false); void carregar(); }}
        onAbrirFicha={(x) => { setEditando(false); onAbrir(x); }}
      />
      <ModeloModal
        aberto={mandarModelo}
        alvo={{ clienteId: c.id }}
        nomeCliente={c.nome}
        onFechar={() => setMandarModelo(false)}
        onEnviado={(cid) => { setMandarModelo(false); if (cid) onAbrirConversa(cid); else void carregar(); }}
      />
      <ClienteForm
        aberto={novoFamiliar}
        titular={c}
        onFechar={() => setNovoFamiliar(false)}
        onSalvo={() => { setNovoFamiliar(false); void carregar(); }}
        onAbrirFicha={(x) => { setNovoFamiliar(false); onAbrir(x); }}
      />
    </div>
  );
}
