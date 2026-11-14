import type { EChartsCoreOption } from "echarts/core";
import { animacao, base, eixo, type Tinta } from "../components/Grafico";
import { fmt } from "./formato";

/*
 * Os gráficos das seções, a partir dos do site do TCC (dashboards/src/lib/
 * graficos.ts), com as cores do tema novo. A paleta validada tem sete cores:
 * da oitava série em diante, cinza com o nome no fim da linha, em vez de uma
 * cor nova que se confundiria com outra.
 */

export type Formato = (v: number) => string;

/**
 * Preenchimento de barra em degradê: a cor cheia na ponta (o valor) e mais
 * clara, misturada com o fundo do cartão, junto do eixo. A identidade da
 * série continua sendo a cor da ponta. `sentido` é para onde a barra cresce.
 */
export function degrade(cor: string, fundo: string, sentido: "cima" | "baixo" | "direita") {
  const junto = misturar(cor, fundo, 0.42); // a cor junto do eixo
  const [x2, y2] = sentido === "direita" ? [1, 0] : [0, 1];
  const [inicio, fim] = sentido === "cima" ? [cor, junto] : [junto, cor];
  return { type: "linear", x: 0, y: 0, x2, y2, colorStops: [{ offset: 0, color: inicio }, { offset: 1, color: fim }] };
}

/** Área sob uma linha: a cor da série no alto, sumindo até o eixo. */
export function areaDegrade(cor: string, forca = 0.28) {
  const rgba = (a: number) => `rgba(${[1, 3, 5].map((i) => parseInt(cor.slice(i, i + 2), 16)).join(",")},${a})`;
  return { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: rgba(forca) }, { offset: 1, color: rgba(0.02) }] } };
}

/** As barras sobem em cascata, da primeira à última, sem a entrada passar de ~0,7 s. */
export const cascata = (n: number) => (i: number) => Math.round((i * Math.min(18, 700 / Math.max(n, 1))));

export type SerieLinha = { nome: string; dados: (number | null)[]; area?: boolean; cinza?: boolean };

type Ponto = { seriesName?: string; value: unknown; color?: unknown; axisValueLabel?: string; dataIndex: number };

function tooltipEixo(t: Tinta, formato: Formato, extra?: (i: number) => string) {
  return {
    ...(base(t).tooltip as object),
    trigger: "axis",
    axisPointer: { type: "line", lineStyle: { color: t.eixo } },
    formatter: (params: unknown) => {
      const lista = (Array.isArray(params) ? params : [params]) as Ponto[];
      if (!lista.length) return "";
      const linhas = lista
        .filter((p) => p.seriesName && Number.isFinite(Number(p.value)))
        .map(
          (p) =>
            `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="width:10px;height:3px;border-radius:2px;background:${String(p.color)}"></span><b>${formato(Number(p.value))}</b><span style="opacity:.7">${p.seriesName}</span></div>`,
        )
        .join("");
      return `<div style="font-size:11px;opacity:.7">${lista[0].axisValueLabel ?? ""}</div>${linhas}${extra ? extra(lista[0].dataIndex) : ""}`;
    },
  };
}

/**
 * Rótulos no fim de linhas que terminam perto um do outro se sobrepõem. Cada
 * rótulo que ficaria a menos de 13 px do vizinho de baixo sobe o que falta.
 * `altura` é a área útil do gráfico, aproximada. Devolve o deslocamento
 * vertical (negativo = para cima) por série. (Do site do TCC.)
 */
function afastarRotulos(series: SerieLinha[], altura: number, zero?: boolean): number[] {
  const ultimo = (d: (number | null)[]) => [...d].reverse().find((v) => v !== null && Number.isFinite(v)) ?? null;
  const todos = series.flatMap((s) => s.dados).filter((v): v is number => v !== null && Number.isFinite(v));
  if (!todos.length) return [];
  const [min, max] = [zero ? Math.min(0, ...todos) : Math.min(...todos), Math.max(...todos)];
  const pxPorUnidade = altura / (max - min || 1);
  const pontos = series
    .map((s, i) => ({ i, v: ultimo(s.dados) }))
    .filter((p): p is { i: number; v: number } => p.v !== null)
    .map((p) => ({ i: p.i, y: (p.v - min) * pxPorUnidade, pos: (p.v - min) * pxPorUnidade }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < pontos.length; k++) pontos[k].pos = Math.max(pontos[k].pos, pontos[k - 1].pos + 13);
  const saida: number[] = [];
  for (const p of pontos) saida[p.i] = -(p.pos - p.y);
  return saida;
}

export function opcaoLinhas(
  t: Tinta,
  x: (string | number)[],
  series: SerieLinha[],
  o: { formato?: Formato; formatoEixo?: Formato; zero?: boolean; rotuloFinal?: boolean; altura?: number } = {},
): EChartsCoreOption {
  const formato = o.formato ?? fmt.inteiro;
  const formatoEixo = o.formatoEixo ?? fmt.compacto;
  // Área útil: a altura do cartão menos o eixo de baixo e a margem de cima.
  const deslocamento = o.rotuloFinal ? afastarRotulos(series, (o.altura ?? 300) - 50, o.zero) : [];
  // Espaço para o nome no fim da linha, pelo nome mais longo (cerca de 6 px
  // por letra), com teto: o que passar dele termina em reticências.
  const margem = o.rotuloFinal ? Math.min(170, Math.max(48, 6 * Math.max(...series.map((s) => s.nome.length)) + 12)) : 16;
  let cor = 0;
  return {
    ...base(t),
    legend: { show: false },
    grid: { left: 8, right: margem, top: 12, bottom: 8, containLabel: true },
    tooltip: tooltipEixo(t, formato),
    xAxis: eixo(t, { type: "category", data: x, boundaryGap: false, splitLine: { show: false }, axisLabel: { color: t.rotulo, hideOverlap: true } }),
    yAxis: eixo(t, { type: "value", scale: !o.zero, axisLabel: { color: t.rotulo, formatter: (v: number) => formatoEixo(v) } }),
    series: series.map((s, i) => {
      const c = s.cinza ? t.rotulo : t.series[cor++ % t.series.length];
      return {
        type: "line",
        name: s.nome,
        data: s.dados,
        showSymbol: false,
        symbolSize: 8,
        connectNulls: false,
        lineStyle: { width: s.cinza ? 1.5 : 2, color: c },
        itemStyle: { color: c, borderColor: t.fundo, borderWidth: 2 },
        areaStyle: s.area ? areaDegrade(c) : undefined,
        endLabel: o.rotuloFinal
          ? { show: true, color: t.texto, fontSize: 11, offset: [0, deslocamento[i] ?? 0], width: margem - 10, overflow: "truncate", formatter: () => s.nome }
          : undefined,
        emphasis: { focus: "series" },
      };
    }),
  };
}

export type SerieFluxo = "admissoes" | "desligamentos" | "saldo";

/**
 * Admissões para cima, em verde, desligamentos para baixo, em vermelho (o
 * sinal é só desenho: no tooltip o desligamento aparece positivo), e o saldo
 * como linha por cima.
 */
export function opcaoFluxo(
  t: Tinta,
  x: string[],
  d: Record<SerieFluxo, (number | null)[]>,
  o: { visiveis: SerieFluxo[]; esmaecer?: number[] },
): EChartsCoreOption {
  const muitos = x.length > 40;
  const corDe: Record<string, string> = { Admissões: t.sobe, Desligamentos: t.desce, Saldo: t.texto };
  const barra = (nome: string, dados: (number | null)[], cor: string, sentido: "cima" | "baixo") => ({
    type: "bar",
    name: nome,
    stack: "fluxo",
    data: dados.map((v, i) => ({ value: v, itemStyle: { opacity: o.esmaecer?.includes(i) ? 0.45 : 1 } })),
    itemStyle: {
      color: degrade(cor, t.fundo, sentido),
      borderColor: t.fundo,
      borderWidth: muitos ? 0 : 1,
      // A ponta arredondada é a do valor, longe do eixo.
      borderRadius: muitos ? 0 : sentido === "cima" ? [4, 4, 0, 0] : [0, 0, 4, 4],
    },
    barMaxWidth: 34,
    barCategoryGap: muitos ? "12%" : "30%",
    animationDelay: cascata(x.length),
  });
  const series = [
    o.visiveis.includes("admissoes") && barra("Admissões", d.admissoes, t.sobe, "cima"),
    o.visiveis.includes("desligamentos") && barra("Desligamentos", d.desligamentos.map((v) => (v === null ? null : -v)), t.desce, "baixo"),
    o.visiveis.includes("saldo") && {
      type: "line",
      name: "Saldo",
      data: d.saldo,
      showSymbol: !muitos,
      symbolSize: muitos ? 4 : 7,
      lineStyle: { width: 2, color: t.texto },
      itemStyle: { color: t.texto, borderColor: t.fundo, borderWidth: 2 },
      z: 5,
    },
  ].filter(Boolean);
  return {
    ...base(t),
    legend: { show: false },
    grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      ...(base(t).tooltip as object),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: t.grade, opacity: 0.5 } },
      formatter: (params: unknown) => {
        const lista = params as Ponto[];
        if (!lista.length) return "";
        const linhas = lista
          .map((p) => {
            const valor = (p.value as { value?: number } | number | null) ?? null;
            const v = typeof valor === "object" && valor !== null ? (valor.value ?? null) : valor;
            if (v === null || !Number.isFinite(v)) return "";
            const texto = p.seriesName === "Desligamentos" ? fmt.inteiro(-v) : p.seriesName === "Saldo" ? fmt.sinal(v) : fmt.inteiro(v);
            // A cor pelo nome da série: a das barras é um degradê, não uma cor só.
            return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="width:10px;height:3px;border-radius:2px;background:${corDe[p.seriesName ?? ""] ?? t.texto}"></span><b>${texto}</b><span style="opacity:.7">${p.seriesName}</span></div>`;
          })
          .join("");
        return `<div style="font-size:11px;opacity:.7">${lista[0].axisValueLabel ?? ""}</div>${linhas}`;
      },
    },
    xAxis: eixo(t, { type: "category", data: x, splitLine: { show: false }, axisLine: { onZero: false, lineStyle: { color: t.eixo } }, axisLabel: { color: t.rotulo, hideOverlap: true } }),
    yAxis: eixo(t, { type: "value", axisLabel: { color: t.rotulo, formatter: (v: number) => fmt.compacto(Math.abs(v)) } }),
    series,
  };
}

/** Ranking em barras horizontais, do maior para o menor (a ordem é a dos dados), com o valor na ponta. */
export function opcaoBarrasH(
  t: Tinta,
  categorias: string[],
  valores: (number | null)[],
  o: {
    formato?: Formato;
    formatoTooltip?: Formato;
    nome?: string;
    cor?: string;
    /** uma cor por barra, quando as categorias são entidades com cor própria (as subáreas) */
    cores?: string[];
    /** as categorias em destaque: elas na cor, as outras apagadas (ênfase) */
    destaque?: string[];
    /** a página trata o clique numa barra (mostra o cursor de mão) */
    clicavel?: boolean;
    larguraRotulo?: number;
  } = {},
): EChartsCoreOption {
  const formato = o.formato ?? fmt.compacto;
  const formatoTooltip = o.formatoTooltip ?? formato;
  const corBase = o.cor ?? t.series[0];
  const apagada = misturar(t.rotulo, t.fundo, 0.55);
  const comDestaque = !!o.destaque?.length;
  const corDa = (i: number) => (comDestaque && !o.destaque!.includes(categorias[i]) ? apagada : (o.cores?.[i] ?? corBase));
  return {
    ...base(t),
    legend: { show: false },
    grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      ...(base(t).tooltip as object),
      trigger: "item",
      // O marcador padrão leria a cor do degradê; aqui vai a cor da série.
      formatter: (p: { name: string; value: number; dataIndex: number }) =>
        `<div style="display:flex;align-items:center;gap:6px"><span style="width:10px;height:10px;border-radius:2px;background:${corDa(p.dataIndex)}"></span><b>${p.name}</b></div><div style="margin-top:2px">${Number.isFinite(p.value) ? formatoTooltip(p.value) : "—"}</div>`,
    },
    xAxis: eixo(t, { type: "value", axisLabel: { show: false }, splitLine: { show: false } }),
    yAxis: eixo(t, {
      type: "category",
      data: categorias,
      inverse: true,
      axisLine: { show: false },
      axisLabel: { color: t.texto, width: o.larguraRotulo ?? 170, overflow: "truncate" },
    }),
    series: [
      {
        type: "bar",
        name: o.nome ?? "valor",
        data: valores.map((v, i) => ({ value: v, itemStyle: { color: degrade(corDa(i), t.fundo, "direita") } })),
        itemStyle: { borderRadius: [0, 4, 4, 0] },
        // O cursor de mão só quando a página trata o clique (ver Grafico.aoClicar).
        cursor: o.clicavel ? "pointer" : "default",
        barMaxWidth: 20,
        animationDelay: cascata(valores.length),
        label: { show: true, position: "right", color: t.rotulo, formatter: (p: { value: number }) => formato(p.value) },
      },
    ],
  };
}

/** Saldo observado e projetado, com a faixa de 80% da projeção como área. */
export function opcaoPrevisao(
  t: Tinta,
  meses: string[],
  observado: (number | null)[],
  previsto: (number | null)[],
  inferior: (number | null)[],
  superior: (number | null)[],
): EChartsCoreOption {
  const largura = superior.map((s, i) => (s === null || inferior[i] === null ? null : s - inferior[i]!));
  return {
    ...base(t),
    legend: { show: false },
    grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
    tooltip: {
      ...(base(t).tooltip as object),
      trigger: "axis",
      formatter: (params: unknown) => {
        const lista = params as Ponto[];
        const i = lista[0]?.dataIndex ?? 0;
        const linhas = [
          observado[i] !== null && `Observado: <b>${fmt.sinal(observado[i]!)}</b>`,
          previsto[i] !== null && observado[i] === null && `Previsto: <b>${fmt.sinal(previsto[i]!)}</b>`,
          inferior[i] !== null && `Faixa de 80%: ${fmt.sinal(inferior[i]!)} a ${fmt.sinal(superior[i]!)}`,
        ].filter(Boolean);
        return `<div style="font-size:11px;opacity:.7">${meses[i]}</div>${linhas.join("<br/>")}`;
      },
    },
    xAxis: eixo(t, { type: "category", data: meses, boundaryGap: false, splitLine: { show: false }, axisLabel: { color: t.rotulo, hideOverlap: true } }),
    yAxis: eixo(t, { type: "value", axisLabel: { color: t.rotulo, formatter: (v: number) => fmt.compacto(v) } }),
    series: [
      // A faixa: a base invisível no limite inferior e a largura empilhada por
      // cima. stackStrategy "all": no padrão ("samesign") o ECharts empilha
      // negativo e positivo em separado, e com o limite inferior abaixo de zero
      // a faixa passava a começar no zero, escondendo justamente que ela cruza o zero.
      { type: "line", name: "_base", data: inferior, stack: "faixa", stackStrategy: "all", lineStyle: { opacity: 0 }, showSymbol: false, silent: true },
      { type: "line", name: "Faixa de 80%", data: largura, stack: "faixa", stackStrategy: "all", lineStyle: { opacity: 0 }, areaStyle: { color: t.series[0], opacity: 0.18 }, showSymbol: false, silent: true },
      { type: "line", name: "Observado", data: observado, showSymbol: false, lineStyle: { width: 2, color: t.texto }, itemStyle: { color: t.texto } },
      { type: "line", name: "Previsto", data: previsto, showSymbol: false, lineStyle: { width: 2, color: t.series[0], type: "dashed" }, itemStyle: { color: t.series[0] } },
    ],
  };
}

// Mistura uma cor da paleta com o fundo do cartão: os anéis de dentro para
// fora ficam no mesmo tom da subárea, cada vez mais claros (ou escuros, no
// tema escuro), e a identidade continua sendo a do anel interno.
function misturar(a: string, b: string, t: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

export type NoAnel = { id: string; nome: string; codigo?: string; valor: number; filhos?: NoAnel[] };

/**
 * Os anéis da hierarquia (sunburst): o primeiro nível no centro, as folhas na
 * borda. A cor é a do nó do primeiro nível, na ordem fixa da paleta; os filhos
 * herdam o tom, misturado com o fundo. O clique é da página (nodeClick
 * desligado): o seletor, a trilha e o gráfico mostram sempre o mesmo nó.
 */
export function opcaoHierarquia(t: Tinta, raiz: NoAnel[], o: { unidade: string }): EChartsCoreOption {
  const total = raiz.reduce((s, n) => s + n.valor, 0) || 1;
  const converter = (n: NoAnel, cor: string, nivel: number): Record<string, unknown> => ({
    id: n.id,
    name: n.nome,
    value: n.valor,
    itemStyle: { color: cor },
    children: n.filhos?.map((f, i) => converter(f, misturar(cor, t.fundo, Math.min(0.55, 0.22 * nivel + 0.06 * (i % 3))), nivel + 1)),
  });
  const rotulo = { color: t.texto, textBorderColor: t.fundo, textBorderWidth: 2, fontSize: 11 };
  return {
    ...animacao(),
    textStyle: { fontFamily: "inherit" },
    tooltip: {
      ...(base(t).tooltip as object),
      trigger: "item",
      formatter: (p: { name: string; value: number; treePathInfo?: { name: string }[] }) => {
        const caminho = (p.treePathInfo ?? []).map((x) => x.name).filter(Boolean);
        return (
          (caminho.length > 1 ? `<div style="font-size:11px;opacity:.7">${caminho.slice(0, -1).join(" › ")}</div>` : "") +
          `<b>${p.name}</b><br/>${fmt.inteiro(p.value)} ${o.unidade} · ${((p.value / total) * 100).toFixed(1).replace(".", ",")}% do recorte`
        );
      },
    },
    series: [
      {
        type: "sunburst",
        data: raiz.map((n, i) => converter(n, t.series[i % t.series.length], 1)),
        radius: ["14%", "96%"],
        sort: undefined,
        nodeClick: false,
        emphasis: { focus: "ancestor" },
        itemStyle: { borderColor: t.fundo, borderWidth: 2 },
        label: { ...rotulo, minAngle: 8, overflow: "truncate" },
        levels: [
          {},
          { r0: "14%", r: "40%", label: { ...rotulo, rotate: 0, width: 96, overflow: "break" } },
          { r0: "40%", r: "68%", label: { ...rotulo, rotate: "radial", width: 84 } },
          { r0: "68%", r: "96%", label: { ...rotulo, rotate: "radial", width: 92, fontSize: 10 } },
        ],
      },
    ],
  };
}
