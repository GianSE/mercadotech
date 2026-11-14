import { Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { cn } from "../lib/utils";

export type OpcaoBusca = { id: string; rotulo: string; detalhe?: string };

type Props = {
  rotulo: string;
  placeholder: string;
  opcoes: OpcaoBusca[];
  aoEscolher: (o: OpcaoBusca) => void;
  /** Chamado no primeiro foco: quem chama pode carregar as opções só quando alguém vai buscar. */
  aoFocar?: () => void;
  carregando?: boolean;
};

/** Sem acento e em minúsculas: "sao paulo" acha "São Paulo". */
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Campo de busca com sugestões (combobox do WAI-ARIA): setas sobem e descem,
 * Enter escolhe, Esc fecha. Primeiro as opções que começam com o texto,
 * depois as que o contêm.
 */
export function Busca({ rotulo, placeholder, opcoes, aoEscolher, aoFocar, carregando }: Props) {
  const id = useId();
  const [texto, setTexto] = useState("");
  const [aberta, setAberta] = useState(false);
  const [ativa, setAtiva] = useState(0);
  const focou = useRef(false);

  const indice = useMemo(() => opcoes.map((o) => ({ o, n: normalizar(`${o.rotulo} ${o.detalhe ?? ""}`), r: normalizar(o.rotulo) })), [opcoes]);
  const achadas = useMemo(() => {
    const t = normalizar(texto.trim());
    if (!t) return [];
    const comeca = indice.filter((x) => x.r.startsWith(t));
    const contem = indice.filter((x) => !x.r.startsWith(t) && x.n.includes(t));
    return [...comeca, ...contem].slice(0, 8).map((x) => x.o);
  }, [indice, texto]);

  const escolher = (o: OpcaoBusca) => {
    aoEscolher(o);
    setTexto("");
    setAberta(false);
  };

  return (
    <div className="relative flex min-w-[min(18rem,100%)] flex-1 flex-col gap-1.5">
      <label htmlFor={`${id}-campo`} className="text-xs font-medium text-muted-foreground">
        {rotulo}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <input
          id={`${id}-campo`}
          type="search"
          role="combobox"
          aria-expanded={aberta && achadas.length > 0}
          aria-controls={`${id}-lista`}
          aria-activedescendant={aberta && achadas[ativa] ? `${id}-${ativa}` : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          placeholder={placeholder}
          value={texto}
          onFocus={() => {
            if (!focou.current) {
              focou.current = true;
              aoFocar?.();
            }
            setAberta(true);
          }}
          onBlur={() => setTimeout(() => setAberta(false), 150)}
          onChange={(e) => {
            setTexto(e.target.value);
            setAtiva(0);
            setAberta(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setAtiva((a) => Math.min(a + 1, achadas.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAtiva((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && achadas[ativa]) {
              e.preventDefault();
              escolher(achadas[ativa]);
            } else if (e.key === "Escape") {
              setAberta(false);
            }
          }}
          className="h-9 w-full rounded-md border bg-card pr-8 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
        />
        {texto && (
          <button type="button" aria-label="Limpar busca" onClick={() => setTexto("")} className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {aberta && texto.trim() && (
        <ul id={`${id}-lista`} role="listbox" aria-label={rotulo} className="absolute top-full right-0 left-0 z-40 mt-1 max-h-80 overflow-y-auto rounded-xl border bg-popover p-1 shadow-lg">
          {achadas.length ? (
            achadas.map((o, i) => (
              <li
                key={o.id}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === ativa}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => escolher(o)}
                onMouseEnter={() => setAtiva(i)}
                className={cn("flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm", i === ativa && "bg-accent text-accent-foreground")}
              >
                <span className="truncate">{o.rotulo}</span>
                {o.detalhe && <span className="shrink-0 text-xs text-muted-foreground">{o.detalhe}</span>}
              </li>
            ))
          ) : (
            <li className="px-2.5 py-2 text-sm text-muted-foreground">{carregando ? "Carregando os municípios…" : "Nada encontrado"}</li>
          )}
        </ul>
      )}
    </div>
  );
}
