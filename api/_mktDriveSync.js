// api/_mktDriveSync.js
// -----------------------------------------------------------------------------
// Sincronização incremental Drive compartilhado → mkt_drive_arquivos (0241).
//
// 1ª vez (sem pageToken): guarda o startPageToken ANTES de varrer (o que mudar
// durante a varredura entra depois pela changes API), lista o Drive inteiro em
// páginas de 1000 e grava. A varredura pode levar várias chamadas: o cursor
// (varredura_token) fica em mkt_drive_estado e a próxima chamada continua.
// Depois: changes.list a partir do page_token — só o que mudou.
//
// Quem chama: a tela (botão "Atualizar" e ao abrir) e o cron de hora em hora.
// Orçamento de tempo: para antes do maxDuration e devolve { pendente: true }.
// -----------------------------------------------------------------------------

import { rest } from './_supabaseAdmin.js';
import { drive, lerCredenciais, paraIndice, CAMPOS_ARQUIVO } from './_mktDriveGoogle.js';

const LOTE = 500;

async function lerEstado() {
  return (await rest('mkt_drive_estado?select=*&id=eq.1&limit=1'))?.[0] || null;
}

async function gravarEstado(campos) {
  await rest('mkt_drive_estado?on_conflict=id', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: [{ id: 1, ...campos, atualizado_em: new Date().toISOString() }],
  });
}

/** Grava arquivos no índice sem tocar nas colunas do QS (tags, destino...). */
export async function gravarNoIndice(arquivos, driveId) {
  const linhas = arquivos.filter((f) => f && f.id).map((f) => paraIndice(f, driveId));
  for (let i = 0; i < linhas.length; i += LOTE) {
    await rest('mkt_drive_arquivos?on_conflict=drive_file_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: linhas.slice(i, i + LOTE),
      timeoutMs: 20_000,
    });
  }
  return linhas.length;
}

async function marcarRemovidos(ids) {
  if (!ids.length) return;
  const lista = ids.map((id) => `"${id}"`).join(',');
  await rest(`mkt_drive_arquivos?drive_file_id=in.(${lista})`, {
    method: 'PATCH',
    prefer: 'return=minimal',
    body: { removido: true, na_lixeira: true, sincronizado_em: new Date().toISOString() },
  });
}

/**
 * Roda uma rodada da sincronização dentro de `orcamentoMs`.
 * Devolve { modo, gravados, removidos, pendente }.
 */
export async function sincronizar({ orcamentoMs = 20_000 } = {}) {
  const inicio = Date.now();
  const temTempo = () => Date.now() - inicio < orcamentoMs;
  const { driveId } = lerCredenciais();
  let est = await lerEstado();

  // Drive trocado (MKT_DRIVE_ID novo) ou nunca rodou → recomeça a varredura.
  if (!est || est.drive_id !== driveId || (!est.page_token && !est.varrendo)) {
    const t = await drive('changes/startPageToken', { query: { driveId } });
    est = { drive_id: driveId, page_token: null, token_pendente: t.startPageToken, varrendo: true, varredura_token: null, arquivos_vistos: 0 };
    await gravarEstado({ ...est, ultimo_erro: null });
  }

  let gravados = 0;
  let removidos = 0;

  try {
    if (est.varrendo) {
      let token = est.varredura_token || undefined;
      let vistos = Number(est.arquivos_vistos || 0);
      do {
        const r = await drive('files', {
          query: {
            corpora: 'drive', driveId, includeItemsFromAllDrives: 'true',
            q: 'trashed = false', pageSize: 1000, pageToken: token,
            fields: `nextPageToken,files(${CAMPOS_ARQUIVO})`,
          },
        });
        gravados += await gravarNoIndice(r.files || [], driveId);
        vistos += (r.files || []).length;
        token = r.nextPageToken || null;
        await gravarEstado(token
          ? { varredura_token: token, arquivos_vistos: vistos }
          : { varrendo: false, varredura_token: null, page_token: est.token_pendente, token_pendente: null, arquivos_vistos: vistos, ultima_sync: new Date().toISOString() });
      } while (token && temTempo());
      if (token) return { modo: 'varredura', gravados, removidos, pendente: true };
      est = await lerEstado();
    }

    // Incremental
    let token = est.page_token;
    while (token && temTempo()) {
      const r = await drive('changes', {
        query: {
          driveId, pageToken: token, pageSize: 1000, includeItemsFromAllDrives: 'true',
          includeRemoved: 'true',
          fields: `nextPageToken,newStartPageToken,changes(changeType,fileId,removed,file(${CAMPOS_ARQUIVO}))`,
        },
      });
      const mudancas = (r.changes || []).filter((c) => c.changeType !== 'drive');
      const vivos = mudancas.filter((c) => !c.removed && c.file).map((c) => c.file);
      const mortos = mudancas.filter((c) => c.removed || !c.file).map((c) => c.fileId).filter(Boolean);
      gravados += await gravarNoIndice(vivos, driveId);
      await marcarRemovidos(mortos);
      removidos += mortos.length;
      if (r.nextPageToken) {
        token = r.nextPageToken;
        await gravarEstado({ page_token: token });
      } else {
        token = null;
        await gravarEstado({ page_token: r.newStartPageToken || est.page_token, ultima_sync: new Date().toISOString(), ultimo_erro: null });
        return { modo: 'incremental', gravados, removidos, pendente: false };
      }
    }
    return { modo: 'incremental', gravados, removidos, pendente: !!token };
  } catch (e) {
    await gravarEstado({ ultimo_erro: String(e?.message || e).slice(0, 500) }).catch(() => {});
    throw e;
  }
}
