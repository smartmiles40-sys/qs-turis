// src/rel/clientes/ClienteForm.tsx
// -----------------------------------------------------------------------------
// Criar / editar a ficha do cliente.
//
// O coração da "ficha única": ENQUANTO a pessoa digita, o formulário pergunta
// ao banco se já existe alguém com o mesmo CPF, passaporte, telefone, e-mail
// ou nome. CPF/passaporte iguais travam o botão (é a mesma pessoa, com
// certeza); telefone/e-mail iguais só avisam (família divide celular).
// -----------------------------------------------------------------------------
import { useEffect, useMemo, useState } from "react";
import {
  PARENTESCOS, buscarClientes, buscarParecidos, carregarCliente, cpfValido, formatarCpf, formatarTelefone,
  salvarCliente, soDigitos, validarCliente,
  type Cliente, type ClienteInput, type Parecido, type Parentesco,
} from "../lib/clientes";
import { Aviso, Botao, Campo, Entrada, Modal } from "../ui";

interface Props {
  aberto: boolean;
  /** Ficha a editar; sem ela, cria uma nova. */
  cliente?: Cliente | null;
  /** Já abre ligado a este titular (botão "adicionar à família"). */
  titular?: Cliente | null;
  onFechar: () => void;
  onSalvo: (c: Cliente) => void;
  onAbrirFicha: (id: string) => void;
}

type Form = {
  nome: string; cpf: string; nascimento: string; telefone: string; email: string;
  passaporte: string; passaporte_validade: string; observacoes: string; bitrix_contato_id: string;
  titular: Pick<Cliente, "id" | "nome"> | null; parentesco: Parentesco | ""; consentiu: boolean;
};

function formDe(c?: Cliente | null, titular?: Cliente | null): Form {
  return {
    nome: c?.nome ?? "",
    cpf: c?.cpf ? formatarCpf(c.cpf) : "",
    nascimento: c?.nascimento ?? "",
    telefone: c?.telefone ? formatarTelefone(c.telefone) : "",
    email: c?.email ?? "",
    passaporte: c?.passaporte ?? "",
    passaporte_validade: c?.passaporte_validade ?? "",
    observacoes: c?.observacoes ?? "",
    bitrix_contato_id: c?.bitrix_contato_id ?? "",
    titular: titular ? { id: titular.id, nome: titular.nome } : null,
    parentesco: c?.parentesco ?? "",
    consentiu: !!c?.lgpd_consentimento_em,
  };
}

export default function ClienteForm({ aberto, cliente, titular, onFechar, onSalvo, onAbrirFicha }: Props) {
  const [f, setF] = useState<Form>(() => formDe(cliente, titular));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [parecidos, setParecidos] = useState<Parecido[]>([]);
  const [buscaTitular, setBuscaTitular] = useState("");
  const [opcoesTitular, setOpcoesTitular] = useState<Cliente[]>([]);
  const [verMais, setVerMais] = useState(false);

  // Reabre limpo (ou com a ficha certa) a cada abertura.
  useEffect(() => {
    if (!aberto) return;
    setF(formDe(cliente, titular));
    setErro(null);
    setParecidos([]);
    setBuscaTitular("");
    setVerMais(!!(cliente?.bitrix_contato_id || cliente?.observacoes));
    // Na edição, o titular vem só pelo id — busca o nome pra mostrar.
    if (cliente?.titular_id && !titular) {
      carregarCliente(cliente.titular_id)
        .then((t) => t && setF((p) => ({ ...p, titular: { id: t.id, nome: t.nome } })))
        .catch(() => undefined);
    }
  }, [aberto, cliente, titular]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  // ── Parecidos, enquanto digita (espera 400ms parado) ──
  const chave = `${soDigitos(f.cpf)}|${f.passaporte}|${soDigitos(f.telefone)}|${f.email}|${f.nome}`;
  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(async () => {
      const cpfOk = soDigitos(f.cpf).length === 11 ? f.cpf : "";
      const foneOk = soDigitos(f.telefone).length >= 10 ? f.telefone : "";
      const mailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim()) ? f.email : "";
      const passOk = f.passaporte.replace(/[^A-Za-z0-9]/g, "").length >= 5 ? f.passaporte : "";
      if (!cpfOk && !foneOk && !mailOk && !passOk && f.nome.trim().length < 5) { setParecidos([]); return; }
      const r = await buscarParecidos({ cpf: cpfOk, telefone: foneOk, email: mailOk, passaporte: passOk, nome: f.nome }, cliente?.id);
      // Quem é da mesma família não é "parecido" — é parente (dividem telefone).
      setParecidos(r.filter((p) => p.bloqueia || (p.id !== f.titular?.id)));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, aberto]);

  // ── Busca do titular da família ──
  useEffect(() => {
    if (!buscaTitular.trim()) { setOpcoesTitular([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await buscarClientes(buscaTitular, 8);
        // Só titular pode ser titular (família de um nível) e nunca a própria ficha.
        setOpcoesTitular(r.filter((c) => !c.titular_id && c.id !== cliente?.id));
      } catch { setOpcoesTitular([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [buscaTitular, cliente?.id]);

  const bloqueio = parecidos.find((p) => p.bloqueia);
  const avisos = parecidos.filter((p) => !p.bloqueia);
  const cpfErro = f.cpf && soDigitos(f.cpf).length === 11 && !cpfValido(f.cpf) ? "CPF inválido — confira os números." : null;

  const ehTitularDeAlguem = useMemo(() => !!cliente && !cliente.titular_id, [cliente]);

  async function salvar() {
    const input: ClienteInput = {
      nome: f.nome,
      cpf: f.cpf,
      nascimento: f.nascimento,
      telefone: f.telefone,
      email: f.email,
      passaporte: f.passaporte,
      passaporte_validade: f.passaporte_validade,
      observacoes: f.observacoes,
      bitrix_contato_id: f.bitrix_contato_id.trim(),
      titular_id: f.titular?.id ?? null,
      parentesco: f.titular ? (f.parentesco || "outro") : null,
      // Consentimento: guarda QUANDO foi dado; se já tinha, mantém a data original.
      lgpd_consentimento_em: f.consentiu ? (cliente?.lgpd_consentimento_em ?? new Date().toISOString()) : null,
    };
    const v = validarCliente(input);
    if (v) { setErro(v); return; }
    if (bloqueio) { setErro(`Já existe a ficha de ${bloqueio.nome} com ${bloqueio.motivo.replace("mesmo ", "este ")}.`); return; }
    setSalvando(true);
    setErro(null);
    try {
      const salvo = await salvarCliente(input, cliente?.id);
      onSalvo(salvo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo={cliente ? "Editar ficha" : titular ? `Novo familiar de ${titular.nome.split(" ")[0]}` : "Novo cliente"}
      onFechar={onFechar}
      largura={620}
      rodape={
        <>
          <Botao variante="fantasma" onClick={onFechar}>Cancelar</Botao>
          <Botao variante="primario" onClick={salvar} disabled={salvando || !!bloqueio}>
            {salvando ? "Salvando..." : cliente ? "Salvar alterações" : "Criar ficha"}
          </Botao>
        </>
      }
    >
      <div className="space-y-4">
        {bloqueio && (
          <Aviso tom="erro">
            <b>{bloqueio.nome}</b> já tem ficha com {bloqueio.motivo.replace("mesmo ", "este ")}. É a mesma pessoa —{" "}
            <button className="underline font-semibold" onClick={() => onAbrirFicha(bloqueio.id)}>abrir a ficha dela</button>.
          </Aviso>
        )}

        <Campo rotulo="Nome completo *">
          <Entrada value={f.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Como está no documento" autoFocus />
        </Campo>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Campo rotulo="CPF" erro={cpfErro} dica="Chave da ficha: um CPF, uma pessoa.">
            <Entrada
              value={f.cpf}
              onChange={(e) => set("cpf", e.target.value)}
              onBlur={() => soDigitos(f.cpf).length === 11 && set("cpf", formatarCpf(f.cpf))}
              placeholder="000.000.000-00"
              inputMode="numeric"
              aria-invalid={!!cpfErro}
            />
          </Campo>
          <Campo rotulo="Nascimento">
            <Entrada type="date" value={f.nascimento} onChange={(e) => set("nascimento", e.target.value)} />
          </Campo>
          <Campo rotulo="Telefone / WhatsApp">
            <Entrada
              value={f.telefone}
              onChange={(e) => set("telefone", e.target.value)}
              onBlur={() => soDigitos(f.telefone).length >= 10 && set("telefone", formatarTelefone(f.telefone))}
              placeholder="(11) 99999-8888"
              inputMode="tel"
            />
          </Campo>
          <Campo rotulo="E-mail">
            <Entrada type="email" value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="nome@email.com" />
          </Campo>
          <Campo rotulo="Passaporte">
            <Entrada value={f.passaporte} onChange={(e) => set("passaporte", e.target.value.toUpperCase())} placeholder="FX123456" />
          </Campo>
          <Campo rotulo="Validade do passaporte">
            <Entrada type="date" value={f.passaporte_validade} onChange={(e) => set("passaporte_validade", e.target.value)} />
          </Campo>
        </div>

        {avisos.length > 0 && (
          <Aviso>
            <b>Parece que já existe:</b>
            <ul className="mt-1 space-y-0.5">
              {avisos.map((p) => (
                <li key={p.id}>
                  {p.nome} <span style={{ opacity: 0.75 }}>({p.motivo})</span> —{" "}
                  <button className="underline font-semibold" onClick={() => onAbrirFicha(p.id)}>abrir</button>
                </li>
              ))}
            </ul>
            <span className="block mt-1" style={{ opacity: 0.8 }}>Se for parente, ligue à família abaixo. Se for outra pessoa, pode seguir.</span>
          </Aviso>
        )}

        {/* ── Família ── */}
        <div className="rounded-xl p-3.5" style={{ background: "var(--card2)", border: "1px solid var(--line)" }}>
          <p className="text-xs font-bold mb-2" style={{ color: "var(--ink2)" }}>Família</p>
          {f.titular ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px]" style={{ color: "var(--ink)" }}>
                Faz parte da família de <b>{f.titular.nome}</b> como
              </span>
              <select
                className="rel-input"
                style={{ width: "auto", padding: "6px 10px" }}
                value={f.parentesco}
                onChange={(e) => set("parentesco", e.target.value as Parentesco)}
              >
                <option value="">escolha…</option>
                {(Object.keys(PARENTESCOS) as Parentesco[]).map((k) => <option key={k} value={k}>{PARENTESCOS[k]}</option>)}
              </select>
              {!titular && (
                <button className="text-xs underline" style={{ color: "var(--ink3)" }} onClick={() => setF((p) => ({ ...p, titular: null, parentesco: "" }))}>
                  tirar da família
                </button>
              )}
            </div>
          ) : ehTitularDeAlguem && cliente ? (
            <p className="text-[12px]" style={{ color: "var(--ink3)" }}>
              Esta pessoa é titular (pode ter familiares ligados a ela). Para colocá-la na família de outra pessoa, busque o titular:
            </p>
          ) : (
            <p className="text-[12px] mb-2" style={{ color: "var(--ink3)" }}>
              Viaja com alguém (cônjuge, filhos, amigos)? Busque quem é o titular da família.
            </p>
          )}
          {!f.titular && (
            <div className="relative mt-2">
              <Entrada value={buscaTitular} onChange={(e) => setBuscaTitular(e.target.value)} placeholder="Buscar titular por nome, CPF ou telefone" />
              {opcoesTitular.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rel-card shadow-lg overflow-hidden">
                  {opcoesTitular.map((c) => (
                    <button
                      key={c.id}
                      className="rel-linha w-full text-left px-3 py-2 text-[13px]"
                      style={{ color: "var(--ink)" }}
                      onClick={() => { setF((p) => ({ ...p, titular: { id: c.id, nome: c.nome } })); setBuscaTitular(""); }}
                    >
                      {c.nome}
                      <span className="ml-2 text-[11px]" style={{ color: "var(--ink3)" }}>{c.cpf ? formatarCpf(c.cpf) : formatarTelefone(c.telefone)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── LGPD ── */}
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={f.consentiu} onChange={(e) => set("consentiu", e.target.checked)} />
          <span className="text-[13px] leading-snug" style={{ color: "var(--ink)" }}>
            O cliente autorizou guardarmos estes dados (LGPD)
            <span className="block text-[11px]" style={{ color: "var(--ink3)" }}>
              {cliente?.lgpd_consentimento_em ? `Registrado em ${new Date(cliente.lgpd_consentimento_em).toLocaleDateString("pt-BR")}.` : "A data do consentimento fica registrada na ficha."}
            </span>
          </span>
        </label>

        {verMais ? (
          <div className="space-y-4">
            <Campo rotulo="Observações">
              <textarea className="rel-input" rows={3} value={f.observacoes} onChange={(e) => set("observacoes", e.target.value)} placeholder="Preferências, restrição alimentar, cuidados..." />
            </Campo>
            <Campo rotulo="ID do contato no Bitrix" dica="Liga esta ficha ao contato do Bitrix (não pode repetir).">
              <Entrada value={f.bitrix_contato_id} onChange={(e) => set("bitrix_contato_id", e.target.value)} placeholder="Ex.: 48213" inputMode="numeric" />
            </Campo>
          </div>
        ) : (
          <button className="text-xs font-semibold" style={{ color: "var(--rel-ink)" }} onClick={() => setVerMais(true)}>
            + Observações e ID do Bitrix
          </button>
        )}

        {erro && <Aviso tom="erro">{erro}</Aviso>}
      </div>
    </Modal>
  );
}
