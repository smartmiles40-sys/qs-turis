// src/rel/clientes/DuplicadosPage.tsx
// -----------------------------------------------------------------------------
// Fichas que PARECEM ser a mesma pessoa. A pessoa do time decide:
//   - "Juntar": escolhe qual ficha fica; a outra vira um apontamento pra ela
//     (nada se perde — o histórico guarda a ficha que saiu);
//   - "Não é a mesma pessoa": o par some da lista pra sempre.
// Mãe e filho com o mesmo celular NÃO aparecem aqui se já estão na mesma família.
// -----------------------------------------------------------------------------
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import {
  formatarCpf, formatarData, formatarTelefone, juntarClientes, listarDuplicados, naoEhDuplicado,
  type Cliente, type DuplicadoSugerido,
} from "../lib/clientes";
import { Aviso, Avatar, Botao, Etiqueta, Modal, Vazio } from "../ui";

function Resumo({ c }: { c: Cliente | undefined }) {
  if (!c) return null;
  const linhas: [string, string | null][] = [
    ["CPF", c.cpf && formatarCpf(c.cpf)],
    ["Telefone", c.telefone && formatarTelefone(c.telefone)],
    ["E-mail", c.email],
    ["Nascimento", c.nascimento && formatarData(c.nascimento)],
    ["Passaporte", c.passaporte],
  ];
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-2">
        <Avatar nome={c.nome} tamanho={30} />
        <span className="text-sm font-bold truncate" style={{ color: "var(--ink)" }}>{c.nome}</span>
      </div>
      <dl className="text-[12px] space-y-0.5">
        {linhas.map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <dt className="w-20 flex-shrink-0" style={{ color: "var(--ink3)" }}>{k}</dt>
            <dd className="truncate" style={{ color: v ? "var(--ink)" : "var(--ink3)" }}>{v || "—"}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[11px] mt-2" style={{ color: "var(--ink3)" }}>Criada em {new Date(c.criado_em).toLocaleDateString("pt-BR")}</p>
    </div>
  );
}

export default function DuplicadosPage({ onAbrir, onMudou }: { onAbrir: (id: string) => void; onMudou: () => void }) {
  const [pares, setPares] = useState<DuplicadoSugerido[]>([]);
  const [fichas, setFichas] = useState<Record<string, Cliente>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [juntando, setJuntando] = useState<{ par: DuplicadoSugerido; manter: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const p = await listarDuplicados();
      setPares(p);
      const ids = [...new Set(p.flatMap((x) => [x.a_id, x.b_id]))];
      if (ids.length) {
        const { data } = await supabase.from("rel_clientes").select("*").in("id", ids);
        setFichas(Object.fromEntries(((data ?? []) as Cliente[]).map((c) => [c.id, c])));
      }
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar os duplicados.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  async function descartar(par: DuplicadoSugerido) {
    setOcupado(true);
    try { await naoEhDuplicado(par.a_id, par.b_id); await carregar(); onMudou(); }
    catch (e) { setErro(e instanceof Error ? e.message : "Falhou."); }
    finally { setOcupado(false); }
  }

  async function confirmarJuntar() {
    if (!juntando) return;
    const { par, manter } = juntando;
    const remover = manter === par.a_id ? par.b_id : par.a_id;
    setOcupado(true);
    try {
      await juntarClientes(manter, remover);
      setJuntando(null);
      await carregar();
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui juntar.");
      setJuntando(null);
    } finally {
      setOcupado(false);
    }
  }

  const fica = juntando ? fichas[juntando.manter] : undefined;
  const sai = juntando ? fichas[juntando.manter === juntando.par.a_id ? juntando.par.b_id : juntando.par.a_id] : undefined;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Possíveis duplicados</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
          Fichas com o mesmo telefone, e-mail ou nome. Confira e junte — uma pessoa, uma ficha.
        </p>
      </div>

      {erro && <div className="mb-4"><Aviso tom="erro">{erro}</Aviso></div>}

      {carregando && pares.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>
      ) : pares.length === 0 ? (
        <div className="rel-card"><Vazio titulo="Nenhum duplicado à vista" texto="Quando duas fichas parecerem a mesma pessoa, elas aparecem aqui." /></div>
      ) : (
        <ul className="space-y-3">
          {pares.map((par) => (
            <li key={`${par.a_id}-${par.b_id}`} className="rel-card p-4">
              <div className="flex flex-wrap gap-1.5 mb-3">
                {par.motivos.map((m) => <Etiqueta key={m} tom="aviso">{m}</Etiqueta>)}
              </div>
              <div className="flex flex-col sm:flex-row gap-4">
                <Resumo c={fichas[par.a_id]} />
                <div className="hidden sm:block w-px" style={{ background: "var(--line)" }} />
                <Resumo c={fichas[par.b_id]} />
              </div>
              <div className="flex flex-wrap gap-2 mt-4 pt-3" style={{ borderTop: "1px solid var(--line2)" }}>
                <Botao variante="primario" disabled={ocupado} onClick={() => setJuntando({ par, manter: par.a_id })}>Juntar…</Botao>
                <Botao disabled={ocupado} onClick={() => descartar(par)}>Não é a mesma pessoa</Botao>
                <span className="flex-1" />
                <Botao variante="fantasma" onClick={() => onAbrir(par.a_id)}>Abrir 1ª</Botao>
                <Botao variante="fantasma" onClick={() => onAbrir(par.b_id)}>Abrir 2ª</Botao>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        aberto={!!juntando}
        titulo="Juntar fichas"
        onFechar={() => setJuntando(null)}
        rodape={
          <>
            <Botao variante="fantasma" onClick={() => setJuntando(null)}>Cancelar</Botao>
            <Botao variante="primario" disabled={ocupado} onClick={confirmarJuntar}>{ocupado ? "Juntando…" : "Juntar"}</Botao>
          </>
        }
      >
        {juntando && (
          <div className="space-y-3">
            <p className="text-[13px]" style={{ color: "var(--ink2)" }}>Qual ficha <b>fica</b>?</p>
            {[juntando.par.a_id, juntando.par.b_id].map((id) => (
              <label key={id} className="flex items-center gap-3 p-3 rounded-xl cursor-pointer" style={{ border: `2px solid ${juntando.manter === id ? "var(--rel)" : "var(--line)"}`, background: juntando.manter === id ? "var(--rel-soft)" : "transparent" }}>
                <input type="radio" checked={juntando.manter === id} onChange={() => setJuntando({ ...juntando, manter: id })} />
                <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{fichas[id]?.nome}</span>
                <span className="text-[12px]" style={{ color: "var(--ink3)" }}>{fichas[id]?.cpf ? formatarCpf(fichas[id]!.cpf) : "sem CPF"}</span>
              </label>
            ))}
            <Aviso tom="ok">
              A ficha de <b>{fica?.nome}</b> fica. O que ela não tiver (CPF, passaporte, telefone…) é completado com a de{" "}
              <b>{sai?.nome}</b> — nada é sobrescrito. A família passa junto e a junção fica no histórico.
            </Aviso>
          </div>
        )}
      </Modal>
    </div>
  );
}
