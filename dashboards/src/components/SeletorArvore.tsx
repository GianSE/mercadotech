import { ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { acharNo, casaBusca, filtrarArvore, type No } from "../lib/arvore";
import { fmt } from "../lib/formato";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";

/**
 * Menu suspenso de uma hierarquia (subárea → família → ocupação, ou divisão →
 * subclasse), com busca dentro: escolhe qualquer nível, e não só a folha.
 * Fecha ao escolher, com Esc ou com um clique fora. (Do site do TCC.)
 */
export function SeletorArvore({
  rotulo,
  valor,
  nos,
  todos,
  aoMudar,
  placeholder,
}: {
  rotulo: string;
  valor: string;
  nos: No[];
  /** A opção que soma tudo, no topo da lista. */
  todos: { id: string; nome: string };
  aoMudar: (id: string) => void;
  placeholder: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const caixa = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    requestAnimationFrame(() => campo.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  const atual = acharNo(nos, valor);
  const total = nos.reduce((t, n) => t + n.valor, 0);
  const visiveis = filtrarArvore(nos, busca);
  const escolher = (id: string) => {
    aoMudar(id);
    setAberto(false);
    setBusca("");
  };

  const linha = (no: No, nivel: number): ReactNode => (
    <li key={no.id}>
      <button
        type="button"
        role="option"
        aria-selected={no.id === valor}
        onClick={() => escolher(no.id)}
        className={cn("flex w-full items-baseline gap-2 rounded-md py-1.5 pr-2 text-left transition-colors", no.id === valor ? "bg-accent" : "hover:bg-accent/60")}
        style={{ paddingLeft: 8 + nivel * 14 }}
      >
        {no.codigo && <span className="flex-none font-mono text-[11px] text-muted-foreground">{no.codigo}</span>}
        <span className={cn("min-w-0 flex-1 text-[13px] leading-snug", no.filhos?.length ? "font-medium" : "text-muted-foreground", busca && casaBusca(no, busca) && "text-foreground underline decoration-chart-1 underline-offset-2")}>
          {no.nome}
        </span>
        <span className="flex-none text-[11px] tabular-nums text-muted-foreground">{fmt.inteiro(no.valor)}</span>
      </button>
      {no.filhos?.length ? <ul>{no.filhos.map((f) => linha(f, nivel + 1))}</ul> : null}
    </li>
  );

  return (
    <div ref={caixa} className="relative flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{rotulo}</span>
      <Button variant="outline" className="w-full justify-between gap-2 font-normal sm:w-80" aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
        <span className="flex min-w-0 items-baseline gap-2">
          {atual?.codigo && <span className="flex-none font-mono text-[11px] text-muted-foreground">{atual.codigo}</span>}
          <span className="truncate">{atual?.nome ?? todos.nome}</span>
        </span>
        <ChevronDown aria-hidden className={cn("transition-transform", aberto && "rotate-180")} />
      </Button>
      {aberto && (
        <div className="absolute top-full left-0 z-40 mt-2 w-[min(30rem,calc(100vw-2rem))] rounded-xl border bg-popover p-2 shadow-lg">
          <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-2.5">
            <Search className="size-4 text-muted-foreground" aria-hidden />
            <input
              ref={campo}
              type="search"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={placeholder}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </label>
          <ul role="listbox" aria-label={rotulo} className="mt-2 max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain">
            {!busca.trim() && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={valor === todos.id}
                  onClick={() => escolher(todos.id)}
                  className={cn("flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium transition-colors", valor === todos.id ? "bg-accent" : "hover:bg-accent/60")}
                >
                  <span className="min-w-0 flex-1">{todos.nome}</span>
                  <span className="flex-none text-[11px] font-normal tabular-nums text-muted-foreground">{fmt.inteiro(total)}</span>
                </button>
              </li>
            )}
            {visiveis.length ? visiveis.map((n) => linha(n, 0)) : <li className="px-3 py-4 text-sm text-muted-foreground">Nada com “{busca.trim()}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
