import { useState, type ReactNode } from "react";
import { useFiltro } from "../lib/filtro";
import { SeletorUF } from "./SeletorUF";

// Só o rótulo e a pergunta: a resposta, com a leitura dos números, mora na
// página Análise — as páginas de pergunta são painel, não texto.
export function CabecalhoPergunta({ numero, pergunta }: { numero: number; pergunta: string }) {
  return (
    // data-fixo: no modo apresentação, aparece em todos os slides da página.
    <header data-fixo className="mb-6">
      <p className="sobrelinha">
        <span className="mr-2 inline-block h-2 w-2 rounded-[2px] bg-acento align-middle" />
        Pergunta {String(numero).padStart(2, "0")} / 05
      </p>
      <h1 className="mt-2 text-[1.6rem] font-semibold leading-tight tracking-tight text-tinta sm:text-3xl">{pergunta}</h1>
    </header>
  );
}

export function Bloco({ titulo, descricao, children }: { titulo: string; descricao?: ReactNode; children: ReactNode }) {
  return (
    // data-bloco: cada bloco é um slide no modo apresentação.
    <section data-bloco className="mt-12 first:mt-0">
      <div className="mb-4">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold text-tinta">
          <span aria-hidden className="faixa-azul h-5 w-1.5 flex-none rounded-full" />
          {titulo}
        </h2>
        {descricao && <p className="mt-1 max-w-3xl text-sm text-tinta-3">{descricao}</p>}
      </div>
      {/* min-w-0: item de grid não encolhe abaixo do conteúdo (tabela larga,
          texto longo) e empurraria a página para o lado no celular. */}
      <div className="grid gap-4 [&>*]:min-w-0">{children}</div>
    </section>
  );
}

export function Grade({ children, colunas = 2 }: { children: ReactNode; colunas?: 2 | 3 | 4 }) {
  // KPIs (3 e 4 colunas) já vão em 2 no celular; o último ímpar ocupa a linha toda.
  const cls = {
    2: "lg:grid-cols-2",
    3: "grid-cols-2 lg:grid-cols-3 [&>*:last-child:nth-child(odd)]:col-span-2 lg:[&>*:last-child:nth-child(odd)]:col-span-1",
    4: "grid-cols-2 lg:grid-cols-4",
  }[colunas];
  return <div className={`grid gap-4 [&>*]:min-w-0 ${cls}`}>{children}</div>;
}



export function Kpi({ rotulo, valor, detalhe, destaque }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; destaque?: boolean }) {
  return (
    <div className={`cartao relative overflow-hidden p-4 ${destaque ? "shadow-[inset_3px_0_0_var(--acento)]" : ""}`}>
      <span aria-hidden className="faixa-azul absolute inset-x-0 top-0 h-[3px] opacity-70" />
      <p className="text-[13px] leading-snug text-tinta-3">{rotulo}</p>
      <p className="mt-1.5 bg-gradient-to-r from-tinta to-serie-1 bg-clip-text text-[1.6rem] font-semibold tracking-tight break-words text-transparent sm:text-2xl">{valor}</p>
      {detalhe && <p className="mt-1 text-[12px] text-tinta-3">{detalhe}</p>}
    </div>
  );
}

// Uma linha só, acima de tudo que ela filtra. No celular vira uma barra
// presa sob o cabeçalho com o resumo do recorte; os controles abrem num toque
// em vez de ocupar meia tela antes do primeiro gráfico.
// `territorio` põe o seletor de estados (filtro global) à frente dos demais.
export function LinhaFiltros({ children, nota, resumo, territorio = true }: { children?: ReactNode; nota?: ReactNode; resumo?: ReactNode; territorio?: boolean }) {
  const [aberto, setAberto] = useState(false);
  const filtro = useFiltro();
  const resumoCompleto = territorio ? [filtro.rotulo, resumo].filter(Boolean).join(" · ") : resumo;
  return (
    <div data-fixo data-filtros className="sticky top-[57px] z-10 -mx-4 mb-8 border-b border-borda bg-fundo/85 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 sm:py-3 lg:top-[57px]">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-3 rounded-xl py-1 text-left sm:hidden"
      >
        <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-serie-1/15 text-serie-1" aria-hidden>
          <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current"><path d="M2 4h16l-6 7v5l-4 2v-7L2 4Z" /></svg>
        </span>
        <span className="min-w-0 flex-1">
          <span className="sobrelinha block">Filtros</span>
          <span className="block truncate text-[14px] font-medium text-tinta">{resumoCompleto || "Ajustar recorte"}</span>
        </span>
        <svg viewBox="0 0 20 20" aria-hidden className={`h-5 w-5 flex-none fill-tinta-3 transition-transform ${aberto ? "rotate-180" : ""}`}>
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>
      <div className={`${aberto ? "mt-3 grid" : "hidden"} gap-3 sm:mt-0 sm:flex sm:flex-wrap sm:items-end sm:gap-x-4 sm:gap-y-3`}>
        {territorio && <SeletorUF />}
        {children}
      </div>
      {nota && <p className={`${aberto ? "block" : "hidden"} mt-3 text-[12px] leading-relaxed text-tinta-3 sm:mt-2 sm:block`}>{nota}</p>}
    </div>
  );
}

export function Seletor<T extends string | number>(props: {
  rotulo: string;
  valor: T;
  opcoes: { valor: T; rotulo: string }[];
  aoMudar: (v: T) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="sobrelinha">{props.rotulo}</span>
      <select
        value={String(props.valor)}
        onChange={(e) => {
          const escolhida = props.opcoes.find((o) => String(o.valor) === e.target.value);
          if (escolhida) props.aoMudar(escolhida.valor);
        }}
        // 16px no celular: abaixo disso o iOS dá zoom na página ao focar o campo.
        className="h-11 w-full min-w-[7rem] rounded-[var(--radius-controle)] border border-borda bg-superficie px-3 text-base text-tinta shadow-sm transition-colors hover:border-serie-1/60 sm:h-9 sm:w-auto sm:max-w-[16rem] sm:px-2.5 sm:text-sm"
      >
        {props.opcoes.map((o) => (
          <option key={String(o.valor)} value={String(o.valor)}>{o.rotulo}</option>
        ))}
      </select>
    </label>
  );
}

export type Periodo = [number, number];

export function FiltroPeriodo({ anos, valor, aoMudar, atalhos = [] }: {
  anos: number[];
  valor: Periodo;
  aoMudar: (p: Periodo) => void;
  atalhos?: { rotulo: string; periodo: Periodo }[];
}) {
  const opcoes = anos.map((a) => ({ valor: a, rotulo: String(a) }));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:contents">
        <Seletor rotulo="De" valor={valor[0]} opcoes={opcoes} aoMudar={(a) => aoMudar([a, Math.max(a, valor[1])])} />
        <Seletor rotulo="Até" valor={valor[1]} opcoes={opcoes} aoMudar={(a) => aoMudar([Math.min(a, valor[0]), a])} />
      </div>
      {atalhos.length > 0 && (
        <div className="flex flex-wrap gap-2 pb-0.5 sm:gap-1.5">
          {atalhos.map((a) => {
            const ativo = a.periodo[0] === valor[0] && a.periodo[1] === valor[1];
            return (
              <button
                key={a.rotulo}
                type="button"
                onClick={() => aoMudar(a.periodo)}
                aria-pressed={ativo}
                className={`h-10 rounded-full border px-4 text-[14px] transition-colors sm:h-8 sm:px-3 sm:text-[13px] ${ativo ? "border-acento bg-acento font-medium text-sobre-acento" : "border-borda bg-superficie text-tinta-2 hover:border-serie-1/60 hover:text-tinta"}`}
              >
                {a.rotulo}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}


// Página (ou bloco) inteira sem recorte por estado, com o filtro ligado.
export function AvisoNacional({ children }: { children?: ReactNode }) {
  const filtro = useFiltro();
  if (!filtro.ativo) return null;
  return (
    <div role="note" className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-borda bg-superficie-2/60 px-4 py-3 text-[14px] text-tinta-2">
      <span>
        {children ?? <>Os dados desta página são nacionais: o filtro <strong className="text-tinta">{filtro.rotulo}</strong> não se aplica aqui.</>}
      </span>
      <button type="button" onClick={filtro.limpar} className="rounded-full border border-borda px-3 py-1 text-[13px] text-tinta-2 hover:border-serie-1/60 hover:text-tinta">
        Voltar para o Brasil
      </button>
    </div>
  );
}
