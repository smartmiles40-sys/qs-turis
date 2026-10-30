// src/rel/clientes/ficha/Passaportes.tsx
// -----------------------------------------------------------------------------
// Aba Documentos › "Passaportes": TODOS os números que a pessoa já passou (ficha,
// cada ida em expedição/pacote, 2º passaporte dos documentos de viagem), com a
// validade e o alerta da regra dos 6 meses (vale 6 meses depois da VOLTA da viagem
// em andamento ou da próxima; sem viagem, a partir de hoje).
// O atual é o da ficha (é o que o banco sincroniza com as viagens que ainda não
// voltaram, 0232). "Valores antigos" vem de rel_auditoria: cada troca de número ou
// validade, até quando valeu e quem trocou.
// -----------------------------------------------------------------------------
import { Card, StatusChip } from "@/components/ui";
import { formatarData, type Cliente } from "../../lib/clientes";
import { alertaSeisMeses, passaportesDaPessoa, type DocViagem, type IdaCompleta } from "./fontes";
import { dataBRSP, type PassaporteAntigo } from "./regras";

export default function Passaportes({ c, idas, voltaProxima, antigos, docsViagem, usuarios, onPreencher }: {
  c: Cliente; idas: IdaCompleta[]; voltaProxima: string | null; antigos: PassaporteAntigo[] | null; docsViagem: DocViagem[];
  usuarios: Record<string, string>; onPreencher?: () => void;
}) {
  const extras = docsViagem.filter((d) => d.tipo === "passaporte").map((d) => ({ numero: d.numero, validade: d.validade, fonte: `Documentos de viagem${d.pais ? ` (${d.pais})` : ""}` }));
  const lista = passaportesDaPessoa(c, idas, extras);
  return (
    <Card title="Passaportes" action={onPreencher ? <button type="button" className="fc-link fc-link--btn" onClick={onPreencher}>Atualizar</button> : undefined}>
      {lista.length === 0 ? (
        <p className="fc-p">Nenhum passaporte informado ainda — nem na ficha, nem nas inscrições das viagens.</p>
      ) : (
        <ul className="fc-pessoas" aria-label="Passaportes informados">
          {lista.map((p) => {
            const a = alertaSeisMeses(p.validade, voltaProxima);
            return (
              <li key={p.numero} className="fc-dl__r" style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <span className="qs-num" style={{ fontWeight: 600 }}>{p.numero}</span>
                {p.atual && <StatusChip tone="ok">atual</StatusChip>}
                <span className="fc-bloco__s">{p.validade ? `vale até ${formatarData(p.validade)}` : "sem validade informada"}</span>
                {a && a.tom !== "ok" && <StatusChip tone={a.tom}>{a.texto}</StatusChip>}
                <span className="fc-bloco__s" style={{ flexBasis: "100%" }}>informado em: {p.fontes.join(" · ")}</span>
              </li>
            );
          })}
        </ul>
      )}
      {antigos && antigos.length > 0 && (
        <div className="fc-bloco" style={{ marginTop: 12 }}>
          <span className="fc-bloco__t">Valores antigos na ficha</span>
          <ul className="fc-notas" aria-label="Passaportes e validades trocados">
            {antigos.map((x, i) => (
              <li key={`${x.numero}-${x.valeuAte}-${i}`}>
                <span className="qs-num" style={{ fontWeight: 600 }}>{x.numero}</span>
                <span className="fc-bloco__s">
                  {" · "}{x.validade ? `validade ${formatarData(x.validade)}` : "sem validade"}
                  {" · "}valeu até {dataBRSP(x.valeuAte)}
                  {" · "}trocado por {(x.por && usuarios[x.por]) || "Sistema / importação"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
