// src/rel/clientes/ficha/AbaPreferencias.tsx
// -----------------------------------------------------------------------------
// Aba "Preferências e dados de viagem": contato de emergência, alimentação,
// camiseta, profissão, Instagram, preferências de voo, países, com quem viajou.
// Cada valor diz de onde veio: "na ficha" (rel_clientes.perfil, 0228) ou "da
// inscrição de <viagem>" (passageiros). "Usar na ficha" grava o valor da
// inscrição no perfil (campo a campo, auditado) — assim a próxima viagem já sai
// preenchida sem pedir de novo.
// -----------------------------------------------------------------------------
import { useState } from "react";
import { Btn, Card, StatusChip } from "@/components/ui";
import { Aviso } from "../../ui";
import { formatarData } from "../../lib/clientes";
import { mascaraTelefone } from "@/clientes/cadastro";
import {
  CAMPOS_PERFIL, ROTULO_PERFIL, salvarPerfil, PerfilInativo,
  type CampoPerfil, type IdaCompleta, type PerfilEfetivo,
} from "./fontes";

const LEGIVEL = (k: CampoPerfil, v: unknown): string => {
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (k === "contato_emergencia_fone" && typeof v === "string") return mascaraTelefone(v);
  return String(v ?? "");
};

export default function AbaPreferencias({ clienteId, pe, idas, perfilAtivo, bloqueado, onPreencher, onMudou }: {
  clienteId: string; pe: PerfilEfetivo; idas: IdaCompleta[]; perfilAtivo: boolean; bloqueado: boolean;
  onPreencher: () => void; onMudou: () => void;
}) {
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; texto: string } | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);
  const campos = CAMPOS_PERFIL.filter((k) => k !== "saude") as Exclude<CampoPerfil, "saude">[];
  const daInscricao = campos.filter((k) => pe[k]?.origem === "inscricao");

  async function usar(ks: Exclude<CampoPerfil, "saude">[]) {
    setGravando(ks.join(",")); setMsg(null);
    try {
      await salvarPerfil(clienteId, Object.fromEntries(ks.map((k) => [k, pe[k]?.valor])));
      setMsg({ tom: "ok", texto: ks.length > 1 ? "Dados da inscrição gravados na ficha." : "Gravado na ficha." });
      onMudou();
    } catch (e) {
      setMsg({ tom: "erro", texto: e instanceof PerfilInativo ? e.message : e instanceof Error ? e.message : "Não salvou." });
    } finally { setGravando(null); }
  }

  const acompanhantes = idas.filter((i) => i.acompanhante_nome);

  return (
    <div className="fc-main">
      {!perfilAtivo && (
        <Aviso>O perfil de viagem da ficha ainda não está no banco (migration 0228). Abaixo, o que a cliente respondeu nas inscrições — só leitura.</Aviso>
      )}
      {msg && <Aviso tom={msg.tom}>{msg.texto}</Aviso>}

      <Card title="Preferências e dados de viagem" action={!bloqueado ? (
        <span className="fc-acoes">
          {perfilAtivo && daInscricao.length > 0 && (
            <Btn size="sm" disabled={!!gravando} onClick={() => void usar(daInscricao)}>Gravar os {daInscricao.length} da inscrição na ficha</Btn>
          )}
          <Btn size="sm" variant="primary" onClick={onPreencher}>Preencher por telefone</Btn>
        </span>
      ) : undefined}>
        <dl className="fc-dl">
          {campos.map((k) => {
            const v = pe[k];
            return (
              <div key={k} className="fc-dl__r fc-dl__r--acao">
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <dt>{ROTULO_PERFIL[k]}</dt>
                  <dd>{v ? LEGIVEL(k, v.valor) : <StatusChip tone="warn">Faltando</StatusChip>}</dd>
                  {v?.origem === "inscricao" && (
                    <span className="fc-bloco__s">da inscrição de {v.ida?.expedicao?.nome ?? "uma viagem"}{v.ida?.expedicao?.data_embarque ? ` (${formatarData(v.ida.expedicao.data_embarque)})` : ""}</span>
                  )}
                </span>
                {v?.origem === "inscricao" && perfilAtivo && !bloqueado && (
                  <Btn size="sm" variant="ghost" disabled={!!gravando} onClick={() => void usar([k])}>Usar na ficha</Btn>
                )}
              </div>
            );
          })}
        </dl>
      </Card>

      <Card title="Com quem já viajou">
        {acompanhantes.length === 0 ? <p className="fc-p">Nenhum acompanhante informado nas inscrições. (Os vínculos ficam em "Pessoas ligadas", na lateral.)</p> : (
          <ul className="fc-notas">
            {acompanhantes.map((i) => (
              <li key={i.id}>
                <span className="fc-bloco__t">{i.acompanhante_nome}</span>
                <span className="fc-bloco__s" style={{ display: "block" }}>{[i.acompanhante_vinculo, i.expedicao?.nome, i.expedicao?.data_embarque ? formatarData(i.expedicao.data_embarque) : null].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
