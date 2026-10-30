import { useEffect, useRef, useState, type ReactNode } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart, MapChart, PieChart, ScatterChart, SunburstChart, TreemapChart } from "echarts/charts";
import {
  DataZoomComponent,
  GeoComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
// Sem ele, todo `labelLayout` (esconder ou afastar rótulos que colidem) é ignorado.
import { LabelLayout } from "echarts/features";
import type { EChartsOption } from "echarts";
import { baixarCsv, baixarImagem } from "../lib/baixar";
import type { Linha } from "../lib/db";
import { useFiltro } from "../lib/filtro";
import type { Termo } from "../lib/glossario";
import { alturaSugerida } from "../lib/graficos";
import { Ajuda, BotaoExpandir } from "./ui";

echarts.use([
  BarChart, LineChart, MapChart, PieChart, ScatterChart, SunburstChart, TreemapChart,
  DataZoomComponent, GeoComponent, GridComponent, LegendComponent, MarkLineComponent, TitleComponent, TooltipComponent, VisualMapComponent,
  CanvasRenderer, LabelLayout,
]);

export type Coluna = { chave: string; rotulo: string; formato?: (v: unknown) => string; numero?: boolean };
export type Tabela = { colunas: Coluna[]; linhas: Linha[] };
// O que o clique numa marca entrega: o nome da categoria (UF, setor, fatia).
// Num gráfico de linhas, `serie` é o nome da linha clicada.
export type Clique = { nome: string; indice: number; serie?: string };

let mapaBR: Promise<void> | null = null;
export function registrarMapaBR(): Promise<void> {
  mapaBR ??= fetch("/geo/br_uf.json")
    .then((r) => r.json())
    .then((geo) => echarts.registerMap("BR", geo));
  return mapaBR;
}

function Grafico({ opcao, altura, aoClicar, registrar }: { opcao: EChartsOption; altura: number; aoClicar?: (c: Clique) => void; registrar?: (g: echarts.ECharts | null) => void }) {
  const elemento = useRef<HTMLDivElement>(null);
  const instancia = useRef<echarts.ECharts | null>(null);
  // Ref: o handler muda a cada render, e re-registrar o evento a cada um
  // custaria mais que ler o atual na hora do clique.
  const clique = useRef(aoClicar);
  clique.current = aoClicar;

  useEffect(() => {
    const el = elemento.current!;
    // Resolução de no mínimo 2x: no modo apresentação o gráfico é ampliado
    // por escala CSS, e o canvas em 1x ficaria borrado no projetor.
    const grafico = echarts.init(el, null, { renderer: "canvas", devicePixelRatio: Math.max(2, window.devicePixelRatio || 1) });
    instancia.current = grafico;
    registrar?.(grafico);
    grafico.on("click", (p) => {
      // Marca de dado traz `name`; rótulo de eixo (triggerEvent) traz `value`.
      const e = p as { name?: unknown; value?: unknown; componentType?: string; seriesName?: string };
      const nome = String((e.componentType?.endsWith("Axis") ? e.value : e.name) ?? "");
      if ((nome && !nome.startsWith("_")) || e.seriesName) clique.current?.({ nome, indice: p.dataIndex, serie: e.seriesName });
    });
    const observador = new ResizeObserver(() => grafico.resize());
    observador.observe(el);
    return () => {
      observador.disconnect();
      registrar?.(null);
      grafico.dispose();
    };
  }, []);

  useEffect(() => {
    instancia.current?.setOption(opcao, true);
  }, [opcao]);

  // Mapa arrasta para navegar: o gesto de trocar de slide não vale sobre ele.
  const semGesto = "geo" in opcao;
  return <div ref={elemento} style={{ height: altura }} className="w-full" data-sem-gesto={semGesto ? "" : undefined} />;
}

function VistaTabela({ tabela }: { tabela: Tabela }) {
  return (
    <div className="max-h-[420px] overflow-auto rounded-xl border border-borda">
      <table className="w-full text-[13px] sm:text-sm">
        <thead className="sticky top-0 z-[1] bg-superficie-2 text-left text-tinta-2">
          <tr>
            {tabela.colunas.map((c, j) => (
              <th
                key={c.chave}
                className={`whitespace-nowrap px-3 py-2 font-medium ${c.numero ? "text-right" : ""} ${j === 0 ? "sticky left-0 bg-superficie-2" : ""}`}
              >
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tabela.linhas.map((l, i) => (
            <tr key={i} className="border-t border-borda odd:bg-superficie even:bg-superficie-2/40">
              {tabela.colunas.map((c, j) => (
                // Primeira coluna (o nome da linha) fica presa ao rolar de lado no celular.
                <td
                  key={c.chave}
                  className={`px-3 py-1.5 ${c.numero ? "whitespace-nowrap text-right tabular-nums" : ""} ${j === 0 ? "sticky left-0 max-w-[11rem] bg-inherit sm:max-w-none" : ""}`}
                >
                  {c.formato ? c.formato(l[c.chave]) : String(l[c.chave] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CartaoGrafico(props: {
  titulo: string;
  subtitulo?: ReactNode;
  opcao: EChartsOption | null;
  altura?: number;
  tabela?: Tabela;
  carregando?: boolean;
  erro?: string | null;
  rodape?: ReactNode;
  className?: string;
  // Clicar numa marca filtra (ver Clique). A dica aparece sob o título.
  aoClicar?: (c: Clique) => void;
  dicaClique?: string;
  // A fonte não tem UF: com o filtro de território ligado, o cartão avisa
  // que continua mostrando o Brasil inteiro.
  nacional?: boolean;
  // Termo do glossário explicado no "?" ao lado do título.
  ajuda?: Termo;
  // Começa fechado: só o título e o subtítulo, e o gráfico abre no clique.
  recolhido?: boolean;
  // O que dizer quando não há o que desenhar (o padrão fala do recorte).
  vazio?: string;
  // Um botão a mais no cabeçalho, antes do menu (ex.: voltar um nível).
  acao?: ReactNode;
}) {
  const [verTabela, setVerTabela] = useState(false);
  const [fechado, setFechado] = useState(!!props.recolhido);
  const filtro = useFiltro();
  const grafico = useRef<echarts.ECharts | null>(null);
  // Rosca e mosaico (e, no celular, barras horizontais) dizem a altura de que
  // precisam; o resto usa a do cartão.
  const altura = alturaSugerida(props.opcao) ?? props.altura ?? 320;
  const baixarPng = () => {
    const g = grafico.current;
    if (!g) return;
    const fundo = getComputedStyle(document.documentElement).getPropertyValue("--superficie").trim() || "#ffffff";
    baixarImagem(g.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: fundo }), props.titulo);
  };
  const mostraGrafico = !verTabela && !!props.opcao && !props.erro;
  return (
    <figure className={`cartao p-4 sm:p-5 ${props.className ?? ""}`}>
      <figcaption className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold leading-snug text-tinta">
            {props.titulo}
            {props.ajuda && <Ajuda termo={props.ajuda} />}
          </h3>
          {props.subtitulo && <p className="mt-0.5 text-[13px] text-tinta-3">{props.subtitulo}</p>}
          {props.nacional && filtro.ativo && <SeloNacional />}
          {props.aoClicar && props.dicaClique && !verTabela && <p className="mt-1 text-[12px] font-medium text-serie-1">{props.dicaClique}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.recolhido && <BotaoExpandir aberto={!fechado} aoAlternar={() => setFechado((v) => !v)} rotulo="Mostrar gráfico" />}
          {!fechado && props.acao}
          {!fechado && verTabela && (
            <button
              type="button"
              onClick={() => setVerTabela(false)}
              className="rounded-full border border-borda px-3 py-1.5 text-[12px] font-medium text-tinta-2 transition-colors hover:border-serie-1 hover:text-tinta"
            >
              Ver gráfico
            </button>
          )}
          {!fechado && (
            <MenuGrafico
              titulo={props.titulo}
              itens={[
                props.tabela && !verTabela ? { rotulo: "Ver tabela", icone: ICONE_TABELA, aoEscolher: () => setVerTabela(true) } : null,
                props.tabela && props.tabela.linhas.length > 0
                  ? { rotulo: "Baixar dados (CSV)", icone: ICONE_CSV, aoEscolher: () => baixarCsv(props.tabela!.colunas, props.tabela!.linhas, props.titulo) }
                  : null,
                mostraGrafico ? { rotulo: "Baixar imagem (PNG)", icone: ICONE_PNG, aoEscolher: baixarPng } : null,
              ]}
            />
          )}
        </div>
      </figcaption>
      {!fechado && (
      <div className={`transition-opacity duration-200 ${props.carregando ? "opacity-50" : ""}`}>
        {props.erro ? (
          <p className="flex items-center text-sm text-tinta-2" style={{ minHeight: altura }}>
            Não foi possível carregar: {props.erro}
          </p>
        ) : verTabela && props.tabela ? (
          <VistaTabela tabela={props.tabela} />
        ) : props.opcao ? (
          <Grafico opcao={props.opcao} altura={altura} aoClicar={props.aoClicar} registrar={(g) => (grafico.current = g)} />
        ) : props.carregando ? (
          <div className="animate-pulse rounded-xl bg-gradient-to-br from-superficie-2 to-serie-1/10" style={{ height: altura }} />
        ) : (
          <p className="grid place-items-center text-sm text-tinta-3" style={{ height: altura }}>{props.vazio ?? "Sem dados para este recorte."}</p>
        )}
      </div>
      )}
      {!fechado && props.rodape && <div className="mt-3 text-[12px] leading-relaxed text-tinta-3">{props.rodape}</div>}
    </figure>
  );
}

// Ícones do menu, no grid de 20×20.
const ICONE_TABELA = "M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Zm2 1v2.5h10V5H5Zm10 4.5H11v2h4v-2Zm0 4H11V15h4v-1.5ZM9 15v-1.5H5V15h4Zm-4-3.5h4v-2H5v2Z";
export const ICONE_CSV = "M10 3a1 1 0 0 1 1 1v6.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L9 10.6V4a1 1 0 0 1 1-1ZM4 15a1 1 0 0 1 1 1h10a1 1 0 1 1 0 2H5a2 2 0 0 1-2-2 1 1 0 0 1 1-1Z";
const ICONE_PNG = "M3 4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Zm2 1v8.6l3.3-3.3a1 1 0 0 1 1.4 0l1.8 1.8 1.3-1.3a1 1 0 0 1 1.4 0L15 12.6V5H5Zm7.5 1.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z";

type ItemMenu = { rotulo: string; icone: string; aoEscolher: () => void };

// As ações de um cartão (tabela, CSV, PNG) num menu só, atrás dos três
// pontos: o título fica com a largura toda, e todo gráfico tem as ações no
// mesmo lugar. Fecha ao escolher, com Esc ou com um clique fora.
export function MenuGrafico({ titulo, itens }: { titulo: string; itens: (ItemMenu | null)[] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const visiveis = itens.filter((i): i is ItemMenu => i !== null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    const tecla = (e: KeyboardEvent) => {
      const opcoes = [...(caixa.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? [])];
      const atual = opcoes.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "Escape") {
        setAberto(false);
        caixa.current?.querySelector<HTMLButtonElement>("[aria-haspopup]")?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        opcoes[(atual + (e.key === "ArrowDown" ? 1 : -1) + opcoes.length) % opcoes.length]?.focus();
      }
    };
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    caixa.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);
  if (!visiveis.length) return null;
  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={`Opções do gráfico: ${titulo}`}
        title="Tabela e downloads"
        className={`grid h-8 w-8 place-items-center rounded-full border text-tinta-2 transition-colors hover:border-serie-1 hover:text-tinta ${aberto ? "border-serie-1 text-tinta" : "border-borda"}`}
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden>
          <circle cx="10" cy="4.5" r="1.6" />
          <circle cx="10" cy="10" r="1.6" />
          <circle cx="10" cy="15.5" r="1.6" />
        </svg>
      </button>
      {aberto && (
        <div role="menu" className="absolute right-0 top-full z-30 mt-1.5 min-w-[13rem] rounded-xl border border-borda bg-superficie p-1 shadow-lg">
          {visiveis.map((item) => (
            <button
              key={item.rotulo}
              type="button"
              role="menuitem"
              onClick={() => {
                setAberto(false);
                item.aoEscolher();
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[13px] text-tinta-2 outline-none transition-colors hover:bg-superficie-2 hover:text-tinta focus-visible:bg-superficie-2 focus-visible:text-tinta"
            >
              <svg viewBox="0 0 20 20" className="h-4 w-4 flex-none fill-current text-tinta-3" aria-hidden>
                <path d={item.icone} />
              </svg>
              {item.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function SeloNacional() {
  return (
    <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-superficie-2 px-2.5 py-0.5 text-[11px] font-medium text-tinta-2">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-tinta-3" />
      Brasil inteiro · esta fonte não tem recorte por estado
    </p>
  );
}

export function CartaoTabela({ titulo, subtitulo, tabela, rodape, nacional, acao, ajuda }: { titulo: string; subtitulo?: ReactNode; tabela: Tabela; rodape?: ReactNode; nacional?: boolean; acao?: ReactNode; ajuda?: Termo }) {
  const filtro = useFiltro();
  return (
    <figure className="cartao p-4 sm:p-5">
      <figcaption className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold leading-snug text-tinta">
            {titulo}
            {ajuda && <Ajuda termo={ajuda} />}
          </h3>
          {subtitulo && <p className="mt-0.5 text-[13px] text-tinta-3">{subtitulo}</p>}
          {nacional && filtro.ativo && <SeloNacional />}
        </div>
        <div className="flex items-end gap-3">
          {acao}
          <MenuGrafico
            titulo={titulo}
            itens={[tabela.linhas.length > 0 ? { rotulo: "Baixar dados (CSV)", icone: ICONE_CSV, aoEscolher: () => baixarCsv(tabela.colunas, tabela.linhas, titulo) } : null]}
          />
        </div>
      </figcaption>
      <VistaTabela tabela={tabela} />
      {rodape && <div className="mt-3 text-[12px] leading-relaxed text-tinta-3">{rodape}</div>}
    </figure>
  );
}
