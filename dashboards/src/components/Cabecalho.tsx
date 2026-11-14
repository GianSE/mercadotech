import { Moon, Sun } from "lucide-react";
import { Link } from "wouter";
import { useTema } from "../lib/tema";
import { Button } from "./ui/button";

/** A marca: três barras crescentes, o estoque que sobe. */
function Marca() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground" aria-hidden>
        <svg viewBox="0 0 16 16" className="size-4 fill-current">
          <rect x="2" y="8" width="3" height="6" rx="0.75" />
          <rect x="6.5" y="5" width="3" height="9" rx="0.75" />
          <rect x="11" y="2" width="3" height="12" rx="0.75" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">Mercado de TI</span>
        <span className="block text-[11px] tracking-wide text-muted-foreground">RAIS + CAGED · 2007–2026</span>
      </span>
    </span>
  );
}

export function Cabecalho() {
  const { tema, alternar } = useTema();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" aria-label="Mercado de TI no Brasil, visão geral" className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <Marca />
        </Link>
        <Button variant="ghost" size="icon" onClick={alternar} aria-label={tema === "escuro" ? "Usar tema claro" : "Usar tema escuro"}>
          {tema === "escuro" ? <Sun /> : <Moon />}
        </Button>
      </div>
    </header>
  );
}

const LINKS = [
  { href: "https://github.com/GianSE/mercadotech", rotulo: "Código no GitHub" },
  { href: "https://huggingface.co/datasets/Gianpedro/gold-analise-mercado-ti", rotulo: "Dados no Hugging Face" },
] as const;

export function Rodape() {
  return (
    <footer className="mt-16 border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-xl">
          Fonte: microdados da RAIS e do CAGED (MTE/PDET), traduzidos pelos dicionários oficiais. Gian Pedro Rodrigues · Trabalho de Conclusão de Curso ·
          Engenharia da Computação · UTFPR.
        </p>
        <ul className="flex flex-wrap gap-2">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-9 items-center rounded-full border bg-card px-3 text-foreground transition-colors outline-none hover:border-foreground/30 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {l.rotulo}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
