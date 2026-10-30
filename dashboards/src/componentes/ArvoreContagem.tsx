import { useState, type ReactNode } from "react";
import type { Linha } from "../lib/db";
import { baixarCsv } from "../lib/baixar";
import { fmtNum, fmtPct } from "../lib/formato";
import type { Termo } from "../lib/glossario";
import { ICONE_CSV, MenuGrafico, type Coluna } from "./Grafico";
import { Ajuda } from "./ui";

// Um nó da árvore: grupo (com filhos) ou item (folha, que pode ser escolhido).
export type NoContagem = { id: string; codigo: string; nome: string; valor: number; filhos?: NoContagem[] };

// Busca sem acento e sem maiúscula; o código também casa sem a pontuação
// ("2124", "212405", "6201" ou "6201-5/01").
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const soDigitos = (s: string) => s.replace(/\D/g, "");

export function casaBusca(no: NoContagem, busca: string): boolean {
  const termo = normalizar(busca.trim());
  if (!termo) return true;
  const digitos = soDigitos(termo);
  return normalizar(no.nome).includes(termo) || (digitos.length >= 2 && digitos === termo.replace(/[\s.\-/]/g, "") && soDigitos(no.codigo).startsWith(digitos));
}

// Um grupo que casa mostra tudo o que tem dentro; senão, só os filhos que casam.
function filtrar(no: NoContagem, busca: string): NoContagem | null {
  if (casaBusca(no, busca)) return no;
  const filhos = (no.filhos ?? []).map((f) => filtrar(f, busca)).filter((f): f is NoContagem => f !== null);
  return filhos.length ? { ...no, filhos } : null;
}

export function contarItens(nos: NoContagem[], busca: string): number {
  return nos
    .map((n) => filtrar(n, busca))
    .filter((n): n is NoContagem => n !== null)
    .reduce((soma, n) => soma + folhas(n), 0);
}
const folhas = (no: NoContagem): number => (no.filhos?.length ? no.filhos.reduce((s, f) => s + folhas(f), 0) : 1);

function Realce({ texto, busca }: { texto: string; busca: string }) {
  const termo = normalizar(busca.trim());
  const i = termo ? normalizar(texto).indexOf(termo) : -1;
  if (i < 0) return <>{texto}</>;
  return (
    <>
      {texto.slice(0, i)}
      <mark className="rounded bg-acento/35 px-0.5 text-tinta">{texto.slice(i, i + termo.length)}</mark>
      {texto.slice(i + termo.length)}
    </>
  );
}

// A hierarquia de um recorte em lista: cada linha com o código, o nome, a
// contagem e uma barra com a parte do total. Legível em qualquer tamanho, ao
// contrário do gráfico de sol, em que as fatias pequenas somem e os rótulos
// saem cortados.
export function ArvoreContagem(props: {
  titulo: string;
  subtitulo?: ReactNode;
  ajuda?: Termo;
  nos: NoContagem[];
  busca: string;
  selecionado?: string;
  aoSelecionar?: (no: NoContagem) => void;
  carregando?: boolean;
  tabela?: { colunas: Coluna[]; linhas: Linha[] };
}) {
  // Os grupos de cima começam abertos; os de baixo, fechados.
  const [abertos, setAbertos] = useState<Set<string> | null>(null);
  const abertosEfetivos = abertos ?? new Set(props.nos.map((n) => n.id));
  const total = props.nos.reduce((s, n) => s + n.valor, 0);
  const buscando = props.busca.trim() !== "";
  const visiveis = buscando
    ? props.nos.map((n) => filtrar(n, props.busca)).filter((n): n is NoContagem => n !== null)
    : props.nos;

  const alternar = (id: string) =>
    setAbertos((atual) => {
      const novo = new Set(atual ?? abertosEfetivos);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });

  const linha = (no: NoContagem, nivel: number): ReactNode => {
    const grupo = !!no.filhos?.length;
    const aberto = buscando || abertosEfetivos.has(no.id);
    const escolhido = props.selecionado === no.id;
    const parte = total ? no.valor / total : 0;
    return (
      <li key={no.id}>
        <button
          type="button"
          onClick={() => (grupo ? alternar(no.id) : props.aoSelecionar?.(no))}
          aria-expanded={grupo ? aberto : undefined}
          aria-pressed={!grupo ? escolhido : undefined}
          title={`${fmtNum(no.valor)} vínculos · ${fmtPct(parte * 100, 1)} do total`}
          className={`group relative flex w-full items-center gap-2 rounded-lg py-1.5 pr-2 text-left transition-colors ${
            escolhido ? "bg-serie-1/12 ring-1 ring-serie-1/50" : "hover:bg-superficie-2"
          }`}
          style={{ paddingLeft: 8 + nivel * 16 }}
        >
          <span aria-hidden className="grid h-4 w-4 flex-none place-items-center text-tinta-3">
            {grupo ? (
              <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 fill-current transition-transform ${aberto ? "rotate-90" : ""}`}>
                <path d="M7.3 5.3a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 0 1-1.4-1.4L10.6 10 7.3 6.7a1 1 0 0 1 0-1.4Z" />
              </svg>
            ) : (
              <span className={`h-1.5 w-1.5 rounded-full ${escolhido ? "bg-serie-1" : "bg-tinta-3/50"}`} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="flex-none font-mono text-[11px] text-tinta-3">{no.codigo}</span>
              <span className={`line-clamp-2 text-[13px] sm:line-clamp-1 ${grupo ? "font-semibold text-tinta" : "text-tinta-2"}`}>
                <Realce texto={no.nome} busca={props.busca} />
              </span>
            </span>
            <span aria-hidden className="mt-1 block h-1 overflow-hidden rounded-full bg-superficie-2">
              <span className="block h-full rounded-full bg-serie-1/70" style={{ width: `${Math.max(parte * 100, 0.5)}%` }} />
            </span>
          </span>
          <span className="flex-none text-right tabular-nums">
            <span className="block text-[13px] font-medium text-tinta">{fmtNum(no.valor)}</span>
            <span className="block text-[11px] text-tinta-3">{fmtPct(parte * 100, parte < 0.01 ? 1 : 0)}</span>
          </span>
        </button>
        {grupo && aberto && <ul>{no.filhos!.map((f) => linha(f, nivel + 1))}</ul>}
      </li>
    );
  };

  return (
    <figure className="cartao flex flex-col p-4 sm:p-5">
      <figcaption className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold leading-snug text-tinta">
            {props.titulo}
            {props.ajuda && <Ajuda termo={props.ajuda} />}
          </h3>
          {props.subtitulo && <p className="mt-0.5 text-[13px] text-tinta-3">{props.subtitulo}</p>}
        </div>
        {props.tabela && (
          <MenuGrafico
            titulo={props.titulo}
            itens={[props.tabela.linhas.length ? { rotulo: "Baixar dados (CSV)", icone: ICONE_CSV, aoEscolher: () => baixarCsv(props.tabela!.colunas, props.tabela!.linhas, props.titulo) } : null]}
          />
        )}
      </figcaption>
      {props.carregando && !props.nos.length ? (
        <div className="h-[420px] animate-pulse rounded-xl bg-gradient-to-br from-superficie-2 to-serie-1/10" />
      ) : visiveis.length ? (
        <ul className="-mx-1 max-h-[440px] overflow-y-auto overscroll-contain px-1">{visiveis.map((n) => linha(n, 0))}</ul>
      ) : (
        <p className="grid h-24 place-items-center text-sm text-tinta-3">Nada com “{props.busca.trim()}” nesta lente.</p>
      )}
    </figure>
  );
}
