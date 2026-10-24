import type { Linha } from "./db";
import type { Periodo } from "../componentes/ui";

// Recorte de TI da RAIS: a união das duas lentes, como no CAGED.
export const TI = "(setor_ti OR ocupacao_ti)";

// Média de grupos de tamanhos diferentes tem que ser PONDERADA pelo estoque —
// a média das médias daria o mesmo peso a São Paulo e ao Acre.
export const ponderada = (coluna: string, peso = "estoque_3112") =>
  `sum(${peso} * ${coluna}) / nullif(sum(${peso}), 0)`;

// Série anual da RAIS: a tabela nacional quando não há filtro de território
// (é a que o TCC usa), a tabela por UF quando há. O estoque soma igual nas
// duas; a remuneração mediana não — mediana não se soma, e a média ponderada
// das medianas muda com a granularidade dos grupos.
export const tabelaRais = (filtrada: boolean) => (filtrada ? "rais_estoque_uf" : "rais_estoque_anual");

// Mediana da remuneração (SM) de qualquer recorte, pelo histograma da Gold
// (faixas de 0,1 SM): soma as faixas do recorte, acha a faixa que contém o
// meio e interpola dentro dela. Erro máximo de 0,05 SM — a média das
// medianas dos grupos, que isto substitui, não tem limite de erro nenhum.
// Devolve (g, mediana), um por valor de `grupo`.
export const medianaHist = (onde: string, grupo = "ano") => `
  WITH h AS (SELECT ${grupo} AS g, faixa, sum(vinculos) AS n FROM rais_remuneracao_hist WHERE ${onde} GROUP BY 1, 2),
       c AS (SELECT g, faixa, n, sum(n) OVER (PARTITION BY g ORDER BY faixa) AS acum, sum(n) OVER (PARTITION BY g) AS total FROM h)
  SELECT g, min_by((faixa + (total / 2.0 - (acum - n)) / n) * 0.1, faixa) AS mediana FROM c WHERE acum >= total / 2.0 GROUP BY g`;

// Mediana exata (rais_mediana), para quando não há filtro de território:
// é o mesmo número das tabelas do TCC.
export const medianaExata = (recorte: string, extra = "TRUE") =>
  `SELECT ano, grupo, mediana_sm AS mediana FROM rais_mediana WHERE recorte = '${recorte}' AND ${extra}`;

export const entre = (p: Periodo, coluna = "ano") => `${coluna} BETWEEN ${p[0]} AND ${p[1]}`;

export const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const num = (l: Linha | undefined, chave: string): number => Number(l?.[chave] ?? NaN);

export const coluna = (linhas: Linha[], chave: string) => linhas.map((l) => (l[chave] === null ? null : Number(l[chave])));
export const rotulos = (linhas: Linha[], chave: string) => linhas.map((l) => String(l[chave] ?? "—"));

export const intervalo = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
