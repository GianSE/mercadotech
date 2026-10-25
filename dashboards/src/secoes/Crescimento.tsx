import { useMemo, useState } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, Kpi, LinhaFiltros, type Periodo } from "../componentes/ui";
import { useFiltro } from "../lib/filtro";
import { fmtCompacto, fmtDec, fmtNum, fmtSinal } from "../lib/formato";
import { opcaoBarras, opcaoLinhas } from "../lib/graficos";
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

  const raisL = rais.linhas;
  const a = anual.linhas;
  const crescimento = raisL.length > 1 ? (num(raisL.at(-1), "estoque") / num(raisL[0], "estoque") - 1) * 100 : NaN;
  const saldoTotal = a.reduce((s, l) => s + num(l, "saldo"), 0);

  const op = useMemo(() => {
    const anosA = rotulos(a, "ano");
    return {
      saldo: a.length
        ? opcaoBarras(c, anosA, coluna(a, "saldo"), { divergente: true, formato: fmtSinal, nome: "Saldo", esmaecer: [anosA.indexOf(String(anoParcial))] })
        : null,
      estoque: raisL.length
        ? opcaoLinhas(c, rotulos(raisL, "ano"), [{ nome: "Vínculos ativos em 31/12", dados: coluna(raisL, "estoque"), area: true, rotuloFinal: true }], { formato: fmtNum, zero: true })
        : null,
    };
  }, [a, raisL, anoParcial, c]);

  const parcial = periodo[1] >= anoParcial && anoParcial ? ` · ${anoParcial} até ${ultimoMes}` : "";

  return (
    <>
      <CabecalhoPergunta numero={1} pergunta="Quanto o mercado cresceu, e em que ritmo?" />
      <LinhaFiltros resumo={`${periodo[0]}–${periodo[1]}`}>
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
          rotulo="Crescimento do estoque"
          valor={Number.isFinite(crescimento) ? `${crescimento >= 0 ? "+" : ""}${fmtDec(crescimento, 0)}%` : "—"}
          detalhe={raisL.length ? `RAIS, ${num(raisL[0], "ano")}–${num(raisL.at(-1), "ano")}` : undefined}
        />
        <Kpi rotulo={`Vínculos ativos em ${num(raisL.at(-1), "ano") || "—"}`} valor={fmtCompacto(num(raisL.at(-1), "estoque"))} detalhe="RAIS, 31/12" />
        <Kpi rotulo="Saldo no período" valor={a.length ? fmtSinal(saldoTotal) : "—"} detalhe="CAGED, vagas líquidas" />
      </Grade>

      <Bloco titulo="Estoque">
        <CartaoGrafico
          titulo={`Vínculos de TI ativos em 31/12 · ${f.rotulo}`}
          subtitulo="RAIS · setor ou ocupação de TI"
          opcao={op.estoque}
          carregando={rais.carregando}
          erro={rais.erro}
          altura={320}
          tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "estoque", rotulo: "Vínculos ativos", formato: fmtNum, numero: true }], linhas: raisL }}
        />
      </Bloco>

      <Bloco titulo="Fluxo">
        <CartaoGrafico
          titulo={`Saldo anual de empregos · ${f.rotulo}`}
          subtitulo={`CAGED · admissões − desligamentos${parcial}`}
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
            linhas: a,
          }}
        />
      </Bloco>
    </>
  );
}
