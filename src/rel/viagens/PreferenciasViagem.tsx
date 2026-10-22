// src/rel/viagens/PreferenciasViagem.tsx
// -----------------------------------------------------------------------------
// PREFERÊNCIAS DO CLIENTE NESTA VIAGEM (0184, 22/10/2026). 37 de 38 pacotes
// embarcando não tinham nada anotado. Aqui fica fácil: cinco campos curtos
// (alergias, restrições, ocasião especial, gostos, outros) e o botão "Nada a
// registrar" pra quem já conversou e não tem nada — os dois tiram o alerta.
//
// Faltando e embarcando em até 30 dias → aviso amarelo aqui, na lista de
// atividades e em Alertas ("faltam as preferências"); em até 7 dias, vermelho.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { useQsAuth } from "@/contexts/QsAuthContext";
import { supabase } from "@/lib/supabase";
import { CAMPOS_PREF, PREF_DIAS_ANTES, preferenciasVazias, salvarPreferencias, type Preferencias } from "../lib/operacao";
import { dataBR } from "../lib/viagens";
import { Aviso, Botao, Campo, Entrada } from "../ui";

export default function PreferenciasViagem({ viagemId, necessidades, diasParaEmbarque, ativa, equipe }: {
  viagemId: string; necessidades: string | null; diasParaEmbarque: number | null; ativa: boolean; equipe: { id: string; name: string }[];
}) {
  const { currentUser } = useQsAuth();
  const [salvo, setSalvo] = useState<Preferencias | null>(null);
  const [f, setF] = useState<Preferencias>({});
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    supabase.from("rel_viagens").select("preferencias").eq("id", viagemId).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo) return;
        // sem a coluna (migration 0184 ainda não aplicada) o card abre normal
        if (error) { setSalvo({}); return; }
        setSalvo(((data as { preferencias?: Preferencias } | null)?.preferencias) ?? {});
      });
    return () => { vivo = false; };
  }, [viagemId]);

  if (salvo === null) return <div className="h-20 rounded-xl animate-pulse" style={{ background: "var(--card2)" }} />;

  const vazias = preferenciasVazias(salvo, necessidades);
  const perto = diasParaEmbarque !== null && diasParaEmbarque >= 0 && diasParaEmbarque <= PREF_DIAS_ANTES;
  const preenchidos = CAMPOS_PREF.filter((c) => (salvo[c.id] ?? "").trim());
  const quem = salvo.por ? equipe.find((u) => u.id === salvo.por)?.name : null;

  async function gravar(p: Preferencias) {
    setOcupado(true); setErro(null);
    try { await salvarPreferencias(viagemId, p, currentUser?.id ?? ""); setSalvo({ ...p, por: currentUser?.id ?? null, em: new Date().toISOString() }); setEditando(false); }
    catch (e) { setErro(e instanceof Error ? e.message : "Não salvou."); }
    finally { setOcupado(false); }
  }

  if (editando) {
    return (
      <div className="space-y-2.5">
        {CAMPOS_PREF.map((c) => (
          <Campo key={c.id} rotulo={c.rotulo}>
            <Entrada value={f[c.id] ?? ""} placeholder={c.dica} onChange={(e) => setF((x) => ({ ...x, [c.id]: e.target.value }))} />
          </Campo>
        ))}
        {(f.ocasiao ?? "").trim() && (
          <Campo rotulo="Data da ocasião (se tiver)">
            <Entrada type="date" value={f.ocasiao_data ?? ""} onChange={(e) => setF((x) => ({ ...x, ocasiao_data: e.target.value }))} style={{ maxWidth: 180 }} />
          </Campo>
        )}
        {erro && <Aviso tom="erro">{erro}</Aviso>}
        <div className="flex flex-wrap gap-2 justify-end">
          <Botao variante="fantasma" onClick={() => setEditando(false)}>Cancelar</Botao>
          <Botao variante="primario" disabled={ocupado} onClick={() => void gravar({ ...f, nada_a_registrar: false })}>{ocupado ? "Salvando…" : "Salvar"}</Botao>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {vazias && ativa && perto && (
        <Aviso tom={diasParaEmbarque! <= 7 ? "erro" : "aviso"}>
          Embarca {diasParaEmbarque === 0 ? "hoje" : `em ${diasParaEmbarque} dia${diasParaEmbarque === 1 ? "" : "s"}`} e não tem nada anotado sobre a pessoa. Pergunte no WhatsApp e anote aqui.
        </Aviso>
      )}
      {necessidades && <p className="text-[13px]" style={{ color: "var(--ink)" }}><b>Do Bitrix:</b> {necessidades}</p>}
      {preenchidos.length > 0 ? (
        <dl className="space-y-1">
          {preenchidos.map((c) => (
            <div key={c.id} className="text-[13.5px]">
              <dt className="inline font-semibold" style={{ color: "var(--ink2)" }}>{c.rotulo}: </dt>
              <dd className="inline" style={{ color: "var(--ink)" }}>{salvo[c.id]}{c.id === "ocasiao" && salvo.ocasiao_data ? ` (${dataBR(salvo.ocasiao_data)})` : ""}</dd>
            </div>
          ))}
        </dl>
      ) : salvo.nada_a_registrar ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Conversado: nada a registrar.</p>
      ) : !necessidades ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Nada anotado ainda.</p>
      ) : null}
      {salvo.em && <p className="text-[11.5px]" style={{ color: "var(--ink3)" }}>Atualizado em {new Date(salvo.em).toLocaleDateString("pt-BR")}{quem ? ` por ${quem}` : ""}.</p>}
      {ativa && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Botao variante={vazias ? "primario" : "secundario"} onClick={() => { setF(salvo); setEditando(true); }}>{preenchidos.length ? "Editar preferências" : "Anotar preferências"}</Botao>
          {vazias && <Botao variante="fantasma" disabled={ocupado} onClick={() => void gravar({ nada_a_registrar: true })} title="Já conversei com o cliente e não tem nada especial">Nada a registrar</Botao>}
        </div>
      )}
      {erro && <Aviso tom="erro">{erro}</Aviso>}
    </div>
  );
}
