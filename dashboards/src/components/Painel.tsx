import { ChartColumn, CircleAlert, Clock, Download, Globe, Table } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { Estado } from "../lib/dados";
import { useFiltroOpcional } from "../lib/filtro";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Skeleton } from "./ui/skeleton";

export type Tabela = {
  colunas: { chave: string; rotulo: string; formato?: (v: number) => string }[];
  linhas: Record<string, unknown>[];
};

type Props<T> = {
  titulo: string;
  descricao?: ReactNode;
  /** `anterior`: o resultado da consulta passada, mostrado esmaecido enquanto a nova carrega. */
  estado: Estado<T> & { anterior?: T };
  altura?: number;
  /** Os mesmos números do gráfico, em tabela: o leitor de tela e quem quer o número exato. */
  tabela?: (dados: T) => Tabela;
  /** Controles do gráfico (Ano/Mês, séries), entre o título e o gráfico. */
  controles?: ReactNode;
  /**
   * O gráfico é calculado só para o país (decomposição, sobrevivência,
   * previsão): com o filtro de território ligado, um selo avisa que ele
   * continua nacional, em vez de parecer que respondeu ao filtro.
   */
  nacional?: boolean;
  children: (dados: T) => ReactNode;
};

/**
 * O cartão de um gráfico. Enquanto a tabela carrega pela primeira vez, um
 * esqueleto do mesmo tamanho; se a Gold não tem a tabela, um
 * aviso em vez de quebrar a página.
 */
export function Painel<T>({ titulo, descricao, estado, altura = 300, tabela, controles, nacional, children }: Props<T>) {
  const [verTabela, setVerTabela] = useState(false);
  const filtro = useFiltroOpcional();
  const dados = estado.tipo === "pronto" ? estado.dados : estado.tipo === "carregando" ? estado.anterior : undefined;
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>{titulo}</CardTitle>
          {descricao && <CardDescription>{descricao}</CardDescription>}
          {nacional && filtro?.ativo && (
            <span className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full border bg-secondary px-2.5 py-0.5 text-xs text-secondary-foreground">
              <Globe className="size-3.5" aria-hidden /> Brasil inteiro: este gráfico não segue o filtro de {filtro.rotulo}
            </span>
          )}
        </div>
        {tabela && dados !== undefined && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setVerTabela((v) => !v)} aria-pressed={verTabela}>
              {verTabela ? <ChartColumn aria-hidden /> : <Table aria-hidden />}
              {verTabela ? "Gráfico" : "Tabela"}
            </Button>
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => baixarCsv(titulo, tabela(dados))} aria-label={`Baixar os dados de ${titulo} em CSV`}>
              <Download aria-hidden />
              CSV
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {controles}
        {dados !== undefined ? (
          <div className={cn("transition-opacity", estado.tipo === "carregando" && "opacity-50")} aria-busy={estado.tipo === "carregando"}>
            {verTabela && tabela ? <TabelaDados {...tabela(dados)} altura={altura} /> : children(dados)}
          </div>
        ) : estado.tipo === "carregando" ? (
          <Skeleton style={{ height: altura }} />
        ) : estado.tipo === "ausente" ? (
          <Aviso altura={altura} icone={<Clock className="size-5" />}>
            Estes dados ainda não foram publicados na Gold.
          </Aviso>
        ) : estado.tipo === "erro" ? (
          <Aviso altura={altura} icone={<CircleAlert className="size-5" />}>
            Não foi possível carregar os dados ({estado.mensagem}).
          </Aviso>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Os números da tabela em CSV: valores crus (ponto decimal, sem separador de
 * milhar), para abrir em planilha ou ler em código sem reformatar. O BOM faz
 * o Excel reconhecer o UTF-8 dos acentos.
 */
function baixarCsv(titulo: string, { colunas, linhas }: Tabela) {
  const campo = (v: unknown) => {
    const t = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const texto = [colunas.map((c) => campo(c.rotulo)).join(","), ...linhas.map((l) => colunas.map((c) => campo(l[c.chave])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "dados"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function TabelaDados({ colunas, linhas, altura }: Tabela & { altura: number }) {
  return (
    <div className="overflow-auto rounded-lg border" style={{ maxHeight: altura }}>
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-secondary text-left">
          <tr>
            {colunas.map((c, i) => (
              <th key={c.chave} className={cn("px-3 py-2 font-medium", i > 0 && "text-right")}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-t">
              {colunas.map((c, j) => {
                const v = l[c.chave];
                const texto = v === null || v === undefined ? "—" : c.formato ? c.formato(Number(v)) : String(v);
                return (
                  <td key={c.chave} className={cn("px-3 py-1.5", j > 0 && "text-right")}>
                    {texto}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Aviso({ altura, icone, children }: { altura: number; icone: ReactNode; children: ReactNode }) {
  return (
    <div
      style={{ height: altura }}
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center text-sm text-muted-foreground"
    >
      {icone}
      {children}
    </div>
  );
}
