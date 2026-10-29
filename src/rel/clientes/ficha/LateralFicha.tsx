// src/rel/clientes/ficha/LateralFicha.tsx
// -----------------------------------------------------------------------------
// A coluna da direita da ficha (spec 29/10): Contato, Pessoas ligadas, Origem,
// LGPD e Observações. No celular ela desce pra baixo do conteúdo.
//
// "Pessoas ligadas" JUNTA o que antes eram dois blocos: Família (titular_id +
// parentesco em rel_clientes) e Quem viaja junto (cad_acompanhantes, 0213).
// Enquanto o banco guardar os dois separados, a lista é a união por pessoa; a
// proposta de unificar está em docs/PROPOSTA-SCHEMA-FICHA.md.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { Avatar, Btn, Card, StatusChip, nomeLimpo } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import { VINCULOS, type Acompanhante } from "@/clientes/cadastro";
import { PARENTESCOS, formatarTelefone, type Cliente, type LigacoesCliente, type Metrica } from "../../lib/clientes";

const BITRIX = "https://agenciasetuforeuvou.bitrix24.com.br";
const dataBR = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");
const zap = (fone: string) => {
  const d = fone.replace(/\D/g, "");
  return `https://wa.me/${d.length <= 11 ? `55${d}` : d}`;
};

// ── Contato ─────────────────────────────────────────────────────────────────
function Contato({ c }: { c: Cliente }) {
  const fone = c.telefone ?? "";
  return (
    <Card title="Contato">
      <dl className="fc-dl">
        <div className="fc-dl__r fc-dl__r--acao">
          <div>
            <dt>Telefone</dt>
            <dd>{fone ? formatarTelefone(fone) : <span className="qs-tone-subtle">sem telefone</span>}</dd>
          </div>
          {fone && (
            <span className="fc-icones">
              <a className="qs-btn2 qs-btn2--icon" href={zap(fone)} target="_blank" rel="noreferrer" aria-label="Abrir WhatsApp">{Icon.chat}</a>
              <a className="qs-btn2 qs-btn2--icon" href={`tel:+${fone.replace(/\D/g, "").length <= 11 ? "55" : ""}${fone.replace(/\D/g, "")}`} aria-label="Ligar">{Icon.telefone}</a>
            </span>
          )}
        </div>
        <div className="fc-dl__r">
          <dt>E-mail</dt>
          <dd>{c.email ? <a className="fc-link" href={`mailto:${c.email}`}>{c.email}</a> : <span className="qs-tone-subtle">sem e-mail</span>}</dd>
        </div>
        <div className="fc-dl__r">
          <dt>Bitrix</dt>
          <dd>{c.bitrix_contato_id
            ? <a className="fc-link" href={`${BITRIX}/crm/contact/details/${c.bitrix_contato_id}/`} target="_blank" rel="noreferrer">Contato #{c.bitrix_contato_id}</a>
            : <span className="qs-tone-subtle">sem contato ligado</span>}</dd>
        </div>
      </dl>
    </Card>
  );
}

// ── Pessoas ligadas ─────────────────────────────────────────────────────────
interface PessoaLigada { id: string; nome: string; relacao: string; viajaJunto: boolean; titular?: boolean }

export function pessoasLigadas(c: Cliente, titular: Cliente | null, familia: Cliente[], acompanhantes: Acompanhante[] | null): PessoaLigada[] {
  const m = new Map<string, PessoaLigada>();
  if (titular) m.set(titular.id, { id: titular.id, nome: titular.nome, relacao: "Titular da família", viajaJunto: false, titular: true });
  for (const f of familia) m.set(f.id, { id: f.id, nome: f.nome, relacao: PARENTESCOS[f.parentesco ?? "outro"], viajaJunto: false });
  for (const a of acompanhantes ?? []) {
    const ja = m.get(a.id);
    if (ja) ja.viajaJunto = true;
    else m.set(a.id, { id: a.id, nome: a.nome, relacao: VINCULOS[a.vinculo] ?? "Outro", viajaJunto: true });
  }
  m.delete(c.id);
  return [...m.values()];
}

function Pessoas({ lista, podeEditar, ehTitular, onAbrir, onAdicionarFamiliar, onViajaJunto }: {
  lista: PessoaLigada[]; podeEditar: boolean; ehTitular: boolean;
  onAbrir: (id: string) => void; onAdicionarFamiliar: () => void; onViajaJunto: () => void;
}) {
  return (
    <Card title="Pessoas ligadas" action={<span className="qs-num qs-tone-subtle" style={{ fontSize: 13 }}>{lista.length}</span>}>
      {lista.length === 0 ? (
        <p className="fc-p">Família e quem viaja junto ficam aqui, num lugar só. Cada pessoa tem a própria ficha e uma marcação de quem embarca junto.</p>
      ) : (
        <ul className="fc-pessoas">
          {lista.map((p) => (
            <li key={p.id}>
              <button type="button" className="fc-pessoa" onClick={() => onAbrir(p.id)}>
                <Avatar name={p.nome} size={32} />
                <span className="fc-pessoa__tx">
                  <span className="fc-pessoa__n">{nomeLimpo(p.nome)}</span>
                  <span className="fc-pessoa__r">{p.relacao}</span>
                </span>
                {p.viajaJunto && <StatusChip tone="ok">viaja junto</StatusChip>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {podeEditar && (
        <div className="fc-acoes" style={{ marginTop: 10 }}>
          {ehTitular && <Btn size="sm" onClick={onAdicionarFamiliar}>Adicionar familiar</Btn>}
          <Btn size="sm" onClick={onViajaJunto}>{lista.some((p) => p.viajaJunto) ? "Quem viaja junto" : "Adicionar quem viaja junto"}</Btn>
        </div>
      )}
    </Card>
  );
}

// ── Origem ──────────────────────────────────────────────────────────────────
function Origem({ c, ligacoes, metrica, onVerTudo }: { c: Cliente; ligacoes: LigacoesCliente | null; metrica: Metrica | null; onVerTudo: () => void }) {
  const leads = [...(ligacoes?.leads ?? [])].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
  const lead = leads[0];
  const comprou = (metrica?.valor_total ?? 0) > 0 || (metrica?.viagens_compradas ?? 0) > 0 || (ligacoes?.comprador_em ?? 0) > 0;
  const perdido = leads.find((l) => l.status === "perdido");
  return (
    <Card title="Origem">
      {lead ? (
        <div className="fc-bloco">
          <span className="fc-bloco__t">{leads.length > 1 ? `Lead no Comercial (${leads.length})` : "Lead no Comercial"}</span>
          <span className="fc-bloco__s">
            Chegou {dataBR(lead.criado_em)}{lead.fonte ? ` por ${lead.fonte}` : ""}{lead.dono ? ` · com ${lead.dono.split(" ")[0]}` : ""}
            {lead.status ? ` · ${lead.status.replace("_", " ")}` : ""}
          </span>
        </div>
      ) : (
        <div className="fc-bloco">
          <span className="fc-bloco__t">{c.bitrix_contato_id ? "Veio do Bitrix" : "Ficha criada no QS"}</span>
          <span className="fc-bloco__s">Ficha desde {dataBR(c.criado_em)} · sem lead do Comercial ligado</span>
        </div>
      )}
      {perdido && comprou && (
        <div className="fc-alerta" role="status">
          <span className="fc-bloco__t">Lead consta como perdido</span>
          <span className="fc-bloco__s">Mas existe venda registrada para esta pessoa. Vale conferir o negócio no Bitrix.</span>
        </div>
      )}
      {ligacoes && (ligacoes.grupos.length > 0 || ligacoes.financeiro.length > 0 || ligacoes.passageiro_em > 0 || ligacoes.cruzamentos.length > 0) && (
        <button type="button" className="fc-link fc-link--btn" onClick={onVerTudo}>Onde mais aparece</button>
      )}
    </Card>
  );
}

// ── LGPD ────────────────────────────────────────────────────────────────────
function Lgpd({ c, onEnviarTermo, onRegistrar, podeEnviar }: { c: Cliente; onEnviarTermo: () => void; onRegistrar: () => void; podeEnviar: boolean }) {
  return (
    <Card title="LGPD" action={c.lgpd_consentimento_em ? <StatusChip tone="ok">Consentiu</StatusChip> : <StatusChip tone="warn">Sem consentimento</StatusChip>}>
      <p className="fc-p">
        {c.lgpd_consentimento_em
          ? `Consentimento registrado em ${dataBR(c.lgpd_consentimento_em)}.`
          : "Sem consentimento registrado para uso de dados e comunicação."}
      </p>
      {!c.lgpd_consentimento_em && (
        <div className="fc-acoes" style={{ marginTop: 10 }}>
          <Btn size="sm" onClick={onEnviarTermo} disabled={!podeEnviar || !c.telefone}
            title={!c.telefone ? "Sem telefone na ficha" : !podeEnviar ? "O envio pelo WhatsApp é do Relacionamento" : "Escolha o modelo de mensagem com o termo"}>
            Enviar termo para aceite
          </Btn>
          <Btn size="sm" variant="ghost" onClick={onRegistrar}>Registrar aceite</Btn>
        </div>
      )}
    </Card>
  );
}

// ── Observações ─────────────────────────────────────────────────────────────
function Observacoes({ c, bloqueado, onSalvo }: { c: Cliente; bloqueado: boolean; onSalvo: () => void }) {
  const { currentUser } = useQsAuth();
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const notas = (c.observacoes ?? "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);

  async function salvar() {
    const t = texto.trim();
    if (!t) return;
    setSalvando(true); setErro(null);
    // Vai pro FIM do mesmo campo (rel_clientes.observacoes), com data e autor —
    // é o campo que o Editar ficha já mostra; nada de tabela nova.
    const linha = `${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })} · ${currentUser?.name?.split(" ")[0] ?? "Equipe"}: ${t}`;
    const novo = c.observacoes?.trim() ? `${c.observacoes.trim()}\n\n${linha}` : linha;
    const { error } = await supabase.from("rel_clientes").update({ observacoes: novo }).eq("id", c.id);
    setSalvando(false);
    if (error) { setErro(`Não consegui salvar: ${error.message}`); return; }
    setTexto("");
    onSalvo();
  }

  return (
    <Card title="Observações">
      {notas.length === 0
        ? <p className="fc-p">Nada anotado ainda.</p>
        : <ul className="fc-notas">{notas.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {!bloqueado && (
        <div className="fc-nova-obs">
          <label className="fc-label" htmlFor="fc-obs">Nova observação</label>
          <textarea id="fc-obs" className="fc-input" rows={2} value={texto} placeholder="Algo que o time precisa saber"
            onChange={(e) => setTexto(e.target.value)} disabled={salvando} />
          {erro && <p className="fc-msg qs-tone-danger" role="alert">{erro}</p>}
          {texto.trim() && <Btn size="sm" onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando…" : "Salvar observação"}</Btn>}
        </div>
      )}
    </Card>
  );
}

export default function LateralFicha(p: {
  c: Cliente; titular: Cliente | null; familia: Cliente[]; acompanhantes: Acompanhante[] | null;
  ligacoes: LigacoesCliente | null; metrica: Metrica | null; ehRel: boolean;
  onAbrir: (id: string) => void; onAdicionarFamiliar: () => void; onViajaJunto: () => void;
  onEnviarTermo: () => void; onEditar: () => void; onVerOndeAparece: () => void; onMudou: () => void;
}) {
  const bloqueado = !!p.c.mesclado_em_id;
  return (
    <aside className="fc-lateral" aria-label="Contato e informações da pessoa">
      <Contato c={p.c} />
      <Pessoas lista={pessoasLigadas(p.c, p.titular, p.familia, p.acompanhantes)} podeEditar={!bloqueado} ehTitular={!p.c.titular_id}
        onAbrir={p.onAbrir} onAdicionarFamiliar={p.onAdicionarFamiliar} onViajaJunto={p.onViajaJunto} />
      <Origem c={p.c} ligacoes={p.ligacoes} metrica={p.metrica} onVerTudo={p.onVerOndeAparece} />
      <Lgpd c={p.c} podeEnviar={p.ehRel && !bloqueado} onEnviarTermo={p.onEnviarTermo} onRegistrar={p.onEditar} />
      <Observacoes c={p.c} bloqueado={bloqueado} onSalvo={p.onMudou} />
    </aside>
  );
}
