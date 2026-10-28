import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

export type Modo = "claro" | "escuro";

export type Cores = {
  tinta: string;
  tinta2: string;
  tinta3: string;
  grade: string;
  eixo: string;
  superficie: string;
  borda: string;
  series: string[];
  positivo: string;
  negativo: string;
  neutro: string;
  sequencial: string[];
  // Degradê das barras: da base (perto do zero) para a ponta do dado. No
  // escuro a ponta é a mais clara — o dado "acende" sobre o fundo.
  azul: [string, string];
  // Mosaico (treemap): do maior bloco (mais escuro) ao menor (mais claro),
  // sempre escuro o bastante para texto branco por cima.
  mosaico: [string, string];
  // Tela estreita (celular): os construtores de gráfico mudam de FORMA, não
  // só de tamanho — rótulo sobre a barra, legenda rolável, mapa sem arrasto.
  compacto: boolean;
};

// Rampa sequencial (azul, 7 degraus validados). No escuro o "perto de zero"
// fica perto da superfície escura, então a rampa vira do escuro para o claro.
const RAMPA_AZUL = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];

const CONSULTA_COMPACTA = "(max-width: 639px)";

function lerCores(modo: Modo, compacto: boolean): Cores {
  const css = getComputedStyle(document.documentElement);
  const v = (nome: string) => css.getPropertyValue(nome).trim();
  return {
    tinta: v("--tinta"),
    tinta2: v("--tinta-2"),
    tinta3: v("--tinta-3"),
    grade: v("--grade"),
    eixo: v("--eixo"),
    superficie: v("--superficie"),
    borda: v("--borda"),
    series: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--serie-${i}`)),
    positivo: v("--positivo"),
    negativo: v("--negativo"),
    neutro: v("--neutro"),
    sequencial: modo === "escuro" ? [...RAMPA_AZUL].reverse() : RAMPA_AZUL,
    azul: modo === "escuro" ? ["#1c4a96", "#5ea2fa"] : ["#9cc6f6", "#1d5bd0"],
    mosaico: modo === "escuro" ? ["#1a4aa0", "#3f87e6"] : ["#153b80", "#4b8fe2"],
    compacto,
  };
}

type Contexto = { modo: Modo; cores: Cores; alternar: () => void };
const TemaContexto = createContext<Contexto | null>(null);

export function ProvedorTema({ children }: { children: ReactNode }) {
  const inicial = (document.documentElement.dataset.tema as Modo) || "escuro";
  const [modo, setModo] = useState<Modo>(inicial);
  const [compacto, setCompacto] = useState(() => window.matchMedia(CONSULTA_COMPACTA).matches);
  const [cores, setCores] = useState<Cores>(() => lerCores(inicial, compacto));

  useEffect(() => {
    const mq = window.matchMedia(CONSULTA_COMPACTA);
    const aoMudar = () => setCompacto(mq.matches);
    mq.addEventListener("change", aoMudar);
    return () => mq.removeEventListener("change", aoMudar);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.tema = modo;
    try {
      localStorage.setItem("tema", modo);
    } catch {
      /* sem armazenamento (aba anônima): o tema só não é lembrado */
    }
    setCores(lerCores(modo, compacto));
  }, [modo, compacto]);

  const alternar = useCallback(() => setModo((m) => (m === "escuro" ? "claro" : "escuro")), []);
  return <TemaContexto.Provider value={{ modo, cores, alternar }}>{children}</TemaContexto.Provider>;
}

export function useTema(): Contexto {
  const ctx = useContext(TemaContexto);
  if (!ctx) throw new Error("useTema fora do ProvedorTema");
  return ctx;
}
