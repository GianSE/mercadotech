import { BarChart, LineChart, ScatterChart, SunburstChart } from "echarts/charts";
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef, useState } from "react";
import { useTema } from "../lib/tema";

echarts.use([
  LineChart, BarChart, ScatterChart, SunburstChart,
  GridComponent, LegendComponent, MarkLineComponent, TooltipComponent,
  CanvasRenderer,
]);

/** As cores do gráfico, lidas das variáveis CSS do tema na hora de desenhar. */
export type Tinta = {
  series: string[];
  /** rampa sequencial de um tom só, do menor ao maior valor (mais contraste com o fundo = mais) */
  sequencial: string[];
  texto: string;
  rotulo: string;
  grade: string;
  eixo: string;
  fundo: string;
  /** admissões e saldo positivo */
  sobe: string;
  /** desligamentos e saldo negativo */
  desce: string;
};

export function lerTinta(): Tinta {
  const css = getComputedStyle(document.documentElement);
  const v = (nome: string) => css.getPropertyValue(nome).trim();
  return {
    // Sete cores validadas para daltonismo nos dois temas: uma por subárea, sem repetir.
    series: [1, 2, 3, 4, 5, 6, 7].map((i) => v(`--chart-${i}`)),
    // Rampa azul (o azul da marca), validada como ordinal contra o cartão de
    // cada tema: o degrau mais fraco ainda se destaca do fundo (>= 2:1). No
    // escuro ela se inverte: o maior valor é o que mais se destaca do
    // marinho, e no escuro isso é o mais claro.
    sequencial: document.documentElement.classList.contains("dark")
      ? ["#1d5aa8", "#2f74c8", "#4d93e3", "#8dbcf0", "#cde2fb"]
      : ["#80ade6", "#5490dc", "#3676c8", "#1f5ca5", "#0e3f7a"],
    texto: v("--foreground"),
    rotulo: v("--chart-rotulo"),
    grade: v("--chart-grade"),
    eixo: v("--chart-eixo"),
    fundo: v("--card"),
    sobe: v("--sobe"),
    desce: v("--desce"),
  };
}

/** Quem pede menos movimento no sistema vê o gráfico pronto, sem animação. */
const poucoMovimento = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A entrada desenha o gráfico: a linha da esquerda para a direita, as barras
 * crescendo do eixo, os anéis abrindo. Trocar um filtro anima a passagem de
 * um estado ao outro, mais curta.
 */
export function animacao() {
  return {
    animation: !poucoMovimento(),
    animationDuration: 1100,
    animationEasing: "cubicOut",
    animationDurationUpdate: 450,
    animationEasingUpdate: "cubicOut",
  } as const;
}

/** O que todo gráfico do site compartilha: fonte, eixos discretos, tooltip no tema, animação de entrada. */
export function base(t: Tinta): EChartsCoreOption {
  return {
    color: t.series,
    ...animacao(),
    textStyle: { fontFamily: "inherit", color: t.texto },
    grid: { left: 8, right: 16, top: 40, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: t.fundo,
      borderColor: t.grade,
      textStyle: { color: t.texto },
      confine: true,
    },
    legend: { top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 8, textStyle: { color: t.texto } },
  };
}

export function eixo(t: Tinta, extra: Record<string, unknown> = {}) {
  return {
    axisLine: { lineStyle: { color: t.eixo } },
    axisTick: { show: false },
    axisLabel: { color: t.rotulo },
    splitLine: { lineStyle: { color: t.grade } },
    ...extra,
  };
}

const COR_DA_SERIE = ["bg-chart-1", "bg-chart-2", "bg-chart-3"];

/**
 * Legenda em HTML, fora do canvas: quebra linha sozinha em tela estreita, onde
 * a do ECharts passava por cima do gráfico. A ordem é a das séries.
 */
export function Legenda({ nomes }: { nomes: string[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {nomes.map((n, i) => (
        <li key={n} className="flex items-center gap-1.5">
          <span className={`h-2 w-3 shrink-0 rounded-sm ${COR_DA_SERIE[i]}`} aria-hidden />
          {n}
        </li>
      ))}
    </ul>
  );
}

type Props = {
  /** Recebe as cores do tema atual: ao trocar de tema, o gráfico é redesenhado. */
  opcao: (t: Tinta) => EChartsCoreOption;
  altura?: number;
  rotulo: string;
  /** Clique numa marca (fatia, ponto, linha): a página decide o que acontece. */
  aoClicar?: (p: { name?: string; seriesName?: string; data?: unknown }) => void;
};

export function Grafico({ opcao, altura = 300, rotulo, aoClicar }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const grafico = useRef<echarts.ECharts | null>(null);
  const { tema } = useTema();
  // Só desenha quando o gráfico entra na tela: a animação de entrada acontece
  // à vista, e não antes, com o gráfico ainda lá embaixo na página.
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (!ref.current) return;
    const g = echarts.init(ref.current, undefined, { renderer: "canvas" });
    grafico.current = g;
    const observador = new ResizeObserver(() => g.resize());
    observador.observe(ref.current);
    const vista = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) {
          setVisivel(true);
          vista.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    vista.observe(ref.current);
    return () => {
      observador.disconnect();
      vista.disconnect();
      g.dispose();
      grafico.current = null;
    };
  }, []);

  useEffect(() => {
    if (visivel) grafico.current?.setOption(opcao(lerTinta()), { notMerge: true });
  }, [opcao, tema, visivel]);

  useEffect(() => {
    const g = grafico.current;
    if (!g || !aoClicar) return;
    g.on("click", aoClicar);
    return () => {
      g.off("click", aoClicar);
    };
  }, [aoClicar]);

  return <div ref={ref} role="img" aria-label={rotulo} style={{ height: altura }} className="w-full" />;
}
