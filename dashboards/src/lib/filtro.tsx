// Filtro de território que vale para o site inteiro: escolher estados numa
// página (ou clicar num estado do mapa) recorta todas as outras. Vazio = Brasil.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { literal } from "./sql";
import { gravarParametro, partesHash } from "./url";

export const REGIOES = {
  Norte: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"],
  Nordeste: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"],
  "Centro-Oeste": ["DF", "GO", "MS", "MT"],
  Sudeste: ["ES", "MG", "RJ", "SP"],
  Sul: ["PR", "RS", "SC"],
} as const;
export type Regiao = keyof typeof REGIOES;

export const UFS: string[] = Object.values(REGIOES).flat().sort();
export const SEM_SP = UFS.filter((u) => u !== "SP");

const mesmas = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((u) => b.includes(u));

// Nome curto do recorte, para o botão e para os subtítulos.
export function rotuloTerritorio(ufs: string[]): string {
  if (!ufs.length || ufs.length === UFS.length) return "Brasil";
  if (mesmas(ufs, SEM_SP)) return "Brasil sem SP";
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
  alternar: (uf: string) => void;
  limpar: () => void;
  // Condição SQL sobre a coluna de UF; "TRUE" quando é o Brasil inteiro.
  sql: (coluna?: string) => string;
};

const Contexto = createContext<Filtro | null>(null);

function lerUfs(texto: string): string[] {
  const lidas = texto.split(",").filter((u) => UFS.includes(u));
  return lidas.length === UFS.length ? [] : [...new Set(lidas)].sort();
}

export function ProvedorFiltro({ children }: { children: ReactNode }) {
  // O recorte começa pelo que vier no link (?uf=PR,SC) e volta para ele a
  // cada mudança, para o endereço sempre reproduzir o que está na tela.
  const [ufs, setUfs] = useState<string[]>(() => lerUfs(partesHash().params.get("uf") ?? ""));
  const atuais = useRef(ufs);
  atuais.current = ufs;
  useEffect(() => {
    gravarParametro("uf", ufs.length ? ufs.join(",") : null);
  }, [ufs]);
  // Os links entre páginas (#/onde) não carregam o recorte; ele continua
  // valendo, então volta para o endereço da página nova. Um link que traz o
  // seu próprio ?uf= (colado com o painel aberto) troca o recorte.
  useEffect(() => {
    const aoMudar = () => {
      const doLink = partesHash().params.get("uf");
      if (doLink !== null) {
        const lidas = lerUfs(doLink);
        if (lidas.join(",") !== atuais.current.join(",")) setUfs(lidas);
      } else if (atuais.current.length) gravarParametro("uf", atuais.current.join(","));
    };
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  // Todas marcadas é o mesmo que nenhuma: guarda vazio, para "ativo" ser falso.
  const definir = useCallback((novas: string[]) => {
    const validas = [...new Set(novas)].filter((u) => UFS.includes(u)).sort();
    setUfs(validas.length === UFS.length ? [] : validas);
  }, []);
  const alternar = useCallback(
    (uf: string) => {
      if (!UFS.includes(uf)) return;
      setUfs((atual) => {
        const novas = atual.includes(uf) ? atual.filter((u) => u !== uf) : [...atual, uf].sort();
        return novas.length === UFS.length ? [] : novas;
      });
    },
    [],
  );
  const limpar = useCallback(() => setUfs([]), []);

  const valor = useMemo<Filtro>(
    () => ({
      ufs,
      ativo: ufs.length > 0,
      rotulo: rotuloTerritorio(ufs),
      definir,
      alternar,
      limpar,
      sql: (coluna = "uf") => (ufs.length ? `${coluna} IN (${ufs.map(literal).join(", ")})` : "TRUE"),
    }),
    [ufs, definir, alternar, limpar],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useFiltro(): Filtro {
  const f = useContext(Contexto);
  if (!f) throw new Error("useFiltro fora do ProvedorFiltro");
  return f;
}
