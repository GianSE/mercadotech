import { TrendingDown, TrendingUp } from "lucide-react";
import type { ReactNode } from "react";
import { fmt } from "../lib/formato";
import { cn } from "../lib/utils";
import { Card, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

type Props = {
  titulo: string;
  valor?: string;
  /** variação relativa; a seta e a cor só acompanham o texto, nunca o substituem */
  variacao?: number | null;
  nota?: ReactNode;
};

export function Variacao({ v, sufixo }: { v: number; sufixo?: string }) {
  const Icone = v >= 0 ? TrendingUp : TrendingDown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm font-medium", v >= 0 ? "text-sobe" : "text-desce")}>
      <Icone className="size-4" aria-hidden />
      {fmt.variacao(v)}
      {sufixo && <span className="font-normal text-muted-foreground">{sufixo}</span>}
    </span>
  );
}

export function Indicador({ titulo, valor, variacao, nota }: Props) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex flex-col gap-1.5">
        <span className="text-sm text-muted-foreground">{titulo}</span>
        {valor === undefined ? (
          <Skeleton className="h-8 w-28" />
        ) : (
          <span className="text-2xl font-semibold tracking-tight">{valor}</span>
        )}
        {variacao != null && <Variacao v={variacao} sufixo="no ano" />}
        {nota && <span className="text-xs text-muted-foreground">{nota}</span>}
      </CardContent>
    </Card>
  );
}
