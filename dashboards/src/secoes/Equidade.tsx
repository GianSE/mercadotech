import { useMemo, useState } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, Kpi, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { escapar, fmtDec, fmtNum, fmtPct, fmtReais } from "../lib/formato";
import { opcaoBarrasAgrupadas, opcaoLinhas, opcaoRosca } from "../lib/graficos";
import { useFiltro } from "../lib/filtro";
import { coluna, entre, intervalo, num, rotulos, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2026);
const COMPARACOES = ["Homem vs Mulher", "Branca vs Preta", "Branca vs Parda"];

const perfilSql = (dim: string, p: Periodo, territorio: string) => `
  SELECT ${dim} AS categoria, sum(admissoes)::DOUBLE AS admissoes,
         sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
  FROM caged_cubo WHERE ${entre(p)} AND ${territorio} AND ${dim} IS NOT NULL AND ${dim} <> 'Não informado'
  GROUP BY 1 ORDER BY 2 DESC`;

export default function Equidade() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [periodo, setPeriodo] = useState<Periodo>([2007, 2026]);
  const [comparacao, setComparacao] = useState(COMPARACOES[0]);

  const sexo = useConsulta(perfilSql("sexo", periodo, f.sql()));
  const raca = useConsulta(perfilSql("raca_cor", periodo, f.sql()));
  const feminina = useConsulta(`
    SELECT ano, 100 * sum(estoque_3112) FILTER (WHERE sexo = 'Mulher') / sum(estoque_3112) FILTER (WHERE sexo IN ('Homem', 'Mulher')) AS mulheres
    FROM rais_estoque_perfil WHERE ${TI} AND ${entre([periodo[0], Math.min(periodo[1], 2025)])} GROUP BY 1 ORDER BY 1`);
  const hiato = useConsulta(`
    SELECT ano, hiato_pct, hiato_log, explicada, nao_explicada, explicada_share, salario_a, salario_b
    FROM hiato_serie WHERE comparacao = '${comparacao}' ORDER BY ano`);

  const s = sexo.linhas;
  const fem = feminina.linhas;
  const h = hiato.linhas;
  const [hp, hu] = [h[0], h.at(-1)];
  const [grupoA, grupoB] = comparacao.split(" vs ");

  const op = useMemo(() => {
    const extra = (linhas: typeof s) => (i: number) =>
      linhas[i]?.salario ? `<div style="margin-top:3px;opacity:.85">Salário médio de admissão: <strong>${escapar(fmtReais(linhas[i].salario))}</strong></div>` : "";
    return {
      sexo: s.length ? opcaoRosca(c, s.map((l) => ({ nome: String(l.categoria), valor: num(l, "admissoes") })), { centro: "admissões", extraTooltip: extra(s) }) : null,
      raca: raca.linhas.length
        ? opcaoRosca(c, raca.linhas.map((l) => ({ nome: String(l.categoria), valor: num(l, "admissoes") })), { centro: "admissões", extraTooltip: extra(raca.linhas) })
        : null,
      feminina: fem.length ? opcaoLinhas(c, rotulos(fem, "ano"), [{ nome: "Mulheres no estoque", dados: coluna(fem, "mulheres"), rotuloFinal: true }], { formato: (v) => fmtPct(v, 1), formatoEixo: (v) => fmtPct(v, 0) }) : null,
      hiato: h.length
        ? opcaoBarrasAgrupadas(
            c,
            rotulos(h, "ano"),
            [
              { nome: "Parte explicada", dados: coluna(h, "explicada") },
              { nome: "Parte não explicada", dados: coluna(h, "nao_explicada") },
            ],
            { empilhar: true, formato: (v) => fmtDec(v, 3), linha: { nome: "Hiato total (log)", dados: coluna(h, "hiato_log") } },
          )
        : null,
    };
  }, [s, raca.linhas, fem, h, c]);

  return (
    <>
      <CabecalhoPergunta
        numero={4}
        pergunta="Quem ganha menos, e por quê?"
      />
      <LinhaFiltros resumo={`${periodo[0]}–${periodo[1]}`}>
        <FiltroPeriodo anos={ANOS} valor={periodo} aoMudar={setPeriodo} atalhos={[{ rotulo: "Tudo", periodo: [2007, 2026] }, { rotulo: "Novo CAGED", periodo: [2020, 2026] }]} />
      </LinhaFiltros>

      <Bloco titulo="Quem é contratado">
        <Grade>
          <CartaoGrafico
            titulo={`Por sexo · ${f.rotulo}`}
            subtitulo="CAGED · admissões"
            opcao={op.sexo}
            carregando={sexo.carregando}
            erro={sexo.erro}
            altura={160}
            tabela={{ colunas: [{ chave: "categoria", rotulo: "Sexo" }, { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true }, { chave: "salario", rotulo: "Salário médio", formato: fmtReais, numero: true }], linhas: s }}
          />
          <CartaoGrafico
            titulo={`Por raça/cor · ${f.rotulo}`}
            subtitulo="CAGED · admissões"
            opcao={op.raca}
            carregando={raca.carregando}
            altura={160}
            tabela={{ colunas: [{ chave: "categoria", rotulo: "Raça/cor" }, { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true }, { chave: "salario", rotulo: "Salário médio", formato: fmtReais, numero: true }], linhas: raca.linhas }}
          />
        </Grade>
          <CartaoGrafico
            titulo="Participação feminina no estoque"
            subtitulo="RAIS · % de mulheres entre os vínculos de TI ativos em 31/12"
            nacional
            opcao={op.feminina}
            carregando={feminina.carregando}
            altura={300}
            tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "mulheres", rotulo: "Mulheres", formato: (v) => fmtPct(v, 1), numero: true }], linhas: fem }}
          />
      </Bloco>

      <Bloco titulo="Hiato salarial: o que a composição explica e o que sobra">
        <div className="flex flex-wrap items-end gap-4">
          <Seletor rotulo="Comparação" valor={comparacao} opcoes={COMPARACOES.map((v) => ({ valor: v, rotulo: v }))} aoMudar={setComparacao} />
        </div>
        {hu && (
          <Grade colunas={3}>
            <Kpi destaque rotulo={`Hiato em ${num(hu, "ano")}`} valor={`${fmtDec(num(hu, "hiato_pct"), 1)}%`} detalhe={`${fmtDec(num(hu, "hiato_pct") - num(hp, "hiato_pct"), 1)} p.p. desde ${num(hp, "ano")}`} />
            <Kpi rotulo="Parte não explicada" valor={`${fmtDec(num(hu, "nao_explicada"), 3)} log`} detalhe={`era ${fmtDec(num(hp, "nao_explicada"), 3)} em ${num(hp, "ano")}`} />
            <Kpi rotulo="Parte explicada" valor={`${fmtDec(num(hu, "explicada"), 3)} log`} />
          </Grade>
        )}
        <CartaoGrafico
          titulo={`${grupoA} × ${grupoB}`}
          subtitulo="Barras empilhadas somam o hiato total (linha); unidades em log da remuneração"
          nacional
          opcao={op.hiato}
          carregando={hiato.carregando}
          erro={hiato.erro}
          altura={360}
          tabela={{
            colunas: [
              { chave: "ano", rotulo: "Ano" },
              { chave: "salario_a", rotulo: grupoA, formato: (v) => `${fmtDec(v, 2)} SM`, numero: true },
              { chave: "salario_b", rotulo: grupoB, formato: (v) => `${fmtDec(v, 2)} SM`, numero: true },
              { chave: "hiato_pct", rotulo: "Hiato", formato: (v) => fmtPct(v, 1), numero: true },
              { chave: "explicada", rotulo: "Explicada", formato: (v) => fmtDec(v, 4), numero: true },
              { chave: "nao_explicada", rotulo: "Não explicada", formato: (v) => fmtDec(v, 4), numero: true },
            ],
            linhas: h,
          }}
        />
      </Bloco>
    </>
  );
}
