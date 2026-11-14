import { Check, ChevronDown, MapPin } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { REGIOES, rotuloTerritorio, UFS, useFiltro, type Regiao } from "../lib/filtro";
import { intervalo, type Periodo } from "../lib/sql";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

/** A faixa de filtros acima dos gráficos de uma seção. Fica presa logo abaixo do cabeçalho (h-16) ao rolar. */
export function BarraFiltros({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-16 z-20 -mx-4 mb-4 border-b bg-background/90 px-4 py-3 backdrop-blur">
      <div className="flex flex-wrap items-end gap-4">{children}</div>
    </div>
  );
}

const classeLista =
  "h-9 rounded-md border bg-card px-2.5 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function FiltroPeriodo({ valor, aoMudar, min, max }: { valor: Periodo; aoMudar: (p: Periodo) => void; min: number; max: number }) {
  const anos = intervalo(min, max);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">Período</span>
      <div className="flex items-center gap-2">
        <select aria-label="Ano inicial" className={classeLista} value={valor[0]} onChange={(e) => aoMudar([Number(e.target.value), Math.max(Number(e.target.value), valor[1])])}>
          {anos.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">a</span>
        <select aria-label="Ano final" className={classeLista} value={valor[1]} onChange={(e) => aoMudar([Math.min(valor[0], Number(e.target.value)), Number(e.target.value)])}>
          {anos.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/**
 * Estados do filtro de território (ou, com `valor`/`aoMudar`, uma escolha
 * própria, como a comparação de estados). Marcar uma região marca os estados
 * dela; nenhum marcado é o Brasil inteiro.
 */
export function SeletorUF({
  rotulo = "Território",
  valor,
  aoMudar,
}: {
  rotulo?: string;
  valor?: string[];
  aoMudar?: (ufs: string[]) => void;
}) {
  const filtro = useFiltro();
  const ufs = valor ?? filtro.ufs;
  const definir = aoMudar ?? filtro.definir;
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto]);

  const alternar = (lista: readonly string[]) => {
    const todas = lista.every((u) => ufs.includes(u));
    definir(todas ? ufs.filter((u) => !lista.includes(u)) : [...ufs, ...lista]);
  };

  return (
    <div className="relative flex flex-col gap-1.5" ref={caixa}>
      <span className="text-xs font-medium text-muted-foreground">{rotulo}</span>
      <Button variant="outline" className="justify-between gap-3 font-normal" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <span className="flex items-center gap-2">
          <MapPin aria-hidden /> {valor ? (ufs.length ? rotuloTerritorio(ufs) : "Nenhum") : rotuloTerritorio(ufs)}
        </span>
        <ChevronDown aria-hidden className={cn("transition-transform", aberto && "rotate-180")} />
      </Button>
      {aberto && (
        <div className="absolute top-full left-0 z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-xl border bg-popover p-3 shadow-lg">
          <div className="flex items-center justify-between pb-2">
            <span className="text-sm font-medium">{ufs.length ? `${ufs.length} marcado${ufs.length > 1 ? "s" : ""}` : "Brasil inteiro"}</span>
            <Button variant="ghost" size="sm" onClick={() => definir([])} disabled={!ufs.length}>
              Limpar
            </Button>
          </div>
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {(Object.keys(REGIOES) as Regiao[]).map((r) => (
              <fieldset key={r}>
                <legend className="mb-1.5">
                  <Marcador marcado={REGIOES[r].every((u) => ufs.includes(u))} aoClicar={() => alternar(REGIOES[r])}>
                    <span className="font-medium">{r}</span>
                  </Marcador>
                </legend>
                <div className="grid grid-cols-5 gap-1">
                  {REGIOES[r].map((u) => (
                    <button
                      key={u}
                      type="button"
                      aria-pressed={ufs.includes(u)}
                      onClick={() => alternar([u])}
                      className={cn(
                        "h-8 rounded-md border text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                        ufs.includes(u) ? "border-foreground bg-foreground text-background" : "hover:bg-accent",
                      )}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          {!valor && <p className="pt-2 text-xs text-muted-foreground">Vale para todas as seções do site. {UFS.length} estados.</p>}
        </div>
      )}
    </div>
  );
}

function Marcador({ marcado, aoClicar, children }: { marcado: boolean; aoClicar: () => void; children: ReactNode }) {
  return (
    <button type="button" role="checkbox" aria-checked={marcado} onClick={aoClicar} className="flex items-center gap-2 text-sm outline-none focus-visible:underline">
      <span className={cn("grid size-4 place-items-center rounded-[4px] border", marcado && "border-foreground bg-foreground text-background")}>
        {marcado && <Check className="size-3" aria-hidden />}
      </span>
      {children}
    </button>
  );
}
