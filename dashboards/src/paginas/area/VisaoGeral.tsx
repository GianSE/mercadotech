import { ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { base, eixo, Grafico, Legenda } from "../../components/Grafico";
import { Indicador } from "../../components/Indicador";
import { Painel } from "../../components/Painel";
import { Card, CardContent } from "../../components/ui/card";
import type { Area as TipoArea } from "../../lib/areas";
import { useTabela, type Linha } from "../../lib/dados";
import { fmt } from "../../lib/formato";
import { areaDegrade } from "../../lib/graficos";
import { estoqueAnual, LENTES, resumir, rotuloLente } from "../../lib/rais";

/*
 * Visão geral: os números do último ano, o estoque pelas duas lentes do
 * recorte e a resposta de cada pergunta, sem filtro e sem o DuckDB (as
 * tabelas lidas aqui são pequenas e vão direto pelo hyparquet).
 *
 * As respostas são as do quadro de síntese das considerações finais do TCC:
 * os dados do trabalho estão congelados no corte de setembro de 2026 (CAGED)
 * e 2025 (RAIS), e o texto e o site mostram os mesmos números.
 */

const RESPOSTAS = [
  { secao: "crescimento", pergunta: "1. Quanto o mercado cresceu?", resposta: "162% em dezoito anos (5,5% ao ano), em ondas: queda na recessão de 2015–2016, 38% de todo o crescimento em 2021 e 2022 e desaceleração depois." },
  { secao: "onde", pergunta: "2. Onde está o trabalho de TI?", resposta: "58% dos profissionais de TI trabalham fora de empresas de TI, contra 71% em 2007. São Paulo concentra 41% do estoque, mas a conclusão de crescimento não depende dele." },
  { secao: "qualidade", pergunta: "3. O emprego melhorou em qualidade?", resposta: "Não em remuneração relativa: a mediana em salários mínimos ficou estável. Melhorou em estabilidade: o giro anual caiu de mais de 43% até 2014 para cerca de 38%." },
  { secao: "equidade", pergunta: "4. Quem ganha menos, e por quê?", resposta: "O hiato racial caiu (de 64% para 38% entre brancos e pardos) por melhora de acesso. O de gênero surgiu depois de 2015 e está todo na parcela que o perfil não explica." },
  { secao: "futuro", pergunta: "5. Para onde o mercado vai?", resposta: "A previsão do saldo é útil por cerca de um ano. O nowcast errou em média 1,1% nos anos retidos e projeta 1,38 milhão de vínculos em 2026." },
] as const;

export function VisaoGeral({ area }: { area: TipoArea }) {
  const anual = useTabela(area.repo, "rais_estoque_anual", estoqueAnual);
  const resumo = anual.tipo === "pronto" ? resumir(anual.dados) : null;
  const mediana = useTabela(area.repo, "rais_mediana", medianaTotal);
  const carregando = anual.tipo === "carregando";
  const crescimento = anual.tipo === "pronto" && anual.dados.total.length > 1 ? anual.dados.total.at(-1)! / anual.dados.total[0] - 1 : null;

  return (
    <div className="flex flex-col gap-8">
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Indicador
          titulo={resumo ? `Vínculos ativos em 31/12/${resumo.ano}` : "Vínculos ativos"}
          valor={carregando ? undefined : resumo ? fmt.inteiro(resumo.estoque) : "—"}
          variacao={resumo?.variacao}
        />
        <Indicador
          titulo="Crescimento desde 2007"
          valor={carregando ? undefined : crescimento !== null ? fmt.variacao(crescimento) : "—"}
          nota="estoque da RAIS em 31/12"
        />
        <Indicador
          titulo="Fora do setor de TI"
          valor={carregando ? undefined : resumo ? fmt.parte(resumo.foraDoSetor) : "—"}
          nota="dos profissionais de TI trabalham em empresa de outro setor"
        />
        <Indicador
          titulo="Remuneração mediana"
          valor={mediana.tipo === "pronto" && mediana.dados ? fmt.sm(mediana.dados) : mediana.tipo === "carregando" ? undefined : "—"}
          nota="em salários mínimos, vínculos ativos"
        />
      </section>

      <Painel
        titulo="Vínculos ativos ano a ano, pelas duas lentes do recorte"
        descricao="RAIS · estoque em 31 de dezembro. Quem exerce ocupação de TI, dentro e fora das empresas de TI, e quem trabalha numa empresa de TI em outra ocupação."
        estado={anual}
        altura={320}
        tabela={(e) => ({
          colunas: [{ chave: "ano", rotulo: "Ano" }, ...LENTES.map((k) => ({ chave: k, rotulo: rotuloLente(area, k), formato: fmt.inteiro })), { chave: "total", rotulo: "Total", formato: fmt.inteiro }],
          linhas: e.anos.map((ano, i) => ({ ano, ...Object.fromEntries(LENTES.map((k) => [k, e.porLente[k][i]])), total: e.total[i] })),
        })}
      >
        {(e) => (
          <>
            <Legenda nomes={LENTES.map((k) => rotuloLente(area, k))} />
            <Grafico
              rotulo={`Vínculos ativos de TI por lente, ${e.anos[0]} a ${e.anos.at(-1)}`}
              altura={320}
              opcao={(t) => ({
                ...base(t),
                legend: { show: false },
                grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
                tooltip: { ...(base(t).tooltip as object), trigger: "axis", valueFormatter: (v: number) => fmt.inteiro(v) },
                xAxis: eixo(t, { type: "category", data: e.anos, boundaryGap: false, splitLine: { show: false } }),
                yAxis: eixo(t, { type: "value", axisLabel: { color: t.rotulo, formatter: (v: number) => fmt.compacto(v) } }),
                series: LENTES.map((k, i) => ({
                  name: rotuloLente(area, k),
                  type: "line",
                  stack: "total",
                  data: e.porLente[k],
                  showSymbol: false,
                  lineStyle: { width: 2 },
                  areaStyle: areaDegrade(t.series[i], 0.3),
                })),
              })}
            />
          </>
        )}
      </Painel>

      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight">As cinco perguntas</h2>
          <p className="max-w-3xl text-muted-foreground">
            O crescimento não trouxe melhores salários relativos, e trouxe mais equidade num eixo e menos no outro: o hiato racial caiu, o de gênero surgiu.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {RESPOSTAS.map((r) => (
            <Link key={r.secao} href={`/${r.secao}`} className="group rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
              <Card className="h-full gap-2 py-4 transition-colors group-hover:border-primary/50">
                <CardContent className="flex h-full flex-col gap-2">
                  <span className="font-medium">{r.pergunta}</span>
                  <span className="text-sm text-muted-foreground">{r.resposta}</span>
                  <span className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-medium text-primary">
                    Ver os dados <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function medianaTotal(linhas: Linha[]): number | null {
  const total = linhas.filter((l) => l.recorte === "total");
  if (!total.length) return null;
  const ano = Math.max(...total.map((l) => l.ano as number));
  return (total.find((l) => l.ano === ano)?.mediana_sm as number) ?? null;
}
