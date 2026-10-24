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

export const entre = (p: Periodo, coluna = "ano") => `${coluna} BETWEEN ${p[0]} AND ${p[1]}`;

export const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

export const num = (l: Linha | undefined, chave: string): number => Number(l?.[chave] ?? NaN);

export const coluna = (linhas: Linha[], chave: string) => linhas.map((l) => (l[chave] === null ? null : Number(l[chave])));
export const rotulos = (linhas: Linha[], chave: string) => linhas.map((l) => String(l[chave] ?? "—"));

export const intervalo = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, i) => min + i);
