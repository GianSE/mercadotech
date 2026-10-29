import { useMemo, useState } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { useFiltro } from "../lib/filtro";
import { fmtCompacto, fmtDec, fmtNum, fmtPct, fmtReais, fmtSM } from "../lib/formato";
import { opcaoBarras, opcaoLinhas, opcaoRazaoChances } from "../lib/graficos";
import { coluna, entre, intervalo, medianaExata, medianaHist, num, ponderada, rotulos, tabelaRais, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { escreverPeriodo, lerPeriodo, useParametro } from "../lib/url";
import type { Linha } from "../lib/db";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2025);
const FAIXAS = ["0-6m", "6-12m", "1-2a", "2-3a", "3-5a", "5-10a", "10-20a"];
const ROTULO_FAIXA: Record<string, string> = { "0-6m": "0–6 meses", "6-12m": "6–12 meses", "1-2a": "1–2 anos", "2-3a": "2–3 anos", "3-5a": "3–5 anos", "5-10a": "5–10 anos", "10-20a": "10–20 anos" };
// A remuneração pode ser lida em salários mínimos (compara anos entre si) ou
// em reais da época (o valor que estava no contracheque, sem correção).
type Unidade = "sm" | "reais";
// Escolaridade em ordem de nível, não de valor. No gráfico ao longo do tempo
// entram só os quatro níveis que somam quase todos os vínculos de TI; os
// demais têm poucos milhares e a linha oscila mais que o dado.
// Mestrado e doutorado vêm separados da mediana da Gold; a média da tabela de
// perfil (reserva) só tem "Pós-graduação", que junta os dois. MBA e
// especialização não existem na RAIS: entram como superior completo.
const ESCOLARIDADES = ["Analfabeto", "Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo", "Superior incompleto", "Superior completo", "Pós-graduação", "Mestrado", "Doutorado"];
const ESCOLARIDADES_SERIE = ["Médio completo", "Superior incompleto", "Superior completo", "Pós-graduação", "Mestrado", "Doutorado"];
// Cor fixa por nível; "Pós-graduação" e "Mestrado" nunca aparecem juntos.
const COR_ESCOLARIDADE: Record<string, number> = { "Médio completo": 0, "Superior incompleto": 1, "Superior completo": 2, "Pós-graduação": 3, Mestrado: 3, Doutorado: 4 };

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

// A pergunta 3 (o emprego melhorou em qualidade?) em duas páginas: 3a, o
// salário; 3b, a permanência e o que leva ao desligamento. Cada uma só
// consulta o que mostra.
export type ParteQualidade = "salario" | "permanencia";

export default function Qualidade({ parte = "salario" }: { parte?: ParteQualidade }) {
  const salario = parte === "salario";
  const { cores: c } = useTema();
  const f = useFiltro();
  const [periodo, setPeriodo] = useParametro<Periodo>("periodo", [2007, 2025], lerPeriodo, escreverPeriodo);
  const [unidade, setUnidade] = useState<Unidade>("sm");
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
  const areas = useConsulta(!salario ? null : `
    SELECT a.area, m.mediana, a.estoque
    FROM (SELECT area_ti AS area, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_area
          WHERE area_ti IS NOT NULL AND ano = ${ano} GROUP BY 1) a
    JOIN (${medianaExata("area", `ano = ${ano}`)}) m ON m.grupo = a.area
    ORDER BY 2 DESC`);
  // A mediana de cada área, ano a ano (exata, da Gold): uma linha por área.
  const areasSerie = useConsulta(!salario ? null : `
    SELECT ano, grupo AS area, mediana_sm AS mediana FROM rais_mediana
    WHERE recorte = 'area' AND ${entre(periodo)} ORDER BY ano`);
  // Por escolaridade: a mediana exata, quando a Gold já tem o recorte; numa
  // Gold anterior, a média ponderada da tabela de perfil (média se agrega
  // sem erro, mediana não) — e o título diz qual das duas está na tela.
  const escMediana = useConsulta(!salario ? null : `
    SELECT ano, grupo AS escolaridade, mediana_sm AS valor FROM rais_mediana
    WHERE recorte = 'escolaridade' AND ${entre(periodo)} ORDER BY ano`);
  const semMedianaEsc = salario && !escMediana.carregando && !escMediana.linhas.length;
  const escMedia = useConsulta(semMedianaEsc ? `
    SELECT ano, escolaridade, ${ponderada("remuneracao_sm")} AS valor FROM rais_estoque_perfil
    WHERE ${TI} AND escolaridade IS NOT NULL AND escolaridade <> 'Não informado' AND ${entre(periodo)}
    GROUP BY 1, 2 ORDER BY 1` : null);
  const escolaridade = semMedianaEsc ? escMedia : escMediana;
  const medidaEsc = semMedianaEsc ? "Média" : "Mediana";
  // O salário mínimo de cada ano sai do próprio dado: a RAIS traz a
  // remuneração em reais e em salários mínimos, e a razão entre as duas é o
  // mínimo vigente (R$ 1.518 em 2025), sem tabela digitada à mão.
  const salarioMinimo = useConsulta(!salario ? null : `
    SELECT ano, sum(remuneracao_nominal * estoque_3112) / nullif(sum(remuneracao_sm * estoque_3112), 0) AS sm
    FROM rais_estoque_anual WHERE remuneracao_sm > 0 GROUP BY 1`);
  const risco = useConsulta(salario ? null : `SELECT tempo_de_casa, "risco_%" AS risco, vinculos::DOUBLE AS vinculos, ano FROM sobrevivencia_risco`);
  const tabua = useConsulta(salario ? null : `SELECT * EXCLUDE (ano) FROM sobrevivencia_tabua`);
  const multi = useConsulta(salario ? null : `SELECT * FROM sobrevivencia_multivariado`);
  const modelo = useMemo(() => itensModelo(multi.linhas), [multi.linhas]);

  const smDoAno = useMemo(() => new Map(salarioMinimo.linhas.map((l) => [num(l, "ano"), num(l, "sm")])), [salarioMinimo.linhas]);
  const emReais = unidade === "reais";
  // Converte um valor em SM para a unidade escolhida, no ano dele.
  const conv = (ano: number, v: unknown) => (v === null || v === undefined ? null : emReais ? Number(v) * (smDoAno.get(ano) ?? NaN) : Number(v));
  const fmtValor = emReais ? fmtReais : fmtSM;
  const a = useMemo(
    () => anual.linhas.map((l): Linha => ({ ...l, mediana: conv(num(l, "ano"), l.mediana), media: conv(num(l, "ano"), l.media) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anual.linhas, smDoAno, emReais],
  );
  // Cor fixa por área (ordem alfabética), igual em qualquer período ou unidade.
  const serieAreas = useMemo(() => {
    const linhas = areasSerie.linhas;
    const anos = [...new Set(linhas.map((l) => num(l, "ano")))].sort((x, y) => x - y);
    const nomes = [...new Set(linhas.map((l) => String(l.area)))].sort();
    const valor = new Map(linhas.map((l) => [`${l.area}|${num(l, "ano")}`, l.mediana]));
    const tabela = anos.map((ano) => Object.fromEntries([["ano", ano], ...nomes.map((n) => [n, conv(ano, valor.get(`${n}|${ano}`))])]));
    return { anos, nomes, tabela };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areasSerie.linhas, smDoAno, emReais]);
  const esc = useMemo(() => {
    const linhas = escolaridade.linhas;
    const valor = new Map(linhas.map((l) => [`${l.escolaridade}|${num(l, "ano")}`, l.valor]));
    const anos = [...new Set(linhas.map((l) => num(l, "ano")))].sort((x, y) => x - y);
    const noAno = ESCOLARIDADES.filter((e) => valor.has(`${e}|${ano}`)).map((e) => ({ escolaridade: e, valor: conv(ano, valor.get(`${e}|${ano}`)) }));
    const presentes = new Set(linhas.map((l) => String(l.escolaridade)));
    const serie = ESCOLARIDADES_SERIE.filter((e) => presentes.has(e));
    const tabela = anos.map((a) => Object.fromEntries([["ano", a], ...serie.map((e) => [e, conv(a, valor.get(`${e}|${a}`))])]));
    return { anos, noAno, serie, tabela };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escolaridade.linhas, smDoAno, emReais, ano]);
  const linhasAreas = useMemo(
    () => areas.linhas.map((l): Linha => ({ ...l, mediana: conv(ano, l.mediana) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [areas.linhas, smDoAno, emReais, ano],
  );
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
          ], { formato: fmtValor, formatoEixo: emReais ? fmtCompacto : (v) => fmtDec(v, 0), zero: true })
        : null,
      areas: linhasAreas.length ? opcaoBarras(c, rotulos(linhasAreas, "area"), coluna(linhasAreas, "mediana"), { horizontal: true, nome: "Mediana", formato: fmtValor, formatoEixo: emReais ? fmtCompacto : (v) => fmtDec(v, 1), larguraRotulo: 210, forma: "pirulito" }) : null,
      areasSerie: serieAreas.anos.length
        ? opcaoLinhas(
            c,
            serieAreas.anos.map(String),
            serieAreas.nomes.map((n, i) => ({ nome: n, dados: serieAreas.tabela.map((l) => l[n] as number | null), cor: c.series[i], rotuloFinal: true })),
            { formato: fmtValor, formatoEixo: emReais ? fmtCompacto : (v) => fmtDec(v, 0), zero: true },
          )
        : null,
      escAno: esc.noAno.length
        ? opcaoBarras(c, esc.noAno.map((l) => l.escolaridade), esc.noAno.map((l) => l.valor), { horizontal: true, nome: medidaEsc, formato: fmtValor, formatoEixo: emReais ? fmtCompacto : (v) => fmtDec(v, 1), larguraRotulo: 170, forma: "pirulito" })
        : null,
      escSerie: esc.anos.length
        ? opcaoLinhas(
            c,
            esc.anos.map(String),
            esc.serie.map((e) => ({ nome: e, dados: esc.tabela.map((l) => l[e] as number | null), cor: c.series[COR_ESCOLARIDADE[e] ?? 5], rotuloFinal: true })),
            { formato: fmtValor, formatoEixo: emReais ? fmtCompacto : (v) => fmtDec(v, 0), zero: true },
          )
        : null,
      giro: giro.length
        ? opcaoLinhas(c, giro.map((l) => String(l.ano)), [{ nome: "Desligados no ano / estoque", dados: giro.map((l) => l.giro), rotuloFinal: true }], { formato: (v) => fmtPct(v, 1), formatoEixo: (v) => fmtPct(v, 0) })
        : null,
      risco: riscoOrdenado.length ? opcaoBarras(c, riscoOrdenado.map((l) => ROTULO_FAIXA[String(l.tempo_de_casa)]), coluna(riscoOrdenado, "risco"), { nome: "Risco anual", formato: (v) => fmtPct(v, 1), formatoEixo: (v) => fmtPct(v, 0), rotulos: true }) : null,
      sobrevivencia: todos
        ? opcaoLinhas(c, FAIXAS.map((fx) => ROTULO_FAIXA[fx]), [{ nome: "Ainda no emprego", dados: FAIXAS.map((fx) => num(todos, fx)), rotuloFinal: true }], { formato: (v) => fmtPct(v, 1), formatoEixo: (v) => fmtPct(v, 0), zero: true })
        : null,
      modelo: modelo.itens.length ? opcaoRazaoChances(c, modelo.itens) : null,
    }),
    [a, linhasAreas, serieAreas, esc, medidaEsc, fmtValor, emReais, giro, riscoOrdenado, todos, modelo, c],
  );

  // Resposta do topo. 3a: a mediana nas pontas do período. 3b: a faixa de
  // tempo de casa de maior risco e a característica que mais o muda.
  const resposta = (() => {
    const onde = f.ativo ? ` em ${f.rotulo}` : "";
    if (salario) {
      const com = anual.linhas.filter((l) => l.mediana !== null);
      if (com.length < 2) return undefined;
      const [p0, p1] = [com[0], com[com.length - 1]];
      const v = (num(p1, "mediana") / num(p0, "mediana") - 1) * 100;
      const movimento = Math.abs(v) < 5 ? "ficou praticamente estável" : v > 0 ? `subiu ${fmtDec(v, 0)}%` : `caiu ${fmtDec(-v, 0)}%`;
      return `A remuneração mediana de TI${onde} ${movimento} em salários mínimos entre ${num(p0, "ano")} e ${num(p1, "ano")} (de ${fmtDec(num(p0, "mediana"), 2)} para ${fmtDec(num(p1, "mediana"), 2)}).`;
    }
    const pico = riscoOrdenado.length ? riscoOrdenado.reduce((m, l) => (num(l, "risco") > num(m, "risco") ? l : m)) : null;
    if (!pico) return undefined;
    return `O risco de perder o emprego no ano é maior com ${ROTULO_FAIXA[String(pico.tempo_de_casa)]} de casa (${fmtPct(num(pico, "risco"), 1)}) e cai a partir daí; salário mais alto e mais tempo de casa são o que mais segura as pessoas no emprego.`;
  })();

  return (
    <>
      <CabecalhoPergunta
        numero={salario ? "3a" : "3b"}
        pergunta={salario ? "Qualidade do emprego: o salário de TI melhorou?" : "Qualidade do emprego: quanto tempo as pessoas ficam, e o que leva a sair?"}
        resposta={resposta}
      />
      <LinhaFiltros resumo={`${periodo[0]}–${periodo[1]}`}>
        <FiltroPeriodo anos={ANOS} valor={periodo} aoMudar={setPeriodo} />
      </LinhaFiltros>

      {salario && (
        <>
      <Bloco titulo="Remuneração">
        <div className="flex flex-wrap items-end gap-4">
          <Seletor<Unidade>
            rotulo="Mostrar em"
            valor={unidade}
            opcoes={[
              { valor: "sm", rotulo: "Salários mínimos" },
              { valor: "reais", rotulo: "Reais (valor da época)" },
            ]}
            aoMudar={setUnidade}
          />
        </div>
        <CartaoGrafico
          titulo={`Mediana e média da remuneração · ${f.rotulo}`}
          ajuda="mediana"
          subtitulo={emReais
            ? "RAIS · remuneração bruta em reais de cada ano, sem correção pela inflação"
            : `RAIS · salários mínimos${f.ativo ? " · mediana por faixas de 0,1 SM" : ""}`}
          opcao={op.remuneracao}
          carregando={anual.carregando}
          erro={anual.erro}
          altura={320}
          rodape={emReais ? "Em reais, a linha sobe também por causa da inflação; para comparar anos entre si, a medida certa é o salário mínimo." : undefined}
          tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "mediana", rotulo: "Mediana", formato: fmtValor, numero: true }, { chave: "media", rotulo: "Média", formato: fmtValor, numero: true }], linhas: a }}
        />
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
        <CartaoGrafico
          titulo="Por área de atuação"
          subtitulo={emReais ? `RAIS · mediana bruta em reais, ${ano}` : `RAIS · mediana em salários mínimos, ${ano}`}
          nacional
          opcao={op.areas}
          carregando={areas.carregando}
          altura={300}
          tabela={{ colunas: [{ chave: "area", rotulo: "Área" }, { chave: "mediana", rotulo: "Mediana", formato: fmtValor, numero: true }, { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: linhasAreas }}
        />
        <CartaoGrafico
          titulo="Por área de atuação, ao longo do tempo"
          subtitulo={emReais ? "RAIS · mediana bruta em reais de cada ano, sem correção pela inflação" : "RAIS · mediana em salários mínimos"}
          nacional
          opcao={op.areasSerie}
          carregando={areasSerie.carregando}
          erro={areasSerie.erro}
          altura={360}
          tabela={{
            colunas: [{ chave: "ano", rotulo: "Ano" }, ...serieAreas.nomes.map((n) => ({ chave: n, rotulo: n, formato: fmtValor, numero: true }))],
            linhas: serieAreas.tabela,
          }}
        />
        </div>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <CartaoGrafico
            titulo="Por escolaridade"
            subtitulo={`RAIS · ${medidaEsc.toLowerCase()} ${emReais ? "bruta em reais" : "em salários mínimos"}, ${ano}`}
            nacional
            opcao={op.escAno}
            carregando={escolaridade.carregando}
            erro={escolaridade.erro}
            altura={340}
            tabela={{ colunas: [{ chave: "escolaridade", rotulo: "Escolaridade" }, { chave: "valor", rotulo: medidaEsc, formato: fmtValor, numero: true }], linhas: esc.noAno }}
          />
          <CartaoGrafico
            titulo="Por escolaridade, ao longo do tempo"
            subtitulo={`RAIS · ${medidaEsc.toLowerCase()} ${emReais ? "bruta em reais de cada ano, sem correção pela inflação" : "em salários mínimos"} · do ensino médio para cima`}
            nacional
            opcao={op.escSerie}
            carregando={escolaridade.carregando}
            erro={escolaridade.erro}
            altura={360}
            tabela={{
              colunas: [{ chave: "ano", rotulo: "Ano" }, ...esc.serie.map((e) => ({ chave: e, rotulo: e, formato: fmtValor, numero: true }))],
              linhas: esc.tabela,
            }}
          />
        </div>
      </Bloco>

        </>
      )}
      {!salario && (
        <>
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
      )}
    </>
  );
}
