import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { literal } from "./sql";
import { gravarParametro, lerParametro } from "./url";

/*
 * Filtro de território que vale para todas as seções do site: escolher estados
 * numa seção recorta as outras. Vazio = Brasil. Mora no endereço (?uf=PR,SC).
 */

export const REGIOES = {
  Norte: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
  Nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MS", "MT"],
  Sudeste: ["ES", "MG", "RJ", "SP"],
  Sul: ["PR", "RS", "SC"],
} as const;
export type Regiao = keyof typeof REGIOES;

export const UFS: string[] = Object.values(REGIOES).flat().sort();

export const NOMES_UF: Record<string, string> = {
  AC: "Acre", AL: "Alagoas", AM: "Amazonas", AP: "Amapá", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal",
  ES: "Espírito Santo", GO: "Goiás", MA: "Maranhão", MG: "Minas Gerais", MS: "Mato Grosso do Sul", MT: "Mato Grosso",
  PA: "Pará", PB: "Paraíba", PE: "Pernambuco", PI: "Piauí", PR: "Paraná", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte",
  RO: "Rondônia", RR: "Roraima", RS: "Rio Grande do Sul", SC: "Santa Catarina", SE: "Sergipe", SP: "São Paulo", TO: "Tocantins",
};

const mesmas = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((u) => b.includes(u));

/** Nome curto do recorte, para o botão e os subtítulos. */
export function rotuloTerritorio(ufs: string[]): string {
  if (!ufs.length || ufs.length === UFS.length) return "Brasil";
  if (mesmas(ufs, UFS.filter((u) => u !== "SP"))) return "Brasil sem SP";
  const regiao = (Object.keys(REGIOES) as Regiao[]).find((r) => mesmas(ufs, REGIOES[r]));
  if (regiao) return regiao;
  if (ufs.length <= 3) return ufs.join(", ");
  return `${ufs.length} estados`;
}

type Filtro = {
  ufs: string[];
  ativo: boolean;
  rotulo: string;
  definir: (ufs: string[]) => void;
  /** Condição SQL sobre a coluna de UF; "TRUE" quando é o Brasil inteiro. */
  sql: (coluna?: string) => string;
};

const Contexto = createContext<Filtro | null>(null);

function normalizar(ufs: string[]): string[] {
  const validas = [...new Set(ufs)].filter((u) => UFS.includes(u)).sort();
  // Todas marcadas é o mesmo que nenhuma: guarda vazio, para "ativo" ser falso.
  return validas.length === UFS.length ? [] : validas;
}

export function ProvedorFiltro({ children }: { children: ReactNode }) {
  const [ufs, setUfs] = useState<string[]>(() => normalizar((lerParametro("uf") ?? "").split(",")));
  useEffect(() => gravarParametro("uf", ufs.length ? ufs.join(",") : null), [ufs]);
  const valor = useMemo<Filtro>(
    () => ({
      ufs,
      ativo: ufs.length > 0,
      rotulo: rotuloTerritorio(ufs),
      definir: (novas) => setUfs(normalizar(novas)),
      sql: (coluna = "uf") => (ufs.length ? `${coluna} IN (${ufs.map(literal).join(", ")})` : "TRUE"),
    }),
    [ufs],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

/** O filtro, ou null fora de uma página com filtro (para componentes que só o leem se houver). */
export function useFiltroOpcional(): Filtro | null {
  return useContext(Contexto);
}

export function useFiltro(): Filtro {
  const f = useContext(Contexto);
  if (!f) throw new Error("useFiltro fora do ProvedorFiltro");
  return f;
}
