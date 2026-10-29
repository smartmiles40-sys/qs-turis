# ExpedAmigo: o que o QS guarda e como a API vai ler (29/10)

Status: **proposta**. Nada criado no banco ainda. O portal `/amigo` (app antigo) já lê **estas mesmas tabelas** direto.
A API só organiza essa leitura em um pacote só, pra o portal novo (ou outro app) não precisar conhecer o banco.

## Onde se preenche
Cockpit da expedição › aba **ExpedAmigo** (`#ops/expedicoes/<id>?aba=expedamigo`; o antigo `?aba=portal` continua valendo).
Etapas: Acesso → Roteiro → Voos → Hospedagem → Passeios → Informações → Avisos → Líder.
"Copiar de outra expedição" traz Informações, Avisos, Passeios, Extensões e Roteiro (sem anexos).

## Tabelas (todas com `expedicao_id` e `ordem`)
| Etapa | Tabela | Campos que o portal usa |
|---|---|---|
| Acesso | `passageiros.liberado_expedamigo` + `acesso_senhas` (0164/0170) | quem entra; login por CPF + senha |
| Roteiro | `roteiro_dias` (+ `roteiro_dia_fotos`, `passeios_opcionais`) | dia, data, titulo, descricao, cidade, refeicoes, hospedagem, extensao_id, apenas_sem_extensao |
| Voos | `expedicao_voos` | trecho, companhia, numero_voo, localizador, origem, destino, partida, chegada, observacoes, arquivo_id, grupo_id, passageiro_id, extensao_id, apenas_sem_extensao |
| Hospedagem | `expedicoes.hospedagem_voucher_arquivo_id`, `extensoes` | nome, descricao, hospedagem_voucher_arquivo_id |
| Passeios | `expedicao_passeios` | nome, data, horario, local, observacoes, arquivo_id |
| Informações | `expedicao_info` | titulo, conteudo, arquivo_id/_label, arquivo_id_2/_label_2 |
| Avisos | `expedicao_avisos` | tipo (Aviso / Boa prática / Dica), titulo, conteudo |
| Líder | `arquivos` sem passageiro, `descricao = MARCADOR_DOC_LIDER` | documentos da Área do Líder |

## Quem vê o quê (regras que a API precisa aplicar, iguais às do /amigo)
- `extensao_id` preenchido: só quem contratou aquela extensão vê.
- `apenas_sem_extensao = true`: só quem **não** fez extensão vê.
- Os dois vazios: todos veem.
- Voo com `grupo_id`: só os passageiros daquele grupo veem. Voo com `passageiro_id` é individual: quem tem voo próprio vê só os dele.
- Anexo = linha em `arquivos`. O link é assinado na hora (Storage) e nunca vai público.

## Formato proposto da resposta (um passageiro logado)
```json
{
  "expedicao": { "id": "…", "nome": "…", "codigo": "…", "destino": "…", "data_embarque": "2026-11-13", "data_retorno": "2026-11-28" },
  "passageiro": { "id": "…", "nome": "…", "grupo": "G1", "extensoes": ["…"] },
  "roteiro": [{ "dia": 1, "data": "2026-11-13", "titulo": "…", "descricao": "…", "cidade": "…", "refeicoes": "…", "hospedagem": "…",
                "fotos": ["<url assinada>"], "opcionais": [{ "titulo": "…", "descricao": "…", "tipo": "opcional", "foto": "<url>", "whatsapp_url": "…" }] }],
  "voos": [{ "trecho": "Ida", "companhia": "…", "numero_voo": "…", "localizador": "…", "origem": "…", "destino": "…", "partida": "…", "chegada": "…", "voucher": "<url>" }],
  "hospedagem": { "voucher": "<url>", "extensoes": [{ "nome": "…", "descricao": "…", "voucher": "<url>" }] },
  "passeios": [{ "nome": "…", "data": "…", "horario": "…", "local": "…", "observacoes": "…", "voucher": "<url>" }],
  "informacoes": [{ "titulo": "…", "conteudo": "…", "anexos": [{ "rotulo": "…", "url": "<url>" }] }],
  "avisos": [{ "tipo": "Dica", "titulo": "…", "conteudo": "…" }]
}
```

## Caminho sugerido (decidir antes)
1. Uma função no banco, `expedamigo_conteudo(p_passageiro_id)`, `security definer`, que monta o JSON acima já filtrado pelas regras. Precisa de migration, então precisa do ok.
2. Uma Edge Function `expedamigo` que valida o login do viajante (CPF + senha de `acesso_senhas`), chama a função e assina os links dos anexos.
3. O portal novo consome só esse endpoint. O `/amigo` antigo pode continuar lendo as tabelas até ser trocado.

**Pontos em aberto:**
- Login do viajante: continuar com CPF + senha ou trocar por link mágico.
- Por quanto tempo o portal fica aberto depois do retorno.
- Se o líder usa o mesmo endpoint, com um campo `papel`.
