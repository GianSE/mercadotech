import { cn } from "../../lib/utils";

type Props<T extends string> = {
  rotulo: string;
  valor: T;
  opcoes: { valor: T; rotulo: string }[];
  aoMudar: (v: T) => void;
};

/** Escolha de uma opção entre poucas (Ano/Mês), no lugar de uma lista suspensa. */
export function Segmentado<T extends string>({ rotulo, valor, opcoes, aoMudar }: Props<T>) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{rotulo}</span>
      <div role="radiogroup" aria-label={rotulo} className="inline-flex h-9 w-fit rounded-md border bg-card p-0.5">
        {opcoes.map((o) => (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={o.valor === valor}
            onClick={() => aoMudar(o.valor)}
            className={cn(
              "rounded-[5px] px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              o.valor === valor ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}
