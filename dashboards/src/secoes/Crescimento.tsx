import { useMemo, useState } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, Kpi, Leitura, LinhaFiltros, type Periodo } from "../componentes/ui";
import { useFiltro } from "../lib/filtro";
import { fmtCompacto, fmtDec, fmtNum, fmtSinal } from "../lib/formato";
import { opcaoBarras, opcaoLinhas } from "../lib/graficos";
import { arcoSaldo, TextoEstoque, TextoSaldo } from "../lib/narrativa";
import { coluna, entre, intervalo, num, rotulos, tabelaRais, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2026);

export default function Crescimento() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [periodo, setPeriodo] = useState<Periodo>([2007, 2026]);

  const referencia = useConsulta("SELECT strftime(max(mes), '%m/%Y') AS ultimo, year(max(mes)) AS ano FROM serie_mensal");
  const ultimoMes = String(referencia.linhas[0]?.ultimo ?? "");
  const anoParcial = num(referencia.linhas[0], "ano");

  const anual = useConsulta(`
    SELECT ano, sum(saldo)::DOUBLE AS saldo, sum(admissoes)::DOUBLE AS admissoes, sum(desligamentos)::DOUBLE AS desligamentos
    FROM caged_cubo WHERE ${entre(periodo)} AND ${f.sql()} GROUP BY 1 ORDER BY 1`);
  const rais = useConsulta(`
    SELECT ano, sum(estoque_3112)::DOUBLE AS estoque
    FROM ${tabelaRais(f.ativo)} WHERE ${TI} AND ${entre(periodo)} AND ${f.sql()} GROUP BY 1 ORDER BY 1`);

  const arco = useMemo(() => arcoSaldo(anual.linhas, anoParcial), [anual.linhas, anoParcial]);
  const raisL = rais.linhas;
  const crescimento = raisL.length > 1 ? (num(raisL.at(-1), "estoque") / num(raisL[0], "estoque") - 1) * 100 : NaN;

  const op = useMemo(() => {
    const a = anual.linhas;
    const anosA = rotulos(a, "ano");
    return {
      saldo: a.length
        ? opcaoBarras(c, anosA, coluna(a, "saldo"), { divergente: true, formato: fmtSinal, nome: "Saldo", esmaecer: [anosA.indexOf(String(anoParcial))] })
        : null,
      estoque: raisL.length
        ? opcaoLinhas(c, rotulos(raisL, "ano"), [{ nome: "Vínculos ativos em 31/12", dados: coluna(raisL, "estoque"), area: true, rotuloFinal: true }], { formato: fmtNum, zero: true })
        : null,
    };
  }, [anual.linhas, raisL, anoParcial, c]);

  const parcial = periodo[1] >= anoParcial && anoParcial ? ` · ${anoParcial} parcial (até ${ultimoMes})` : "";

  return (
    <>
      <CabecalhoPergunta
        numero={1}
        pergunta="Quanto o mercado cresceu, e em que ritmo?"
        resposta="Cresceu muito, com o salto concentrado em 2021–22 — e o ritmo agora desacelera."
      />
      <LinhaFiltros resumo={`${periodo[0]}–${periodo[1]}`} nota="O território e o período valem para todos os gráficos desta página. A RAIS vai até 2025; o CAGED, até o último mês publicado.">
        <FiltroPeriodo
          anos={ANOS}
          valor={periodo}
          aoMudar={setPeriodo}
          atalhos={[
            { rotulo: "Tudo", periodo: [2007, 2026] },
            { rotulo: "Novo CAGED", periodo: [2020, 2026] },
            { rotulo: "Pré-pandemia", periodo: [2007, 2019] },
          ]}
        />
      </LinhaFiltros>

      <Grade colunas={3}>
        <Kpi
          destaque
          rotulo={`Crescimento do estoque · ${f.rotulo}`}
          valor={Number.isFinite(crescimento) ? `${crescimento >= 0 ? "+" : ""}${fmtDec(crescimento, 0)}%` : "—"}
          detalhe={raisL.length ? `RAIS, ${num(raisL[0], "ano")}–${num(raisL.at(-1), "ano")}` : undefined}
        />
        <Kpi rotulo={`Vínculos ativos em ${num(raisL.at(-1), "ano") || "—"}`} valor={fmtCompacto(num(raisL.at(-1), "estoque"))} detalhe="RAIS, estoque em 31/12" />
        <Kpi rotulo="Saldo no período" valor={arco ? fmtSinal(arco.saldoTotal) : "—"} detalhe="CAGED, vagas líquidas" />
      </Grade>

      <Bloco titulo="O estoque: de que tamanho o mercado é" descricao="A RAIS fotografa os vínculos ativos em 31 de dezembro. É o nível; o CAGED, abaixo, mostra como ele se move durante o ano.">
        <CartaoGrafico
          titulo={`Vínculos de tecnologia ativos em 31/12 · ${f.rotulo}`}
          subtitulo="RAIS · setor de TI ou ocupação de TI"
          opcao={op.estoque}
          carregando={rais.carregando}
          erro={rais.erro}
          altura={320}
          tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "estoque", rotulo: "Vínculos ativos", formato: fmtNum, numero: true }], linhas: raisL }}
          rodape={
            <>
              Vínculos que existiram e terminaram durante o ano ficam fora do estoque — somá-los inflaria o número.
              {periodo[0] <= 2022 && periodo[1] >= 2022 && (
                <> 2022 está subestimado: a camada publicada ainda não tem a correção da ingestão parcial desse ano, concentrada no arquivo do Sudeste.</>
              )}
            </>
          }
        />
        {raisL.length > 1 && <Leitura><TextoEstoque anual={raisL} /></Leitura>}
      </Bloco>

      <Bloco titulo="O fluxo: quanto o mercado se moveu" descricao="O CAGED registra cada admissão e cada desligamento. O saldo é a diferença — a geração líquida de emprego formal.">
        <CartaoGrafico
          titulo={`Saldo anual de empregos em tecnologia · ${f.rotulo}`}
          subtitulo={`CAGED · admissões menos desligamentos${parcial ? `${parcial} — barra esmaecida` : ""}`}
          opcao={op.saldo}
          carregando={anual.carregando}
          erro={anual.erro}
          altura={320}
          tabela={{
            colunas: [
              { chave: "ano", rotulo: "Ano" },
              { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true },
              { chave: "desligamentos", rotulo: "Desligamentos", formato: fmtNum, numero: true },
              { chave: "saldo", rotulo: "Saldo", formato: fmtSinal, numero: true },
            ],
            linhas: anual.linhas,
          }}
        />
        {arco && <Leitura><TextoSaldo a={arco} /></Leitura>}
      </Bloco>
    </>
  );
}
