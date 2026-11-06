// src/expedicoes/expedamigo/servidor.ts
// Chamadas do navegador pro link mágico do ExpedAmigo (api/expedicoes.js →
// api/_expAcesso.js). O código é gravado no SERVIDOR; aqui só pede e lê.
import { useEffect, useState } from "react";
import { supabase } from "../lib/banco";

export interface LinkAmigo {
  link: string;
  codigo: string;
  expira_em: string;
  reaproveitado: boolean;
  resetado: boolean;
  ja_tem_senha: boolean;
  liberado: boolean;
  passageiro: { id: string; nome: string; telefone: string | null; cpf: string | null };
  expedicao: { id: string; nome: string; tipo: string } | null;
}

/** Erro do modo validação (espelho ligado): o botão deve ficar desligado, não é falha. */
export class ModoValidacaoErro extends Error {}

/**
 * Gera (ou reaproveita) o link mágico de uma reserva — ou, sem passageiroId, da
 * reserva representativa do CPF. `resetar` derruba a senha atual (só admin).
 */
export async function pedirLinkAmigo(alvo: { passageiroId?: string; cpf?: string }, opcoes: { resetar?: boolean; liberar?: boolean } = {}): Promise<LinkAmigo> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/expedicoes?acao=amigo-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ passageiro_id: alvo.passageiroId, cpf: alvo.cpf, resetar: !!opcoes.resetar, liberar: opcoes.liberar !== false }),
  });
  let j: (LinkAmigo & { ok: boolean; error?: string; modo_validacao?: boolean }) | null = null;
  try { j = await r.json(); } catch { /* resposta vazia */ }
  if (r.status === 423 || j?.modo_validacao) throw new ModoValidacaoErro(j?.error || "Modo validação: gere o link pelo sistema antigo.");
  if (!r.ok || !j?.ok) throw new Error(j?.error || `Falha ao gerar o link (${r.status})`);
  return j;
}

let cacheStatus: Promise<{ espelho: boolean; portal: string | null }> | null = null;

/** Lê uma vez por sessão se o espelho está ligado (EXP_ESPELHO_LIGADO no servidor). */
export function lerStatusAmigo(): Promise<{ espelho: boolean; portal: string | null }> {
  cacheStatus ??= fetch("/api/expedicoes?acao=amigo-status")
    .then((r) => r.json())
    .then((j: { espelho?: boolean; portal?: string }) => ({ espelho: j?.espelho === true, portal: j?.portal ?? null }))
    // Sem resposta: na dúvida, trata como modo validação (não gera link que pode não abrir).
    .catch(() => { cacheStatus = null; return { espelho: true, portal: null }; });
  return cacheStatus;
}

/**
 * true = modo validação (não gerar link no QS). `forcado` deixa a tela passar o valor
 * que já tem (ex.: o modo só-leitura do contexto useExp); sem ele, pergunta ao servidor.
 * undefined = ainda carregando.
 */
export interface ResultadoLiberarTodos {
  total: number;
  ja_tinham_senha: number;
  sem_cpf: number;
  links: { passageiro_id: string; nome: string; cpf: string; telefone: string | null; link: string; expira_em: string }[];
  expedicao: { id: string; nome: string; tipo: string };
}

/**
 * "Liberar portal para todos" (06/11): libera a expedição e devolve UM link mágico por
 * pessoa que ainda não criou senha (antes: senha provisória, 0170). Nada é enviado.
 */
export async function pedirLiberarTodos(expedicaoId: string): Promise<ResultadoLiberarTodos> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Sessão expirada. Entre de novo.");
  const r = await fetch("/api/expedicoes?acao=amigo-liberar-todos", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ expedicao_id: expedicaoId }),
  });
  let j: (ResultadoLiberarTodos & { ok: boolean; error?: string; modo_validacao?: boolean }) | null = null;
  try { j = await r.json(); } catch { /* resposta vazia */ }
  if (r.status === 423 || j?.modo_validacao) throw new ModoValidacaoErro(j?.error || "Modo validação: libere pelo sistema antigo.");
  if (!r.ok || !j?.ok) throw new Error(j?.error || `Falha ao liberar (${r.status})`);
  return j;
}

export function useModoValidacaoAmigo(forcado?: boolean): boolean | undefined {
  const [v, setV] = useState<boolean | undefined>(forcado);
  useEffect(() => {
    if (forcado !== undefined) { setV(forcado); return; }
    let vivo = true;
    void lerStatusAmigo().then((s) => { if (vivo) setV(s.espelho); });
    return () => { vivo = false; };
  }, [forcado]);
  return v;
}
