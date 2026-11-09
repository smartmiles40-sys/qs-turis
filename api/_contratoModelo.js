// api/_contratoModelo.js
// -----------------------------------------------------------------------------
// OS DOIS MODELOS DE CONTRATO, DENTRO DO QS (Bruno 27/10/2026: "vamos parar de
// usar o console" — sem Google Docs/Drive). O texto jurídico é CÓPIA FIEL dos
// contratos em uso (Claudia/Japão-China = expedição; Ariane/Itália = pacote),
// inclusive repetições e erros de digitação: quem mexe no texto é o jurídico.
// Mudar uma cláusula = editar a lista abaixo (e só isso).
//
// O que varia por cliente vem dos CAMPOS (preenchidos/corrigidos pelo closer no
// QS) e é padronizado aqui: CPF com máscara, telefone (DDD) número, valor em
// R$ 0.000,00, datas dd/mm/aaaa.
//
// Marcação das cláusulas: "# " = título · "a) " = item · **negrito** · _itálico_
// · "{{INCLUSOS}}" / "{{NAO_INCLUSOS}}" = a lista do pacote (cláusula 1.3).
// PDF: pdfmake (JS puro, roda na função da Vercel). Fontes livres com as mesmas
// medidas das originais: Tinos (= Times New Roman) e Roboto.
// -----------------------------------------------------------------------------
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { formatarCpf, formatarTelefone, formatarValor, dataBr } from './_contrato.js';

const require = createRequire(import.meta.url);
const PdfPrinter = require('pdfmake/src/printer');

const ASSETS = new URL('./_contrato_assets/', import.meta.url);
const ler = (arq) => readFileSync(new URL(arq, ASSETS));
let impressora = null;
let logo = null;
function preparar() {
  if (impressora) return;
  impressora = new PdfPrinter({
    Tinos: { normal: ler('Tinos-Regular.ttf'), bold: ler('Tinos-Bold.ttf'), italics: ler('Tinos-Italic.ttf'), bolditalics: ler('Tinos-BoldItalic.ttf') },
    Roboto: { normal: ler('Roboto-Regular.ttf'), bold: ler('Tinos-Bold.ttf'), italics: ler('Roboto-Regular.ttf'), bolditalics: ler('Tinos-Bold.ttf') },
  });
  logo = `data:image/jpeg;base64,${ler('logo.jpg').toString('base64')}`;
}

/**
 * O que a fonte não desenha vira quadradinho no PDF: ★ → "estrelas"/"*", emoji
 * some. E o hífen dentro da palavra vira hífen inquebrável (senão a justificação
 * abre "boa- fé").
 */
export function limparTexto(s) {
  return String(s ?? '')
    .replace(/(\d)\s*[★☆]/g, '$1 estrelas')
    .replace(/[★☆]/g, '*')
    .replace(/[\u{10000}-\u{10FFFF}️‍]/gu, '')
    .replace(/(\p{L})-(?=\p{L})/gu, '$1‑');
}

// ── Dados fixos de cada modelo (como estão nos contratos de hoje) ──────────
const CONTRATADA_EXPEDICAO = 'pessoa jurídica de direito privado, inscrita no CNPJ sob nº 53.545.815/0001-12, com endereço na Rua Fidêncio Ramos, nº 160, Conjunto 1406 a 1408, Vila Olímpia, São Paulo/SP, CEP 04551-010.';
const CONTRATADA_PACOTE = 'pessoa jurídica de direito privado, inscrita no CNPJ sob nº 53.545.815/0001-12, com endereço na Rua Fidêncio Ramos, nº 160, Conjunto 1406, Vila Olímpia, São Paulo/SP, CEP 04551-010.';
const TESTEMUNHA_1 = { nome: 'Luis Antonio Caetano', cpf: '019.975.493-44' };

// ── EXPEDIÇÃO (texto fiel ao contrato em uso) ───────────────────────────────
const CLAUSULAS_EXPEDICAO = [
  'As partes acima identificadas, doravante denominadas em conjunto **"PARTES"**, afirmam, por livre e espontânea vontade, em comum acordo e pautadas pela boa-fé objetiva, que celebram o presente **CONTRATO DE PRESTAÇÃO DE SERVIÇOS TURÍSTICOS PARA EXPEDIÇÃO INTERNACIONAL EM GRUPO**, o qual se regerá pelas cláusulas e condições a seguir delineadas.',
  '# CLÁUSULA PRIMEIRA – DO OBJETO',
  '1.1. O presente contrato tem por objeto a prestação de serviços turísticos pela CONTRATADA, consistentes na organização, coordenação e execução de expedição internacional em grupo, conforme especificações constantes do QUADRO RESUMO e do roteiro previamente apresentado ao(à) CONTRATANTE, o qual é parte integrante deste contrato, como anexo I.',
  '1.2. Estão inclusos no presente contrato, conforme programação previamente apresentada ao(à) CONTRATANTE:',
  'a) Passagens aéreas internacionais e/ou domésticas, quando expressamente indicado no QUADRO RESUMO;',
  'b) Voos internos e deslocamentos previstos no roteiro;',
  'c) Hospedagens ao longo da expedição, conforme categoria e especificações do roteiro;',
  'd) Transfers e deslocamentos internos previstos;',
  'e) Passeios, experiências e ingressos conforme programação;',
  'f) Acompanhamento de líder da expedição durante todo o período da viagem.',
  '1.3. As datas de início e término previstas no QUADRO RESUMO são estimativas, podendo sofrer ajustes por razões operacionais, logísticas, climáticas, de segurança ou de força maior, sem prejuízo da experiência contratada, mediante comunicação prévia ao(à) CONTRATANTE sempre que possível.',
  '1.4. A vaga na expedição é pessoal e intransferível, salvo se houver tempo hábil para troca de titularidade junto aos fornecedores (companhias aéreas, hotéis, receptivos) e mediante pagamento de eventuais taxas cobradas por estes para a alteração de nome.',
  '1.5. Eventuais serviços adicionais específicos da expedição contratada, tais como cruzeiros fluviais, diárias em cidades adicionais ou experiências diferenciadas, quando aplicáveis, constarão expressamente do roteiro e/ou do QUADRO RESUMO.',
  '1.6. Correm por conta do(a) CONTRATANTE as despesas com vistos, taxas de embarque extras, refeições/bebidas fora do roteiro, gorjetas, gastos pessoais (frigobar, lavanderia, etc.), passeios opcionais, excesso de bagagem, marcação de assentos e qualquer serviço não citado expressamente.',
  '1.7. Caso previsto no Quadro Resumo, a CONTRATADA oferecerá seguro viagem com cobertura adequada de acordo com a expedição como bônus, sem custo adicional; caso contrário, o(a) CONTRATANTE deverá obrigatoriamente contratar seguro viagem internacional válido para todo o período da expedição, com coberturas mínimas adequadas ao destino.',
  '1.8. O(a) CONTRATANTE poderá contratar seguro viagem de sua confiança, mesmo havendo seguro oferecido como bônus pela CONTRATADA, às suas expensas e sem que isso implique em desconto do valor do pacote, considerando que o seguro bônus visa contribuir com a logística da CONTRATADA em caso de incidente durante a expedição.',
  '1.9. A marcação de assentos nos voos é realizada de forma aleatória pela companhia aérea. Caso o(a) CONTRATANTE deseje reservar assento específico, deverá entrar em contato com a CONTRATADA para consultar disponibilidade e valores, ficando ciente de que eventuais custos adicionais correrão por sua conta exclusiva.',
  '1.10. O(a) CONTRATANTE declara estar ciente de que o roteiro apresentado constitui uma previsão de itinerário, não uma promessa imutável. A CONTRATADA reserva-se o direito de realizar alterações no roteiro, mediante comunicação, ordem dos passeios, hotéis, horários ou locais de pernoite, condições climáticas, operacionais, de segurança ou determinações de autoridades.',
  '# CLÁUSULA SEGUNDA – DOS VALORES E DA FORMA DE PAGAMENTO',
  '2.1. Pelos serviços contratados, o(a) CONTRATANTE pagará à CONTRATADA o valor total indicado no QUADRO RESUMO, na forma e condições ali especificadas.',
  '2.2. Em caso de pagamento por cartão de crédito, a quitação poderá ocorrer por meio de link de pagamento eletrônico ou maquineta disponibilizada pela CONTRATADA, sendo considerada válida a autorização da transação como aceite integral das condições financeiras pactuadas.',
  '2.3. Caso as passagens aéreas não estejam inclusas no pacote, conforme indicado no QUADRO RESUMO, o(a) CONTRATANTE:',
  'a) Declara ciência de que é essencial que as passagens sejam adquiridas em datas e horários compatíveis com o roteiro da expedição;',
  'b) Declara que, embora possa haver uma tolerância operacional razoável por parte CONTRATADA, eventuais atrasos, alterações, conexões perdidas, custos adicionais, perda de passeios, transfers ou qualquer prejuízo decorrente da compra de passagens fora dos parâmetros do roteiro podem prejudicar total ou parcialmente sua participação nas atividades da expedição;',
  'c) Reconhece que tais situações não caracterizam falha na prestação dos serviços pela CONTRATADA.',
  '2.4. A inadimplência, parcial ou total, de qualquer valor previsto neste contrato ensejará a incidência de multa moratória de 2% (dois por cento) sobre o valor inadimplido, juros de mora de 1% (um por cento) ao mês e correção monetária pelo IPCA/IBGE acumulado no período. A CONTRATADA poderá adotar todas as medidas extrajudiciais e judiciais para assegurar o pagamento do valor em aberto, incluindo notificação extrajudicial, inscrição nos órgãos de proteção ao crédito (SPC/Serasa), protesto e ação de execução.',
  '2.5. A mora superior a 15 (quinze) dias poderá ensejar a suspensão ou cancelamento da reserva do(a) CONTRATANTE na expedição, obedecendo a política de cancelamento prevista neste contrato.',
  '# CLÁUSULA TERCEIRA – DAS OBRIGAÇÕES DO(A) CONTRATANTE',
  '3.1. São obrigações do(a) CONTRATANTE além daquelas já previstas no presente contrato:',
  'a) Apresentar passaporte válido, com validade mínima de 6 (seis) meses após a data prevista de retorno da viagem, comprovante de vacina (quando aplicável) e outros documentos solicitados;',
  'b) Providenciar, às suas expensas, os vistos consulares exigidos pelos países de destino e/ou escala, quando aplicável;',
  'c) Contratar seguro viagem internacional válido para todo o período da expedição, com coberturas mínimas adequadas ao destino, salvo se a CONTRATADA o tiver incluído como bônus;',
  'd) Manter seus dados cadastrais e de contato atualizados junto à CONTRATADA;',
  'e) Cumprir rigorosamente os horários estabelecidos para passeios, transfers e demais atividades do roteiro:',
  'f) Providenciar os equipamentos obrigatórios eventualmente definidos pela CONTRATADA, sob pena de, por segurança, ser impedido(a) de participar de determinadas atividades, sem direito a reembolso;',
  'g) Respeitar as normas legais, culturais e sociais dos destinos visitados;',
  'h) Obriga-se a seguir os princípios _Leave No Trace_ (não deixe rastros), responsabilizando-se pelo descarte correto de resíduos, preservação integral do ecossistema (fauna, flora e patrimônio) e obediência estrita às normas ambientais do país destino.',
  'i) Seguir as orientações da liderança da expedição e dos guias locais;',
  'j) Manter conduta ética, respeitosa e compatível com a convivência em grupo.',
  '3.2. Tratando-se de expedição em grupo, com vagas limitadas e contratações antecipadas junto a fornecedores sujeitos a prazos rígidos, a pontual entrega da documentação é condição essencial à organização da viagem. O(a) CONTRATANTE deverá encaminhar à CONTRATADA, no prazo improrrogável de 20 (vinte) dias corridos a partir do pagamento da entrada, toda a documentação solicitada. Decorrido esse prazo sem o envio integral, o atraso poderá ser interpretado como desistência tácita do(a) CONTRATANTE da viagem e autorizará a CONTRATADA a rescindir o contrato por inadimplemento, hipótese em que o valor de entrada não será reembolsado, sem prejuízo da retenção de outros valores não reembolsáveis já desembolsados a fornecedores.',
  '3.3. O(a) CONTRATANTE será integral e exclusivamente responsável por todo e qualquer prejuízo que a CONTRATADA venha a sofrer em decorrência de seus atos, omissões ou condutas, incluindo multas ambientais e administrativas, indenizações a terceiros, danos a equipamentos ou patrimônio, custos de defesa judicial e honorários advocatícios. O(a) CONTRATANTE se obriga a ressarcir a CONTRATADA no prazo de 15 (quinze) dias corridos contados da notificação, sob pena de incidência dos encargos moratórios previstos neste contrato, sem prejuízo da cobrança judicial cabível.',
  '3.4. O grupo não aguardará atrasos. Em caso de não comparecimento no horário e local fixados, o CONTRATANTE deverá alcançar o grupo por conta própria, assumindo todos os custos decorrentes, sem direito a reembolso, descontos ou compensação pelas atividades perdidas.',
  '3.5. Salvo se expressamente incluído pela CONTRATADA como bônus, a contratação do seguro viagem é de responsabilidade exclusiva do(a) CONTRATANTE, ainda que haja indicação por parte da CONTRATADA. A apresentação da apólice poderá ser exigida como condição de embarque, sob pena de impedimento da participação e aplicação das penalidades de cancelamento e deve incluir despesas médicas, hospitalares e odontológicas, traslados (médico e de corpo), regresso sanitário e cobertura para as atividades do roteiro.',
  '3.6. O(a) CONTRATANTE reconhece que o líder da expedição designado pela CONTRATADA possui autoridade plena para tomar decisões visando a segurança, o bem-estar e o bom andamento da viagem, devendo suas orientações serem seguidas por todos os participantes, estando o líder autorizado, inclusive, a:',
  'a) Alterar ordem, horário, local de atividades ou pernoites;',
  'b) Impedir ou interromper a participação de qualquer integrante em atividades específicas ou na expedição quando julgar ausentes as condições físicas, técnicas ou emocionais adequadas, ou quando o comportamento do participante coloque em risco a si próprio ou ao grupo, sem que isso gere direito a reembolso, compensação ou indenização;',
  'c) Tomar quaisquer outras decisões necessárias à preservação da integridade física e segurança do grupo.',
  '3.7. O Contratante declara possuir condições físicas e psicológicas adequadas, não ter omitido informações médicas relevantes e estar ciente dos riscos inerentes à atividade turística de aventura, assumindo tais riscos que não decorram de culpa da CONTRATADA.',
  '3.8. A omissão de informações de saúde relevantes ou a prestação de informações falsas pelo(a) CONTRATANTE que venham a causar problemas durante a expedição isenta a CONTRATADA de qualquer responsabilidade, podendo ensejar a exclusão do(a) CONTRATANTE da expedição, sem direito a reembolso. A CONTRATADA reserva-se o direito de exigir declaração médica adicional para participantes com condições de saúde que possam representar risco durante a expedição.',
  '3.9. O(a) CONTRATANTE declara estar ciente de que a expedição envolve riscos inerentes à atividade turística de aventura e exploração, incluindo, mas não se limitando a: condições climáticas adversas e imprevisíveis, terrenos acidentados e de difícil acesso, locais remotos com acesso limitado, riscos naturais, atividades físicas de intensidade variada, interação com culturas, costumes e ambientes diversos. O(a) CONTRATANTE aceita participar da expedição sob estas condições, assumindo os riscos inerentes que não decorram de culpa ou dolo da CONTRATADA.',
  '# CLÁUSULA QUARTA – DAS OBRIGAÇÕES DA CONTRATADA',
  '4.1. A CONTRATADA obriga-se a:',
  'a) Organizar e coordenar a expedição conforme roteiro previamente apresentado, respeitadas as possibilidades de alteração previstas neste contrato;',
  'b) Disponibilizar líder de expedição capacitado para acompanhar o grupo durante todo o período da viagem;',
  'c) Efetuar as reservas de hospedagem, transporte, passeios e demais serviços inclusos no pacote junto aos fornecedores;',
  'd) Prestar assistência ao(à) CONTRATANTE durante a expedição, orientando-o(a) sobre procedimentos, horários e cuidados necessários;',
  'e) Comunicar tempestivamente quaisquer alterações relevantes no roteiro ou nos serviços contratados.',
  '4.2. A CONTRATADA obrigando-se a empregar seus melhores esforços para garantir a qualidade da experiência. Todavia, a CONTRATADA não se responsabiliza por eventos alheios à sua vontade e fora de seu controle, tais como: problemas com companhias aéreas, greves, condições climáticas, restrições governamentais ou sanitárias, extravio, dano ou furto de bagagens por terceiros; acidentes, doenças ou problemas de saúde do(a) CONTRATANTE; atos de terceiros; e quaisquer outros eventos caracterizados como força maior ou caso fortuito.',
  '4.3. A CONTRATADA não se responsabiliza por atos, omissões ou comportamentos de outros participantes do grupo, de terceiros ou de fornecedores locais que possam causar desconforto, constrangimento ou prejuízo ao(à) CONTRATANTE. Eventuais conflitos ou incompatibilidades entre participantes não constituem falha na prestação do serviço e não ensejam direito a reembolso ou indenização. O(a) CONTRATANTE que sofrer dano causado por outro participante deverá buscar reparação diretamente contra o causador, isentando a CONTRATADA de qualquer responsabilidade solidária ou subsidiária.',
  '4.4. A CONTRATADA atuará como intermediária na comunicação com fornecedores e companhias aéreas em caso de problemas, porém as soluções e compensações dependerão das políticas de cada prestador de serviço.',
  '# CLÁUSULA QUINTA – DAS REGRAS DE CONVIVÊNCIA, CONDUTA E EXCLUSÃO DO GRUPO',
  '5.1. O(a) CONTRATANTE deverá manter conduta ética, respeitosa e compatível com a convivência em grupo durante toda a expedição.',
  '5.2. É expressamente vedado ao(à) CONTRATANTE:',
  'a) Praticar qualquer ato que configure assédio moral ou sexual contra qualquer pessoa;',
  'b) Praticar condutas discriminatórias, ofensivas ou preconceituosas de qualquer natureza;',
  'c) Praticar agressões verbais ou físicas contra qualquer pessoa;',
  'd) Consumir álcool ou substâncias de forma excessiva que comprometa sua participação nas atividades ou cause constrangimento ao grupo;',
  'e) Praticar atos ilícitos de qualquer natureza;',
  'f) Adotar comportamentos que coloquem em risco a segurança, integridade ou bem-estar do grupo;',
  'g) Hospedar, receber ou permitir a entrada de pessoas estranhas à expedição no quarto de hotel, especialmente quando estiver dividindo acomodação com outro(a) participante da expedição.',
  '5.3. Caso o(a) CONTRATANTE apresente comportamento inadequado, ainda que não expressamente previsto nesta cláusula, mas que cause danos morais, comprometa a harmonia do grupo, coloque terceiros em risco ou viole a legislação local ou brasileira, o líder da expedição e/ou CONTRATADA poderá adotar as medidas necessárias para preservar o bem-estar coletivo, incluindo advertência verbal ou escrita, afastamento temporário de atividades específicas em grupo, e exclusão definitiva do(a) CONTRATANTE da expedição em grupo.',
  '5.4. A exclusão definitiva da expedição nos termos desta cláusula será comunicada formalmente ao(à) CONTRATANTE e implicará:',
  'a) Perda do direito a qualquer reembolso dos valores pagos;',
  'b) Responsabilidade exclusiva do(a) CONTRATANTE por todas as despesas decorrentes de sua situação a partir da exclusão, incluindo hospedagem, alimentação, transporte e retorno ao Brasil;',
  'c) O participante excluído: (i) poderá continuar a viagem por conta própria, de forma independente do grupo, sendo que não haverá nenhum custo para a Contratada;',
  '5.5. A decisão de exclusão será tomada pelo líder da expedição, sempre pautada na razoabilidade, proporcionalidade e no interesse coletivo, podendo ser revista posteriormente pela CONTRATADA, sem prejuízo das medidas já adotadas em campo',
  '# CLÁUSULA SEXTA – DA POLÍTICA DE CANCELAMENTO',
  '6.1. O(a) CONTRATANTE poderá exercer o direito de arrependimento no prazo de 7 (sete) dias corridos a contar da contratação, conforme previsto no art. 49 do Código de Defesa do Consumidor, desde que a contratação tenha sido realizada fora do estabelecimento comercial e que a expedição ainda não tenha sido iniciada.',
  '6.2. Decorrido o prazo de 7 (sete) dias da contratação, o cancelamento por iniciativa do(a) CONTRATANTE ficará sujeito às seguintes condições de reembolso, considerando o tempo restante até a data de início da expedição:',
  'a) Cancelamento comunicado com 181 (cento e oitenta e um) dias ou mais de antecedência: Reembolso de 90% (noventa por cento) do valor pago;',
  'b) Cancelamento comunicado entre 180 (cento e oitenta) e 121 (cento e vinte e um) dias de antecedência: Reembolso de 50% (cinquenta por cento) do valor pago;',
  'c) Cancelamento comunicado entre 120 (cento e vinte) e 61 (sessenta e um) dias de antecedência: Reembolso de 20% (vinte por cento) do valor pago;',
  'd) Cancelamento comunicado com 60 (sessenta) dias ou menos de antecedência: Sem direito a reembolso, considerando a existência de bloqueios contratuais, pagamentos antecipados a fornecedores, custos operacionais e logísticos, e a inviabilidade de revenda da vaga.',
  '6.3. Os percentuais de reembolso da cláusula anterior consideram que a organização de expedições internacionais exige contratações antecipadas junto a fornecedores, tais como hotéis, receptivos locais e cruzeiros, com políticas restritivas de cancelamento. Quanto mais próximo da data de início da expedição, maior o comprometimento financeiro e menor a possibilidade de revenda da vaga, justificando a redução progressiva do reembolso.',
  '6.4. O pedido de cancelamento deverá ser formalizado por escrito, por e-mail ou outro meio que permita comprovação de recebimento, sendo considerada como data do cancelamento a data de recebimento da comunicação pela CONTRATADA.',
  '6.5. O pedido de cancelamento deverá ser formalizado por escrito, por e-mail ou outro meio que permita comprovação de recebimento, sendo considerada como data do cancelamento a data de recebimento da comunicação pela CONTRATADA. A desistência tácita por não envio tempestivo da documentação rege-se pela Cláusula 3.2, não se sujeitando aos percentuais de reembolso desta cláusula quanto ao valor de entrada, que será integralmente retido.',
  '6.6. A análise de casos excepcionais será feita individualmente pela CONTRATADA, não gerando precedente ou direito adquirido a outros contratantes ou situações.',
  '6.7. O cancelamento integral da expedição pela CONTRATADA ocorrerá exclusivamente por motivo de força maior ou caso fortuito.',
  '6.8. Na hipótese de cancelamento integral pela CONTRATADA por força maior, será oferecido ao(à) CONTRATANTE:',
  'a) Reagendamento para nova data, sem custos adicionais, desde que mantidas as mesmas condições do pacote; ou',
  'b) Devolução dos valores pagos, conforme as políticas de reembolso dos fornecedores envolvidos.',
  '6.9. Não será devida multa ou indenização adicional em favor do(a) CONTRATANTE nas hipóteses de força maior ou caso fortuito.',
  '# CLÁUSULA SÉTIMA – DA CESSÃO DE USO DE IMAGEM, VOZ E NOME',
  '7.1. O(a) CONTRATANTE autoriza, de forma irrevogável e irretratável, a CONTRATADA a utilizar sua imagem, voz e nome captados durante a execução do presente contrato, em qualquer meio de comunicação físico ou digital, nacional ou internacional, incluindo mas não se limitando a redes sociais, websites, e-mails, anúncios pagos, aplicativos de mensagens, vídeos, podcasts, materiais impressos, apresentações comerciais, eventos de turismo e conteúdos patrocinados, para fins de promoção, divulgação e comercialização dos serviços, preservando a integridade e memória visual das expedições realizadas.',
  '7.2. Esta autorização permanecerá válida durante toda a vigência deste contrato e por período adicional de 5 (cinco) anos contados da data de retorno da expedição ao Brasil, independentemente do motivo da rescisão, sendo assegurado à CONTRATADA o direito de manter acessíveis, por prazo indeterminado e a título de acervo histórico, os conteúdos já publicados organicamente em suas plataformas durante a vigência da autorização, sendo vedada apenas a sua reutilização para novos anúncios ou ações comerciais ativas após o referido período. O(a) CONTRATANTE reconhece expressamente que a presente autorização não poderá ser revogada durante o prazo estipulado, visando a segurança jurídica do acervo publicitário da agência.',
  '7.3. O(a) CONTRATANTE declara que a utilização ora autorizada não ensejará qualquer remuneração adicional, renunciando expressamente a qualquer pretensão de indenização, inclusive a título de danos morais, materiais ou por direitos conexos de imagem. A CONTRATADA poderá editar, adaptar, cortar ou compilar a imagem, voz e nome do(a) CONTRATANTE para os fins descritos nesta cláusula, desde que respeitada sua integridade moral e a boa-fé contratual.',
  '7.4. A CONTRATADA compromete-se a utilizar a imagem, voz e nome do(a) CONTRATANTE de forma ética, respeitosa e em conformidade com a legislação vigente, sendo expressamente vedado qualquer uso que possa desonrar, ridicularizar ou denegrir a imagem do(a) CONTRATANTE.',
  '# CLÁUSULA OITAVA – DA PROTEÇÃO DE DADOS PESSOAIS (LGPD)',
  '8.1. A CONTRATADA se obriga a cumprir integralmente as disposições da Lei Geral de Proteção de Dados (LGPD) – Lei nº 13.709/2018, e demais normativas aplicáveis, no que tange ao tratamento, armazenamento, utilização e proteção dos dados pessoais do(a) CONTRATANTE, comprometendo-se a utilizá-los apenas para as finalidades estritamente necessárias à execução das atividades previstas neste contrato (logística e segurança da expedição), sendo vedada a utilização para quaisquer outros fins.',
  '8.2. A CONTRATADA deverá notificar o(a) CONTRATANTE imediatamente sobre qualquer incidente de segurança envolvendo dados pessoais, incluindo mas não se limitando a acessos não autorizados, vazamentos de listas de passageiros, perdas ou extravios de documentos, fornecendo todas as informações relevantes para avaliação e resposta ao incidente, responsabilizando-se por quaisquer danos, perdas ou prejuízos causados ao(à) CONTRATANTE ou terceiros em decorrência do descumprimento das obrigações previstas nesta cláusula, incluindo multas administrativas, indenizações e custos de defesa.',
  '# CLÁUSULA NONA – DA PROPRIEDADE INTELECTUAL',
  '9.1. A integralidade do material produzido durante as expedições ou em função delas, incluindo mas não se limitando a conteúdos fotográficos, audiovisuais, textuais, roteiros, diários de bordo, relatórios de viagem, metodologias de condução de grupos, tabelas, gráficos, e-books e apresentações, será de propriedade exclusiva da CONTRATADA, com direito autoral integral e definitivo. A CONTRATADA terá o direito de utilizar, reproduzir, distribuir, adaptar, modificar, exibir, divulgar, comercializar e explorar tais materiais de qualquer forma e em qualquer meio, sem limitação temporal ou territorial.',
  '9.2. O uso posterior dos materiais pela CONTRATADA, incluindo em novos pacotes turísticos, campanhas publicitárias, cursos, mentorias, eventos, materiais de divulgação e plataformas digitais, independe de nova autorização do(a) CONTRATANTE. Caso os materiais envolvam imagem, voz ou nome do(a) CONTRATANTE, a CONTRATADA terá o direito de utilizá-los para os fins descritos nesta cláusula, sem que isso gere qualquer direito a remuneração adicional ou necessidade de nova autorização.',
  '9.3. É expressamente vedado ao(à) CONTRATANTE, sem autorização prévia, expressa e por escrito da CONTRATADA, utilizar, reproduzir, distribuir, adaptar, modificar, exibir, divulgar, compartilhar, comercializar ou explorar materiais, conteúdos, informações e dados recebidos ou criados no presente contrato (como roteiros detalhados ou fotos dos grupos) fora do escopo contratual, bem como destiná-los a finalidades profissionais, promocionais ou comerciais de qualquer natureza.',
  '# CLÁUSULA DÉCIMA – DO SIGILO E DA CONFIDENCIALIDADE',
  '10.1. O(a) CONTRATANTE se obriga a manter sigilo absoluto e confidencialidade, durante a vigência deste contrato e por prazo indeterminado após o seu encerramento, sobre toda informação, dado, documento, lista de passageiros (rooming list), dados de fornecedores, tarifas confidenciais, roteiros detalhados, plano de marketing, know-how operacional ou qualquer elemento ao qual tenha acesso em razão deste contrato. Presume-se confidencial toda informação acessada que não seja pública ou autorizada pela CONTRATADA para divulgação.',
  '10.2. É vedado ao(à) CONTRATANTE, sem autorização prévia e expressa: divulgar, reproduzir, compartilhar ou utilizar informações confidenciais fora dos canais designados; realizar cópias pessoais ou backups não autorizados em dispositivos próprios; utilizar informações para benefício próprio ou de terceiros, inclusive para roteiros concorrentes; mencionar informações confidenciais em redes sociais, eventos, materiais promocionais ou comunicações externas. A divulgação ou uso indevido sujeitará o(a) CONTRATANTE às penalidades legais cabíveis e indenização por perdas e danos.',
  '10.3. A obrigação de sigilo permanece válida após o término do contrato, independentemente do motivo da rescisão, enquanto a informação não se tornar pública por ato legítimo da CONTRATADA. Exceções somente serão válidas se autorizadas por escrito pela CONTRATADA, especificando conteúdo, destinatários e limites da divulgação.',
  '# CLÁUSULA DÉCIMA PRIMEIRA – DAS DISPOSIÇÕES GERAIS',
  '11.1. Este contrato obriga as partes e seus respectivos sucessores a qualquer título, sendo vedada a sua cessão ou transferência, total ou parcial, a terceiros, sem o prévio e expresso consentimento, por escrito, da outra parte.',
  '11.2. Quaisquer alterações, aditamentos ou modificações a este contrato somente serão válidos e eficazes se formalizados por escrito, mediante termo aditivo.',
  '11.3. A tolerância de qualquer das partes em relação ao descumprimento de qualquer obrigação prevista neste contrato pela outra parte não será interpretada como renúncia, novação ou perdão, nem implicará em precedente, mas apenas como mera liberalidade.',
  '11.4. A eventual nulidade ou invalidade de qualquer cláusula ou condição deste contrato não afetará a validade e eficácia das demais cláusulas e condições, que permanecerão em pleno vigor e efeito.',
  '11.5. Este contrato constitui título executivo extrajudicial, nos termos do artigo 784, inciso III, do Código de Processo Civil, sendo plenamente exigível em juízo, inclusive para cobrança de valores, penalidades, obrigações de fazer ou não fazer, ou qualquer outro dever assumido pelas partes neste instrumento.',
  '11.6. Este contrato constitui título executivo extrajudicial (CPC, art. 784, III), elegendo-se o foro da Comarca de São Paulo/SP para dirimir controvérsias, com renúncia a qualquer outro.',
  '11.7. As assinaturas digitais constituem prova documental válida para todos os fins. O(a) CONTRATANTE declara ter lido, compreendido e aceito integralmente todas as cláusulas deste instrumento.',
  'E, para firmeza e como prova de assim haverem contratado, fizeram este instrumento particular, assinado pelas partes contratantes e pelas testemunhas abaixo, a tudo presentes.',
];

// ── PACOTE (texto fiel ao contrato em uso) ──────────────────────────────────
const CLAUSULAS_PACOTE = [
  'As partes acima identificadas, doravante denominadas em conjunto **"PARTES"**, afirmam, por livre e espontânea vontade, em comum acordo e pautadas pela boa-fé objetiva, que celebram o presente **CONTRATO DE PRESTAÇÃO DE SERVIÇOS**, o qual se regerá pelas cláusulas e condições a seguir delineadas.',
  'O presente instrumento reflete a vontade negociada e equitativa das partes, sendo fruto de esclarecimento prévio, autonomia da vontade e equilíbrio contratual, aplicando-lhes os princípios gerais do direito civil e do Código de Defesa do Consumidor, com especial observância aos deveres de cooperação, lealdade e transparência mútua.',
  '# CLÁUSULA PRIMEIRA - DO OBJETO',
  '1.1. O presente contrato tem como objeto a prestação, pela CONTRATADA, de serviços de intermediação de viagens turísticas para a CONTRATANTE, conforme detalhamento constante no Quadro Resumo e na Proposta Comercial anexa (Anexo I), que integram este instrumento para todos os fins de direito.',
  '1.2. A CONTRATADA atua como intermediadora entre a CONTRATANTE e os fornecedores de serviços turísticos (hotéis, companhias aéreas, empresas de transporte, seguradoras, operadoras de passeios e demais prestadores), não sendo responsável pela execução direta dos serviços.',
  '1.3. Os serviços de intermediação estão previstos na Proposta Comercial e incluem:',
  '{{INCLUSOS}}',
  '{{NAO_INCLUSOS}}',
  '1.4. Quaisquer serviços não expressamente previstos na Proposta Comercial serão considerados como não inclusos, devendo ser contratados e pagos à parte pela CONTRATANTE.',
  '1.5. A marcação de assentos nos voos é realizada de forma aleatória pela companhia aérea. Caso o(a) CONTRATANTE deseje reservar assento específico, deverá entrar em contato com a CONTRATADA para consultar disponibilidade e valores, ficando ciente de que eventuais custos adicionais correrão por sua conta exclusiva.',
  '# CLÁUSULA SEGUNDA - DOS VALORES E FORMA DE PAGAMENTO',
  '2.1. Pelos serviços contratados, o(a) CONTRATANTE pagará à CONTRATADA o valor total indicado no QUADRO RESUMO, na forma e condições ali especificadas.',
  '2.2. Em caso de pagamento por cartão de crédito, a quitação poderá ocorrer por meio de link de pagamento eletrônico ou maquineta disponibilizada pela CONTRATADA, sendo considerada válida a autorização da transação como aceite integral das condições financeiras pactuadas.',
  '2.3. A inadimplência, parcial ou total, de qualquer valor previsto neste contrato ensejará a incidência de multa moratória de 2% (dois por cento) sobre o valor inadimplido, juros de mora de 1% (um por cento) ao mês e correção monetária pelo IPCA/IBGE acumulado no período. A CONTRATADA poderá adotar todas as medidas extrajudiciais e judiciais para assegurar o pagamento do valor em aberto, incluindo notificação extrajudicial, inscrição nos órgãos de proteção ao crédito (SPC/Serasa), protesto e ação de execução.',
  '2.4. A mora poderá ensejar a suspensão ou cancelamento da reserva do(a) CONTRATANTE na expedição, obedecendo a política de cancelamento prevista neste contrato.',
  '# CLÁUSULA TERCEIRA - DAS OBRIGAÇÕES DA CONTRATANTE',
  '3.1. São obrigações da CONTRATANTE:',
  'a) Fornecer informações verdadeiras, completas e atualizadas, responsabilizando-se pela veracidade de todos os dados prestados, incluindo documentos de identidade, endereço, contatos e demais informações solicitadas pela CONTRATADA;',
  'b) Efetuar os pagamentos nas datas acordadas, sob pena de aplicação das penalidades previstas neste contrato;',
  'c) Providenciar, com antecedência adequada, toda a documentação necessária para a realização da viagem, incluindo passaporte válido, vistos consulares, autorizações de viagem para menores, carteira de vacinação internacional, comprovantes de seguro saúde, e demais documentos exigidos pelas autoridades nacionais e internacionais;',
  'd) Comparecer nos locais, datas e horários estipulados para embarque, traslados e passeios, estando ciente de que atrasos ou ausências implicará perda do serviço contratado, sem direito a reembolso ou compensação;',
  'e) Respeitar as normas de segurança, regulamentos locais, legislação vigente nos destinos visitados e boas práticas de convivência social;',
  'f) Zelar pela conservação de seus pertences pessoais, incluindo documentos, valores, equipamentos eletrônicos e bagagens, estando ciente de que a CONTRATADA não se responsabiliza por perdas, roubos, furtos ou danos;',
  'g) Contratar seguro viagem adequado às suas necessidades, especialmente para destinos internacionais, sendo tal contratação fortemente recomendada pela CONTRATADA;',
  'h) Arcar com todas as despesas não incluídas no pacote contratado, tais como refeições, bebidas, gorjetas, telefonemas, lavanderia, frigobar, serviços opcionais, bagagens adicionais, taxas governamentais locais e quaisquer outros itens de caráter pessoal;',
  'i) Verificar as regras específicas de bagagem da companhia aérea ou transportadora contratada, responsabilizando-se pelo pagamento de eventuais sobretaxas em caso de excesso de peso ou volume.',
  '# CLÁUSULA QUARTA - DAS OBRIGAÇÕES DA CONTRATADA',
  '4.1. São obrigações da CONTRATADA:',
  'a) Intermediar a contratação dos serviços turísticos junto aos fornecedores selecionados, conforme especificações constantes na Proposta Comercial;',
  'b) Prestar informações claras e precisas sobre os serviços ofertados, incluindo itinerário, hospedagem, transporte, documentação necessária e demais detalhes relevantes;',
  'c) Fornecer à CONTRATANTE todos os vouchers, bilhetes, comprovantes e documentos necessários para a fruição dos serviços contratados;',
  'd) Disponibilizar canais de atendimento para suporte antes, durante e após a viagem, dentro do horário comercial ou conforme acordado;',
  'e) Atuar de forma diligente na resolução de eventuais problemas operacionais, dentro dos limites de sua atuação como intermediadora.',
  '4.2. A CONTRATADA não se responsabiliza por:',
  'a) Atos, omissões, falhas, atrasos, cancelamentos, overbooking, alterações de itinerário ou qualquer problema decorrente da prestação de serviços pelos Fornecedores, os quais são os únicos responsáveis pela execução dos serviços por eles prestados;',
  'b) Perdas, roubos, furtos, extravios ou danos a bagagens, documentos, valores ou pertences pessoais da CONTRATANTE;',
  'c) Doenças, acidentes, lesões corporais ou qualquer dano à integridade física ou psíquica da CONTRATANTE durante a viagem;',
  'd) Casos fortuitos ou de força maior, incluindo fenômenos naturais, condições climáticas adversas, epidemias, pandemias, guerras, atos terroristas, greves, protestos, restrições governamentais, fechamento de fronteiras ou qualquer evento imprevisível e inevitável;',
  'e) Falta ou irregularidade de documentos da CONTRATANTE, incluindo passaporte, vistos, autorizações ou certificados de vacinação;',
  'f) Insolvência, falência ou encerramento das atividades de quaisquer Fornecedores;',
  'g) Comportamentos inadequados, infrações legais ou violações de regulamentos cometidos pela CONTRATANTE.',
  '4.3. **Da Força Maior e Caso Fortuito:** Em caso de fenomenos naturais, epidemias, pandemias, calamidade pública, atos terroristas, guerras, greves, restrições governamentais, condições climáticas adversas que comprometam a segurança, ou qualquer evento imprevisível e inevitável, a CONTRATADA poderá alterar, suspender ou cancelar a viagem, antes de seu início ou em qualquer etapa de sua execução.',
  '4.4. Nessas hipóteses, será devida a restituição apenas dos valores correspondentes aos serviços efetivamente não utilizados e passíveis de reembolso pelos fornecedores, deduzidas as despesas já incorridas. A CONTRATADA não responderá por danos materiais, morais ou lucros cessantes decorrentes desses eventos, nem por insolvência ou falência dos fornecedores.',
  '# CLÁUSULA QUINTA - DA POLÍTICA DE ALTERAÇÃO, CANCELAMENTO E REEMBOLSO',
  '5.1. Para contratos celebrados fora do estabelecimento comercial (online, telefone, WhatsApp ou similares), o CONTRATANTE poderá exercer o direito de arrependimento no prazo de 7 (sete) dias corridos contados da data da contratação, conforme artigo 49 do Código de Defesa do Consumidor, sem necessidade de justificativa.',
  '5.2. O exercício do direito de arrependimento deverá ser comunicado por escrito à CONTRATADA (e-mail, WhatsApp ou outro meio acordado), ocasião em que será realizado o reembolso integral dos valores pagos, EXCETO passagens aéreas, terrestres ou marítimas que já tenham sido emitidas há mais de 24 (vinte e quatro) horas da contratação, hipótese em que se aplicará a Resolução ANAC nº 400/2016 e as regras tarifárias específicas da companhia de transporte, podendo haver retenção integral do valor da passagem conforme condições da tarifa contratada.',
  '5.3. Após o prazo de arrependimento previsto nesta cláusula, a CONTRATANTE poderá cancelar a viagem, observadas as condições específicas da Proposta Comercial anexa via e-mail, que estabelecerá:',
  'a) Prazos de cancelamento;',
  'b) Percentuais de multa aplicáveis conforme a antecedência do cancelamento;',
  'c) Políticas específicas dos Fornecedores (hotéis, companhias aéreas, operadoras de passeios);',
  'd) Condições de conversão de valores em créditos para futuras viagens.',
  '5.4. Além das multas previstas, a CONTRATANTE estará sujeita às políticas de cancelamento específicas de cada Fornecedor (companhias aéreas, hotéis, seguradoras, operadoras de passeios), as quais poderão implicar retenção adicional ou total dos valores pagos aos respectivos fornecedores.',
  '5.5. Solicitações de alteração de datas, destinos, quantidade de passageiros, categoria de hospedagem ou quaisquer outros itens da viagem estarão sujeitas a:',
  'a) Disponibilidade dos Fornecedores;',
  'b) Pagamento de taxas de alteração cobradas pela CONTRATADA e pelos Fornecedores;',
  'c) Pagamento de eventuais diferenças de valores decorrentes da alteração.',
  '5.6. Alterações solicitadas com menos de 30 (trinta) dias de antecedência da data de viagem estarão sujeitas às mesmas penalidades previstas para cancelamento.',
  '5.7. O não comparecimento da CONTRATANTE no local, data e horário previstos para embarque, traslado ou início de qualquer serviço, implicará perda total do direito a reembolso ou compensação, considerando-se como desistência da viagem após iniciada sua execução.',
  '5.8. A CONTRATADA poderá cancelar a viagem, sem aplicação de penalidades à CONTRATANTE, nas seguintes hipóteses:',
  'a) Condições climáticas adversas que comprometam a segurança dos passageiros;',
  'b) Motivos técnico-operacionais que impeçam o cumprimento total ou parcial do roteiro;',
  'c) Casos de força maior ou caso fortuito.',
  '5.9. Nessas hipóteses, a CONTRATANTE poderá optar por: (i) remarcação da viagem para nova data; (ii) conversão do valor pago em créditos para utilização em futura viagem; ou (iii) reembolso integral dos valores pagos decotada das despesas não reembolsáveis.',
  '# CLÁUSULA SEXTA - DAS DISPOSIÇÕES COMPLEMENTARES',
  '**Dos documentos**: Para viagens nacionais, a CONTRATANTE deverá portar documento de identidade original (RG, CNH ou outro documento oficial com foto) em bom estado e dentro do prazo de validade.',
  '6.1. Para viagens internacionais, a CONTRATANTE deverá portar passaporte válido (com no mínimo 6 meses de validade a partir da data de embarque), vistos consulares quando exigidos pelo país de destino, e demais documentos específicos.',
  '6.2. É de exclusiva responsabilidade do CONTRATANTE a obtenção de toda a documentação necessária, incluindo vistos, autorizações de viagem para menores, certificados de vacinação e demais exigências legais, devendo consultar os consulados e autoridades competentes com antecedência adequada.',
  '6.3. **Da Viagem de Menores**: Para viagens de menores de idade desacompanhados dos pais ou acompanhados de apenas um dos genitores, será necessária autorização expressa dos responsáveis legais, com firma reconhecida.',
  '6.4. Para viagens internacionais de menores, recomenda-se consulta prévia ao Juizado da Infância e Juventude para verificação de exigências específicas.',
  '6.5. **Do Seguro Viagem**: O seguro viagem é fortemente recomendado pela CONTRATADA, especialmente para destinos internacionais, sendo obrigatório para países signatários do Tratado de Schengen (Europa).',
  '6.6. Quando contratado através da **CONTRATADA**, o seguro viagem estará sujeito às condições, coberturas, exclusões e limitações estabelecidas pela seguradora, devendo a CONTRATANTE ler atentamente a apólice.',
  '6.7. **Da Bagagem**: A CONTRATANTE deverá observar as regras de bagagem estabelecidas pelas companhias de transporte (peso, dimensões, quantidade de volumes), responsabilizando-se pelo pagamento de eventuais taxas de excesso.',
  '6.8. Em caso de danos ou extravios de bagagem, a CONTRATANTE deverá apresentar reclamação imediata à companhia de transporte responsável, pois a CONTRATADA não responde por tais ocorrências.',
  '6.9. **Das Despesas Não Incluídas**: Salvo expressa menção em contrário na Proposta Comercial, não estão incluídos no pacote: despesas com vistos consulares, taxas de embarque, taxas de turismo, taxas de resort, vacinas, refeições extras, bebidas, gorjetas, telefonemas, lavanderia, frigobar, bagagens despachadas, seguros, passeios opcionais e quaisquer outros itens de caráter pessoal.',
  '6.10. **Das Condições Especiais de Saúde**: A CONTRATANTE portadora de necessidades especiais, mobilidade reduzida, condições médicas que exijam cuidados específicos ou que faça uso contínuo de medicamentos deverá informar à CONTRATADA previamente à contratação, para que sejam verificadas as condições de atendimento junto aos Fornecedores.',
  '6.11. **Dos Traslados e Passeios:** Os serviços de traslado (transfers) e passeios eventualmente incluídos no pacote poderão ser realizados de forma compartilhada com outros passageiros ou de forma privativa, conforme especificado na Proposta Comercial, sendo executados em veículos adequados à frota do fornecedor responsável.',
  '6.12. **Da Pontualidade:** A CONTRATANTE deverá comparecer pontualmente no local, data e horário estipulados para o início de cada serviço. Os veículos e grupos não poderão aguardar passageiros retardatários, ainda que o atraso seja justificado. O não comparecimento ou atraso implicará perda do direito ao serviço, sem direito a reembolso, compensação ou remarcação.',
  '# CLÁUSULA SÉTIMA – DA CESSÃO DE USO DE IMAGEM, VOZ E NOME',
  '7.1. O(a) CONTRATANTE autoriza, de forma irrevogável e irretratável, a CONTRATADA a utilizar sua imagem, voz e nome captados durante a execução do presente contrato, em qualquer meio de comunicação físico ou digital, nacional ou internacional, incluindo mas não se limitando a redes sociais, websites, e-mails, anúncios pagos, aplicativos de mensagens, vídeos, podcasts, materiais impressos, apresentações comerciais, eventos de turismo e conteúdos patrocinados, para fins de promoção, divulgação e comercialização dos serviços, preservando a integridade e memória visual das viagens realizadas.',
  '7.2. Esta autorização permanecerá válida durante toda a vigência deste contrato e por período adicional de 5 (cinco) anos contados da data de retorno da viagem ao Brasil, independentemente do motivo da rescisão, sendo assegurado à CONTRATADA o direito de manter acessíveis, por prazo indeterminado e a título de acervo histórico, os conteúdos já publicados organicamente em suas plataformas durante a vigência da autorização, sendo vedada apenas a sua reutilização para novos anúncios ou ações comerciais ativas após o referido período. O(a) CONTRATANTE reconhece expressamente que a presente autorização não poderá ser revogada durante o prazo estipulado, visando a segurança jurídica do acervo publicitário da agência.',
  '7.3. O(a) CONTRATANTE declara que a utilização ora autorizada não ensejará qualquer remuneração adicional, renunciando expressamente a qualquer pretensão de indenização, inclusive a título de danos morais, materiais ou por direitos conexos de imagem. A CONTRATADA poderá editar, adaptar, cortar ou compilar a imagem, voz e nome do(a) CONTRATANTE para os fins descritos nesta cláusula, desde que respeitada sua integridade moral e a boa-fé contratual.',
  '7.4. A CONTRATADA compromete-se a utilizar a imagem, voz e nome do(a) CONTRATANTE de forma ética, respeitosa e em conformidade com a legislação vigente, sendo expressamente vedado qualquer uso que possa desonrar, ridicularizar ou denegrir a imagem do(a) CONTRATANTE.',
  '# CLÁUSULA OITAVA – DA PROTEÇÃO DE DADOS PESSOAIS (LGPD)',
  '8.1. A CONTRATADA se obriga a cumprir integralmente as disposições da Lei Geral de Proteção de Dados (LGPD) – Lei nº 13.709/2018, e demais normativas aplicáveis, no que tange ao tratamento, armazenamento, utilização e proteção dos dados pessoais do(a) CONTRATANTE, comprometendo-se a utilizá-los apenas para as finalidades estritamente necessárias à execução das atividades previstas neste contrato (intermediação e organização dos serviços turísticos), sendo vedada a utilização para quaisquer outros fins.',
  '8.2. A CONTRATADA deverá notificar a CONTRATANTE, no prazo de 24 (vinte e quatro) horas, sobre qualquer incidente de segurança envolvendo dados pessoais, incluindo mas não se limitando a acessos não autorizados, vazamentos de listas de passageiros, perdas ou extravios de documentos, fornecendo todas as informações relevantes para avaliação e resposta ao incidente, responsabilizando-se por quaisquer danos, perdas ou prejuízos causados ao(à) CONTRATANTE ou terceiros em decorrência do descumprimento das obrigações previstas nesta cláusula, incluindo multas administrativas, indenizações e custos de defesa.',
  '# CLÁUSULA NONA – DA PROPRIEDADE INTELECTUAL',
  '9.1. A integralidade do material produzido durante as viagens ou em função delas, incluindo mas não se limitando a conteúdos fotográficos, audiovisuais, textuais, roteiros, relatórios de viagem, metodologias de organização de grupos, tabelas, gráficos, e-books e apresentações, será de propriedade exclusiva da CONTRATADA, com direito autoral integral e definitivo. A CONTRATADA terá o direito de utilizar, reproduzir, distribuir, adaptar, modificar, exibir, divulgar, comercializar e explorar tais materiais de qualquer forma e em qualquer meio, sem limitação temporal ou territorial.',
  '9.2. O uso posterior dos materiais pela CONTRATADA, incluindo em novos pacotes turísticos, campanhas publicitárias, cursos, mentorias, eventos, materiais de divulgação e plataformas digitais, independe de nova autorização do(a) CONTRATANTE. Caso os materiais envolvam imagem, voz ou nome do(a) CONTRATANTE, a CONTRATADA terá o direito de utilizá-los para os fins descritos nesta cláusula, sem que isso gere qualquer direito a remuneração adicional ou necessidade de nova autorização.',
  '9.3. É expressamente vedado ao (à) CONTRATANTE, sem autorização prévia, expressa e por escrito da CONTRATADA, utilizar, reproduzir, distribuir, adaptar, modificar, exibir, divulgar, compartilhar, comercializar ou explorar materiais, conteúdos, informações e dados recebidos ou criados no presente contrato (como roteiros detalhados ou fotos dos grupos) fora do escopo contratual, bem como destiná-los a finalidades profissionais, promocionais ou comerciais de qualquer natureza.',
  '# CLÁUSULA DÉCIMA – DO SIGILO E DA CONFIDENCIALIDADE',
  '10.1. O(a) CONTRATANTE se obriga a manter sigilo absoluto e confidencialidade, durante a vigência deste contrato e por prazo indeterminado após o seu encerramento, sobre toda informação, dado, documento, lista de passageiros (rooming list), dados de fornecedores, tarifas confidenciais, roteiros detalhados, plano de marketing, know-how operacional ou qualquer elemento ao qual tenha acesso em razão deste contrato. Presume-se confidencial toda informação acessada que não seja pública ou autorizada pela CONTRATADA para divulgação.',
  '10.2. É vedado ao(à) CONTRATANTE, sem autorização prévia e expressa: divulgar, reproduzir, compartilhar ou utilizar informações confidenciais fora dos canais designados; realizar cópias pessoais ou backups não autorizados em dispositivos próprios; utilizar informações para benefício próprio ou de terceiros, inclusive para roteiros concorrentes; mencionar informações confidenciais em redes sociais, eventos, materiais promocionais ou comunicações externas. A divulgação ou uso indevido sujeitará o(a) CONTRATANTE às penalidades legais cabíveis e indenização por perdas e danos.',
  '10.3. A obrigação de sigilo permanece válida após o término do contrato, independentemente do motivo da rescisão, enquanto a informação não se tornar pública por ato legítimo da CONTRATADA. Exceções somente serão válidas se autorizadas por escrito pela CONTRATADA, especificando conteúdo, destinatários e limites da divulgação.',
  '# CLÁUSULA DÉCIMA PRIMEIRA – DAS DISPOSIÇÕES GERAIS',
  '11.1. Este contrato obriga as partes e seus respectivos sucessores a qualquer título, sendo vedada a sua cessão ou transferência, total ou parcial, a terceiros, sem o prévio e expresso consentimento, por escrito, da outra parte.',
  '11.2. Quaisquer alterações, aditamentos ou modificações a este contrato somente serão válidos e eficazes se formalizados por escrito, mediante termo aditivo.',
  '11.3. A tolerância de qualquer das partes em relação ao descumprimento de qualquer obrigação prevista neste contrato pela outra parte não será interpretada como renúncia, novação ou perdão, nem implicará em precedente, mas apenas como mera liberalidade.',
  '11.4. A eventual nulidade ou invalidade de qualquer cláusula ou condição deste contrato não afetará a validade e eficácia das demais cláusulas e condições, que permanecerão em pleno vigor e efeito.',
  '11.5. Este contrato constitui título executivo extrajudicial, nos termos do artigo 784, inciso III, do Código de Processo Civil, sendo plenamente exigível em juízo, inclusive para cobrança de valores, penalidades, obrigações de fazer ou não fazer, ou qualquer outro dever assumido pelas partes neste instrumento.',
  '11.6. As partes elegem o foro da Comarca de São Paulo/SP para dirimir controvérsias, com renúncia a qualquer outro.',
  '11.7. As assinaturas digitais constituem prova documental válida para todos os fins. O(a) CONTRATANTE declara ter lido, compreendido e aceito integralmente todas as cláusulas deste instrumento.',
  'E, para firmeza e como prova de assim haverem contratado, fizeram deste instrumento particular, assinado pelas partes contratantes e pelas testemunhas abaixo, a todos presentes.',
];

// ── Marcação → pdfmake ──────────────────────────────────────────────────────
/** "texto **negrito** _itálico_" → [{text}, {text, bold}, {text, italics}] */
function trechos(s) {
  const out = [];
  for (const p of limparTexto(s).split(/(\*\*[^*]+\*\*|_[^_\s][^_]*_)/).filter(Boolean)) {
    let t;
    if (p.startsWith('**') && p.endsWith('**')) t = { text: p.slice(2, -2), bold: true };
    else if (p.length > 2 && p.startsWith('_') && p.endsWith('_')) t = { text: p.slice(1, -1), italics: true };
    else t = { text: p };
    // Pontuação colada no trecho anterior (senão a justificação põe espaço antes da vírgula).
    const ant = out[out.length - 1];
    const cola = !t.bold && !t.italics && ant && (ant.bold || ant.italics) ? t.text.match(/^[.,;:)]+/) : null;
    if (cola) { ant.text += cola[0]; t.text = t.text.slice(cola[0].length); }
    if (t.text) out.push(t);
  }
  return out;
}

const RECUO_ITEM = 18;      // a) b) c) ficam recuados como no original
const ESPACO = 10;          // entre parágrafos

function item(letra, conteudo) {
  return {
    columns: [{ width: 18, text: `${letra})` }, { width: '*', text: conteudo, alignment: 'justify' }],
    columnGap: 0, margin: [RECUO_ITEM, 0, 0, 2],
  };
}

/** Lista da cláusula 1.3 do pacote: 1 item por linha; "Rótulo: texto" sai com o rótulo em negrito. */
export function linhasDosInclusos(texto) {
  return String(texto || '').split('\n').map((l) => l.replace(/^\s*(?:[a-z]\)|[-•*]|\d+[.)])\s*/i, '').trim()).filter(Boolean);
}
function blocoInclusos(texto) {
  const linhas = linhasDosInclusos(texto);
  const letra = (i) => (i < 26 ? String.fromCharCode(97 + i) : `${String.fromCharCode(97 + Math.floor(i / 26) - 1)}${String.fromCharCode(97 + (i % 26))}`);
  return linhas.map((l, i) => {
    const m = l.match(/^([^:]{1,60}):\s*(.*)$/);
    return item(letra(i), m ? [{ text: `${limparTexto(m[1])}:`, bold: true }, ` ${limparTexto(m[2])}`] : limparTexto(l));
  });
}

function corpo(lista, c) {
  const out = [];
  for (const linha of lista) {
    if (linha === '{{INCLUSOS}}') { const b = blocoInclusos(c.inclusos); if (b.length) out.push({ stack: b, margin: [0, 0, 0, ESPACO - 2] }); continue; }
    if (linha === '{{NAO_INCLUSOS}}') {
      if (String(c.nao_inclusos || '').trim()) out.push({ text: [{ text: 'Não inclusos:', bold: true }, ` ${limparTexto(String(c.nao_inclusos).trim())}`], margin: [0, 0, 0, ESPACO] });
      continue;
    }
    if (linha.startsWith('# ')) { out.push({ text: linha.slice(2), bold: true, alignment: 'left', margin: [0, 6, 0, ESPACO] }); continue; }
    const it = linha.match(/^([a-z])\)\s(.*)$/);
    if (it) { out.push(item(it[1], trechos(it[2]))); continue; }
    // Item seguido de parágrafo: o espaço vem do último item da lista.
    const anterior = out[out.length - 1];
    if (anterior?.columns) anterior.margin = [RECUO_ITEM, 0, 0, ESPACO];
    out.push({ text: trechos(linha), margin: [0, 0, 0, ESPACO] });
  }
  return out;
}

// ── Quadro resumo ───────────────────────────────────────────────────────────
const VAZIO = '-';
const v = (x) => (limparTexto(String(x ?? '').trim()) || VAZIO);
const periodo = (c) => (c.ida || c.volta ? `${v(dataBr(c.ida))} a ${v(dataBr(c.volta))}` : VAZIO);
export const valorEmReais = (x) => { const f = formatarValor(x); return /\d/.test(f) ? `R$ ${f}` : v(x); };

function linhaQuadro(rotulo, conteudo, roboto = false) {
  return [
    { text: rotulo, bold: true, fillColor: '#EFEFEF', alignment: 'left', margin: [6, 6, 6, 6] },
    { text: conteudo, alignment: 'left', margin: [6, 6, 6, 6], ...(roboto ? { font: 'Roboto', fontSize: 11 } : {}) },
  ];
}
const tabelaQuadro = (linhas) => ({
  table: { widths: [134, '*'], body: linhas },
  layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
  margin: [0, 0, 0, 16],
});

// RG e VIAJANTE (09/11) só aparecem quando preenchidos: o quadro dos contratos
// de hoje não tem essas linhas e não deve ganhar um "-" à toa.
const temTexto = (x) => String(x ?? '').trim() !== '';
const linhaViajante = (c) => (temTexto(c.viajante) ? [linhaQuadro('VIAJANTE', v(c.viajante))] : []);

function quadroExpedicao(c) {
  return tabelaQuadro([
    linhaQuadro('CONTRATANTE', [
      `Nome: ${v(c.nome)}\n`, `CPF: ${v(formatarCpf(c.cpf))}\n`, ...(temTexto(c.rg) ? [`RG: ${v(c.rg)}\n`] : []), `Endereço: ${v(c.endereco)}\n`,
      `E-mail: ${v(c.email)}\n`, `Telefone: ${v(formatarTelefone(c.telefone))}`,
    ]),
    ...linhaViajante(c),
    linhaQuadro('CONTRATADA', [{ text: 'SE TU FOR, EU VOU AGÊNCIA DE VIAGENS LTDA', bold: true }, `., ${CONTRATADA_EXPEDICAO}`]),
    linhaQuadro('EXPEDIÇÃO', v(c.expedicao), true),
    linhaQuadro('PERÍODO PREVISTO', periodo(c), true),
    linhaQuadro('VALOR TOTAL', valorEmReais(c.valor_total), true),
    linhaQuadro('FORMA DE PAGAMENTO', v(c.forma_pagamento), true),
    linhaQuadro('PASSAGEM AÉREA', v(c.passagem), true),
    linhaQuadro('SEGURO DE VIAGEM', v(c.seguro)),
  ]);
}

function quadroPacote(c) {
  const dado = (rot, val) => [`${rot}: `, { text: `${v(val)}\n`, bold: true }];
  return tabelaQuadro([
    linhaQuadro('CONTRATANTE', [
      ...dado('Nome', c.nome), ...dado('CPF', formatarCpf(c.cpf)), ...(temTexto(c.rg) ? dado('RG', c.rg) : []), ...dado('E-mail', c.email),
      ...dado('Telefone', formatarTelefone(c.telefone)), ...dado('Data de nascimento', dataBr(c.nascimento)),
      'Endereço completo: ', { text: v(c.endereco), bold: true },
    ]),
    ...linhaViajante(c),
    linhaQuadro('CONTRATADA', [{ text: 'SE TU FOR, EU VOU AGÊNCIA DE VIAGENS LTDA', bold: true }, `., ${CONTRATADA_PACOTE}`]),
    linhaQuadro('DESTINO', v(c.destino)),
    linhaQuadro('PERÍODO:', periodo(c)),
    linhaQuadro('TIPO DE PACOTE', v(c.tipo_pacote)),
    linhaQuadro('VALOR TOTAL', valorEmReais(c.valor_total), true),
    linhaQuadro('FORMA DE PAGAMENTO', v(c.forma_pagamento), true),
  ]);
}

// ── Assinaturas (como no original) ──────────────────────────────────────────
const LINHA = '_________________________________________________';
function assinaturasExpedicao(c) {
  const testemunha = (rot, t) => ({
    width: '*', stack: ['________________________________', rot, { text: `Nome: ${t?.nome || ''}`, margin: [0, 8, 0, 0] }, `CPF: ${t?.cpf || ''}`],
  });
  return {
    unbreakable: true,
    margin: [0, 14, 0, 0],
    stack: [
      { text: `São Paulo/SP, ${v(dataBr(c.data_venda))}`, margin: [0, 0, 0, 14] },
      { text: 'CONTRATANTE:', bold: true, margin: [0, 0, 0, 18] },
      LINHA, { text: v(c.nome), margin: [0, 0, 0, 14] },
      { text: 'CONTRATADA:', bold: true, margin: [0, 0, 0, 18] },
      LINHA, { text: 'SE TU FOR, EU VOU AGÊNCIA DE VIAGENS LTDA.', bold: true, margin: [0, 0, 0, 14] },
      { text: 'TESTEMUNHAS:', margin: [0, 0, 0, 18] },
      { columns: [testemunha('TESTEMUNHA 1', TESTEMUNHA_1), testemunha('TESTEMUNHA 2', null)], columnGap: 40 },
    ],
  };
}
function assinaturasPacote(c) {
  const traco = { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 280, y2: 0, lineWidth: 1.5 }] };
  return {
    unbreakable: true,
    margin: [0, 14, 0, 0],
    stack: [
      { text: `São Paulo/SP, ${v(dataBr(c.data_venda))}`, margin: [0, 0, 0, 50] },
      traco, { text: v(c.nome), bold: true, margin: [0, 2, 0, 50] },
      traco, { text: 'Se Tu For, Eu Vou Viagens LTDA', bold: true, margin: [0, 2, 0, 0] },
    ],
  };
}

// ── Anexo I: o roteiro da expedição (09/11) ─────────────────────────────────
// A cláusula 1.1 da expedição cita o roteiro "como anexo I". Com roteiro (vem
// de roteiro_dias pela prévia; o closer pode ajustar), o anexo sai numa página
// nova depois das assinaturas. Sem roteiro, a 1.1 deixa de citar o anexo.
const CITA_ANEXO = ', o qual é parte integrante deste contrato, como anexo I.';
const SEM_ANEXO = ', o qual é parte integrante deste contrato.';
export const temRoteiro = (c) => c.tipo === 'expedicao' && temTexto(c.roteiro);
export function clausulasDe(c) {
  if (c.tipo !== 'expedicao') return CLAUSULAS_PACOTE;
  return temRoteiro(c) ? CLAUSULAS_EXPEDICAO : CLAUSULAS_EXPEDICAO.map((l) => (l.startsWith('1.1. ') ? l.replace(CITA_ANEXO, SEM_ANEXO) : l));
}
/** "Dia N …" abre um dia (sai em negrito); as linhas seguintes são a descrição. */
export function blocosDoRoteiro(texto) {
  const dias = [];
  for (const bruta of String(texto || '').replace(/\r/g, '').split('\n')) {
    const l = bruta.trim();
    if (!l) continue;
    if (/^dia\s+\d+/i.test(l) || !dias.length) dias.push({ titulo: l, linhas: [] });
    else dias[dias.length - 1].linhas.push(l);
  }
  return dias;
}
function anexoRoteiro(c) {
  const dias = blocosDoRoteiro(c.roteiro);
  return [
    { text: 'ANEXO I – ROTEIRO DA EXPEDIÇÃO', bold: true, alignment: 'center', pageBreak: 'before', margin: [0, 0, 0, 6] },
    { text: v(c.expedicao), alignment: 'center', margin: [0, 0, 0, 16] },
    ...dias.map((d) => ({
      unbreakable: d.linhas.length < 12,
      margin: [0, 0, 0, ESPACO],
      stack: [
        { text: limparTexto(d.titulo), bold: true, alignment: 'left', margin: [0, 0, 0, 3] },
        ...d.linhas.map((l) => ({ text: limparTexto(l), alignment: 'left', fontSize: 11 })),
      ],
    })),
  ];
}

// ── Documento ───────────────────────────────────────────────────────────────
export function definicaoDoContrato(c) {
  preparar();
  const exp = c.tipo === 'expedicao';
  const cabecalho = exp
    ? [
      { text: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS TURÍSTICOS', bold: true, alignment: 'center' },
      { text: 'EXPEDIÇÃO INTERNACIONAL EM GRUPO', bold: true, alignment: 'center', margin: [0, 0, 0, 16] },
      { text: 'QUADRO RESUMO', bold: true, alignment: 'center', margin: [0, 0, 0, 14] },
    ]
    : [
      { text: 'CONTRATO DE PRESTAÇÃO DE SERVIÇOS TURÍSTICOS', bold: true, alignment: 'center', margin: [0, 0, 0, 6] },
      { text: 'QUADRO RESUMO DO CONTRATO', bold: true, alignment: 'center', margin: [0, 0, 0, 22] },
    ];
  return {
    pageSize: exp ? 'A4' : 'LETTER',
    pageMargins: exp ? [71, 82, 71, 56] : [72, 88, 72, 64],
    // Logo: no de expedição em todas as páginas; no de pacote só na 1ª (como hoje).
    header: (pagina) => (exp || pagina === 1
      ? { image: logo, width: exp ? 75 : 70, margin: exp ? [18, 23, 0, 0] : [20, 32, 0, 0] }
      : null),
    info: { title: `Contrato de ${exp ? 'Expedição' : 'Pacote'} - ${c.nome || ''}`, author: 'SE TU FOR, EU VOU AGÊNCIA DE VIAGENS LTDA.', creator: 'QS' },
    defaultStyle: { font: 'Tinos', fontSize: 12, lineHeight: 1.08, alignment: 'justify' },
    content: [
      ...cabecalho,
      exp ? quadroExpedicao(c) : quadroPacote(c),
      ...corpo(clausulasDe(c), c),
      exp ? assinaturasExpedicao(c) : assinaturasPacote(c),
      ...(temRoteiro(c) ? anexoRoteiro(c) : []),
    ],
  };
}

/** Gera o PDF do contrato (Buffer). Os campos já vêm normalizados (normalizarCampos). */
export function gerarPdfDoContrato(c) {
  const def = definicaoDoContrato(c);
  return new Promise((resolve, reject) => {
    try {
      const doc = impressora.createPdfKitDocument(def);
      const partes = [];
      doc.on('data', (b) => partes.push(b));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
