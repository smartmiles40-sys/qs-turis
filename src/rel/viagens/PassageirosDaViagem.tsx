// src/rel/viagens/PassageirosDaViagem.tsx
// -----------------------------------------------------------------------------
// ABA "PASSAGEIROS" DA FICHA DA VIAGEM (24/11/2026). Bruno: "falta um lugar pra
// ter as informações dos dados do cliente". Um cartão por pessoa com tudo que o
// time precisa pra emitir e fazer check-in (CPF, nascimento, passaporte,
// contato) e os documentos DELA. Antes isso ficava espalhado: "Quem viaja" e
// "Documentos" na lateral + "Arquivos da viagem" lá embaixo.
// -----------------------------------------------------------------------------
import { dataBR, hojeSP, TIPOS_DOC, type Passageiro, type TipoDocumento } from "../lib/viagens";
import { formatarTelefone, PARENTESCOS, type Parentesco } from "../lib/clientes";
import type { DocResumo } from "../lib/componentes";
import { estadoDocumento, estadoPassaporte } from "../lib/prontidao";

const iniciais = (n: string) => n.trim().split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join("").toUpperCase();
const cpfBonito = (c?: string | null) => {
  const d = (c ?? "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : c || "";
};
function idade(nasc: string | null, hoje: string): number | null {
  if (!nasc) return null;
  const [a, m, d] = nasc.slice(0, 10).split("-").map(Number);
  const [ha, hm, hd] = hoje.split("-").map(Number);
  if (!a) return null;
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

function Dado({ rotulo, valor, largo }: { rotulo: string; valor: string | null | undefined; largo?: boolean }) {
  return (
    <div style={largo ? { gridColumn: "1 / -1" } : undefined}>
      <dt>{rotulo}</dt>
      <dd className={valor ? undefined : "vf-vazio"}>{valor || "não informado"}</dd>
    </div>
  );
}

export default function PassageirosDaViagem({ pass, compradorId, qtdVendida, dataReferencia, docs, ativa, onAbrirCliente, onAdicionar, onRemover }: {
  pass: Passageiro[];
  compradorId: string | null;
  qtdVendida: number | null;
  /** volta (ou ida): a régua dos 6 meses do passaporte */
  dataReferencia: string | null;
  docs: DocResumo[] | null;
  ativa: boolean;
  onAbrirCliente: (id: string) => void;
  onAdicionar: () => void;
  onRemover: (p: Passageiro) => void;
}) {
  const hoje = hojeSP();
  const comFicha = pass.filter((p) => p.cliente);
  const faltamFichas = qtdVendida && qtdVendida > comFicha.length ? qtdVendida - comFicha.length : 0;

  return (
    <section className="flex flex-col gap-4" aria-label="Passageiros">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="vf-sub">
          {comFicha.length} passageiro{comFicha.length === 1 ? "" : "s"} com ficha
          {qtdVendida ? ` de ${qtdVendida} vendido${qtdVendida === 1 ? "" : "s"}` : ""}
          {faltamFichas ? <b style={{ color: "var(--danger)" }}> · falta{faltamFichas === 1 ? "" : "m"} {faltamFichas}</b> : null}
        </p>
        {ativa && <button type="button" className="vf-btn" onClick={onAdicionar}>+ Passageiro</button>}
      </div>

      {comFicha.length === 0 && <div className="vf-card"><p className="vf-sub">Nenhum passageiro com ficha nesta viagem.</p></div>}

      <div className="vf-pax-grid">
        {comFicha.map((p) => {
          const c = p.cliente!;
          const pp = estadoPassaporte(c, dataReferencia, hoje);
          const anos = idade(c.nascimento, hoje);
          const meusDocs = (docs ?? []).filter((d) => d.cliente_id === c.id);
          const papel = c.id === compradorId ? "Comprou a viagem" : c.parentesco ? PARENTESCOS[c.parentesco as Parentesco] ?? null : null;
          return (
            <article key={p.id} className="vf-card flex flex-col gap-4">
              <div className="flex items-start gap-3 justify-between">
                <button type="button" className="vf-pessoa text-left min-w-0" onClick={() => onAbrirCliente(c.id)} title="Abrir a ficha do cliente">
                  <span className="vf-ini" aria-hidden>{iniciais(c.nome)}</span>
                  <span className="flex flex-col min-w-0">
                    <b className="truncate">{c.nome}</b>
                    <span className="vf-sub">{[papel, anos != null && `${anos} anos`, p.bitrix_deal_id && `card #${p.bitrix_deal_id}`].filter(Boolean).join(" · ") || "passageiro"}</span>
                  </span>
                </button>
                {c.id !== compradorId && ativa && (
                  <button type="button" className="vf-link flex-shrink-0" style={{ color: "var(--danger)" }} aria-label={`Tirar ${c.nome} da viagem`} onClick={() => onRemover(p)}>Tirar</button>
                )}
              </div>

              <dl className="vf-dados">
                <Dado rotulo="CPF" valor={cpfBonito(c.cpf)} />
                <Dado rotulo="Nascimento" valor={c.nascimento ? dataBR(c.nascimento) : null} />
                <Dado rotulo="Telefone" valor={formatarTelefone(c.telefone)} />
                <Dado rotulo="E-mail" valor={c.email} />
                <Dado rotulo="Passaporte" valor={c.passaporte} />
                <div>
                  <dt>Validade</dt>
                  <dd className={`vf-tx-${pp.estado}`}>{c.passaporte_validade ? `${dataBR(c.passaporte_validade)} · ` : ""}{pp.texto}</dd>
                </div>
                {c.observacoes && <Dado rotulo="Observações da ficha" valor={c.observacoes} largo />}
              </dl>

              <div className="flex flex-col gap-1.5">
                <span className="vf-rot">Documentos</span>
                {docs === null ? <div className="h-8 rounded-lg animate-pulse" style={{ background: "var(--surface-2)" }} />
                  : meusDocs.length === 0 ? <span className="vf-sub">Nenhum documento enviado.</span>
                  : meusDocs.map((d, i) => {
                    const e = estadoDocumento(d.status);
                    return (
                      <div key={i} className="vf-lin vf-lin--borda">
                        <span style={{ color: "var(--text)" }}>{TIPOS_DOC[d.tipo as TipoDocumento] ?? d.tipo}</span>
                        <span className={`vf-pill vf-pill--${e.estado}`}>{e.rotulo}</span>
                      </div>
                    );
                  })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
