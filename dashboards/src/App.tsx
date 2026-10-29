import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { obterManifesto } from "./lib/db";
import { useFiltro } from "./lib/filtro";
import { useTema } from "./lib/tema";
import { partesHash } from "./lib/url";

type Rota = { id: string; rotulo: string; curto: string; componente: ComponentType };

const ROTAS: Rota[] = [
  { id: "pesquisa", rotulo: "Visão geral", curto: "Início", componente: lazy(() => import("./secoes/Pesquisa")) },
  { id: "crescimento", rotulo: "1 · Crescimento", curto: "1", componente: lazy(() => import("./secoes/Crescimento")) },
  { id: "onde", rotulo: "2 · Onde", curto: "2", componente: lazy(() => import("./secoes/Onde")) },
  { id: "salario", rotulo: "3a · Salário", curto: "3a", componente: lazy(() => import("./secoes/Salario")) },
  { id: "permanencia", rotulo: "3b · Permanência", curto: "3b", componente: lazy(() => import("./secoes/Permanencia")) },
  { id: "equidade", rotulo: "4 · Equidade", curto: "4", componente: lazy(() => import("./secoes/Equidade")) },
  { id: "futuro", rotulo: "5 · Futuro", curto: "5", componente: lazy(() => import("./secoes/Futuro")) },
  // A única página com texto: respostas, leitura dos números, ressalvas e método.
  { id: "analise", rotulo: "Análise", curto: "Análise", componente: lazy(() => import("./secoes/Analise")) },
];

function rotaAtual(): string {
  const { rota } = partesHash();
  // A antiga página da pergunta 3 virou 3a e 3b: o link velho cai na 3a.
  const id = rota === "qualidade" ? "salario" : rota;
  return ROTAS.some((r) => r.id === id) ? id : "pesquisa";
}

function BotaoTema() {
  const { modo, alternar } = useTema();
  const escuro = modo === "escuro";
  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={escuro ? "Usar tema claro" : "Usar tema escuro"}
      title={escuro ? "Tema claro" : "Tema escuro"}
      className="grid h-10 w-10 flex-none place-items-center rounded-full text-sobre-marca/80 transition-colors hover:bg-white/10 hover:text-sobre-marca"
    >
      {escuro ? (
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] fill-current" aria-hidden>
          <path d="M10 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-12a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 13a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1ZM3 9h1a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2Zm13 0h1a1 1 0 1 1 0 2h-1a1 1 0 1 1 0-2Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] fill-current" aria-hidden>
          <path d="M17.3 13.4A8 8 0 0 1 6.6 2.7a8 8 0 1 0 10.7 10.7Z" />
        </svg>
      )}
    </button>
  );
}

function BotaoApresentar({ aoClicar }: { aoClicar: () => void }) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      aria-label="Modo apresentação"
      title="Apresentar (tela cheia, um bloco por vez; setas ou arrastar para avançar)"
      className="grid h-10 w-10 flex-none place-items-center rounded-full text-sobre-marca/80 transition-colors hover:bg-white/10 hover:text-sobre-marca"
    >
      <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] fill-current" aria-hidden>
        <path d="M2 4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-6v2h3v1.5H6V16h3v-2H3a1 1 0 0 1-1-1V4Zm6.5 2.2v5.6L13 9 8.5 6.2Z" />
      </svg>
    </button>
  );
}

// O endereço já guarda página e recorte; o botão só o copia, com confirmação.
function BotaoLink() {
  const [copiado, setCopiado] = useState(false);
  const copiar = () => {
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => {
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1800);
      })
      .catch(() => {});
  };
  return (
    <button
      type="button"
      onClick={copiar}
      aria-label="Copiar link deste recorte"
      title="Copiar link deste recorte (página, estados e filtros)"
      className="relative grid h-10 w-10 flex-none place-items-center rounded-full text-sobre-marca/80 transition-colors hover:bg-white/10 hover:text-sobre-marca"
    >
      <svg viewBox="0 0 20 20" className="h-[18px] w-[18px] fill-current" aria-hidden>
        {copiado ? (
          <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />
        ) : (
          <path d="M8.6 11.4a1 1 0 0 1 0-1.4l2.8-2.8a1 1 0 1 1 1.4 1.4L10 11.4a1 1 0 0 1-1.4 0ZM6.4 9.2 5.2 10.4a2.5 2.5 0 0 0 3.5 3.5l1.2-1.2a1 1 0 1 1 1.4 1.4l-1.2 1.2a4.5 4.5 0 0 1-6.4-6.4L5 7.8a1 1 0 0 1 1.4 1.4Zm7.2 1.6a1 1 0 0 1 0-1.4l1.2-1.2a2.5 2.5 0 0 0-3.5-3.5L10.1 5.9a1 1 0 0 1-1.4-1.4l1.2-1.2a4.5 4.5 0 0 1 6.4 6.4L15 10.8a1 1 0 0 1-1.4 0Z" />
        )}
      </svg>
      <span role="status" className={`pointer-events-none absolute right-0 top-11 whitespace-nowrap rounded-full bg-acento px-2.5 py-1 text-[12px] font-semibold text-sobre-acento shadow transition-opacity ${copiado ? "opacity-100" : "opacity-0"}`}>
        Link copiado
      </span>
    </button>
  );
}

// Teclado: setas e as teclas de passador de slides (PageUp/PageDown) não
// valem com o foco num campo — lá elas movem o cursor ou trocam a opção.
const emCampo = (alvo: EventTarget | null) =>
  alvo instanceof HTMLElement && (["INPUT", "SELECT", "TEXTAREA"].includes(alvo.tagName) || alvo.isContentEditable);

// Divide a página em slides: cada [data-bloco] de primeiro nível é um; o que
// é [data-fixo] (pergunta e filtros) ou <header> aparece em todos; o resto
// (KPIs soltos, avisos) vai junto do primeiro. Página sem bloco é um slide só.
function aplicarSlides(pagina: HTMLElement, apresentando: boolean, indice: number): number {
  const blocos = Array.from(pagina.querySelectorAll<HTMLElement>("[data-bloco]")).filter((b) => !b.parentElement?.closest("[data-bloco]"));
  if (!apresentando) {
    pagina.querySelectorAll("[data-oculto]").forEach((e) => e.removeAttribute("data-oculto"));
    return Math.max(1, blocos.length);
  }
  const i = Math.min(indice, Math.max(0, blocos.length - 1));
  blocos.forEach((b, j) => b.toggleAttribute("data-oculto", j !== i));
  for (const filho of Array.from(pagina.children) as HTMLElement[]) {
    if (filho.hasAttribute("data-bloco") || filho.hasAttribute("data-fixo") || filho.tagName === "HEADER" || filho.querySelector("[data-bloco]")) continue;
    filho.toggleAttribute("data-oculto", blocos.length > 0 && i !== 0);
  }
  return Math.max(1, blocos.length);
}

// Com o território filtrado, o cabeçalho mostra o recorte em toda página —
// inclusive nas que não têm barra de filtros —, com um toque para desfazer.
function SeloTerritorio() {
  const f = useFiltro();
  if (!f.ativo) return null;
  return (
    <button
      type="button"
      onClick={f.limpar}
      title="Remover o filtro de território"
      // Só no largo: no celular a barra já está cheia, e o resumo da gaveta de
      // filtros (e o aviso das páginas nacionais) mostra o recorte.
      className="hidden h-8 max-w-[14rem] flex-none items-center gap-1.5 rounded-full bg-acento pl-3 pr-2 text-[12px] font-semibold text-sobre-acento sm:flex"
    >
      <span className="truncate">{f.rotulo}</span>
      <svg viewBox="0 0 20 20" aria-hidden className="h-3.5 w-3.5 flex-none fill-current">
        <path d="M5.7 4.3 10 8.6l4.3-4.3 1.4 1.4-4.3 4.3 4.3 4.3-1.4 1.4-4.3-4.3-4.3 4.3-1.4-1.4 4.3-4.3-4.3-4.3 1.4-1.4Z" />
      </svg>
      <span className="sr-only">remover filtro</span>
    </button>
  );
}

export default function App() {
  const [rota, setRota] = useState(rotaAtual);
  const [atualizado, setAtualizado] = useState<string | null>(null);

  // Modo apresentação: tela cheia, um bloco por vez, escalado para caber sem
  // rolagem. `slide` pode passar do total (Infinity = "o último"), e o índice
  // efetivo é limitado ao total da página quando ela termina de montar.
  const [apresentando, setApresentando] = useState(false);
  const [slide, setSlide] = useState(0);
  const [total, setTotal] = useState(1);
  const [escala, setEscala] = useState({ s: 1, y: 0 });
  const irParaFim = useRef(false);
  const telaCheia = useRef(false);
  const pagina = useRef<HTMLDivElement>(null);
  const conteudo = useRef<HTMLElement>(null);
  const atual = Math.min(slide, total - 1);

  useEffect(() => {
    const aoMudar = () => {
      setRota(rotaAtual());
      // Voltando de uma página para a anterior, a apresentação entra no último bloco dela.
      setSlide(irParaFim.current ? Infinity : 0);
      irParaFim.current = false;
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  // A página monta aos poucos (seção carregada sob demanda, dados chegando):
  // os slides são recontados a cada mudança na árvore.
  useLayoutEffect(() => {
    const el = pagina.current;
    if (!el) return;
    let quadro = 0;
    const recontar = () => setTotal(aplicarSlides(el, apresentando, atual));
    recontar();
    const observador = new MutationObserver(() => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(recontar);
    });
    observador.observe(el, { childList: true, subtree: true });
    return () => {
      observador.disconnect();
      cancelAnimationFrame(quadro);
    };
  }, [apresentando, atual, rota]);

  // Escala que faz o bloco caber na tela (e crescer até 1,6x num projetor),
  // descontando a barra de controles embaixo.
  useLayoutEffect(() => {
    const el = conteudo.current;
    if (!apresentando || !el) return;
    const medir = () => {
      const altura = window.innerHeight - 64;
      const largura = window.innerWidth - 16;
      const s = Math.min(altura / el.offsetHeight, largura / el.offsetWidth, 1.6);
      setEscala({ s, y: Math.max(0, (altura - el.offsetHeight * s) / 2) });
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(el);
    window.addEventListener("resize", medir);
    return () => {
      observador.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [apresentando]);

  const entrar = useCallback(() => {
    setApresentando(true);
    // Sem suporte (iPhone) ou recusada, a apresentação segue sem tela cheia.
    document.documentElement.requestFullscreen?.().then(() => (telaCheia.current = true)).catch(() => {});
  }, []);
  const sair = useCallback(() => {
    setApresentando(false);
    telaCheia.current = false;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);

  useEffect(() => {
    // Esc sai da tela cheia pelo navegador: sai da apresentação junto.
    const aoMudar = () => {
      if (!document.fullscreenElement && telaCheia.current) sair();
    };
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, [sair]);

  useEffect(() => {
    document.documentElement.style.overflow = apresentando ? "hidden" : "";
  }, [apresentando]);

  useEffect(() => {
    obterManifesto()
      .then((m) => setAtualizado(new Date(m.gerado_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })))
      .catch(() => setAtualizado(null));
  }, []);

  const indice = ROTAS.findIndex((r) => r.id === rota);
  const Secao = ROTAS[indice].componente;
  const anterior = ROTAS[indice - 1];
  const proxima = ROTAS[indice + 1];

  // Fora da apresentação, as setas trocam de página; dentro, de bloco, e no
  // fim da página seguem para a próxima.
  const avancar = () => {
    if (apresentando && atual < total - 1) return setSlide(atual + 1);
    if (proxima) window.location.hash = `#/${proxima.id}`;
  };
  const voltar = () => {
    if (apresentando && atual > 0) return setSlide(atual - 1);
    if (!anterior) return;
    irParaFim.current = apresentando;
    window.location.hash = `#/${anterior.id}`;
  };
  // Os ouvintes são registrados uma vez e leem sempre a versão atual.
  const acoes = useRef({ avancar, voltar, sair, apresentando });
  acoes.current = { avancar, voltar, sair, apresentando };

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || emCampo(e.target)) return;
      const a = acoes.current;
      const frente = a.apresentando ? ["ArrowRight", "PageDown", " "] : ["ArrowRight"];
      const tras = a.apresentando ? ["ArrowLeft", "PageUp"] : ["ArrowLeft"];
      if (frente.includes(e.key)) {
        e.preventDefault();
        a.avancar();
      } else if (tras.includes(e.key)) {
        e.preventDefault();
        a.voltar();
      } else if (e.key === "Escape" && a.apresentando) {
        a.sair();
      }
    };
    // Arrastar para o lado (só na apresentação). O mapa, que arrasta para
    // navegar, marca-se com data-sem-gesto e fica de fora.
    let x0 = 0, y0 = 0, t0 = 0, valido = false;
    const aoTocar = (e: TouchEvent) => {
      valido = acoes.current.apresentando && e.touches.length === 1 && !(e.target as Element).closest?.("[data-sem-gesto]");
      [x0, y0, t0] = [e.touches[0].clientX, e.touches[0].clientY, Date.now()];
    };
    const aoSoltar = (e: TouchEvent) => {
      if (!valido) return;
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      if (Date.now() - t0 < 800 && Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
        if (dx < 0) acoes.current.avancar();
        else acoes.current.voltar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    window.addEventListener("touchstart", aoTocar, { passive: true });
    window.addEventListener("touchend", aoSoltar, { passive: true });
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      window.removeEventListener("touchstart", aoTocar);
      window.removeEventListener("touchend", aoSoltar);
    };
  }, []);

  return (
    <div className={apresentando ? "apresentando fixed inset-0 z-50 overflow-hidden bg-fundo" : "min-h-screen"}>
      {/* A árvore é a mesma nos dois modos (só esconde partes): trocar de modo
          não remonta a página nem perde filtros e escolhas. */}
      {!apresentando && (
      <header className="sticky top-0 z-20 border-b border-white/10 bg-marca text-sobre-marca">
        <div className="brilho-marca">
        <div className="grade-marca">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
            <a href="#/pesquisa" className="flex min-w-0 flex-none items-center gap-2.5" aria-label="Início">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-acento shadow-[0_0_18px_rgb(255_194_14/.35)]" aria-hidden>
                <svg viewBox="0 0 16 16" className="h-4 w-4 fill-sobre-acento">
                  <rect x="2" y="8" width="3" height="6" rx="0.75" />
                  <rect x="6.5" y="5" width="3" height="9" rx="0.75" />
                  <rect x="11" y="2" width="3" height="12" rx="0.75" />
                </svg>
              </span>
              <span className="leading-tight">
                <span className="block text-[14px] font-semibold">
                  Mercado de TI<span className="hidden sm:inline"> no Brasil</span>
                </span>
                <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-sobre-marca/60">RAIS + CAGED<span className="hidden sm:inline"> · 2007–2026</span></span>
              </span>
            </a>
            <nav className="hidden flex-1 justify-center lg:flex" aria-label="Seções">
              <ul className="flex gap-1">
                {ROTAS.map((r) => (
                  <li key={r.id}>
                    <a
                      href={`#/${r.id}`}
                      aria-current={rota === r.id ? "page" : undefined}
                      className={`relative block whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] transition-colors ${
                        rota === r.id ? "bg-white/10 text-sobre-marca after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-acento" : "text-sobre-marca/65 hover:bg-white/5 hover:text-sobre-marca"
                      }`}
                    >
                      {r.rotulo}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            {/* Celular: a navegação é um seletor nativo na própria barra — uma
                linha só, para o filtro preso logo abaixo não perder espaço. */}
            <label className="relative ml-auto min-w-0 lg:hidden">
              <span className="sr-only">Seção</span>
              <select
                value={rota}
                onChange={(e) => {
                  window.location.hash = `#/${e.target.value}`;
                }}
                className="h-10 w-full max-w-[11.5rem] appearance-none truncate rounded-full border border-white/15 bg-white/10 pl-4 pr-9 text-[14px] font-medium text-sobre-marca"
              >
                {ROTAS.map((r) => (
                  <option key={r.id} value={r.id} className="bg-marca text-sobre-marca">{r.rotulo}</option>
                ))}
              </select>
              <svg viewBox="0 0 20 20" aria-hidden className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 fill-acento">
                <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
              </svg>
            </label>
            <SeloTerritorio />
            <div className="flex flex-none lg:ml-0">
              <BotaoLink />
              <BotaoApresentar aoClicar={entrar} />
              <BotaoTema />
            </div>
          </div>
        </div>
        </div>
      </header>
      )}

      <main
        ref={conteudo}
        style={apresentando ? { transform: `translateY(${escala.y}px) scale(${escala.s})`, transformOrigin: "top center" } : undefined}
        className={`mx-auto max-w-7xl px-4 sm:px-6 ${apresentando ? "pt-4" : "py-8 sm:py-10"}`}
      >
        <div ref={pagina}>
          <Suspense fallback={<div className="h-64 animate-pulse rounded-[var(--radius-cartao)] bg-superficie" />}>
            <Secao />
          </Suspense>
        </div>

        {/* Fim da página: segue a história sem voltar ao topo. */}
        {!apresentando && (
        <nav aria-label="Seção anterior e próxima" className="mt-14 grid gap-3 sm:grid-cols-2">
          {anterior ? (
            <a href={`#/${anterior.id}`} className="cartao group flex flex-col gap-1 p-4 transition-colors hover:border-serie-1/50">
              <span className="sobrelinha">← Anterior</span>
              <span className="font-medium text-tinta group-hover:text-serie-1">{anterior.rotulo}</span>
            </a>
          ) : (
            <span className="hidden sm:block" />
          )}
          {proxima && (
            <a href={`#/${proxima.id}`} className="cartao group flex flex-col gap-1 p-4 text-right transition-colors hover:border-serie-1/50">
              <span className="sobrelinha">Próxima →</span>
              <span className="font-medium text-tinta group-hover:text-serie-1">{proxima.rotulo}</span>
            </a>
          )}
        </nav>
        )}
      </main>

      {apresentando && (
        <div className="fixed bottom-3 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-1 rounded-full border border-borda bg-superficie/90 px-1.5 py-1 text-[13px] text-tinta-2 shadow-lg backdrop-blur">
          <button type="button" onClick={voltar} aria-label="Anterior" className="grid h-9 w-9 place-items-center rounded-full hover:bg-superficie-2 hover:text-tinta">
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden><path d="M12.7 4.3a1 1 0 0 1 0 1.4L8.4 10l4.3 4.3a1 1 0 1 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Z" /></svg>
          </button>
          <span className="px-2 tabular-nums">
            <span className="font-medium text-tinta">{ROTAS[indice].rotulo}</span> · {atual + 1}/{total}
          </span>
          <button type="button" onClick={avancar} aria-label="Próximo" className="grid h-9 w-9 place-items-center rounded-full hover:bg-superficie-2 hover:text-tinta">
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden><path d="M7.3 15.7a1 1 0 0 1 0-1.4L11.6 10 7.3 5.7a1 1 0 0 1 1.4-1.4l5 5a1 1 0 0 1 0 1.4l-5 5a1 1 0 0 1-1.4 0Z" /></svg>
          </button>
          <button type="button" onClick={sair} aria-label="Sair da apresentação" title="Sair (Esc)" className="ml-1 grid h-9 w-9 place-items-center rounded-full hover:bg-superficie-2 hover:text-tinta">
            <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden><path d="M5.7 4.3 10 8.6l4.3-4.3 1.4 1.4-4.3 4.3 4.3 4.3-1.4 1.4-4.3-4.3-4.3 4.3-1.4-1.4 4.3-4.3-4.3-4.3 1.4-1.4Z" /></svg>
          </button>
        </div>
      )}

      {!apresentando && (
      <footer className="border-t border-borda">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-[12px] text-tinta-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Fonte: microdados da RAIS e do CAGED (MTE/PDET), traduzidos pelos dicionários oficiais.
            {atualizado && <> Dados atualizados em {atualizado}.</>}
          </p>
          <p>
            Gian Pedro Rodrigues · TCC · Engenharia da Computação ·{" "}
            <span className="font-semibold text-tinta-2">UTFPR</span>
          </p>
        </div>
      </footer>
      )}
    </div>
  );
}
