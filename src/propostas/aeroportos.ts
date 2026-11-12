// src/propostas/aeroportos.ts
// -----------------------------------------------------------------------------
// Código IATA → cidade e aeroporto, pro cartão do voo no padrão do bilhete
// ("NAT · Natal, RN · Aeroporto Aluízio Alves"). Código fora da lista aparece
// só com as letras. `fuso` (UTC, sem horário de verão) só nos do Brasil: a
// duração do voo só é calculada quando os DOIS aeroportos são daqui — fora do
// país o horário de verão muda o fuso e a conta sairia errada.
// -----------------------------------------------------------------------------
export interface Aeroporto { cidade: string; nome: string; fuso?: number; /** País em português (11/11: lista ampliada). */ pais?: string }

export const AEROPORTOS: Record<string, Aeroporto> = {
  // Brasil
  GRU: { cidade: "São Paulo, SP", nome: "Aeroporto de Guarulhos", fuso: -3 },
  CGH: { cidade: "São Paulo, SP", nome: "Aeroporto de Congonhas", fuso: -3 },
  VCP: { cidade: "Campinas, SP", nome: "Aeroporto de Viracopos", fuso: -3 },
  GIG: { cidade: "Rio de Janeiro, RJ", nome: "Aeroporto do Galeão", fuso: -3 },
  SDU: { cidade: "Rio de Janeiro, RJ", nome: "Aeroporto Santos Dumont", fuso: -3 },
  BSB: { cidade: "Brasília, DF", nome: "Aeroporto de Brasília", fuso: -3 },
  CNF: { cidade: "Belo Horizonte, MG", nome: "Aeroporto de Confins", fuso: -3 },
  PLU: { cidade: "Belo Horizonte, MG", nome: "Aeroporto da Pampulha", fuso: -3 },
  NAT: { cidade: "Natal, RN", nome: "Aeroporto Aluízio Alves", fuso: -3 },
  REC: { cidade: "Recife, PE", nome: "Aeroporto dos Guararapes", fuso: -3 },
  FOR: { cidade: "Fortaleza, CE", nome: "Aeroporto Pinto Martins", fuso: -3 },
  SSA: { cidade: "Salvador, BA", nome: "Aeroporto de Salvador", fuso: -3 },
  JPA: { cidade: "João Pessoa, PB", nome: "Aeroporto Castro Pinto", fuso: -3 },
  MCZ: { cidade: "Maceió, AL", nome: "Aeroporto Zumbi dos Palmares", fuso: -3 },
  AJU: { cidade: "Aracaju, SE", nome: "Aeroporto de Aracaju", fuso: -3 },
  THE: { cidade: "Teresina, PI", nome: "Aeroporto de Teresina", fuso: -3 },
  SLZ: { cidade: "São Luís, MA", nome: "Aeroporto de São Luís", fuso: -3 },
  BEL: { cidade: "Belém, PA", nome: "Aeroporto de Belém", fuso: -3 },
  MAO: { cidade: "Manaus, AM", nome: "Aeroporto Eduardo Gomes", fuso: -4 },
  CGB: { cidade: "Cuiabá, MT", nome: "Aeroporto Marechal Rondon", fuso: -4 },
  CGR: { cidade: "Campo Grande, MS", nome: "Aeroporto de Campo Grande", fuso: -4 },
  PVH: { cidade: "Porto Velho, RO", nome: "Aeroporto de Porto Velho", fuso: -4 },
  RBR: { cidade: "Rio Branco, AC", nome: "Aeroporto de Rio Branco", fuso: -5 },
  BVB: { cidade: "Boa Vista, RR", nome: "Aeroporto de Boa Vista", fuso: -4 },
  MCP: { cidade: "Macapá, AP", nome: "Aeroporto de Macapá", fuso: -3 },
  PMW: { cidade: "Palmas, TO", nome: "Aeroporto de Palmas", fuso: -3 },
  GYN: { cidade: "Goiânia, GO", nome: "Aeroporto Santa Genoveva", fuso: -3 },
  VIX: { cidade: "Vitória, ES", nome: "Aeroporto de Vitória", fuso: -3 },
  CWB: { cidade: "Curitiba, PR", nome: "Aeroporto Afonso Pena", fuso: -3 },
  IGU: { cidade: "Foz do Iguaçu, PR", nome: "Aeroporto das Cataratas", fuso: -3 },
  FLN: { cidade: "Florianópolis, SC", nome: "Aeroporto Hercílio Luz", fuso: -3 },
  NVT: { cidade: "Navegantes, SC", nome: "Aeroporto de Navegantes", fuso: -3 },
  POA: { cidade: "Porto Alegre, RS", nome: "Aeroporto Salgado Filho", fuso: -3 },
  FEN: { cidade: "Fernando de Noronha, PE", nome: "Aeroporto de Noronha", fuso: -2 },
  BPS: { cidade: "Porto Seguro, BA", nome: "Aeroporto de Porto Seguro", fuso: -3 },
  IOS: { cidade: "Ilhéus, BA", nome: "Aeroporto de Ilhéus", fuso: -3 },
  JJD: { cidade: "Jericoacoara, CE", nome: "Aeroporto de Jericoacoara", fuso: -3 },
  LEC: { cidade: "Lençóis, BA", nome: "Aeroporto da Chapada Diamantina", fuso: -3 },
  // América do Sul e Central
  EZE: { cidade: "Buenos Aires", nome: "Aeroporto de Ezeiza" },
  AEP: { cidade: "Buenos Aires", nome: "Aeroparque Jorge Newbery" },
  BRC: { cidade: "Bariloche", nome: "Aeroporto de Bariloche" },
  USH: { cidade: "Ushuaia", nome: "Aeroporto de Ushuaia" },
  FTE: { cidade: "El Calafate", nome: "Aeroporto de El Calafate" },
  MDZ: { cidade: "Mendoza", nome: "Aeroporto de Mendoza" },
  SCL: { cidade: "Santiago", nome: "Aeroporto Arturo Merino Benítez" },
  CJC: { cidade: "Calama", nome: "Aeroporto El Loa (Atacama)" },
  PUQ: { cidade: "Punta Arenas", nome: "Aeroporto de Punta Arenas" },
  PNT: { cidade: "Puerto Natales", nome: "Aeroporto de Puerto Natales" },
  LIM: { cidade: "Lima", nome: "Aeroporto Jorge Chávez" },
  CUZ: { cidade: "Cusco", nome: "Aeroporto de Cusco" },
  MVD: { cidade: "Montevidéu", nome: "Aeroporto de Carrasco" },
  ASU: { cidade: "Assunção", nome: "Aeroporto Silvio Pettirossi" },
  BOG: { cidade: "Bogotá", nome: "Aeroporto El Dorado" },
  CTG: { cidade: "Cartagena", nome: "Aeroporto de Cartagena" },
  UIO: { cidade: "Quito", nome: "Aeroporto de Quito" },
  GPS: { cidade: "Galápagos", nome: "Aeroporto de Baltra" },
  PTY: { cidade: "Cidade do Panamá", nome: "Aeroporto de Tocumen" },
  MEX: { cidade: "Cidade do México", nome: "Aeroporto Benito Juárez" },
  CUN: { cidade: "Cancún", nome: "Aeroporto de Cancún" },
  PUJ: { cidade: "Punta Cana", nome: "Aeroporto de Punta Cana" },
  HAV: { cidade: "Havana", nome: "Aeroporto José Martí" },
  // América do Norte
  MIA: { cidade: "Miami", nome: "Aeroporto de Miami" },
  MCO: { cidade: "Orlando", nome: "Aeroporto de Orlando" },
  FLL: { cidade: "Fort Lauderdale", nome: "Aeroporto de Fort Lauderdale" },
  JFK: { cidade: "Nova York", nome: "Aeroporto JFK" },
  EWR: { cidade: "Nova York", nome: "Aeroporto de Newark" },
  ATL: { cidade: "Atlanta", nome: "Aeroporto de Atlanta" },
  IAH: { cidade: "Houston", nome: "Aeroporto de Houston" },
  DFW: { cidade: "Dallas", nome: "Aeroporto de Dallas" },
  ORD: { cidade: "Chicago", nome: "Aeroporto O'Hare" },
  LAX: { cidade: "Los Angeles", nome: "Aeroporto de Los Angeles" },
  SFO: { cidade: "São Francisco", nome: "Aeroporto de São Francisco" },
  LAS: { cidade: "Las Vegas", nome: "Aeroporto de Las Vegas" },
  YYZ: { cidade: "Toronto", nome: "Aeroporto Pearson" },
  // Europa
  LIS: { cidade: "Lisboa", nome: "Aeroporto Humberto Delgado" },
  OPO: { cidade: "Porto", nome: "Aeroporto Francisco Sá Carneiro" },
  MAD: { cidade: "Madri", nome: "Aeroporto de Barajas" },
  BCN: { cidade: "Barcelona", nome: "Aeroporto El Prat" },
  CDG: { cidade: "Paris", nome: "Aeroporto Charles de Gaulle" },
  ORY: { cidade: "Paris", nome: "Aeroporto de Orly" },
  FCO: { cidade: "Roma", nome: "Aeroporto de Fiumicino" },
  MXP: { cidade: "Milão", nome: "Aeroporto de Malpensa" },
  VCE: { cidade: "Veneza", nome: "Aeroporto Marco Polo" },
  AMS: { cidade: "Amsterdã", nome: "Aeroporto de Schiphol" },
  FRA: { cidade: "Frankfurt", nome: "Aeroporto de Frankfurt" },
  MUC: { cidade: "Munique", nome: "Aeroporto de Munique" },
  ZRH: { cidade: "Zurique", nome: "Aeroporto de Zurique" },
  LHR: { cidade: "Londres", nome: "Aeroporto de Heathrow" },
  LGW: { cidade: "Londres", nome: "Aeroporto de Gatwick" },
  DUB: { cidade: "Dublin", nome: "Aeroporto de Dublin" },
  IST: { cidade: "Istambul", nome: "Aeroporto de Istambul" },
  SAW: { cidade: "Istambul", nome: "Aeroporto Sabiha Gökçen" },
  NAV: { cidade: "Capadócia", nome: "Aeroporto de Nevşehir" },
  ATH: { cidade: "Atenas", nome: "Aeroporto de Atenas" },
  JTR: { cidade: "Santorini", nome: "Aeroporto de Santorini" },
  KEF: { cidade: "Reykjavík", nome: "Aeroporto de Keflavík" },
  CPH: { cidade: "Copenhague", nome: "Aeroporto de Copenhague" },
  OSL: { cidade: "Oslo", nome: "Aeroporto de Gardermoen" },
  TOS: { cidade: "Tromsø", nome: "Aeroporto de Tromsø" },
  HEL: { cidade: "Helsinque", nome: "Aeroporto de Helsinque" },
  RVN: { cidade: "Rovaniemi", nome: "Aeroporto de Rovaniemi" },
  PRG: { cidade: "Praga", nome: "Aeroporto Václav Havel" },
  VIE: { cidade: "Viena", nome: "Aeroporto de Viena" },
  BUD: { cidade: "Budapeste", nome: "Aeroporto de Budapeste" },
  // Oriente Médio e África
  DXB: { cidade: "Dubai", nome: "Aeroporto de Dubai" },
  AUH: { cidade: "Abu Dhabi", nome: "Aeroporto de Abu Dhabi" },
  DOH: { cidade: "Doha", nome: "Aeroporto Hamad" },
  CAI: { cidade: "Cairo", nome: "Aeroporto do Cairo" },
  RAK: { cidade: "Marrakech", nome: "Aeroporto Menara" },
  CMN: { cidade: "Casablanca", nome: "Aeroporto Mohammed V" },
  JNB: { cidade: "Joanesburgo", nome: "Aeroporto O. R. Tambo" },
  CPT: { cidade: "Cidade do Cabo", nome: "Aeroporto da Cidade do Cabo" },
  ADD: { cidade: "Adis Abeba", nome: "Aeroporto de Bole" },
  // Ásia e Oceania
  NRT: { cidade: "Tóquio", nome: "Aeroporto de Narita" },
  HND: { cidade: "Tóquio", nome: "Aeroporto de Haneda" },
  KIX: { cidade: "Osaka", nome: "Aeroporto de Kansai" },
  ITM: { cidade: "Osaka", nome: "Aeroporto de Itami" },
  PEK: { cidade: "Pequim", nome: "Aeroporto Capital" },
  PKX: { cidade: "Pequim", nome: "Aeroporto de Daxing" },
  PVG: { cidade: "Xangai", nome: "Aeroporto de Pudong" },
  SHA: { cidade: "Xangai", nome: "Aeroporto de Hongqiao" },
  CAN: { cidade: "Cantão", nome: "Aeroporto de Baiyun" },
  XIY: { cidade: "Xi'an", nome: "Aeroporto de Xianyang" },
  CTU: { cidade: "Chengdu", nome: "Aeroporto de Tianfu" },
  KWL: { cidade: "Guilin", nome: "Aeroporto de Liangjiang" },
  HKG: { cidade: "Hong Kong", nome: "Aeroporto de Hong Kong" },
  ICN: { cidade: "Seul", nome: "Aeroporto de Incheon" },
  BKK: { cidade: "Bangkok", nome: "Aeroporto Suvarnabhumi" },
  DMK: { cidade: "Bangkok", nome: "Aeroporto Don Mueang" },
  HKT: { cidade: "Phuket", nome: "Aeroporto de Phuket" },
  CNX: { cidade: "Chiang Mai", nome: "Aeroporto de Chiang Mai" },
  SIN: { cidade: "Singapura", nome: "Aeroporto de Changi" },
  DPS: { cidade: "Bali", nome: "Aeroporto de Denpasar" },
  SGN: { cidade: "Ho Chi Minh", nome: "Aeroporto Tan Son Nhat" },
  HAN: { cidade: "Hanói", nome: "Aeroporto Noi Bai" },
  DEL: { cidade: "Nova Délhi", nome: "Aeroporto Indira Gandhi" },
  MLE: { cidade: "Maldivas", nome: "Aeroporto de Malé" },
  SYD: { cidade: "Sydney", nome: "Aeroporto de Sydney" },
  AKL: { cidade: "Auckland", nome: "Aeroporto de Auckland" },
};

// ── Lista ampliada (11/11/2026, IATA obrigatório na venda — src/venda/iata.ts) ──
// Estática (nada é baixado em tempo de execução). Uma linha por aeroporto.
// Brasil: "COD|Cidade|UF|Aeroporto" (fuso pela UF; exceções no FUSO_BR_COD).
// Mundo:  "COD|Cidade|País|Aeroporto". O que já está no objeto acima vale (só ganha o país).
const FUSO_UF: Record<string, number> = { AC: -5, AM: -4, MT: -4, MS: -4, RO: -4, RR: -4 };
const FUSO_BR_COD: Record<string, number> = { ERN: -5, FEN: -2 };

const BRASIL = `
RAO|Ribeirão Preto|SP|Aeroporto Leite Lopes
SJP|São José do Rio Preto|SP|Aeroporto de São José do Rio Preto
PPB|Presidente Prudente|SP|Aeroporto de Presidente Prudente
MII|Marília|SP|Aeroporto de Marília
AQA|Araraquara|SP|Aeroporto de Araraquara
JTC|Bauru|SP|Aeroporto de Bauru-Arealva
ARU|Araçatuba|SP|Aeroporto de Araçatuba
SJK|São José dos Campos|SP|Aeroporto de São José dos Campos
CAW|Campos dos Goytacazes|RJ|Aeroporto de Campos
MEA|Macaé|RJ|Aeroporto de Macaé
CFB|Cabo Frio|RJ|Aeroporto de Cabo Frio
UDI|Uberlândia|MG|Aeroporto de Uberlândia
UBA|Uberaba|MG|Aeroporto de Uberaba
MOC|Montes Claros|MG|Aeroporto de Montes Claros
IPN|Ipatinga|MG|Aeroporto do Vale do Aço
IZA|Juiz de Fora|MG|Aeroporto da Zona da Mata
GVR|Governador Valadares|MG|Aeroporto de Governador Valadares
VAG|Varginha|MG|Aeroporto de Varginha
POJ|Patos de Minas|MG|Aeroporto de Patos de Minas
TFL|Teófilo Otoni|MG|Aeroporto de Teófilo Otoni
LDB|Londrina|PR|Aeroporto de Londrina
MGF|Maringá|PR|Aeroporto de Maringá
CAC|Cascavel|PR|Aeroporto de Cascavel
GPB|Guarapuava|PR|Aeroporto de Guarapuava
PGZ|Ponta Grossa|PR|Aeroporto de Ponta Grossa
TOW|Toledo|PR|Aeroporto de Toledo
JOI|Joinville|SC|Aeroporto de Joinville
XAP|Chapecó|SC|Aeroporto de Chapecó
CCM|Criciúma|SC|Aeroporto de Forquilhinha
JJG|Jaguaruna|SC|Aeroporto Humberto Bortoluzzi
LAJ|Lages|SC|Aeroporto de Lages
CFC|Caçador|SC|Aeroporto de Caçador
CXJ|Caxias do Sul|RS|Aeroporto de Caxias do Sul
PFB|Passo Fundo|RS|Aeroporto de Passo Fundo
PET|Pelotas|RS|Aeroporto de Pelotas
RIA|Santa Maria|RS|Aeroporto de Santa Maria
URG|Uruguaiana|RS|Aeroporto de Uruguaiana
GEL|Santo Ângelo|RS|Aeroporto de Santo Ângelo
SRA|Santa Rosa|RS|Aeroporto de Santa Rosa
CLV|Caldas Novas|GO|Aeroporto de Caldas Novas
RVD|Rio Verde|GO|Aeroporto de Rio Verde
ROO|Rondonópolis|MT|Aeroporto de Rondonópolis
SMT|Sorriso|MT|Aeroporto de Sorriso
OPS|Sinop|MT|Aeroporto de Sinop
AFL|Alta Floresta|MT|Aeroporto de Alta Floresta
BPG|Barra do Garças|MT|Aeroporto de Barra do Garças
CMG|Corumbá|MS|Aeroporto de Corumbá
DOU|Dourados|MS|Aeroporto de Dourados
BYO|Bonito|MS|Aeroporto de Bonito
PMG|Ponta Porã|MS|Aeroporto de Ponta Porã
TJL|Três Lagoas|MS|Aeroporto de Três Lagoas
VDC|Vitória da Conquista|BA|Aeroporto Glauber Rocha
BRA|Barreiras|BA|Aeroporto de Barreiras
PAV|Paulo Afonso|BA|Aeroporto de Paulo Afonso
TXF|Teixeira de Freitas|BA|Aeroporto de Teixeira de Freitas
FEC|Feira de Santana|BA|Aeroporto de Feira de Santana
GNM|Guanambi|BA|Aeroporto de Guanambi
UNA|Una|BA|Aeroporto de Comandatuba
VAL|Valença|BA|Aeroporto de Valença
PNZ|Petrolina|PE|Aeroporto de Petrolina
CAU|Caruaru|PE|Aeroporto de Caruaru
CPV|Campina Grande|PB|Aeroporto de Campina Grande
MVF|Mossoró|RN|Aeroporto de Mossoró
JDO|Juazeiro do Norte|CE|Aeroporto Orlando Bezerra
PHB|Parnaíba|PI|Aeroporto de Parnaíba
IMP|Imperatriz|MA|Aeroporto de Imperatriz
BRB|Barreirinhas|MA|Aeroporto de Barreirinhas (Lençóis Maranhenses)
STM|Santarém|PA|Aeroporto de Santarém
MAB|Marabá|PA|Aeroporto de Marabá
CKS|Parauapebas|PA|Aeroporto de Carajás
ATM|Altamira|PA|Aeroporto de Altamira
TUR|Tucuruí|PA|Aeroporto de Tucuruí
ITB|Itaituba|PA|Aeroporto de Itaituba
TMT|Oriximiná|PA|Aeroporto de Porto Trombetas
TBT|Tabatinga|AM|Aeroporto de Tabatinga
TFF|Tefé|AM|Aeroporto de Tefé
PIN|Parintins|AM|Aeroporto de Parintins
ERN|Eirunepé|AM|Aeroporto de Eirunepé
SJL|São Gabriel da Cachoeira|AM|Aeroporto de São Gabriel da Cachoeira
CZS|Cruzeiro do Sul|AC|Aeroporto de Cruzeiro do Sul
JPR|Ji-Paraná|RO|Aeroporto de Ji-Paraná
OAL|Cacoal|RO|Aeroporto de Cacoal
BVH|Vilhena|RO|Aeroporto de Vilhena
AUX|Araguaína|TO|Aeroporto de Araguaína
`;

const MUNDO = `
EZE|Buenos Aires|Argentina|Aeroporto de Ezeiza
AEP|Buenos Aires|Argentina|Aeroparque Jorge Newbery
BRC|Bariloche|Argentina|Aeroporto de Bariloche
USH|Ushuaia|Argentina|Aeroporto de Ushuaia
FTE|El Calafate|Argentina|Aeroporto de El Calafate
MDZ|Mendoza|Argentina|Aeroporto de Mendoza
IGR|Puerto Iguazú|Argentina|Aeroporto de Puerto Iguazú
COR|Córdoba|Argentina|Aeroporto de Córdoba
SLA|Salta|Argentina|Aeroporto de Salta
JUJ|Jujuy|Argentina|Aeroporto de Jujuy
REL|Trelew|Argentina|Aeroporto de Trelew
NQN|Neuquén|Argentina|Aeroporto de Neuquén
CPC|San Martín de los Andes|Argentina|Aeroporto Chapelco
ROS|Rosário|Argentina|Aeroporto de Rosário
TUC|Tucumán|Argentina|Aeroporto de Tucumán
SCL|Santiago|Chile|Aeroporto Arturo Merino Benítez
CJC|Calama|Chile|Aeroporto El Loa (Atacama)
PUQ|Punta Arenas|Chile|Aeroporto de Punta Arenas
PNT|Puerto Natales|Chile|Aeroporto de Puerto Natales
IPC|Ilha de Páscoa|Chile|Aeroporto Mataveri
PMC|Puerto Montt|Chile|Aeroporto El Tepual
ARI|Arica|Chile|Aeroporto de Arica
IQQ|Iquique|Chile|Aeroporto de Iquique
ANF|Antofagasta|Chile|Aeroporto de Antofagasta
LSC|La Serena|Chile|Aeroporto de La Serena
BBA|Balmaceda|Chile|Aeroporto de Balmaceda
LIM|Lima|Peru|Aeroporto Jorge Chávez
CUZ|Cusco|Peru|Aeroporto de Cusco
AQP|Arequipa|Peru|Aeroporto de Arequipa
JUL|Juliaca|Peru|Aeroporto de Juliaca (Titicaca)
PEM|Puerto Maldonado|Peru|Aeroporto de Puerto Maldonado
IQT|Iquitos|Peru|Aeroporto de Iquitos
TRU|Trujillo|Peru|Aeroporto de Trujillo
BOG|Bogotá|Colômbia|Aeroporto El Dorado
MDE|Medellín|Colômbia|Aeroporto José María Córdova
CTG|Cartagena|Colômbia|Aeroporto de Cartagena
SMR|Santa Marta|Colômbia|Aeroporto de Santa Marta
ADZ|San Andrés|Colômbia|Aeroporto de San Andrés
CLO|Cali|Colômbia|Aeroporto de Cali
BAQ|Barranquilla|Colômbia|Aeroporto de Barranquilla
PEI|Pereira|Colômbia|Aeroporto de Pereira
UIO|Quito|Equador|Aeroporto de Quito
GYE|Guayaquil|Equador|Aeroporto de Guayaquil
GPS|Galápagos (Baltra)|Equador|Aeroporto Seymour
SCY|Galápagos (San Cristóbal)|Equador|Aeroporto de San Cristóbal
CCS|Caracas|Venezuela|Aeroporto de Maiquetía
VVI|Santa Cruz de la Sierra|Bolívia|Aeroporto Viru Viru
LPB|La Paz|Bolívia|Aeroporto El Alto
UYU|Uyuni|Bolívia|Aeroporto de Uyuni
CBB|Cochabamba|Bolívia|Aeroporto de Cochabamba
SRE|Sucre|Bolívia|Aeroporto de Sucre
ASU|Assunção|Paraguai|Aeroporto Silvio Pettirossi
AGT|Ciudad del Este|Paraguai|Aeroporto Guaraní
MVD|Montevidéu|Uruguai|Aeroporto de Carrasco
PDP|Punta del Este|Uruguai|Aeroporto de Punta del Este
GEO|Georgetown|Guiana|Aeroporto Cheddi Jagan
PBM|Paramaribo|Suriname|Aeroporto de Paramaribo
CAY|Caiena|Guiana Francesa|Aeroporto de Caiena
PTY|Cidade do Panamá|Panamá|Aeroporto de Tocumen
SJO|San José|Costa Rica|Aeroporto Juan Santamaría
LIR|Liberia|Costa Rica|Aeroporto de Guanacaste
BZE|Cidade de Belize|Belize|Aeroporto de Belize
GUA|Cidade da Guatemala|Guatemala|Aeroporto La Aurora
FRS|Flores (Tikal)|Guatemala|Aeroporto Mundo Maya
SAL|San Salvador|El Salvador|Aeroporto de El Salvador
RTB|Roatán|Honduras|Aeroporto de Roatán
MGA|Manágua|Nicarágua|Aeroporto de Manágua
MEX|Cidade do México|México|Aeroporto Benito Juárez
NLU|Cidade do México|México|Aeroporto Felipe Ángeles
CUN|Cancún|México|Aeroporto de Cancún
TQO|Tulum|México|Aeroporto de Tulum
CZM|Cozumel|México|Aeroporto de Cozumel
SJD|Los Cabos|México|Aeroporto de Los Cabos
PVR|Puerto Vallarta|México|Aeroporto de Puerto Vallarta
GDL|Guadalajara|México|Aeroporto de Guadalajara
MTY|Monterrey|México|Aeroporto de Monterrey
OAX|Oaxaca|México|Aeroporto de Oaxaca
MID|Mérida|México|Aeroporto de Mérida
HAV|Havana|Cuba|Aeroporto José Martí
VRA|Varadero|Cuba|Aeroporto de Varadero
PUJ|Punta Cana|República Dominicana|Aeroporto de Punta Cana
SDQ|Santo Domingo|República Dominicana|Aeroporto Las Américas
LRM|La Romana|República Dominicana|Aeroporto de La Romana
MBJ|Montego Bay|Jamaica|Aeroporto Sangster
KIN|Kingston|Jamaica|Aeroporto Norman Manley
NAS|Nassau|Bahamas|Aeroporto Lynden Pindling
AUA|Aruba|Aruba|Aeroporto Reina Beatrix
CUR|Curaçao|Curaçao|Aeroporto Hato
BON|Bonaire|Bonaire|Aeroporto Flamingo
SXM|Saint Martin|Sint Maarten|Aeroporto Princesa Juliana
SJU|San Juan|Porto Rico|Aeroporto Luis Muñoz Marín
BGI|Bridgetown|Barbados|Aeroporto Grantley Adams
POS|Port of Spain|Trinidad e Tobago|Aeroporto de Piarco
GCM|Grand Cayman|Ilhas Cayman|Aeroporto Owen Roberts
PLS|Providenciales|Turks e Caicos|Aeroporto de Providenciales
JFK|Nova York|Estados Unidos|Aeroporto John F. Kennedy
EWR|Nova York (Newark)|Estados Unidos|Aeroporto de Newark
LGA|Nova York|Estados Unidos|Aeroporto LaGuardia
MIA|Miami|Estados Unidos|Aeroporto de Miami
FLL|Fort Lauderdale|Estados Unidos|Aeroporto de Fort Lauderdale
MCO|Orlando|Estados Unidos|Aeroporto de Orlando
TPA|Tampa|Estados Unidos|Aeroporto de Tampa
ATL|Atlanta|Estados Unidos|Aeroporto Hartsfield-Jackson
BOS|Boston|Estados Unidos|Aeroporto Logan
IAD|Washington|Estados Unidos|Aeroporto Dulles
DCA|Washington|Estados Unidos|Aeroporto Ronald Reagan
ORD|Chicago|Estados Unidos|Aeroporto O'Hare
DFW|Dallas|Estados Unidos|Aeroporto Dallas/Fort Worth
IAH|Houston|Estados Unidos|Aeroporto George Bush
LAX|Los Angeles|Estados Unidos|Aeroporto de Los Angeles
SFO|São Francisco|Estados Unidos|Aeroporto de São Francisco
LAS|Las Vegas|Estados Unidos|Aeroporto Harry Reid
SEA|Seattle|Estados Unidos|Aeroporto Seattle-Tacoma
DEN|Denver|Estados Unidos|Aeroporto de Denver
PHX|Phoenix|Estados Unidos|Aeroporto Sky Harbor
SAN|San Diego|Estados Unidos|Aeroporto de San Diego
MSY|Nova Orleans|Estados Unidos|Aeroporto Louis Armstrong
HNL|Honolulu|Estados Unidos|Aeroporto de Honolulu
OGG|Maui|Estados Unidos|Aeroporto de Kahului
ANC|Anchorage|Estados Unidos|Aeroporto de Anchorage
FAI|Fairbanks|Estados Unidos|Aeroporto de Fairbanks
SLC|Salt Lake City|Estados Unidos|Aeroporto de Salt Lake City
PHL|Filadélfia|Estados Unidos|Aeroporto de Filadélfia
CLT|Charlotte|Estados Unidos|Aeroporto de Charlotte
DTW|Detroit|Estados Unidos|Aeroporto de Detroit
MSP|Minneapolis|Estados Unidos|Aeroporto de Minneapolis
BNA|Nashville|Estados Unidos|Aeroporto de Nashville
AUS|Austin|Estados Unidos|Aeroporto de Austin
JAC|Jackson Hole|Estados Unidos|Aeroporto de Jackson Hole
YYZ|Toronto|Canadá|Aeroporto Pearson
YUL|Montreal|Canadá|Aeroporto Trudeau
YVR|Vancouver|Canadá|Aeroporto de Vancouver
YYC|Calgary|Canadá|Aeroporto de Calgary
YQB|Quebec|Canadá|Aeroporto Jean Lesage
YOW|Ottawa|Canadá|Aeroporto de Ottawa
YHZ|Halifax|Canadá|Aeroporto de Halifax
YXY|Whitehorse|Canadá|Aeroporto de Whitehorse
YZF|Yellowknife|Canadá|Aeroporto de Yellowknife
LIS|Lisboa|Portugal|Aeroporto Humberto Delgado
OPO|Porto|Portugal|Aeroporto Francisco Sá Carneiro
FAO|Faro|Portugal|Aeroporto de Faro
FNC|Funchal (Madeira)|Portugal|Aeroporto da Madeira
PDL|Ponta Delgada (Açores)|Portugal|Aeroporto João Paulo II
TER|Terceira (Açores)|Portugal|Aeroporto das Lajes
MAD|Madri|Espanha|Aeroporto de Barajas
BCN|Barcelona|Espanha|Aeroporto El Prat
AGP|Málaga|Espanha|Aeroporto de Málaga
SVQ|Sevilha|Espanha|Aeroporto de Sevilha
VLC|Valência|Espanha|Aeroporto de Valência
BIO|Bilbao|Espanha|Aeroporto de Bilbao
PMI|Palma de Maiorca|Espanha|Aeroporto de Palma
IBZ|Ibiza|Espanha|Aeroporto de Ibiza
LPA|Gran Canária|Espanha|Aeroporto de Gran Canária
TFS|Tenerife|Espanha|Aeroporto Tenerife Sul
SCQ|Santiago de Compostela|Espanha|Aeroporto de Santiago
GRX|Granada|Espanha|Aeroporto de Granada
ALC|Alicante|Espanha|Aeroporto de Alicante
CDG|Paris|França|Aeroporto Charles de Gaulle
ORY|Paris|França|Aeroporto de Orly
NCE|Nice|França|Aeroporto de Nice
LYS|Lyon|França|Aeroporto de Lyon
MRS|Marselha|França|Aeroporto de Marselha
BOD|Bordeaux|França|Aeroporto de Bordeaux
TLS|Toulouse|França|Aeroporto de Toulouse
FCO|Roma|Itália|Aeroporto Fiumicino
CIA|Roma|Itália|Aeroporto Ciampino
MXP|Milão|Itália|Aeroporto Malpensa
LIN|Milão|Itália|Aeroporto de Linate
BGY|Bérgamo|Itália|Aeroporto Orio al Serio
VCE|Veneza|Itália|Aeroporto Marco Polo
NAP|Nápoles|Itália|Aeroporto de Nápoles
FLR|Florença|Itália|Aeroporto de Florença
PSA|Pisa|Itália|Aeroporto de Pisa
BLQ|Bolonha|Itália|Aeroporto de Bolonha
CTA|Catânia|Itália|Aeroporto de Catânia
PMO|Palermo|Itália|Aeroporto de Palermo
BRI|Bari|Itália|Aeroporto de Bari
TRN|Turim|Itália|Aeroporto de Turim
CAG|Cagliari|Itália|Aeroporto de Cagliari
OLB|Olbia|Itália|Aeroporto de Olbia
VRN|Verona|Itália|Aeroporto de Verona
GOA|Gênova|Itália|Aeroporto de Gênova
LHR|Londres|Reino Unido|Aeroporto de Heathrow
LGW|Londres|Reino Unido|Aeroporto de Gatwick
STN|Londres|Reino Unido|Aeroporto de Stansted
LTN|Londres|Reino Unido|Aeroporto de Luton
LCY|Londres|Reino Unido|London City
MAN|Manchester|Reino Unido|Aeroporto de Manchester
BHX|Birmingham|Reino Unido|Aeroporto de Birmingham
EDI|Edimburgo|Reino Unido|Aeroporto de Edimburgo
GLA|Glasgow|Reino Unido|Aeroporto de Glasgow
DUB|Dublin|Irlanda|Aeroporto de Dublin
AMS|Amsterdã|Holanda|Aeroporto de Schiphol
BRU|Bruxelas|Bélgica|Aeroporto de Bruxelas
CRL|Charleroi|Bélgica|Aeroporto de Charleroi
LUX|Luxemburgo|Luxemburgo|Aeroporto de Luxemburgo
FRA|Frankfurt|Alemanha|Aeroporto de Frankfurt
MUC|Munique|Alemanha|Aeroporto de Munique
BER|Berlim|Alemanha|Aeroporto Brandemburgo
HAM|Hamburgo|Alemanha|Aeroporto de Hamburgo
DUS|Düsseldorf|Alemanha|Aeroporto de Düsseldorf
CGN|Colônia|Alemanha|Aeroporto Colônia/Bonn
STR|Stuttgart|Alemanha|Aeroporto de Stuttgart
ZRH|Zurique|Suíça|Aeroporto de Zurique
GVA|Genebra|Suíça|Aeroporto de Genebra
BSL|Basileia|Suíça|EuroAirport Basileia-Mulhouse
VIE|Viena|Áustria|Aeroporto de Viena
SZG|Salzburgo|Áustria|Aeroporto de Salzburgo
INN|Innsbruck|Áustria|Aeroporto de Innsbruck
CPH|Copenhague|Dinamarca|Aeroporto de Kastrup
ARN|Estocolmo|Suécia|Aeroporto de Arlanda
KRN|Kiruna|Suécia|Aeroporto de Kiruna
OSL|Oslo|Noruega|Aeroporto de Gardermoen
BGO|Bergen|Noruega|Aeroporto de Bergen
TOS|Tromsø|Noruega|Aeroporto de Tromsø
TRD|Trondheim|Noruega|Aeroporto de Trondheim
BOO|Bodø|Noruega|Aeroporto de Bodø
EVE|Harstad/Narvik|Noruega|Aeroporto de Evenes
LYR|Longyearbyen (Svalbard)|Noruega|Aeroporto de Svalbard
HEL|Helsinque|Finlândia|Aeroporto de Helsinque
RVN|Rovaniemi|Finlândia|Aeroporto de Rovaniemi
IVL|Ivalo|Finlândia|Aeroporto de Ivalo
KEF|Reykjavík|Islândia|Aeroporto de Keflavík
PRG|Praga|República Tcheca|Aeroporto Václav Havel
BUD|Budapeste|Hungria|Aeroporto de Budapeste
WAW|Varsóvia|Polônia|Aeroporto Chopin
KRK|Cracóvia|Polônia|Aeroporto de Cracóvia
OTP|Bucareste|Romênia|Aeroporto Henri Coandă
SOF|Sófia|Bulgária|Aeroporto de Sófia
ZAG|Zagreb|Croácia|Aeroporto de Zagreb
DBV|Dubrovnik|Croácia|Aeroporto de Dubrovnik
SPU|Split|Croácia|Aeroporto de Split
LJU|Liubliana|Eslovênia|Aeroporto de Liubliana
BEG|Belgrado|Sérvia|Aeroporto Nikola Tesla
TIA|Tirana|Albânia|Aeroporto de Tirana
TLL|Tallinn|Estônia|Aeroporto de Tallinn
RIX|Riga|Letônia|Aeroporto de Riga
VNO|Vilnius|Lituânia|Aeroporto de Vilnius
SVO|Moscou|Rússia|Aeroporto Sheremetyevo
LED|São Petersburgo|Rússia|Aeroporto Pulkovo
ATH|Atenas|Grécia|Aeroporto Eleftherios Venizelos
JTR|Santorini|Grécia|Aeroporto de Santorini
JMK|Mykonos|Grécia|Aeroporto de Mykonos
HER|Heraklion (Creta)|Grécia|Aeroporto de Heraklion
CHQ|Chania (Creta)|Grécia|Aeroporto de Chania
RHO|Rodes|Grécia|Aeroporto de Rodes
CFU|Corfu|Grécia|Aeroporto de Corfu
SKG|Tessalônica|Grécia|Aeroporto de Tessalônica
MLA|Malta|Malta|Aeroporto de Malta
LCA|Larnaca|Chipre|Aeroporto de Larnaca
PFO|Pafos|Chipre|Aeroporto de Pafos
IST|Istambul|Turquia|Aeroporto de Istambul
SAW|Istambul|Turquia|Aeroporto Sabiha Gökçen
NAV|Capadócia (Nevşehir)|Turquia|Aeroporto de Nevşehir
ASR|Kayseri (Capadócia)|Turquia|Aeroporto de Kayseri
ADB|Izmir|Turquia|Aeroporto de Izmir
AYT|Antália|Turquia|Aeroporto de Antália
DLM|Dalaman|Turquia|Aeroporto de Dalaman
BJV|Bodrum|Turquia|Aeroporto de Bodrum
ESB|Ancara|Turquia|Aeroporto Esenboğa
DXB|Dubai|Emirados Árabes|Aeroporto de Dubai
DWC|Dubai|Emirados Árabes|Aeroporto Al Maktoum
AUH|Abu Dhabi|Emirados Árabes|Aeroporto de Abu Dhabi
DOH|Doha|Catar|Aeroporto Hamad
AMM|Amã|Jordânia|Aeroporto Queen Alia
AQJ|Aqaba|Jordânia|Aeroporto de Aqaba
TLV|Tel Aviv|Israel|Aeroporto Ben Gurion
RUH|Riade|Arábia Saudita|Aeroporto King Khalid
JED|Jidá|Arábia Saudita|Aeroporto King Abdulaziz
MCT|Mascate|Omã|Aeroporto de Mascate
BAH|Manama|Bahrein|Aeroporto do Bahrein
KWI|Kuwait|Kuwait|Aeroporto do Kuwait
BEY|Beirute|Líbano|Aeroporto de Beirute
CAI|Cairo|Egito|Aeroporto do Cairo
LXR|Luxor|Egito|Aeroporto de Luxor
ASW|Assuã|Egito|Aeroporto de Assuã
ABS|Abu Simbel|Egito|Aeroporto de Abu Simbel
HRG|Hurghada|Egito|Aeroporto de Hurghada
SSH|Sharm el-Sheikh|Egito|Aeroporto de Sharm el-Sheikh
CMN|Casablanca|Marrocos|Aeroporto Mohammed V
RAK|Marrakech|Marrocos|Aeroporto Menara
FEZ|Fez|Marrocos|Aeroporto de Fez
TNG|Tânger|Marrocos|Aeroporto de Tânger
TUN|Túnis|Tunísia|Aeroporto de Túnis-Cartago
JNB|Joanesburgo|África do Sul|Aeroporto O. R. Tambo
CPT|Cidade do Cabo|África do Sul|Aeroporto da Cidade do Cabo
DUR|Durban|África do Sul|Aeroporto King Shaka
MQP|Nelspruit (Kruger)|África do Sul|Aeroporto Kruger Mpumalanga
NBO|Nairóbi|Quênia|Aeroporto Jomo Kenyatta
MBA|Mombasa|Quênia|Aeroporto de Mombasa
JRO|Kilimanjaro|Tanzânia|Aeroporto do Kilimanjaro
DAR|Dar es Salaam|Tanzânia|Aeroporto Julius Nyerere
ZNZ|Zanzibar|Tanzânia|Aeroporto de Zanzibar
ADD|Adis Abeba|Etiópia|Aeroporto de Bole
VFA|Victoria Falls|Zimbábue|Aeroporto de Victoria Falls
LVI|Livingstone|Zâmbia|Aeroporto de Livingstone
WDH|Windhoek|Namíbia|Aeroporto Hosea Kutako
MUB|Maun|Botsuana|Aeroporto de Maun
MRU|Maurício|Maurício|Aeroporto Sir Seewoosagur Ramgoolam
SEZ|Mahé|Seychelles|Aeroporto de Seychelles
TNR|Antananarivo|Madagascar|Aeroporto de Ivato
LAD|Luanda|Angola|Aeroporto de Luanda
MPM|Maputo|Moçambique|Aeroporto de Maputo
KGL|Kigali|Ruanda|Aeroporto de Kigali
EBB|Entebbe|Uganda|Aeroporto de Entebbe
ACC|Acra|Gana|Aeroporto Kotoka
LOS|Lagos|Nigéria|Aeroporto Murtala Muhammed
DSS|Dakar|Senegal|Aeroporto Blaise Diagne
RAI|Praia|Cabo Verde|Aeroporto Nelson Mandela
SID|Ilha do Sal|Cabo Verde|Aeroporto Amílcar Cabral
BVC|Boa Vista|Cabo Verde|Aeroporto Aristides Pereira
NRT|Tóquio|Japão|Aeroporto de Narita
HND|Tóquio|Japão|Aeroporto de Haneda
KIX|Osaka|Japão|Aeroporto de Kansai
ITM|Osaka|Japão|Aeroporto de Itami
UKB|Kobe|Japão|Aeroporto de Kobe
NGO|Nagoya|Japão|Aeroporto Chubu Centrair
CTS|Sapporo|Japão|Aeroporto New Chitose
FUK|Fukuoka|Japão|Aeroporto de Fukuoka
OKA|Okinawa (Naha)|Japão|Aeroporto de Naha
HIJ|Hiroshima|Japão|Aeroporto de Hiroshima
KOJ|Kagoshima|Japão|Aeroporto de Kagoshima
SDJ|Sendai|Japão|Aeroporto de Sendai
KMQ|Komatsu (Kanazawa)|Japão|Aeroporto de Komatsu
TOY|Toyama|Japão|Aeroporto de Toyama
TAK|Takamatsu|Japão|Aeroporto de Takamatsu
MYJ|Matsuyama|Japão|Aeroporto de Matsuyama
OKJ|Okayama|Japão|Aeroporto de Okayama
KCZ|Kochi|Japão|Aeroporto de Kochi
NGS|Nagasaki|Japão|Aeroporto de Nagasaki
KMJ|Kumamoto|Japão|Aeroporto de Kumamoto
OIT|Oita|Japão|Aeroporto de Oita
AOJ|Aomori|Japão|Aeroporto de Aomori
AXT|Akita|Japão|Aeroporto de Akita
HKD|Hakodate|Japão|Aeroporto de Hakodate
ISG|Ishigaki|Japão|Aeroporto de Ishigaki
PEK|Pequim|China|Aeroporto Capital de Pequim
PKX|Pequim|China|Aeroporto de Daxing
PVG|Xangai|China|Aeroporto de Pudong
SHA|Xangai|China|Aeroporto de Hongqiao
CAN|Cantão|China|Aeroporto de Baiyun
SZX|Shenzhen|China|Aeroporto de Shenzhen
XIY|Xi'an|China|Aeroporto de Xianyang
CTU|Chengdu|China|Aeroporto de Shuangliu
TFU|Chengdu|China|Aeroporto de Tianfu
CKG|Chongqing|China|Aeroporto de Jiangbei
KWL|Guilin|China|Aeroporto de Liangjiang
HGH|Hangzhou|China|Aeroporto de Xiaoshan
NKG|Nanquim|China|Aeroporto de Lukou
KMG|Kunming|China|Aeroporto de Changshui
LJG|Lijiang|China|Aeroporto de Lijiang
DLU|Dali|China|Aeroporto de Dali
XMN|Xiamen|China|Aeroporto de Gaoqi
TAO|Qingdao|China|Aeroporto de Jiaodong
HRB|Harbin|China|Aeroporto de Taiping
DYG|Zhangjiajie|China|Aeroporto de Hehua
SYX|Sanya|China|Aeroporto de Phoenix
HAK|Haikou|China|Aeroporto de Meilan
URC|Urumqi|China|Aeroporto de Diwopu
LXA|Lhasa|China|Aeroporto de Gonggar
WUH|Wuhan|China|Aeroporto de Tianhe
CSX|Changsha|China|Aeroporto de Huanghua
TSN|Tianjin|China|Aeroporto de Binhai
DLC|Dalian|China|Aeroporto de Zhoushuizi
SHE|Shenyang|China|Aeroporto de Taoxian
ZUH|Zhuhai|China|Aeroporto de Jinwan
HKG|Hong Kong|China|Aeroporto de Hong Kong
MFM|Macau|China|Aeroporto de Macau
TPE|Taipé|Taiwan|Aeroporto de Taoyuan
TSA|Taipé|Taiwan|Aeroporto de Songshan
KHH|Kaohsiung|Taiwan|Aeroporto de Kaohsiung
ULN|Ulan Bator|Mongólia|Aeroporto Chinggis Khaan
ICN|Seul|Coreia do Sul|Aeroporto de Incheon
GMP|Seul|Coreia do Sul|Aeroporto de Gimpo
PUS|Busan|Coreia do Sul|Aeroporto de Gimhae
CJU|Jeju|Coreia do Sul|Aeroporto de Jeju
BKK|Bangkok|Tailândia|Aeroporto Suvarnabhumi
DMK|Bangkok|Tailândia|Aeroporto Don Mueang
CNX|Chiang Mai|Tailândia|Aeroporto de Chiang Mai
CEI|Chiang Rai|Tailândia|Aeroporto de Chiang Rai
HKT|Phuket|Tailândia|Aeroporto de Phuket
KBV|Krabi|Tailândia|Aeroporto de Krabi
USM|Koh Samui|Tailândia|Aeroporto de Samui
SIN|Singapura|Singapura|Aeroporto Changi
KUL|Kuala Lumpur|Malásia|Aeroporto de Kuala Lumpur
PEN|Penang|Malásia|Aeroporto de Penang
LGK|Langkawi|Malásia|Aeroporto de Langkawi
BKI|Kota Kinabalu|Malásia|Aeroporto de Kota Kinabalu
CGK|Jacarta|Indonésia|Aeroporto Soekarno-Hatta
DPS|Bali|Indonésia|Aeroporto de Denpasar
LOP|Lombok|Indonésia|Aeroporto de Lombok
SUB|Surabaya|Indonésia|Aeroporto de Juanda
YIA|Yogyakarta|Indonésia|Aeroporto de Yogyakarta
LBJ|Labuan Bajo (Komodo)|Indonésia|Aeroporto de Komodo
MNL|Manila|Filipinas|Aeroporto Ninoy Aquino
CEB|Cebu|Filipinas|Aeroporto de Mactan-Cebu
MPH|Boracay (Caticlan)|Filipinas|Aeroporto de Caticlan
PPS|Puerto Princesa (Palawan)|Filipinas|Aeroporto de Puerto Princesa
SGN|Ho Chi Minh|Vietnã|Aeroporto Tan Son Nhat
HAN|Hanói|Vietnã|Aeroporto Noi Bai
DAD|Da Nang|Vietnã|Aeroporto de Da Nang
CXR|Nha Trang|Vietnã|Aeroporto de Cam Ranh
PQC|Phu Quoc|Vietnã|Aeroporto de Phu Quoc
HUI|Hue|Vietnã|Aeroporto de Phu Bai
SAI|Siem Reap|Camboja|Aeroporto de Siem Reap-Angkor
PNH|Phnom Penh|Camboja|Aeroporto de Phnom Penh
VTE|Vientiane|Laos|Aeroporto de Wattay
LPQ|Luang Prabang|Laos|Aeroporto de Luang Prabang
RGN|Yangon|Mianmar|Aeroporto de Yangon
KTM|Katmandu|Nepal|Aeroporto Tribhuvan
PBH|Paro|Butão|Aeroporto de Paro
CMB|Colombo|Sri Lanka|Aeroporto Bandaranaike
MLE|Malé|Maldivas|Aeroporto de Velana
DEL|Nova Délhi|Índia|Aeroporto Indira Gandhi
BOM|Mumbai|Índia|Aeroporto Chhatrapati Shivaji
BLR|Bangalore|Índia|Aeroporto de Bangalore
MAA|Chennai|Índia|Aeroporto de Chennai
HYD|Hyderabad|Índia|Aeroporto de Hyderabad
CCU|Calcutá|Índia|Aeroporto de Calcutá
GOI|Goa|Índia|Aeroporto de Dabolim
GOX|Goa|Índia|Aeroporto de Mopa
JAI|Jaipur|Índia|Aeroporto de Jaipur
AGR|Agra|Índia|Aeroporto de Agra
VNS|Varanasi|Índia|Aeroporto de Varanasi
UDR|Udaipur|Índia|Aeroporto de Udaipur
COK|Kochi|Índia|Aeroporto de Kochi
ATQ|Amritsar|Índia|Aeroporto de Amritsar
IXL|Leh|Índia|Aeroporto de Leh
TAS|Tashkent|Uzbequistão|Aeroporto de Tashkent
SKD|Samarcanda|Uzbequistão|Aeroporto de Samarcanda
BHK|Bukhara|Uzbequistão|Aeroporto de Bukhara
ALA|Almaty|Cazaquistão|Aeroporto de Almaty
NQZ|Astana|Cazaquistão|Aeroporto de Astana
TBS|Tbilisi|Geórgia|Aeroporto de Tbilisi
EVN|Yerevan|Armênia|Aeroporto de Zvartnots
GYD|Baku|Azerbaijão|Aeroporto Heydar Aliyev
SYD|Sydney|Austrália|Aeroporto de Sydney
MEL|Melbourne|Austrália|Aeroporto de Melbourne
BNE|Brisbane|Austrália|Aeroporto de Brisbane
PER|Perth|Austrália|Aeroporto de Perth
ADL|Adelaide|Austrália|Aeroporto de Adelaide
CNS|Cairns|Austrália|Aeroporto de Cairns
OOL|Gold Coast|Austrália|Aeroporto de Gold Coast
AYQ|Uluru (Ayers Rock)|Austrália|Aeroporto de Ayers Rock
DRW|Darwin|Austrália|Aeroporto de Darwin
HBA|Hobart|Austrália|Aeroporto de Hobart
AKL|Auckland|Nova Zelândia|Aeroporto de Auckland
CHC|Christchurch|Nova Zelândia|Aeroporto de Christchurch
ZQN|Queenstown|Nova Zelândia|Aeroporto de Queenstown
WLG|Wellington|Nova Zelândia|Aeroporto de Wellington
ROT|Rotorua|Nova Zelândia|Aeroporto de Rotorua
NAN|Nadi|Fiji|Aeroporto de Nadi
PPT|Papeete (Taiti)|Polinésia Francesa|Aeroporto de Faa'a
BOB|Bora Bora|Polinésia Francesa|Aeroporto de Bora Bora
NOU|Nouméa|Nova Caledônia|Aeroporto de La Tontouta
RAR|Rarotonga|Ilhas Cook|Aeroporto de Rarotonga
`;

function linhas(bloco: string): string[][] {
  return bloco.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split("|").map((p) => p.trim()));
}
for (const cod of Object.keys(AEROPORTOS)) if (AEROPORTOS[cod].fuso != null) AEROPORTOS[cod].pais = "Brasil";
for (const [cod, cidade, uf, nome] of linhas(BRASIL)) {
  if (AEROPORTOS[cod]) continue;
  AEROPORTOS[cod] = { cidade: `${cidade}, ${uf}`, nome, pais: "Brasil", fuso: FUSO_BR_COD[cod] ?? FUSO_UF[uf] ?? -3 };
}
for (const [cod, cidade, pais, nome] of linhas(MUNDO)) {
  if (AEROPORTOS[cod]) { AEROPORTOS[cod].pais ??= pais; continue; }
  AEROPORTOS[cod] = { cidade, nome, pais };
}

export const aeroporto = (cod: string): Aeroporto | null => AEROPORTOS[cod.trim().toUpperCase()] ?? null;

/** Duração "3h40" — só quando os dois aeroportos têm fuso conhecido (Brasil). */
export function duracaoVoo(origem: string, destino: string, data: string, saida: string, chegada: string, chegadaData?: string): string | null {
  const a = aeroporto(origem), b = aeroporto(destino);
  if (a?.fuso == null || b?.fuso == null || !data || !saida || !chegada) return null;
  const t = (d: string, h: string, fuso: number) => Date.parse(`${d}T${h}:00Z`) - fuso * 3600_000;
  const min = Math.round((t(chegadaData || data, chegada, b.fuso) - t(data, saida, a.fuso)) / 60000);
  if (!(min > 0 && min < 24 * 60)) return null;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}
