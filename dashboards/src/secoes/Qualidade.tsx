import { useMemo, useState } from "react";
import { CartaoGrafico, CartaoTabela } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { useFiltro } from "../lib/filtro";
import { fmtDec, fmtNum, fmtPct, fmtSM } from "../lib/formato";
import { opcaoBarras, opcaoLinhas } from "../lib/graficos";
import { coluna, entre, intervalo, num, ponderada, rotulos, tabelaRais, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2025);
const FAIXAS = ["0-6m", "6-12m", "1-2a", "2-3a", "3-5a", "5-10a", "10-20a"];
const ROTULO_FAIXA: Record<string, string> = { "0-6m": "0–6 meses", "6-12m": "6–12 meses", "1-2a": "1–2 anos", "2-3a": "2–3 anos", "3-5a": "3–5 anos", "5-10a": "5–10 anos", "10-20a": "10–20 anos" };
const RECORTES = { setor: "Dentro e fora do setor de TI", sexo: "Por sexo", area: "Por área de atuação", porte: "Por porte do estabelecimento" } as const;
type Recorte = keyof typeof RECORTES;

export default function Qualidade() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [periodo, setPeriodo] = useState<Periodo>([2007, 2025]);
  const [recorte, setRecorte] = useState<Recorte>("setor");
  const ano = periodo[1];

  const anual = useConsulta(`
    SELECT ano, ${ponderada("remuneracao_sm")} AS media, ${ponderada("remuneracao_sm_mediana")} AS mediana,
           sum(remun_implausivel)::DOUBLE AS descartados,
           sum(estoque_3112)::DOUBLE AS estoque, sum(desligados_no_ano)::DOUBLE AS desligados
    FROM ${tabelaRais(f.ativo)} WHERE ${TI} AND ${entre(periodo)} AND ${f.sql()} GROUP BY 1 ORDER BY 1`);
  const areas = useConsulta(`
    SELECT area_ti AS area, ${ponderada("remuneracao_sm_mediana")} AS mediana, sum(estoque_3112)::DOUBLE AS estoque
    FROM rais_estoque_area WHERE area_ti IS NOT NULL AND ano = ${ano} GROUP BY 1 ORDER BY 2 DESC`);
  const risco = useConsulta(`SELECT tempo_de_casa, "risco_%" AS risco, vinculos::DOUBLE AS vinculos, ano FROM sobrevivencia_risco`);
  const tabua = useConsulta(`SELECT * EXCLUDE (ano) FROM sobrevivencia_tabua`);
  const multi = useConsulta(`SELECT variavel, razao_de_chances, p FROM sobrevivencia_multivariado ORDER BY razao_de_chances DESC`);

  const a = anual.linhas;
  const anoSobrevivencia = num(risco.linhas[0], "ano");
  const riscoOrdenado = FAIXAS.map((fx) => risco.linhas.find((l) => l.tempo_de_casa === fx)).filter((l) => l !== undefined);
  const todos = tabua.linhas.find((l) => l.recorte === "todos");
  const giro = useMemo(() => a.map((l) => ({ ano: l.ano, giro: (num(l, "desligados") / num(l, "estoque")) * 100, desligados: l.desligados, estoque: l.estoque })), [a]);

  const op = useMemo(
    () => ({
      remuneracao: a.length
        ? opcaoLinhas(c, rotulos(a, "ano"), [
            { nome: "Mediana", dados: coluna(a, "mediana"), rotuloFinal: true },
            { nome: "Média", dados: coluna(a, "media"), rotuloFinal: true },
          ], { formato: fmtSM, formatoEixo: (v) => fmtDec(v, 0), zero: true })
        : null,
      areas: areas.linhas.length ? opcaoBarras(c, rotulos(areas.linhas, "area"), coluna(areas.linhas, "mediana"), { horizontal: true, nome: "Mediana", formato: fmtSM, formatoEixo: (v) => fmtDec(v, 1), larguraRotulo: 210, forma: "pirulito" }) : null,
      giro: giro.length
        ? opcaoLinhas(c, giro.map((l) => String(l.ano)), [{ nome: "Desligados no ano / estoque", dados: giro.map((l) => l.giro), rotuloFinal: true }], { formato: (v) => fmtPct(v, 1), formatoEixo: (v) => fmtPct(v, 0) })
        : null,
      risco: riscoOrdenado.length ? opcaoBarras(c, riscoOrdenado.map((l) => ROTULO_FAIXA[String(l.tempo_de_casa)]), coluna(riscoOrdenado, "risco"), { nome: "Risco anual", formato: (v) => fmtPct(v, 1), formatoEixo: (v) => fmtPct(v, 0), rotulos: true }) : null,
      sobrevivencia: todos
        ? opcaoLinhas(c, FAIXAS.map((fx) => ROTULO_FAIXA[fx]), [{ nome: "Ainda no emprego", dados: FAIXAS.map((fx) => num(todos, fx)), rotuloFinal: true }], { formato: (v) => fmtPct(v, 1), formatoEixo: (v) => fmtPct(v, 0), zero: true })
        : null,
    }),
    [a, areas.linhas, giro, riscoOrdenado, todos, c],
  );

  return (
    <>
      <CabecalhoPergunta
        numero={3}
        pergunta="O emprego de TI melhorou em qualidade?"
      />
      <LinhaFiltros resumo={`${periodo[0]}–${periodo[1]}`}>
        <FiltroPeriodo anos={ANOS} valor={periodo} aoMudar={setPeriodo} atalhos={[{ rotulo: "Tudo", periodo: [2007, 2025] }, { rotulo: "Últimos 10 anos", periodo: [2016, 2025] }]} />
      </LinhaFiltros>

      <Bloco titulo="Remuneração em salários mínimos">
        <CartaoGrafico
          titulo={`Mediana e média da remuneração · ${f.rotulo}`}
          subtitulo={`RAIS · ponderado pelo estoque${f.ativo ? " · mediana aproximada no recorte" : ""}`}
          opcao={op.remuneracao}
          carregando={anual.carregando}
          erro={anual.erro}
          altura={320}
          tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "mediana", rotulo: "Mediana", formato: fmtSM, numero: true }, { chave: "media", rotulo: "Média", formato: fmtSM, numero: true }], linhas: a }}
        />
        <CartaoGrafico
          titulo="Por área de atuação"
          subtitulo={`RAIS · mediana em salários mínimos, ${ano}`}
          nacional
          opcao={op.areas}
          carregando={areas.carregando}
          altura={300}
          tabela={{ colunas: [{ chave: "area", rotulo: "Área" }, { chave: "mediana", rotulo: "Mediana", formato: fmtSM, numero: true }, { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: areas.linhas }}
        />
      </Bloco>

      <Bloco titulo={`Quanto dura um emprego de tecnologia`}>
        <CartaoGrafico
          titulo={`Giro do mercado · ${f.rotulo}`}
          subtitulo="RAIS · vínculos encerrados no ano em proporção ao estoque"
          opcao={op.giro}
          carregando={anual.carregando}
          altura={280}
          tabela={{
            colunas: [
              { chave: "ano", rotulo: "Ano" },
              { chave: "desligados", rotulo: "Desligados no ano", formato: fmtNum, numero: true },
              { chave: "estoque", rotulo: "Estoque", formato: fmtNum, numero: true },
              { chave: "giro", rotulo: "Giro", formato: (v) => fmtPct(v, 1), numero: true },
            ],
            linhas: giro,
          }}
        />
        <Grade>
          <CartaoGrafico
            titulo="Risco anual de desligamento"
            subtitulo={`RAIS ${anoSobrevivencia || ""} · por tempo de casa`}
            nacional
            opcao={op.risco}
            carregando={risco.carregando}
            altura={300}
            tabela={{ colunas: [{ chave: "tempo_de_casa", rotulo: "Tempo de casa", formato: (v) => ROTULO_FAIXA[String(v)] ?? String(v) }, { chave: "risco", rotulo: "Risco anual", formato: (v) => fmtPct(v, 1), numero: true }, { chave: "vinculos", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: riscoOrdenado }}
          />
          <CartaoGrafico
            titulo="Sobrevivência acumulada do vínculo"
            subtitulo={`RAIS ${anoSobrevivencia || ""} · % que continua no emprego ao fim de cada faixa`}
            nacional
            opcao={op.sobrevivencia}
            carregando={tabua.carregando}
            altura={300}
            tabela={todos ? { colunas: [{ chave: "faixa", rotulo: "Tempo de casa" }, { chave: "valor", rotulo: "Ainda no emprego", formato: (v) => fmtPct(v, 1), numero: true }], linhas: FAIXAS.map((fx) => ({ faixa: ROTULO_FAIXA[fx], valor: num(todos, fx) })) } : undefined}
          />
        </Grade>
        <Grade>
          <CartaoTabela
            titulo="Sobrevivência por grupo"
            subtitulo="Tábua de vida de período, por recorte"
            nacional
            acao={<Seletor rotulo="Recorte" valor={recorte} opcoes={(Object.keys(RECORTES) as Recorte[]).map((k) => ({ valor: k, rotulo: RECORTES[k] }))} aoMudar={setRecorte} />}
            tabela={{
              colunas: [
                { chave: "grupo", rotulo: "Grupo" },
                { chave: "n", rotulo: "Vínculos", formato: fmtNum, numero: true },
                { chave: "1-2a", rotulo: "Após 2 anos", formato: (v) => fmtPct(v, 0), numero: true },
                { chave: "5-10a", rotulo: "Após 10 anos", formato: (v) => fmtPct(v, 0), numero: true },
                { chave: "mediana_em", rotulo: "Mediana em" },
              ],
              linhas: tabua.linhas.filter((l) => l.recorte === recorte),
            }}
          />
          <CartaoTabela
            titulo="O que muda o risco, controlando pelo resto"
            subtitulo="Modelo de risco em tempo discreto · razão de chances acima de 1 = mais risco de desligamento"
            nacional
            tabela={{
              colunas: [
                { chave: "variavel", rotulo: "Característica" },
                { chave: "razao_de_chances", rotulo: "Razão de chances", formato: (v) => fmtDec(v, 2), numero: true },
                { chave: "p", rotulo: "p-valor", formato: (v) => (Number(v) < 0.001 ? "< 0,001" : fmtDec(v, 3)), numero: true },
              ],
              linhas: multi.linhas,
            }}
          />
        </Grade>
      </Bloco>
    </>
  );
}
