import { Award, BookOpen, Cpu, LayoutDashboard, MapPin, Scale, Telescope, TrendingUp } from "lucide-react";
import { lazy, Suspense, useEffect, type ComponentProps } from "react";
import { Link, useLocation } from "wouter";
import { Skeleton } from "../components/ui/skeleton";
import { TI } from "../lib/areas";
import { ProvedorFiltro } from "../lib/filtro";
import { cn } from "../lib/utils";
import { VisaoGeral } from "./area/VisaoGeral";

// As seções que consultam com SQL trazem o DuckDB: só carregam quando abertas.
const Crescimento = lazy(() => import("./area/Crescimento").then((m) => ({ default: m.Crescimento })));
const Onde = lazy(() => import("./area/Onde").then((m) => ({ default: m.Onde })));
const Qualidade = lazy(() => import("./area/Qualidade").then((m) => ({ default: m.Qualidade })));
const Equidade = lazy(() => import("./area/Equidade").then((m) => ({ default: m.Equidade })));
const Futuro = lazy(() => import("./area/Futuro").then((m) => ({ default: m.Futuro })));
const Metodo = lazy(() => import("./area/Metodo").then((m) => ({ default: m.Metodo })));

/*
 * Uma aba por pergunta de pesquisa do TCC (quadro 1 da introdução), na mesma
 * ordem e com o mesmo número, entre a visão geral e o método. Um gráfico só
 * fica numa aba se sustenta a resposta daquela pergunta.
 */
export const SECOES = [
  { id: "", rotulo: "Visão geral", curto: "Visão geral", icone: LayoutDashboard },
  { id: "crescimento", rotulo: "1 · Crescimento", curto: "Crescimento", icone: TrendingUp },
  { id: "onde", rotulo: "2 · Onde", curto: "Onde", icone: MapPin },
  { id: "qualidade", rotulo: "3 · Qualidade", curto: "Qualidade", icone: Award },
  { id: "equidade", rotulo: "4 · Equidade", curto: "Equidade", icone: Scale },
  { id: "futuro", rotulo: "5 · Futuro", curto: "Futuro", icone: Telescope },
  { id: "metodo", rotulo: "Método", curto: "Método", icone: BookOpen },
] as const;

export function Area({ secao = "" }: { secao?: string }) {
  const atual = SECOES.find((s) => s.id === secao);
  useEffect(() => {
    document.title = `${atual?.id ? `${atual.curto} · ` : ""}Mercado de TI no Brasil`;
  }, [atual]);

  if (!atual) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-16">
        <h1 className="text-2xl font-semibold">Seção não encontrada</h1>
        <Link href="/" className="mt-4 inline-block underline underline-offset-4">
          Voltar para a visão geral
        </Link>
      </main>
    );
  }

  return (
    <ProvedorFiltro>
      <main className="mx-auto max-w-6xl px-4 pb-8">
        {/* A pergunta central do TCC: o maior peso da página. */}
        <header className="flex items-start gap-4 pt-8 pb-6">
          <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Cpu className="size-7" aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Mercado de TI no Brasil</h1>
            <p className="mt-1 max-w-3xl text-muted-foreground">
              O crescimento do emprego formal em tecnologia entre 2007 e 2026 veio acompanhado de melhores salários e de mais equidade?
            </p>
          </div>
        </header>

        {/* As seções: a navegação principal, na largura toda, com cara de botão. */}
        <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-card p-1.5 shadow-xs" aria-label="Seções">
          {SECOES.map((s) => (
            <LinkComFiltros
              key={s.id}
              href={`/${s.id}`}
              aria-current={s.id === secao ? "page" : undefined}
              className={cn(
                "inline-flex min-w-fit flex-1 flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-2 text-[11px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:gap-2 sm:px-3 sm:py-2.5 sm:text-sm",
                s.id === secao ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <s.icone className="size-4 shrink-0" aria-hidden />
              <span className="sm:hidden">{s.curto}</span>
              <span className="hidden sm:inline">{s.rotulo}</span>
            </LinkComFiltros>
          ))}
        </nav>

        <Suspense fallback={<Skeleton className="h-96" />}>
          {secao === "" && <VisaoGeral area={TI} />}
          {secao === "crescimento" && <Crescimento area={TI} />}
          {secao === "onde" && <Onde area={TI} />}
          {secao === "qualidade" && <Qualidade area={TI} />}
          {secao === "equidade" && <Equidade area={TI} />}
          {secao === "futuro" && <Futuro area={TI} />}
          {secao === "metodo" && <Metodo area={TI} />}
        </Suspense>
      </main>
    </ProvedorFiltro>
  );
}

/**
 * Link de aba que leva junto os filtros do endereço (?uf=, ?periodo=):
 * trocar de seção não perde o recorte. Lidos no clique, não na renderização,
 * porque o filtro muda sem a aba ser redesenhada.
 */
function LinkComFiltros({ href, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const [, navegar] = useLocation();
  return (
    <Link
      href={href}
      {...props}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navegar(href + window.location.search);
      }}
    />
  );
}
