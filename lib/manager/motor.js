// ===================================================================
// FS Manager — motor do jogo (tipo Elifoot / Brasfoot)
// ===================================================================
// O MESMO ficheiro corre no browser (modo Carreira) e no servidor
// (Liga da Comunidade e Desafios). Por isso não mexe em DOM nem em rede.
// Uma cópia vive em estv-api/lib/treinador/motor.js — se mudares
// aqui, copia para lá também (os testes da API comparam os dois).
//
// Peças principais:
//   criarMundo(semente)          -> clubes (nomes alterados) com plantéis reais
//   prepararJornada(mundo)       -> jogos da jornada, prontos a correr
//   passo(mundo, jogo, rng)      -> simula 1 minuto de um jogo
//   concluirJornada(mundo, jogos)-> tabelas, finanças, evolução, mercado,
//                                   IA, despedimentos e fim de época
//   jogarJornada(mundo)          -> as três coisas de seguida (servidor)
//   jogoAmigavel(a, b, semente)  -> um jogo entre duas equipas soltas
// ===================================================================
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.ManagerMotor = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSAO = 2;

  // ---------------------------------------------------------------
  // Aleatório com semente (mulberry32): o estado é um número, guarda-se
  // no mundo e assim um jogo gravado a meio continua igual.
  // ---------------------------------------------------------------
  function criarRng(estado) {
    let s = estado >>> 0;
    const r = function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      r,
      int: (a, b) => a + Math.floor(r() * (b - a + 1)),
      pick: (arr) => arr[Math.floor(r() * arr.length)],
      chance: (p) => r() < p,
      normal: (m, d) => {
        const u = Math.max(1e-9, r());
        const v = r();
        return m + d * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      },
      peso: (itens, pesos) => {
        let tot = 0;
        for (const p of pesos) tot += p;
        let x = r() * tot;
        for (let i = 0; i < itens.length; i++) {
          x -= pesos[i];
          if (x <= 0) return itens[i];
        }
        return itens[itens.length - 1];
      },
      estado: () => s,
    };
  }
  function rngDoMundo(m) {
    const rng = criarRng(m.s);
    return {
      rng,
      guardar: () => {
        m.s = rng.estado();
      },
    };
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------------------------------------------------------------
  // Clubes (nomes alterados, como o Elifoot faz) e níveis
  // [nome, curto, cor1, cor2, lugares, nível de força]
  // ---------------------------------------------------------------
  const CLUBES = [
    // 1.ª divisão
    ['SL Benfiqa', 'BEN', '#e3002b', '#ffffff', 64000, 76],
    ['FC Portu', 'POR', '#0046ad', '#ffffff', 50000, 76],
    ['Esporting CL', 'SCP', '#008a4c', '#ffffff', 50000, 75],
    ['SC Bragga', 'BRA', '#d6001c', '#ffffff', 30000, 69],
    ['Vitórya SC', 'VSC', '#ffffff', '#111111', 30000, 65],
    ['Famalicam', 'FAM', '#1d4f9c', '#ffffff', 5300, 62],
    ['Gil Vicentte', 'GIL', '#c8102e', '#1d4f9c', 12000, 61],
    ['Rio Avve', 'RAV', '#00843d', '#ffffff', 9000, 60],
    ['Moreirensse', 'MOR', '#00843d', '#ffffff', 6000, 59],
    ['Estorill Praya', 'EST', '#ffd100', '#1d4f9c', 8000, 59],
    // 2.ª divisão
    ['Casa Pya', 'CPI', '#111111', '#ffffff', 6000, 56],
    ['Santa Klara', 'STC', '#d6001c', '#ffffff', 12500, 56],
    ['Arouka', 'ARO', '#ffd100', '#1d4f9c', 5000, 55],
    ['Boavistta', 'BOA', '#111111', '#ffffff', 28000, 42],
    ['CD Nacionall', 'NAC', '#111111', '#ffffff', 5500, 54],
    ['Estrela Amadorra', 'AMA', '#d6001c', '#00843d', 9000, 54],
    ['AVS Futebool', 'AVS', '#c8102e', '#ffffff', 7000, 53],
    ['Tondella', 'TON', '#00843d', '#ffd100', 5000, 52],
    ['Alvercka', 'ALV', '#d6001c', '#ffffff', 7000, 52],
    ['Os Belenensses', 'BEL', '#1d63c4', '#ffffff', 19000, 42],
    // 3.ª divisão
    ['Académyca', 'ACA', '#111111', '#ffffff', 30000, 48],
    ['Marítymo', 'MAR', '#00843d', '#d6001c', 10000, 48],
    ['Leixõens', 'LEI', '#d6001c', '#ffffff', 9000, 47],
    ['Chavess', 'CHA', '#1d4f9c', '#ffffff', 8000, 47],
    ['Portimonensse', 'PTM', '#111111', '#ffffff', 9000, 46],
    ['Vizzela', 'VIZ', '#1d63c4', '#ffffff', 6000, 46],
    ['Penafyel', 'PEN', '#d6001c', '#111111', 5000, 45],
    ['Feirensse', 'FEI', '#1d4f9c', '#ffffff', 5000, 45],
    ['UD Oliveirensse', 'OLI', '#1d4f9c', '#111111', 4000, 44],
    ['Torrensse', 'TOR', '#1d4f9c', '#ffffff', 4000, 44],
    // 4.ª divisão
    ['Farensse', 'FAR', '#111111', '#ffffff', 7000, 41],
    ['União de Leirya', 'ULE', '#1d4f9c', '#ffffff', 23000, 41],
    ['Beira-Marr', 'BMA', '#ffd100', '#111111', 30000, 40],
    ['Olhanensse', 'OLH', '#d6001c', '#111111', 5000, 40],
    ['Varzym', 'VAR', '#111111', '#ffffff', 7000, 39],
    ['Trofensse', 'TRO', '#1d4f9c', '#ffffff', 5000, 39],
    ['Lusitânya Lourosa', 'LUS', '#ffd100', '#d6001c', 3500, 38],
    ['Esporting Covylhã', 'COV', '#00843d', '#ffffff', 3000, 37],
    ['Amorra FC', 'AMO', '#1d4f9c', '#ffffff', 2500, 37],
    ['Atlétyco CP', 'ATL', '#1d63c4', '#ffd100', 3000, 36],
  ];
  // Espanha, Itália e Inglaterra: 2 divisões de 10 (nomes alterados)
  const CLUBES_ES = [
    ['Real Madrida', 'RMA', '#ffffff', '#febe10', 81000, 82],
    ['FC Barcelonna', 'BAR', '#a50044', '#004d98', 99000, 82],
    ['Atlético Madrill', 'ATM', '#cb3524', '#ffffff', 70000, 79],
    ['Athletic Bilbau', 'ATH', '#ee2523', '#ffffff', 53000, 72],
    ['Real Sociedadd', 'RSO', '#0067b1', '#ffffff', 39000, 71],
    ['Villarreall', 'VIL', '#ffe667', '#005187', 23000, 71],
    ['Real Bétys', 'BET', '#00954c', '#ffffff', 60000, 70],
    ['Sevilha FC', 'SEV', '#ffffff', '#d4001f', 43000, 69],
    ['Valência CF', 'VAL', '#ffffff', '#ee3524', 49000, 67],
    ['Celtta Vigo', 'CEL', '#8ac3ee', '#ffffff', 29000, 66],
    ['Gyrona FC', 'GIR', '#cd2534', '#ffffff', 14000, 62],
    ['Osassuna', 'OSA', '#d91a21', '#0a346f', 23000, 61],
    ['Getaffe', 'GET', '#005999', '#ffffff', 17000, 60],
    ['RCD Mallorka', 'MLL', '#e20613', '#111111', 23000, 60],
    ['Rayo Vallecanno', 'RAY', '#ffffff', '#e53027', 14000, 59],
    ['Espanyoll', 'ESP', '#007fc8', '#ffffff', 40000, 59],
    ['Deportivo Alavéss', 'ALA', '#0d47a1', '#ffffff', 19000, 58],
    ['UD Las Palmass', 'LPA', '#ffe400', '#0055a4', 32000, 57],
    ['CD Leganéss', 'LEG', '#ffffff', '#1e4fa3', 12000, 56],
    ['Real Valladollid', 'VLL', '#5f259f', '#ffffff', 26000, 55],
  ];
  const CLUBES_IT = [
    ['Internazionalle', 'INT', '#0068a8', '#111111', 75000, 82],
    ['Juventuss', 'JUV', '#ffffff', '#111111', 41000, 80],
    ['AC Millan', 'MIL', '#fb090b', '#111111', 75000, 79],
    ['SSC Nápolis', 'NAP', '#12a0d7', '#ffffff', 54000, 79],
    ['Atalantta', 'ATA', '#1e71b8', '#111111', 24000, 76],
    ['AS Romma', 'ROM', '#8e1f2f', '#f0bc42', 70000, 75],
    ['SS Lazzio', 'LAZ', '#87d8f7', '#ffffff', 70000, 74],
    ['Fiorentinna', 'FIO', '#482e92', '#ffffff', 43000, 72],
    ['Bolonha FC', 'BOL', '#a21c26', '#1a2f48', 36000, 71],
    ['Torinno FC', 'TRN', '#8a1e03', '#ffffff', 28000, 67],
    ['Udinesse', 'UDI', '#ffffff', '#111111', 25000, 63],
    ['Génova CFC', 'GEN', '#ad1919', '#1a2f48', 36000, 62],
    ['Comma 1907', 'COM', '#003a70', '#ffffff', 13000, 62],
    ['Cagliarri', 'CAG', '#ac0e1d', '#002350', 16000, 60],
    ['Parmma', 'PAR', '#ffd200', '#1a3c8c', 22000, 59],
    ['US Lecci', 'LEC', '#ffd700', '#d0021b', 31000, 59],
    ['Empolli', 'EMP', '#0057a8', '#ffffff', 16000, 58],
    ['Hellas Veronna', 'VER', '#ffd700', '#00285e', 31000, 58],
    ['Sassuollo', 'SAS', '#00a752', '#111111', 21000, 57],
    ['Sampdorya', 'SAM', '#1b4f9c', '#ffffff', 33000, 56],
  ];
  const CLUBES_EN = [
    ['Manchester Cityy', 'MCI', '#6cabdd', '#ffffff', 53000, 84],
    ['Liverpoool', 'LIV', '#c8102e', '#ffffff', 61000, 83],
    ['Arsenall', 'ARS', '#ef0107', '#ffffff', 60000, 83],
    ['Chelsy FC', 'CHE', '#034694', '#ffffff', 40000, 79],
    ['Manchester Unitedd', 'MUN', '#da291c', '#111111', 74000, 77],
    ['Tottenhamm', 'TOT', '#ffffff', '#132257', 62000, 76],
    ['Newcastel', 'NEW', '#241f20', '#ffffff', 52000, 76],
    ['Aston Villla', 'AVL', '#670e36', '#95bfe5', 42000, 76],
    ['Brightonn', 'BHA', '#0057b8', '#ffffff', 31000, 72],
    ['West Hamm', 'WHU', '#7a263a', '#1bb1e7', 62000, 70],
    ['Crystall Palace', 'CRY', '#1b458f', '#c4122e', 25000, 69],
    ['Nottingham Forrest', 'NFO', '#dd0000', '#ffffff', 30000, 69],
    ['Bornemouth', 'BOU', '#da291c', '#111111', 11000, 69],
    ['Evertonn', 'EVE', '#003399', '#ffffff', 52000, 68],
    ['Fullham', 'FUL', '#ffffff', '#111111', 29000, 68],
    ['Brentforde', 'BRE', '#e30613', '#ffffff', 17000, 67],
    ['Wolverhamptonn', 'WOL', '#fdb913', '#231f20', 31000, 66],
    ['Leeds Unitted', 'LEE', '#ffffff', '#1d428a', 37000, 64],
    ['Burnlei', 'BUR', '#6c1d45', '#99d6ea', 21000, 63],
    ['Sunderlandd', 'SUN', '#eb172b', '#ffffff', 49000, 63],
  ];
  // ---------------------------------------------------------------
  // Plantéis reais (Transfermarkt, época 2026/27), por clube:
  // "Nome;posição;idade;nacionalidade;valor de mercado em milhares de €"
  // A força de cada jogador sai do valor de mercado: quanto mais vale,
  // mais força tem. Clubes sem valores (divisões mais baixas) ficam com
  // a força à volta do nível do clube.
  // ---------------------------------------------------------------
  const PLANTEIS = {
    BEN: "Anatoliy Trubin;G;25;UA;20000,Samuel Soares;G;24;PT;10000,Tomás Araújo;DC;24;PT;35000,Alessandro Circati;DC;23;AU;18000,Clément Lenglet;DC;31;FR;4000,Gabriel Índio;DC;18;BR;4000,Souffian El Karouani;LE;26;MA;15000,Samuel Dahl;LE;23;SE;13000,José Neto;LE;18;PT;3000,Alexander Bah;LD;28;DK;10000,Daniel Banjaqui;LD;18;PT;10000,João Palhinha;MD;31;PT;15000,Enzo Barrenechea;MD;25;AR;14000,Manu Silva;MD;25;PT;6000,Leandro Barreiro;MC;26;LU;20000,Fredrik Aursnes;MC;30;NO;15000,Georgiy Sudakov;MO;24;UA;25000,Claudio Echeverri;MO;20;AR;15000,Andreas Schjelderup;EE;22;NO;40000,Jakub Kamiński;EE;24;PL;17000,Gianluca Prestianni;ED;20;AR;40000,Dodi Lukébakio;ED;29;BE;15000,Rafa Silva;ED;33;PT;3000,Vangelis Pavlidis;PL;27;GR;35000,Jhon Durán;PL;22;CO;15000,Anísio Cabral;PL;18;PT;5000",
    POR: "Diogo Costa;G;27;PT;40000,Cláudio Ramos;G;34;PT;500,João Costa;G;30;PT;500,Jakub Kiwior;DC;26;PL;40000,Jan Bednarek;DC;30;PL;11000,Nehuén Pérez;DC;26;AR;10000,Dominik Prpić;DC;22;HR;4000,Chris Smalling;DC;36;EN;1000,Souza;LE;20;BR;12000,Francisco Moura;LE;27;PT;7000,Zaidu Sanusi;LE;29;NG;3000,Alberto Costa;LD;23;PT;18000,Martim Fernandes;LD;20;PT;12000,Alan Varela;MD;25;AR;28000,Pablo Rosario;MD;29;DO;10000,Victor Froholdt;MC;20;DK;50000,Seko Fofana;MC;31;CI;8000,In-beom Hwang;MC;30;KR;7000,Vasco Sousa;MC;23;PT;2000,Gabri Veiga;MO;24;ES;35000,Oskar Pietuszewski;EE;18;PL;25000,Borja Sainz;EE;25;ES;20000,William Gomes;ED;20;BR;30000,Pepê;ED;29;BR;17000,Gabriel Mec;ED;18;BR;16000,Duarte Cunha;ED;18;PT;1500,Samu Aghehowa;PL;22;ES;40000,Santiago Gimenez;PL;25;MX;18000,André Silva;PL;31;PT;5000",
    SCP: "Rui Silva;G;32;PT;5000,Kaique Pereira;G;23;BR;4000,Diego Callai;G;22;BR;1500,Gonçalo Inácio;DC;25;PT;35000,Zeno Debast;DC;23;BE;25000,Ibrahima Ba;DC;21;SN;20000,Eduardo Quaresma;DC;24;PT;17000,Maxi Araújo;LE;26;UY;40000,Moncef Zekri;LE;18;MA;4000,Nuno Santos;LE;31;PT;2000,Rodrigo Dias;LE;21;PT;1500,Iván Fresneda;LD;22;ES;20000,Georgios Vagiannidis;LD;25;GR;6000,Salvador Blopa;LD;19;PT;2500,Sergi Altimira;MD;25;ES;25000,Silas Andersen;MD;22;DK;7000,Issa Doumbia;MC;23;IT;20000,João Simões;MC;19;PT;15000,Pedro Lima;MC;23;BR;3000,Sotiris Alexandropoulos;MC;24;GR;1200,Rodrigo Zalazar;MO;27;UY;30000,Nestory Irankunda;EE;20;AU;15000,Flávio Gonçalves;EE;19;PT;15000,Jesse Derry;EE;19;EN;2000,Geny Catamo;ED;25;MZ;35000,Luís Guilherme;ED;20;BR;12000,Luis Suárez;PL;28;CO;30000,Fotis Ioannidis;PL;26;GR;16000,Rafael Nel;PL;21;PT;4000",
    BRA: "Bernardo;G;24;BR;5000,João Carvalho;G;22;PT;1500,Tiago Sá;G;31;PT;300,Gustaf Lagerbielke;DC;26;SE;10000,Bright Arrey-Mbi;DC;23;DE;9000,Sikou Niakaté;DC;27;ML;5000,Vítor Carvalho;DC;29;BR;4000,Adrian Barisic;DC;25;BA;4000,Adrian Bajrami;DC;24;CH;3000,Sergio Barcia;DC;25;ES;1500,Víctor Gómez;LD;26;ES;10000,Diogo Travassos;LD;22;PT;6000,Tommy Marqués;MD;20;ES;10000,Demir Ege Tıknaz;MD;22;TR;10000,Gorby;MC;24;FR;9000,Diego Rodrigues;MC;21;PT;5000,Denis Huseinbasic;MC;25;BA;2000,João Moutinho;MC;40;PT;300,Mario Dorgeles;MDi;22;CI;10000,Ricardo Horta;MO;32;PT;9000,João Trovisco;MO;19;PT;0,Gabriel Silva;EE;24;BR;7000,Gabri Martínez;EE;23;ES;7000,Pau Víctor;PL;24;ES;15000,Jovan Milosevic;PL;21;YU;7000,Fran Navarro;PL;28;ES;4000,Jonas Wind;PL;27;DK;4000",
    VSC: "Oliwier Zych;G;22;PL;2000,Juan Castillo;G;23;CO;500,Lucas Furtado;G;21;BR;100,Toni Borevković;DC;29;HR;3000,Thiago Balieiro;DC;23;BR;2000,Óscar Rivas;DC;26;ES;1000,Ahmed Sidibé;DC;24;FR;600,Yeimar Mosquera;DC;21;CO;400,João Mendes;LE;26;PT;2500,Francisco Dias;LE;24;PT;200,Tony Strata;LD;22;RO;4000,Maga;LD;23;PT;1500,Lohann Doucet;MD;24;BF;1000,Rica Rocha;MD;23;PT;200,Gonçalo Nogueira;MC;22;PT;5000,Beni Mukendi;MC;24;AO;4000,Matija Mitrović;MC;21;YU;2000,Marco Cruz;MC;22;PT;400,Santi Verdi;MC;18;PT;300,Alan;MO;26;BR;5000,Samu;MO;30;PT;2500,Oumar Camara;EE;19;FR;8000,Fabio Blanco;EE;22;ES;800,Victor Andersson;EE;22;SE;800,Gustavo Silva;ED;27;BR;4000,Telmo Arcanjo;ED;25;CV;3000,Miguel Nogueira;ED;21;PT;2500,Alioune Ndoye;PL;25;SN;1000,Arnel Jakupovic;PL;28;AT;800,Patrick Ouotro;PL;21;CI;300",
    FAM: "Lazar Carević;G;27;ME;5000,Ivan Zlobin;G;29;SU;1000,Gabriel Cabral;G;23;BR;0,Léo Realpe;DC;25;EC;5000,Finn van Breemen;DC;23;NL;2000,Víctor Rofino;DC;24;GW;1500,Vojin Serafimovic;DC;21;YU;400,Matheus Mattara;DC;20;BR;0,Pedro Bondo;LE;21;AO;2000,Leny Meyer;LE;22;CH;600,Rodrigo Pinheiro;LD;24;PT;5000,Garcia;LD;24;BR;1500,Tom van de Looi;MD;27;NL;4000,Mathias de Amorim;MC;21;PT;12000,Tamás Szűcs;MC;21;HU;2500,Marcos Peña;MC;21;ES;1500,Paulo Moreira;MC;26;PT;1500,Mathis Jangéal;MO;18;FR;1000,Sorriso;EE;25;BR;6000,Óscar Aranda;EE;24;ES;3000,Roméo Beney;EE;21;CH;1500,Gil Dias;ED;30;PT;2000,Pedro Santos;ED;23;PT;600,Georgios Koutsias;PL;22;GR;5000,Pato;PL;22;MX;4000,Umar Abubakar;PL;20;NG;1000",
    GIL: "Lucão;G;25;BR;1500,Samuel Portugal;G;32;BR;500,André Picornell;G;22;SE;0,Tiago Ferreira;G;17;PT;0,Marvin Elimbi;DC;23;FR;4000,Buatu;DC;33;AO;600,Antonio Espigares;DC;22;ES;500,David Moreira;LE;22;CV;1700,Weverson;LE;26;BR;800,José Silva;LD;21;PT;500,Ricardo Esgaio;LD;33;PT;500,Mohamed Bamba;MD;22;CI;1500,Diogo Prioste;MC;22;PT;2000,Zé Carlos;MC;25;PT;800,Andreas Lausen;MC;24;DK;700,Gonçalo Maia;MC;20;PT;100,Santi García;MO;25;ES;4000,Gil Martins;MO;20;PT;1500,Martín Fernández;MO;23;UY;450,Guilherme Gomes;MO;20;BR;300,Joelson Fernandes;EE;23;PT;1000,Tidjany Touré;EE;24;FR;500,Agustín Moreira;ED;25;UY;800,Murilo;ED;32;BR;800,Sergio Bermejo;ED;29;ES;500,Héctor Hernández;PL;31;ES;800,Walace França;PL;21;BR;500,Mohamed Kaba;PL;24;ML;100",
    RAV: "Cezary Miszta;G;25;PL;5000,Vítor Hugo;G;25;BR;800,Ennio van der Gouw;G;26;NL;600,Kevin Chamorro;G;26;CR;300,Antzelo Sina;G;22;AL;150,Andreas Ntoi;DC;23;GR;5000,Simón García;DC;21;CO;2000,Nelson Abbey;DC;23;EN;1500,Francisco Petrasso;DC;24;AR;1500,Gustavo Mancha;DC;22;BR;1500,Julien Lomboto;DC;24;FR;300,Jakub Brabec;DC;34;CZ;200,Caike;DC;21;BR;100,Pedro Amaral;LE;29;PT;1500,Marios Vrousai;LD;28;GR;3000,Zé Carlos;LD;28;PT;1500,João Tomé;LD;23;PT;600,Tamás Nikitscher;MD;27;HU;800,Georgios Liavas;MD;25;GR;700,Diogo Nascimento;MC;24;PT;3000,Brandon Aguilera;MC;23;CR;1500,Ryan Guilherme;MC;23;BR;900,Antoine Wenck;MC;20;SN;100,Malik Sellouki;MO;26;FR;900,Miguel Patricío;MO;19;PT;300,Tobías Medina;EE;22;AR;500,Diogo Bezerra;ED;24;BR;2000,Dario Špikić;ED;27;HR;1000,Sebastian Clemmensen;ED;23;DK;1000,Roland Galcik;ED;25;SK;500,Jalen Blesa;PL;25;ES;2200,Radek Siler;PL;22;CZ;1200,Tamble;PL;25;GW;1000,Samuel Alves;PL;18;BR;400",
    MOR: "André Ferreira;G;30;PT;600,Aranha;G;21;BR;0,Gilberto Batista;DC;22;GW;2000,Kevyn;DC;21;BR;500,Maracás;DC;32;BR;500,Janderson;DC;21;BR;0,Kiko;LE;24;PT;2500,Álvaro Martínez;LE;24;ES;400,Dinis Pinto;LD;26;PT;3500,Leandro Santos;LD;21;PT;1000,Mateja Stjepanović;MD;22;YU;3000,Guilherme Liberato;MD;25;BR;800,Afonso Assis;MD;20;PT;500,Rodri Alonso;MC;23;ES;2000,João Veloso;MC;21;PT;1500,Nile John;MC;23;EN;700,Jimi Gower;MC;22;EN;100,Manuel Mendonça;MO;21;PT;2000,Chipyoka Songa;MO;22;ZM;800,Tiago Andrade;EE;21;PT;1500,Landerson;EE;19;BR;1000,Kiko Bondoso;EE;30;PT;800,Afonso Vieira;EE;19;PT;100,Michael Dacosta;ED;21;ES;150,Leonardo Vonić;PL;23;HR;900,Alexandre Parsemain;PL;23;MQ;700,Yan Maranhão;PL;24;BR;600",
    EST: "Martin Turk;G;23;SI;300,Joel Robles;G;36;ES;200,Diogo Dias;G;23;PT;200,Stelios Andreou;DC;24;CY;2000,Ferro;DC;29;PT;1000,Ismael Sierra;DC;23;ES;1000,Xavi Sintes;DC;25;ES;400,Jordan Arnolin;DC;18;PT;300,Sam Amissah;DC;19;EN;0,Roko Jurisic;LE;25;HR;650,Fernando Medrano;LE;26;ES;500,Tiago Parente;LE;22;PT;500,Ricard Sánchez;LD;26;ES;3000,Pedro Carvalho;LD;23;PT;800,Jordan Holsgrove;MD;27;SCO;5000,Antef Tsoungui;MD;23;BE;1000,Tiago Brito;MD;22;PT;300,Milan Robin;MC;26;FR;1000,Xeka;MC;32;PT;600,João Carvalho;MO;29;PT;5000,Luís Gomes;MO;22;PT;0,Nail Omerovic;EE;24;BA;2000,André Lacximicant;EE;25;PT;800,Rafik Guitane;ED;27;DZ;4000,Axel Camblan;ED;23;FR;600,Fabrício Garcia;ED;25;CV;400,Peixinho;ED;22;PT;200,Yanis Begraoui;PL;25;MA;12000,Israel Salazar;PL;23;ES;100",
    CPI: "Patrick Sequeira;G;27;CR;3000,André Gomes;G;22;PT;2500,Ivan Mandić;G;23;HR;300,Daniel Azevedo;G;28;PT;200,João Goulart;DC;26;PT;1500,David Sousa;DC;25;BR;1500,Kaique Rocha;DC;25;BR;1000,Felipe Silva;DC;24;BR;1000,Kaly;DC;22;AO;400,Abdu Conté;LE;28;PT;700,Pedro Rosas;LE;25;PT;500,André Geraldes;LD;35;PT;100,Selvi Clua;MD;21;ES;500,Seba Pérez;MD;33;CO;300,JP;MC;21;BR;2000,Lawrence Ofori;MC;28;GH;1500,Gabi;MC;26;PT;550,Abdu Dafé;MC;18;PT;200,Kevin Prieto;MDi;23;UY;500,João Rego;MO;21;PT;3000,Benjamin Pauwels;EE;22;BE;800,Rochinha;EE;31;PT;500,Aymen Zouin;EE;19;MA;250,Jérémy Livolant;ED;28;FR;2500,Mohamed Salah;ED;22;BE;900,Henrique Araújo;PL;24;PT;1000,Alassana Jatta;PL;27;GM;600,Evans Maurin;PL;25;FR;300,Cassiano;PL;37;BR;100",
    STC: "Lucas França;G;30;BR;800,Neneca;G;23;BR;300,MT;DC;25;BR;3000,Emanuel Moreira;DC;23;PT;800,Henrique Silva;DC;21;BR;500,Pedro Pacheco;DC;29;PT;500,Ythallo;DC;22;BR;300,Guilherme Romão;LE;29;BR;600,Lucas Soares;LD;28;BR;1500,Pedro Ferreira;MD;28;PT;3000,Dani Borges;MD;23;BR;700,Djé;MC;23;CV;1000,Tiago Ribeiro;MC;24;PT;600,Vitinho;MC;22;BR;500,Kamika;ME;22;PT;0,Vasconcelos;MO;21;PT;1000,Fredy;MO;20;PT;100,Sorriso;EE;20;BR;800,Afonso Duarte;EE;21;PT;100,Vinícius Lopes;ED;27;BR;2500,Brenner;ED;24;BR;1500,Welinton Torrão;ED;27;BR;400,Gonçalo Paciência;PL;32;PT;700,Fernando;PL;21;BR;400,Léo Jacó;PL;21;BR;400",
    ARO: "Ignacio de Arruabarrena;G;29;UY;1500,Jakub Vinarčík;G;21;SK;300,Martim Duarte;G;23;PT;0,José Fontán;DC;26;ES;2500,Boris Popović;DC;26;YU;1000,Javi Sánchez;DC;29;ES;1000,Diogo Monteiro;DC;21;PT;300,Orest Lebedenko;LE;28;UA;500,Mario Climent;LE;24;ES;500,Tiago Esgaio;LD;31;PT;1000,Leo Shahar;LD;19;EN;0,Taichi Fukui;MC;22;JP;6000,Espen van Ee;MC;23;NL;1500,Mateo Flores;MC;22;ES;1200,Pedro Santos;MC;26;PT;600,Hyun-ju Lee;MO;23;KR;2500,Pablo Gozálbez;MO;25;ES;700,Naïs Djouahra;EE;26;FR;2000,Brian Mansilla;EE;24;UY;800,Gabriel Rukavina;EE;22;HR;500,Si-hoo Park;EE;19;KR;400,Miguel Puche;EE;25;ES;300,Alfonso Trezza;ED;27;UY;1500,Costinha;ED;18;PT;0,Iván Barbero;PL;28;ES;2500,Fally Mayulu;PL;24;FR;1200,Dylan Nandín;PL;24;UY;1000",
    BOA: "João Fernando;G;25;BR;0,Diego Loureiro;G;28;BR;0,André Fausto;DC;32;BR;0,Pedro Vitor;DC;29;BR;0,Gabriel Araújo;DC;26;BR;0,Tito;LE;29;BR;0,Vinício;LE;26;BR;0,Diogo Correia;LE;23;BR;0,Matheus Rocha;LD;27;BR;0,Felipe Santos;LD;27;BR;0,Fernando;LD;27;BR;0,Parrudo;MD;32;BR;0,Emanuel Jesus;MD;22;BR;0,Guilherme Ferezin;MD;20;BR;0,Gabriel Richvicki;MD;21;SV;0,Nicolas Maiorino;MD;22;BR;0,Patrick;MD;26;BR;0,Gabriel Tota;MC;25;BR;0,Isael;MO;38;BR;0,Leandrinho;MO;30;BR;0,Ruan;MO;28;BR;0,Felipinho;MO;23;BR;0,Misael Xavier;MO;24;BR;0,Keké;EE;31;BR;0,Lucas Silva;EE;28;BR;0,Luketa;EE;27;BR;0,Júnior Fialho;PL;28;BR;0,Berê;PL;23;BR;0,Keven Coloni;PL;21;BR;0",
    NAC: "Renato Marin;G;20;BR;1500,João Gonçalves;G;26;PT;500,Kevyn;G;21;BR;200,Zé Vítor;DC;25;BR;2500,Léo Santos;DC;27;BR;1500,Ulisses;DC;27;BR;1000,Ivanildo Fernandes;DC;30;CV;200,Chico Gonçalves;DC;22;PT;200,José Gomes;LE;30;PT;600,Matias Silva;LE;17;PT;0,Wesley Gasolina;LD;26;BR;700,Daniel de la Cruz;LD;22;EC;500,Matheus Dias;MD;24;BR;1500,Liziero;MC;28;BR;1500,Chiheb Labidi;MC;25;TN;500,Joel Silva;MC;23;PT;400,Danel Dongmo;MC;25;CM;350,Deivison;MC;20;BR;200,Josué Souza;MC;21;BR;100,William Kokolo;ME;26;FR;500,Daniel Jr;MO;24;BR;700,Matchoi Djaló;MO;23;PT;500,Filipe Soares;MO;27;PT;500,Miguel Baeza;MO;26;ES;400,Mateus Iseppe;MO;20;BR;400,Min-kyu Song;EE;27;KR;1000,Fernando Nava;EE;22;BO;500,Markus Jensen;EE;21;DK;400,Stavros Gavriel;ED;24;CY;600,Pablo Ruan;ED;23;BR;500,Allen Obando;PL;20;EC;900,Njoya Abdel;PL;23;CM;900",
    AMA: "Léo Linck;G;25;BR;2500,Diogo Pinto;G;22;PT;300,David Grilo;G;30;PT;100,Stefan Lekovic;DC;22;YU;2500,Luan Patrick;DC;24;BR;2000,Bernardo Schappo;DC;27;BR;600,Atanas Chernev;DC;24;BG;600,Rafa Soares;LE;31;PT;1000,Lucas Mincarelli;LE;22;FR;800,Max Scholze;LD;21;DE;3000,Jefferson Encada;LD;28;GW;400,Eddy Doué;MD;20;CI;5000,Santiago Serra;MD;19;PT;3000,Kevin Höög Jansson;MD;26;SE;400,Vuk Pavicevic;MD;18;ME;0,Joan Jordán;MC;32;ES;800,Robinho;MC;24;BR;600,Tom Moustier;MC;24;FR;400,Lovro Zvonarek;MO;21;HR;1800,Emerson Vanga;MO;20;FR;100,Ianis Stoica;EE;23;RO;4000,Bénito;EE;23;FR;300,Rodrigo Dudok;EE;19;UY;100,Alisson Souza;EE;21;BR;100,Abraham Marcus;ED;26;NG;3000,Jeremy Arévalo;PL;21;EC;7000,Leandro Antonetti;PL;23;PR;4000,René Mitongo;PL;18;BE;1000,Henrique Poniewas;PL;20;BR;0",
    AVS: "Raul;G;29;BR;400,Dani Rebollo;G;26;ES;200,Estevão;G;22;BR;0,Bernardo Conde;DC;20;FR;500,Lazar Rosic;DC;33;YU;275,Davi Schuindt;DC;22;BR;250,Ponck;DC;36;CV;100,Daniel Rivas;LE;24;PY;500,André Sousa;LE;28;PT;250,Mateus Pivô;LD;28;BR;300,Diogo Brasido;LD;23;PT;200,Roni;MD;27;BR;1000,Fernando Almeida;MD;24;PT;300,Hiago;MD;22;BR;150,Pedro Pimentel;MC;19;PT;0,Andrey;MO;24;BR;200,Jorge Meireles;EE;22;PT;600,Guilherme Neiva;EE;25;BR;300,Abdoulaye Keita;EE;24;ES;200,Guga;EE;22;BR;125,Rafael Lobato;ED;20;BR;800,Ruan Assis;ED;22;BR;400,Régis N'Do;ED;25;BF;200,Deandre Kerr;PL;23;CA;1000,Talles Wander;PL;23;BR;200,Rodrigo Pinho;PL;35;BR;150",
    TON: "Lucas Cañizares;G;24;ES;400,Ruly García;G;26;ES;300,Carlão;G;22;BR;250,Rodrigo da Silva;G;17;PT;0,Brayan Medina;DC;24;CO;3000,Christian Marques;DC;23;PT;2000,Farru;DC;25;ES;200,João Afonso;DC;36;PT;50,Bruno Almeida;DC;26;CV;0,Zé Ricardo;LE;28;BR;350,Ian Kamga;LE;21;EN;0,Gabriel Ramalho;LE;20;PT;0,Bebeto;LD;36;BR;50,Carraça;LD;33;PT;50,Cícero;MD;29;BR;500,Mateus Sarará;MD;24;BR;275,Yaya Sithole;MC;27;ZA;600,Hélder Tavares;MC;36;CV;50,Hugo Félix;MO;22;PT;800,Richarllyson;MO;18;BR;200,Xabi Huarte;MO;25;ES;200,Henry Addo;EE;23;GH;500,Tiago Dias;EE;28;PT;300,Arjen van der Heide;ED;24;NL;350,Cascavel;ED;21;PT;325,Gastón Novero;ED;28;AR;150,João Lima;PL;26;BR;150,Tomané;PL;34;PT;150",
    ALV: "Noah Raveyre;G;21;FR;1500,Matheus Mendes;G;27;BR;600,Jhonatan;G;35;BR;100,Bastien Meupiyou;DC;20;FR;7000,Yaya Bojang;DC;22;GM;1500,Steven Baseya;DC;21;FR;700,Julián Martínez;DC;22;HN;500,Sergi Gómez;DC;34;ES;200,Mofe Jemide;DC;20;EN;0,Chissumba;LE;21;PT;5000,Isaac James;LE;22;NG;1000,Diogo Spencer;LD;22;PT;2000,Toni Tamarit;LD;20;ES;500,Rodrigo Catraio;LD;21;PT;0,Vasco Moreira;MD;25;PT;1000,Ian Luccas;MD;23;BR;1000,Rayan Lucas;MD;21;BR;900,Sabit Abdulai;MD;27;GH;500,Davy Gui;MC;20;CI;800,Zé Rafael;MC;33;BR;800,Zakaria Kessary;MC;20;MA;150,Tiago Octávio;MC;22;PT;0,Nabil Touaizi;MDi;25;MA;800,Ikker Julian;ME;21;BE;0,Lucca Giuntini;MO;20;IT;0,Chiquinho;EE;26;PT;5000,Figueiredo;EE;25;BR;5000,André Vidigal;EE;28;AO;800,Cédric Nuozzi;EE;20;BE;800,Matheus França;SA;22;BR;6000,Vivaldo Semedo;PL;21;PT;2000,Dawda Camara;PL;24;MR;2000,Samy Merheg;PL;19;LB;1000",
    BEL: "Guilherme Oliveira;G;31;PT;0,Sebastián Álvarez;G;23;UY;0,Bruno Dias;G;18;PT;0,Diego Riechelmann;G;27;BR;0,Nuno Tomás;DC;31;PT;0,Afonso Pinto;DC;22;PT;0,Caica;DC;21;AO;0,Cesinha;DC;25;BR;0,Mário Rui;LE;35;PT;0,João Lucas;LE;30;PT;0,Evandro Barros;LE;27;PT;0,Miguel Bandarra;LD;30;PT;0,David Monteiro;LD;22;PT;0,Diogo Varela;LD;19;PT;0,Afonso Valente;MC;25;PT;0,Tiago Morgado;MC;33;PT;0,Diogo Maria;MC;22;PT;0,Diogo Leitão;MO;28;PT;0,David Herrera;MO;24;CO;0,Afonso Afonso;MO;26;PT;0,Valter Zacarias;EE;29;PT;0,Midana Sambú;EE;28;PT;0,Tiago Moninhas;EE;23;PT;0,Bruninho;EE;28;PT;0,Lian;EE;21;BR;0,Ricardo Fevereiro;ED;22;PT;0,Chamito;PL;22;MZ;150,João Oliveira;PL;28;PT;0,Eduardo Love;PL;28;BR;0,Nikson;PL;20;GW;0",
    ACA: "Victor Braga;G;34;BR;275,Carlos Alves;G;28;PT;250,Nuno Macedo;G;27;PT;0,Ricardo Teixeira;DC;25;PT;400,Ni;DC;23;PT;300,Kauan;DC;23;BR;275,Gui Silva;DC;26;BR;0,Hélder Lopes;LE;37;PT;150,Káká;LE;34;PT;50,Xavi Grande;LD;21;ES;800,Pontus Texel;LD;22;DK;400,Edson Farias;LD;34;BR;50,Leverton Pierre;MD;28;HT;200,João Oliveira;MD;34;PT;50,Jean Sinisterra;MC;26;CO;250,Leandro Silva;MC;32;PT;200,Hugo Nunes;MC;24;PT;100,Marcos Paulo;MC;38;BR;50,Tiago Soares;MC;16;PT;0,Alioune Mané;EE;23;SN;150,Rui Gomes;EE;29;PT;150,Afonso Rodrigues;ED;24;PT;150,Kévin Zohi;PL;29;ML;650,Martim Tavares;PL;23;PT;300,Ilies Faure;PL;25;FR;250,Amadou Coundoul;PL;24;SN;200",
    MAR: "Fran Vieites;G;27;ES;1200,Gonçalo Tabuaço;G;25;PT;250,Alfonso Pastor;G;26;ES;125,Romain Correia;DC;27;PT;1500,Gábor Szalai;DC;26;HU;1000,Rafael Fernandes;DC;24;PT;500,Nilton;LE;25;PT;800,Paulo Henrique;LE;30;PT;700,Nathanael Ogbeta;LE;25;EN;400,Tomás Tavares;LD;25;PT;300,Igor Julião;LD;32;BR;100,Vladan Danilović;MD;27;BA;800,Rodri Andrade;MD;24;PT;500,Francisco Silva;MD;19;PT;0,Yellu Santiago;MC;22;ES;700,Ibrahim Alani;MC;20;NG;500,Raphael Guzzo;MC;31;PT;300,Israel Isaac Ayuma;MC;21;NG;300,Nélio Batista;MC;17;PT;0,Maxime Dominguez;MO;30;CH;400,Martín Tejón;EE;22;ES;2500,Simo Bouzaidi;EE;26;MA;1200,Enrique Peña Zauner;EE;26;VE;250,Bryan Limbombe;ED;25;BE;400,Samuel Bamba;ED;22;DE;350,Xiko Gomes;ED;22;PT;200,Adrián Butzke;PL;27;ES;800,Maurice Boakye;PL;22;DE;400,José Melro;PL;22;PT;350,Mons Bassouamina;PL;28;CG;300",
    LEI: "Simão;G;33;BR;200,Caio Secco;G;35;BR;100,Igor Stefanović;G;38;YU;25,João Cardoso;G;22;PT;0,Lourenço;DC;22;PT;800,Alysson;DC;24;BR;350,Matheus Costa;DC;31;BR;250,Semeu Commey;DC;22;GH;225,Hugo Faria;DC;22;PT;200,Daniel Nolasco;DC;21;BR;75,Serif Nhaga;LE;21;PT;400,Simãozinho;LE;31;PT;150,Fernando Fonseca;LD;29;PT;200,Paulinho;LD;35;PT;75,António Gonçalves;LD;21;PT;0,Amadu Baldé;MD;21;GW;450,Agustin De Armas;MD;21;IT;125,João Assunção;MD;22;PT;100,Cláudio Araújo;MC;23;PT;600,Miguel Sousa;MC;28;PT;300,Arthur Baggio;MC;22;BR;0,Rafael Barbosa;MO;30;PT;200,Rúben Pina;EE;26;CV;200,Salvador Agra;ED;35;PT;75,Bica;PL;23;PT;500,Luccas Paraizo;PL;24;BR;250,Kaique;PL;22;BR;250,Bryan Róchez;PL;31;HN;150,Morufdeen Moshood;PL;22;NG;150",
    CHA: "João Valido;G;26;PT;400,Marko Gudžulić;G;24;YU;250,Rodrigo Moura;G;30;BR;150,Bruno Rodrigues;DC;25;PT;1200,Tiago Simões;DC;26;PT;450,Mamadou Tounkara;DC;24;ML;175,Néstor Araújo;DC;35;MX;150,Ricardo Alves;DC;35;PT;25,Ivo Vázquez;LE;26;MX;375,Kiko;LE;27;PT;300,Aarón Romero;LE;27;ES;250,Léo Alaba;LD;27;BR;500,Antony Herbert;LD;21;PA;50,Gilberto García;MD;26;MX;700,Aílson Tavares;MD;28;CV;600,Brice Eboudjé;MD;21;CM;100,Dru Yearwood;MC;26;EN;700,Pedro Pelágio;MC;26;PT;300,Mohamed Fofana;MC;21;CI;175,João Teixeira;MC;32;PT;100,André Rodrigues;MO;28;PT;175,Di Cardoso;MO;22;PT;0,Robyn Esajas;EE;24;NL;300,Costinha;EE;25;PT;250,Lucas Lima;EE;19;CA;0,GB;PL;21;BR;1500,Wilson Tavares;PL;24;CV;350,Marquinhos;PL;23;BR;200,Armando Jr;PL;24;ES;175,Roberto;PL;37;PT;50,Divin Muteba;PL;22;CD;0",
    PTM: "Sébastien Cibois;G;28;FR;225,Dudu;G;27;DE;150,Lagartinho;G;19;PT;0,Wellington Santana;G;29;BR;0,Marlon Júnior;DC;21;PT;500,Jarleysom;DC;22;BR;400,Samy;DC;27;AO;175,Georgiy Tunguliyadi;DC;22;SU;0,Italo Cabelinho;DC;22;BR;0,Thauan Lara;LE;22;BR;400,João Reis;LE;34;PT;75,Edney;LD;22;BR;600,Xavier;MD;26;BR;325,Yanis da Rocha;MD;22;PT;200,Felipe Favero;MD;23;BR;0,João Casimiro;MC;20;PT;250,Caleb Okereke;MC;19;NG;0,Shoya Nakajima;MO;32;JP;500,Wermeson;MO;25;BR;125,Samuel Yépié Yépié;MO;24;FR;0,Ericson;MO;23;BR;0,Jader Gentil;EE;23;BR;500,Dânio Djassi;EE;20;GW;350,Gonçalo Águas;EE;23;PT;150,Zinho;EE;23;BR;0,Mamede;ED;24;PT;450,Dudá;ED;23;PT;225,Welinton Junior;ED;33;BR;75,João Mendes;ED;21;BR;0,Midana Cassamá;PL;24;GW;250,Paulinho;PL;27;PT;0",
    VIZ: "Antonio Gomis;G;23;ES;900,Aleksandar Vulic;G;25;YU;500,Pedro Souza;G;24;PT;100,José Sampaio;DC;21;PT;550,Jean-Pierre Rhyner;DC;30;PE;250,Andrea Hristov;DC;27;BG;250,Luís Rocha;DC;40;PT;50,Bright Godwin;LE;24;NG;600,Ismaël Diallo;LE;29;CI;250,Jójó;LD;25;CV;400,Luis Mina;LD;21;CO;300,Alfred Caicedo;LD;22;EC;300,Giovani Bamba;MD;27;CH;300,Moustapha Sanogo;MD;19;CI;0,Miguel Pires;MC;24;PT;700,Aliou Traoré;MC;25;FR;600,Neto;MC;35;BR;50,Heinz Mörschel;MO;29;DO;1000,Angel Bastunov;MO;27;BG;350,Alexis Tibidi;EE;23;CM;200,Cristián Cañozales;EE;27;CO;200,Matías Lacava;ED;24;VE;650,Thio;ED;27;FR;600,Miguel Tavares;ED;28;PT;400,Rodrigo Ramos;ED;22;PT;300,Lucas Antañón;ED;23;ES;250,Yassin Fortuné;PL;27;HT;300,Manu Garrido;PL;26;ES;250,Anthony Carter;PL;32;AU;200",
    PEN: "Eric Puerto;G;24;ES;200,Alexéi Rojas;G;21;CO;150,Miguel Oliveira;G;32;PT;75,Cláudio Silva;DC;26;PT;500,Adrián Pica;DC;24;ES;500,Jaime Sánchez;DC;31;ES;175,João Miguel;DC;33;PT;150,Jorge Meré;DC;29;ES;150,Meireles Injai;DC;23;GW;0,Iano Simão;LE;27;GW;325,Teddy Alloh;LE;24;FR;175,Martim Alberto;LE;22;PT;100,Douglas Borel;LD;24;BR;300,Gonçalo Negrão;LD;23;PT;300,Duarte Oliveira;LD;21;PT;0,Francisco Varela;MD;26;PT;250,Mairlon Ramon;MD;21;BR;125,Pedro Sá;MD;32;PT;100,Carlinhos Augusto;MD;22;GW;0,Àlex Carbonell;MC;29;ES;275,João Pinto;MO;24;PT;300,Tomás Teixeira;MO;20;PT;0,Davo;EE;31;ES;200,Juanda Fuentes;EE;23;CO;200,Nuninho;EE;23;PT;100,Konrad Sinyam;EE;21;CM;0,Max Svensson;PL;25;ES;400,Ricardo Schutte;PL;28;PT;175,Clau Mendes;PL;25;GW;100",
    FEI: "Francisco Meixedo;G;25;PT;350,Diego Altube;G;26;ES;300,Antonio Leal;DC;27;ES;550,João Queirós;DC;28;PT;400,Edgar Ié;DC;32;GW;200,Pedro Pinto;DC;32;PT;100,Kaiquy;DC;20;BR;0,Miguel Rocha;DC;20;BR;0,Diego Moreno;LE;24;ES;200,André Lopes;LE;25;PT;200,Bolaji;LE;19;NG;0,Luiz Gustavo;LD;27;BR;500,Jójó;LD;27;PT;350,Dorival;LD;22;BR;0,Samad Popoola;MD;21;NG;250,Momo Diaby;MD;30;FR;200,Tiago Antunes;MD;23;PT;150,Diogo Mendes;MD;28;CV;0,Gui Santos;MC;21;PT;150,Tiago Castro;MC;30;PT;150,Hassan Wahab;MC;21;NG;0,Luisinho;MO;20;PT;400,Isaac;MO;22;BR;250,Gui Meira;MO;21;BR;225,Henrique Pereira;EE;24;PT;400,Pedrinho;EE;22;BR;175,Jonny Arriba;ED;25;ES;200,Adriel Moraes;ED;20;BR;125,Piri;ED;23;ES;100,Desmond Nketia;PL;25;GH;275,Arthur Viana;PL;22;BR;200,Jair Monteiro;PL;20;PT;175,Peter Adejimi;AV;19;NG;100,Alexandre Guedes;PL;32;PT;75",
    OLI: "Rui Dabó;G;32;GW;0,Ricardo Ribeiro;G;36;PT;0,Unai Pérez;G;24;ES;0,Sérgio Dutra;G;24;PT;0,Simão Martins;DC;29;PT;0,Gonçalo Loureiro;DC;26;PT;0,André Almeida;DC;31;PT;0,Guilherme Silva;DC;20;PT;0,João Félix;DC;24;BR;0,Luís Bastos;LE;25;PT;0,Vasco Santos;LD;20;PT;0,João Sérgio;LD;23;PT;0,João Daniel;MD;24;PT;0,Vasco Braga;MC;33;PT;0,Kazuya Onohara;MC;30;JP;0,Rodrigo Pinho;MC;18;PT;0,Diogo Sancho;MC;21;PT;0,Kotaro Nagata;MO;21;JP;0,Sota Matsunaga;MO;23;JP;0,Kiko Félix;EE;23;PT;0,Ricardo Rei;EE;23;PT;0,Yefrei Rodríguez;PL;21;CO;0,Rodrigo Marquês;PL;23;PT;0,João Tavares;PL;24;BR;0,Miguel Monteiro;PL;23;PT;0,Théo Fonseca;PL;26;PT;0",
    TOR: "Lucas Paes;G;28;BR;1300,Adriel;G;25;BR;900,Lisandru Olmeta;G;21;FR;500,Mohamed Ali Diadié;DC;22;MR;1600,Volnei;DC;26;BR;450,Jérémy Mounsesse;DC;21;CG;250,Hugo Pérez;DC;23;ES;200,Brian Agbor;DC;25;CM;175,Stopira;DC;38;CV;50,Javi Vázquez;LE;26;ES;2500,Juan María Alcedo;LE;25;ES;400,Jonathan Mutombo;LD;24;FR;400,Danilo;LD;22;BR;350,David Bruno;LD;34;PT;75,Amine Oudrhiri;MD;34;MA;235,André Simões;MC;23;PT;900,Alejandro Alfaro;MC;24;ES;600,Joel Romero;MC;20;CO;500,Carraro Injai;MC;20;FR;25,Carlos Reina;MO;22;ES;300,Nuha Jatta;MO;20;DE;300,Costinha;MO;34;PT;125,João Marques;EE;24;PT;1500,Dany Jean;EE;23;HT;1400,Vando Félix;EE;24;GW;500,Adama Baradji;EE;19;FR;250,Manu Pozo;ED;24;ES;1200,Luis Quintero;ED;22;CO;500,Musa Drammeh;PL;24;ES;700,Jorge Aguirre;PL;26;CU;600,Karem Zoabi;PL;20;IL;600,Malik Abubakari;PL;26;GH;400",
    FAR: "Fabijan Buntic;G;29;HR;450,Jakob Tånnander;G;26;SE;350,Kauã Paes;G;20;BR;0,Rodrigo Borges;DC;28;PT;300,Nermin Zolotic;DC;33;BA;300,Gonçalo Silva;DC;35;PT;175,Bernardo Antunes;DC;22;PT;0,Toni Herrero;LE;25;ES;400,Derick Poloni;LE;33;BR;150,Lucas D'Agrella;LD;21;PT;400,Alex Pinto;LD;28;PT;350,Dário Miranda;LD;23;PT;125,Claudio Falcão;MD;32;BR;450,Miguel Menino;MC;23;PT;700,Sarpreet Singh;MC;27;NZ;500,Joseph Nduquidi;MC;22;AO;350,Mattheus;MO;32;BR;350,Rafinha;MO;20;PT;300,Rodrigo Laranjeira;MO;18;PT;0,Vitinho;EE;22;BR;150,André Candeias;ED;23;PT;650,Edi Semedo;ED;27;CV;150,Gabriel Barbosa;PL;27;BR;350,Cuba;PL;23;PT;300,João Resende;PL;23;PT;250,Leonardo Oliveira;PL;21;SE;200,João Gastão;PL;20;AO;200,Nélson Oliveira;PL;35;PT;100",
    ULE: "Christian Joel;G;27;CU;600,Jakob Odehnal;G;25;AT;300,Zé Pedro;DC;24;PT;750,Miguel Nóbrega;DC;26;PT;400,Leo Mascaró;DC;23;BY;100,Marcelo;DC;37;BR;50,Marc Baró;LE;27;ES;750,Hugo Masaki;LE;22;BE;350,Maga;LD;27;PT;800,Ibrahima Guirassy;MD;28;FR;400,Eboue Kouassi;MD;28;CI;200,Diogo Amado;MD;36;PT;25,Reko;MC;31;PT;350,Albert Lottin;MC;25;FR;250,Bernardo Gomes;MC;22;PT;250,Tharlley;MC;22;BR;175,Diogo Martins;MC;30;PT;150,Damien Loppy;EE;29;FR;400,Nabil Ondó;EE;20;GQ;100,Jordan van der Gaag;ED;27;NL;550,Jair Silva;ED;29;BR;450,Jaiminho;ED;29;PT;200,Pedro Oliveira;ED;21;PT;125,Juan Muñoz;PL;31;ES;1000,Borislav Rupanov;PL;21;BG;600,Pablo Fernández;PL;30;ES;500,Samuel Ntanda;PL;21;CD;250,Stefan;PL;17;MZ;0",
    BMA: "Ricardo Benjamim;G;27;PT;0,Tiago Cruz;G;24;PT;0,Diogo Almeida;G;20;PT;0,Jorge Silva;DC;27;PT;0,André Motta;DC;20;PT;0,Diogo Abdul;DC;28;PT;0,Tomás Sério;DC;23;PT;0,Sana Mané;LE;24;GW;0,Tiago Melo;LD;30;PT;0,Mondoni;LD;21;BR;0,Mariano Regal;MD;21;PT;0,Lucas Ornellas;MC;26;PT;0,Ibrahima Sy;MC;23;SN;0,Igor Santos;MC;28;PT;0,Diogo Matos;MO;20;PT;0,Eduardo Souza;MO;26;BR;0,Chico Leal;MO;23;PT;0,Flavinho;EE;30;BR;0,Ricardinho;EE;20;BR;0,André Mendy;ED;25;SN;0,Vitalli Savchuk;ED;22;UA;0,David Silva;ED;18;PT;0,João Sá;ED;19;PT;0,Gustavo Almeida;ED;22;PT;0,Francisco Martim;ED;21;PT;0,David Oliveira;PL;29;BR;0,Murilo Nogueira;PL;19;BR;0,Julián Pérez;PL;19;CO;0,Didi;PL;28;PT;0",
    OLH: "João Azul;G;38;PT;0,João Félix;G;23;PT;0,João Correia;DC;26;PT;0,Pipo;DC;29;PT;0,Edu;LE;26;PT;0,Celsinho;LE;30;PT;0,Miguel Pires;LE;23;PT;0,Jair Brito;LE;24;PT;0,Fabinho;LD;28;PT;0,Gonçalo Martins;LD;28;PT;0,Ailton Tavares;MD;31;CV;0,Farouk Mohammed;M;21;GH;0,Tomás Cintra;MD;21;PT;0,Paulo Forra;MC;25;PT;0,Caio Carioca;MC;26;BR;0,Zé António;MC;22;PT;0,Bruno Fernandes;MO;32;BR;0,Tomás Fernandes;EE;25;PT;0,Rosário Silva;EE;27;AO;0,Afonso Calvinho;ED;25;PT;0,David Vieira;ED;28;PT;0,Daniel Popa;ED;24;PT;0,Juan Nazarit;SA;23;CO;0,Victor Nicolatti;PL;26;BR;0",
    VAR: "Gustavo Ramalho;G;24;BR;0,Pedro Costa;G;26;PT;0,Momo Mbaye;G;29;SN;0,Kauã Vinicius;DC;22;BR;0,Rúben Fernandes;DC;40;PT;0,Pedro Nuno;DC;26;PT;0,Miguel Vila Cova;DC;20;PT;0,Milhazes;LE;29;PT;0,Stitch;LE;22;PT;0,André Guedes;LE;26;PT;0,Renan Silva;LD;22;BR;0,Luís Oliveira;LD;25;PT;0,David Peres;MD;22;BR;0,Rúben Oliveira;MC;31;PT;0,Boloto;MC;22;PT;0,Diogo Rebelo;MC;22;PT;0,Marcelo Cunha;MO;26;CV;0,Pedro Matos;EE;29;PT;0,Tim;EE;21;PT;0,Dani Benchi;ED;23;PT;0,Jordão Cardoso;ED;30;PT;0,João Couto;ED;24;PT;0,Rodrigo Pereira;PL;23;PT;0,Francisco Silva;PL;23;PT;0",
    TRO: "Manuel Baldé;G;24;GW;400,Ricardo Moura;G;37;PT;0,Vicente Oliveira;DC;22;PT;0,João Vale;DC;21;PT;0,Agustín Granja;DC;21;UY;0,Luccão;DC;23;BR;0,Tiago Silva;DC;22;PT;0,Tomás Oliveira;LE;21;PT;0,Samuca;LE;20;ST;0,Emerson Buiu;LD;20;BR;0,Joel Oliveira;LD;21;PT;0,Rafa Peixoto;LD;22;PT;0,Wilson Oliveira;LD;23;PT;0,Rafael Assis;MD;36;BR;0,Matheus Claudino;MD;27;BR;0,Cristián Morán;M;22;US;0,Saná Ufala;MD;23;PT;0,Pedro Teixeira;MC;21;PT;0,Diogo Nunes;MC;23;PT;0,André Gomes;MC;20;PT;0,Juninho;EE;20;BR;0,Jorge López;EE;20;PY;0,Luís Miguel;EE;21;BR;0,Kauã Souza;EE;20;BR;0,Kiki;ED;28;PT;0,Feliz;ED;37;PT;0,Nuninho;ED;28;PT;0,Jefer Gunjo;ED;21;AO;0,Weliton;PL;21;BR;0,Kevyn;PL;20;BR;0",
    LUS: "Brian Araújo;G;26;PT;600,Gabriel Souza;G;29;BR;150,Marco Ribeiro;G;31;PT;100,Dylan Collard;DC;26;MU;600,Bruno Faria;DC;22;PT;400,Guilherme Soares;DC;25;PT;300,Silvério;DC;30;PT;200,Josué Sá;DC;34;PT;75,Leonardo Paiva;DC;18;PT;0,Francisco Machado;LE;21;PT;350,Luís Rocha;LE;33;PT;100,Ricardinho;LD;32;PT;450,Danny;LD;28;BR;225,Diogo Paulo;MD;25;PT;275,António Montez;MD;25;PT;225,Miguel Teixeira;MC;23;PT;600,Fabinho;MC;31;PT;150,André Ricardo;MO;26;PT;350,Francisco Reis;MO;18;PT;0,Paulité;EE;26;PT;250,Moises Tablante;EE;25;VE;175,Mika Borges;EE;29;PT;150,Arsénio;EE;37;PT;50,Manel;EE;19;PT;50,Saliou Mandiang;ED;23;SN;200,João Santos;PL;27;PT;250,Iuri Moreira;PL;22;PT;125,João Silva;PL;36;PT;50",
    COV: "Fábio Duarte;G;28;CV;0,Henrique Torcato;G;18;PT;0,Gustavo Galil;G;28;BR;0,Rodrigo Mendes;DC;21;PT;0,Mohamed Aidara;DC;30;CI;0,Emerson Gomes;DC;27;PT;0,Tiago Lemos;DC;18;PT;0,Diogo Silva;LE;25;PT;0,Edu Silva;LE;26;PT;0,Kauan;LD;21;BR;0,Harruna;MD;26;GH;0,Ângelo Barbosa;MD;26;PT;0,Tomás Silva;MC;23;PT;150,Ronaldo Coelho;MC;25;PT;0,João Cruz;MC;22;PT;0,Fábio Cruz;MO;27;PT;0,Gonçalo Cascalheira;MO;22;PT;0,Jailson;EE;25;GW;0,Danny;ED;25;PT;0,Martim Peixoto;ED;19;PT;0,Peixoto;ED;20;PT;0,João Pacheco;ED;22;PT;0,Ekanga;PL;23;CM;0,Gui Silva;PL;19;PT;0,Isaac;PL;21;CI;0,Cheick Niang;PL;24;SN;0",
    AMO: "Gabriel Martins;G;19;PT;0,Tiago Neto;G;22;PT;0,Heloine Correia;G;21;PT;0,Tony;DC;27;NG;0,Tiago Duque;DC;32;PT;0,Diogo Ramos;DC;23;PT;0,Marlom;DC;24;BR;0,Rafael Carreira;DC;21;PT;0,Fábio Melo;DC;23;PT;0,Gonçalo Maria;LE;30;PT;0,André Canteiro;LE;20;PT;0,Didier Mosquera;LD;26;CO;0,Guilherme Pinheiro;LD;20;PT;0,Renato Carvalho;LD;21;PT;0,Hélio Cruz;MD;33;PT;0,Ricardo Matias;MD;23;PT;0,Afonso Alves;M;21;PT;0,Armandinho;MD;23;PT;0,Mauro Antunes;MC;34;PT;0,Dino Semedo;ME;27;PT;0,Joca;EE;33;PT;0,Miguel Lopes;EE;31;PT;0,Ednilson Furtado;EE;30;PT;0,Pedro Marques;PL;24;PT;0,Ablaye Diop;PL;25;SN;0,Diogo Baldé;PL;19;CV;0",
    ATL: "Nuno Hidalgo;G;35;PT;0,José Bolivar;G;21;VE;0,Rodrigo Dias;G;25;PT;0,Bura;DC;37;PT;0,Rafael Tavares;DC;24;PT;0,Duarte Henriques;DC;23;PT;0,Edu Monteiro;DC;24;PT;0,Alison Calegari;DC;25;BR;0,Dinamite;LE;31;PT;0,Vicente Durand;LE;22;PT;0,Janico;LD;24;PT;0,Gabriel Costa;MD;20;PT;0,Ricardo Dias;MD;35;PT;0,Mohamed Konaté;MD;22;CI;0,César Sousa;MC;26;AO;0,Caleb;MC;34;BR;0,Rodrigo Ramos;MO;23;PT;0,Bernardo Lourenço;MO;24;PT;0,Solo Traoré;EE;20;ES;0,Edgar Pacheco;EE;26;PT;0,Caio Santana;ED;22;BR;0,Hélder Suker;PL;27;CV;0,Pedro Ramos;PL;21;PT;0,Nicolas Souza;PL;25;BR;0,Diego Arezes;PL;21;PT;0,Nuno Gaspar;PL;22;PT;0",
    RMA: "Thibaut Courtois;G;34;BE;15000,Andriy Lunin;G;27;UA;12000,Dean Huijsen;DC;21;ES;60000,Ibrahima Konaté;DC;27;FR;45000,Raúl Asencio;DC;23;ES;18000,Éder Militão;DC;28;BR;18000,Antonio Rüdiger;DC;33;DE;6000,Marc Cucurella;LE;28;ES;60000,Álvaro Carreras;LE;23;ES;50000,Ferland Mendy;LE;31;FR;4000,Trent Alexander-Arnold;LD;28;EN;60000,Denzel Dumfries;LD;30;NL;25000,Aurélien Tchouaméni;MD;26;FR;70000,Federico Valverde;MC;28;UY;90000,Eduardo Camavinga;MC;24;FR;50000,Thiago Pitarch;MC;19;ES;20000,Jorge Cestero;MC;20;ES;7500,Jude Bellingham;MO;23;EN;160000,Arda Güler;MO;21;TR;100000,Bernardo Silva;MO;32;PT;22000,Vinicius Junior;EE;26;BR;130000,Yan Diomande;ED;20;CI;120000,Rodrygo;ED;25;BR;45000,Brahim Díaz;ED;27;MA;35000,Kylian Mbappé;PL;27;FR;200000,Endrick;PL;20;BR;40000,Carlos Espí;PL;21;ES;40000",
    BAR: "Joan García;G;25;ES;45000,Dominik Livakovic;G;31;HR;4000,Wojciech Szczęsny;G;36;PL;800,Pau Cubarsí;DC;19;ES;100000,Eric García;DC;25;ES;45000,Gerard Martín;DC;24;ES;40000,Andreas Christensen;DC;30;DK;8000,Alejandro Balde;LE;23;ES;40000,Jules Koundé;LD;28;FR;55000,Xavi Espart;LD;19;ES;25000,João Cancelo;LD;32;PT;7000,Rodri;MD;30;ES;60000,Marc Bernal;MD;19;ES;40000,Pedri;MC;23;ES;150000,Gavi;MC;22;ES;25000,Frenkie de Jong;MC;29;NL;25000,Brian Fariñas;MC;20;ES;5000,Fermín López;MO;23;ES;110000,Dani Olmo;MO;28;ES;60000,Anthony Gordon;EE;25;EN;80000,Jesse Bisiwu;EE;18;BE;8000,Lamine Yamal;ED;19;ES;220000,Karim Adeyemi;ED;24;DE;40000,Roony Bardghji;ED;20;SE;8000,Raphinha;PL;29;BR;70000,Gabriel Jesus;PL;29;BR;17000,Hamza Abdelkarim;PL;18;EG;8000",
    ATM: "Jan Oblak;G;33;SI;15000,Juan Musso;G;32;AR;3000,Salvi Esquivel;G;21;ES;1000,Marc Pubill;DC;23;ES;50000,Cristian Romero;DC;28;AR;40000,Dávid Hancko;DC;28;SK;35000,Robin Le Normand;DC;30;ES;18000,Jorge Domínguez;DC;16;ES;8000,Alejandro Grimaldo;LE;31;ES;20000,Dani Martínez;LE;22;ES;2500,Marcos Llorente;LD;31;ES;20000,Morten Hjulmand;MD;27;DK;45000,Pablo Barrios;MC;23;ES;70000,Rodrigo Mendoza;MC;21;ES;20000,Johnny Cardoso;MC;25;US;20000,Obed Vargas;MC;21;MX;10000,Koke;MC;34;ES;5000,Kang-in Lee;MO;25;KR;35000,Álex Baena;EE;25;ES;45000,Ademola Lookman;EE;29;NG;40000,Arnau Ortiz;EE;25;ES;6000,Giuliano Simeone;ED;23;AR;40000,Julián Álvarez;PL;26;AR;110000,Jonathan David;PL;26;CA;30000,Alexander Sørloth;PL;30;NO;15000",
    ATH: "Unai Simón;G;29;ES;22000,Álex Padilla;G;23;MX;3000,Dani Vivian;DC;27;ES;20000,Aymeric Laporte;DC;32;ES;8000,Aitor Paredes;DC;26;ES;7500,Yeray Álvarez;DC;31;ES;900,Unai Egiluz;DC;24;ES;400,Johaneko Louis-Jean;LE;22;FR;2000,Yuri Berchiche;LE;36;ES;1000,Jesús Areso;LD;27;ES;5000,Hugo Rincón;LD;23;ES;3500,Mikel Jauregizar;MC;23;ES;25000,Beñat Prados;MC;25;ES;12000,Alejandro Rego;MC;23;ES;5000,Beñat Gerenabarrena;MC;23;ES;5000,Iñigo Ruiz de Galarreta;MC;33;ES;2000,Oihan Sancet;MO;26;ES;25000,Peio Canales;MO;21;ES;10000,Nico Williams;EE;24;ES;40000,Álex Berenguer;EE;31;ES;4000,Álvaro Djaló;EE;27;GW;4000,Robert Navarro;ED;24;ES;7000,Nico Serrano;ED;23;ES;1500,Iñaki Williams;PL;32;GH;8000,Gorka Guruzeta;PL;30;ES;5000,Maroan Sannadi;PL;25;MA;3000",
    RSO: "Álex Remiro;G;31;ES;9000,Unai Marrero;G;25;ES;1000,Jon Martín;DC;20;ES;25000,Mamadou Sarr;DC;21;SN;22000,Igor Zubeldia;DC;29;ES;6000,Jon Pacheco;DC;25;ES;5000,Luken Beitia;DC;22;ES;2000,Sergio Gómez;LE;26;ES;15000,Aihen Muñoz;LE;29;ES;2500,Jon Aramburu;LD;24;VE;15000,Héctor Fort;LD;20;ES;15000,Álvaro Odriozola;LD;30;ES;800,Jon Gorrotxategi;MD;24;ES;25000,Beñat Turrientes;MC;24;ES;10000,Carlos Soler;MC;29;ES;7000,Yangel Herrera;MC;28;VE;6000,Luka Sucic;MO;24;HR;15000,Arsen Zakharyan;MO;23;SU;7500,Pablo Marín;MO;23;ES;7000,Ander Barrenetxea;EE;24;ES;18000,Gonçalo Guedes;EE;29;PT;6000,Álex Marchal;EE;19;ES;3000,Takefusa Kubo;ED;25;JP;20000,Job Ochieng;ED;23;KE;4000,Mikel Oyarzabal;PL;29;ES;25000,Orri Óskarsson;PL;22;IS;20000",
    VIL: "Luiz Júnior;G;25;BR;12000,Péter Gulácsi;G;36;HU;1000,Rubén Gómez;G;24;ES;400,Renato Veiga;DC;23;PT;30000,Logan Costa;DC;25;CV;15000,Pau Navarro;DC;21;ES;15000,Juan Foyth;DC;28;AR;8000,Carlos Romero;LE;25;ES;25000,Sergi Cardona;LE;27;ES;9000,Santiago Mouriño;LD;24;UY;20000,Alex Freeman;LD;22;US;15000,Pape Gueye;MC;27;SN;40000,Carlos Macià;MC;18;ES;15000,Nathan Saliba;MC;22;CA;15000,Santi Comesaña;MC;30;ES;8000,Alassane Diatta;MC;21;SN;5000,Alberto Moleiro;EE;23;ES;50000,Nízar El Jmili;EE;21;ES;150,Ilias Akhomach;ED;22;MA;12000,Tajon Buchanan;ED;27;CA;12000,Nicolas Pépé;ED;31;CI;6000,Georges Mikautadze;PL;26;GE;40000,Tani Oluwaseyi;PL;26;CA;7000,Ayoze Pérez;PL;33;ES;5000,Gerard Moreno;PL;34;ES;2500",
    BET: "Álvaro Valles;G;29;ES;10000,Diego Conde;G;28;ES;3000,Natan;DC;25;BR;30000,Valentín Gómez;DC;23;AR;12000,Diego Llorente;DC;33;ES;2500,Marc Bartra;DC;35;ES;900,Fran García;LE;27;ES;7500,Junior Firpo;LE;30;DO;3500,Ángel Ortiz;LD;22;ES;6000,Héctor Bellerín;LD;31;ES;2400,Facundo Bernal;MD;23;UY;10000,Marc Roca;MD;29;ES;4000,Nelson Deossa;MC;26;CO;9000,Pablo Fornals;MC;30;ES;8000,Dani Ceballos;MC;30;ES;6000,Álvaro Fidalgo;MC;29;MX;5000,Giovani Lo Celso;MO;30;AR;7000,Isco;MO;34;ES;3500,Iker Losada;MO;25;ES;1800,Abde Ezzalzouli;EE;24;MA;40000,Rodrigo Riquelme;EE;26;ES;4000,Antony;ED;26;BR;40000,Aitor Ruibal;ED;30;ES;4000,Troy Parrott;PL;24;IE;20000,Cucho Hernández;PL;27;CO;18000",
    SEV: "Odysseas Vlachodimos;G;32;GR;3000,Fran González;G;21;ES;3000,Kike Salas;DC;24;ES;14000,Andrés Castrín;DC;23;ES;8000,Arouna Sangante;DC;24;SN;8000,Marcão;DC;30;BR;2500,Fábio Cardoso;DC;32;PT;1500,Gabriel Suazo;LE;29;CL;7000,Julio Díaz;LE;21;ES;2000,José Ángel Carmona;LD;24;ES;10000,Juan Iglesias;LD;28;ES;6000,Lucien Agoumé;MD;24;FR;18000,Youssouf Fofana;MC;27;FR;15000,Giorgi Kochorashvili;MC;27;GE;4500,Nico Guillén;MC;18;ES;2000,Jon Guridi;MC;31;ES;1800,Manu Bueno;MC;22;ES;1500,Rubén Vargas;EE;28;CH;15000,Félix Correia;EE;25;PT;10000,Chidera Ejuke;EE;28;NG;4000,Alfon González;EE;27;ES;3000,Miguel Sierra;ED;22;ES;7000,Peque Fernández;SA;24;ES;3000,Lucas Stassin;PL;21;BE;15000,Robbie Ure;PL;22;SCO;7000,Isaac Romero;PL;26;ES;5000",
    VAL: "Kayne van Oevelen;G;23;NL;4000,Stole Dimitrievski;G;32;MK;2000,Cristian Rivero;G;28;ES;100,César Tárrega;DC;24;ES;9000,Justin de Haas;DC;26;NL;7000,José Copete;DC;27;ES;5000,Mouctar Diakhaby;DC;29;GN;1500,Iker Córdoba;DC;21;ES;1000,José Gayà;LE;31;ES;4000,Jesús Vázquez;LE;23;ES;4000,Arnau Martínez;LD;23;ES;10000,Pablo Maffeo;LD;29;AR;2500,Dimitri Foulquier;LD;33;GP;500,Pepelu;MD;28;ES;8000,Guido Rodríguez;MD;32;AR;3500,Aliou Dieng;MD;29;ML;3000,Javi Guerra;MC;23;ES;25000,Filip Ugrinic;MC;27;CH;6000,Aarón Mayol;MC;18;ES;5000,Harvey Elliott;MO;23;EN;18000,Ryunosuke Sato;EE;20;JP;4000,Arnaut Danjuma;EE;29;NL;3000,Sergi Canós;EE;29;ES;600,Diego López;ED;24;ES;9000,David Otorbi;ED;19;ES;3500,Luis Rioja;ED;33;ES;1800,Dani Raba;SA;31;ES;1000,Hugo Duro;PL;27;ES;11000,Umar Sadiq;PL;29;NG;3500",
    CEL: "Ionuț Radu;G;29;RO;10000,Altay Bayındır;G;28;TR;3800,Iván Villar;G;29;ES;900,Javi Rodríguez;DC;23;ES;18000,Yoel Lago;DC;22;ES;7500,Carl Starfelt;DC;31;SE;4500,Abdoulaye Faye;DC;22;SN;4500,Sebastián Cáceres;DC;27;UY;4500,Marcos Alonso;DC;35;ES;1200,Javi Galán;LE;31;ES;1800,Sergio Carreira;LD;26;ES;12000,Javi Rueda;LD;24;ES;6000,Álvaro Núñez;LD;26;ES;4000,Ilaix Moriba;MC;23;GN;15000,Miguel Román;MC;23;ES;15000,Aleix Febas;MC;30;ES;5000,Hugo Burcio;MC;20;ES;2000,Williot Swedberg;EE;22;SE;20000,Hugo Álvarez;EE;23;ES;8000,Couhaib Driouech;EE;24;MA;7500,Ferran Jutglà;ED;27;ES;10000,Jones El-Abdellaoui;ED;20;MA;8000,Hugo González;ED;23;ES;3000,Pablo Durán;PL;25;ES;4000,Borja Iglesias;PL;33;ES;2500,Iago Aspas;PL;39;ES;1600",
    GIR: "Paulo Gazzaniga;G;34;AR;1000,Vladyslav Krapyvtsov;G;21;UA;300,Sergi Puig;G;27;ES;50,Holmes Júnior;DC;17;ES;5000,Alejandro Francés;DC;24;ES;3000,Abdul Mumin;DC;28;GH;2000,Mauro Furtado;DC;18;PT;1000,David López;DC;37;ES;600,Álex Moreno;LE;33;ES;2000,Javier Boñar;LD;21;ES;2000,Mateu Morey;LD;26;ES;1200,Fran Beltrán;MC;27;ES;4000,Unai Hernández;MC;21;ES;1800,Donny van de Beek;MC;29;NL;1400,Izan González;MC;22;ES;1200,Iván Morante;MC;25;ES;900,Lass Kourouma;MC;22;GN;500,Bryan Gil;EE;25;ES;6000,Jastin Garcia;EE;22;PT;500,Yáser Asprilla;ED;22;CO;14000,Carles Pérez;ED;28;ES;1500,Portu;ED;34;ES;600,Vladyslav Vanat;PL;24;UA;12000,Abel Ruiz;PL;26;ES;2000,Oleksandr Pyshchur;PL;21;UA;900,Cristhian Stuani;PL;40;UY;300",
    OSA: "Sergio Herrera;G;33;ES;2800,Aitor Fernández;G;35;ES;400,Enzo Boyomo;DC;25;CM;15000,Jorge Herrando;DC;25;ES;3500,Rockson Yeboah;DC;22;GH;3000,Alejandro Catena;DC;32;ES;2600,Unai Santos;DC;21;ES;800,Abel Bretones;LE;26;ES;3500,Diego Rico;LE;33;ES;800,Valentin Rosier;LD;30;FR;3000,Iñigo Arguibide;LD;21;ES;2500,Lucas Torró;MD;32;ES;2500,Iker Muñoz;MD;24;ES;2000,Jon Moncayola;MC;28;ES;7000,Asier Osambela;MC;22;ES;2000,Mauro Echegoyen;MC;21;ES;200,Aimar Oroz;MO;24;ES;7500,Moi Gómez;MO;32;ES;1500,Raúl Moro;EE;23;ES;3500,Romain Del Castillo;ED;30;FR;5000,Jonathan Dubasin;ED;26;ES;4000,Rubén García;ED;33;ES;1600,Kike Barja;ED;29;ES;1500,Raúl García;PL;26;ES;3000,Ante Budimir;PL;35;HR;2800",
    GET: "David Soria;G;33;ES;2800,Jiri Letacek;G;27;CZ;2000,Zaid Romero;DC;26;AR;5000,Abdel Abqar;DC;27;MA;3500,Sebastián Boselli;DC;22;UY;1500,Dakonam Djené;DC;34;TG;1400,Saba Sazonov;DC;24;GE;800,Jean Ives Valou;DC;20;CI;600,Davinchi;LE;19;ES;2000,Johan Mojica;LE;34;CO;1500,Andrés García;LD;23;ES;7000,Daniel Carvajal;LD;34;ES;3500,Kiko Femenía;LD;35;ES;500,Mario Martín;MD;22;ES;10000,Orel Mangala;MD;28;BE;9000,Nemanja Gudelj;MD;34;YU;2000,Ramón Terrats;MC;26;ES;3000,Francho Serrano;MC;25;ES;3000,Alberto Risco;MO;21;ES;800,Juanmi;EE;33;ES;1000,Martín Satriano;PL;25;UY;10000,Christantus Uche;PL;23;NG;9000,Iván Azón;PL;23;ES;7500,Enes Ünal;PL;29;TR;7000,Borja Mayoral;PL;29;ES;4500",
    MLL: "Arnau Tenas;G;25;ES;4000,Lucas Bergström;G;24;FI;1000,Iván Cuéllar;G;42;ES;100,Martin Valjent;DC;30;SK;3000,Aboubaka Soumahoro;DC;21;FR;1200,David López;DC;23;ES;1000,John Donald;DC;26;ES;1000,Antonio Raíllo;DC;35;ES;800,Toni Lato;LE;28;ES;1000,Alberto Moreno;LE;34;ES;500,Miguel Calatayud;LD;20;ES;500,Guille Fernández;MC;18;ES;4000,Manu Morlanes;MC;27;ES;2400,Sergi Darder;MC;32;ES;2000,Antonio Sánchez;MC;29;ES;1500,Álex Sala;MC;25;ES;1500,Jan Salas;MC;21;ES;300,Pablo Torre;MO;23;ES;5000,Adrián Liso;EE;21;ES;3000,Josep Cerdà;EE;23;ES;2000,Zito Luvumbo;ED;24;AO;3000,Antoniu Roca;ED;24;ES;1800,Arnau Puigmal;ED;25;ES;1500,Daniel Luna;ED;23;CO;600,Justin Kalumba;ED;21;FR;600,Adam Buksa;PL;30;PL;3000,Adrián Fuentes;PL;30;ES;2000,Abdón Prats;PL;33;ES;600",
    RAY: "Augusto Batalla;G;30;AR;6000,Emil Audero;G;29;ID;2800,Dani Cárdenas;G;29;ES;1800,Mujaid Sadick;DC;26;ES;5000,Marash Kumbulla;DC;26;AL;3000,Luiz Felipe;DC;29;IT;2000,Jozhua Vertrouwd;DC;22;NL;2000,Florian Lejeune;DC;35;FR;1800,Pelayo Fernández;DC;23;ES;500,Adrià Pedrosa;LE;28;ES;2800,Andrei Rațiu;LD;28;RO;24000,Iván Balliu;LD;34;AL;1000,Pedro Díaz;MC;28;ES;3000,Unai López;MC;31;ES;2500,Óscar Valentín;MC;32;ES;2000,Pathé Ciss;MC;32;SN;1800,Gnangoro Bouare;MC;22;ES;1000,Isi Palazón;MO;31;ES;2800,Randy Nteka;MO;28;AO;1000,Rayane Belaid;MO;21;ES;600,Álvaro García;EE;34;ES;1500,Jorge de Frutos;ED;29;ES;12000,Giorgi Tsitaishvili;ED;25;GE;3000,Fran Pérez;ED;24;ES;2500,Sergio Camello;PL;25;ES;10000,Alemão;PL;28;BR;4000,Raúl de Tomás;PL;32;ES;400",
    ESP: "Marko Dmitrović;G;34;YU;700,Ángel Fortuño;G;25;ES;300,Vanja Drkusic;DC;27;SI;5000,Clemens Riedel;DC;23;DE;4000,Unai Núñez;DC;29;ES;3500,Leandro Cabrera;DC;35;UY;900,Quilindschy Hartman;LE;25;NL;12000,Roger Hinojo;LE;21;ES;3000,Omar El Hilali;LD;23;MA;15000,Andoni Gorosabel;LD;30;ES;3000,Urko González de Zárate;MD;25;ES;12000,Gabriel Moscardo;MD;21;BR;7000,Pol Lozano;MC;27;ES;6000,Edu Expósito;MC;30;ES;5000,Rafel Bauzà;MC;21;ES;1200,Javi Hernández;MO;22;ES;6000,Álex Calatrava;MO;26;ES;5000,Bryan Zaragoza;EE;25;ES;8000,Javi Puado;EE;28;ES;7500,Pere Milla;EE;34;ES;1000,Tyrhys Dolan;ED;24;EN;10000,Jofre Carreras;ED;25;ES;3000,Roberto Fernández;PL;24;ES;20000,Marcos Fernández;PL;23;ES;2000,Kike García;PL;36;ES;500",
    ALA: "Antonio Sivera;G;30;ES;6000,Adrián Rodríguez;G;25;AR;200,Ville Koski;DC;24;FI;4000,Nicolás Valentini;DC;25;AR;3000,Facundo Garcés;DC;27;MY;0,Youssef Enríquez;LE;21;MA;5000,Nahuel Tenaglia;LD;30;AR;3000,Jonny Otto;LD;32;ES;2200,Hugo Novoa;LD;23;ES;800,Antonio Blanco;MD;26;ES;10000,Carlos Protesoni;MD;28;UY;1000,Pablo Ibáñez;MC;28;ES;4000,Ander Guevara;MC;29;ES;2500,Carles Aleñá;MC;28;ES;2500,Selu Diallo;MC;23;GN;900,Mikel Rodriguez;MC;24;ES;700,Denis Suárez;MO;32;ES;1000,Abde Rebbach;EE;28;DZ;2500,Ángel Pérez;ED;24;ES;5000,Miguel Rodríguez;ED;23;ES;5000,Toni Martínez;PL;29;ES;7500,Lucas Boyé;PL;30;AR;5000,Aitor Mañas;PL;23;ES;600,Mariano Díaz;PL;33;DO;500",
    LPA: "José Antonio Caro;G;32;ES;300,Adri Suárez;G;21;ES;0,Giovanni Bonfanti;DC;23;IT;3800,Juanma Herzog;DC;22;ES;1500,Nicholas Opoku;DC;29;GH;1000,Álex Suárez;DC;33;ES;500,Andrés Rodríguez;DC;24;ES;250,Enrique Clemente;LE;27;ES;2000,Marvin Park;LD;26;ES;1200,Viti Rozada;LD;29;ES;1200,Valentín Pezzolesi;LD;19;ES;500,Edward Cedeño;MD;23;PA;300,Enzo Loiodice;MC;25;FR;1200,Sergio Ruiz;MC;31;ES;800,Aboubacar Bassinga;MC;21;BF;300,Iñaki González;MC;22;ES;200,Iván Jaime;MO;26;ES;4000,Kirian Rodríguez;MO;30;ES;900,Iván Medina;MO;22;ES;150,Mateo Acimovic;MO;19;SI;50,Jeremía Recoba;EE;23;UY;1000,Taisei Miyashiro;ED;26;JP;2500,Manu Fuster;ED;29;ES;2500,Ale García;ED;23;ES;1500,Rafa Cruz;ED;17;ES;500,Adam Arvelo;ED;21;ES;50,Jefté Betancor;PL;33;ES;500,Sandro Ramírez;PL;31;ES;500,Jesé;PL;33;ES;300,Elías Romero;PL;22;ES;150",
    LEG: "Luca Zidane;G;28;DZ;1000,Raúl Fernández;G;38;ES;100,Lalo Aguilar;DC;24;ES;900,Marvel;DC;23;ES;800,Javi Montero;DC;27;ES;800,Rubén Pulido;DC;26;ES;400,Ignasi Miquel;DC;34;ES;400,Enric Franquesa;LE;29;ES;600,Álvaro Tejero;LD;30;ES;1400,Rubén Peña;LD;35;ES;400,Amadou Diawara;MD;29;GN;700,Yassine Kechta;MC;24;MA;4000,Zico Buurmeester;MC;24;NL;1300,Miguel Atienza;MC;27;ES;1200,Andrés Campos;MC;24;ES;100,Dani Rodríguez;MO;38;ES;100,Ismaël Gharbi;EE;22;TN;5000,Patrick Soko;ED;29;CM;1200,Álex Sancris;ED;29;ES;1200,Naim García;ED;24;ES;1000,Álvaro Morata;PL;34;ES;3000,Unax del Cura;PL;21;ES;2000,Álex Millán;PL;27;ES;800,Sule El Haddadi;PL;20;ES;0",
    VLL: "Álvaro Aceves;G;23;ES;500,Dani Martín;G;21;ES;300,Lucas Lavagnino;G;22;AR;0,David Torres;DC;23;ES;2000,Miguel Rubio;DC;28;ES;1200,Ramón Martínez;DC;24;ES;1000,Pablo Tomeo;DC;26;ES;1000,Guille Bueno;LE;24;ES;800,Homam Al-Amin;LE;27;QA;500,Iván Garriel;LE;21;ES;200,Carlos Clerc;LE;34;ES;150,Iván Alejo;LD;31;ES;800,Trilli;LD;23;ES;200,Mathis Lachuer;MD;26;FR;800,Stanko Juric;MD;30;HR;800,Julien Ponceau;MC;25;FR;2000,Thiago Ojeda;MC;23;AR;600,Álex Balboa;MC;25;GQ;250,Ryotaro Ito;MO;28;JP;6000,Dani Pérez;MO;21;ES;300,Víctor Fernández;MO;19;ES;300,Luis Chacón;EE;26;ES;1000,Kaj de Rooij;EE;25;NL;1000,Tay Abed;ED;22;IL;800,Yeray Cabanzón;ED;23;ES;600,Adrián Arnu;PL;19;ES;2000,Juanmi Latasa;PL;25;ES;1200,Robin van Duiven;PL;20;NL;700,Víctor Barberá;PL;22;ES;500",
    INT: "Josep Martínez;G;28;ES;10000,Ivan Provedel;G;32;IT;3000,Raffaele Di Gennaro;G;33;IT;300,Alessandro Bastoni;DC;27;IT;65000,Yann Bisseck;DC;25;DE;50000,Manuel Akanji;DC;31;CH;17000,John Stones;DC;32;EN;12000,Benjamin Pavard;DC;30;FR;12000,Federico Dimarco;LE;29;IT;50000,Carlos Augusto;LE;27;BR;23000,Djed Spence;LD;26;EN;35000,Aleksandar Stanković;MD;21;YU;32000,Hakan Çalhanoğlu;MD;32;TR;16000,Nicolò Barella;MC;29;IT;50000,Petar Sučić;MC;23;HR;45000,Curtis Jones;MC;25;EN;35000,Andy Diouf;MC;23;FR;30000,Piotr Zieliński;MC;32;PL;10000,Henrikh Mkhitaryan;MC;37;AM;3000,Luis Henrique;MDi;24;BR;20000,Lautaro Martínez;PL;29;AR;85000,Marcus Thuram;PL;29;FR;50000,Pio Esposito;PL;21;IT;50000,Ange-Yoan Bonny;PL;23;CI;35000",
    JUV: "Kamil Grabara;G;27;PL;12000,Guglielmo Vicario;G;30;IT;12000,Neto;G;37;BR;900,Carlo Pinsoglio;G;36;IT;200,Bremer;DC;29;BR;35000,Pierre Kalulu;DC;26;FR;32000,Lloyd Kelly;DC;28;EN;23000,Jhon Lucumí;DC;28;CO;22000,Federico Gatti;DC;28;IT;10000,Daniele Rugani;DC;32;IT;2000,Andrea Cambiaso;LE;26;IT;15000,Juan Cabal;LE;25;CO;7000,Zeki Çelik;LD;29;TR;14000,Manuel Locatelli;MD;28;IT;25000,Khéphren Thuram;MC;25;FR;35000,Weston McKennie;MC;28;US;30000,Pape Matar Sarr;MC;24;SN;30000,Douglas Luiz;MC;28;BR;18000,Teun Koopmeiners;MC;28;NL;14000,Kenan Yıldız;EE;21;TR;75000,Kerim Alajbegovic;EE;19;BA;32000,Nico González;EE;28;AR;22000,Jérémie Boga;EE;29;CI;8000,Francisco Conceição;ED;23;PT;30000,Edon Zhegrova;ED;27;XK;10000,Nick Woltemade;PL;24;DE;50000,Randal Kolo Muani;PL;27;FR;30000,Jeff Ekhator;PL;20;IT;18000,Arkadiusz Milik;PL;32;PL;1500",
    MIL: "Mike Maignan;G;31;FR;20000,Lorenzo Torriani;G;21;IT;2000,Pietro Terracciano;G;36;IT;900,Strahinja Pavlović;DC;25;YU;40000,Mario Gila;DC;26;ES;30000,Koni De Winter;DC;24;BE;25000,Matteo Gabbia;DC;27;IT;17000,Fikayo Tomori;DC;28;EN;10000,Filippo Terracciano;DC;23;IT;4500,Sankhoun Diawara;DC;20;FR;2000,Valeri Vladimirov;DC;18;BG;800,Davide Bartesaghi;LE;20;IT;22000,Pervis Estupiñán;LE;28;EC;12000,Ardon Jashari;MD;24;CH;22000,Adrien Rabiot;MC;31;FR;18000,Yunus Musah;MC;23;US;18000,Christian Comotto;MC;18;IT;10000,Ruben Loftus-Cheek;MC;30;EN;8500,Warren Bondo;MC;23;FR;4000,Luka Modrić;MC;41;HR;3500,Alexis Saelemaekers;MDi;27;BE;18000,Diego Moreira;ME;22;BE;45000,Alphadjo Cisse;MO;20;IT;20000,Christian Pulisic;ED;28;US;35000,Omari Hutchinson;ED;23;EN;30000,Samuel Chukwueze;ED;27;NG;20000,Gonçalo Ramos;PL;25;PT;50000,Francesco Camarda;PL;18;IT;15000",
    NAP: "Vanja Milinković-Savić;G;29;YU;15000,Alex Meret;G;29;IT;8000,Nikita Contini;G;30;IT;400,Claudio Pugliese;G;18;IT;100,Alessandro Buongiorno;DC;27;IT;25000,Sam Beukema;DC;27;NL;18000,Rafa Marín;DC;24;ES;16000,Benoît Badiashile;DC;25;FR;15000,Amir Rrahmani;DC;32;XK;10000,Luca Marianucci;DC;22;IT;7000,Mathías Olivera;LE;29;UY;15000,Leonardo Spinazzola;LE;33;IT;3500,Costantino Favasuli;LD;22;IT;8000,Giovanni Di Lorenzo;LD;33;IT;7500,Billy Gilmour;MD;25;SCO;20000,Stanislav Lobotka;MD;31;SK;10000,Scott McTominay;MC;29;SCO;40000,Frank Anguissa;MC;30;CM;15000,Antonio Vergara;MO;23;IT;20000,Kevin De Bruyne;MO;35;BE;8000,Alisson Santos;EE;24;BR;28000,Noa Lang;EE;27;NL;20000,David Neres;ED;29;BR;18000,Matteo Politano;ED;33;IT;5000,Rasmus Højlund;PL;23;DK;60000,Lorenzo Lucca;PL;26;IT;20000,Giovane;PL;22;BR;12000",
    ATA: "Marco Carnesecchi;G;26;IT;30000,Marco Sportiello;G;34;IT;800,Thomas Pompei;G;20;IT;250,Giorgio Scalvini;DC;22;IT;38000,Isak Hien;DC;27;SE;22000,Thomas Kristensen;DC;24;DK;18000,Odilon Kossounou;DC;25;CI;15000,Sead Kolasinac;DC;33;BA;4000,Relja Obrić;DC;20;SI;1500,Lorenzo Bernasconi;LE;22;IT;20000,Raoul Bellanova;LD;26;IT;15000,Davide Zappacosta;LD;34;IT;3500,Gianluca Gaetano;MD;26;IT;12000,Éderson;MC;27;BR;40000,Franck Kessié;MC;29;CI;12000,Mario Pašalić;MC;31;HR;6000,Nicola Zalewski;ME;24;PL;20000,Charles De Ketelaere;MO;25;BE;35000,Lazar Samardžić;MO;24;YU;16000,Eljif Elmas;MO;27;MK;13000,Jonathan Rowe;EE;23;EN;33000,Kamaldeen Sulemana;EE;24;GH;17000,Giacomo Raspadori;SA;26;IT;22000,Nikola Krstović;PL;26;ME;30000,Gianluca Scamacca;PL;27;IT;25000",
    ROM: "Mile Svilar;G;27;YU;35000,Devis Vásquez;G;28;CO;800,Pierluigi Gollini;G;31;IT;800,Giorgio De Marzi;G;19;US;100,Evan Ndicka;DC;27;CI;35000,Konstantinos Koulierakis;DC;22;GR;20000,Leonardo Balerdi;DC;27;AR;18000,Daniele Ghilardi;DC;23;IT;18000,Gianluca Mancini;DC;30;IT;15000,Mario Hermoso;DC;31;ES;7000,Wesley;LD;23;BR;40000,Nahuel Molina;LD;28;AR;15000,Devyne Rensch;LD;23;NL;8500,Emanuele Lulli;LD;19;IT;8000,Bryan Cristante;MD;31;IT;7000,Marten de Roon;MD;35;NL;3200,Manu Koné;MC;25;FR;60000,Niccolò Pisilli;MC;22;IT;30000,Rodrigo Mora;MO;19;PT;38000,Lorenzo Pellegrini;MO;30;IT;8000,Matías Soulé;ED;23;AR;35000,Paulo Dybala;SA;32;AR;5000,Donyell Malen;PL;27;NL;55000,Santiago Castro;PL;22;AR;32000,Antonio Arena;PL;17;IT;4000",
    LAZ: "Christos Mandas;G;25;GR;10000,Edoardo Motta;G;21;IT;8000,Alessio Furlanetto;G;24;IT;350,Davide Renzetti;G;20;IT;150,Oliver Provstgaard;DC;23;DK;20000,Danilho Doekhi;DC;28;NL;13000,Diogo Leite;DC;27;PT;12000,Josip Sutalo;DC;26;HR;12000,Filipe Bordon;DC;21;BR;750,Ricardo Bordon;DC;20;BR;200,Nuno Tavares;LE;26;PT;12000,Luca Pellegrini;LE;27;IT;3000,Alfonso Pedraza;LE;30;ES;2500,Mohamed Fares;LE;30;DZ;500,Romano Floriani Mussolini;LD;23;IT;5000,Adam Marusic;LD;34;ME;2500,Manuel Lazzari;LD;32;IT;2000,Nicolò Rovella;MD;24;IT;23000,Reda Belahyane;MD;22;MA;7500,Danilo Cataldi;MD;32;IT;3500,Bruno Galassi;MD;19;AR;100,Kenneth Taylor;MC;24;NL;25000,Davide Frattesi;MC;27;IT;22000,Fisayo Dele-Bashiru;MC;25;NG;6000,Valerio Farcomeni;MC;20;IT;100,Adrian Przyborek;MO;19;PL;6000,Tijjani Noslin;EE;27;NL;8000,Mattia Zaccagni;EE;31;IT;7500,Gustav Isaksen;ED;25;DK;15000,Matteo Cancellieri;ED;24;IT;7000,Albert Gudmundsson;SA;29;IS;12000,Andrea Pinamonti;PL;27;IT;15000,Federico Serra;PL;20;IT;400",
    FIO: "David de Gea;G;36;ES;3500,Oliver Christensen;G;27;DK;1400,Luca Lezzerini;G;31;IT;350,Radu Drăgușin;DC;24;RO;16000,Víctor Valdepeñas;DC;20;ES;12000,Viery;DC;21;BR;12000,Marin Pongracic;DC;29;HR;6500,Luca Ranieri;DC;27;IT;6000,Fabiano Parisi;LE;26;IT;6000,Álex Jiménez;LD;21;ES;22000,Dodô;LD;27;BR;16000,João Mário;LD;26;PT;8000,Christ Inao Oulaï;MC;20;CI;28000,Arthur Atta;MC;23;FR;25000,Cher Ndour;MC;22;IT;20000,Nicolò Fagioli;MC;25;IT;16000,Marco Brescianini;MC;26;IT;9000,Pedro Gonçalves;EE;28;PT;25000,Alieu Njie;EE;21;SE;15000,Riccardo Sottil;EE;27;IT;1500,Franco Mastantuono;ED;19;AR;45000,Wilfried Gnonto;ED;23;IT;16000,Federico Croci;SA;16;IT;3000,Mateo Pellegrino;PL;25;AR;22000,Beto;PL;28;GW;18000",
    BOL: "Massimo Pessina;G;18;IT;4500,Lukasz Skorupski;G;35;PL;2000,Ukko Happonen;G;19;FI;50,Arthur Theate;DC;26;BE;15000,Torbjørn Heggem;DC;27;NO;15000,Martin Vitík;DC;23;CZ;13000,Eivind Helland;DC;21;NO;8000,Nicolò Casale;DC;28;IT;3800,Juan Miranda;LE;26;ES;15000,Rahim Alhassane;LE;24;NE;3500,Emil Holm;LD;26;SE;10000,Nadir Zortea;LD;27;IT;7000,Matteo Darmian;LD;36;IT;1400,Lorenzo De Silvestri;LD;38;IT;600,Nikola Moro;MD;28;HR;7000,Oussama El Azzouzi;MD;25;MA;1800,Lewis Ferguson;MC;27;SCO;14000,Mikel Amondarain;MC;21;AR;8500,Tommaso Pobega;MC;27;IT;8000,Marco Libra;MC;18;VE;1500,Jens Odgaard;MO;27;DK;12000,Nicolò Cambiaghi;EE;25;IT;14000,Samuel Mbangula;EE;22;BE;8000,Riccardo Orsolini;ED;29;IT;15000,Federico Bernardeschi;ED;32;IT;3500,Roberto Piccoli;PL;25;IT;16000,Artem Dovbyk;PL;29;UA;15000,Jay Enem;PL;23;NL;6000",
    TRN: "Lucas Perri;G;28;BR;10000,Franco Israel;G;26;UY;2500,Diego Mascardi;G;20;IT;1300,Lapo Siviero;G;19;IT;500,Pietro Comuzzo;DC;21;IT;18000,Saúl Coco;DC;27;GQ;7500,Ardian Ismajli;DC;30;AL;5000,Eray Cömert;DC;28;CH;2500,Niccolò Fortini;LE;20;IT;10000,Ricardo Rodríguez;LE;34;CH;1400,Cristiano Biraghi;LE;34;IT;900,Rafik Belghali;LD;24;DZ;8000,Nathan Patterson;LD;25;SCO;5000,Rolando Mandragora;MD;29;IT;7500,Emirhan İlkhan;MD;22;TR;6000,Cesare Casadei;MC;23;IT;15000,Gvidas Gineitis;MC;22;LT;8000,Daniel Bragança;MC;27;PT;7000,Kian Fitz-Jim;MC;23;NL;3500,Andrea Luongo;MC;18;IT;1000,Alessio Cacciamani;ME;19;IT;12000,Nikola Vlašić;MO;29;HR;10000,Gaetano Oristanio;MO;24;IT;5000,Zakaria Aboukhlal;ED;26;MA;5000,Giovanni Simeone;PL;31;AR;7000,Ché Adams;PL;30;SCO;5000,Sandro Kulenović;PL;26;HR;3500,Duván Zapata;PL;35;CO;2500,Pietro Pellegri;PL;25;IT;500",
    UDI: "Maduka Okoye;G;27;NG;10000,Bartosz Mrozek;G;26;PL;2000,Daniele Padelli;G;41;IT;150,Oumar Solet;DC;26;CI;20000,James Abankwah;DC;22;IE;8000,Matteo Palma;DC;18;IT;8000,Nicolò Bertola;DC;23;IT;7000,David Alaba;DC;34;AT;3000,Enzo Ebosse;DC;27;CM;2800,Christian Kabasele;DC;35;BE;750,Hassane Kamara;LE;32;CI;3000,Alessandro Zanoli;LD;26;IT;4500,Mërgim Vojvoda;LD;31;XK;2500,Jesper Karlström;MD;31;SE;4000,Jurgen Ekkelenkamp;MC;26;NL;13000,Lennon Miller;MC;20;SCO;10000,Jakub Piotrowski;MC;29;PL;4500,Sandi Lovrić;MC;28;SI;3500,Oier Zarraga;MC;27;ES;1500,Juan Arizala;ME;21;CO;3500,Unai Gómez;MO;23;ES;5000,Giorgi Chakvetadze;MO;27;GE;3500,Lazar Jovanovic;ED;19;YU;6000,Nicolò Zaniolo;SA;27;IT;15000,Keinan Davis;PL;28;EN;10000,Idrissa Gueye;PL;20;SN;8000,Vakoun Bayo;PL;29;CI;2500,Giulio Vinciati;PL;19;IT;100",
    GEN: "Justin Bijlow;G;28;NL;4000,Franz Stolz;G;25;AT;600,Daniele Sommariva;G;29;IT;100,Rendijs Mihelsons;G;18;LV;100,Johan Vásquez;DC;28;MX;14000,Alessandro Marcandalli;DC;24;IT;14000,Leo Østigård;DC;26;NO;13000,Sebastian Otoa;DC;22;DK;2500,Mamedi Doucouré;DC;19;FR;400,Lukas Klišys;DC;19;LT;100,Mario Mitaj;LE;23;AL;6000,David Puczka;LE;21;AT;3500,Marcelo Vaz;LE;19;GW;400,Cody Drameh;LD;24;EN;4500,Kingsley Ehizibue;LD;31;NL;1500,Stefano Sabelli;LD;33;IT;1300,Morten Frendrup;MD;25;DK;15000,Hamed Traoré;MC;26;CI;10000,Amorim;MC;21;BR;8000,Djibril Sow;MC;29;CH;7500,Mikael Egill Ellertsson;MC;24;IS;6000,Franz-Ethan Meichtry;MC;21;CH;5000,Samuel Wiafe;MC;18;IT;2500,Tommaso Baldanzi;MO;23;IT;8500,Stephan El Shaarawy;EE;34;IT;2000,Robinho Junior;ED;18;BR;5000,Lorenzo Venturino;ED;20;IT;5000,Junior Messias;ED;35;BR;1100,Lorenzo Colombo;PL;24;IT;10000,Vitinha;PL;26;PT;8000,Milutin Osmajic;PL;27;ME;3000,Elias Havel;PL;23;AT;2200,Joi Nuredini;PL;19;AL;1000",
    COM: "Robert Sánchez;G;28;ES;15000,Jean Butez;G;31;FR;8000,Mauro Vigorito;G;36;IT;150,Jacobo Ramón;DC;21;ES;45000,Trevoh Chalobah;DC;27;EN;35000,Alberto Dossena;DC;28;IT;5000,Marc Oliver Kempf;DC;31;DE;3500,Willy Kambwala;DC;22;CD;3000,Edoardo Goldaniga;DC;33;IT;2000,Kaiki;LE;23;BR;14000,Álex Valle;LE;22;ES;12000,Yan Couto;LD;24;BR;17000,Ivan Smolcic;LD;26;HR;3500,Máximo Perrone;MD;23;AR;35000,Samuele Ricci;MD;25;IT;22000,Lucas Da Cunha;MC;25;FR;30000,Maxence Caqueret;MC;26;FR;13000,Adrian Lahdo;MC;18;SE;10000,Luis Milla;MC;32;ES;8000,Nico Paz;MO;22;AR;80000,Martin Baturina;MO;23;HR;55000,Mattia Liberali;MO;19;IT;10000,Assane Diao;EE;21;SN;35000,Jesús Rodríguez;EE;20;ES;30000,Jayden Addai;ED;21;NL;20000,Moise Kean;PL;26;IT;32000,Anastasios Douvikas;PL;27;GR;25000",
    CAG: "Elia Caprile;G;25;IT;12000,Alen Sherri;G;28;AL;800,Boris Radunović;G;30;YU;500,Juan Rodríguez;DC;21;UY;14000,Raphael Kofler;DC;21;IT;5500,Zé Pedro;DC;29;PT;3000,Yerry Mina;DC;32;CO;2500,Adam Obert;LE;24;SK;9000,Riyad Idrissi;LE;21;IT;4000,Giuseppe Aurelio;LE;26;IT;800,Nicola Grandu;LE;20;IT;300,Yukinari Sugawara;LD;26;JP;5500,Alessandro Romano;MD;20;IT;15000,Harry Winks;MD;30;EN;2500,Michel Adopo;MC;26;FR;8500,Jacopo Fazzini;MC;23;IT;8500,Joseph Liteta;MC;20;ZM;3500,Alessandro Deiola;MC;31;IT;1500,Roberto Gagliardini;MC;32;IT;1300,Demi Akarakiri;MC;19;EN;450,Ivan Sulev;MC;20;BG;200,Daniel Maldini;MO;25;IT;9000,Yanis Massolin;MO;24;FR;4500,Alieu Fadera;EE;25;GM;4500,Mattia Felici;EE;25;IT;2500,Riccardo Ciervo;EE;24;IT;2000,Paul Mendy;PL;19;SN;12000,Kevin Carlos;PL;25;ES;3500,M'Bala Nzola;PL;30;AO;2500,Yael Trepy;PL;20;FR;2000",
    PAR: "Giovanni Daffara;G;21;IT;3500,Edoardo Corvi;G;25;IT;3000,Simone Ghidotti;G;26;IT;400,Mariano Troilo;DC;23;AR;10000,Abdoulaye Ndiaye;DC;24;SN;6000,Diego Carlos;DC;33;BR;3000,Lautaro Valenti;DC;27;AR;2000,Dominik Drobnic;DC;19;SI;1800,Emanuele Valeri;LE;27;IT;3000,Franco Carboni;LE;23;AR;1500,Sascha Britschgi;LD;20;CH;10000,Enrico Delprato;LD;27;IT;6000,Mandela Keita;MD;24;BE;20000,Hans Nicolussi Caviglia;MD;26;IT;6000,Adrián Bernabé;MC;25;ES;15000,Christian Ordóñez;MC;22;AR;6500,Benja Cremaschi;MC;21;US;4000,Vincent Sierro;MC;31;CH;2500,Abdou-Salam Konate;MC;19;SN;1500,Giovanni Fabbian;MO;23;IT;10000,Ousmane Diallo;EE;19;ES;1500,Pontus Almqvist;ED;27;SE;1800,Simone Lontani;SA;18;IT;6000,El Bilal Touré;PL;25;ML;13000,David Romero;PL;23;AR;7000,Matija Frigan;PL;23;HR;7000,Nesta Elphege;PL;25;FR;4000,Thomás De Martis;PL;18;AR;125",
    LEC: "Wladimiro Falcone;G;31;IT;3500,Marco Bleve;G;31;IT;300,Alexandru Borbei;G;23;RO;150,Plamen Penev;G;18;BG;150,Tiago Gabriel;DC;21;PT;15000,Jamil Siebert;DC;24;DE;4500,Gaspar;DC;29;AO;3000,Gaby Jean;DC;26;FR;1500,Sebastian Esposito;DC;21;AU;600,Elijah Scott;DC;20;US;400,Antonino Gallo;LE;26;IT;3500,Corrie Ndaba;LE;26;IE;900,Vernon Addo;LE;21;NL;175,Danilo Veiga;LD;24;PT;2500,Ali Dembélé;LD;22;FR;1300,Marlon Ubani;LD;21;DE;175,Oumar Ngom;MD;22;MR;3000,Sadik Fofana;MD;23;TG;800,Olaf Gorter;MD;21;NL;800,Niko Kovač;MD;21;BA;300,Ivan Ilić;MC;25;YU;7000,Medon Berisha;MC;23;AL;5000,Mohamed Kaba;MC;25;GN;2500,Lassana Coulibaly;MC;30;ML;2200,Youssef Maleh;MC;28;MA;1500,Omri Gandelman;MO;26;IL;3000,Joël Monteiro;EE;27;CH;3500,Amar Fatah;EE;22;SE;800,Santiago Pierotti;ED;25;AR;4000,Konan N’Dri;ED;26;NE;1500,Willem Geubbels;PL;25;FR;5000,Nikola Stulic;PL;25;YU;3500,Paco Esteban;PL;20;ES;500",
    EMP: "Jacopo Seghetti;G;21;IT;1200,Samuele Perisan;G;29;IT;400,Emiliano Filippis;G;22;IT;200,Marco Curto;DC;27;IT;600,Gabriele Indragoli;DC;22;IT;300,Cristian Căuz;DC;30;IT;300,Simone Romagnoli;DC;36;IT;200,Duccio Degli Innocenti;MD;23;IT;1200,Gerard Yepes;MD;24;ES;750,Lapo Deli;MD;20;IT;250,Edoardo Biondini;MC;17;IT;8000,Luca Magnino;MC;29;IT;400,Filippo Bandinelli;MC;31;IT;400,Luca Belardinelli;MC;25;IT;400,Matteo Egan;MDi;18;IE;1500,Joseph Ceesay;MDi;28;GM;600,Niccolò Corrado;ME;26;IT;800,Karim Zedadka;ME;26;DZ;400,Edoardo Saporiti;MO;25;IT;700,Filippo Distefano;SA;23;IT;800,Stiven Shpendi;PL;23;AL;3000,Bogdan Popov;PL;19;UA;2500,Salvatore Monaco;PL;19;IT;300",
    VER: "Nicola Leali;G;33;IT;1000,Simone Perilli;G;31;IT;400,Giacomo Toniolo;G;22;IT;75,Andrias Edmundsson;DC;25;FO;3000,Tobias Slotsager;DC;20;DK;3000,Nicolò Calabrese;DC;21;IT;2000,Seid Korac;DC;25;LU;1300,Paweł Dawidowicz;DC;31;PL;500,Noé Maël Tagne;DC;18;FR;500,Martin Frese;LE;28;DK;2000,Domagoj Bradarić;LE;26;HR;1500,Davide De Battisti;LE;20;IT;400,Gabriele Zappa;LD;26;IT;2200,Fallou Cham;LD;20;GM;1000,Andréa Le Borgne;MD;20;FR;4000,Leorat Bega;MD;23;CH;300,Antoine Bernede;MC;27;FR;3500,Suat Serdar;MC;29;DE;2000,Abdou Harroui;MC;28;MA;1600,Grigoris Kastanos;MC;28;CY;1300,Edoardo Iannoni;MC;25;IT;800,Nunzio Lella;MC;26;IT;600,Tomas Suslov;MO;24;SK;4000,Salvatore Cerbone;EE;19;IT;1700,Kacper Sezonienko;EE;23;PL;1000,Mattia Compagnon;ED;25;IT;1000,Amin Sarr;PL;25;SE;2400,Samuele Mulattieri;PL;26;IT;2000,Daniel Mosquera;PL;27;CO;1800,Caleb Ekuban;PL;32;GH;1200,Dailon Livramento;PL;25;CV;800,Ruben Akalé;PL;19;FR;300",
    SAS: "Arijanet Murić;G;28;XK;7500,Stefano Turati;G;25;IT;3000,Giacomo Satalino;G;27;IT;400,Jay Idzes;DC;26;ID;14000,Fedde Leysen;DC;23;BE;7000,Fali Candé;DC;28;GW;3000,Duje Caleta-Car;DC;30;HR;2800,Cas Odenthal;DC;26;NL;1200,Rafa Obrador;LE;22;ES;5000,Josh Doig;LE;24;SCO;4500,Edoardo Pieragnolo;LE;23;IT;2000,Sebastian Walukiewicz;LD;26;PL;5000,Ignace Van der Brempt;LD;24;BE;5000,Simone Cinquegrano;LD;22;IT;2500,Yeferson Paz;LD;24;CO;400,Luca Lipani;MD;21;IT;7500,Ibrahim Sulemana;MD;23;GH;6000,Daniel Boloca;MD;27;IT;4000,Nemanja Matić;MD;38;YU;1600,Andrea Ghion;MD;26;IT;800,Ismaël Koné;MC;24;CA;25000,Darryl Bakola;MC;18;FR;15000,Kristian Thorstvedt;MC;27;NO;10000,Vasilije Adžić;MO;20;ME;15000,Armand Laurienté;EE;27;FR;19000,Benja Domínguez;EE;23;AR;9000,Cristian Volpato;ED;22;AU;10000,Domenico Berardi;ED;32;IT;7000,Nicholas Pierini;ED;28;IT;1600,Sebastiano Esposito;PL;24;IT;15000,Kieron Bowie;PL;24;SCO;8000,Laurs Skjellerup;PL;24;DK;1300",
    SAM: "Peter Vindahl;G;28;DK;750,Andrey Krastev;G;18;BG;200,Samuele Massolo;G;30;IT;150,Mattia Viti;DC;24;IT;2500,Stefan Gartenmann;DC;29;CH;1500,Filippo Delli Carri;DC;27;IT;1500,Luca Ravanelli;DC;29;IT;1000,Karim Diop;DC;17;IT;400,Alex Ferrari;DC;32;IT;250,Bjorn Meijer;LE;23;NL;2000,Manuel Cicconi;LE;29;IT;750,Kevin Mbabu;LD;31;CH;1500,Alessandro Di Pardo;LD;27;IT;1000,Fabio Depaoli;LD;29;IT;750,Antoine Makoumbou;MD;28;CG;2500,Salvatore Esposito;MD;26;IT;2500,Oliver Abildgaard;MD;30;DK;500,Francesco Conti;MC;22;IT;2000,Liam Henderson;MC;30;SCO;1000,Yari Verschaeren;MO;25;BE;3000,Danel Sinani;MO;29;LU;2500,Nikola Sekulov;MO;24;IT;400,Tjas Begic;EE;23;SI;1500,Lorenzo Insigne;EE;35;IT;1400,Yann Karamoh;EE;28;FR;1000,Tobias Lauritsen;PL;29;NO;2800,Gennaro Tutino;PL;30;IT;750",
    MCI: "Gianluigi Donnarumma;G;27;IT;45000,Gerónimo Rulli;G;34;AR;5000,Marcus Bettinelli;G;34;EN;300,Marc Guéhi;DC;26;EN;75000,Rúben Dias;DC;29;PT;50000,Abdukodir Khusanov;DC;22;UZ;50000,Vitor Reis;DC;20;BR;30000,Josko Gvardiol;LE;24;HR;75000,Nico O'Reilly;LE;21;EN;70000,Rayan Aït-Nouri;LE;25;DZ;35000,Matheus Nunes;LD;28;PT;45000,Rico Lewis;LD;21;EN;25000,Elliot Anderson;MD;24;EN;120000,Ayyoub Bouaddi;MD;19;MA;90000,Enzo Fernández;MC;25;AR;120000,Mateo Kovacic;MC;32;HR;10000,Rayan Cherki;MO;23;FR;110000,Phil Foden;MO;26;EN;65000,Jérémy Doku;EE;24;BE;75000,Iliman Ndiaye;EE;26;SN;65000,Antoine Semenyo;ED;26;GH;80000,Allan;ED;22;BR;30000,Ryan McAidoo;ED;18;EN;8000,Erling Haaland;PL;26;NO;220000",
    LIV: "Giorgi Mamardashvili;G;26;GE;28000,Alisson;G;34;BR;15000,Vítězslav Jaroš;G;25;CZ;5000,Freddie Woodman;G;29;EN;3000,Harvey Davies;G;23;EN;500,Jérémy Jacquet;DC;21;FR;65000,Giovanni Leoni;DC;19;IT;25000,Ronald Araújo;DC;27;UY;25000,Virgil van Dijk;DC;35;NL;15000,Joe Gomez;DC;29;EN;11000,Milos Kerkez;LE;23;HU;35000,Konstantinos Tsimikas;LE;30;GR;4500,Luke Chambers;LE;22;EN;1000,Jeremie Frimpong;LD;25;NL;30000,Conor Bradley;LD;23;NIR;20000,Ryan Gravenberch;MD;24;NL;75000,Wataru Endo;MD;33;JP;3000,Alexis Mac Allister;MC;27;AR;70000,Trey Nyoni;MC;19;EN;18000,James McConnell;MC;22;EN;1500,Dominik Szoboszlai;MO;26;HU;100000,Florian Wirtz;MO;23;DE;85000,Bradley Barcola;EE;24;FR;100000,Cody Gakpo;EE;27;NL;75000,Rio Ngumoha;EE;18;EN;50000,Víctor Muñoz;EE;23;ES;40000,Federico Chiesa;ED;29;IT;10000,Alexander Isak;PL;27;SE;90000,Hugo Ekitiké;PL;24;FR;80000,Lewis Koumas;PL;21;WAL;8000,Jayden Danns;PL;20;EN;800",
    ARS: "David Raya;G;31;ES;30000,Illan Meslier;G;26;FR;6000,Kepa Arrizabalaga;G;32;ES;5000,William Saliba;DC;25;FR;100000,Gabriel;DC;28;BR;75000,Piero Hincapié;DC;24;EC;50000,Ezri Konsa;DC;29;EN;50000,Cristhian Mosquera;DC;22;ES;40000,Riccardo Calafiori;LE;24;IT;65000,Jurriën Timber;LD;25;NL;70000,Ben White;LD;29;EN;35000,Martín Zubimendi;MD;27;ES;65000,Myles Lewis-Skelly;MD;20;EN;65000,Declan Rice;MC;27;EN;120000,Bruno Guimarães;MC;28;BR;75000,Mikel Merino;MC;30;ES;25000,Martin Ødegaard;MO;27;NO;80000,Eberechi Eze;MO;28;EN;60000,Christos Tzolis;EE;24;GR;40000,Bukayo Saka;ED;25;EN;110000,Max Dowman;ED;16;EN;50000,Noni Madueke;ED;24;EN;45000,Kai Havertz;PL;27;DE;60000,Viktor Gyökeres;PL;28;SE;55000",
    CHE: "Mike Penders;G;21;BE;25000,Emiliano Martínez;G;34;AR;10000,Gabriel Slonina;G;22;US;3000,Teddy Sharman-Lowe;G;23;EN;500,Maxence Lacroix;DC;26;FR;60000,Levi Colwill;DC;23;EN;50000,Wesley Fofana;DC;25;FR;32000,Josh Acheampong;DC;20;EN;30000,Aarón Anselmino;DC;21;AR;10000,Jorrel Hato;LE;20;NL;45000,Pep Chavarría;LE;28;ES;18000,Reece James;LD;26;EN;60000,Marco Palestra;LD;21;IT;45000,Malo Gusto;LD;23;FR;35000,Moisés Caicedo;MD;25;EC;100000,Roméo Lavia;MD;22;BE;25000,Valentín Barco;MC;22;AR;40000,Mahdi Nicoll-Jazuli;MC;16;EN;2000,Jordan Henderson;MC;36;EN;1200,Cole Palmer;MO;24;EN;110000,Morgan Rogers;EE;24;EN;120000,Jamie Gittens;EE;22;EN;25000,Estêvão;ED;19;BR;80000,Pedro Neto;ED;26;PT;60000,Geovany Quenda;ED;19;PT;42000,João Pedro;PL;25;BR;100000,Emmanuel Emegha;PL;23;NL;20000,Danny Welbeck;PL;35;EN;3000",
    MUN: "Senne Lammens;G;24;BE;35000,Karl Darlow;G;36;WAL;200,Tom Heaton;G;40;EN;100,Dermot Mee;G;23;NIR;0,Lisandro Martínez;DC;28;AR;45000,Leny Yoro;DC;21;FR;45000,Ayden Heaven;DC;20;EN;30000,Matthijs de Ligt;DC;27;NL;25000,Harry Maguire;DC;33;EN;8000,Luke Shaw;LE;31;EN;8000,Harry Amass;LE;19;EN;5000,Diogo Dalot;LD;27;PT;30000,Noussair Mazraoui;LD;29;MA;18000,Carlos Baleba;MD;22;CM;65000,Andrey Santos;MD;22;BR;45000,Manuel Ugarte;MD;25;UY;20000,Kobbie Mainoo;MC;21;EN;75000,Youri Tielemans;MC;29;BE;40000,Tyler Fletcher;MC;19;SCO;2500,Bruno Fernandes;MO;32;PT;35000,Mason Mount;MO;27;EN;25000,Marcus Rashford;EE;29;EN;35000,Patrick Dorgu;EE;22;DK;35000,Bryan Mbeumo;ED;27;CM;75000,Amad Diallo;ED;24;CI;45000,Shea Lacey;ED;19;EN;12000,Matheus Cunha;PL;27;BR;75000,Benjamin Šeško;PL;23;SI;75000,Joshua Zirkzee;PL;25;NL;20000",
    TOT: "Antonín Kinský;G;23;CZ;18000,Martin Dúbravka;G;37;SK;500,Brandon Austin;G;27;EN;500,Jan Paul van Hecke;DC;26;NL;60000,Micky van de Ven;DC;25;NL;50000,Marcos Senesi;DC;29;AR;20000,Tosin Adarabioyo;DC;29;EN;13000,Ben Davies;DC;33;WAL;3000,Destiny Udogie;LE;23;IT;25000,Andrew Robertson;LE;32;SCO;7000,Pedro Porro;LD;27;ES;45000,Archie Gray;LD;20;EN;35000,Sandro Tonali;MD;26;IT;90000,Rodrigo Bentancur;MD;29;UY;17000,Mateus Fernandes;MC;22;PT;70000,Lucas Bergvall;MC;20;SE;40000,Conor Gallagher;MC;26;EN;32000,Xavi Simons;MO;23;NL;40000,James Maddison;MO;29;EN;17000,Dejan Kulusevski;MO;26;SE;13000,Sávio;EE;22;BR;50000,Mathys Tel;EE;21;FR;22000,Wilson Odobert;EE;21;FR;18000,Mykhaylo Mudryk;EE;25;UA;15000,Mohammed Kudus;ED;26;GH;45000,Omar Marmoush;PL;27;EG;50000,Dominic Solanke;PL;29;EN;25000,Richarlison;PL;29;BR;15000",
    NEW: "Lukas Hornicek;G;24;CZ;27000,Ewen Jaouen;G;20;FR;18000,Nick Pope;G;34;EN;3000,Mark Gillespie;G;34;EN;100,Malick Thiaw;DC;25;DE;50000,Sven Botman;DC;26;NL;35000,Dan Burn;DC;34;EN;4000,Fabian Schär;DC;34;CH;3000,Lewis Hall;LE;22;EN;55000,Tino Livramento;LD;24;EN;45000,Amar Dedic;LD;24;BA;30000,Nico González;MD;24;ES;50000,Aladji Bamba;MD;20;FR;25000,Jacob Ramsey;MC;25;EN;35000,Lewis Miley;MC;20;EN;30000,Sean Steur;MC;18;NL;22000,Joelinton;MC;30;BR;20000,Joe Willock;MC;27;EN;18000,Bazoumana Touré;EE;20;CI;50000,Harvey Barnes;EE;28;EN;35000,Anthony Elanga;ED;24;SE;35000,Jacob Murphy;ED;31;EN;10000,Matias Fernandez-Pardo;PL;21;BE;55000,William Osula;PL;23;DK;32000,Yoane Wissa;PL;30;CD;25000",
    AVL: "Zion Suzuki;G;24;JP;30000,Marco Bizot;G;35;NL;1500,James Wright;G;21;EN;200,Taylor Harwood-Bellis;DC;24;EN;25000,Pau Torres;DC;29;ES;20000,Modou Kéba Cissé;DC;21;SN;6000,Victor Lindelöf;DC;32;SE;5000,Tyrone Mings;DC;33;EN;3000,Ian Maatsen;LE;24;NL;35000,Matteo Ruggeri;LE;24;IT;28000,Matty Cash;LD;29;PL;22000,Aaron Wan-Bissaka;LD;28;CD;15000,Boubacar Kamara;MD;26;FR;50000,Amadou Onana;MD;25;BE;40000,Lamare Bogarde;MD;22;NL;18000,João Gomes;MC;25;BR;40000,Leon Goretzka;MC;31;DE;10000,Ross Barkley;MC;32;EN;4000,John McGinn;MDi;32;SCO;13000,Johan Manzambi;MO;21;CH;65000,Emiliano Buendía;MO;29;AR;16000,Alejandro Garnacho;EE;22;AR;22000,George Hemmings;EE;19;EN;15000,Ibrahim Mbaye;ED;18;SN;50000,Alysson;ED;20;BR;15000,Nicolas Jackson;PL;25;SN;45000,Brian Madjo;PL;17;EN;22000,Tammy Abraham;PL;29;EN;18000",
    BHA: "Bart Verbruggen;G;24;NL;40000,Jason Steele;G;36;EN;500,Tom McGill;G;26;CA;500,Luka Vuskovic;DC;19;HR;65000,Pascal Struijk;DC;27;NL;22000,Olivier Boscagli;DC;28;FR;20000,Michael Svoboda;DC;28;AT;5000,Lewis Dunk;DC;34;EN;3500,Ferdi Kadıoğlu;LE;27;TR;40000,Maxim De Cuyper;LE;25;BE;30000,Jaouen Hadjam;LE;23;DZ;10000,Mats Wieffer;LD;26;NL;25000,Costinha;LD;26;PT;10000,Jack Hinshelwood;MD;21;EN;35000,Chema Andrés;MD;21;ES;24000,Yasin Ayari;MC;23;SE;45000,Diego Gómez;MC;23;PY;30000,Malick Yalcouyé;MC;20;CI;22000,Matt O'Riley;MC;25;DK;18000,Pascal Groß;MC;35;DE;2500,Kaoru Mitoma;EE;29;JP;22000,Ibrahim Osman;EE;21;GH;12000,Yankuba Minteh;ED;22;GM;55000,Zadok Yohanna;ED;19;NG;25000,Femi Azeez;ED;25;NG;15000,Charalampos Kostoulas;PL;19;GR;40000,Georginio Rutter;PL;24;FR;30000,Promise David;PL;25;CA;20000,Stefanos Tzimas;PL;20;GR;18000,Evan Ferguson;PL;22;IE;15000",
    WHU: "Mads Hermansen;G;26;DK;15000,Alphonse Areola;G;33;FR;3000,Finlay Herrick;G;20;EN;0,Konstantinos Mavropanos;DC;28;GR;18000,Morato;DC;25;BR;14000,Maximilian Kilman;DC;29;EN;13000,Ezra Mayers;DC;19;EN;2000,Airidas Golambeckis;DC;19;EN;1000,Oliver Scarles;LE;20;EN;12000,Adama Boiro;LE;24;ES;2500,Kyle Walker-Peters;LD;29;EN;10000,Joël Veltman;LD;34;NL;1000,Soungoutou Magassa;MD;23;FR;15000,Edson Álvarez;MD;29;MX;12000,Mohamadou Kanté;MD;21;ML;7000,Tomáš Souček;MD;31;CZ;6000,Arne Engels;MC;23;BE;25000,Lewis Orford;MC;20;EN;2000,Divine Mukasa;MO;19;EN;10000,Keiber Lamadrid;MO;22;VE;1200,Edvin Austbø;EE;21;NO;12000,Manor Solomon;EE;27;IL;10000,Maxwel Cornet;EE;30;CI;1000,Jarrod Bowen;ED;29;EN;30000,Taty Castellanos;PL;28;AR;28000,Pablo;PL;22;BR;18000,Joël Piroe;PL;27;SR;10000,Joshua Ajala;PL;20;EN;0",
    CRY: "Dean Henderson;G;29;EN;28000,Walter Benítez;G;33;AR;4000,Remi Matthews;G;32;EN;200,Honest Ahanor;DC;18;IT;40000,Jaydee Canvot;DC;20;FR;35000,Chris Richards;DC;26;US;28000,Chadi Riad;DC;23;MA;15000,Axel Disasi;DC;28;FR;15000,Takehiro Tomiyasu;DC;28;JP;5000,Tyrick Mitchell;LE;27;EN;25000,Ben Chilwell;LE;29;EN;10000,Anan Khalaili;LD;22;IL;23000,Óscar Mingueza;LD;27;ES;15000,Adam Wharton;MD;22;EN;75000,Cheick Doucouré;MD;26;ML;7000,Jefferson Lerma;MD;32;CO;6000,Quinten Timber;MC;25;NL;25000,Daichi Kamada;MC;30;JP;10000,Will Hughes;MC;31;EN;5000,Yéremy Pino;EE;24;ES;30000,Dwight McNeil;EE;26;EN;22000,Ismaïla Sarr;ED;28;SN;45000,Darío Osorio;ED;22;CL;20000,Evann Guessand;ED;25;CI;20000,Zavier Gozo;ED;19;US;12000,Jørgen Strand Larsen;PL;26;NO;40000,Jean-Philippe Mateta;PL;29;FR;30000,Eddie Nketiah;PL;27;EN;13000",
    NFO: "John Victor;G;30;BR;3500,Matz Sels;G;34;BE;3500,Steven Benda;G;28;DE;1000,Murillo;DC;24;BR;50000,Ousmane Diomande;DC;22;CI;42000,Nikola Milenković;DC;29;YU;28000,Jair Cunha;DC;21;BR;25000,Neco Williams;LE;25;WAL;32000,Luca Netz;LE;23;DE;8000,Daniel Muñoz;LD;30;CO;22000,Ola Aina;LD;30;NG;18000,Nicolò Savona;LD;23;IT;15000,Ibrahim Sangaré;MD;28;CI;20000,James McAtee;MC;24;EN;22000,Xaver Schlager;MC;29;AT;15000,Nicolás Domínguez;MC;28;AR;13000,Ryan Yates;MC;28;EN;7000,Morgan Gibbs-White;MO;26;EN;80000,Callum Hudson-Odoi;EE;26;EN;25000,Dan Ndoye;ED;26;CH;35000,Liam Delap;PL;23;EN;40000,Igor Jesus;PL;25;BR;25000,Arnaud Kalimuendo;PL;24;FR;20000,Chris Wood;PL;34;NZ;4000",
    BOU: "Djordje Petrović;G;27;YU;28000,Michele Di Gregorio;G;29;IT;8000,Fraser Forster;G;38;EN;400,James Hill;DC;24;EN;30000,António Silva;DC;23;PT;30000,Bafodé Diakité;DC;25;FR;22000,Veljko Milosavljević;DC;19;YU;20000,Adrien Truffert;LE;24;FR;35000,Julio Soler;LE;21;AR;6000,Juanlu Sánchez;LD;23;ES;10000,Julián Araujo;LD;25;MX;6000,Max Aarons;LD;26;EN;2500,Adam Smith;LD;35;EN;300,Tyler Adams;MD;27;US;30000,Alex Scott;MC;23;EN;70000,Alex Tóth;MC;21;HU;12000,Lewis Cook;MC;29;EN;11000,Ryan Christie;MC;31;SCO;8000,Marcus Tavernier;MO;27;EN;30000,Justin Kluivert;MO;27;NL;25000,Amine Adli;EE;26;MA;20000,Rayan;ED;20;BR;60000,Ben Gannon-Doak;ED;21;SCO;15000,David Brooks;ED;29;WAL;12000,Junior Kroupi;PL;20;FR;70000,Evanilson;PL;27;BR;35000,Álvaro Rodríguez;PL;22;UY;20000,Daniel Jebbison;PL;23;CA;8000",
    EVE: "Jordan Pickford;G;32;EN;13000,Mark Travers;G;27;IE;3000,Tom King;G;31;WAL;100,Jarrad Branthwaite;DC;24;EN;45000,James Tarkowski;DC;33;EN;5000,Michael Keane;DC;33;EN;3000,Vitaliy Mykolenko;LE;27;UA;25000,Jake O'Brien;LD;25;IE;18000,Ainsley Maitland-Niles;LD;29;EN;10000,James Garner;MD;25;EN;50000,Hayden Hackney;MD;24;EN;32000,Christian Nørgaard;MD;32;DK;5000,Harrison Armstrong;MC;19;EN;30000,Merlin Röhl;MC;24;DE;20000,Charly Alcaraz;MC;23;AR;15000,Kiernan Dewsbury-Hall;MO;28;EN;40000,Tyrique George;EE;20;EN;25000,Jack Grealish;EE;31;EN;20000,Brennan Johnson;ED;25;WAL;25000,Tyler Dibling;ED;20;EN;17000,Thierno Barry;PL;24;FR;35000,Braiden Graham;PL;19;NIR;700",
    FUL: "Bernd Leno;G;34;DE;6000,Benjamin Lecomte;G;35;FR;800,Alex Borto;G;23;US;0,Calvin Bassey;DC;26;NG;28000,David Affengruber;DC;25;AT;20000,Joachim Andersen;DC;30;DK;16000,Jorge Cuenca;DC;26;ES;8000,Ryan Sessegnon;LE;26;EN;22000,Antonee Robinson;LE;29;US;22000,Timothy Castagne;LD;30;BE;8000,Kenny Tete;LD;31;NL;6000,Sander Berge;MD;28;NO;25000,Shea Charles;MD;23;NIR;25000,Alex Iwobi;MD;30;NG;20000,Hugo Larsson;MC;22;SE;23000,Manuel Ángel;MC;22;ES;5000,Harrison Reed;MC;31;EN;1300,Tom Cairney;MC;35;SCO;500,Josh King;MO;19;EN;40000,Emile Smith Rowe;MO;26;EN;17000,César Palacios;MO;22;ES;12000,Kevin;EE;23;BR;25000,Oscar Bobb;ED;23;NO;28000,Gonzalo García;PL;22;ES;35000,Rodrigo Muniz;PL;25;BR;20000,Jonah Kusi-Asare;PL;19;SE;5000",
    BRE: "Caoimhín Kelleher;G;27;IE;32000,Hákon Valdimarsson;G;25;IS;2500,Ellery Balcombe;G;27;EN;400,Sepp van den Berg;DC;24;NL;32000,Nathan Collins;DC;25;IE;30000,Kristoffer Ajer;DC;28;NO;25000,Jannik Schuster;DC;20;AT;22000,Ji-soo Kim;DC;21;KR;1800,Benjamin Fredrick;DC;21;NG;600,El Hadji Malick Diouf;LE;21;SN;35000,Keane Lewis-Potter;LE;25;EN;30000,Rico Henry;LE;29;JM;10000,Michael Kayode;LD;22;IT;40000,Aaron Hickey;LD;24;SCO;20000,Vitaly Janelt;MD;28;DE;20000,Mamadou Sangaré;MC;24;ML;50000,Yegor Yarmolyuk;MC;22;UA;32000,Mathias Jensen;MC;30;DK;8000,Josh Dasilva;MC;28;EN;1500,Mikkel Damsgaard;MO;26;DK;30000,Antoni Milambo;MO;21;NL;15000,Fábio Carvalho;MO;24;PT;8000,Kevin Schade;EE;24;DE;50000,Jaidon Anthony;EE;26;EN;20000,Gustavo Nunes;EE;20;BR;6000,Dango Ouattara;ED;24;BF;35000,Igor Thiago;PL;25;BR;65000,Kaye Furo;PL;19;BE;8000,Callum Wilson;PL;34;EN;4000",
    WOL: "José Sá;G;33;PT;3500,João Virgínia;G;27;PT;1500,John Ruddy;G;40;EN;100,Ladislav Krejci;DC;27;CZ;22000,Toti;DC;27;PT;16000,Yerson Mosquera;DC;25;CO;10000,Nasser Djiga;DC;23;BF;8000,Hugo Bueno;LE;24;ES;12000,Ghislain Konan;LE;30;CI;3000,Jackson Tchatchoua;LD;25;CM;12000,Kieran Trippier;LD;36;EN;1500,André;MD;25;BR;25000,Boubacar Traoré;MD;25;ML;4000,Jean-Ricner Bellegarde;MC;28;HT;16000,Marshall Munetsi;MC;30;ZW;12000,Jordan James;MC;22;WAL;12000,Tommy Doyle;MC;25;EN;7000,Fer López;MO;22;ES;22000,Tawanda Chirewa;MO;23;ZW;450,Mateus Mané;EE;19;PT;23000,Rafiki Saïd;EE;26;KM;7000,Enso González;EE;21;PY;2500,Rodrigo Gomes;ED;23;PT;15000,Bertrand Traoré;ED;31;BF;3000,Adam Armstrong;PL;29;EN;6000,Raúl Jiménez;PL;35;MX;2500,Sean Neave;PL;19;EN;1000,Nathan Fraser;PL;21;IE;600",
    LEE: "James Trafford;G;24;EN;35000,Michael Zetterer;G;31;DE;4000,Alex Cairns;G;33;EN;50,Tarik Muharemović;DC;23;BA;40000,Jaka Bijol;DC;27;SI;20000,Joe Rodon;DC;29;WAL;18000,Nico Elvedi;DC;30;CH;12000,Gabriel Gudmundsson;LE;27;SE;25000,Melvin Bard;LE;26;FR;10000,Jayden Bogle;LD;26;EN;18000,James Justin;LD;28;EN;16000,Ethan Ampadu;MD;26;WAL;35000,Anton Stach;MD;27;DE;32000,Ilia Gruev;MD;26;BG;12000,Ao Tanaka;MC;28;JP;15000,Sean Longstaff;MC;29;EN;12000,Brenden Aaronson;MO;26;US;22000,Noah Okafor;EE;26;CH;32000,Jean-Mattéo Bahoya;EE;21;FR;25000,Harry Wilson;ED;29;WAL;22000,Daniel James;ED;29;WAL;10000,Dominic Calvert-Lewin;PL;29;EN;25000,Lukas Nmecha;PL;27;DE;10000,Mateo Joseph;PL;23;ES;3500",
    BUR: "Max Weiß;G;22;DE;4000,Grégoire Coudert;G;27;FR;3000,Ben Amos;G;36;EN;50,Bashir Humphreys;DC;23;EN;10000,Max Alleyne;DC;21;EN;8000,Anel Ahmedhodzic;DC;27;BA;7000,Igor Julio;DC;28;BR;6000,Hjalmar Ekdal;DC;28;SE;5000,Jordan Beyer;DC;26;DE;1500,Lucas Pires;LE;25;BR;4000,Oliver Sonne;LD;26;PE;4000,Kyle Walker;LD;36;EN;1500,Connor Roberts;LD;31;WAL;1500,Shurandy Sambo;LD;25;CW;1300,Ugo Raghouber;MD;23;FR;5000,Reo Hatate;MC;28;JP;8000,Josh Cullen;MC;30;IE;3000,Josh Laurent;MC;31;EN;1500,Hannibal;MO;23;TN;15000,Aaron Ramsey;MO;23;EN;6000,Mike Tresor;MO;27;BE;2000,Largie Ramazani;EE;25;BE;8000,Jacob Bruun Larsen;EE;28;DK;4000,Lluc Castell;EE;20;ES;2000,Jaydon Banel;EE;22;NL;1000,Marcus Edwards;ED;27;CY;6000,Zeki Amdouni;PL;25;CH;7000,Dastan Satpaev;PL;18;KZ;5000,Andréas Hountondji;PL;24;DY;3000,Armando Broja;PL;25;AL;3000,Jamie Vardy;PL;39;EN;1000,Michael Obafemi;PL;26;IE;600,Ashley Barnes;PL;37;EN;150",
    SUN: "Robin Roefs;G;23;NL;30000,Melker Ellborg;G;23;SE;3000,Simon Moore;G;36;EN;75,Dan Ballard;DC;27;NIR;25000,Kevin Danso;DC;28;AT;20000,Omar Alderete;DC;29;PY;10000,Luke O'Nien;DC;31;EN;700,Aji Alese;DC;25;EN;700,Dayann Méthalie;LE;20;FR;25000,Reinildo Mandava;LE;32;MZ;4000,Trai Hume;LD;24;NIR;22000,Nordi Mukiele;LD;29;FR;18000,Thomas Meunier;LD;35;BE;1500,Granit Xhaka;MD;34;CH;8000,Jules Ahoka;MD;20;CD;7000,Noah Sadiki;MC;21;CD;40000,Habib Diarra;MC;22;SN;35000,Enzo Le Fée;MC;26;FR;30000,Alan Browne;MC;31;IE;1300,Chris Rigg;MO;19;EN;25000,Malick Fofana;EE;21;BE;30000,Nilson Angulo;EE;23;EC;20000,Romaine Mundle;EE;23;EN;5000,Timur Tuterov;EE;21;UA;300,Chemsdine Talbi;ED;21;MA;25000,Jocelin Ta Bi;ED;21;CI;2500,Abdoullah Ba;ED;23;MR;1500,Brian Brobbey;PL;24;NL;50000,Wilson Isidor;PL;26;HT;18000",
  };
  const POS_REAL = { G: 'G', DC: 'D', LE: 'D', LD: 'D', MD: 'M', MC: 'M', MO: 'M', MDi: 'M', ME: 'M', M: 'M', EE: 'A', ED: 'A', PL: 'A', SA: 'A', AV: 'A' };
  // 100 mil € ~ 38 · 500 mil € ~ 50 · 2 M€ ~ 60 · 10 M€ ~ 72 · 50 M€ ~ 84 · 150 M€ ~ 92
  function forcaPorValor(milEur) {
    return clamp(72 + 17 * (Math.log10(Math.max(1, milEur)) - 4), 12, 96);
  }
  const CACHE_PLANTEL = {};
  function plantelReal(id) {
    if (id in CACHE_PLANTEL) return CACHE_PLANTEL[id];
    const s = PLANTEIS[id];
    if (!s) return (CACHE_PLANTEL[id] = null);
    const todos = s.split(',').map((x) => {
      const [n, p, i, nac, v] = x.split(';');
      return { n, p: POS_REAL[p] || 'M', i: clamp(+i || 25, 16, 40), nac: nac || 'PT', v: +v || 0 };
    });
    const comValor = todos.filter((x) => x.v > 0).length >= todos.length * 0.6;
    // até 26 por clube: os mais valiosos de cada posição
    const quota = { G: 3, D: 9, M: 8, A: 6 };
    const jog = [];
    for (const p of ['G', 'D', 'M', 'A']) {
      const g = todos.filter((x) => x.p === p);
      if (comValor) g.sort((a, b) => b.v - a.v);
      jog.push(...g.slice(0, quota[p]));
    }
    const r = { jog, comValor, nivel: null };
    if (comValor) {
      const vs = jog.map((x) => x.v).filter(Boolean).sort((a, b) => a - b);
      const med = vs[Math.floor(vs.length / 2)] || 100;
      for (const x of jog) {
        if (!x.v) x.v = Math.max(25, Math.round(med * 0.4));
        x.f = Math.round(forcaPorValor(x.v) * 10) / 10;
      }
      const top = jog.slice().sort((a, b) => b.f - a.f).slice(0, 14);
      r.nivel = Math.round(top.reduce((t, x) => t + x.f, 0) / top.length);
      // craques: os dois mais valiosos do meio-campo/ataque, se se destacarem
      jog.filter((x) => x.p === 'M' || x.p === 'A').sort((a, b) => b.v - a.v).slice(0, 2).forEach((x) => {
        if (x.v >= med * 2.5) x.c = 1;
      });
    }
    return (CACHE_PLANTEL[id] = r);
  }
  // nível de cada clube = força real do plantel; as divisões ficam
  // ordenadas pela força (os clubes sem valores ficam no fim)
  function ordenarPorForca(lista) {
    const xs = lista.map((c, k) => {
      const p = plantelReal(c[1]);
      const nv = p && p.comValor ? p.nivel : null;
      return { c: nv != null ? c.slice(0, 5).concat([nv]) : c, k, nv };
    });
    const com = xs.filter((x) => x.nv != null).sort((a, b) => b.nv - a.nv || a.k - b.k);
    const sem = xs.filter((x) => x.nv == null);
    return com.concat(sem).map((x) => x.c);
  }
  // ec = multiplicador do dinheiro (bilhetes, patrocínios, prémios)
  const PAISES = {
    PT: { nome: 'Portugal', band: '🇵🇹', clubes: ordenarPorForca(CLUBES), ec: 1, divs: ['1.ª Divisão', '2.ª Divisão', '3.ª Divisão', '4.ª Divisão'] },
    ES: { nome: 'Espanha', band: '🇪🇸', clubes: ordenarPorForca(CLUBES_ES), ec: 1.7, divs: ['1.ª Divisão espanhola', '2.ª Divisão espanhola'] },
    IT: { nome: 'Itália', band: '🇮🇹', clubes: ordenarPorForca(CLUBES_IT), ec: 1.6, divs: ['1.ª Divisão italiana', '2.ª Divisão italiana'] },
    EN: { nome: 'Inglaterra', band: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', clubes: ordenarPorForca(CLUBES_EN), ec: 2.6, divs: ['1.ª Divisão inglesa', '2.ª Divisão inglesa'] },
  };
  const NOMES_DIV = PAISES.PT.divs;
  const POR_DIV = 10;
  // nome e economia de uma divisão (índice global em m.divs)
  function infoDiv(m, d) {
    return (m.dinfo && m.dinfo[d]) || { p: 'PT', n: d };
  }
  function nomeDiv(m, d) {
    const i = infoDiv(m, d);
    return (PAISES[i.p] || PAISES.PT).divs[i.n] || 'Divisão';
  }
  function econ(m, d) {
    const i = infoDiv(m, d);
    const base = DIV[Math.min(3, i.n)];
    const k = (PAISES[i.p] || PAISES.PT).ec;
    return {
      publico: base.publico * (k > 1 ? 1.6 : 1),
      bilhete: Math.round(base.bilhete * (k > 1 ? 1 + (k - 1) * 0.6 : 1)),
      patrocinio: Math.round(base.patrocinio * k),
      credito: Math.round(base.credito * k),
      premio: Math.round(base.premio * k),
      dinheiro: Math.round(base.dinheiro * k),
    };
  }
  function divsDoPais(m, pais) {
    return (m.dinfo || []).map((x, d) => ({ d, n: x.n, p: x.p })).filter((x) => x.p === pais).sort((a, b) => a.n - b.n).map((x) => x.d);
  }

  // valores por divisão: público base, bilhete de referência, patrocínio por
  // jornada, limite de empréstimo, prémio de campeão
  const DIV = [
    { publico: 21000, bilhete: 20, patrocinio: 120000, credito: 6000000, premio: 5000000, dinheiro: 7000000 },
    { publico: 8000, bilhete: 12, patrocinio: 70000, credito: 2500000, premio: 2000000, dinheiro: 2500000 },
    { publico: 3500, bilhete: 8, patrocinio: 50000, credito: 1200000, premio: 1000000, dinheiro: 1200000 },
    { publico: 1400, bilhete: 5, patrocinio: 36000, credito: 600000, premio: 500000, dinheiro: 600000 },
  ];
  const PREMIO_TACA = 1500000;
  const PREMIO_ARTILHEIRO = 500000;
  const CUSTO_LUGARES = 350000; // por cada 1.000 lugares
  const MAX_LUGARES = 70000;
  const JURO = 0.012; // por jornada
  const MAX_PLANTEL = 26;
  const MIN_PLANTEL = 16;
  const MAX_SUBS = 3;

  // ---------------------------------------------------------------
  // Nomes dos jogadores (inventados)
  // ---------------------------------------------------------------
  const N = {
    PT: {
      p: 'João Rui Pedro Tiago Diogo Bruno André Rafael Gonçalo Miguel Hugo Nuno Ricardo Paulo Fábio Vítor Luís Tomás Rodrigo Francisco Duarte Martim Simão Gustavo Daniel Filipe Sérgio Hélder Marco Carlos Jorge Fernando Rúben Leonel Renato Henrique Ivo Valter Samuel Leandro Afonso Dinis Lourenço Salvador Vasco Bernardo Telmo Joel Flávio Cristiano'.split(' '),
      a: 'Silva Santos Ferreira Pereira Oliveira Costa Rodrigues Martins Jesus Sousa Fernandes Gonçalves Gomes Lopes Marques Alves Almeida Ribeiro Pinto Carvalho Teixeira Moreira Correia Mendes Nunes Soares Vieira Monteiro Cardoso Rocha Raposo Neves Coelho Cruz Cunha Pires Ramos Reis Simões Antunes Matos Fonseca Machado Araújo Barbosa Tavares Lourenço Castro Figueiredo Azevedo Freitas Abreu Brito Batista Borges Magalhães Moura Pacheco Valente Sequeira Quintela Barros Faria Leite Esteves Carneiro'.split(' '),
    },
    BR: {
      p: 'Thiago Gabriel Lucas Matheus Felipe Vinícius Guilherme Leonardo Caio Igor Wellington Everton Rodrigo Diego Danilo Renan Júnior Wesley Luan Maicon Douglas Anderson Jefferson Robson Willian Kaique Yuri Ramon Breno Talles'.split(' '),
      a: 'Souza Lima Barbosa Ribeiro Carvalho Teixeira Moraes Nascimento Araújo Rocha Dias Andrade Cavalcanti Miranda Freitas Batista Cardoso Medeiros Bezerra Tavares Paixão Vasconcelos'.split(' '),
      alcunha: 'Thiaguinho Paulinho Juninho Neném Dudu Pepeu Tchê Cafu Gabigol Biro Zezinho Fabinho Marquinhos Ronaldão Didi Kaká Léo Pedrinho Toninho Serginho Bruninho Wendel Jairzinho'.split(' '),
    },
    ES: {
      p: 'Pablo Javier Álvaro Sergio Iker Rubén Adrián Hugo Marcos Alberto Raúl Íñigo Unai Dani Borja'.split(' '),
      a: 'García Martínez López Sánchez Romero Navarro Torres Domínguez Gil Vázquez Ramírez Serrano Molina Ortega Delgado Castillo'.split(' '),
    },
    AR: {
      p: 'Facundo Agustín Matías Nicolás Lautaro Franco Gonzalo Joaquín Tomás Ezequiel Maximiliano'.split(' '),
      a: 'Fernández González Rodríguez Benítez Acosta Medina Herrera Aguirre Giménez Sosa Ledesma Paredes'.split(' '),
    },
    CV: {
      p: 'Kevin Jair Garry Stopira Nuno Ryan Willy Dylan Bebé Lisandro'.split(' '),
      a: 'Tavares Semedo Fortes Monteiro Lopes Varela Brito Furtado Andrade Spencer Mendes'.split(' '),
    },
    AO: {
      p: 'Gelson Manucho Mateus Djalma Fredy Ary Show Kialonda Bastos Zito'.split(' '),
      a: 'Dala Quiala Manuel Campos Cabral Kaluyituka Nzola Buta Mabululu'.split(' '),
    },
    FR: {
      p: 'Kylian Théo Lucas Hugo Mathis Enzo Rayan Yanis Adrien Maxime'.split(' '),
      a: 'Dubois Moreau Laurent Lefèvre Girard Bonnet Mercier Fontaine Chevalier Rousseau'.split(' '),
    },
    SN: {
      p: 'Moussa Ibrahima Cheikh Mamadou Ousmane Idrissa Pape Abdou'.split(' '),
      a: 'Diallo Ndiaye Sarr Diop Fall Cissé Gueye Faye Koné Traoré'.split(' '),
    },
    UY: {
      p: 'Sebastián Rodrigo Federico Mathías Diego Bruno Martín Gastón'.split(' '),
      a: 'Cabrera Píriz Olivera Muslera Cáceres Laxalt Bentancur Ugarte'.split(' '),
    },
    RS: {
      p: 'Nikola Marko Luka Stefan Dušan Filip Aleksandar'.split(' '),
      a: 'Petrović Jovanović Nikolić Marković Đorđević Stanković Ilić Pavlović'.split(' '),
    },
  };
  N.IT = {
    p: 'Marco Luca Alessandro Lorenzo Matteo Davide Federico Andrea Riccardo Simone Nicolò Gianluca Stefano Francesco Giorgio Daniele Paolo Fabio Mattia Tommaso'.split(' '),
    a: 'Rossi Russo Ferrari Esposito Bianchi Romano Colombo Ricci Marino Greco Bruno Gallo Conti De Luca Mancini Costa Giordano Rizzo Lombardi Moretti Barbieri Fontana Santoro Mariani Rinaldi Caruso Ferrara Galli Martini Leone'.split(' '),
  };
  N.EN = {
    p: 'Harry Jack Oliver George Charlie Jacob Thomas James Joshua William Callum Mason Kyle Declan Jordan Reece Marcus Phil Ben Luke Aaron Jamie Conor Ollie'.split(' '),
    a: 'Smith Jones Taylor Brown Williams Wilson Johnson Davies Robinson Wright Thompson Evans Walker White Roberts Green Hall Wood Jackson Clarke Hughes Edwards Turner Hill Ward Morris Cooper Barnes Shaw Palmer'.split(' '),
  };
  const NACS = ['PT', 'BR', 'ES', 'AR', 'CV', 'AO', 'FR', 'SN', 'UY', 'RS', 'IT', 'EN'];
  const PESOS_NAC = [70, 11, 3, 3, 3, 3, 2, 2, 2, 1, 1, 1];
  const PESOS_PAIS = {
    PT: PESOS_NAC,
    ES: [3, 6, 62, 6, 1, 1, 5, 3, 3, 2, 3, 3],
    IT: [3, 7, 3, 7, 1, 1, 6, 4, 3, 4, 58, 3],
    EN: [4, 6, 5, 4, 1, 1, 7, 6, 2, 2, 2, 60],
  };

  function gerarNome(rng, nac) {
    const L = N[nac] || N.PT;
    if (nac === 'BR' && L.alcunha && rng.chance(0.4)) return rng.pick(L.alcunha);
    const p = rng.pick(L.p);
    const a = rng.pick(L.a);
    return rng.chance(0.5) ? p + ' ' + a : p.charAt(0) + '. ' + a;
  }

  // ---------------------------------------------------------------
  // Características (Brasfoot) e comportamento (Elifoot)
  // ---------------------------------------------------------------
  const CARACT = {
    fin: 'Finalização', cab: 'Cabeceio', cru: 'Cruzamento', dri: 'Drible', vel: 'Velocidade',
    arm: 'Armação', pas: 'Passe', des: 'Desarme', mar: 'Marcação', res: 'Resistência',
    ref: 'Reflexo', col: 'Colocação', sai: 'Saída do gol', dpe: 'Defesa de penálti',
  };
  const CAR_POS = {
    G: [['ref', 'col', 'sai', 'dpe'], [4, 4, 3, 2]],
    D: [['des', 'mar', 'cab', 'vel', 'cru', 'pas', 'res'], [5, 5, 3, 2, 2, 1, 2]],
    M: [['pas', 'arm', 'des', 'res', 'dri', 'cru', 'fin', 'vel', 'mar'], [5, 4, 3, 3, 3, 2, 2, 2, 2]],
    A: [['fin', 'cab', 'dri', 'vel', 'res', 'arm', 'cru'], [6, 4, 4, 4, 1, 1, 1]],
  };
  const COMPORTAMENTO = ['Sarrafeiro', 'Caceteiro', 'Caneleiro', 'Cavalheiro', 'Cordeirinho', 'Fair Play'];
  const AMARELO_POR_COMP = [0.62, 0.5, 0.4, 0.3, 0.22, 0.12];
  const VERMELHO_POR_COMP = [0.03, 0.02, 0.012, 0.007, 0.004, 0.002];
  const FALTA_POR_COMP = [1.6, 1.35, 1.15, 1, 0.85, 0.65];

  const FORMACOES = {
    '4-4-2': [4, 4, 2], '4-3-3': [4, 3, 3], '4-5-1': [4, 5, 1], '4-2-4': [4, 2, 4],
    '3-5-2': [3, 5, 2], '3-4-3': [3, 4, 3], '3-3-4': [3, 3, 4],
    '5-3-2': [5, 3, 2], '5-4-1': [5, 4, 1], '5-2-3': [5, 2, 3],
  };
  const ESTILOS = { eq: 'Equilibrado', at: 'Ataque total', ca: 'Contra-ataque' };
  const MARCACOES = { n: 'Normal', f: 'Forte', mf: 'Muito forte' };
  const FOCOS = { meio: 'Pelo meio', alas: 'Pelas alas' };

  function posicoesDa(form) {
    const f = FORMACOES[form] || FORMACOES['4-4-2'];
    const out = ['G'];
    for (let i = 0; i < f[0]; i++) out.push('D');
    for (let i = 0; i < f[1]; i++) out.push('M');
    for (let i = 0; i < f[2]; i++) out.push('A');
    return out;
  }

  // ---------------------------------------------------------------
  // Valor de mercado e salário
  // ---------------------------------------------------------------
  function valor(j) {
    const f = Math.max(1, j.f);
    const ageF = j.i <= 21 ? 1.35 : j.i <= 24 ? 1.2 : j.i <= 28 ? 1 : j.i <= 31 ? 0.8 : j.i <= 33 ? 0.55 : 0.35;
    const v = 40 * Math.pow(f, 2.6) * ageF * (j.c ? 1.4 : 1) * (0.85 + j.cp * 0.05);
    return Math.max(5000, Math.round(v / 1000) * 1000);
  }
  function salarioDe(j) {
    return Math.max(300, Math.round((valor(j) * 0.0028) / 100) * 100);
  }

  // ---------------------------------------------------------------
  // Criação de jogadores e do mundo
  // ---------------------------------------------------------------
  function novoJogador(m, rng, pos, nivel, idade, extra) {
    const id = 'j' + m.prox++;
    const nac = rng.peso(NACS, PESOS_PAIS[(extra && extra.pais) || 'PT'] || PESOS_NAC);
    const [lista, pesos] = CAR_POS[pos];
    const ca = [];
    const nCar = rng.chance(0.15) ? 1 : 2;
    while (ca.length < nCar) {
      const k = rng.peso(lista, pesos);
      if (!ca.includes(k)) ca.push(k);
    }
    const craque = (pos === 'A' || pos === 'M') && rng.chance(extra && extra.craque != null ? extra.craque : 0.12);
    let f = rng.normal(nivel, 6.5) + (craque ? 6 : 0);
    if (pos === 'G') f += 1;
    const j = {
      id,
      n: gerarNome(rng, nac),
      p: pos,
      f: Math.round(clamp(f, 1, 97) * 10) / 10,
      i: idade || clamp(Math.round(rng.normal(26, 4.2)), 17, 36),
      nac,
      c: craque ? 1 : 0,
      cp: rng.peso([0, 1, 2, 3, 4, 5], [5, 12, 20, 33, 20, 10]),
      ca,
      cl: null,
      gol: 0, // golos na época
      jg: 0, // jogos na época
      golT: 0, // golos na carreira
      am: 0, // amarelos acumulados
      cas: 0, // jogos de castigo
      les: 0, // jornadas lesionado
    };
    j.sal = salarioDe(j);
    m.jog[id] = j;
    return j;
  }

  function criarMundo(semente, opcoes) {
    const m = {
      v: VERSAO,
      s: (semente >>> 0) || 1,
      prox: 1,
      epoca: 1,
      ano: 2026,
      passo: 0, // índice em m.cal
      clubes: {},
      jog: {},
      paises: [],
      divs: [],
      dinfo: [],
      tab: {},
      fix: [],
      cal: [],
      tacas: {},
      mercado: { leiloes: [], livres: [] },
      noticias: [],
      historia: [],
      ultimos: null,
      treinadores: {},
      opc: Object.assign({ multi: false }, opcoes || {}),
    };
    const { rng, guardar } = rngDoMundo(m);
    const lista = ((opcoes && opcoes.paises) || ['PT']).filter((p) => PAISES[p]);
    if (!lista.length) lista.push('PT');
    m.paises = lista;
    for (const pais of lista) {
      const P0 = PAISES[pais];
      P0.divs.forEach((_, n) => {
        m.divs.push([]);
        m.dinfo.push({ p: pais, n });
      });
    }
    const todos = [];
    for (const pais of lista) PAISES[pais].clubes.forEach((c, idx) => todos.push({ c, pais, n: Math.floor(idx / POR_DIV) }));
    todos.forEach(({ c, pais, n }) => {
      const div = m.dinfo.findIndex((x) => x.p === pais && x.n === n);
      const id = c[1];
      const ec = econ(m, div);
      const cl = {
        id,
        n: c[0],
        c: c[1],
        cor: [c[2], c[3]],
        pais,
        div,
        nivel: c[5],
        lug: pais !== 'PT' ? c[4] : Math.min(c[4], n === 0 ? c[4] : n === 1 ? 15000 : n === 2 ? 8000 : 5000),
        obras: 0,
        bil: ec.bilhete,
        din: Math.round(ec.dinheiro * (c[5] >= 70 ? 2.5 : 1)),
        emp: 0,
        mor: 10,
        pl: [],
        tat: { f: '4-4-2', e: 'eq', m: 'n', foco: 'meio' },
        xi: null,
        hum: null,
        sem: 0, // jogos seguidos sem ganhar
      };
      m.clubes[id] = cl;
      m.divs[div].push(id);
      const plano = [['G', 3], ['D', 8], ['M', 7], ['A', 5]];
      const real = plantelReal(id);
      const conta = { G: 0, D: 0, M: 0, A: 0 };
      if (real) {
        for (const x of real.jog) {
          const j = novoJogador(m, rng, x.p, c[5], x.i, { pais, craque: 0 });
          j.n = x.n;
          j.nac = x.nac;
          if (x.f != null) j.f = x.f;
          j.c = x.c ? 1 : 0;
          j.sal = salarioDe(j);
          j.cl = id;
          cl.pl.push(j.id);
          conta[x.p]++;
        }
      }
      // completa o plantel até ao mínimo (ou cria-o todo, se não houver dados)
      const minimo = real ? { G: 2, D: 6, M: 6, A: 4 } : null;
      for (const [pos, n] of plano) {
        for (let k = conta[pos]; k < (minimo ? minimo[pos] : n); k++) {
          const j = novoJogador(m, rng, pos, c[5], null, { pais });
          j.cl = id;
          cl.pl.push(j.id);
        }
      }
    });
    for (let k = 0; k < 14; k++) {
      const j = novoJogador(m, rng, rng.peso(['G', 'D', 'M', 'A'], [1, 3, 3, 3]), rng.int(25, 40));
      m.mercado.livres.push(j.id);
    }
    novaEpoca(m, rng);
    guardar();
    return m;
  }

  // ---------------------------------------------------------------
  // Carreiras antigas (versão 1, só Portugal) passam para a versão 2
  // ---------------------------------------------------------------
  function migrar(m) {
    if (!m || m.v === VERSAO) return m;
    if (m.v === 1) {
      m.paises = ['PT'];
      m.dinfo = m.divs.map((_, n) => ({ p: 'PT', n }));
      for (const id in m.clubes) m.clubes[id].pais = 'PT';
      const t = m.taca || { vivos: [], isentos: [], ronda: 0, jogos: [] };
      const feitas = t.ronda || 0;
      let vivos = t.vivos || [];
      let isentos = t.isentos || [];
      if (feitas >= 1 && isentos.length) {
        vivos = vivos.concat(isentos);
        isentos = [];
      }
      m.tacas = { PT: { pais: 'PT', vivos, isentos, pre: true, inicio: 0, feitas, campeao: t.campeao || null, finalista: t.finalista || null, jogos: (t.jogos || []).map((j) => Object.assign({ rn: RONDAS_TACA[j.r] }, j)) } };
      delete m.taca;
      for (const h of m.historia || []) if (!h.tacas) h.tacas = { PT: h.taca || null };
      if (m.ultimos && m.ultimos.jogos) for (const j of m.ultimos.jogos) if (j.tp === 'T') { j.pa = 'PT'; j.rn = RONDAS_TACA[j.r]; }
      m.v = 2;
    }
    return m;
  }

  // ---------------------------------------------------------------
  // Calendário: 18 jornadas de liga (2 voltas) + 6 rondas da Taça
  // ---------------------------------------------------------------
  function calendarioLiga(ids, rng) {
    const t = ids.slice();
    for (let i = t.length - 1; i > 0; i--) {
      const k = Math.floor(rng.r() * (i + 1));
      [t[i], t[k]] = [t[k], t[i]];
    }
    const n = t.length;
    const voltas = [];
    const arr = t.slice();
    for (let r = 0; r < n - 1; r++) {
      const jogos = [];
      for (let i = 0; i < n / 2; i++) {
        const a = arr[i];
        const b = arr[n - 1 - i];
        jogos.push(r % 2 === 0 ? [a, b] : [b, a]);
      }
      voltas.push(jogos);
      arr.splice(1, 0, arr.pop());
    }
    return voltas.concat(voltas.map((js) => js.map(([a, b]) => [b, a])));
  }

  const RONDAS_TACA = ['Pré-eliminatória', '16 avos', 'Oitavos', 'Quartos', 'Meias-finais', 'Final'];
  function nomeRonda(tc) {
    if (tc.pre && tc.feitas === 0) return 'Pré-eliminatória';
    const n = tc.vivos.length;
    return n <= 2 ? 'Final' : n <= 4 ? 'Meias-finais' : n <= 8 ? 'Quartos' : n <= 16 ? 'Oitavos' : '16 avos';
  }

  function novaEpoca(m, rng) {
    m.fix = m.divs.map((ids) => calendarioLiga(ids, rng));
    m.tab = {};
    for (const ids of m.divs) for (const id of ids) m.tab[id] = { j: 0, v: 0, e: 0, d: 0, gm: 0, gs: 0, p: 0, forma: '' };
    // L1 L2 T0 L3 L4 L5 T1 L6 L7 L8 T2 L9 L10 L11 T3 L12 L13 L14 T4 L15 L16 L17 T5 L18
    const cal = [];
    let t = 0;
    for (let r = 0; r < 18; r++) {
      cal.push({ t: 'L', r });
      if ((r === 1 || r === 4 || r === 7 || r === 10 || r === 13 || r === 16) && t < 6) cal.push({ t: 'T', r: t++ });
    }
    m.cal = cal;
    m.passo = 0;
    // Taça de cada país: se não forem potência de 2, os das divisões mais
    // baixas jogam uma pré-eliminatória. A final calha sempre na última ronda.
    m.tacas = {};
    for (const pais of m.paises || ['PT']) {
      const ordem = divsDoPais(m, pais).map((d) => m.divs[d].slice().sort(() => rng.r() - 0.5));
      const todos = [].concat(...ordem);
      const N = todos.length;
      let P = 1;
      while (P * 2 <= N) P *= 2;
      const nPre = P === N ? 0 : 2 * (N - P);
      const pre = nPre ? todos.slice(N - nPre) : [];
      const isentos = nPre ? todos.slice(0, N - nPre) : [];
      const rondas = (nPre ? 1 : 0) + Math.round(Math.log2(P));
      m.tacas[pais] = { pais, vivos: nPre ? pre : todos, isentos, pre: !!nPre, inicio: Math.max(0, 6 - rondas), feitas: 0, campeao: null, finalista: null, jogos: [] };
    }
    for (const id in m.jog) {
      const j = m.jog[id];
      j.gol = 0;
      j.jg = 0;
    }
  }

  function jogosDoPasso(m, rng) {
    const p = m.cal[m.passo];
    if (!p) return [];
    if (p.t === 'L') {
      const out = [];
      m.fix.forEach((voltas, div) => {
        for (const [h, a] of voltas[p.r]) out.push({ h, a, tipo: 'L', div, neutro: false });
      });
      return out;
    }
    // Taças: sorteio da ronda em cada país
    const out = [];
    for (const pais in m.tacas) {
      const tc = m.tacas[pais];
      if (tc.campeao || p.r < tc.inicio) continue;
      const vivos = tc.vivos.slice();
      for (let i = vivos.length - 1; i > 0; i--) {
        const k = Math.floor(rng.r() * (i + 1));
        [vivos[i], vivos[k]] = [vivos[k], vivos[i]];
      }
      const nome = nomeRonda(tc);
      for (let i = 0; i + 1 < vivos.length; i += 2) {
        out.push({ h: vivos[i], a: vivos[i + 1], tipo: 'T', ronda: p.r, pais, rn: nome, neutro: vivos.length === 2 });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------
  // Escalação automática (IA e "melhor equipa")
  // ---------------------------------------------------------------
  function disponivel(j) {
    return j && j.les <= 0 && j.cas <= 0;
  }
  const MULT_POS = {
    G: { G: 1, D: 0.3, M: 0.25, A: 0.2 },
    D: { G: 0.25, D: 1, M: 0.8, A: 0.6 },
    M: { G: 0.2, D: 0.8, M: 1, A: 0.82 },
    A: { G: 0.15, D: 0.6, M: 0.82, A: 1 },
  };
  function melhorOnze(m, clube, form) {
    const pos = posicoesDa(form);
    const livres = clube.pl.map((id) => m.jog[id]).filter(disponivel);
    const usados = new Set();
    const xi = new Array(pos.length).fill(null);
    // primeiro quem joga na posição natural, depois improvisa
    for (const passo of [true, false]) {
      for (let s = 0; s < pos.length; s++) {
        if (xi[s]) continue;
        let best = null;
        let bv = -1;
        for (const j of livres) {
          if (usados.has(j.id)) continue;
          if (passo && j.p !== pos[s]) continue;
          const v = j.f * MULT_POS[j.p][pos[s]];
          if (v > bv) {
            bv = v;
            best = j;
          }
        }
        if (best) {
          xi[s] = best.id;
          usados.add(best.id);
        }
      }
    }
    const banco = livres
      .filter((j) => !usados.has(j.id))
      .sort((a, b) => b.f - a.f)
      .slice(0, 7)
      .map((j) => j.id);
    return { xi, banco };
  }
  function forcaOnze(m, xi, form) {
    const pos = posicoesDa(form);
    let s = 0;
    xi.forEach((id, k) => {
      const j = id && m.jog[id];
      if (j) s += j.f * MULT_POS[j.p][pos[k]];
    });
    return s;
  }
  // A IA escolhe a formação: em casa mais atacante, fora mais defensiva
  function escolhaIA(m, clube, emCasa, rng) {
    const opcoes = emCasa ? ['4-3-3', '4-4-2', '3-4-3', '4-2-4', '3-5-2'] : ['4-4-2', '4-5-1', '5-3-2', '4-3-3', '5-4-1'];
    let best = null;
    for (const f of opcoes) {
      const { xi, banco } = melhorOnze(m, clube, f);
      const v = forcaOnze(m, xi, f) * (1 + rng.r() * 0.04);
      if (!best || v > best.v) best = { f, xi, banco, v };
    }
    const estilo = emCasa ? (rng.chance(0.3) ? 'at' : 'eq') : rng.chance(0.35) ? 'ca' : 'eq';
    return { tat: { f: best.f, e: estilo, m: rng.chance(0.2) ? 'f' : 'n', foco: rng.chance(0.5) ? 'meio' : 'alas' }, xi: best.xi, banco: best.banco };
  }
  // Escalação de um humano: usa a que ele guardou e tapa buracos
  function escalacaoHumana(m, clube) {
    const tat = Object.assign({ f: '4-4-2', e: 'eq', m: 'n', foco: 'meio' }, clube.tat || {});
    if (!FORMACOES[tat.f]) tat.f = '4-4-2';
    const pos = posicoesDa(tat.f);
    const meus = new Set(clube.pl);
    let xi = Array.isArray(clube.xi) ? clube.xi.slice(0, pos.length) : [];
    while (xi.length < pos.length) xi.push(null);
    const vistos = new Set();
    xi = xi.map((id) => {
      if (!id || !meus.has(id) || vistos.has(id) || !disponivel(m.jog[id])) return null;
      vistos.add(id);
      return id;
    });
    if (xi.some((x) => !x)) {
      const auto = melhorOnze(m, clube, tat.f);
      for (let s = 0; s < xi.length; s++) {
        if (xi[s]) continue;
        // o melhor disponível que ainda não está no onze
        let best = null;
        let bv = -1;
        for (const id of clube.pl) {
          const j = m.jog[id];
          if (!disponivel(j) || vistos.has(id)) continue;
          const v = j.f * MULT_POS[j.p][pos[s]];
          if (v > bv) {
            bv = v;
            best = id;
          }
        }
        if (best) {
          xi[s] = best;
          vistos.add(best);
        }
      }
      void auto;
    }
    const banco = (Array.isArray(clube.banco) ? clube.banco : [])
      .filter((id) => meus.has(id) && !vistos.has(id) && disponivel(m.jog[id]))
      .slice(0, 7);
    if (banco.length < 7) {
      for (const id of clube.pl.slice().sort((a, b) => m.jog[b].f - m.jog[a].f)) {
        if (banco.length >= 7) break;
        if (!vistos.has(id) && !banco.includes(id) && disponivel(m.jog[id])) banco.push(id);
      }
    }
    return { tat, xi, banco };
  }

  // ---------------------------------------------------------------
  // MOTOR DO JOGO — minuto a minuto
  // ---------------------------------------------------------------
  function criarJogo(m, info, escH, escA) {
    const lado = (id, esc) => ({
      id,
      tat: Object.assign({}, esc.tat),
      pos: posicoesDa(esc.tat.f),
      xi: esc.xi.slice(),
      banco: esc.banco.slice(),
      subs: 0,
      sairam: [],
      jogaram: esc.xi.filter(Boolean),
      lesoes: [],
      travao: 1,
      fora: [], // expulsos
      am: {},
    });
    return {
      tipo: info.tipo,
      div: info.div,
      ronda: info.ronda,
      pais: info.pais,
      rn: info.rn,
      neutro: !!info.neutro,
      h: lado(info.h, escH),
      a: lado(info.a, escA),
      min: 0,
      extra: 0,
      gh: 0,
      ga: 0,
      ev: [],
      fim: false,
      pen: null,
    };
  }

  function efJog(m, j, posSlot, min, ladoObj) {
    let ef = j.f * MULT_POS[j.p][posSlot];
    if (ladoObj.lesoes.includes(j.id)) ef *= 0.6;
    if (min > 60) ef *= 1 - (min - 60) * (j.ca.includes('res') ? 0.0008 : 0.0022);
    return ef;
  }

  function setores(m, jogo, ld) {
    const L = jogo[ld];
    const cl = m.clubes[L.id];
    const mor = 0.9 + (cl ? cl.mor : 10) * 0.01;
    const casa = !jogo.neutro && ld === 'h' ? 1.06 : 1;
    let nPT = 0;
    let G = 0;
    let D = 0;
    let M = 0;
    let A = 0;
    let n = 0;
    let carM = 0;
    let cru = 0;
    L.xi.forEach((id, k) => {
      if (!id) return;
      const j = m.jog[id];
      const ef = efJog(m, j, L.pos[k], jogo.min, L);
      n++;
      if (j.nac === 'PT') nPT++;
      const p = L.pos[k];
      if (p === 'G') G += ef * (j.ca.includes('ref') ? 1.08 : 1) * (j.ca.includes('col') ? 1.05 : 1);
      else if (p === 'D') D += ef;
      else if (p === 'M') {
        M += ef;
        if (j.ca.includes('pas') || j.ca.includes('arm')) carM += 0.06 * ef;
      } else A += ef;
      if (j.ca.includes('cru')) cru++;
    });
    const nac = 1 + nPT * 0.005;
    const k = mor * casa * nac;
    const s = {
      G: Math.max(5, G) * k,
      D: (D + M * 0.35) * k,
      M: (M + carM + (D + A) * 0.18) * k,
      A: (A + M * 0.35) * k,
      cru,
      n,
    };
    const e = L.tat.e;
    if (e === 'at') {
      s.A *= 1.15;
      s.D *= 0.85;
    } else if (e === 'ca') {
      s.D *= 1.1;
      s.M *= 0.88;
    }
    return s;
  }

  function escolherPeso(m, L, pesos, rng, foco) {
    const ids = [];
    const ps = [];
    L.xi.forEach((id, k) => {
      if (!id) return;
      const j = m.jog[id];
      let w = pesos[L.pos[k]] * Math.max(1, j.f);
      if (foco === 'alas' && (j.ca.includes('cru') || j.ca.includes('vel'))) w *= 1.3;
      if (foco === 'cab' && j.ca.includes('cab')) w *= 2.2;
      if (w > 0) {
        ids.push(id);
        ps.push(w);
      }
    });
    return ids.length ? m.jog[rng.peso(ids, ps)] : null;
  }
  function slotDe(L, id) {
    return L.pos[L.xi.indexOf(id)] || 'M';
  }
  function goleiro(m, L) {
    const k = L.pos.indexOf('G');
    const id = L.xi[k];
    if (id) return m.jog[id];
    // sem guarda-redes (expulso sem trocas): joga quem estiver
    const outro = L.xi.find(Boolean);
    return outro ? m.jog[outro] : null;
  }

  function registar(jogo, ev) {
    jogo.ev.push(ev);
  }

  function golo(m, jogo, atk, marcador, tipo, rng) {
    const L = jogo[atk];
    if (atk === 'h') jogo.gh++;
    else jogo.ga++;
    marcador.gol = (marcador.gol || 0) + 1;
    marcador.golT = (marcador.golT || 0) + 1;
    L.travao *= 0.86;
    const dif = Math.abs(jogo.gh - jogo.ga);
    if (dif >= 3) L.travao *= 0.85;
    registar(jogo, { m: jogo.min, t: 'g', l: atk, j: marcador.id, k: tipo || '' });
    void rng;
  }

  function oportunidade(m, jogo, atk, rng) {
    const def = atk === 'h' ? 'a' : 'h';
    const LA = jogo[atk];
    const LD = jogo[def];
    const foco = LA.tat.foco;
    const atacante = escolherPeso(m, LA, { G: 0, D: 0.35, M: 1.4, A: 3 }, rng, foco);
    const defensor = escolherPeso(m, LD, { G: 0, D: 3, M: 1.2, A: 0.2 }, rng);
    if (!atacante) return;
    const gr = goleiro(m, LD);
    const r = rng.r();
    if (r < 0.2) {
      const r2 = rng.r();
      if (r2 < 0.07) {
        // penálti
        const cands = LA.xi.filter(Boolean).map((id) => m.jog[id]);
        cands.sort((a, b) => b.c * 30 + (b.ca.includes('fin') ? 10 : 0) + b.f - (a.c * 30 + (a.ca.includes('fin') ? 10 : 0) + a.f));
        const batedor = cands[0];
        let p = 0.75 + (batedor.c ? 0.08 : 0) + (batedor.ca.includes('fin') ? 0.04 : 0);
        if (gr && gr.ca.includes('dpe')) p -= 0.14;
        registar(jogo, { m: jogo.min, t: 'pen', l: atk, j: batedor.id });
        if (rng.chance(p)) golo(m, jogo, atk, batedor, 'pen', rng);
        else registar(jogo, { m: jogo.min, t: 'pf', l: atk, j: batedor.id });
        if (defensor) cartaoFalta(m, jogo, def, defensor, rng, 0.6);
        return;
      }
      if (r2 < 0.55) {
        // canto: cabeceamento
        const cab = escolherPeso(m, LA, { G: 0, D: 1, M: 0.6, A: 1.5 }, rng, 'cab');
        const pc = cab && cab.ca.includes('cab') ? 0.07 : 0.035;
        if (cab && rng.chance(pc * (gr && gr.ca.includes('sai') ? 0.75 : 1))) golo(m, jogo, atk, cab, 'cab', rng);
        return;
      }
      return;
    }
    // duelo atacante vs defensor
    let fa = efJog(m, atacante, slotDe(LA, atacante.id), jogo.min, LA);
    if (atacante.ca.includes('dri')) fa *= 1.12;
    if (atacante.ca.includes('vel')) fa *= LA.tat.e === 'ca' ? 1.14 : 1.07;
    if (atacante.c) fa *= 1.1;
    let fd = defensor ? efJog(m, defensor, slotDe(LD, defensor.id), jogo.min, LD) : 5;
    if (defensor && defensor.ca.includes('des')) fd *= 1.12;
    if (defensor && defensor.ca.includes('mar')) fd *= 1.08;
    if (defensor && foco === 'alas' && defensor.ca.includes('cab')) fd *= 1.06;
    const pw = Math.pow(fa, 1.4) / (Math.pow(fa, 1.4) + Math.pow(fd, 1.4));
    if (!rng.chance(pw)) {
      if (defensor && rng.chance(0.18)) cartaoFalta(m, jogo, def, defensor, rng, 1);
      return;
    }
    // remate
    const gk = gr ? efJog(m, gr, 'G', jogo.min, LD) * (gr.ca.includes('ref') ? 1.08 : 1) : 5;
    let pg = 0.34 * Math.pow((2 * fa) / (fa + gk * 1.05), 0.9);
    if (atacante.c) pg *= 1.25;
    if (atacante.ca.includes('fin')) pg *= 1.18;
    if (LA.tat.e === 'ca') pg *= 1.12;
    if (foco === 'alas' && atacante.ca.includes('cab')) pg *= 1.1;
    if (slotDe(LA, atacante.id) === 'D') pg *= 0.7;
    if (rng.chance(clamp(pg, 0.03, 0.75))) {
      golo(m, jogo, atk, atacante, '', rng);
      return;
    }
    const r3 = rng.r();
    const tipo = r3 < 0.45 ? 'def' : r3 < 0.52 ? (rng.chance(0.5) ? 'pos' : 'bar') : r3 < 0.8 ? 'lad' : 'cim';
    if (tipo === 'pos' || tipo === 'bar' || (tipo === 'def' && rng.chance(0.25))) {
      registar(jogo, { m: jogo.min, t: tipo, l: atk, j: atacante.id });
    }
  }

  function cartaoFalta(m, jogo, ld, j, rng, mult) {
    const L = jogo[ld];
    if (!L.xi.includes(j.id)) return;
    const cp = j.cp;
    const marc = L.tat.m === 'mf' ? 1.45 : L.tat.m === 'f' ? 1.2 : 1;
    if (rng.chance(VERMELHO_POR_COMP[cp] * marc * mult)) {
      expulsar(jogo, ld, j, 'v');
      return;
    }
    if (rng.chance(AMARELO_POR_COMP[cp] * marc * mult)) {
      L.am[j.id] = (L.am[j.id] || 0) + 1;
      if (L.am[j.id] >= 2) expulsar(jogo, ld, j, 'va');
      else registar(jogo, { m: jogo.min, t: 'am', l: ld, j: j.id });
    }
  }
  function expulsar(jogo, ld, j, tipo) {
    const L = jogo[ld];
    const k = L.xi.indexOf(j.id);
    if (k < 0) return;
    L.xi[k] = null;
    L.fora.push(j.id);
    registar(jogo, { m: jogo.min, t: tipo === 'va' ? 'va' : 'vm', l: ld, j: j.id });
  }

  // substituição (humano pela interface, ou IA automática)
  function substituir(m, jogo, ld, saiId, entraId) {
    const L = jogo[ld];
    if (jogo.fim || L.subs >= MAX_SUBS) return false;
    const k = L.xi.indexOf(saiId);
    const b = L.banco.indexOf(entraId);
    if (k < 0 || b < 0) return false;
    L.xi[k] = entraId;
    L.banco.splice(b, 1);
    L.subs++;
    L.sairam.push(saiId);
    if (!L.jogaram.includes(entraId)) L.jogaram.push(entraId);
    registar(jogo, { m: jogo.min, t: 's', l: ld, j: entraId, j2: saiId });
    return true;
  }
  function mudarTatica(jogo, ld, tat) {
    const L = jogo[ld];
    if (tat.e && ESTILOS[tat.e]) L.tat.e = tat.e;
    if (tat.m && MARCACOES[tat.m]) L.tat.m = tat.m;
    if (tat.foco && FOCOS[tat.foco]) L.tat.foco = tat.foco;
  }

  function iaSubs(m, jogo, ld, rng) {
    const L = jogo[ld];
    if (L.subs >= MAX_SUBS || !L.banco.length) return;
    // lesionados primeiro
    for (const id of L.lesoes) {
      const k = L.xi.indexOf(id);
      if (k < 0 || L.subs >= MAX_SUBS) continue;
      const pos = L.pos[k];
      const melhor = L.banco
        .map((b) => m.jog[b])
        .sort((a, b) => b.f * MULT_POS[b.p][pos] - a.f * MULT_POS[a.p][pos])[0];
      if (melhor) substituir(m, jogo, ld, id, melhor.id);
    }
    if (jogo.min >= 58 && jogo.min <= 80 && L.subs < MAX_SUBS && rng.chance(0.06)) {
      const meu = ld === 'h' ? jogo.gh - jogo.ga : jogo.ga - jogo.gh;
      const bancoJ = L.banco.map((b) => m.jog[b]);
      if (meu < 0) {
        // a perder: tira um defesa/médio, mete um avançado
        const sai = L.xi.map((id, k) => (id && (L.pos[k] === 'D' || L.pos[k] === 'M') ? m.jog[id] : null)).filter(Boolean).sort((a, b) => a.f - b.f)[0];
        const entra = bancoJ.filter((j) => j.p === 'A' || j.p === 'M').sort((a, b) => b.f - a.f)[0];
        if (sai && entra) substituir(m, jogo, ld, sai.id, entra.id);
      } else {
        // troca o mais cansado/fraco por alguém da mesma posição
        const cand = L.xi.map((id, k) => (id && L.pos[k] !== 'G' ? { j: m.jog[id], pos: L.pos[k] } : null)).filter(Boolean);
        if (!cand.length) return;
        const alvo = rng.pick(cand);
        const entra = bancoJ.filter((j) => j.p === alvo.pos).sort((a, b) => b.f - a.f)[0];
        if (entra && entra.f >= alvo.j.f - 6) substituir(m, jogo, ld, alvo.j.id, entra.id);
      }
    }
  }

  function passo(m, jogo, rng, humanos) {
    if (jogo.fim) return;
    jogo.min++;
    if (jogo.min === 46) registar(jogo, { m: 45, t: 'int' });
    const sh = setores(m, jogo, 'h');
    const sa = setores(m, jogo, 'a');
    let ph = Math.pow(sh.M, 1.3) / (Math.pow(sh.M, 1.3) + Math.pow(sa.M, 1.3));
    if (jogo.h.tat.e === 'ca') ph *= 0.9;
    if (jogo.a.tat.e === 'ca') ph = 1 - (1 - ph) * 0.9;
    jogo.posse = (jogo.posse || 0) + ph;
    const atk = rng.r() < ph ? 'h' : 'a';
    const def = atk === 'h' ? 'a' : 'h';
    const SA = atk === 'h' ? sh : sa;
    const SD = atk === 'h' ? sa : sh;
    let p = 0.17 * Math.pow(clamp(SA.A / Math.max(1, SD.D) / 0.62, 0.3, 2.6), 0.75) * jogo[atk].travao;
    const md = jogo[def].tat.m;
    if (md === 'f') p *= 0.93;
    if (md === 'mf') p *= 0.82;
    if (jogo[atk].tat.foco === 'alas') p *= 1 + Math.min(4, SA.cru) * 0.025;
    if (rng.chance(p)) oportunidade(m, jogo, atk, rng);
    // faltas para cartão (as das jogadas já estão na oportunidade)
    for (const ld of ['h', 'a']) {
      const L = jogo[ld];
      const mm = L.tat.m === 'mf' ? 2.2 : L.tat.m === 'f' ? 1.45 : 1;
      if (rng.chance(0.026 * mm)) {
        const ids = L.xi.filter(Boolean);
        if (ids.length) {
          const pesos = ids.map((id) => FALTA_POR_COMP[m.jog[id].cp] * (slotDe(L, id) === 'G' ? 0.1 : 1));
          cartaoFalta(m, jogo, ld, m.jog[rng.peso(ids, pesos)], rng, 1);
        }
      }
      // lesões
      if (rng.chance(0.0011)) {
        const ids = L.xi.filter((id) => id && !L.lesoes.includes(id));
        if (ids.length) {
          const id = rng.pick(ids);
          L.lesoes.push(id);
          registar(jogo, { m: jogo.min, t: 'les', l: ld, j: id });
        }
      }
      if (!(humanos && humanos.includes(L.id))) iaSubs(m, jogo, ld, rng);
    }
    if (jogo.min === 90) jogo.extra = rng.int(1, 4);
    if (jogo.min >= 90 + jogo.extra) {
      jogo.fim = true;
      if (jogo.tipo === 'T' && jogo.gh === jogo.ga) penaltis(m, jogo, rng);
    }
  }

  function penaltis(m, jogo, rng) {
    const conv = (ld) => {
      const L = jogo[ld];
      const outro = jogo[ld === 'h' ? 'a' : 'h'];
      const gr = goleiro(m, outro);
      const batedores = L.xi.filter(Boolean).map((id) => m.jog[id]).sort((a, b) => b.c - a.c || b.f - a.f);
      return (k) => {
        const b = batedores[k % batedores.length];
        let p = 0.74 + (b.c ? 0.08 : 0) + (b.ca.includes('fin') ? 0.04 : 0) - (gr && gr.ca.includes('dpe') ? 0.12 : 0);
        return rng.chance(p);
      };
    };
    const ch = conv('h');
    const ca = conv('a');
    let ph = 0;
    let pa = 0;
    let k = 0;
    for (; k < 5; k++) {
      if (ch(k)) ph++;
      if (ca(k)) pa++;
    }
    while (ph === pa && k < 30) {
      if (ch(k)) ph++;
      if (ca(k)) pa++;
      k++;
    }
    if (ph === pa) ph++;
    jogo.pen = [ph, pa];
    registar(jogo, { m: 120, t: 'gp', l: ph > pa ? 'h' : 'a', x: ph + '-' + pa });
  }

  function vencedor(jogo) {
    if (jogo.gh !== jogo.ga) return jogo.gh > jogo.ga ? jogo.h.id : jogo.a.id;
    if (jogo.pen) return jogo.pen[0] > jogo.pen[1] ? jogo.h.id : jogo.a.id;
    return null;
  }

  // ---------------------------------------------------------------
  // Jornada: preparar -> (passos) -> concluir
  // ---------------------------------------------------------------
  function humanosDe(m) {
    return Object.values(m.clubes)
      .filter((c) => c.hum)
      .map((c) => c.id);
  }

  function prepararJornada(m) {
    const { rng, guardar } = rngDoMundo(m);
    const lista = jogosDoPasso(m, rng);
    const jogos = lista.map((info) => {
      const ch = m.clubes[info.h];
      const ca = m.clubes[info.a];
      const eh = ch.hum && !ch.auto ? escalacaoHumana(m, ch) : escolhaIA(m, ch, !info.neutro, rng);
      const ea = ca.hum && !ca.auto ? escalacaoHumana(m, ca) : escolhaIA(m, ca, false, rng);
      return criarJogo(m, info, eh, ea);
    });
    guardar();
    return jogos;
  }

  function correrJogos(m, jogos, humanos) {
    const { rng, guardar } = rngDoMundo(m);
    for (const jg of jogos) while (!jg.fim) passo(m, jg, rng, humanos || []);
    guardar();
  }

  function noticia(m, txt, clube) {
    m.noticias.unshift({ e: m.epoca, p: m.passo, txt, cl: clube || null });
    if (m.noticias.length > 80) m.noticias.length = 80;
  }

  function treinadorDe(m, login) {
    if (!m.treinadores[login]) m.treinadores[login] = { pts: 0, v: 0, e: 0, d: 0, titulos: [], hist: [], ofertas: [] };
    return m.treinadores[login];
  }

  function concluirJornada(m, jogos) {
    const { rng, guardar } = rngDoMundo(m);
    const p = m.cal[m.passo];
    const resumo = { epoca: m.epoca, passo: m.passo, t: p.t, r: p.r, jogos: [] };

    for (const jg of jogos) {
      const ch = m.clubes[jg.h.id];
      const ca = m.clubes[jg.a.id];
      // tabela
      if (jg.tipo === 'L') {
        const th = m.tab[ch.id];
        const ta = m.tab[ca.id];
        th.j++;
        ta.j++;
        th.gm += jg.gh;
        th.gs += jg.ga;
        ta.gm += jg.ga;
        ta.gs += jg.gh;
        if (jg.gh > jg.ga) {
          th.v++;
          th.p += 3;
          ta.d++;
          th.forma = ('V' + th.forma).slice(0, 5);
          ta.forma = ('D' + ta.forma).slice(0, 5);
        } else if (jg.gh < jg.ga) {
          ta.v++;
          ta.p += 3;
          th.d++;
          th.forma = ('D' + th.forma).slice(0, 5);
          ta.forma = ('V' + ta.forma).slice(0, 5);
        } else {
          th.e++;
          ta.e++;
          th.p++;
          ta.p++;
          th.forma = ('E' + th.forma).slice(0, 5);
          ta.forma = ('E' + ta.forma).slice(0, 5);
        }
      }
      const venc = vencedor(jg);
      // moral e série
      for (const [cl, casa] of [[ch, true], [ca, false]]) {
        if (venc === cl.id) {
          cl.mor = clamp(cl.mor + (casa ? 2 : 3), 0, 20);
          cl.sem = 0;
        } else if (venc === null) {
          cl.mor = clamp(cl.mor + (casa ? 0 : 1), 0, 20);
          cl.sem++;
        } else {
          cl.mor = clamp(cl.mor - (casa ? 3 : 2), 0, 20);
          cl.sem++;
        }
        if (cl.hum) {
          const t = treinadorDe(m, cl.hum);
          if (venc === cl.id) {
            t.v++;
            t.pts += casa ? 2 : 3;
          } else if (venc === null) {
            t.e++;
            t.pts += 1;
          } else t.d++;
        }
      }
      // bilheteira (casa); na Taça divide-se
      const forcaMedia = (cl) => {
        const top = cl.pl.map((id) => m.jog[id].f).sort((a, b) => b - a).slice(0, 14);
        return top.reduce((s, x) => s + x, 0) / Math.max(1, top.length);
      };
      const fm = (forcaMedia(ch) + forcaMedia(ca)) / 2;
      const dv = econ(m, ch.div);
      const membros = m.divs[ch.div] || [ch.id];
      const ref = membros.reduce((s, id) => s + (m.clubes[id].nivel || 50), 0) / membros.length;
      const fatorPreco = Math.pow(dv.bilhete / Math.max(1, ch.bil), 1.25);
      let publico = dv.publico * Math.pow(fm / ref, 1.6) * (0.75 + ch.mor / 40) * fatorPreco * (jg.tipo === 'T' ? 1 + (jg.neutro ? 0.8 : 0.1) : 1);
      publico = Math.round(clamp(publico * (0.9 + rng.r() * 0.2), 200, ch.lug));
      const receita = publico * ch.bil;
      if (jg.tipo === 'T' && !jg.neutro) {
        ch.din += Math.round(receita / 2);
        ca.din += Math.round(receita / 2);
      } else if (jg.tipo === 'T') {
        ch.din += Math.round(receita / 2);
        ca.din += Math.round(receita / 2);
      } else ch.din += receita;
      ch.ultPublico = publico;
      ch.ultReceita = receita;

      // castigos, lesões e jogos
      for (const L of [jg.h, jg.a]) {
        const cl = m.clubes[L.id];
        for (const id of cl.pl) {
          const j = m.jog[id];
          if (j.cas > 0 && !L.jogaram.includes(id)) j.cas--;
        }
        for (const id of L.jogaram) {
          const j = m.jog[id];
          if (!j) continue;
          j.jg++;
        }
        for (const id in L.am) {
          const j = m.jog[id];
          if (!j || L.fora.includes(id)) continue;
          j.am += L.am[id];
          if (j.am >= 3) {
            j.am = 0;
            j.cas = 1;
          }
        }
        for (const id of L.fora) {
          const j = m.jog[id];
          if (j) j.cas = 1 + (rng.chance(0.3) ? 1 : 0) + (j.cp <= 1 && rng.chance(0.3) ? 1 : 0);
        }
        for (const id of L.lesoes) {
          const j = m.jog[id];
          if (j) {
            j.les = rng.int(1, 6);
            if (j.les >= 5) j.f = Math.max(1, j.f - rng.int(1, 3));
          }
        }
        // evolução (Elifoot: aproxima-se da média da equipa)
        const media = cl.pl.map((id) => m.jog[id].f).sort((a, b) => b - a).slice(0, 14).reduce((s, x) => s + x, 0) / 14;
        for (const id of cl.pl) {
          const j = m.jog[id];
          const jogou = L.jogaram.includes(id);
          const idade = j.i <= 20 ? 0.32 : j.i <= 23 ? 0.2 : j.i <= 28 ? 0.06 : j.i <= 31 ? -0.04 : -0.2;
          let d = (media - j.f) * (jogou ? 0.012 : 0.004) + idade * (jogou ? 1 : 0.5) + (rng.r() - 0.5) * (jogou ? 0.5 : 0.2);
          if (j.les > 0) d = Math.min(d, 0);
          j.f = Math.round(clamp(j.f + d, 1, 99) * 10) / 10;
        }
      }
      if (jg.tipo === 'T') {
        const perdedor = venc === ch.id ? ca.id : ch.id;
        const tc = m.tacas[jg.pais];
        if (tc) tc.jogos.push({ r: jg.ronda, rn: jg.rn, h: ch.id, a: ca.id, gh: jg.gh, ga: jg.ga, pen: jg.pen, x: perdedor });
      }
      resumo.jogos.push({
        tp: jg.tipo,
        dv: jg.div,
        r: jg.ronda,
        pa: jg.pais,
        rn: jg.rn,
        h: ch.id,
        a: ca.id,
        gh: jg.gh,
        ga: jg.ga,
        pen: jg.pen,
        ps: Math.round(((jg.posse || 45) / Math.max(1, jg.min)) * 100),
        pub: ch.ultPublico,
        ev: jg.ev,
      });
    }
    // Taças: os vencedores passam; depois da pré-eliminatória juntam-se os isentos
    if (p.t === 'T') {
      for (const pais in m.tacas) {
        const tc = m.tacas[pais];
        const meus = jogos.filter((j) => j.pais === pais);
        if (!meus.length) continue;
        const vencedores = meus.map(vencedor);
        tc.vivos = vencedores.concat(tc.isentos || []);
        tc.isentos = [];
        tc.feitas++;
        if (vencedores.length === 1) {
          const fin = meus[0];
          tc.campeao = vencedores[0];
          tc.finalista = fin.h.id === vencedores[0] ? fin.a.id : fin.h.id;
          const c = m.clubes[tc.campeao];
          const premio = Math.round(PREMIO_TACA * (PAISES[pais] || PAISES.PT).ec);
          c.din += premio;
          m.clubes[tc.finalista].din += Math.round(premio / 3);
          noticia(m, '🏆 ' + c.n + ' ganha a Taça' + (m.paises.length > 1 ? ' de ' + PAISES[pais].nome : '') + '!', c.id);
          if (c.hum) {
            const t = treinadorDe(m, c.hum);
            t.pts += 15;
            t.titulos.push({ e: m.epoca, ano: m.ano, t: 'Taça' + (m.paises.length > 1 ? ' de ' + PAISES[pais].nome : ''), cl: c.n });
          }
        }
      }
    }

    // finanças da jornada (todos os clubes)
    for (const id in m.clubes) {
      const c = m.clubes[id];
      const sal = c.pl.reduce((s, jid) => s + m.jog[jid].sal, 0);
      const pat = p.t === 'L' ? econ(m, c.div).patrocinio : 0;
      const juros = Math.round(c.emp * JURO);
      c.din += pat - (p.t === 'L' ? sal : 0) - juros;
      c.ultFin = { sal: p.t === 'L' ? sal : 0, pat, juros };
      if (c.obras > 0) {
        c.lug = Math.min(MAX_LUGARES, c.lug + c.obras);
        noticia(m, '🏗️ ' + c.n + ': obras concluídas, o estádio tem agora ' + c.lug.toLocaleString('pt-PT') + ' lugares.', c.id);
        c.obras = 0;
      }
      if (c.din < 0) c.mor = clamp(c.mor - 1, 0, 20);
      // a IA paga dívidas e pede crédito se precisar
      if (!c.hum) {
        const cred = econ(m, c.div).credito;
        if (c.din < -cred * 0.2 && c.emp < cred) {
          const x = Math.min(cred - c.emp, -c.din + 200000);
          c.emp += x;
          c.din += x;
        } else if (c.emp > 0 && c.din > c.emp * 1.5) {
          c.din -= c.emp;
          c.emp = 0;
        }
      }
    }
    // lesões diminuem por jornada
    for (const id in m.jog) {
      const j = m.jog[id];
      if (j.les > 0) j.les--;
    }

    resolverLeiloes(m, rng);
    iaMercado(m, rng);
    verificarDespedimentos(m, rng);

    m.ultimos = resumo;
    m.passo++;
    if (m.passo >= m.cal.length) fimDeEpoca(m, rng);
    guardar();
    return resumo;
  }

  function jogarJornada(m) {
    const jogos = prepararJornada(m);
    correrJogos(m, jogos, []);
    return concluirJornada(m, jogos);
  }

  // ---------------------------------------------------------------
  // Classificação
  // ---------------------------------------------------------------
  function classificacao(m, div) {
    return m.divs[div]
      .map((id) => Object.assign({ id }, m.tab[id]))
      .sort((a, b) => b.p - a.p || b.gm - b.gs - (a.gm - a.gs) || b.gm - a.gm || a.id.localeCompare(b.id));
  }
  function artilheiros(m, n) {
    return Object.values(m.jog)
      .filter((j) => j.gol > 0 && j.cl)
      .sort((a, b) => b.gol - a.gol || b.f - a.f)
      .slice(0, n || 10);
  }

  // ---------------------------------------------------------------
  // Mercado: leilões, compra direta, livres, vendas
  // ---------------------------------------------------------------
  function porLeilao(m, jid, base, quem) {
    const j = m.jog[jid];
    if (!j || !j.cl) return { erro: 'Jogador inválido.' };
    if (m.mercado.leiloes.some((l) => l.j === jid)) return { erro: 'Já está em leilão.' };
    const cl = m.clubes[j.cl];
    if (cl.pl.length - m.mercado.leiloes.filter((l) => l.de === cl.id).length <= MIN_PLANTEL) return { erro: 'O plantel tem de ficar com pelo menos ' + MIN_PLANTEL + ' jogadores.' };
    const v = valor(j);
    const b = Math.max(Math.round(v * 0.5), Math.round(Number(base) || v * 0.8));
    m.mercado.leiloes.push({ j: jid, de: cl.id, base: b, lances: {}, desde: m.passo + '|' + m.epoca });
    if (quem) noticia(m, '🔨 ' + cl.n + ' pôs ' + j.n + ' em leilão (base ' + fmtEur(b) + ').', cl.id);
    return { ok: true, base: b };
  }
  function licitar(m, clubeId, jid, montante) {
    const l = m.mercado.leiloes.find((x) => x.j === jid);
    if (!l) return { erro: 'Esse leilão já acabou.' };
    if (l.de === clubeId) return { erro: 'Não podes licitar no teu próprio jogador.' };
    const c = m.clubes[clubeId];
    const v = Math.round(Number(montante) || 0);
    if (v < l.base) return { erro: 'O lance mínimo é ' + fmtEur(l.base) + '.' };
    if (v > c.din + econ(m, c.div).credito - c.emp) return { erro: 'Não tens dinheiro (nem crédito) para esse lance.' };
    if (c.pl.length >= MAX_PLANTEL) return { erro: 'O teu plantel está cheio (' + MAX_PLANTEL + ').' };
    l.lances[clubeId] = v;
    return { ok: true };
  }
  function transferir(m, jid, para, preco, de) {
    const j = m.jog[jid];
    const cd = de ? m.clubes[de] : null;
    const cp = m.clubes[para];
    if (cd) {
      cd.pl = cd.pl.filter((x) => x !== jid);
      cd.din += preco;
      if (Array.isArray(cd.xi)) cd.xi = cd.xi.map((x) => (x === jid ? null : x));
      if (Array.isArray(cd.banco)) cd.banco = cd.banco.filter((x) => x !== jid);
    } else {
      m.mercado.livres = m.mercado.livres.filter((x) => x !== jid);
    }
    cp.pl.push(jid);
    cp.din -= preco;
    j.cl = para;
    j.am = 0;
    j.sal = salarioDe(j);
    m.mercado.leiloes = m.mercado.leiloes.filter((l) => l.j !== jid);
  }
  function resolverLeiloes(m, rng) {
    const fim = [];
    for (const l of m.mercado.leiloes) {
      const j = m.jog[l.j];
      if (!j || j.cl !== l.de) {
        fim.push(l);
        continue;
      }
      // a IA também licita
      for (const id in m.clubes) {
        const c = m.clubes[id];
        if (c.hum || c.id === l.de || c.pl.length >= MAX_PLANTEL - 1) continue;
        const mesmos = c.pl.map((x) => m.jog[x]).filter((x) => x.p === j.p).sort((a, b) => b.f - a.f);
        const ref = mesmos[Math.min(1, mesmos.length - 1)];
        if (ref && j.f < ref.f + 1) continue;
        const oferta = Math.round(valor(j) * (0.8 + rng.r() * 0.45));
        if (oferta >= l.base && c.din > oferta * 1.2 && rng.chance(0.35)) l.lances[c.id] = Math.max(l.lances[c.id] || 0, oferta);
      }
      let best = null;
      for (const cid in l.lances) {
        const v = l.lances[cid];
        const c = m.clubes[cid];
        if (!c || c.pl.length >= MAX_PLANTEL) continue;
        if (v > c.din + econ(m, c.div).credito - c.emp) continue;
        if (!best || v > best.v) best = { cid, v };
      }
      if (best) {
        const comprador = m.clubes[best.cid];
        if (comprador.din < best.v) {
          const falta = best.v - comprador.din;
          comprador.emp += falta;
          comprador.din += falta;
        }
        transferir(m, l.j, best.cid, best.v, l.de);
        noticia(m, '💰 ' + j.n + ' (' + m.clubes[l.de].n + ') vendido em leilão ao ' + comprador.n + ' por ' + fmtEur(best.v) + '.', best.cid);
        if (m.clubes[l.de].hum) noticia(m, '💰 Vendeste ' + j.n + ' por ' + fmtEur(best.v) + '.', l.de);
      } else if (m.clubes[l.de].hum) {
        noticia(m, '🔨 Ninguém licitou em ' + j.n + '. Continua no plantel.', l.de);
      }
      fim.push(l);
    }
    m.mercado.leiloes = m.mercado.leiloes.filter((l) => !fim.includes(l));
  }
  function precoPedido(m, j) {
    const cl = j.cl && m.clubes[j.cl];
    if (!cl) return Math.round(valor(j) * 0.15);
    const ord = cl.pl.map((x) => m.jog[x]).filter((x) => x.p === j.p).sort((a, b) => b.f - a.f);
    const titular = ord.indexOf(j) < (j.p === 'G' ? 1 : j.p === 'A' ? 2 : 4);
    return Math.round((valor(j) * (1.3 + (titular ? 0.35 : 0))) / 1000) * 1000;
  }
  function comprarDireto(m, clubeId, jid) {
    const j = m.jog[jid];
    const c = m.clubes[clubeId];
    if (!j || !c) return { erro: 'Jogador inválido.' };
    if (j.cl === clubeId) return { erro: 'Já é teu.' };
    if (c.pl.length >= MAX_PLANTEL) return { erro: 'O teu plantel está cheio (' + MAX_PLANTEL + ').' };
    if (j.cl) {
      const vend = m.clubes[j.cl];
      if (vend.hum) return { erro: 'Esse jogador é de outro treinador. Só o podes comprar se ele o puser em leilão.' };
      if (vend.pl.length <= MIN_PLANTEL + 2) return { erro: 'O ' + vend.n + ' não quer ficar com tão poucos jogadores.' };
    }
    const preco = j.cl ? precoPedido(m, j) : 0;
    if (preco > c.din) return { erro: 'Precisas de ' + fmtEur(preco) + ' (tens ' + fmtEur(c.din) + ').' };
    const de = j.cl;
    transferir(m, jid, clubeId, preco, de);
    noticia(m, '✍️ ' + c.n + (de ? ' compra ' + j.n + ' ao ' + m.clubes[de].n + ' por ' + fmtEur(preco) : ' contrata ' + j.n + ' (livre)') + '.', clubeId);
    return { ok: true, preco };
  }
  function venderJa(m, clubeId, jid, rng) {
    const j = m.jog[jid];
    const c = m.clubes[clubeId];
    if (!j || j.cl !== clubeId) return { erro: 'Jogador inválido.' };
    if (c.pl.length <= MIN_PLANTEL) return { erro: 'O plantel tem de ficar com pelo menos ' + MIN_PLANTEL + ' jogadores.' };
    const preco = Math.round((valor(j) * 0.65) / 1000) * 1000;
    const destinos = Object.values(m.clubes).filter((x) => !x.hum && x.pl.length < MAX_PLANTEL && x.id !== clubeId);
    const dest = destinos.length ? destinos[Math.floor((rng ? rng.r() : Math.random()) * destinos.length)] : null;
    if (dest) {
      transferir(m, jid, dest.id, 0, clubeId);
      dest.din -= preco;
      c.din += preco;
    } else {
      c.pl = c.pl.filter((x) => x !== jid);
      c.din += preco;
      j.cl = null;
      m.mercado.livres.push(jid);
    }
    noticia(m, '💸 ' + c.n + ' vende ' + j.n + (dest ? ' ao ' + dest.n : '') + ' por ' + fmtEur(preco) + '.', clubeId);
    return { ok: true, preco };
  }
  function dispensar(m, clubeId, jid) {
    const j = m.jog[jid];
    const c = m.clubes[clubeId];
    if (!j || j.cl !== clubeId) return { erro: 'Jogador inválido.' };
    if (c.pl.length <= MIN_PLANTEL) return { erro: 'O plantel tem de ficar com pelo menos ' + MIN_PLANTEL + ' jogadores.' };
    c.pl = c.pl.filter((x) => x !== jid);
    if (Array.isArray(c.xi)) c.xi = c.xi.map((x) => (x === jid ? null : x));
    j.cl = null;
    m.mercado.livres.push(jid);
    m.mercado.leiloes = m.mercado.leiloes.filter((l) => l.j !== jid);
    noticia(m, '👋 ' + c.n + ' dispensa ' + j.n + '.', clubeId);
    return { ok: true };
  }

  function iaMercado(m, rng) {
    for (const id in m.clubes) {
      const c = m.clubes[id];
      if (c.hum) continue;
      // põe jogadores em leilão de vez em quando
      if (c.pl.length > 20 && rng.chance(0.18)) {
        const ord = c.pl.map((x) => m.jog[x]).sort((a, b) => a.f - b.f);
        const alvo = rng.chance(0.75) ? ord[rng.int(0, 3)] : ord[rng.int(4, ord.length - 1)];
        if (alvo && !m.mercado.leiloes.some((l) => l.j === alvo.id)) porLeilao(m, alvo.id, Math.round(valor(alvo) * (0.7 + rng.r() * 0.3)));
      }
      // se faltar gente, contrata livres
      while (c.pl.length < 18 && m.mercado.livres.length) {
        const melhor = m.mercado.livres.map((x) => m.jog[x]).sort((a, b) => b.f - a.f)[0];
        transferir(m, melhor.id, c.id, 0, null);
      }
      while (c.pl.length < 18) {
        const j = novoJogador(m, rng, rng.peso(['G', 'D', 'M', 'A'], [1, 3, 3, 3]), c.nivel - 8, rng.int(18, 30), { pais: c.pais });
        j.cl = c.id;
        c.pl.push(j.id);
      }
      // garante 2 guarda-redes
      const grs = c.pl.filter((x) => m.jog[x].p === 'G').length;
      if (grs < 2) {
        const j = novoJogador(m, rng, 'G', c.nivel - 5, rng.int(19, 32), { pais: c.pais });
        j.cl = c.id;
        c.pl.push(j.id);
      }
    }
    // livres novos aparecem
    if (m.mercado.livres.length < 10 && rng.chance(0.3)) {
      const j = novoJogador(m, rng, rng.peso(['G', 'D', 'M', 'A'], [1, 3, 3, 3]), rng.int(24, 42), rng.int(22, 34));
      m.mercado.livres.push(j.id);
    }
    if (m.mercado.livres.length > 24) m.mercado.livres = m.mercado.livres.slice(-24);
  }

  // ---------------------------------------------------------------
  // Finanças do clube (ações do treinador)
  // ---------------------------------------------------------------
  function ampliarEstadio(m, clubeId, milhares) {
    const c = m.clubes[clubeId];
    const n = clamp(Math.round(Number(milhares) || 1), 1, 20);
    if (c.lug + c.obras + n * 1000 > MAX_LUGARES) return { erro: 'O estádio não pode passar de ' + MAX_LUGARES.toLocaleString('pt-PT') + ' lugares.' };
    const custo = n * CUSTO_LUGARES;
    if (custo > c.din) return { erro: 'As obras custam ' + fmtEur(custo) + ' e tens ' + fmtEur(c.din) + '.' };
    c.din -= custo;
    c.obras += n * 1000;
    return { ok: true, custo };
  }
  function definirBilhete(m, clubeId, preco) {
    const c = m.clubes[clubeId];
    c.bil = clamp(Math.round(Number(preco) || econ(m, c.div).bilhete), 1, 250);
    return { ok: true, bil: c.bil };
  }
  function emprestimo(m, clubeId, montante) {
    const c = m.clubes[clubeId];
    const v = Math.round(Number(montante) || 0);
    if (v > 0) {
      const lim = econ(m, c.div).credito - c.emp;
      if (v > lim) return { erro: 'O banco só te empresta mais ' + fmtEur(Math.max(0, lim)) + '.' };
      c.emp += v;
      c.din += v;
    } else if (v < 0) {
      const pagar = Math.min(-v, c.emp);
      if (pagar > c.din) return { erro: 'Não tens dinheiro para pagar isso.' };
      c.emp -= pagar;
      c.din -= pagar;
    }
    return { ok: true, emp: c.emp };
  }

  // ---------------------------------------------------------------
  // Despedimentos e convites (carreira do treinador)
  // ---------------------------------------------------------------
  function verificarDespedimentos(m, rng) {
    const p = m.cal[m.passo];
    for (const id in m.clubes) {
      const c = m.clubes[id];
      if (!c.hum) continue;
      const cls = classificacao(m, c.div);
      const lugar = cls.findIndex((x) => x.id === c.id);
      const divida = c.din < -econ(m, c.div).credito * 0.6;
      const mau = c.sem >= 8 && lugar >= POR_DIV - 2 && m.tab[c.id].j >= 8;
      if (divida || mau) {
        const login = c.hum;
        const t = treinadorDe(m, login);
        t.hist.push({ e: m.epoca, ano: m.ano, cl: c.n, div: c.div, fim: 'despedido' });
        noticia(m, '🚪 ' + login + ' foi despedido do ' + c.n + (divida ? ' (dívidas a mais).' : ' (maus resultados).'), c.id);
        c.hum = null;
        c.xi = null;
        c.banco = null;
        t.clube = null;
        t.despedido = true;
        const inf = infoDiv(m, c.div);
        const maxN = PAISES[inf.p].divs.length - 1;
        t.ofertas = ofertasPara(m, inf.p, Math.min(maxN, inf.n + (rng.chance(0.5) ? 1 : 0)), 3, rng, c.id);
      }
    }
    void p;
  }
  // convites: clubes sem treinador humano de um país/divisão (nível 0 = 1.ª)
  function ofertasPara(m, pais, nivel, n, rng, excluir, outrosPaises) {
    const nivelDe = (c) => infoDiv(m, c.div).n;
    const livres = Object.values(m.clubes).filter((c) => !c.hum && c.id !== excluir);
    let lista = livres.filter((c) => (outrosPaises ? c.pais !== pais && nivelDe(c) === 0 : c.pais === pais && nivelDe(c) === nivel));
    if (lista.length < n && !outrosPaises) lista = lista.concat(livres.filter((c) => c.pais === pais && nivelDe(c) > nivel));
    lista = lista.slice();
    for (let i = lista.length - 1; i > 0; i--) {
      const k = Math.floor(rng.r() * (i + 1));
      [lista[i], lista[k]] = [lista[k], lista[i]];
    }
    return lista.slice(0, n).map((c) => c.id);
  }
  function assumirClube(m, login, clubeId) {
    const c = m.clubes[clubeId];
    if (!c) return { erro: 'Clube inválido.' };
    if (c.hum && c.hum !== login) return { erro: 'Esse clube já tem treinador.' };
    for (const id in m.clubes) if (m.clubes[id].hum === login) {
      const velho = m.clubes[id];
      velho.hum = null;
      velho.xi = null;
      velho.banco = null;
    }
    c.hum = login;
    c.auto = false;
    c.xi = null;
    c.banco = null;
    c.mor = Math.max(c.mor, 10);
    const t = treinadorDe(m, login);
    t.clube = clubeId;
    t.despedido = false;
    t.ofertas = [];
    t.desde = { e: m.epoca, ano: m.ano };
    noticia(m, '🤝 ' + login + ' é o novo treinador do ' + c.n + '.', c.id);
    return { ok: true };
  }

  // ---------------------------------------------------------------
  // Fim de época: prémios, subidas/descidas, idades, juniores
  // ---------------------------------------------------------------
  function fimDeEpoca(m, rng) {
    const tacasCamp = {};
    for (const pais in m.tacas) tacasCamp[pais] = m.tacas[pais].campeao;
    const resumo = { epoca: m.epoca, ano: m.ano, campeoes: [], sobem: [], descem: [], tacas: tacasCamp, artilheiro: null };
    const art = artilheiros(m, 1)[0];
    if (art) {
      resumo.artilheiro = { n: art.n, cl: art.cl, gol: art.gol };
      m.clubes[art.cl].din += PREMIO_ARTILHEIRO;
      noticia(m, '👟 ' + art.n + ' (' + m.clubes[art.cl].n + ') é o melhor marcador com ' + art.gol + ' golos.', art.cl);
    }
    const tabelas = m.divs.map((_, d) => classificacao(m, d));
    tabelas.forEach((cls, d) => {
      const inf = infoDiv(m, d);
      const ec = econ(m, d);
      const camp = m.clubes[cls[0].id];
      camp.din += ec.premio;
      m.clubes[cls[1].id].din += Math.round(ec.premio / 2);
      resumo.campeoes.push(camp.id);
      noticia(m, '🏆 ' + camp.n + ' é campeão da ' + nomeDiv(m, d) + '!', camp.id);
      cls.forEach((linha, lugar) => {
        const c = m.clubes[linha.id];
        if (!c.hum) return;
        const t = treinadorDe(m, c.hum);
        if (lugar === 0) {
          t.pts += [30, 15, 10, 6][inf.n] || 6;
          t.titulos.push({ e: m.epoca, ano: m.ano, t: 'Campeão ' + nomeDiv(m, d), cl: c.n });
        }
        if (inf.n > 0 && lugar < 2) t.pts += 5;
        t.hist.push({ e: m.epoca, ano: m.ano, cl: c.n, div: d, dn: nomeDiv(m, d), lugar: lugar + 1 });
        // convites: quem acaba nos 2 primeiros recebe propostas de cima;
        // o campeão da 1.ª pode ser chamado por clubes de outros países
        if (lugar < 2 && inf.n > 0) t.ofertas = ofertasPara(m, inf.p, inf.n - 1, 2, rng, c.id);
        else if (lugar === 0 && inf.n === 0 && m.paises.length > 1) t.ofertas = ofertasPara(m, inf.p, 0, 2, rng, c.id, true);
        else if (lugar === 0) t.ofertas = [];
      });
    });
    // subidas e descidas (2) dentro de cada país
    const novas = m.divs.map((ids) => ids.slice());
    for (const pais of m.paises) {
      const ds = divsDoPais(m, pais);
      for (let k = 0; k + 1 < ds.length; k++) {
        const d = ds[k];
        const d2 = ds[k + 1];
        const desce = tabelas[d].slice(-2).map((x) => x.id);
        const sobe = tabelas[d2].slice(0, 2).map((x) => x.id);
        novas[d] = novas[d].filter((id) => !desce.includes(id)).concat(sobe);
        novas[d2] = novas[d2].filter((id) => !sobe.includes(id)).concat(desce);
        resumo.sobem.push(...sobe);
        resumo.descem.push(...desce);
        for (const id of sobe) noticia(m, '⬆️ ' + m.clubes[id].n + ' sobe à ' + nomeDiv(m, d) + '.', id);
        for (const id of desce) noticia(m, '⬇️ ' + m.clubes[id].n + ' desce à ' + nomeDiv(m, d2) + '.', id);
      }
    }
    m.divs = novas;
    novas.forEach((ids, d) => ids.forEach((id) => (m.clubes[id].div = d)));
    // idades, reformas e juniores
    for (const cid in m.clubes) {
      const c = m.clubes[cid];
      for (const jid of c.pl.slice()) {
        const j = m.jog[jid];
        j.i++;
        if (j.i >= 33) j.f = Math.max(1, Math.round((j.f - rng.int(1, 4)) * 10) / 10);
        j.sal = salarioDe(j);
        j.am = 0;
        const reforma = j.i >= 37 || (j.i >= 35 && rng.chance(0.5)) || (j.i >= 33 && j.f < 25 && rng.chance(0.4));
        if (reforma && c.pl.length > MIN_PLANTEL) {
          c.pl = c.pl.filter((x) => x !== jid);
          if (Array.isArray(c.xi)) c.xi = c.xi.map((x) => (x === jid ? null : x));
          delete m.jog[jid];
          if (c.hum) noticia(m, '👴 ' + j.n + ' terminou a carreira aos ' + j.i + ' anos.', c.id);
        }
      }
      // 2 juniores por época (17-19 anos), às vezes sai um craque
      for (let k = 0; k < 2; k++) {
        if (c.pl.length >= MAX_PLANTEL) break;
        const pos = rng.peso(['G', 'D', 'M', 'A'], [1, 3, 3, 3]);
        const j = novoJogador(m, rng, pos, Math.max(8, c.nivel * 0.55), rng.int(17, 19), { craque: 0.04, pais: c.pais });
        j.cl = c.id;
        c.pl.push(j.id);
        if (c.hum) noticia(m, '🌱 Subiu dos juniores: ' + j.n + ' (' + j.p + ', força ' + Math.round(j.f) + (j.c ? ', craque!' : '') + ').', c.id);
      }
      // a IA mantém o plantel entre 20 e 26
      if (!c.hum) {
        while (c.pl.length > 24) {
          const pior = c.pl.map((x) => m.jog[x]).sort((a, b) => a.f - b.f)[0];
          c.pl = c.pl.filter((x) => x !== pior.id);
          pior.cl = null;
          m.mercado.livres.push(pior.id);
        }
        c.bil = econ(m, c.div).bilhete;
      }
      c.sem = 0;
    }
    // limpa jogadores livres a mais e órfãos
    m.mercado.livres = m.mercado.livres.filter((id) => m.jog[id]).slice(-20);
    m.mercado.leiloes = [];
    const vivos = new Set(m.mercado.livres);
    for (const cid in m.clubes) for (const jid of m.clubes[cid].pl) vivos.add(jid);
    for (const jid in m.jog) if (!vivos.has(jid)) delete m.jog[jid];

    m.historia.unshift(resumo);
    if (m.historia.length > 30) m.historia.length = 30;
    m.epoca++;
    m.ano++;
    m.fimEpoca = resumo;
    novaEpoca(m, rng);
    noticia(m, '📅 Começa a época ' + m.ano + '/' + String(m.ano + 1).slice(2) + '.');
  }

  // ---------------------------------------------------------------
  // Jogo amigável entre duas equipas soltas (Desafios)
  // equipa = { nome, cor, tat:{f,e,m,foco}, xi:[jog...], banco:[jog...], mor }
  // ---------------------------------------------------------------
  function jogoAmigavel(eqA, eqB, semente) {
    const m = { clubes: {}, jog: {}, s: semente >>> 0 || 7 };
    const prep = (eq, id) => {
      const jogs = (eq.xi || []).concat(eq.banco || []);
      jogs.forEach((j, k) => {
        const jid = id + '_' + k;
        m.jog[jid] = Object.assign({ ca: [], cp: 3, c: 0, nac: 'PT', i: 25, p: 'M', f: 30, gol: 0, golT: 0 }, j, { id: jid });
      });
      m.clubes[id] = { id, n: eq.nome, mor: clamp(Number(eq.mor) || 10, 0, 20), pl: Object.keys(m.jog).filter((k) => k.startsWith(id + '_')) };
      const tat = Object.assign({ f: '4-4-2', e: 'eq', m: 'n', foco: 'meio' }, eq.tat || {});
      if (!FORMACOES[tat.f]) tat.f = '4-4-2';
      const nxi = (eq.xi || []).length;
      return {
        tat,
        xi: Array.from({ length: posicoesDa(tat.f).length }, (_, k) => (k < nxi ? id + '_' + k : null)),
        banco: (eq.banco || []).map((_, k) => id + '_' + (nxi + k)),
      };
    };
    const ea = prep(eqA, 'A');
    const eb = prep(eqB, 'B');
    const jogo = criarJogo(m, { h: 'A', a: 'B', tipo: 'T', neutro: true }, ea, eb);
    const { rng, guardar } = rngDoMundo(m);
    while (!jogo.fim) passo(m, jogo, rng, []);
    guardar();
    const nomeDe = (jid) => (m.jog[jid] ? m.jog[jid].n : '?');
    return {
      gh: jogo.gh,
      ga: jogo.ga,
      pen: jogo.pen,
      vencedor: vencedor(jogo) === 'A' ? 'a' : 'b',
      posse: Math.round(((jogo.posse || 45) / Math.max(1, jogo.min)) * 100),
      ev: jogo.ev.map((e) => Object.assign({}, e, { n: e.j ? nomeDe(e.j) : undefined, n2: e.j2 ? nomeDe(e.j2) : undefined })),
    };
  }

  // ---------------------------------------------------------------
  // Utilitários de apresentação
  // ---------------------------------------------------------------
  function fmtEur(v) {
    const n = Math.round(Number(v) || 0);
    const a = Math.abs(n);
    let s;
    if (a >= 1e6) s = (a / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace('.', ',').replace(/,?0+$/, '') + ' M€';
    else if (a >= 1e3) s = Math.round(a / 1e3) + ' mil €';
    else s = a + ' €';
    return (n < 0 ? '−' : '') + s;
  }
  function textoEvento(m, ev, nomeClube) {
    const j = ev.j && m.jog[ev.j];
    const nome = (j && j.n) || ev.n || '?';
    switch (ev.t) {
      case 'g':
        return '⚽ GOLO! ' + nome + (ev.k === 'pen' ? ' (penálti)' : ev.k === 'cab' ? ' (de cabeça)' : '');
      case 'pen':
        return '🎯 Penálti para o ' + nomeClube + '!';
      case 'pf':
        return '❌ ' + nome + ' falha o penálti!';
      case 'am':
        return '🟨 Amarelo para ' + nome;
      case 'vm':
        return '🟥 Vermelho direto para ' + nome + '!';
      case 'va':
        return '🟨🟥 Segundo amarelo, ' + nome + ' é expulso!';
      case 'les':
        return '🚑 ' + nome + ' lesionou-se';
      case 's': {
        const j2 = ev.j2 && m.jog[ev.j2];
        return '🔄 Entra ' + nome + ', sai ' + ((j2 && j2.n) || ev.n2 || '?');
      }
      case 'pos':
        return '😱 ' + nome + ' acerta no poste!';
      case 'bar':
        return '😱 ' + nome + ' acerta na barra!';
      case 'def':
        return '🧤 Grande defesa ao remate de ' + nome;
      case 'int':
        return '⏸️ Intervalo';
      case 'gp':
        return '🥅 Penáltis: ' + ev.x;
      default:
        return '';
    }
  }

  return {
    VERSAO,
    CLUBES,
    plantelReal,
    forcaPorValor,
    NOMES_DIV,
    PAISES,
    nomeDiv,
    infoDiv,
    econ,
    divsDoPais,
    nomeRonda,
    migrar,
    DIV,
    FORMACOES,
    ESTILOS,
    MARCACOES,
    FOCOS,
    CARACT,
    COMPORTAMENTO,
    RONDAS_TACA,
    MAX_PLANTEL,
    MIN_PLANTEL,
    MAX_SUBS,
    CUSTO_LUGARES,
    JURO,
    criarRng,
    criarMundo,
    posicoesDa,
    melhorOnze,
    forcaOnze,
    escalacaoHumana,
    prepararJornada,
    correrJogos,
    passo,
    substituir,
    mudarTatica,
    concluirJornada,
    jogarJornada,
    classificacao,
    artilheiros,
    valor,
    salarioDe,
    precoPedido,
    porLeilao,
    licitar,
    comprarDireto,
    venderJa,
    dispensar,
    ampliarEstadio,
    definirBilhete,
    emprestimo,
    assumirClube,
    treinadorDe,
    ofertasPara,
    jogoAmigavel,
    vencedor,
    fmtEur,
    textoEvento,
    rngDoMundo,
  };
});
