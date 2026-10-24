import { lazy, Suspense, useEffect, useState, type ComponentType } from "react";
import { obterManifesto } from "./lib/db";
import { useFiltro } from "./lib/filtro";
import { useTema } from "./lib/tema";

type Rota = { id: string; rotulo: string; curto: string; componente: ComponentType };

const ROTAS: Rota[] = [
  { id: "pesquisa", rotulo: "Visão geral", curto: "Início", componente: lazy(() => import("./secoes/Pesquisa")) },
  { id: "crescimento", rotulo: "1 · Crescimento", curto: "1", componente: lazy(() => import("./secoes/Crescimento")) },
  { id: "onde", rotulo: "2 · Onde está", curto: "2", componente: lazy(() => import("./secoes/Onde")) },
  { id: "qualidade", rotulo: "3 · Qualidade", curto: "3", componente: lazy(() => import("./secoes/Qualidade")) },
  { id: "equidade", rotulo: "4 · Quem ganha menos", curto: "4", componente: lazy(() => import("./secoes/Equidade")) },
  { id: "futuro", rotulo: "5 · Para onde vai", curto: "5", componente: lazy(() => import("./secoes/Futuro")) },
  { id: "explorar", rotulo: "Explorar", curto: "Explorar", componente: lazy(() => import("./secoes/Explorar")) },
  // A única página com texto: respostas, leitura dos números, ressalvas e método.
  { id: "analise", rotulo: "Análise", curto: "Análise", componente: lazy(() => import("./secoes/Analise")) },
];

function rotaAtual(): string {
  const id = window.location.hash.replace(/^#\/?/, "");
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

  useEffect(() => {
    const aoMudar = () => {
      setRota(rotaAtual());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  useEffect(() => {
    obterManifesto()
      .then((m) => setAtualizado(new Date(m.gerado_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })))
      .catch(() => setAtualizado(null));
  }, []);

  const indice = ROTAS.findIndex((r) => r.id === rota);
  const Secao = ROTAS[indice].componente;
  const anterior = ROTAS[indice - 1];
  const proxima = ROTAS[indice + 1];

  return (
    <div className="min-h-screen">
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
                      className={`relative block rounded-full px-3 py-1.5 text-[13px] transition-colors ${
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
            <div className="flex-none lg:ml-0">
              <BotaoTema />
            </div>
          </div>
        </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10">
        <Suspense fallback={<div className="h-64 animate-pulse rounded-[var(--radius-cartao)] bg-superficie" />}>
          <Secao />
        </Suspense>

        {/* Fim da página: segue a história sem voltar ao topo. */}
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
      </main>

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
    </div>
  );
}
