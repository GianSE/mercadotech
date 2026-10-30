import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { REGIOES, UFS, useFiltro, type Regiao } from "../lib/filtro";
import { Flutuante } from "./Flutuante";

// No celular o painel abre no fluxo (dentro da gaveta de filtros); no largo,
// flutua sob o botão, desenhado fora da página para nada cobri-lo.
const LARGO = "(min-width: 640px)";
function PainelUF({ ancora, painel, children }: { ancora: RefObject<HTMLButtonElement | null>; painel: RefObject<HTMLDivElement | null>; children: ReactNode }) {
  const [largo] = useState(() => window.matchMedia(LARGO).matches);
  const caixa = "rounded-2xl border border-borda bg-superficie p-3 shadow-xl";
  return largo
    ? <Flutuante ancora={ancora} painel={painel} className={`${caixa} w-[22rem]`}>{children}</Flutuante>
    : <div ref={painel} className={`${caixa} z-30 mt-1 w-full`}>{children}</div>;
}

// Menu suspenso com caixas de seleção: o atalho "Brasil" (limpa a seleção),
// regiões inteiras e estado a estado. Vale para o site todo. Para tirar um
// estado, como SP, basta desmarcá-lo.
export function SeletorUF() {
  const f = useFiltro();
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (raiz.current && !raiz.current.contains(alvo) && !painel.current?.contains(alvo)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  // Nenhuma marcada = Brasil inteiro: no menu, todas aparecem marcadas.
  const marcadas = f.ativo ? f.ufs : UFS;
  const marcada = (uf: string) => marcadas.includes(uf);
  const estadoRegiao = (r: Regiao) => {
    const n = REGIOES[r].filter(marcada).length;
    return n === 0 ? "nenhuma" : n === REGIOES[r].length ? "todas" : "algumas";
  };
  const alternarRegiao = (r: Regiao) => {
    const todas = estadoRegiao(r) === "todas";
    f.definir(todas ? marcadas.filter((u) => !(REGIOES[r] as readonly string[]).includes(u)) : [...marcadas, ...REGIOES[r]]);
  };
  const alternarUf = (uf: string) => f.definir(marcada(uf) ? marcadas.filter((u) => u !== uf) : [...marcadas, uf]);

  const atalhos: { rotulo: string; ufs: string[] }[] = [{ rotulo: "Brasil", ufs: [] }];

  return (
    <div ref={raiz} className="relative flex min-w-0 flex-col gap-1">
      <span className="sobrelinha">Território</span>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-haspopup="true"
        className={`flex h-11 w-full items-center gap-2 rounded-[var(--radius-controle)] border px-3 text-left text-base shadow-sm transition-colors sm:h-9 sm:w-auto sm:min-w-[11rem] sm:px-2.5 sm:text-sm ${
          f.ativo ? "border-acento bg-acento/15 text-tinta" : "border-borda bg-superficie text-tinta hover:border-serie-1/60"
        }`}
      >
        <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 flex-none fill-serie-1">
          <path d="M10 1.5a6 6 0 0 0-6 6c0 4.4 6 11 6 11s6-6.6 6-11a6 6 0 0 0-6-6Zm0 8.2a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4Z" />
        </svg>
        <span className="min-w-0 flex-1 truncate font-medium">{f.rotulo}</span>
        <svg viewBox="0 0 20 20" aria-hidden className={`h-4 w-4 flex-none fill-tinta-3 transition-transform ${aberto ? "rotate-180" : ""}`}>
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>

      {aberto && (
        <PainelUF ancora={botao} painel={painel}>
          <div className="flex flex-wrap gap-1.5">
            {atalhos.map((a) => {
              const ativo = a.ufs.length === f.ufs.length && a.ufs.every((u) => f.ufs.includes(u));
              return (
                <button
                  key={a.rotulo}
                  type="button"
                  onClick={() => f.definir(a.ufs)}
                  aria-pressed={ativo}
                  className={`h-9 rounded-full border px-3 text-[13px] transition-colors ${ativo ? "border-acento bg-acento font-medium text-sobre-acento" : "border-borda text-tinta-2 hover:border-serie-1/60 hover:text-tinta"}`}
                >
                  {a.rotulo}
                </button>
              );
            })}
          </div>
          <div className="mt-3 max-h-[min(60vh,26rem)] space-y-3 overflow-y-auto pr-1">
            {(Object.keys(REGIOES) as Regiao[]).map((r) => {
              const estado = estadoRegiao(r);
              return (
                <fieldset key={r}>
                  <legend className="w-full">
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-tinta">
                      <input
                        type="checkbox"
                        checked={estado === "todas"}
                        ref={(el) => {
                          if (el) el.indeterminate = estado === "algumas";
                        }}
                        onChange={() => alternarRegiao(r)}
                        className="h-4 w-4 accent-[var(--serie-1)]"
                      />
                      {r}
                    </label>
                  </legend>
                  <div className="mt-1.5 grid grid-cols-5 gap-1 pl-6 sm:grid-cols-6">
                    {REGIOES[r].map((uf) => (
                      <label
                        key={uf}
                        className={`flex h-8 cursor-pointer items-center justify-center rounded-lg border font-mono text-[12px] transition-colors ${
                          marcada(uf) ? "border-serie-1/50 bg-serie-1/15 text-tinta" : "border-borda text-tinta-3 hover:text-tinta"
                        }`}
                      >
                        <input type="checkbox" className="sr-only" checked={marcada(uf)} onChange={() => alternarUf(uf)} />
                        {uf}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-borda pt-3 text-[12px] text-tinta-3">
            <span>{f.ativo ? `${f.ufs.length} de ${UFS.length} estados` : "Todos os estados"}</span>
            <button type="button" onClick={() => setAberto(false)} className="rounded-full bg-acento px-4 py-1.5 text-[13px] font-medium text-sobre-acento">
              Pronto
            </button>
          </div>
        </PainelUF>
      )}
    </div>
  );
}

// O mesmo menu, para escolher um conjunto de estados que não é o filtro do
// site (ex.: os estados de uma comparação). `extras` entra antes das regiões
// (ex.: "Brasil" como linha de referência).
export function SeletorEstados({ rotulo, valor, aoMudar, extras = [] }: {
  rotulo: string;
  valor: string[];
  aoMudar: (v: string[]) => void;
  extras?: { valor: string; rotulo: string }[];
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (raiz.current && !raiz.current.contains(alvo) && !painel.current?.contains(alvo)) setAberto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const marcada = (v: string) => valor.includes(v);
  const alternar = (v: string) => aoMudar(marcada(v) ? valor.filter((x) => x !== v) : [...valor, v]);
  const estadoRegiao = (r: Regiao) => {
    const n = REGIOES[r].filter(marcada).length;
    return n === 0 ? "nenhuma" : n === REGIOES[r].length ? "todas" : "algumas";
  };
  const alternarRegiao = (r: Regiao) =>
    aoMudar(estadoRegiao(r) === "todas" ? valor.filter((u) => !(REGIOES[r] as readonly string[]).includes(u)) : [...new Set([...valor, ...REGIOES[r]])]);
  const nomes = valor.map((v) => extras.find((e) => e.valor === v)?.rotulo ?? v);
  const resumo = !valor.length ? "Nenhum" : valor.length <= 4 ? nomes.join(", ") : `${valor.length} selecionados`;

  return (
    <div ref={raiz} className="relative flex min-w-0 flex-col gap-1">
      <span className="sobrelinha">{rotulo}</span>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        aria-haspopup="true"
        className="flex h-11 w-full items-center gap-2 rounded-[var(--radius-controle)] border border-borda bg-superficie px-3 text-left text-base text-tinta shadow-sm transition-colors hover:border-serie-1/60 sm:h-9 sm:w-auto sm:min-w-[13rem] sm:px-2.5 sm:text-sm"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{resumo}</span>
        <svg viewBox="0 0 20 20" aria-hidden className={`h-4 w-4 flex-none fill-tinta-3 transition-transform ${aberto ? "rotate-180" : ""}`}>
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>
      {aberto && (
        <PainelUF ancora={botao} painel={painel}>
          <div className="flex flex-wrap gap-1.5">
            {extras.map((e) => (
              <label key={e.valor} className={`flex h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-[13px] ${marcada(e.valor) ? "border-serie-1/50 bg-serie-1/15 text-tinta" : "border-borda text-tinta-2"}`}>
                <input type="checkbox" className="h-4 w-4 accent-[var(--serie-1)]" checked={marcada(e.valor)} onChange={() => alternar(e.valor)} />
                {e.rotulo}
              </label>
            ))}
            <button type="button" onClick={() => aoMudar([...extras.map((e) => e.valor).filter(marcada), ...UFS])} className="h-9 rounded-full border border-borda px-3 text-[13px] text-tinta-2 hover:border-serie-1/60 hover:text-tinta">
              Todos os estados
            </button>
            <button type="button" onClick={() => aoMudar([])} className="h-9 rounded-full border border-borda px-3 text-[13px] text-tinta-2 hover:border-serie-1/60 hover:text-tinta">
              Limpar
            </button>
          </div>
          <div className="mt-3 max-h-[min(60vh,26rem)] space-y-3 overflow-y-auto pr-1">
            {(Object.keys(REGIOES) as Regiao[]).map((r) => {
              const estado = estadoRegiao(r);
              return (
                <fieldset key={r}>
                  <legend className="w-full">
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-tinta">
                      <input
                        type="checkbox"
                        checked={estado === "todas"}
                        ref={(el) => {
                          if (el) el.indeterminate = estado === "algumas";
                        }}
                        onChange={() => alternarRegiao(r)}
                        className="h-4 w-4 accent-[var(--serie-1)]"
                      />
                      {r}
                    </label>
                  </legend>
                  <div className="mt-1.5 grid grid-cols-5 gap-1 pl-6 sm:grid-cols-6">
                    {REGIOES[r].map((uf) => (
                      <label
                        key={uf}
                        className={`flex h-8 cursor-pointer items-center justify-center rounded-lg border font-mono text-[12px] transition-colors ${marcada(uf) ? "border-serie-1/50 bg-serie-1/15 text-tinta" : "border-borda text-tinta-3 hover:text-tinta"}`}
                      >
                        <input type="checkbox" className="sr-only" checked={marcada(uf)} onChange={() => alternar(uf)} />
                        {uf}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-borda pt-3 text-[12px] text-tinta-3">
            <span>{valor.length} selecionado{valor.length === 1 ? "" : "s"}</span>
            <button type="button" onClick={() => setAberto(false)} className="rounded-full bg-acento px-4 py-1.5 text-[13px] font-medium text-sobre-acento">
              Pronto
            </button>
          </div>
        </PainelUF>
      )}
    </div>
  );
}
