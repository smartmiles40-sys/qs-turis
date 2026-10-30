# Marketing — área, quadro de conteúdo e aprovação (0240)

Escrito em 30/10/2026. Migration `supabase/migrations/0240_mkt_conteudo.sql` (**ainda não aplicada**).

## O que é

- **Área Marketing**: a 5ª porta do login (magenta), endereço `#mkt/...`. Menu em grupos **Orgânico / Tráfego / Comum** (e Disparos, Automações, E-mail quando as outras frentes entrarem).
- **Quadro de conteúdo** (estilo Trello), o mesmo pro Orgânico e pro Tráfego. Colunas padrão: Ideia / Pedido → Roteiro → Gravação → Edição → Em aprovação → Ajustes → Aprovado → Publicado / Entregue. O gestor muda nome, ordem e cor, e cria ou apaga etapas em *Comum › Colunas do quadro*.
- **Card**: tipo (reels, carrossel, story, vídeo longo, post, criativo de anúncio, campanha), área (Orgânico/Tráfego), responsável, prazo, data de publicação, expedição/pacote do QS, destino, temas, checklist, anexos (link colado; o Drive entra depois), comentários, rodadas de aprovação e histórico.
- **Visões**: Quadro, Lista e Calendário editorial (mês/semana, pela data de publicação). Filtros por área, responsável, tipo, prazo, só atrasados e busca.

## Aprovação (regra no banco, não só na tela)

1. Quem fez move o card pra **Em aprovação** (ou clica em "Pedir aprovação"). Conta uma rodada e o gestor recebe aviso no sino.
2. O **gestor de Marketing** aprova (o card vai pra **Aprovado** e entra na Biblioteca) ou **devolve** (vai pra **Ajustes**, com comentário obrigatório; quem fez recebe o aviso com o comentário).
3. Da aprovação o card só sai aprovado ou devolvido, e só pelo gestor. Ninguém além do gestor põe card em Aprovado. Só vai pra Publicado o que foi aprovado. Reabrir um aprovado pra mexer derruba a aprovação.

Quem aprova: admin, gestor com a área Marketing, ou pessoa do Marketing com o papel **Gestor** em *Comum › Equipe e papéis*.

## Tráfego

- **Pedidos ao Orgânico**: o Tráfego abre um pedido (criativo, campanha, conteúdo). Ele cai na coluna de entrada como "Tráfego · pedido" e o pessoal do Orgânico é avisado.
- **Biblioteca de conteúdos**: tudo que foi aprovado, com filtro por destino, formato e tema. "Reaproveitar para tráfego" cria um card do Tráfego ligado ao original, com os mesmos anexos.

## O que o Bruno precisa fazer

1. **Aplicar a 0240** no Supabase (ela só acrescenta; o rollback está no fim do arquivo).
2. **Dar a porta às pessoas**: em *Configurações › Usuários*, marque "Marketing" em "Também acessa" (ou em "Áreas que gerencia", no caso de gestor). Quem tem o papel **marketing** (hoje, Rafaellen e Carol) ganha a porta sozinho e **continua só leitura no Comercial**.
3. **Definir os papéis** em *Marketing › Comum › Equipe e papéis*: quem é Orgânico, quem é Tráfego, e quem é **Gestor** (aprova). Enquanto ninguém for Gestor, os avisos de aprovação vão para os admins.
4. Publicar o front (branch `mkt-conteudo`), depois de juntar com as outras frentes.

## Para as outras frentes (contrato)

- O menu lê `ROTAS_MKT` de `src/mkt/rotas.ts`. Cada frente exporta `ROTAS_<FRENTE>: RotaMkt[]` em `src/mkt/<frente>/rotas.ts`, e a integração junta tudo no array.
- Tela sem props; a rota é lida com `useRotaMkt()` e a navegação usa `irMkt(tela, id)` (`src/mkt/navegacao.ts`). Pessoas, papéis e "sou aprovador" vêm de `useMkt()` (`src/mkt/contexto.tsx`).
- Banco: use `mkt_tem_acesso()`, `mkt_pode_gerir()` e `mkt_eh_aprovador(uuid)` nas policies das tabelas `mkt_*`. O gatilho de só leitura do papel marketing vale só para `qs_*`.
- **Drive**: registre o seletor com `registrarSeletorDrive(DrivePicker)` (`src/mkt/conteudo/seletorDrive.ts`). O botão "Escolher do Drive" aparece nos anexos do card, e cada arquivo vira uma linha em `mkt_anexos` (`drive_file_id`, `nome`, `mime`, `url`, `thumb`).

## Testes

`node --import ./tests/registrar-ts.mjs --test tests/mkt/*.test.ts` — regras puras (ordem, filtros, atraso, espelho da regra de aprovação, biblioteca, calendário, menu por papel).
