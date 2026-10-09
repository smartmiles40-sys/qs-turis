// src/rel/config/ConfigPage.tsx
// -----------------------------------------------------------------------------
// Configurações do Relacionamento: o número de WhatsApp, horário de atendimento
// (é ele que define os "minutos úteis" do prazo), feriados, o prazo, a mensagem
// automática de fora do horário, a assinatura e as respostas prontas.
//
// Mudar a configuração: admin ou gestor com acesso ao Relacionamento (o banco
// confere — rel_pode_configurar). Respostas prontas: qualquer um do time.
// -----------------------------------------------------------------------------
import { useEffect, useState, type ReactNode } from "react";
import { useQsAuth, setoresDe } from "@/contexts/QsAuthContext";
import {
  apagarResposta, carregarConfig, listarRespostas, salvarConfig, salvarResposta, statusDoNumero,
  type ConfigRel, type NumeroRel, type Resposta,
} from "../lib/whatsapp";
import { Aviso, Botao, Campo, Entrada, Etiqueta, Modal } from "../ui";

const DIAS = [
  { n: 1, r: "Seg" }, { n: 2, r: "Ter" }, { n: 3, r: "Qua" }, { n: 4, r: "Qui" },
  { n: 5, r: "Sex" }, { n: 6, r: "Sáb" }, { n: 7, r: "Dom" },
];

function Bloco({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  return (
    <section className="rel-card p-4 sm:p-5 space-y-3">
      <div>
        <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>{titulo}</h2>
        {sub && <p className="text-[12px] mt-0.5" style={{ color: "var(--ink3)" }}>{sub}</p>}
      </div>
      {children}
    </section>
  );
}

export default function ConfigPage() {
  const { currentUser } = useQsAuth();
  const pode = currentUser?.role === "admin" || (currentUser?.role === "gestor" && setoresDe(currentUser).includes("relacionamento"));
  const [cfg, setCfg] = useState<ConfigRel | null>(null);
  const [numero, setNumero] = useState<NumeroRel | null>(null);
  const [respostas, setRespostas] = useState<Resposta[]>([]);
  const [msg, setMsg] = useState<{ tom: "ok" | "erro"; t: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [novoFeriado, setNovoFeriado] = useState("");
  const [editResp, setEditResp] = useState<{ id?: string; titulo: string; texto: string } | null>(null);

  useEffect(() => {
    carregarConfig().then(setCfg);
    statusDoNumero().then(setNumero).catch(() => setNumero(null));
    listarRespostas().then(setRespostas);
  }, []);

  if (!cfg) return <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Carregando…</p>;

  const set = <K extends keyof ConfigRel>(k: K, v: ConfigRel[K]) => setCfg((c) => (c ? { ...c, [k]: v } : c));

  async function salvarTudo() {
    if (!cfg) return;
    if (cfg.horario.inicio >= cfg.horario.fim) { setMsg({ tom: "erro", t: "O fim do expediente tem que ser depois do início." }); return; }
    if (!cfg.horario.dias.length) { setMsg({ tom: "erro", t: "Escolha ao menos um dia de atendimento." }); return; }
    if (!(cfg.sla.resposta_min >= 1)) { setMsg({ tom: "erro", t: "O prazo precisa ser de pelo menos 1 minuto." }); return; }
    setSalvando(true);
    setMsg(null);
    try {
      await salvarConfig("horario", cfg.horario);
      await salvarConfig("sla", cfg.sla);
      await salvarConfig("fora_horario", cfg.fora_horario);
      await salvarConfig("assinatura", cfg.assinatura);
      setMsg({ tom: "ok", t: "Configuração salva." });
    } catch (e) {
      setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não salvou." });
    } finally {
      setSalvando(false);
    }
  }

  async function guardarResposta() {
    if (!editResp) return;
    if (!editResp.titulo.trim() || !editResp.texto.trim()) return;
    try {
      await salvarResposta({ ...editResp, titulo: editResp.titulo.trim(), texto: editResp.texto.trim() });
      setEditResp(null);
      setRespostas(await listarRespostas());
    } catch (e) {
      setMsg({ tom: "erro", t: e instanceof Error ? e.message : "Não salvou a resposta." });
    }
  }

  const h = cfg.horario;
  const feriados = [...(h.feriados ?? [])].sort();

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Configurações</h1>
        <p className="text-[13px]" style={{ color: "var(--ink3)" }}>
          {pode ? "Horário, prazo e mensagens do Relacionamento." : "Só admin ou gestor do Relacionamento muda o horário e o prazo. Respostas prontas qualquer um cria."}
        </p>
      </div>

      <Bloco titulo="Número de WhatsApp" sub="O número por onde o Relacionamento atende.">
        {numero === null ? (
          <p className="text-[13px]" style={{ color: "var(--ink3)" }}>Verificando…</p>
        ) : numero.conectado ? (
          <p className="text-[14px] flex flex-wrap items-center gap-2" style={{ color: "var(--ink)" }}>
            <Etiqueta tom="rel">conectado</Etiqueta> <b>{numero.numero}</b> {numero.nome && <span style={{ color: "var(--ink3)" }}>· {numero.nome}</span>}
          </p>
        ) : (
          <Aviso>
            Nenhum número conectado. O admin conecta no <b>Comercial → Configurações → WhatsApp (Meta) → + Conectar WhatsApp Business</b>,
            escolhendo <b>"Número do Relacionamento (pós-venda)"</b>. O número precisa estar no app WhatsApp Business do celular.
          </Aviso>
        )}
      </Bloco>

      <fieldset disabled={!pode} className="space-y-4 disabled:opacity-70">
        <Bloco titulo="Horário de atendimento" sub="O prazo só corre dentro deste horário. Fora dele (e em feriado), o relógio para.">
          <div className="flex flex-wrap gap-1.5">
            {DIAS.map((d) => {
              const on = h.dias.includes(d.n);
              return (
                <button key={d.n} type="button"
                  onClick={() => set("horario", { ...h, dias: on ? h.dias.filter((x) => x !== d.n) : [...h.dias, d.n].sort() })}
                  className="w-12 py-2 rounded-lg text-[13px] font-semibold"
                  style={on ? { background: "var(--rel)", color: "#fff" } : { background: "var(--card2)", color: "var(--ink3)", border: "1px solid var(--line)" }}>
                  {d.r}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3 max-w-xs">
            <Campo rotulo="Início"><Entrada type="time" value={h.inicio} onChange={(e) => set("horario", { ...h, inicio: e.target.value })} /></Campo>
            <Campo rotulo="Fim"><Entrada type="time" value={h.fim} onChange={(e) => set("horario", { ...h, fim: e.target.value })} /></Campo>
          </div>
          <div>
            <p className="text-xs font-semibold mb-1.5" style={{ color: "var(--ink2)" }}>Feriados (não contam no prazo)</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {feriados.length === 0 && <span className="text-[12px]" style={{ color: "var(--ink3)" }}>Nenhum.</span>}
              {feriados.map((f) => (
                <span key={f} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px]" style={{ background: "var(--card2)", border: "1px solid var(--line)", color: "var(--ink)" }}>
                  {f.split("-").reverse().join("/")}
                  <button type="button" aria-label="Tirar feriado" onClick={() => set("horario", { ...h, feriados: feriados.filter((x) => x !== f) })} style={{ color: "var(--ink3)" }}>×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2 max-w-xs">
              <Entrada type="date" value={novoFeriado} onChange={(e) => setNovoFeriado(e.target.value)} />
              <Botao type="button" onClick={() => { if (novoFeriado && !feriados.includes(novoFeriado)) set("horario", { ...h, feriados: [...feriados, novoFeriado] }); setNovoFeriado(""); }}>Incluir</Botao>
            </div>
          </div>
        </Bloco>

        <Bloco titulo="Prazo de resposta" sub="Quanto tempo útil o cliente pode esperar. Passou disso, a conversa fica vermelha na fila.">
          <div className="flex items-center gap-2">
            <Entrada type="number" min={1} max={1440} value={cfg.sla.resposta_min} style={{ width: 110 }}
              onChange={(e) => set("sla", { resposta_min: Number(e.target.value) })} />
            <span className="text-[13px]" style={{ color: "var(--ink2)" }}>minutos úteis</span>
          </div>
        </Bloco>

        <Bloco titulo="Mensagem fora do horário" sub="Enviada sozinha quando o cliente escreve fora do horário — no máximo uma a cada 12h por conversa. Não conta como resposta no prazo.">
          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: "var(--ink)" }}>
            <input type="checkbox" checked={cfg.fora_horario.ativo} onChange={(e) => set("fora_horario", { ...cfg.fora_horario, ativo: e.target.checked })} />
            Ligada
          </label>
          <textarea className="rel-input" rows={3} value={cfg.fora_horario.texto}
            onChange={(e) => set("fora_horario", { ...cfg.fora_horario, texto: e.target.value })} />
        </Bloco>

        <Bloco titulo="Assinatura" sub='A mensagem enviada pela tela sai com o nome de quem escreveu na primeira linha (ex.: "*Ana:*").'>
          <label className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: "var(--ink)" }}>
            <input type="checkbox" checked={cfg.assinatura.ativo} onChange={(e) => set("assinatura", { ativo: e.target.checked })} />
            Assinar as mensagens com o primeiro nome
          </label>
        </Bloco>

        {pode && (
          <div className="flex items-center gap-3">
            <Botao type="button" variante="primario" onClick={salvarTudo} disabled={salvando}>{salvando ? "Salvando…" : "Salvar configurações"}</Botao>
            {msg && <span className="text-[13px]" style={{ color: msg.tom === "ok" ? "var(--rel-ink)" : "var(--err-ink)" }}>{msg.t}</span>}
          </div>
        )}
      </fieldset>

      <Bloco titulo="Respostas prontas" sub='Textos que o time usa sempre. Escreva {nome} onde vai o primeiro nome do cliente.'>
        <ul className="space-y-1.5">
          {respostas.length === 0 && <li className="text-[13px]" style={{ color: "var(--ink3)" }}>Nenhuma ainda.</li>}
          {respostas.map((r) => (
            <li key={r.id} className="flex items-start gap-2 p-2.5 rounded-lg" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
              <span className="flex-1 min-w-0">
                <span className="block text-[13px] font-semibold" style={{ color: "var(--ink)" }}>{r.titulo}</span>
                <span className="block text-[12px] truncate" style={{ color: "var(--ink3)" }}>{r.texto}</span>
              </span>
              <Botao variante="fantasma" onClick={() => setEditResp(r)}>Editar</Botao>
              <Botao variante="fantasma" onClick={async () => { await apagarResposta(r.id); setRespostas(await listarRespostas()); }}>Apagar</Botao>
            </li>
          ))}
        </ul>
        <Botao onClick={() => setEditResp({ titulo: "", texto: "" })}>+ Nova resposta</Botao>
      </Bloco>

      <Modal
        aberto={!!editResp}
        titulo={editResp?.id ? "Editar resposta" : "Nova resposta pronta"}
        onFechar={() => setEditResp(null)}
        rodape={<><Botao variante="fantasma" onClick={() => setEditResp(null)}>Cancelar</Botao><Botao variante="primario" onClick={guardarResposta}>Salvar</Botao></>}
      >
        {editResp && (
          <div className="space-y-3">
            <Campo rotulo="Título (só o time vê)"><Entrada value={editResp.titulo} maxLength={60} onChange={(e) => setEditResp({ ...editResp, titulo: e.target.value })} placeholder="Ex.: Documentos da viagem" /></Campo>
            <Campo rotulo="Texto">
              <textarea className="rel-input" rows={5} value={editResp.texto} onChange={(e) => setEditResp({ ...editResp, texto: e.target.value })}
                placeholder="Oi {nome}! Tudo certo com sua viagem? …" />
            </Campo>
          </div>
        )}
      </Modal>
    </div>
  );
}
