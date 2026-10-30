import { useMemo, useState } from "react";
import { CartaoGrafico } from "../../componentes/Grafico";
import { SeletorEstados } from "../../componentes/SeletorUF";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, Kpi, LinhaFiltros, Seletor, type Periodo } from "../../componentes/ui";
import { useFiltro } from "../../lib/filtro";
import { fmtCompacto, fmtDec, fmtNum, fmtSinal, fmtSM } from "../../lib/formato";
import { opcaoFluxo, opcaoLinhas, type SerieFluxo } from "../../lib/graficos";
import { coluna, entre, intervalo, literal, num, rotulos, tabelaRais, TI } from "../../lib/sql";
import { escreverPeriodo, lerPeriodo, useParametro } from "../../lib/url";
import { useTema } from "../../lib/tema";
import { useConsulta } from "../../lib/useConsulta";

const ANOS = intervalo(2007, 2026);
type Grao = "ano" | "mes";
const SERIES_FLUXO: { chave: SerieFluxo; rotulo: string }[] = [
  { chave: "admissoes", rotulo: "Admissões" },
  { chave: "desligamentos", rotulo: "Desligamentos" },
  { chave: "saldo", rotulo: "Saldo" },
];

// A pergunta 1 (quanto o mercado cresceu?) em três páginas: 1a, o estoque
// (RAIS); 1b, o fluxo de admissões e desligamentos (CAGED); 1d, os estados
// lado a lado. Cada uma só consulta o que mostra.
export type ParteCrescimento = "estoque" | "fluxo" | "estados";

export default function Crescimento({ parte = "estoque" }: { parte?: ParteCrescimento }) {
  const { cores: c } = useTema();
  const f = useFiltro();
  const noFluxo = parte === "fluxo";
  const [periodo, setPeriodo] = useParametro<Periodo>("periodo", [2007, 2026], lerPeriodo, escreverPeriodo);
  const [grao, setGrao] = useState<Grao>("ano");
  const [visiveis, setVisiveis] = useState<SerieFluxo[]>(["admissoes", "desligamentos", "saldo"]);
  // Pelo menos uma série fica ligada: um gráfico vazio não diz nada.
  const alternarSerie = (s: SerieFluxo) =>
    setVisiveis((v) => (v.includes(s) ? (v.length > 1 ? v.filter((x) => x !== s) : v) : SERIES_FLUXO.map((x) => x.chave).filter((x) => x === s || v.includes(x))));

  const referencia = useConsulta(!noFluxo ? null : "SELECT strftime(max(mes), '%m/%Y') AS ultimo, year(max(mes)) AS ano FROM serie_mensal");
  const ultimoMes = String(referencia.linhas[0]?.ultimo ?? "");
  const anoParcial = num(referencia.linhas[0], "ano");

  const anual = useConsulta(!noFluxo ? null : `
    SELECT ano::VARCHAR AS periodo, ano, sum(saldo)::DOUBLE AS saldo, sum(admissoes)::DOUBLE AS admissoes, sum(desligamentos)::DOUBLE AS desligamentos
    FROM caged_cubo WHERE ${entre(periodo)} AND ${f.sql()} GROUP BY ano ORDER BY ano`);
  // Mês a mês: o cubo mensal por UF; numa Gold anterior a ele, a série
  // nacional dos modelos (e o cartão avisa que é o Brasil inteiro).
  const mensal = useConsulta(noFluxo && grao === "mes" ? `
    SELECT strftime(make_date(ano, mes, 1), '%Y-%m') AS periodo, sum(saldo)::DOUBLE AS saldo,
           sum(admissoes)::DOUBLE AS admissoes, sum(desligamentos)::DOUBLE AS desligamentos
    FROM caged_mensal WHERE ${entre(periodo)} AND ${f.sql()} GROUP BY 1 ORDER BY 1` : null);
  const mensalNacional = useConsulta(noFluxo && grao === "mes" && mensal.erro ? `
    SELECT strftime(mes, '%Y-%m') AS periodo, saldo::DOUBLE AS saldo, admissoes::DOUBLE AS admissoes, desligamentos::DOUBLE AS desligamentos
    FROM serie_mensal WHERE year(mes) BETWEEN ${periodo[0]} AND ${periodo[1]} ORDER BY 1` : null);
  const rais = useConsulta(parte !== "estoque" ? null : `
    SELECT ano, sum(estoque_3112)::DOUBLE AS estoque
    FROM ${tabelaRais(f.ativo)} WHERE ${TI} AND ${entre(periodo)} AND ${f.sql()} GROUP BY 1 ORDER BY 1`);

  const raisL = rais.linhas;
  const a = anual.linhas;
  const fonteFluxo = grao === "ano" ? anual : mensal.erro ? mensalNacional : mensal;
  const fluxo = fonteFluxo.linhas;
  const soNacional = grao === "mes" && !!mensal.erro;
  const crescimento = raisL.length > 1 ? (num(raisL.at(-1), "estoque") / num(raisL[0], "estoque") - 1) * 100 : NaN;
  const saldoTotal = a.reduce((s, l) => s + num(l, "saldo"), 0);
  const admissoesTotal = a.reduce((s, l) => s + num(l, "admissoes"), 0);
  const desligamentosTotal = a.reduce((s, l) => s + num(l, "desligamentos"), 0);
  const ritmo = raisL.length > 1
    ? ((num(raisL.at(-1), "estoque") / num(raisL[0], "estoque")) ** (1 / (num(raisL.at(-1), "ano") - num(raisL[0], "ano"))) - 1) * 100
    : NaN;
  // 1d: o crescimento de cada estado no período, para a frase do topo.
  const fimRais = Math.min(periodo[1], 2025);
  const porEstado = useConsulta(parte !== "estados" ? null : `
    SELECT uf, sum(estoque_3112) FILTER (WHERE ano = ${periodo[0]})::DOUBLE AS inicio, sum(estoque_3112) FILTER (WHERE ano = ${fimRais})::DOUBLE AS fim
    FROM rais_estoque_uf WHERE ${TI} AND ano IN (${periodo[0]}, ${fimRais}) GROUP BY 1`);

  const op = useMemo(() => {
    const x = rotulos(fluxo, "periodo");
    // O ano corrente (incompleto) fica esmaecido nas barras anuais.
    const parcialIdx = grao === "ano" ? [x.indexOf(String(anoParcial))] : [];
    return {
      fluxo: fluxo.length
        ? opcaoFluxo(c, x, { admissoes: coluna(fluxo, "admissoes"), desligamentos: coluna(fluxo, "desligamentos"), saldo: coluna(fluxo, "saldo") }, { visiveis, esmaecer: parcialIdx })
        : null,
      estoque: raisL.length
        ? opcaoLinhas(c, rotulos(raisL, "ano"), [{ nome: "Vínculos ativos em 31/12", dados: coluna(raisL, "estoque"), area: true, rotuloFinal: true }], { formato: fmtNum, zero: true })
        : null,
    };
  }, [fluxo, grao, visiveis, raisL, anoParcial, c]);

  const parcial = periodo[1] >= anoParcial && anoParcial ? ` · ${anoParcial} até ${ultimoMes}` : "";
  const nomeGrao = grao === "ano" ? "anual" : "mensal";
  const colunasFluxo = [
    { chave: "periodo", rotulo: grao === "ano" ? "Ano" : "Mês" },
    { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true },
    { chave: "desligamentos", rotulo: "Desligamentos", formato: fmtNum, numero: true },
    { chave: "saldo", rotulo: "Saldo", formato: fmtSinal, numero: true },
  ];

  // 1b: o que entrou, o que saiu e os anos extremos (só anos completos).
  const respostaFluxo = (() => {
    const completos = a.filter((l) => num(l, "ano") !== anoParcial);
    if (!completos.length) return undefined;
    const [melhor, pior] = [
      completos.reduce((m, l) => (num(l, "saldo") > num(m, "saldo") ? l : m)),
      completos.reduce((m, l) => (num(l, "saldo") < num(m, "saldo") ? l : m)),
    ];
    const onde = f.ativo ? ` em ${f.rotulo}` : "";
    return `De ${periodo[0]} a ${periodo[1]}, o mercado de TI${onde} contratou ${fmtCompacto(admissoesTotal)} e desligou ${fmtCompacto(desligamentosTotal)}, um saldo de ${fmtSinal(saldoTotal)} vagas; o melhor ano foi ${num(melhor, "ano")} (${fmtSinal(num(melhor, "saldo"))}) e o pior, ${num(pior, "ano")} (${fmtSinal(num(pior, "saldo"))}).`;
  })();
  // 1d: quem mais e quem menos cresceu entre os 27 estados.
  const respostaEstados = (() => {
    const taxas = porEstado.linhas
      .filter((l) => num(l, "inicio") > 0 && num(l, "fim") > 0)
      .map((l) => ({ uf: String(l.uf), taxa: (num(l, "fim") / num(l, "inicio") - 1) * 100, inicio: num(l, "inicio"), fim: num(l, "fim") }))
      .sort((x, y) => y.taxa - x.taxa);
    if (taxas.length < 2) return undefined;
    const brasil = (taxas.reduce((s, x) => s + x.fim, 0) / taxas.reduce((s, x) => s + x.inicio, 0) - 1) * 100;
    const sinal = (v: number) => `${v >= 0 ? "+" : ""}${fmtDec(v, 0)}%`;
    return `Entre ${periodo[0]} e ${fimRais}, o estoque de TI cresceu mais em ${taxas[0].uf} (${sinal(taxas[0].taxa)}) e menos em ${taxas.at(-1)!.uf} (${sinal(taxas.at(-1)!.taxa)}), contra ${sinal(brasil)} do Brasil.`;
  })();

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
      <CabecalhoPergunta
        numero={parte === "estoque" ? "1a" : parte === "fluxo" ? "1b" : "1d"}
        pergunta={
          parte === "estoque" ? "Quanto o mercado cresceu: quantos empregos de TI há?"
          : parte === "fluxo" ? "Quanto o mercado cresceu: quem entra e quem sai?"
          : "Quanto o mercado cresceu: em que estados?"
        }
        resposta={parte === "estoque" ? resposta : parte === "fluxo" ? respostaFluxo : respostaEstados}
      />
      <LinhaFiltros resumo={`${periodo[0]}–${periodo[1]}`}>
        <FiltroPeriodo anos={ANOS} valor={periodo} aoMudar={setPeriodo} />
      </LinhaFiltros>

      {parte === "estoque" && (
        <>
      <Grade colunas={3}>
        <Kpi
          destaque
          rotulo="Crescimento do estoque"
          ajuda="estoque"
          valor={Number.isFinite(crescimento) ? `${crescimento >= 0 ? "+" : ""}${fmtDec(crescimento, 0)}%` : "—"}
          detalhe={raisL.length ? `RAIS, ${num(raisL[0], "ano")}–${num(raisL.at(-1), "ano")}` : undefined}
        />
        <Kpi rotulo={`Vínculos ativos em ${num(raisL.at(-1), "ano") || "—"}`} valor={fmtCompacto(num(raisL.at(-1), "estoque"))} detalhe="RAIS, 31/12" />
        <Kpi rotulo="Ritmo médio" valor={Number.isFinite(ritmo) ? `${fmtDec(ritmo, 1)}% ao ano` : "—"} detalhe="crescimento composto do estoque" />
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
        </>
      )}
      {parte === "fluxo" && (
        <>
      <Grade colunas={3}>
        <Kpi destaque rotulo="Saldo no período" ajuda="saldo" valor={a.length ? fmtSinal(saldoTotal) : "—"} detalhe="CAGED, vagas líquidas" />
        <Kpi rotulo="Admissões" valor={a.length ? fmtCompacto(admissoesTotal) : "—"} detalhe={`CAGED, ${periodo[0]}–${periodo[1]}`} />
        <Kpi rotulo="Desligamentos" valor={a.length ? fmtCompacto(desligamentosTotal) : "—"} detalhe={`CAGED, ${periodo[0]}–${periodo[1]}`} />
      </Grade>

      <Bloco titulo="Fluxo: quem entra, quem sai e o que sobra">
        <div className="flex flex-wrap items-end gap-4">
          <Seletor<Grao> rotulo="Ver por" valor={grao} opcoes={[{ valor: "ano", rotulo: "Ano" }, { valor: "mes", rotulo: "Mês" }]} aoMudar={setGrao} />
          <div className="flex min-w-0 flex-col gap-1">
            <span className="sobrelinha">Mostrar</span>
            <div className="flex flex-wrap gap-2 sm:gap-1.5" role="group" aria-label="Séries do gráfico">
              {SERIES_FLUXO.map((s, i) => {
                const ligada = visiveis.includes(s.chave);
                return (
                  <button
                    key={s.chave}
                    type="button"
                    aria-pressed={ligada}
                    onClick={() => alternarSerie(s.chave)}
                    className={`flex h-10 items-center gap-2 rounded-full border px-4 text-[14px] transition-colors sm:h-8 sm:px-3 sm:text-[13px] ${ligada ? "border-tinta-3 bg-superficie text-tinta" : "border-borda bg-superficie text-tinta-3 line-through decoration-tinta-3/60 hover:text-tinta-2"}`}
                  >
                    <span
                      aria-hidden
                      className={i === 2 ? "h-0.5 w-3.5 rounded-full" : "h-2.5 w-2.5 rounded-[3px]"}
                      style={{ background: ligada ? (i === 2 ? c.tinta : c.series[i]) : c.grade }}
                    />
                    {s.rotulo}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <CartaoGrafico
          titulo={`Admissões, desligamentos e saldo · ${nomeGrao} · ${soNacional ? "Brasil" : f.rotulo}`}
          subtitulo={`CAGED · admissões para cima, desligamentos para baixo; a linha é o saldo, o quanto uma barra passa da outra${grao === "ano" ? parcial : ""}`}
          ajuda="saldo"
          nacional={soNacional}
          opcao={op.fluxo}
          carregando={fonteFluxo.carregando}
          erro={grao === "ano" ? anual.erro : mensalNacional.erro}
          altura={380}
          tabela={{ colunas: colunasFluxo, linhas: fluxo }}
        />
      </Bloco>
        </>
      )}
      {parte === "estados" && <Comparar periodo={periodo} />}
    </>
  );
}

// ------------------------------------------------- estados lado a lado
// Não segue o filtro de território: a comparação escolhe os seus próprios
// estados (e o Brasil pode ser um deles, como referência). Até oito linhas
// ganham cor, na ordem da paleta; da nona em diante ficam cinza, com o nome
// no fim da linha — gerar uma nona cor faria duas linhas parecerem a mesma.
const BRASIL = "BR";
const MAX_CORES = 8;
const METRICAS_COMPARAR = {
  indice: { rotulo: "Crescimento (primeiro ano = 100)", formato: (v: number) => fmtDec(v, 0), formatoEixo: (v: number) => fmtDec(v, 0) },
  estoque: { rotulo: "Vínculos ativos", formato: fmtNum, formatoEixo: fmtCompacto },
  mediana: { rotulo: "Remuneração mediana (SM)", formato: fmtSM, formatoEixo: (v: number) => fmtDec(v, 1) },
  saldo: { rotulo: "Saldo anual (CAGED)", formato: fmtSinal, formatoEixo: fmtCompacto },
} as const;
type MetricaComparar = keyof typeof METRICAS_COMPARAR;
const nomeLado = (uf: string) => (uf === BRASIL ? "Brasil" : uf);
const deLado = (uf: string) => (uf === BRASIL ? "do Brasil" : `de ${uf}`);

function Comparar({ periodo }: { periodo: Periodo }) {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [selecionados, setSelecionados] = useState<string[]>(() => [BRASIL, ...(f.ativo ? f.ufs : ["PR", "SC"])]);
  const [metrica, setMetrica] = useState<MetricaComparar>("indice");
  const fimRais = Math.min(periodo[1], 2025);
  const ufs = selecionados.filter((u) => u !== BRASIL);
  const ufsSql = ufs.map(literal).join(", ") || "''";
  const comBrasil = selecionados.includes(BRASIL);

  const dados = useConsulta(selecionados.length ? `
    WITH est AS (
      SELECT ano, uf, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_uf
      WHERE ${TI} AND uf IN (${ufsSql}) AND ano BETWEEN ${periodo[0]} AND ${fimRais} GROUP BY 1, 2
      ${comBrasil ? `UNION ALL SELECT ano, '${BRASIL}', sum(estoque_3112)::DOUBLE FROM rais_estoque_anual WHERE ${TI} AND ano BETWEEN ${periodo[0]} AND ${fimRais} GROUP BY 1` : ""}),
    med AS (
      SELECT ano, grupo AS uf, mediana_sm AS mediana FROM rais_mediana WHERE recorte = 'uf' AND grupo IN (${ufsSql})
      ${comBrasil ? `UNION ALL SELECT ano, '${BRASIL}', mediana_sm FROM rais_mediana WHERE recorte = 'total'` : ""}),
    sal AS (
      SELECT ano, uf, sum(saldo)::DOUBLE AS saldo FROM caged_cubo WHERE uf IN (${ufsSql}) AND ${entre(periodo)} GROUP BY 1, 2
      ${comBrasil ? `UNION ALL SELECT ano, '${BRASIL}', sum(saldo)::DOUBLE FROM caged_cubo WHERE ${entre(periodo)} GROUP BY 1` : ""})
    SELECT coalesce(e.ano, s.ano) AS ano, coalesce(e.uf, s.uf) AS uf, e.estoque, m.mediana, s.saldo
    FROM est e FULL JOIN sal s ON s.ano = e.ano AND s.uf = e.uf
    LEFT JOIN med m ON m.ano = coalesce(e.ano, s.ano) AND m.uf = coalesce(e.uf, s.uf)
    ORDER BY 1` : null);

  const m = METRICAS_COMPARAR[metrica];
  const { anos, linhas } = useMemo(() => {
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
    return { anos, linhas: selecionados.map((uf) => ({ uf, valores: valores(uf), cresceu: cresceu(uf) })) };
  }, [dados.linhas, metrica, selecionados, fimRais]);

  const op = useMemo(
    () =>
      anos.length && linhas.length
        ? opcaoLinhas(
            c,
            anos.map(String),
            linhas.map((l, i) => ({ nome: nomeLado(l.uf), dados: l.valores, rotuloFinal: linhas.length <= 12, cor: i < MAX_CORES ? c.series[i] : c.tinta3 })),
            { formato: m.formato, formatoEixo: m.formatoEixo, zero: metrica !== "indice" },
          )
        : null,
    [anos, linhas, m, metrica, c],
  );

  // Leitura: quem mais e quem menos cresceu entre os escolhidos.
  const comNumero = linhas.filter((l) => Number.isFinite(l.cresceu)).sort((x, y) => y.cresceu - x.cresceu);
  const descricao = comNumero.length >= 2
    ? `Entre ${anos[0]} e ${fimRais}, entre os escolhidos, o estoque de TI ${deLado(comNumero[0].uf)} foi o que mais cresceu (${fmtDec(comNumero[0].cresceu, 0)}%) e o ${deLado(comNumero.at(-1)!.uf)}, o que menos cresceu (${fmtDec(comNumero.at(-1)!.cresceu, 0)}%).`
    : undefined;

  return (
    <Bloco titulo="Comparar estados" descricao={descricao}>
      <div className="flex flex-wrap items-end gap-4">
        <SeletorEstados rotulo="Estados" valor={selecionados} aoMudar={setSelecionados} extras={[{ valor: BRASIL, rotulo: "Brasil" }]} />
        <Seletor rotulo="Comparar" valor={metrica} opcoes={(Object.keys(METRICAS_COMPARAR) as MetricaComparar[]).map((k) => ({ valor: k, rotulo: METRICAS_COMPARAR[k].rotulo }))} aoMudar={setMetrica} />
      </div>
      <CartaoGrafico
        titulo={`${m.rotulo} · ${selecionados.length} selecionado${selecionados.length === 1 ? "" : "s"}`}
        subtitulo={`${metrica === "saldo" ? "CAGED" : "RAIS"} · ${periodo[0]}–${metrica === "saldo" ? periodo[1] : fimRais} · não segue o filtro de território${selecionados.length > MAX_CORES ? " · a partir do 9º, em cinza" : ""}`}
        ajuda={metrica === "mediana" ? "sm" : metrica === "saldo" ? "saldo" : "estoque"}
        opcao={op}
        carregando={dados.carregando}
        erro={dados.erro}
        altura={selecionados.length > 8 ? 440 : 360}
        tabela={{
          colunas: [{ chave: "ano", rotulo: "Ano" }, ...linhas.map((l) => ({ chave: l.uf, rotulo: nomeLado(l.uf), formato: (v: unknown) => (v === null || v === undefined ? "—" : m.formato(Number(v))), numero: true }))],
          linhas: anos.map((ano, i) => Object.fromEntries([["ano", ano], ...linhas.map((l) => [l.uf, l.valores[i]])])),
        }}
      />
    </Bloco>
  );
}
