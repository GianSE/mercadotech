import { BarraFiltros, FiltroPeriodo, SeletorUF } from "../../components/Filtros";
import { base, Grafico } from "../../components/Grafico";
import { Painel } from "../../components/Painel";
import { Titulo } from "../../components/Titulo";
import { Skeleton } from "../../components/ui/skeleton";
import type { Area } from "../../lib/areas";
import { useConsulta, type LinhaSQL } from "../../lib/db";
import { useFiltro } from "../../lib/filtro";
import { fmt } from "../../lib/formato";
import { opcaoBarrasH, opcaoLinhas } from "../../lib/graficos";
import { useAnoRais } from "../../lib/rais";
import { coluna, entre, medianaExata, medianaHist, num, ponderada, RECORTE, rotulos, tabelaRais, type Periodo } from "../../lib/sql";
import { escreverPeriodo, lerPeriodo, useParametro } from "../../lib/url";

/*
 * Pergunta 3 — o emprego de TI melhorou em qualidade? As três evidências do
 * quadro de perguntas do TCC: a remuneração em salários mínimos (a mediana,
 * total e por escolaridade), o giro anual e a tábua de vida do vínculo.
 */

const ANO_INICIAL = 2007;

// Escolaridade em ordem de nível, não de valor.
const ESCOLARIDADES = ["Analfabeto", "Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo", "Superior incompleto", "Superior completo", "Pós-graduação", "Mestrado", "Doutorado"];
const FAIXAS = ["0-6m", "6-12m", "1-2a", "2-3a", "3-5a", "5-10a", "10-20a"];
const ROTULO_FAIXA: Record<string, string> = { "0-6m": "0–6 meses", "6-12m": "6–12 meses", "1-2a": "1–2 anos", "2-3a": "2–3 anos", "3-5a": "3–5 anos", "5-10a": "5–10 anos", "10-20a": "10–20 anos" };
const fmtEixo = (v: number) => v.toFixed(1).replace(".", ",");

/** Espera o último ano da RAIS: o período termina nele, e o padrão é lido uma vez só. */
export function Qualidade({ area }: { area: Area }) {
  const anoRais = useAnoRais(area);
  return anoRais === undefined ? <Skeleton className="h-96" /> : <ConteudoQualidade area={area} anoRais={anoRais} />;
}

function ConteudoQualidade({ area, anoRais }: { area: Area; anoRais: number }) {
  const f = useFiltro();
  const q = (sql: string | null) => useConsulta(area.slug, area.repo, sql);
  const [periodo, setPeriodo] = useParametro<Periodo>("periodo", [ANO_INICIAL, anoRais], lerPeriodo, escreverPeriodo);
  const fimRais = Math.min(periodo[1], anoRais);
  const pRais: Periodo = [periodo[0], fimRais];
  const onde = f.ativo ? ` em ${f.rotulo}` : "";

  // A média vem dos grupos (média ponderada pelo tamanho é a média do
  // conjunto); a mediana não se soma: vem exata, ou do histograma no recorte.
  const anual = q(`
    SELECT a.ano, a.media, m.mediana, a.estoque, a.desligados
    FROM (SELECT ano, ${ponderada("remuneracao_sm")} AS media, sum(estoque_3112)::DOUBLE AS estoque, sum(desligados_no_ano)::DOUBLE AS desligados
          FROM ${tabelaRais(f.ativo)} WHERE ${RECORTE} AND ${entre(pRais)} AND ${f.sql()} GROUP BY 1) a
    LEFT JOIN (${f.ativo ? medianaHist(`${entre(pRais)} AND ${f.sql()}`) : `SELECT ano AS g, mediana FROM (${medianaExata("total")})`}) m ON m.g = a.ano
    ORDER BY 1`);
  // Escolaridade: o primeiro e o último ano do período, para ver o nível
  // inteiro cair enquanto a mediana total fica parada (o efeito composição).
  const escolaridade = q(`SELECT grupo AS nome, ano, mediana_sm AS valor FROM rais_mediana WHERE recorte = 'escolaridade' AND ano IN (${pRais[0]}, ${fimRais})`);

  const a = anual.tipo === "pronto" ? anual.dados : [];
  const resposta = (() => {
    const com = a.filter((l) => l.mediana !== null);
    if (com.length < 2) return undefined;
    const [p0, p1] = [com[0], com.at(-1)!];
    const v = num(p1, "mediana") / num(p0, "mediana") - 1;
    const movimento = Math.abs(v) < 0.05 ? "ficou praticamente estável" : v > 0 ? `subiu ${fmt.parte(v)}` : `caiu ${fmt.parte(-v)}`;
    return `A remuneração mediana de ${area.sigla}${onde} ${movimento} em salários mínimos entre ${num(p0, "ano")} e ${num(p1, "ano")} (de ${fmt.sm(num(p0, "mediana"))} para ${fmt.sm(num(p1, "mediana"))}).`;
  })();

  return (
    <div className="flex flex-col gap-6">
      <BarraFiltros>
        <FiltroPeriodo valor={periodo} aoMudar={setPeriodo} min={ANO_INICIAL} max={anoRais} />
        <SeletorUF />
      </BarraFiltros>

      <section className="flex flex-col gap-4">
        <Titulo pergunta="O emprego de TI passou a pagar melhor?" resposta={resposta} />
        <Painel
          titulo={`Mediana e média da remuneração · ${f.rotulo}`}
          descricao={`RAIS · em salários mínimos, vínculos ativos em 31/12${f.ativo ? " · mediana pelas faixas de 0,1 SM" : ""}`}
          estado={anual}
          altura={300}
          tabela={(d) => ({
            colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "mediana", rotulo: "Mediana", formato: fmt.sm }, { chave: "media", rotulo: "Média", formato: fmt.sm }],
            linhas: d,
          })}
        >
          {(d) => (
            <Grafico
              rotulo={`Mediana e média da remuneração de ${area.nome}`}
              altura={300}
              opcao={(t) =>
                opcaoLinhas(t, rotulos(d, "ano"), [{ nome: "Mediana", dados: coluna(d, "mediana") }, { nome: "Média", dados: coluna(d, "media") }], {
                  formato: fmt.sm,
                  formatoEixo: fmtEixo,
                  zero: true,
                  rotuloFinal: true,
                  altura: 300,
                })
              }
            />
          )}
        </Painel>
        <Painel
          titulo={`Mediana por escolaridade · ${pRais[0]} e ${fimRais}`}
          descricao="RAIS · em salários mínimos · a mediana cai em cada nível, e a total fica estável porque cresce o peso dos níveis mais bem pagos"
          estado={escolaridade}
          altura={320}
          nacional
          tabela={(d) => ({ colunas: [{ chave: "nome", rotulo: "Escolaridade" }, { chave: "inicio", rotulo: String(pRais[0]), formato: fmt.sm }, { chave: "fim", rotulo: String(fimRais), formato: fmt.sm }], linhas: porEscolaridade(d, pRais[0], fimRais) })}
        >
          {(d) => {
            const o = porEscolaridade(d, pRais[0], fimRais);
            return (
              <Grafico
                rotulo={`Remuneração mediana por escolaridade em ${area.nome}, ${pRais[0]} e ${fimRais}`}
                altura={320}
                opcao={(t) => ({
                  ...opcaoBarrasH(t, o.map((l) => l.nome), o.map((l) => l.fim), { formato: fmt.sm }),
                  ...barrasPareadas(t, o, pRais[0], fimRais),
                })}
              />
            );
          }}
        </Painel>
      </section>

      <Permanencia area={area} anual={anual} />
    </div>
  );
}

type LinhaEsc = { nome: string; inicio: number | null; fim: number | null };

function porEscolaridade(linhas: LinhaSQL[], ini: number, fim: number): LinhaEsc[] {
  const nomes = [...new Set(linhas.map((l) => String(l.nome)))];
  const pos = (n: string) => (ESCOLARIDADES.indexOf(n) < 0 ? 99 : ESCOLARIDADES.indexOf(n));
  const valor = (n: string, ano: number) => {
    const l = linhas.find((x) => x.nome === n && num(x, "ano") === ano);
    return l && l.valor !== null ? num(l, "valor") : null;
  };
  // Do nível mais alto para o mais baixo, de cima para baixo no gráfico.
  return nomes.sort((a, b) => pos(b) - pos(a)).map((n) => ({ nome: n, inicio: valor(n, ini), fim: valor(n, fim) }));
}

/** Duas barras por nível: o primeiro ano esmaecido, o último na cor da série. */
function barrasPareadas(t: Parameters<typeof opcaoBarrasH>[0], o: LinhaEsc[], ini: number, fim: number) {
  return {
    legend: { show: true, top: 0, right: 0, textStyle: { color: t.rotulo }, itemWidth: 12, itemHeight: 8 },
    grid: { left: 8, right: 56, top: 28, bottom: 8, containLabel: true },
    tooltip: {
      ...(base(t).tooltip as object),
      trigger: "axis",
      formatter: (p: { dataIndex: number }[]) => {
        const l = o[p[0].dataIndex];
        const v = (x: number | null) => (x === null ? "—" : fmt.sm(x));
        return `<b>${l.nome}</b><br/>${ini}: ${v(l.inicio)}<br/>${fim}: ${v(l.fim)}`;
      },
    },
    series: [
      { name: String(ini), type: "bar", data: o.map((l) => l.inicio), itemStyle: { color: t.grade, borderRadius: [0, 4, 4, 0] }, barGap: "15%", barCategoryGap: "30%" },
      {
        name: String(fim),
        type: "bar",
        data: o.map((l) => l.fim),
        itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: t.rotulo, formatter: (p: { value: number }) => fmt.sm(p.value) },
      },
    ],
  };
}

// -------------------------------------------------------- permanência
function Permanencia({ area, anual }: { area: Area; anual: ReturnType<typeof useConsulta> }) {
  const f = useFiltro();
  const q = (sql: string | null) => useConsulta(area.slug, area.repo, sql);
  const risco = q(`SELECT tempo_de_casa, "risco_%" / 100 AS risco, vinculos::DOUBLE AS vinculos, ano FROM sobrevivencia_risco`);
  const tabua = q(`SELECT * EXCLUDE (ano) FROM sobrevivencia_tabua WHERE recorte = 'todos'`);
  const giro =
    anual.tipo === "pronto"
      ? { ...anual, dados: anual.dados.map((l) => ({ ano: l.ano, giro: num(l, "desligados") / num(l, "estoque"), desligados: l.desligados, estoque: l.estoque })) }
      : anual;
  const ordenado = (d: LinhaSQL[]) => FAIXAS.map((fx) => d.find((l) => l.tempo_de_casa === fx)).filter((l): l is LinhaSQL => !!l);
  const r = risco.tipo === "pronto" ? ordenado(risco.dados) : [];
  const pico = r.length ? r.reduce((m, l) => (num(l, "risco") > num(m, "risco") ? l : m)) : null;
  const g = giro.tipo === "pronto" ? giro.dados : [];
  const resposta =
    g.length > 1
      ? `O giro${f.ativo ? ` em ${f.rotulo}` : ""} foi de ${fmt.parte(num(g[0], "giro"))} em ${num(g[0], "ano")} e de ${fmt.parte(num(g.at(-1), "giro"))} em ${num(g.at(-1), "ano")}.${pico ? ` O risco de perder o emprego no ano é maior com ${ROTULO_FAIXA[String(pico.tempo_de_casa)]} de casa (${fmt.parte(num(pico, "risco"))}) e cai a partir daí.` : ""}`
      : undefined;
  const ano = r.length ? num(r[0], "ano") : "";

  return (
    <section className="flex flex-col gap-4">
      <Titulo pergunta="O emprego de TI ficou mais estável?" resposta={resposta} />
      <Painel
        titulo={`Giro anual · ${f.rotulo}`}
        descricao="RAIS · vínculos encerrados no ano em proporção ao estoque de 31/12"
        estado={giro as typeof anual}
        altura={260}
        tabela={(d) => ({ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "desligados", rotulo: "Desligados", formato: fmt.inteiro }, { chave: "estoque", rotulo: "Estoque", formato: fmt.inteiro }, { chave: "giro", rotulo: "Giro", formato: fmt.parte }], linhas: d })}
      >
        {(d) => <Grafico rotulo={`Giro anual do mercado de ${area.nome}`} altura={260} opcao={(t) => opcaoLinhas(t, rotulos(d, "ano"), [{ nome: "Giro", dados: coluna(d, "giro") }], { formato: fmt.parte, formatoEixo: (v) => fmt.parte(v), altura: 260 })} />}
      </Painel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Painel
          titulo="Risco anual de desligamento"
          descricao={`RAIS ${ano} · tábua de vida, por tempo de casa`}
          estado={risco}
          altura={280}
          nacional
          tabela={(d) => ({ colunas: [{ chave: "faixa", rotulo: "Tempo de casa" }, { chave: "risco", rotulo: "Risco anual", formato: fmt.parte }, { chave: "vinculos", rotulo: "Vínculos", formato: fmt.inteiro }], linhas: ordenado(d).map((l) => ({ ...l, faixa: ROTULO_FAIXA[String(l.tempo_de_casa)] })) })}
        >
          {(d) => {
            const o = ordenado(d);
            return <Grafico rotulo={`Risco anual de desligamento em ${area.nome}`} altura={280} opcao={(t) => opcaoBarrasH(t, o.map((l) => ROTULO_FAIXA[String(l.tempo_de_casa)]), coluna(o, "risco"), { formato: fmt.parte, larguraRotulo: 90 })} />;
          }}
        </Painel>
        <Painel
          titulo="Sobrevivência acumulada do vínculo"
          descricao={`RAIS ${ano} · tábua de vida: parte que continua no emprego ao fim de cada faixa`}
          estado={tabua}
          altura={280}
          nacional
          tabela={(d) => ({ colunas: [{ chave: "faixa", rotulo: "Tempo de casa" }, { chave: "valor", rotulo: "Ainda no emprego", formato: fmt.parte }], linhas: FAIXAS.map((fx) => ({ faixa: ROTULO_FAIXA[fx], valor: d[0] ? num(d[0], fx) / 100 : null })) })}
        >
          {(d) => (
            <Grafico
              rotulo={`Sobrevivência acumulada do vínculo em ${area.nome}`}
              altura={280}
              opcao={(t) => opcaoLinhas(t, FAIXAS.map((fx) => ROTULO_FAIXA[fx]), [{ nome: "Ainda no emprego", dados: FAIXAS.map((fx) => (d[0] ? num(d[0], fx) / 100 : null)), area: true }], { formato: fmt.parte, formatoEixo: (v) => fmt.parte(v), zero: true, altura: 280 })}
            />
          )}
        </Painel>
      </div>
    </section>
  );
}
