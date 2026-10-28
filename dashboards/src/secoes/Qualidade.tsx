import { useMemo, useState } from "react";
import { CartaoGrafico, CartaoTabela } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { useFiltro } from "../lib/filtro";
import { fmtDec, fmtNum, fmtPct, fmtSM } from "../lib/formato";
import { opcaoBarras, opcaoLinhas, opcaoRazaoChances } from "../lib/graficos";
import { coluna, entre, intervalo, medianaExata, medianaHist, num, ponderada, rotulos, tabelaRais, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { escreverPeriodo, lerPeriodo, useParametro } from "../lib/url";
import type { Linha } from "../lib/db";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2025);
const FAIXAS = ["0-6m", "6-12m", "1-2a", "2-3a", "3-5a", "5-10a", "10-20a"];
const ROTULO_FAIXA: Record<string, string> = { "0-6m": "0–6 meses", "6-12m": "6–12 meses", "1-2a": "1–2 anos", "2-3a": "2–3 anos", "3-5a": "3–5 anos", "5-10a": "5–10 anos", "10-20a": "10–20 anos" };
const RECORTES = { setor: "Dentro e fora do setor de TI", sexo: "Por sexo", area: "Por área de atuação", porte: "Por porte do estabelecimento" } as const;
type Recorte = keyof typeof RECORTES;

// ------------------------------------------------- modelo multivariado
// A Gold grava as variáveis como saem do get_dummies ("porte_ZERO",
// "escolaridade_SUP. COMP"); aqui viram frases. Cada categoria é lida contra
// a referência do seu grupo — numa Gold anterior à coluna "referencia", as
// referências eram as primeiras em ordem alfabética.
const GRUPOS_MODELO: Record<string, string> = { sexo: "Sexo", escolaridade: "Escolaridade", area: "Área", porte: "Porte da empresa", tempo_de_casa: "Tempo de casa", idade: "Idade", log_remun: "Salário" };
const REFERENCIAS_ANTIGAS: Record<string, string> = { sexo: "Homem", escolaridade: "5.A CO FUND", area: "Desenvolvimento", porte: "1000 OU MAIS", tempo_de_casa: "0-6m" };
const NOMES_CATEGORIA: Record<string, Record<string, string>> = {
  escolaridade: {
    ANALFABETO: "analfabeto", "ATE 5.A INC": "fundamental I incompleto", "5.A CO FUND": "fundamental I completo", "6. A 9. FUND": "fundamental II incompleto",
    "FUND COMPL": "fundamental completo", "MEDIO INCOMP": "médio incompleto", "MEDIO COMPL": "médio completo", "SUP. INCOMP": "superior incompleto",
    "SUP. COMP": "superior completo", MESTRADO: "mestrado", DOUTORADO: "doutorado",
  },
  porte: {
    ZERO: "sem empregados em 31/12", "ATE 4": "até 4 empregados", "DE 5 A 9": "5 a 9", "DE 10 A 19": "10 a 19", "DE 20 A 49": "20 a 49", "DE 50 A 99": "50 a 99",
    "DE 100 A 249": "100 a 249", "DE 250 A 499": "250 a 499", "DE 500 A 999": "500 a 999", "1000 OU MAIS": "1.000 ou mais",
  },
  tempo_de_casa: { ...Object.fromEntries(Object.entries({ "0-6m": "0–6 meses", "6-12m": "6–12 meses", "1-2a": "1–2 anos", "2-3a": "2–3 anos", "3-5a": "3–5 anos", "5-10a": "5–10 anos", "10-20a": "10–20 anos" })), "20a+": "20 anos ou mais" },
};
const ORDEM_CATEGORIA: Record<string, string[]> = Object.fromEntries(Object.entries(NOMES_CATEGORIA).map(([g, m]) => [g, Object.keys(m)]));
const nomeCategoria = (grupo: string, cat: string) => NOMES_CATEGORIA[grupo]?.[cat] ?? (cat === "sem informação" ? "sem informação" : cat);

type ItemModelo = { grupo: string; rotulo: string; valor: number; p: number; ordem: number };
function itensModelo(linhas: Linha[]): { itens: ItemModelo[]; referencias: string } {
  const refs: Record<string, string> = { ...REFERENCIAS_ANTIGAS };
  const itens = linhas.map((l) => {
    const variavel = String(l.variavel);
    const grupo = typeof l.grupo === "string" && l.grupo ? l.grupo : Object.keys(GRUPOS_MODELO).find((g) => variavel === g || variavel.startsWith(g + "_")) ?? variavel;
    const cat = typeof l.categoria === "string" ? l.categoria : variavel.slice(grupo.length + 1);
    if (typeof l.referencia === "string" && l.referencia) refs[grupo] = l.referencia;
    const [or, p] = [num(l, "razao_de_chances"), num(l, "p")];
    // As contínuas viram um passo que se entende: dez anos a mais de idade e
    // o salário dobrado (o coeficiente do log vezes ln 2).
    if (grupo === "idade") return { grupo, rotulo: "Idade · 10 anos a mais", valor: or ** 10, p, ordem: 0 };
    if (grupo === "log_remun") return { grupo, rotulo: "Salário · o dobro", valor: or ** Math.LN2, p, ordem: 0 };
    const ordem = ORDEM_CATEGORIA[grupo]?.indexOf(cat) ?? -1;
    return { grupo, rotulo: `${GRUPOS_MODELO[grupo] ?? grupo} · ${nomeCategoria(grupo, cat)}`, valor: or, p, ordem: ordem < 0 ? 99 : ordem };
  });
  const ordemGrupo = Object.keys(GRUPOS_MODELO);
  itens.sort((a, b) => ordemGrupo.indexOf(a.grupo) - ordemGrupo.indexOf(b.grupo) || a.ordem - b.ordem || b.valor - a.valor);
  const referencias = Object.entries(refs).map(([g, r]) => `${(GRUPOS_MODELO[g] ?? g).toLowerCase()}: ${nomeCategoria(g, r)}`).join(" · ");
  return { itens, referencias };
}

export default function Qualidade() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [periodo, setPeriodo] = useParametro<Periodo>("periodo", [2007, 2025], lerPeriodo, escreverPeriodo);
  const [recorte, setRecorte] = useState<Recorte>("setor");
  const ano = periodo[1];

  // A média pode vir dos grupos (média de médias pesada pelo tamanho é a
  // média do conjunto); a mediana não: vem exata, ou do histograma no recorte.
  const anual = useConsulta(`
    SELECT a.ano, a.media, m.mediana, a.descartados, a.estoque, a.desligados
    FROM (SELECT ano, ${ponderada("remuneracao_sm")} AS media, sum(remun_implausivel)::DOUBLE AS descartados,
                 sum(estoque_3112)::DOUBLE AS estoque, sum(desligados_no_ano)::DOUBLE AS desligados
          FROM ${tabelaRais(f.ativo)} WHERE ${TI} AND ${entre(periodo)} AND ${f.sql()} GROUP BY 1) a
    LEFT JOIN (${f.ativo ? medianaHist(`${entre(periodo)} AND ${f.sql()}`) : `SELECT ano AS g, mediana FROM (${medianaExata("total")})`}) m ON m.g = a.ano
    ORDER BY 1`);
  const areas = useConsulta(`
    SELECT a.area, m.mediana, a.estoque
    FROM (SELECT area_ti AS area, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_area
          WHERE area_ti IS NOT NULL AND ano = ${ano} GROUP BY 1) a
    JOIN (${medianaExata("area", `ano = ${ano}`)}) m ON m.grupo = a.area
    ORDER BY 2 DESC`);
  const risco = useConsulta(`SELECT tempo_de_casa, "risco_%" AS risco, vinculos::DOUBLE AS vinculos, ano FROM sobrevivencia_risco`);
  const tabua = useConsulta(`SELECT * EXCLUDE (ano) FROM sobrevivencia_tabua`);
  const multi = useConsulta(`SELECT * FROM sobrevivencia_multivariado`);
  const modelo = useMemo(() => itensModelo(multi.linhas), [multi.linhas]);

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
      modelo: modelo.itens.length ? opcaoRazaoChances(c, modelo.itens) : null,
    }),
    [a, areas.linhas, giro, riscoOrdenado, todos, modelo, c],
  );

  // Resposta do topo: a mediana nas pontas do período e a faixa de maior risco.
  const resposta = (() => {
    const com = a.filter((l) => l.mediana !== null);
    if (com.length < 2) return undefined;
    const [p0, p1] = [com[0], com[com.length - 1]];
    const v = (num(p1, "mediana") / num(p0, "mediana") - 1) * 100;
    const pico = riscoOrdenado.length ? riscoOrdenado.reduce((m, l) => (num(l, "risco") > num(m, "risco") ? l : m)) : null;
    const onde = f.ativo ? ` em ${f.rotulo}` : "";
    const movimento = Math.abs(v) < 5 ? "ficou praticamente estável" : v > 0 ? `subiu ${fmtDec(v, 0)}%` : `caiu ${fmtDec(-v, 0)}%`;
    return `A remuneração mediana de TI${onde} ${movimento} em salários mínimos entre ${num(p0, "ano")} e ${num(p1, "ano")} (de ${fmtDec(num(p0, "mediana"), 2)} para ${fmtDec(num(p1, "mediana"), 2)})${pico ? `; o risco de perder o emprego é maior com ${ROTULO_FAIXA[String(pico.tempo_de_casa)]} de casa` : ""}.`;
  })();

  return (
    <>
      <CabecalhoPergunta
        numero={3}
        pergunta="O emprego de TI melhorou em qualidade?"
        resposta={resposta}
      />
      <LinhaFiltros resumo={`${periodo[0]}–${periodo[1]}`}>
        <FiltroPeriodo anos={ANOS} valor={periodo} aoMudar={setPeriodo} atalhos={[{ rotulo: "Tudo", periodo: [2007, 2025] }, { rotulo: "Últimos 10 anos", periodo: [2016, 2025] }]} />
      </LinhaFiltros>

      <Bloco titulo="Remuneração em salários mínimos">
        <CartaoGrafico
          titulo={`Mediana e média da remuneração · ${f.rotulo}`}
          ajuda="mediana"
          subtitulo={`RAIS · salários mínimos${f.ativo ? " · mediana por faixas de 0,1 SM" : ""}`}
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
          ajuda="giro"
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
            ajuda="risco"
            subtitulo={`RAIS ${anoSobrevivencia || ""} · por tempo de casa`}
            nacional
            opcao={op.risco}
            carregando={risco.carregando}
            altura={300}
            tabela={{ colunas: [{ chave: "tempo_de_casa", rotulo: "Tempo de casa", formato: (v) => ROTULO_FAIXA[String(v)] ?? String(v) }, { chave: "risco", rotulo: "Risco anual", formato: (v) => fmtPct(v, 1), numero: true }, { chave: "vinculos", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: riscoOrdenado }}
          />
          <CartaoGrafico
            titulo="Sobrevivência acumulada do vínculo"
            ajuda="sobrevivencia"
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
        </Grade>
        <CartaoGrafico
          titulo="O que muda o risco de desligamento, comparando pessoas parecidas no resto"
          subtitulo={`Modelo de risco em tempo discreto, RAIS ${anoSobrevivencia || ""} · cada ponto compara uma característica com a referência do grupo, com as demais iguais`}
          nacional
          ajuda="razao_chances"
          opcao={op.modelo}
          carregando={multi.carregando}
          erro={multi.erro}
          rodape={`À direita da linha tracejada, mais chance de sair do emprego no ano; à esquerda, menos. ×1,50 = 50% mais chance. Pontos vazados não diferem da referência com segurança (p ≥ 0,05). Referências — ${modelo.referencias}.`}
          tabela={{
            colunas: [
              { chave: "rotulo", rotulo: "Característica" },
              { chave: "valor", rotulo: "Razão de chances", formato: (v) => `×${fmtDec(v, 2)}`, numero: true },
              { chave: "p", rotulo: "p-valor", formato: (v) => (Number(v) < 0.001 ? "< 0,001" : fmtDec(v, 3)), numero: true },
            ],
            linhas: modelo.itens,
          }}
        />
      </Bloco>
    </>
  );
}
