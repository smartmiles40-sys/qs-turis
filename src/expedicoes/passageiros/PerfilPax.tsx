// src/expedicoes/passageiros/PerfilPax.tsx
// Página completa do passageiro (app antigo: passageiros/[paxId]/page.tsx):
// dados pessoais, aniversário na viagem, observações, perfil & conexões,
// documentos (passaporte + Drive com os arquivos dele) e ExpedAmigo (admin).
// Endereço: #…/passageiros/pax/<paxId>/perfil.
import { Botao } from "@/rel/ui";
import { useExp } from "../contexto";
import Drive from "../drive/Drive";
import { PASTAS_PAX } from "./pecas";
import { formatDate, aniversarioNaViagem } from "../lib/utils";
import type { ExpedicaoRow, PassageiroRow } from "../lib/database";
import type { DadosAba } from "./dados";
import { Bloco, LiberarExpedAmigo, PassaporteAnexo, PerfilConexoes, QuartoAcompanhante } from "./blocos";
import { FotoPax, Linha, SeloFidelidade, SeloStatus, SeloTipo } from "./pecas";

export default function PerfilPax({ exp, pax, dados, posicao, admin, onVoltar, onEditar, onMudou }: {
  exp: ExpedicaoRow; pax: PassageiroRow; dados: DadosAba; posicao?: number; admin: boolean; onVoltar: () => void; onEditar: () => void; onMudou: () => void;
}) {
  const { somenteLeitura } = useExp();
  const aniv = aniversarioNaViagem(pax.data_nascimento, exp.data_embarque, exp.data_retorno);
  const foto = pax.foto_arquivo_id ? dados.fotos[pax.foto_arquivo_id] : null;
  return (
    <div className="space-y-4">
      <button onClick={onVoltar} className="text-[12.5px]" style={{ color: "var(--ink2)" }}>← Passageiros</button>
      <header className="flex flex-wrap items-center gap-3">
        <FotoPax nome={pax.nome_completo} url={foto} tamanho={44} />
        <div className="flex-1 min-w-0">
          <h2 className="text-[19px] font-bold" style={{ color: "var(--ink)" }}>{pax.nome_completo}</h2>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5"><SeloStatus s={pax.status_reserva} /><SeloTipo t={pax.tipo} /><SeloFidelidade posicao={posicao} /></div>
        </div>
        <Botao onClick={onEditar}>{somenteLeitura ? "Ver ficha" : "Editar"}</Botao>
      </header>
      {admin && <LiberarExpedAmigo pax={pax} onMudou={onMudou} />}
      <div className="grid gap-4 md:grid-cols-3">
        <Bloco titulo="Dados pessoais">
          <Linha rotulo="CPF" valor={pax.cpf} />
          <Linha rotulo="Passaporte" valor={pax.passaporte} />
          <Linha rotulo="Validade passaporte" valor={pax.validade_passaporte ? formatDate(pax.validade_passaporte) : null} />
          <Linha rotulo="Nascimento" valor={pax.data_nascimento ? formatDate(pax.data_nascimento) : null} />
          <Linha rotulo="Email" valor={pax.email} />
          <Linha rotulo="Telefone" valor={pax.telefone} />
          <Linha rotulo="Emergência" valor={[pax.contato_emergencia_nome, pax.contato_emergencia_fone, pax.contato_emergencia_vinculo].filter(Boolean).join(" · ")} />
        </Bloco>
        <Bloco titulo="Aniversário na viagem">
          <p className="text-[13px]" style={{ color: "var(--ink2)" }}>
            {aniv ? `🎂 Faz aniversário em ${formatDate(aniv.data)}${aniv.idade != null ? ` (${aniv.idade} anos)` : ""}` : "Não faz aniversário durante esta viagem."}
          </p>
        </Bloco>
        <Bloco titulo="Observações">
          <p className="text-[13px] whitespace-pre-wrap" style={{ color: pax.observacoes ? "var(--ink)" : "var(--ink3)" }}>{pax.observacoes || "—"}</p>
        </Bloco>
      </div>
      <PerfilConexoes pax={pax} fotoUrl={foto} />
      <Bloco titulo="Quarto e acompanhante">
        <QuartoAcompanhante pax={pax} quartos={dados.quartos} alocacoes={dados.alocacoes} todos={dados.pax} />
      </Bloco>
      <Bloco titulo="Documentos do passageiro">
        <PassaporteAnexo exp={exp} pax={pax} arquivos={dados.arquivos} onMudou={onMudou} />
        <div className="mt-3"><Drive expedicaoId={exp.id} passageiroId={pax.id} somenteLeitura={somenteLeitura} categorias={PASTAS_PAX} onMudou={onMudou} /></div>
      </Bloco>
    </div>
  );
}
