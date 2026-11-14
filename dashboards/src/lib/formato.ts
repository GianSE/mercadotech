const inteiro = new Intl.NumberFormat("pt-BR");
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sm = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt = {
  inteiro: (n: number) => inteiro.format(Math.round(n)),
  compacto: (n: number) => compacto.format(n),
  /** 0.0423 -> "+4,2%" */
  variacao: (v: number) => `${v > 0 ? "+" : ""}${decimal.format(v * 100)}%`,
  /** 0.39 -> "39,0%" */
  parte: (v: number) => `${decimal.format(v * 100)}%`,
  sm: (n: number) => `${sm.format(n)} SM`,
  /** saldo: 12345 -> "+12.345" */
  sinal: (n: number) => `${n > 0 ? "+" : ""}${inteiro.format(Math.round(n))}`,
  /** 4.23 (já em %) -> "+4,2%" */
  pontos: (v: number, casas = 1) =>
    `${v > 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`,
  data: (d: Date) => d.toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" }),
  /** 2.62 -> "×2,6" */
  multiplo: (v: number) => `×${decimal.format(v)}`,
  /** "agosto de 2026" ou "ago. de 2026"; em UTC, como as competências do CAGED */
  mes: (d: Date, estilo: "long" | "short" = "long") => d.toLocaleDateString("pt-BR", { month: estilo, year: "numeric", timeZone: "UTC" }),
};
