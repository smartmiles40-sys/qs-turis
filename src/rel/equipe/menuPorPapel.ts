// src/rel/equipe/menuPorPapel.ts
// -----------------------------------------------------------------------------
// QUE PAINÉIS CADA PAPEL VÊ NO MENU (0229, Bruno 30/10: "o menu de cada pessoa
// mostra só os painéis do cargo dela, pra quem está começando não se perder").
//
// O mapa papel → itens mora no banco (qs_menu_papel) e a chave liga/desliga por
// setor em qs_menu_setor. O que não tem linha no banco usa o PADRÃO daqui.
//
// À prova de migration não aplicada: se a leitura falhar (tabela não existe,
// rede), `lerMenuPorPapel` devolve null e o RelApp mostra o menu COMPLETO —
// ninguém perde nada. E a chave nasce DESLIGADA: o menu só encolhe quando a
// gestão olhar a pré-visualização e ligar na tela Time e cargos.
//
// Gestão (gestor do Rel) e admin sempre veem o menu completo. Quem não tem
// papel também.
// -----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PAPEIS, papeisDe, type Papel } from "@/solicitacoes/lib";
import { BASE_REL } from "../menu";

/** Padrão (código) quando o banco não tem linha pro papel. */
export const MENU_PADRAO: Record<Papel, string[]> = {
  // CX: experiência da viagem — conversa, documentos, pré-embarque
  cx: ["atendimento", "grupos", "clientes", "viagens", "alertas"],
  // CS: pós-venda — reclamação, chamados, satisfação
  cs: ["atendimento", "chamados", "clientes", "viagens", "pesquisas"],
  // Hunter: vende pra base
  hunter: ["atendimento", "clientes", "propostas", "vendas", "campanhas", "recompra"],
};

export interface MenuPorPapel {
  /** O filtro está valendo pro setor? */
  ligado: boolean;
  mapa: Record<Papel, string[]>;
  /** Papéis com linha própria no banco (os outros estão no padrão). */
  personalizados: Papel[];
}

const EVENTO = "qs-menu-papel-mudou";

/** null = a 0229 não está aplicada (ou a rede falhou): use o menu completo. */
export async function lerMenuPorPapel(setor = "relacionamento"): Promise<MenuPorPapel | null> {
  const [s, p] = await Promise.all([
    supabase.from("qs_menu_setor").select("por_papel").eq("setor", setor).maybeSingle(),
    supabase.from("qs_menu_papel").select("papel, itens").eq("setor", setor),
  ]);
  if (s.error || p.error) return null;
  const mapa = { ...MENU_PADRAO };
  const personalizados: Papel[] = [];
  for (const r of (p.data ?? []) as { papel: Papel; itens: string[] | null }[]) {
    if (!PAPEIS.includes(r.papel) || !r.itens) continue;
    mapa[r.papel] = r.itens;
    personalizados.push(r.papel);
  }
  return { ligado: !!(s.data as { por_papel?: boolean } | null)?.por_papel, mapa, personalizados };
}

/** Grava os itens de um papel. `null` = volta ao padrão. */
export async function salvarMenuDoPapel(papel: Papel, itens: string[] | null, setor = "relacionamento") {
  const { error } = await supabase.rpc("qs_menu_definir_papel", { p_setor: setor, p_papel: papel, p_itens: itens });
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(EVENTO));
}

export async function ligarMenuPorPapel(ligado: boolean, setor = "relacionamento") {
  const { error } = await supabase.rpc("qs_menu_ligar_por_papel", { p_setor: setor, p_ligado: ligado });
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(EVENTO));
}

/** Itens do menu de quem tem estes papéis (base + união dos papéis). null = menu completo. */
export function filtroDoMenu(cfg: MenuPorPapel | null, papeis: Papel[], forcar = false): Set<string> | null {
  if (!cfg || !papeis.length || (!cfg.ligado && !forcar)) return null;
  return new Set([...BASE_REL, ...papeis.flatMap((p) => cfg.mapa[p] ?? [])]);
}

/**
 * Pro RelApp: a configuração e os MEUS papéis, relidos quando a gestão muda
 * algo na tela Time e cargos (mesma aba) ou ao voltar pra aba do navegador.
 */
export function useMenuPorPapel(userId: string): { cfg: MenuPorPapel | null; papeis: Papel[] } {
  const [cfg, setCfg] = useState<MenuPorPapel | null>(null);
  const [papeis, setPapeis] = useState<Papel[]>([]);
  useEffect(() => {
    if (!userId) return;
    let vivo = true;
    const ler = () => {
      void lerMenuPorPapel().then((c) => { if (vivo) setCfg(c); }).catch(() => { if (vivo) setCfg(null); });
      void papeisDe([userId]).then((m) => { if (vivo) setPapeis(m?.[userId] ?? []); }).catch(() => undefined);
    };
    ler();
    const aoVoltar = () => { if (!document.hidden) ler(); };
    window.addEventListener(EVENTO, ler);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { vivo = false; window.removeEventListener(EVENTO, ler); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [userId]);
  return { cfg, papeis };
}
