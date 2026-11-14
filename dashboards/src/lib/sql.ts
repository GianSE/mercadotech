import type { LinhaSQL } from "./db";

/*
 * Pedaços de SQL que as seções repetem, vindos do site do TCC. As colunas
 * setor_da_area e ocupacao_da_area são setor_ti e ocupacao_ti da Gold, com o
 * nome genérico das páginas do mercadobrasil (ver RENOMEAR em lib/dados.ts).
 */

/** O recorte da área na RAIS: a união das duas lentes, como no CAGED. */
export const RECORTE = "(setor_da_area OR ocupacao_da_area)";

export type Periodo = readonly [number, number];

/**
 * Série anual da RAIS: a tabela nacional quando não há filtro de território,
 * a tabela por UF quando há. O estoque soma igual nas duas.
 */
export const tabelaRais = (filtrada: boolean) => (filtrada ? "rais_estoque_uf" : "rais_estoque_anual");

export const entre = (p: Periodo, coluna = "ano") => `${coluna} BETWEEN ${p[0]} AND ${p[1]}`;

export const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const num = (l: LinhaSQL | undefined, chave: string): number => Number(l?.[chave] ?? NaN);

export const coluna = (linhas: LinhaSQL[], chave: string) => linhas.map((l) => (l[chave] === null ? null : Number(l[chave])));

export const rotulos = (linhas: LinhaSQL[], chave: string) => linhas.map((l) => String(l[chave] ?? "—"));

export const intervalo = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);

/**
 * Média de grupos de tamanhos diferentes tem que ser PONDERADA pelo estoque:
 * a média das médias daria o mesmo peso a São Paulo e ao Acre.
 */
export const ponderada = (col: string, peso = "estoque_3112") => `sum(${peso} * ${col}) / nullif(sum(${peso}), 0)`;

/** Mediana exata (rais_mediana), para quando não há filtro de território. */
export const medianaExata = (recorte: string, extra = "TRUE") =>
  `SELECT ano, grupo, mediana_sm AS mediana FROM rais_mediana WHERE recorte = '${recorte}' AND ${extra}`;

/**
 * Mediana da remuneração (SM) de qualquer recorte, pelo histograma da gold
 * (faixas de 0,1 SM): acha a faixa que contém o meio e interpola dentro dela.
 * Erro máximo de 0,05 SM. Devolve (g, mediana), um por valor de `grupo`.
 */
export const medianaHist = (onde: string, grupo = "ano") => `
  WITH h AS (SELECT ${grupo} AS g, faixa, sum(vinculos) AS n FROM rais_remuneracao_hist WHERE ${onde} GROUP BY 1, 2),
       c AS (SELECT g, faixa, n, sum(n) OVER (PARTITION BY g ORDER BY faixa) AS acum, sum(n) OVER (PARTITION BY g) AS total FROM h)
  SELECT g, min_by((faixa + (total / 2.0 - (acum - n)) / n) * 0.1, faixa) AS mediana FROM c WHERE acum >= total / 2.0 GROUP BY g`;
