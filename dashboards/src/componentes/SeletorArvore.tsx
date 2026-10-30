import { useEffect, useRef, useState } from "react";
import { fmtNum } from "../lib/formato";
import { acharNo, filtrarArvore, Realce, type NoContagem } from "./ArvoreContagem";
import { Flutuante } from "./Flutuante";

// Menu suspenso de uma hierarquia (grupo → família → item), com busca dentro:
// escolhe qualquer nível, e não só a folha. Fecha ao escolher, com Esc ou
// com um clique fora.
export function SeletorArvore({ rotulo, valor, nos, todos, aoMudar, placeholder }: {
  rotulo: string;
  valor: string;
  nos: NoContagem[];
  // A opção que soma tudo, no topo da lista.
  todos: { id: string; nome: string };
  aoMudar: (id: string) => void;
  placeholder: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const caixa = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (!caixa.current?.contains(alvo) && !painel.current?.contains(alvo)) setAberto(false);
    };
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

  const linha = (no: NoContagem, nivel: number) => {
    const escolhido = no.id === valor;
    return (
      <li key={no.id}>
        <button
          type="button"
          role="option"
          aria-selected={escolhido}
          onClick={() => escolher(no.id)}
          className={`flex w-full items-baseline gap-2 rounded-lg py-1.5 pr-2 text-left transition-colors ${escolhido ? "bg-serie-1/12 text-tinta" : "hover:bg-superficie-2"}`}
          style={{ paddingLeft: 10 + nivel * 14 }}
        >
          <span className="flex-none font-mono text-[11px] text-tinta-3">{no.codigo}</span>
          <span className={`min-w-0 flex-1 text-[13px] leading-snug ${no.filhos?.length ? "font-semibold text-tinta" : "text-tinta-2"}`}>
            <Realce texto={no.nome} busca={busca} />
          </span>
          <span className="flex-none text-[11px] tabular-nums text-tinta-3">{fmtNum(no.valor)}</span>
        </button>
        {no.filhos?.length ? <ul>{no.filhos.map((f) => linha(f, nivel + 1))}</ul> : null}
      </li>
    );
  };

  return (
    <div ref={caixa} className="relative flex min-w-0 flex-col gap-1">
      <span className="sobrelinha">{rotulo}</span>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={aberto}
        className="flex h-11 w-full items-center gap-2 rounded-[var(--radius-controle)] border border-borda bg-superficie px-3 text-left text-base text-tinta shadow-sm transition-colors hover:border-serie-1/60 sm:h-9 sm:w-72 sm:px-2.5 sm:text-sm"
      >
        {atual && <span className="flex-none font-mono text-[11px] text-tinta-3">{atual.codigo}</span>}
        <span className="min-w-0 flex-1 truncate">{atual?.nome ?? todos.nome}</span>
        <svg viewBox="0 0 20 20" aria-hidden className={`h-4 w-4 flex-none fill-tinta-3 transition-transform ${aberto ? "rotate-180" : ""}`}>
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>
      {aberto && (
        <Flutuante ancora={botao} painel={painel} className="w-[min(30rem,calc(100vw-2rem))] rounded-xl border border-borda bg-superficie p-2 shadow-xl">
          <input
            ref={campo}
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={placeholder}
            className="h-11 w-full rounded-lg border border-borda bg-fundo px-3 text-base text-tinta placeholder:text-tinta-3 sm:h-9 sm:text-sm"
          />
          <ul role="listbox" aria-label={rotulo} className="mt-2 max-h-[min(60vh,26rem)] overflow-y-auto overscroll-contain">
            {!busca.trim() && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={valor === todos.id}
                  onClick={() => escolher(todos.id)}
                  className={`flex w-full items-baseline gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors ${valor === todos.id ? "bg-serie-1/12 text-tinta" : "text-tinta hover:bg-superficie-2"}`}
                >
                  <span className="min-w-0 flex-1">{todos.nome}</span>
                  <span className="flex-none text-[11px] font-normal tabular-nums text-tinta-3">{fmtNum(total)}</span>
                </button>
              </li>
            )}
            {visiveis.length ? visiveis.map((n) => linha(n, 0)) : <li className="px-3 py-4 text-sm text-tinta-3">Nada com “{busca.trim()}”.</li>}
          </ul>
        </Flutuante>
      )}
    </div>
  );
}
