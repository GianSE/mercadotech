import { useMemo, useState } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, Kpi, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { UFS, useFiltro } from "../lib/filtro";
import { fmtCompacto, fmtDec, fmtNum, fmtSinal, fmtSM } from "../lib/formato";
import { opcaoBarras, opcaoLinhas } from "../lib/graficos";
import { coluna, entre, intervalo, literal, num, rotulos, tabelaRais, TI } from "../lib/sql";
import { escreverPeriodo, lerPeriodo, useParametro } from "../lib/url";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2026);

export default function Crescimento() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [periodo, setPeriodo] = useParametro<Periodo>("periodo", [2007, 2026], lerPeriodo, escreverPeriodo);

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

  // Resposta do topo: quanto cresceu no período, o ritmo médio e o maior salto.
  const resposta = (() => {
    if (raisL.length < 2 || !Number.isFinite(crescimento)) return undefined;
    const saltos = raisL.slice(1).map((l, i) => ({ ano: num(l, "ano"), taxa: (num(l, "estoque") / num(raisL[i], "estoque") - 1) * 100 }));
    const maior = saltos.reduce((m, x) => (x.taxa > m.taxa ? x : m), saltos[0]);
    const anos = num(raisL.at(-1), "ano") - num(raisL[0], "ano");
    const media = ((num(raisL.at(-1), "estoque") / num(raisL[0], "estoque")) ** (1 / anos) - 1) * 100;
    const onde = f.ativo ? ` em ${f.rotulo}` : "";
    return `O emprego formal de TI${onde} ${crescimento >= 0 ? "cresceu" : "caiu"} ${fmtDec(Math.abs(crescimento), 0)}% entre ${num(raisL[0], "ano")} e ${num(raisL.at(-1), "ano")}, ${fmtDec(media, 1)}% ao ano em média, com o maior salto em ${maior.ano} (${maior.taxa >= 0 ? "+" : ""}${fmtDec(maior.taxa, 1)}%).`;
  })();

  return (
    <>
      <CabecalhoPergunta numero={1} pergunta="Quanto o mercado cresceu, e em que ritmo?" resposta={resposta} />
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
          ajuda="estoque"
          valor={Number.isFinite(crescimento) ? `${crescimento >= 0 ? "+" : ""}${fmtDec(crescimento, 0)}%` : "—"}
          detalhe={raisL.length ? `RAIS, ${num(raisL[0], "ano")}–${num(raisL.at(-1), "ano")}` : undefined}
        />
        <Kpi rotulo={`Vínculos ativos em ${num(raisL.at(-1), "ano") || "—"}`} valor={fmtCompacto(num(raisL.at(-1), "estoque"))} detalhe="RAIS, 31/12" />
        <Kpi rotulo="Saldo no período" ajuda="saldo" valor={a.length ? fmtSinal(saldoTotal) : "—"} detalhe="CAGED, vagas líquidas" />
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

      <Comparar periodo={periodo} />
    </>
  );
}

// ------------------------------------------------- dois estados lado a lado
// Não segue o filtro de território: a comparação escolhe os seus dois lados
// (e o Brasil inteiro pode ser um deles). A cor segue o lado: A azul, B laranja.
const BRASIL = "BR";
const METRICAS_COMPARAR = {
  indice: { rotulo: "Crescimento (primeiro ano = 100)", formato: (v: number) => fmtDec(v, 0), formatoEixo: (v: number) => fmtDec(v, 0) },
  estoque: { rotulo: "Vínculos ativos", formato: fmtNum, formatoEixo: fmtCompacto },
  mediana: { rotulo: "Remuneração mediana (SM)", formato: fmtSM, formatoEixo: (v: number) => fmtDec(v, 1) },
  saldo: { rotulo: "Saldo anual (CAGED)", formato: fmtSinal, formatoEixo: fmtCompacto },
} as const;
type MetricaComparar = keyof typeof METRICAS_COMPARAR;
const nomeLado = (uf: string) => (uf === BRASIL ? "Brasil" : uf);

function Comparar({ periodo }: { periodo: Periodo }) {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [a, setA] = useState(f.ufs[0] ?? "PR");
  const [b, setB] = useState(f.ufs[1] ?? (f.ufs[0] === "SC" ? "PR" : "SC"));
  const [metrica, setMetrica] = useState<MetricaComparar>("indice");
  const fimRais = Math.min(periodo[1], 2025);
  const ufsSql = [a, b].filter((u) => u !== BRASIL).map(literal).join(", ") || "''";

  const dados = useConsulta(`
    WITH est AS (
      SELECT ano, uf, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_uf
      WHERE ${TI} AND uf IN (${ufsSql}) AND ano BETWEEN ${periodo[0]} AND ${fimRais} GROUP BY 1, 2
      UNION ALL
      SELECT ano, '${BRASIL}', sum(estoque_3112)::DOUBLE FROM rais_estoque_anual
      WHERE ${TI} AND ano BETWEEN ${periodo[0]} AND ${fimRais} GROUP BY 1),
    med AS (
      SELECT ano, grupo AS uf, mediana_sm AS mediana FROM rais_mediana WHERE recorte = 'uf' AND grupo IN (${ufsSql})
      UNION ALL
      SELECT ano, '${BRASIL}', mediana_sm FROM rais_mediana WHERE recorte = 'total'),
    sal AS (
      SELECT ano, uf, sum(saldo)::DOUBLE AS saldo FROM caged_cubo WHERE uf IN (${ufsSql}) AND ${entre(periodo)} GROUP BY 1, 2
      UNION ALL
      SELECT ano, '${BRASIL}', sum(saldo)::DOUBLE FROM caged_cubo WHERE ${entre(periodo)} GROUP BY 1)
    SELECT coalesce(e.ano, s.ano) AS ano, coalesce(e.uf, s.uf) AS uf, e.estoque, m.mediana, s.saldo
    FROM est e FULL JOIN sal s ON s.ano = e.ano AND s.uf = e.uf
    LEFT JOIN med m ON m.ano = coalesce(e.ano, s.ano) AND m.uf = coalesce(e.uf, s.uf)
    ORDER BY 1`);

  const m = METRICAS_COMPARAR[metrica];
  const { anos, porLado } = useMemo(() => {
    const d = dados.linhas;
    // O CAGED vai até o ano corrente; métricas da RAIS param no último ano publicado.
    const anos = [...new Set(d.map((l) => num(l, "ano")))].filter((ano) => metrica === "saldo" || ano <= fimRais).sort((x, y) => x - y);
    const serie = (uf: string, chave: string) =>
      anos.map((ano) => {
        const l = d.find((x) => x.uf === uf && num(x, "ano") === ano);
        return l && l[chave] !== null ? num(l, chave) : null;
      });
    const valores = (uf: string) => {
      if (metrica !== "indice") return serie(uf, metrica);
      const v = serie(uf, "estoque");
      const base = v.find((x) => x !== null);
      return v.map((x) => (x === null || !base ? null : (x / base) * 100));
    };
    const cresceu = (uf: string) => {
      const v = serie(uf, "estoque").filter((x): x is number => x !== null);
      return v.length > 1 ? (v[v.length - 1] / v[0] - 1) * 100 : NaN;
    };
    return { anos, porLado: [a, b].map((uf) => ({ uf, valores: valores(uf), cresceu: cresceu(uf) })) };
  }, [dados.linhas, metrica, a, b, fimRais]);

  const op = useMemo(
    () =>
      anos.length
        ? opcaoLinhas(
            c,
            anos.map(String),
            porLado.map((l, i) => ({ nome: nomeLado(l.uf), dados: l.valores, rotuloFinal: true, cor: c.series[i] })),
            { formato: m.formato, formatoEixo: m.formatoEixo, zero: metrica !== "indice" },
          )
        : null,
    [anos, porLado, m, metrica, c],
  );

  const [la, lb] = porLado;
  const opcoes = [{ valor: BRASIL, rotulo: "Brasil" }, ...UFS.map((u) => ({ valor: u, rotulo: u }))];
  const verbo = (v: number) => `${v >= 0 ? "cresceu" : "caiu"} ${fmtDec(Math.abs(v), 0)}%`;

  return (
    <Bloco
      titulo="Comparar dois estados"
      descricao={
        Number.isFinite(la.cresceu) && Number.isFinite(lb.cresceu)
          ? `Entre ${anos[0]} e ${fimRais}, o estoque de TI de ${nomeLado(a)} ${verbo(la.cresceu)}, e o de ${nomeLado(b)} ${verbo(lb.cresceu)}.`
          : undefined
      }
    >
      <div className="flex flex-wrap items-end gap-4">
        <Seletor rotulo="Estado A" valor={a} opcoes={opcoes} aoMudar={setA} />
        <Seletor rotulo="Estado B" valor={b} opcoes={opcoes} aoMudar={setB} />
        <Seletor rotulo="Comparar" valor={metrica} opcoes={(Object.keys(METRICAS_COMPARAR) as MetricaComparar[]).map((k) => ({ valor: k, rotulo: METRICAS_COMPARAR[k].rotulo }))} aoMudar={setMetrica} />
      </div>
      <CartaoGrafico
        titulo={`${nomeLado(a)} × ${nomeLado(b)} · ${m.rotulo}`}
        subtitulo={`${metrica === "saldo" ? "CAGED" : "RAIS"} · ${periodo[0]}–${metrica === "saldo" ? periodo[1] : fimRais} · não segue o filtro de território`}
        ajuda={metrica === "mediana" ? "sm" : metrica === "saldo" ? "saldo" : "estoque"}
        opcao={op}
        carregando={dados.carregando}
        erro={dados.erro}
        altura={340}
        tabela={{
          colunas: [
            { chave: "ano", rotulo: "Ano" },
            { chave: "a", rotulo: nomeLado(a), formato: (v) => (v === null ? "—" : m.formato(Number(v))), numero: true },
            { chave: "b", rotulo: nomeLado(b), formato: (v) => (v === null ? "—" : m.formato(Number(v))), numero: true },
          ],
          linhas: anos.map((ano, i) => ({ ano, a: la.valores[i], b: lb.valores[i] })),
        }}
      />
    </Bloco>
  );
}

