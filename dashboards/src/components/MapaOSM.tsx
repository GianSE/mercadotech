import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTema } from "../lib/tema";
import { lerTinta, type Tinta } from "./Grafico";

/*
 * O mapa da seção Onde, sobre o OpenStreetMap (Leaflet). Dois níveis:
 *
 *   Brasil  — os estados pintados pela métrica (coroplético), com um pino em
 *             cada estado escolhido no filtro de território;
 *   estado  — o estado escolhido em destaque e os municípios dele como bolhas:
 *             o tamanho é o número de vínculos, a cor é a métrica.
 *
 * Clicar num estado ou num município é com a página (aoEscolherUF,
 * aoEscolherMunicipio): o mapa só desenha o que recebe. As cores são as do
 * tema (a rampa azul validada para valores; verde e vermelho para o saldo,
 * que tem sinal), e a legenda é HTML, abaixo do mapa.
 */

export type ValorUF = { uf: string; valor: number | null };
export type Municipio = { cod: string; nome: string; uf: string; lat: number; lon: number; valor: number | null; estoque: number };
type Formato = (v: number) => string;

type Props = {
  estados: ValorUF[];
  /** municípios do estado em foco; null no nível Brasil */
  municipios: Municipio[] | null;
  foco: string | null;
  /** estados com pino (os escolhidos no filtro) */
  marcados: string[];
  municipioEscolhido: string | null;
  /** o saldo tem sinal: verde para cima, vermelho para baixo, cinza perto do zero */
  divergente: boolean;
  formato: Formato;
  nomeMetrica: string;
  altura: number;
  rotulo: string;
  aoEscolherUF: (uf: string) => void;
  aoEscolherMunicipio: (cod: string) => void;
};

let geojson: Promise<GeoJSON.FeatureCollection> | null = null;
const carregarEstados = () => (geojson ??= fetch("/geo/br_uf.json").then((r) => r.json()));

function misturar(a: string, b: string, t: number): string {
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [rgb(a), rgb(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

export type Classe = { cor: string; ate: number; de: number };

/**
 * Cinco classes por quantis dos valores, cada uma com um degrau da rampa. No
 * divergente, os negativos e os positivos têm as próprias classes (vermelho e
 * verde, mais forte quanto mais longe do zero), e o zero fica no cinza.
 */
export function classesDe(valores: number[], t: Tinta, divergente: boolean): Classe[] {
  const ordenados = [...valores].filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordenados.length) return [];
  const q = (lista: number[], p: number) => lista[Math.min(lista.length - 1, Math.floor(p * lista.length))];
  if (!divergente) {
    const cortes = [0.2, 0.4, 0.6, 0.8].map((p) => q(ordenados, p));
    const limites = [ordenados[0], ...cortes, ordenados.at(-1)!];
    return t.sequencial.map((cor, i) => ({ cor, de: limites[i], ate: limites[i + 1] }));
  }
  const neg = ordenados.filter((v) => v < 0).map(Math.abs).sort((a, b) => a - b);
  const pos = ordenados.filter((v) => v > 0);
  const meioNeg = neg.length ? q(neg, 0.5) : 0;
  const meioPos = pos.length ? q(pos, 0.5) : 0;
  return [
    { cor: t.desce, de: -Infinity, ate: -meioNeg },
    { cor: misturar(t.desce, t.fundo, 0.45), de: -meioNeg, ate: 0 },
    { cor: t.rotulo, de: 0, ate: 0 },
    { cor: misturar(t.sobe, t.fundo, 0.45), de: 0, ate: meioPos },
    { cor: t.sobe, de: meioPos, ate: Infinity },
  ];
}

function corDe(v: number | null, classes: Classe[], divergente: boolean, vazio: string): string {
  if (v === null || !Number.isFinite(v) || !classes.length) return vazio;
  if (divergente) {
    if (v === 0) return classes[2].cor;
    if (v < 0) return v < classes[0].ate ? classes[0].cor : classes[1].cor;
    return v > classes[4].de ? classes[4].cor : classes[3].cor;
  }
  return (classes.find((c) => v <= c.ate) ?? classes.at(-1)!).cor;
}

/**
 * O conteúdo de um tooltip: nomes de estado e município são dados, então vão
 * como texto (textContent), nunca montados em HTML.
 */
function dica(titulo: string, linha: string): HTMLElement {
  const caixa = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = titulo;
  const l = document.createElement("div");
  l.textContent = linha;
  caixa.append(b, l);
  return caixa;
}

/** O pino dos estados escolhidos e do município escolhido: SVG na cor principal do tema. */
function pino(cor: string, rotulo: string) {
  const caixa = document.createElement("div");
  caixa.style.cssText = "display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);width:max-content";
  const nome = document.createElement("span");
  nome.textContent = rotulo;
  nome.style.cssText = `font:600 11px/1.2 system-ui,sans-serif;padding:2px 6px;border-radius:999px;background:${cor};color:#fff;white-space:nowrap;margin-bottom:2px;box-shadow:0 1px 3px rgba(0,0,0,.35)`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "30");
  svg.setAttribute("viewBox", "0 0 22 30");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<path d="M11 0C4.9 0 0 4.9 0 11c0 7.6 11 19 11 19s11-11.4 11-19C22 4.9 17.1 0 11 0z" fill="${cor}" stroke="#fff" stroke-width="1.5"/><circle cx="11" cy="11" r="4" fill="#fff"/>`;
  caixa.append(nome, svg);
  return L.divIcon({ className: "pino-mapa", html: caixa, iconSize: [0, 0] });
}

export function MapaOSM(p: Props) {
  const div = useRef<HTMLDivElement>(null);
  const mapa = useRef<L.Map | null>(null);
  const camadas = useRef<{ estados?: L.GeoJSON; municipios?: L.LayerGroup; pinos?: L.LayerGroup }>({});
  const [geo, setGeo] = useState<GeoJSON.FeatureCollection | null>(null);
  const voou = useRef<string | null>(null);
  const { tema } = useTema();
  // As callbacks mudam a cada render; o Leaflet guarda as da criação da camada.
  const ref = useRef(p);
  ref.current = p;

  useEffect(() => {
    carregarEstados().then(setGeo, () => {});
  }, []);

  // O mapa nasce uma vez. A roda do mouse só dá zoom depois de um clique no
  // mapa: senão rolar a página por cima dele prenderia a rolagem.
  useEffect(() => {
    if (!div.current) return;
    const m = L.map(div.current, { preferCanvas: true, zoomSnap: 0.25, scrollWheelZoom: false, attributionControl: true, minZoom: 3 });
    m.attributionControl.setPrefix(false);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    m.on("click", () => m.scrollWheelZoom.enable());
    m.on("mouseout", () => m.scrollWheelZoom.disable());
    m.setView([-14.5, -52], 4);
    mapa.current = m;
    const observador = new ResizeObserver(() => m.invalidateSize());
    observador.observe(div.current);
    return () => {
      observador.disconnect();
      m.remove();
      mapa.current = null;
    };
  }, []);

  // As cores do tema: relidas quando o tema troca.
  const tinta = useMemo(() => lerTinta(), [tema]);
  const classesEstados = useMemo(() => classesDe(p.estados.map((e) => e.valor ?? NaN), tinta, p.divergente), [p.estados, tinta, p.divergente]);
  const classesMunicipios = useMemo(
    () => (p.municipios ? classesDe(p.municipios.map((m) => m.valor ?? NaN), tinta, p.divergente) : []),
    [p.municipios, tinta, p.divergente],
  );

  // ------------------------------------------------------------ estados
  useEffect(() => {
    const m = mapa.current;
    if (!m || !geo) return;
    camadas.current.estados?.remove();
    const porUF = new Map(p.estados.map((e) => [e.uf, e.valor]));
    const estilo = (f?: GeoJSON.Feature): L.PathOptions => {
      const uf = String(f?.properties?.sigla);
      const emFoco = p.foco === uf;
      const apagado = p.foco !== null && !emFoco;
      return {
        color: emFoco ? tinta.texto : tinta.fundo,
        weight: emFoco ? 2.5 : 1,
        fillColor: corDe(porUF.get(uf) ?? null, classesEstados, p.divergente, tinta.grade),
        // No estado em foco o preenchimento some, para as bolhas aparecerem.
        fillOpacity: emFoco ? 0.04 : apagado ? 0.12 : 0.72,
      };
    };
    const camada = L.geoJSON(geo, {
      style: estilo,
      onEachFeature: (f, l) => {
        const uf = String(f.properties?.sigla);
        const v = porUF.get(uf);
        l.bindTooltip(dica(String(f.properties?.estado ?? uf), `${ref.current.nomeMetrica}: ${v === null || v === undefined ? "—" : ref.current.formato(v)}`), { sticky: true });
        l.on({
          mouseover: (e) => (e.target as L.Path).setStyle({ weight: 2.5, color: tinta.texto }),
          mouseout: (e) => camada.resetStyle(e.target as L.Path),
          click: () => ref.current.aoEscolherUF(uf),
        });
      },
    }).addTo(m);
    camadas.current.estados = camada;
  }, [geo, p.estados, p.foco, classesEstados, p.divergente, tinta]);

  // O enquadramento muda só quando muda o nível (o estado em foco, ou o
  // Brasil), e não a cada troca de métrica ou de ano: o zoom de quem está
  // olhando um município fica onde está.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !geo) return;
    const alvo = p.foco ? geo.features.find((f) => f.properties?.sigla === p.foco) : null;
    m.flyToBounds(L.geoJSON(alvo ?? geo).getBounds(), { padding: [16, 16], duration: 0.8 });
  }, [geo, p.foco]);

  // --------------------------------------------------------- municípios
  useEffect(() => {
    const m = mapa.current;
    if (!m) return;
    camadas.current.municipios?.remove();
    if (!p.municipios?.length) return;
    const maior = Math.max(...p.municipios.map((x) => x.estoque), 1);
    const grupo = L.layerGroup();
    // Os maiores primeiro, para os pequenos ficarem por cima e clicáveis.
    for (const x of [...p.municipios].sort((a, b) => b.estoque - a.estoque)) {
      const raio = 3 + 22 * Math.sqrt(x.estoque / maior);
      const c = L.circleMarker([x.lat, x.lon], {
        radius: raio,
        color: tinta.fundo,
        weight: 1,
        fillColor: corDe(x.valor, classesMunicipios, p.divergente, tinta.grade),
        fillOpacity: 0.82,
      });
      c.bindTooltip(dica(x.nome, `${ref.current.nomeMetrica}: ${x.valor === null ? "—" : ref.current.formato(x.valor)}`));
      c.on("click", () => ref.current.aoEscolherMunicipio(x.cod));
      grupo.addLayer(c);
    }
    grupo.addTo(m);
    camadas.current.municipios = grupo;
  }, [p.municipios, classesMunicipios, p.divergente, tinta]);

  // -------------------------------------------------------------- pinos
  useEffect(() => {
    const m = mapa.current;
    if (!m || !geo) return;
    camadas.current.pinos?.remove();
    const grupo = L.layerGroup();
    const cor = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#0d8241";
    const centros = new Map(
      geo.features.map((f) => [String(f.properties?.sigla), L.geoJSON(f).getBounds().getCenter()]),
    );
    // Um pino por estado escolhido (no nível Brasil); no estado, o pino vai
    // para o município escolhido.
    // Com muitos estados no filtro (uma região, o Brasil sem SP), os pinos
    // cobririam o mapa: aí a própria escala, que só pinta os escolhidos, já
    // mostra o recorte.
    if (!p.foco && p.marcados.length <= 4) {
      for (const uf of p.marcados) {
        const c = centros.get(uf);
        if (c) L.marker(c, { icon: pino(cor, uf), keyboard: false }).on("click", () => ref.current.aoEscolherUF(uf)).addTo(grupo);
      }
    }
    const escolhido = p.municipios?.find((x) => x.cod === p.municipioEscolhido);
    if (escolhido) {
      L.marker([escolhido.lat, escolhido.lon], { icon: pino(cor, escolhido.nome), keyboard: false, zIndexOffset: 1000 }).addTo(grupo);
      // Voa até o município uma vez por escolha (o mesmo efeito roda de novo
      // quando os dados recarregam, e aí não deve mexer no zoom).
      if (voou.current !== escolhido.cod) {
        voou.current = escolhido.cod;
        // Espera o enquadramento do estado terminar, quando o estado também mudou.
        window.setTimeout(() => m.flyTo([escolhido.lat, escolhido.lon], Math.max(m.getZoom(), 9), { duration: 0.9 }), 850);
      }
    } else {
      voou.current = null;
    }
    grupo.addTo(m);
    camadas.current.pinos = grupo;
  }, [geo, p.marcados, p.foco, p.municipios, p.municipioEscolhido]);

  const classes = p.municipios ? classesMunicipios : classesEstados;
  return (
    <div className="flex flex-col gap-3">
      <div ref={div} role="region" aria-label={p.rotulo} className="mapa-osm z-0 w-full overflow-hidden rounded-lg border" style={{ height: p.altura }} />
      <Legenda classes={classes} divergente={p.divergente} formato={p.formato} titulo={`${p.nomeMetrica}${p.municipios ? " · bolha = vínculos" : ""}`} />
    </div>
  );
}

function Legenda({ classes, divergente, formato, titulo }: { classes: Classe[]; divergente: boolean; formato: Formato; titulo: string }) {
  if (!classes.length) return null;
  const rotulos = divergente
    ? ["mais desligamentos", "", "perto de zero", "", "mais admissões"]
    : classes.map((c, i) => (i === 0 ? `até ${formato(c.ate)}` : i === classes.length - 1 ? `mais de ${formato(c.de)}` : ""));
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{titulo}</span>
      <span className="flex items-center gap-1.5">
        {classes.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="h-2.5 w-6 rounded-sm" style={{ background: c.cor }} aria-hidden />
            {rotulos[i] && <span>{rotulos[i]}</span>}
          </span>
        ))}
      </span>
    </div>
  );
}
