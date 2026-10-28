import type { EChartsOption } from "echarts";
import type { Cores } from "./tema";
import { escapar, fmtCompacto, fmtDec, fmtNum } from "./formato";

export type Formato = (v: number) => string;

type Ponto = {
  value: unknown;
  color?: unknown;
  seriesName?: string;
  name?: string;
  axisValueLabel?: string;
  dataIndex: number;
  data?: unknown;
  percent?: number;
};

const FONTE = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
// O amarelo da marca (--acento), igual nos dois temas: contorno do que a
// busca destacou.
const ACENTO = "#ffc20e";

// Celular: cada categoria de barra horizontal ganha uma "linha" própria —
// rótulo em cima, barra embaixo. A altura do gráfico passa a depender do
// número de categorias, não o contrário (que espremeria as barras).
const LINHA_COMPACTA = 46;
const LARGURA_ROTULO_COMPACTO = 250;

// Altura que o gráfico pede (fora das opções do ECharts, que ignoraria a
// chave e reclamaria nos tipos). Barras horizontais só pedem no celular;
// rosca pede sempre, porque a legenda faz parte da forma.
const alturas = new WeakMap<object, number>();
export function alturaSugerida(opcao: EChartsOption | null | undefined): number | undefined {
  return opcao ? alturas.get(opcao) : undefined;
}
function comAltura(opcao: EChartsOption, altura: number | undefined): EChartsOption {
  if (altura) alturas.set(opcao, altura);
  return opcao;
}

// ------------------------------------------------------------------ cores
type Gradiente = { type: "linear"; x: number; y: number; x2: number; y2: number; colorStops: { offset: number; color: string }[] };
type Sentido = "cima" | "baixo" | "direita" | "esquerda";

// `de` fica na base da marca, `ate` na ponta — o sentido diz para onde a marca cresce.
function gradiente(de: string, ate: string, sentido: Sentido): Gradiente {
  const [x, y, x2, y2] = { cima: [0, 1, 0, 0], baixo: [0, 0, 0, 1], direita: [0, 0, 1, 0], esquerda: [1, 0, 0, 0] }[sentido];
  return { type: "linear", x, y, x2, y2, colorStops: [{ offset: 0, color: de }, { offset: 1, color: ate }] };
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const paraHex = (v: number[]) => "#" + v.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
function misturar(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return paraHex(x.map((v, i) => v + (y[i] - v) * t));
}
const clarear = (hex: string, t: number) => misturar(hex, "#ffffff", t);
function comAlfa(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// Cor de uma marca para o tooltip/legenda: o gradiente vira a cor da ponta.
function corSolida(cor: unknown): string {
  if (cor && typeof cor === "object" && "colorStops" in cor) {
    const stops = (cor as Gradiente).colorStops;
    return stops[stops.length - 1].color;
  }
  return String(cor);
}

// Barra: degradê azul (dois azuis) ou, se divergente, verde/vermelho da base
// translúcida até a cor cheia na ponta.
function preenchimento(c: Cores, v: number, horizontal: boolean, o: { divergente?: boolean; cor?: string }) {
  const sentido: Sentido = horizontal ? (v >= 0 ? "direita" : "esquerda") : v >= 0 ? "cima" : "baixo";
  if (o.divergente) {
    const cor = v >= 0 ? c.positivo : c.negativo;
    return gradiente(comAlfa(cor, 0.45), cor, sentido);
  }
  if (o.cor) return gradiente(comAlfa(o.cor, 0.5), o.cor, sentido);
  return gradiente(c.azul[0], c.azul[1], sentido);
}

// --------------------------------------------------------------- tooltip
// Chave de série no tooltip: um traço curto, não uma caixa.
const chave = (cor: unknown) =>
  `<span style="display:inline-block;width:12px;height:3px;border-radius:2px;background:${corSolida(cor)};flex:none"></span>`;

const valorDe = (p: Ponto, indice = 1): number =>
  Array.isArray(p.value) ? Number(p.value[indice]) : Number(typeof p.value === "object" && p.value ? (p.value as { value: unknown }).value : p.value);

function linhaTooltip(cor: unknown, valor: string, nome: string) {
  return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">${chave(cor)}<strong>${escapar(valor)}</strong><span style="opacity:.7">${escapar(nome)}</span></div>`;
}

function caixaTooltip(c: Cores) {
  return {
    backgroundColor: c.superficie,
    borderColor: c.borda,
    borderWidth: 1,
    padding: [8, 12],
    // Preso dentro do gráfico: no celular o tooltip não vaza para fora da tela.
    confine: true,
    textStyle: { color: c.tinta, fontSize: 12, fontFamily: FONTE },
    extraCssText: `box-shadow:0 10px 30px rgb(0 0 0 / .22);border-radius:14px;${c.compacto ? "max-width:250px;white-space:normal;" : ""}`,
  };
}

function tooltipEixo(
  c: Cores,
  fmt: Formato,
  o: { extra?: (indice: number) => string; sombra?: boolean; ocultar?: string[]; indiceValor?: 0 | 1 } = {},
) {
  return {
    ...caixaTooltip(c),
    trigger: "axis" as const,
    axisPointer: o.sombra
      ? { type: "shadow" as const, shadowStyle: { color: c.grade, opacity: 0.45 } }
      : { type: "line" as const, lineStyle: { color: c.eixo, width: 1 } },
    formatter: (params: unknown) => {
      const lista = (Array.isArray(params) ? params : [params]) as Ponto[];
      if (!lista.length) return "";
      const titulo = escapar(lista[0].axisValueLabel ?? lista[0].name);
      const linhas = lista
        .filter((p) => p.seriesName && !p.seriesName.startsWith("_") && !(o.ocultar ?? []).includes(p.seriesName) && Number.isFinite(valorDe(p, o.indiceValor)))
        .map((p) => linhaTooltip(p.color, fmt(valorDe(p, o.indiceValor)), p.seriesName!))
        .join("");
      return `<div style="font-size:11px;opacity:.7">${titulo}</div>${linhas}${o.extra ? o.extra(lista[0].dataIndex) : ""}`;
    },
  };
}

// ----------------------------------------------------------------- eixos
function eixoCategoria(c: Cores, dados: (string | number)[], extra: Record<string, unknown> = {}) {
  return {
    type: "category" as const,
    data: dados,
    // Na borda sempre: com valores negativos o ECharts levaria o eixo (e os
    // rótulos das categorias) para o zero, no meio do gráfico.
    axisLine: { onZero: false, lineStyle: { color: c.eixo, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: c.tinta3, fontSize: c.compacto ? 10 : 11, hideOverlap: true },
    ...extra,
  };
}

// Categorias de barra horizontal: ao lado da barra (largo) ou em cima dela (compacto).
function eixoCategoriaHorizontal(c: Cores, dados: (string | number)[], largura: number) {
  if (!c.compacto) {
    // triggerEvent: o rótulo da categoria também responde ao clique (filtro).
    return eixoCategoria(c, dados, { inverse: true, triggerEvent: true, axisLine: { show: false }, axisLabel: { color: c.tinta2, fontSize: 11, width: largura, overflow: "truncate" } });
  }
  return eixoCategoria(c, dados, {
    inverse: true,
    triggerEvent: true,
    axisLine: { show: false },
    axisLabel: {
      inside: true,
      verticalAlign: "bottom",
      // Sobe o rótulo acima da barra, que fica centrada na faixa da categoria.
      padding: [0, 0, 13, 0],
      margin: 0,
      color: c.tinta2,
      fontSize: 12,
      width: LARGURA_ROTULO_COMPACTO,
      overflow: "truncate",
    },
    z: 10,
  });
}

function eixoValor(c: Cores, fmt: Formato, extra: Record<string, unknown> = {}) {
  return {
    type: "value" as const,
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: c.grade, width: 1, type: "dashed" as const } },
    axisLabel: { color: c.tinta3, fontSize: c.compacto ? 10 : 11, formatter: (v: number) => fmt(v) },
    ...extra,
  };
}

type Icone = "linha" | "barra" | "ponto";
function legenda(c: Cores, itens: { nome: string; icone: Icone }[]) {
  if (itens.length < 2) return undefined;
  const icone: Record<Icone, string | undefined> = { linha: undefined, barra: "roundRect", ponto: "circle" };
  return {
    // No celular a legenda rola na horizontal em vez de quebrar em 3 linhas
    // e empurrar o gráfico para baixo.
    type: c.compacto ? ("scroll" as const) : ("plain" as const),
    top: 0,
    left: 0,
    right: c.compacto ? 0 : undefined,
    itemGap: c.compacto ? 12 : 16,
    textStyle: { color: c.tinta2, fontSize: c.compacto ? 11 : 12 },
    pageIconColor: c.tinta2,
    pageIconInactiveColor: c.grade,
    pageTextStyle: { color: c.tinta3 },
    // Linha: o ECharts desenha o traço da própria série (a chave espelha a marca).
    data: itens.map((i) => (icone[i.icone] ? { name: i.nome, icon: icone[i.icone] } : { name: i.nome })),
    itemWidth: 18,
    itemHeight: 8,
  };
}

function base(c: Cores, comLegenda: boolean, direita = 20): EChartsOption {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily: FONTE, color: c.tinta2 },
    animationDuration: 500,
    animationEasing: "cubicOut",
    grid: { left: c.compacto ? 0 : 4, right: direita, top: comLegenda ? 36 : 14, bottom: 4, containLabel: true },
  };
}

// Ponta arredondada só na ponta do dado; a base, colada na linha do zero, é reta.
function raio(v: number, horizontal: boolean, r = 6): number[] {
  if (horizontal) return v >= 0 ? [0, r, r, 0] : [r, 0, 0, r];
  return v >= 0 ? [r, r, 0, 0] : [0, 0, r, r];
}

// ----------------------------------------------------------------- linhas
export type SerieLinha = {
  nome: string;
  dados: (number | null)[];
  cor?: string;
  tracejada?: boolean;
  area?: boolean;
  rotuloFinal?: boolean;
};

export function opcaoLinhas(
  c: Cores,
  x: (string | number)[],
  series: SerieLinha[],
  o: { formato?: Formato; formatoEixo?: Formato; extraTooltip?: (i: number) => string; zero?: boolean } = {},
): EChartsOption {
  const fmt = o.formato ?? fmtCompacto;
  const leg = legenda(c, series.map((s) => ({ nome: s.nome, icone: "linha" })));
  const comRotulo = series.some((s) => s.rotuloFinal);
  // Rótulo final no celular em formato compacto: "1,4 mi", não "1.361.231".
  const fmtRotulo = c.compacto ? (o.formatoEixo ?? fmtCompacto) : fmt;
  const unica = series.length === 1;
  return {
    ...base(c, !!leg, comRotulo ? (c.compacto ? 48 : 88) : c.compacto ? 8 : 20),
    legend: leg,
    tooltip: tooltipEixo(c, fmt, { extra: o.extraTooltip }),
    xAxis: eixoCategoria(c, x, { boundaryGap: false }),
    yAxis: eixoValor(c, o.formatoEixo ?? fmtCompacto, { scale: !o.zero }),
    series: series.map((s, i) => {
      const cor = s.cor ?? (unica ? c.azul[1] : c.series[i]);
      // Série única: o traço vai de um azul ao outro ao longo do tempo.
      const traco = unica && !s.cor ? gradiente(c.azul[0], c.azul[1], "direita") : cor;
      return {
        type: "line" as const,
        name: s.nome,
        data: s.dados,
        smooth: 0.25,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 9,
        lineStyle: { width: unica ? 3 : 2, color: traco, type: s.tracejada ? ("dashed" as const) : ("solid" as const), cap: "round" as const, join: "round" as const },
        itemStyle: { color: cor, borderColor: c.superficie, borderWidth: 2 },
        // Área: o azul se dissolve na superfície em direção ao eixo.
        areaStyle: s.area ? { color: gradiente(comAlfa(cor, 0.34), comAlfa(cor, 0), "baixo") } : undefined,
        endLabel: s.rotuloFinal
          ? { show: true, color: c.tinta, fontWeight: 600, fontSize: c.compacto ? 10 : 11, formatter: (p: unknown) => fmtRotulo(valorDe(p as Ponto)) }
          : undefined,
        emphasis: { disabled: true },
      };
    }),
  };
}

// ----------------------------------------------------------------- barras
export function opcaoBarras(
  c: Cores,
  categorias: (string | number)[],
  valores: (number | null)[],
  o: {
    horizontal?: boolean;
    formato?: Formato;
    divergente?: boolean;
    cor?: string;
    rotulos?: boolean;
    nome?: string;
    extraTooltip?: (i: number) => string;
    larguraRotulo?: number;
    formatoEixo?: Formato;
    esmaecer?: number[];
    // Pirulito: haste fina + ponto na ponta. Para rankings longos, onde a
    // massa de tinta de 15 barras grossas não acrescenta nada à comparação.
    forma?: "barra" | "pirulito";
  } = {},
): EChartsOption {
  const fmt = o.formato ?? fmtCompacto;
  const h = !!o.horizontal;
  const pirulito = o.forma === "pirulito";
  const compactoH = h && c.compacto;
  const eixoCat = h ? eixoCategoriaHorizontal(c, categorias, o.larguraRotulo ?? 180) : eixoCategoria(c, categorias);
  // No celular o valor vai na ponta de cada barra; o eixo de valores, então,
  // só repetiria os números — fica a grade, somem os rótulos.
  const eixoVal = eixoValor(c, o.formatoEixo ?? fmtCompacto, compactoH ? { axisLabel: { show: false } } : {});
  const rotulos = o.rotulos || compactoH || pirulito;
  const fmtRotulo = compactoH ? (o.formatoEixo ?? fmtCompacto) : fmt;
  const corPonta = (v: number) => (o.divergente ? (v >= 0 ? c.positivo : c.negativo) : (o.cor ?? c.azul[1]));
  const posicaoRotulo = (v: number) => (h ? (v < 0 ? "left" : "right") : v < 0 ? "bottom" : "top");
  const rotulo = {
    show: true,
    color: c.tinta2,
    fontSize: 11,
    fontWeight: 500,
    distance: pirulito ? 10 : 5,
    formatter: (p: unknown) => fmtRotulo(valorDe(p as Ponto, h ? 0 : 1)),
  };

  const series: Record<string, unknown>[] = [
    {
      type: "bar",
      name: o.nome ?? "valor",
      itemStyle: { color: corPonta(1) },
      barMaxWidth: pirulito ? 3 : compactoH ? 14 : 22,
      barCategoryGap: "34%",
      data: valores.map((v, i) => ({
        value: v,
        itemStyle: {
          color: pirulito ? comAlfa(corPonta(v ?? 0), 0.4) : preenchimento(c, v ?? 0, h, o),
          borderRadius: pirulito ? 2 : raio(v ?? 0, h),
          opacity: o.esmaecer?.includes(i) ? 0.4 : 1,
        },
        label: !pirulito && rotulos ? { ...rotulo, position: posicaoRotulo(v ?? 0) } : undefined,
      })),
      emphasis: { itemStyle: { opacity: 0.85 } },
    },
  ];
  if (pirulito) {
    series.push({
      type: "scatter",
      name: "_ponta",
      symbolSize: c.compacto ? 11 : 13,
      data: valores.map((v, i) => ({
        // O nome é o da categoria: o clique na ponta filtra como o clique na haste.
        name: String(categorias[i]),
        value: h ? [v, i] : [i, v],
        itemStyle: { color: corPonta(v ?? 0), borderColor: c.superficie, borderWidth: 2, shadowBlur: 8, shadowColor: comAlfa(corPonta(v ?? 0), 0.45) },
        label: { ...rotulo, position: posicaoRotulo(v ?? 0) },
      })),
      z: 4,
    });
  }

  const opcao: EChartsOption = {
    ...base(c, false, rotulos && h ? (c.compacto ? 44 : 60) : c.compacto ? 8 : 20),
    tooltip: tooltipEixo(c, fmt, { extra: o.extraTooltip, sombra: true }),
    xAxis: h ? eixoVal : eixoCat,
    yAxis: h ? eixoCat : eixoVal,
    series: series as EChartsOption["series"],
  };
  return comAltura(opcao, compactoH ? categorias.length * LINHA_COMPACTA + 16 : undefined);
}

export function opcaoBarrasAgrupadas(
  c: Cores,
  categorias: (string | number)[],
  series: { nome: string; dados: (number | null)[]; cor?: string }[],
  o: { horizontal?: boolean; formato?: Formato; formatoEixo?: Formato; empilhar?: boolean; linha?: { nome: string; dados: (number | null)[] } } = {},
): EChartsOption {
  const fmt = o.formato ?? fmtCompacto;
  const h = !!o.horizontal;
  const eixoCat = h ? eixoCategoriaHorizontal(c, categorias, 180) : eixoCategoria(c, categorias);
  const eixoVal = eixoValor(c, o.formatoEixo ?? fmt);
  const itensLegenda = [
    ...series.map((s) => ({ nome: s.nome, icone: "barra" as const })),
    ...(o.linha ? [{ nome: o.linha.nome, icone: "linha" as const }] : []),
  ];
  const leg = legenda(c, itensLegenda);
  const sentido = (v: number): Sentido => (h ? (v >= 0 ? "direita" : "esquerda") : v >= 0 ? "cima" : "baixo");
  const opcao: EChartsOption = {
    ...base(c, !!leg, c.compacto ? 8 : 20),
    legend: leg,
    tooltip: tooltipEixo(c, fmt, { sombra: true }),
    xAxis: h ? eixoVal : eixoCat,
    yAxis: h ? eixoCat : eixoVal,
    series: [
      ...series.map((s, i) => {
        const cor = s.cor ?? c.series[i];
        return {
          type: "bar" as const,
          name: s.nome,
          stack: o.empilhar ? "total" : undefined,
          itemStyle: { color: cor },
          barMaxWidth: h && c.compacto ? 12 : 22,
          barGap: "14%",
          data: s.dados.map((v) => ({
            value: v,
            itemStyle: {
              color: o.empilhar ? cor : gradiente(comAlfa(cor, 0.55), cor, sentido(v ?? 0)),
              // Empilhado: 1px da cor da superfície de cada lado = a fenda de 2px
              // entre segmentos. Agrupado: ponta arredondada como qualquer barra.
              borderRadius: o.empilhar ? 3 : raio(v ?? 0, h),
              borderColor: o.empilhar ? c.superficie : undefined,
              borderWidth: o.empilhar ? 1 : 0,
            },
          })),
        };
      }),
      ...(o.linha
        ? [{
            type: "line" as const,
            name: o.linha.nome,
            data: o.linha.dados,
            symbol: "circle",
            symbolSize: c.compacto ? 6 : 8,
            lineStyle: { width: 2, color: c.tinta },
            itemStyle: { color: c.tinta, borderColor: c.superficie, borderWidth: 2 },
            z: 5,
          }]
        : []),
    ],
  };
  const porCategoria = o.empilhar ? 1 : series.length;
  return comAltura(opcao, h && c.compacto ? categorias.length * (porCategoria * 16 + 34) + 44 : undefined);
}

// --------------------------------------------------------------- halteres
// Dois grupos por categoria (homem × mulher): um ponto para cada, ligados por
// uma haste. A distância entre os pontos É a diferença — melhor que duas
// barras lado a lado, onde o olho compara comprimentos inteiros.
export function opcaoHalteres(
  c: Cores,
  categorias: string[],
  a: { nome: string; dados: (number | null)[] },
  b: { nome: string; dados: (number | null)[] },
  o: { formato?: Formato; formatoEixo?: Formato; larguraRotulo?: number } = {},
): EChartsOption {
  const fmt = o.formato ?? fmtCompacto;
  const [corA, corB] = [c.series[0], c.series[1]];
  const par = categorias.map((_, i) => [a.dados[i], b.dados[i]] as const);
  const menor = par.map(([x, y]) => (x === null || y === null ? null : Math.min(x, y)));
  const faixa = par.map(([x, y]) => (x === null || y === null ? null : Math.abs(x - y)));
  const valores = par.flat().filter((v): v is number => v !== null);
  const piso = valores.length ? Math.max(0, Math.floor(Math.min(...valores) * 0.85)) : 0;
  const ponto = (s: typeof a, cor: string, outro: typeof a) => ({
    type: "scatter" as const,
    name: s.nome,
    symbolSize: c.compacto ? 12 : 14,
    itemStyle: { color: cor, borderColor: c.superficie, borderWidth: 2, shadowBlur: 8, shadowColor: comAlfa(cor, 0.4) },
    data: s.dados.map((v, i) =>
      v === null
        ? null
        : {
            value: [v, i],
            label: {
              show: true,
              position: v <= (outro.dados[i] ?? v) ? ("left" as const) : ("right" as const),
              distance: 9,
              color: c.tinta2,
              fontSize: 11,
              formatter: () => (o.formatoEixo ?? fmt)(v),
            },
          },
    ),
    z: 5,
  });
  const leg = legenda(c, [{ nome: a.nome, icone: "ponto" }, { nome: b.nome, icone: "ponto" }]);
  const opcao: EChartsOption = {
    ...base(c, true),
    // No celular sobra uma margem à esquerda para o rótulo do ponto menor,
    // que fica à esquerda dele e cortaria quando o valor encosta no piso.
    grid: { left: c.compacto ? 28 : 4, right: c.compacto ? 40 : 48, top: 36, bottom: 4, containLabel: true },
    legend: leg,
    tooltip: tooltipEixo(c, fmt, { sombra: true, indiceValor: 0 }),
    xAxis: eixoValor(c, o.formatoEixo ?? fmt, { min: piso, ...(c.compacto ? { axisLabel: { show: false } } : {}) }),
    yAxis: eixoCategoriaHorizontal(c, categorias, o.larguraRotulo ?? 160),
    series: [
      { type: "bar", name: "_base", stack: "h", data: menor, barWidth: 4, itemStyle: { color: "transparent" }, silent: true },
      {
        type: "bar",
        name: "_faixa",
        stack: "h",
        data: faixa,
        barWidth: 4,
        itemStyle: { color: gradiente(comAlfa(corA, 0.35), comAlfa(corB, 0.35), "direita"), borderRadius: 2 },
        silent: true,
      },
      ponto(a, corA, b),
      ponto(b, corB, a),
    ],
  };
  return comAltura(opcao, c.compacto ? categorias.length * LINHA_COMPACTA + 44 : undefined);
}

// ----------------------------------------------------------------- rosca
// Parte de um todo com poucas fatias (2 a 6). Total no centro; legenda com
// nome, valor e porcentagem — ao lado no largo, embaixo no celular.
export function opcaoRosca(
  c: Cores,
  itens: { nome: string; valor: number }[],
  o: { formato?: Formato; centro: string; extraTooltip?: (i: number) => string; cores?: string[] },
): EChartsOption {
  const fmt = o.formato ?? fmtNum;
  const total = itens.reduce((s, i) => s + (Number.isFinite(i.valor) ? i.valor : 0), 0);
  const pct = (v: number) => (total ? (v / total) * 100 : 0);
  const cores = o.cores ?? c.series;
  const indice = new Map(itens.map((it, i) => [it.nome, i]));
  const n = itens.length;
  const cx = c.compacto ? "50%" : "27%";
  const cy: string | number = c.compacto ? 118 : "50%";
  const opcao: EChartsOption = {
    backgroundColor: "transparent",
    textStyle: { fontFamily: FONTE, color: c.tinta2 },
    animationDuration: 600,
    animationEasing: "cubicOut",
    tooltip: {
      ...caixaTooltip(c),
      trigger: "item",
      formatter: (p: unknown) => {
        const ponto = p as Ponto;
        const it = itens[ponto.dataIndex];
        return (
          `<div style="font-weight:600">${escapar(it.nome)}</div>` +
          linhaTooltip(ponto.color, fmt(it.valor), `${fmtDec(pct(it.valor), 1)}% do total`) +
          (o.extraTooltip ? o.extraTooltip(ponto.dataIndex) : "")
        );
      },
    },
    title: {
      text: fmtCompacto(total),
      subtext: o.centro,
      left: cx,
      top: cy,
      textAlign: "center",
      textVerticalAlign: "middle",
      itemGap: 2,
      textStyle: { color: c.tinta, fontSize: c.compacto ? 20 : 22, fontWeight: 650, fontFamily: FONTE },
      subtextStyle: { color: c.tinta3, fontSize: 11, fontFamily: FONTE },
    },
    legend: {
      orient: "vertical",
      left: c.compacto ? 0 : "54%",
      top: c.compacto ? 236 : "middle",
      icon: "circle",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 14,
      selectedMode: false,
      formatter: (nome: string) => {
        const it = itens[indice.get(nome) ?? 0];
        // Com overflow "break", o ECharts junta as linhas do texto rico e
        // ignora o "\n"; um token de largura 100% força a linha própria.
        return `{v|${fmt(it.valor)}  ·  ${fmtDec(pct(it.valor), 1)}%}\n{n|${nome}}`;
      },
      textStyle: {
        color: c.tinta2,
        width: c.compacto ? 290 : 220,
        overflow: "break",
        rich: {
          n: { fontSize: 12, color: c.tinta2, lineHeight: 17 },
          v: { fontSize: 13, color: c.tinta, fontWeight: 650, lineHeight: 20, width: "100%" },
        },
      },
    },
    series: [
      {
        type: "pie",
        radius: c.compacto ? [68, 104] : ["58%", "86%"],
        center: [cx, cy],
        startAngle: 90,
        padAngle: 2,
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 8, borderColor: c.superficie, borderWidth: 1 },
        label: {
          show: true,
          position: "inside",
          color: "#ffffff",
          fontSize: 11,
          fontWeight: 650,
          textShadowColor: "rgba(0,0,0,.35)",
          textShadowBlur: 3,
          formatter: (p: unknown) => {
            const v = (p as Ponto).percent ?? 0;
            return v >= 7 ? `${Math.round(v)}%` : "";
          },
        },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 6, itemStyle: { shadowBlur: 16, shadowColor: "rgba(0,0,0,.25)" } },
        data: itens.map((it, i) => {
          const cor = cores[i % cores.length];
          return { name: it.nome, value: it.valor, itemStyle: { color: gradiente(clarear(cor, 0.25), cor, "baixo") } };
        }),
      },
    ],
  };
  return comAltura(opcao, c.compacto ? 236 + n * 50 : Math.max(240, n * 52 + 48));
}

// --------------------------------------------------------------- mosaico
// Treemap para "quem tem mais" entre 8 a 20 itens positivos: a área é o
// valor, e o tom vai do azul mais fundo (maior) ao mais claro (menor).
export function opcaoMosaico(
  c: Cores,
  itens: { nome: string; valor: number }[],
  o: { formato?: Formato; extraTooltip?: (i: number) => string } = {},
): EChartsOption {
  const fmt = o.formato ?? fmtCompacto;
  const total = itens.reduce((s, i) => s + i.valor, 0);
  const n = itens.length;
  const opcao: EChartsOption = {
    backgroundColor: "transparent",
    textStyle: { fontFamily: FONTE },
    animationDuration: 500,
    tooltip: {
      ...caixaTooltip(c),
      trigger: "item",
      formatter: (p: unknown) => {
        // No treemap o dataIndex conta os nós da árvore, não os itens: casa pelo nome.
        const ponto = p as Ponto;
        const i = itens.findIndex((it) => it.nome === ponto.name);
        const it = itens[i];
        if (!it) return "";
        return (
          `<div style="font-weight:600">${escapar(it.nome)}</div>` +
          linhaTooltip(ponto.color, fmtNum(it.valor), `${fmtDec(total ? (it.valor / total) * 100 : 0, 1)}% dos listados`) +
          (o.extraTooltip ? o.extraTooltip(i) : "")
        );
      },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        // Explícito sempre: `undefined` sobrescreve o padrão e o squarify do
        // ECharts entra em laço infinito (a aba congela).
        squareRatio: c.compacto ? 0.9 : 0.5 * (1 + Math.sqrt(5)),
        itemStyle: { borderColor: c.superficie, borderWidth: 2, gapWidth: 3, borderRadius: 12 },
        levels: [{ itemStyle: { borderWidth: 0, gapWidth: 4 } }],
        label: {
          show: true,
          position: "insideTopLeft",
          padding: [8, 10],
          overflow: "break",
          color: "#ffffff",
          textShadowColor: "rgba(0,0,0,.3)",
          textShadowBlur: 2,
          formatter: (p: unknown) => {
            const ponto = p as { name: string; value: number };
            // Valor em cima, numa linha própria (ver a legenda da rosca).
            return `{v|${fmt(ponto.value)}}\n{n|${ponto.name.replace(/[{}|]/g, "")}}`;
          },
          rich: {
            n: { fontSize: c.compacto ? 11 : 12, color: "#ffffff", lineHeight: 16 },
            v: { fontSize: c.compacto ? 13 : 15, color: "#ffffff", fontWeight: 700, lineHeight: 22, width: "100%" },
          },
        },
        upperLabel: { show: false },
        emphasis: { itemStyle: { shadowBlur: 14, shadowColor: "rgba(0,0,0,.3)" } },
        data: itens.map((it, i) => {
          const cor = misturar(c.mosaico[0], c.mosaico[1], n > 1 ? i / (n - 1) : 0);
          return { name: it.nome, value: it.valor, itemStyle: { color: gradiente(clarear(cor, 0.14), cor, "baixo") } };
        }),
      },
    ],
  };
  return comAltura(opcao, c.compacto ? 560 : undefined);
}

// --------------------------------------------------------------- dispersão
export type GrupoDispersao = {
  nome: string;
  cor?: string;
  // `nome` do ponto é o que o clique entrega (ex.: "Londrina (PR)" filtra o
  // PR); `destaque` vem da busca por nome e acende o ponto sobre os demais.
  pontos: { x: number; y: number; tamanho?: number; rotulo: string; detalhe?: string; nome?: string; destaque?: boolean }[];
};

export function opcaoDispersao(
  c: Cores,
  grupos: GrupoDispersao[],
  o: {
    formatoX: Formato;
    formatoY: Formato;
    nomeX: string;
    nomeY: string;
    identidade?: [number, number];
    rotularPontos?: boolean;
    logX?: boolean;
  },
): EChartsOption {
  const leg = legenda(c, [
    ...grupos.map((g) => ({ nome: g.nome, icone: "ponto" as const })),
    ...(o.identidade ? [{ nome: "Identidade (1:1)", icone: "linha" as const }] : []),
  ]);
  const nomeEixo = { color: c.tinta3, fontSize: c.compacto ? 10 : 11 };
  // Com algum ponto em destaque, os demais recuam: o destacado ganha
  // tamanho, contorno no acento e o nome escrito.
  const haDestaque = grupos.some((g) => g.pontos.some((p) => p.destaque));
  return {
    ...base(c, !!leg),
    // No celular o título do eixo Y vai acima do eixo, na horizontal — girado
    // na lateral ele come a largura que o gráfico não tem.
    grid: c.compacto
      ? { left: 0, right: 12, top: leg ? 58 : 30, bottom: 26, containLabel: true }
      : { left: 40, right: 24, top: leg ? 40 : 16, bottom: 28, containLabel: true },
    legend: leg,
    tooltip: {
      ...caixaTooltip(c),
      trigger: "item",
      formatter: (p: unknown) => {
        const ponto = p as Ponto & { data: { rotulo?: string; detalhe?: string; value: number[] } };
        if (!ponto.data?.rotulo) return "";
        return (
          `<div style="font-weight:600">${escapar(ponto.data.rotulo)}</div>` +
          linhaTooltip(ponto.color, o.formatoX(ponto.data.value[0]), o.nomeX) +
          linhaTooltip(ponto.color, o.formatoY(ponto.data.value[1]), o.nomeY) +
          (ponto.data.detalhe ? `<div style="opacity:.7;margin-top:3px">${escapar(ponto.data.detalhe)}</div>` : "")
        );
      },
    },
    xAxis: eixoValor(c, o.formatoX, { ...(o.logX ? { type: "log", logBase: 10 } : { scale: true }), name: o.nomeX, nameLocation: "middle", nameGap: c.compacto ? 22 : 26, nameTextStyle: nomeEixo }),
    yAxis: eixoValor(c, o.formatoY, c.compacto
      ? { scale: true, name: o.nomeY, nameLocation: "end", nameGap: 10, nameTextStyle: { ...nomeEixo, align: "left" } }
      : { scale: true, name: o.nomeY, nameLocation: "middle", nameGap: 48, nameTextStyle: nomeEixo }),
    series: [
      ...grupos.map((g, i) => {
        const cor = g.cor ?? c.series[i];
        const tamanho = (p: GrupoDispersao["pontos"][number]) => c.compacto ? Math.max(6, (p.tamanho ?? 12) * 0.7) : (p.tamanho ?? 12);
        return {
          type: "scatter" as const,
          name: g.nome,
          data: g.pontos.map((p) => ({
            name: p.nome,
            value: [p.x, p.y],
            rotulo: p.rotulo,
            detalhe: p.detalhe,
            symbolSize: p.destaque ? Math.max(18, tamanho(p) * 1.4) : tamanho(p),
            ...(p.destaque
              ? {
                  itemStyle: { opacity: 1, borderColor: ACENTO, borderWidth: 3 },
                  label: { show: true, position: "top" as const, color: c.tinta, fontSize: 12, fontWeight: 600, formatter: escapar(p.rotulo) },
                  z: 10,
                }
              : haDestaque
                ? { itemStyle: { opacity: 0.18 } }
                : {}),
          })),
          // Bolha com brilho: centro claro, borda na cor da série.
          itemStyle: {
            color: { type: "radial" as const, x: 0.4, y: 0.35, r: 0.8, colorStops: [{ offset: 0, color: clarear(cor, 0.35) }, { offset: 1, color: cor }] },
            opacity: 0.85,
            borderColor: c.superficie,
            borderWidth: c.compacto ? 1 : 1.5,
          },
          label: o.rotularPontos
            ? { show: true, position: "top" as const, color: c.tinta3, fontSize: c.compacto ? 9 : 10, formatter: (p: unknown) => escapar((p as { data: { rotulo: string } }).data.rotulo) }
            : undefined,
          labelLayout: { hideOverlap: true },
          emphasis: { scale: 1.3 },
        };
      }),
      ...(o.identidade
        ? [{
            type: "line" as const,
            name: "Identidade (1:1)",
            data: [[o.identidade[0], o.identidade[0]], [o.identidade[1], o.identidade[1]]],
            symbol: "none",
            lineStyle: { width: 1.5, color: c.tinta3, type: "dashed" as const },
            itemStyle: { color: c.tinta3 },
            tooltip: { show: false },
            z: 1,
          }]
        : []),
    ],
  };
}

// ------------------------------------------------------------------- mapa
export function opcaoMapa(
  c: Cores,
  ufs: { uf: string; valor: number }[],
  bolhas: { nome: string; lon: number; lat: number; valor: number; tamanho: number; uf?: string; grupo?: string; destaque?: boolean }[],
  // Estados do filtro de território: os demais ficam apagados (cor e bolhas).
  // `grupos`: cor de cada grupo de bolha (fora deles, cinza); `foco`: centro
  // e zoom, quando a busca encontrou municípios.
  o: {
    formato: Formato;
    divergente?: boolean;
    rotulo: string;
    formatoBolha: Formato;
    destacar?: string[];
    grupos?: { nome: string; cor: string }[];
    foco?: { lon: number; lat: number; zoom: number };
  },
): EChartsOption {
  const apagado = (uf: string | undefined) => !!o.destacar?.length && !!uf && !o.destacar.includes(uf);
  // A escala de cor vale só para os estados do filtro: sem SP, as diferenças
  // entre os demais aparecem em vez de ficarem achatadas pelo maior.
  const valores = ufs.filter((u) => !apagado(u.uf)).map((u) => u.valor).filter(Number.isFinite);
  const absMax = Math.max(1, ...valores.map(Math.abs));
  const min = o.divergente ? -absMax : Math.min(...valores);
  const max = o.divergente ? absMax : Math.max(...valores);
  const maiorBolha = Math.max(1, ...bolhas.map((b) => b.tamanho));
  const bolhaMax = c.compacto ? 16 : 26;
  const tamanhoBolha = (v: number[]) => 3 + bolhaMax * Math.sqrt(v[3] / maiorBolha);
  const OUTROS = "Outros municípios";
  const grupos = o.grupos ?? [];
  const leg = grupos.length ? legenda(c, [...grupos, { nome: OUTROS }].map((g) => ({ nome: g.nome, icone: "ponto" as const }))) : undefined;
  const dadoBolha = (b: (typeof bolhas)[number]) => ({
    name: b.nome,
    value: [b.lon, b.lat, b.valor, b.tamanho],
    itemStyle: apagado(b.uf) ? { opacity: 0.06 } : undefined,
  });
  // Uma série por grupo (a legenda liga e desliga cada um) e, por cima de
  // todas, a dos municípios que a busca encontrou.
  const camadas = [...grupos.map((g) => ({ nome: g.nome, cor: g.cor })), { nome: OUTROS, cor: c.tinta }].map((g, i) => ({
    type: "scatter" as const,
    name: g.nome,
    coordinateSystem: "geo" as const,
    data: bolhas.filter((b) => !b.destaque && (i < grupos.length ? b.grupo === g.nome : !grupos.some((x) => x.nome === b.grupo))).map(dadoBolha),
    symbolSize: tamanhoBolha,
    itemStyle: { color: g.cor, opacity: g.nome === OUTROS ? 0.28 : 0.8, borderColor: c.superficie, borderWidth: 1 },
    emphasis: { itemStyle: { opacity: 1 } },
    z: 3,
  }));
  const destacadas = bolhas.filter((b) => b.destaque);
  const opcao: EChartsOption = {
    backgroundColor: "transparent",
    textStyle: { fontFamily: FONTE, color: c.tinta2 },
    legend: leg,
    tooltip: {
      ...caixaTooltip(c),
      trigger: "item",
      formatter: (p: unknown) => {
        const ponto = p as Ponto & { seriesType: string };
        if (ponto.seriesType === "scatter") {
          const v = ponto.value as number[];
          return `<div style="font-weight:600">${escapar(ponto.name)}</div>` + linhaTooltip(c.tinta3, o.formatoBolha(v[3]), "vínculos ativos") + linhaTooltip(c.tinta3, o.formato(v[2]), o.rotulo);
        }
        const valor = ponto.value === null || ponto.value === undefined || Number.isNaN(Number(ponto.value)) ? null : Number(ponto.value);
        return `<div style="font-weight:600">${escapar(ponto.name)}</div>` + (valor === null ? `<div style="opacity:.7">fora do filtro de território</div>` : linhaTooltip(ponto.color, o.formato(valor), o.rotulo));
      },
    },
    visualMap: {
      type: "continuous",
      seriesIndex: 0,
      min,
      max,
      orient: "horizontal",
      left: 0,
      bottom: 0,
      itemWidth: 10,
      itemHeight: c.compacto ? 120 : 160,
      text: [o.formato(max), o.formato(min)],
      textStyle: { color: c.tinta3, fontSize: 11 },
      inRange: { color: o.divergente ? [c.negativo, c.neutro, c.positivo] : c.sequencial },
      calculable: false,
    },
    geo: {
      map: "BR",
      nameProperty: "sigla",
      // No celular arrastar o mapa sequestraria a rolagem da página pelo dedo;
      // o toque fica só para o tooltip.
      roam: !c.compacto,
      scaleLimit: { min: 1, max: 8 },
      ...(o.foco ? { center: [o.foco.lon, o.foco.lat], zoom: o.foco.zoom } : {}),
      layoutCenter: ["50%", c.compacto ? "46%" : "48%"],
      layoutSize: c.compacto ? "100%" : "96%",
      itemStyle: { areaColor: c.neutro, borderColor: c.superficie, borderWidth: 1 },
      emphasis: { label: { show: false }, itemStyle: { areaColor: c.eixo } },
      select: { disabled: true },
    },
    series: [
      {
        type: "map",
        geoIndex: 0,
        // Fora do filtro, sem valor ("-", o ausente do ECharts): o estado fica na
        // cor neutra do mapa. (A
        // opacidade por item é ignorada numa série ligada ao `geo`.)
        data: ufs.map((u) => ({ name: u.uf, value: apagado(u.uf) ? ("-" as const) : u.valor })),
      },
      ...camadas,
      {
        type: "scatter",
        name: "_destaque",
        coordinateSystem: "geo",
        data: destacadas.map(dadoBolha),
        symbolSize: (v: number[]) => Math.max(14, tamanhoBolha(v)),
        itemStyle: { color: ACENTO, opacity: 1, borderColor: c.tinta, borderWidth: 1.5 },
        label: { show: true, position: "right", color: c.tinta, fontSize: 12, fontWeight: 600, textBorderColor: c.superficie, textBorderWidth: 3, formatter: (p: { name: string }) => p.name },
        z: 5,
      },
    ],
  };
  return comAltura(opcao, c.compacto ? 400 : undefined);
}

// --------------------------------------------- série com faixa (previsão)
export function opcaoPrevisao(
  c: Cores,
  meses: string[],
  observado: (number | null)[],
  previsto: (number | null)[],
  inferior: (number | null)[],
  superior: (number | null)[],
  fmt: Formato,
): EChartsOption {
  const largura = superior.map((s, i) => (s === null || inferior[i] === null ? null : s - inferior[i]!));
  const extra = (i: number) =>
    inferior[i] === null ? "" : `<div style="margin-top:3px;opacity:.8">Faixa de 80%: ${escapar(fmt(inferior[i]!))} a ${escapar(fmt(superior[i]!))}</div>`;
  const leg = legenda(c, [
    { nome: "Observado", icone: "linha" },
    { nome: "Previsto", icone: "linha" },
    { nome: "Faixa de 80%", icone: "barra" },
  ]);
  return {
    ...base(c, true, c.compacto ? 8 : 20),
    legend: leg,
    tooltip: tooltipEixo(c, fmt, { extra, ocultar: ["Faixa de 80%"] }),
    xAxis: eixoCategoria(c, meses, { boundaryGap: false }),
    yAxis: eixoValor(c, fmtCompacto),
    series: [
      { type: "line", name: "_base", data: inferior, stack: "faixa", stackStrategy: "all", symbol: "none", lineStyle: { opacity: 0 }, silent: true },
      {
        type: "line",
        name: "Faixa de 80%",
        data: largura,
        stack: "faixa",
        // O padrão empilha negativos e positivos em pilhas separadas: com o
        // limite inferior abaixo de zero, a faixa nasceria no zero.
        stackStrategy: "all",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: c.series[1], opacity: 0.2 },
        itemStyle: { color: c.series[1] },
        silent: true,
      },
      {
        type: "line",
        name: "Observado",
        data: observado,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: { width: 2, color: c.series[0] },
        itemStyle: { color: c.series[0], borderColor: c.superficie, borderWidth: 2 },
      },
      {
        type: "line",
        name: "Previsto",
        data: previsto,
        showSymbol: false,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: { width: 2, color: c.series[1], type: "dashed" },
        itemStyle: { color: c.series[1], borderColor: c.superficie, borderWidth: 2 },
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          lineStyle: { color: c.eixo, width: 1, type: "solid" },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
}

// ------------------------------------------------------- hierarquia (rosca)
// Rosca em anéis: o centro é o nível mais alto e cada anel abre o de baixo.
// Clicar num pedaço o leva para o centro e mostra só os filhos dele (clicar
// no centro volta). Cada ramo do primeiro nível tem uma cor; os filhos ficam
// em tons mais claros da mesma cor, para a hierarquia ler pela cor também.
export type NoHierarquia = { nome: string; valor?: number; filhos?: NoHierarquia[] };

export function opcaoHierarquia(c: Cores, raiz: NoHierarquia[], o: { formato: Formato; unidade: string }): EChartsOption {
  const soma = (n: NoHierarquia): number => n.valor ?? (n.filhos ?? []).reduce((s, f) => s + soma(f), 0);
  const total = raiz.reduce((s, n) => s + soma(n), 0) || 1;
  const converter = (n: NoHierarquia, cor: string, nivel: number): Record<string, unknown> => ({
    name: n.nome,
    value: n.filhos?.length ? undefined : n.valor,
    itemStyle: { color: cor },
    children: n.filhos?.map((f, i) => converter(f, clarear(cor, Math.min(0.6, 0.18 * nivel + 0.08 * (i % 3))), nivel + 1)),
  });
  const rotulo = { color: c.tinta, textBorderColor: c.superficie, textBorderWidth: 2, fontSize: c.compacto ? 9 : 11 };
  const opcao: EChartsOption = {
    backgroundColor: "transparent",
    textStyle: { fontFamily: FONTE, color: c.tinta2 },
    tooltip: {
      ...caixaTooltip(c),
      trigger: "item",
      formatter: (p: unknown) => {
        const ponto = p as { name: string; value: number; color: unknown; treePathInfo?: { name: string }[] };
        const caminho = (ponto.treePathInfo ?? []).map((t) => t.name).filter(Boolean);
        return (
          (caminho.length > 1 ? `<div style="font-size:11px;opacity:.7">${escapar(caminho.slice(0, -1).join(" › "))}</div>` : "") +
          `<div style="font-weight:600">${escapar(ponto.name)}</div>` +
          linhaTooltip(ponto.color, o.formato(ponto.value), `${o.unidade} · ${fmtDec((ponto.value / total) * 100, 1)}% do total`)
        );
      },
    },
    series: [
      {
        type: "sunburst",
        data: raiz.map((n, i) => converter(n, c.series[i], 1)),
        radius: ["12%", "96%"],
        sort: undefined,
        nodeClick: "rootToNode",
        emphasis: { focus: "ancestor" },
        itemStyle: { borderColor: c.superficie, borderWidth: 2 },
        label: { ...rotulo, minAngle: 9, overflow: "truncate" },
        levels: [
          {},
          { r0: "12%", r: "38%", label: { ...rotulo, rotate: 0, width: 90, overflow: "break" } },
          { r0: "38%", r: "66%", label: { ...rotulo, rotate: "radial", width: 80 } },
          { r0: "66%", r: "96%", label: { ...rotulo, rotate: "radial", width: 90, fontSize: c.compacto ? 8 : 10 } },
        ],
      },
    ],
  };
  return comAltura(opcao, c.compacto ? 360 : undefined);
}

// ------------------------------------------------- razão de chances (pontos)
// Um ponto por característica, na escala log (dobro e metade ficam à mesma
// distância do 1), com um traço partindo do 1, que é "o mesmo risco da
// referência". Vermelho: mais risco; verde: menos; cinza e vazado: sem
// diferença estatística (p ≥ 0,05) — a cor nunca é a única pista, o texto
// do valor e a posição dizem o mesmo.
export function opcaoRazaoChances(c: Cores, itens: { rotulo: string; valor: number; p: number }[]): EChartsOption {
  const sig = (i: (typeof itens)[number]) => i.p < 0.05;
  const cor = (i: (typeof itens)[number]) => (!sig(i) ? c.tinta3 : i.valor > 1 ? c.negativo : c.positivo);
  const fmt = (v: number) => `×${fmtDec(v, 2)}`;
  const valores = itens.map((i) => i.valor);
  const [min, max] = [Math.min(0.5, ...valores) * 0.85, Math.max(2, ...valores) * 1.15];
  const opcao: EChartsOption = {
    ...base(c, false, c.compacto ? 30 : 50),
    grid: { left: c.compacto ? 0 : 8, right: c.compacto ? 30 : 56, top: 8, bottom: 26, containLabel: true },
    tooltip: {
      ...caixaTooltip(c),
      trigger: "item",
      formatter: (p: unknown) => {
        const i = itens[(p as Ponto).dataIndex];
        if (!i) return "";
        const leitura = !sig(i) ? "sem diferença estatística da referência" : i.valor > 1 ? `${fmtDec((i.valor - 1) * 100, 0)}% mais chance de desligamento` : `${fmtDec((1 - i.valor) * 100, 0)}% menos chance de desligamento`;
        return `<div style="font-weight:600">${escapar(i.rotulo)}</div>` + linhaTooltip(cor(i), fmt(i.valor), leitura) + `<div style="opacity:.6;margin-top:3px">p = ${i.p < 0.001 ? "< 0,001" : fmtDec(i.p, 3)}</div>`;
      },
    },
    yAxis: eixoCategoria(c, itens.map((i) => i.rotulo), { inverse: true, axisLine: { show: false }, axisLabel: { color: c.tinta2, fontSize: c.compacto ? 10 : 11, width: c.compacto ? 150 : 260, overflow: "truncate" } }),
    xAxis: eixoValor(c, (v) => fmtDec(v, v < 1 ? 2 : 1), { type: "log", logBase: 2, min, max, name: "Chance de desligamento contra a referência (×)", nameLocation: "middle", nameGap: 24, nameTextStyle: { color: c.tinta3, fontSize: 11 } }),
    series: [
      {
        type: "scatter",
        data: itens.map((i) => ({
          value: [i.valor, i.rotulo],
          symbolSize: 11,
          itemStyle: sig(i) ? { color: cor(i), borderColor: c.superficie, borderWidth: 1.5 } : { color: c.superficie, borderColor: c.tinta3, borderWidth: 1.5 },
        })),
        label: { show: true, position: "right", distance: 6, color: c.tinta2, fontSize: 10, formatter: (p: unknown) => fmt(itens[(p as Ponto).dataIndex]?.valor ?? NaN) },
        markLine: {
          silent: true,
          symbol: "none",
          animation: false,
          data: [
            { xAxis: 1, lineStyle: { color: c.tinta3, type: "dashed" as const, width: 1 }, label: { show: true, formatter: "mesmo risco", color: c.tinta3, fontSize: 10, position: "end" as const } },
            ...itens.map((i) => [
              { coord: [1, i.rotulo] },
              { coord: [i.valor, i.rotulo], lineStyle: { color: cor(i), width: 2, type: "solid" as const, opacity: sig(i) ? 0.55 : 0.3 }, label: { show: false } },
            ]),
          ] as never,
        },
        z: 3,
      },
    ],
  };
  return comAltura(opcao, 70 + itens.length * 24);
}
