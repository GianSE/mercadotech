import { useMemo, useState } from "react";
import { CartaoGrafico, type Clique } from "../componentes/Grafico";
import { Bloco, FiltroPeriodo, Grade, Kpi, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { fmtCompacto, fmtNum, fmtReais, fmtSinal } from "../lib/formato";
import { opcaoBarras, opcaoLinhas, opcaoRosca } from "../lib/graficos";
import { useFiltro } from "../lib/filtro";
import { coluna, entre, intervalo, literal, num, rotulos } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2026);

const DIMENSOES = {
  uf: { rotulo: "Estado", ordem: null },
  setor: { rotulo: "Setor da empresa", ordem: null },
  lente: { rotulo: "Lente do recorte", ordem: null },
  area_ti: { rotulo: "Área de TI", ordem: null },
  sexo: { rotulo: "Sexo", ordem: null },
  raca_cor: { rotulo: "Raça/cor", ordem: null },
  escolaridade: {
    rotulo: "Escolaridade",
    ordem: ["Analfabeto", "Fundamental incompleto", "Fundamental completo", "Médio incompleto", "Médio completo", "Superior incompleto", "Superior completo", "Pós-graduação", "Não informado"],
  },
  faixa_idade: { rotulo: "Faixa etária", ordem: ["<25", "25-29", "30-39", "40-49", "50+"] },
} as const;
type Dimensao = keyof typeof DIMENSOES;
const LISTA = Object.keys(DIMENSOES) as Dimensao[];
// O estado não tem seletor próprio aqui: é o filtro de território do site.
type Filtravel = Exclude<Dimensao, "uf">;
const FILTRAVEIS = LISTA.filter((d): d is Filtravel => d !== "uf");
const semFiltros = () => Object.fromEntries(FILTRAVEIS.map((d) => [d, TODOS])) as Record<Filtravel, string>;

const MEDIDAS = {
  admissoes: { rotulo: "Admissões", sql: "sum(admissoes)::DOUBLE", formato: fmtNum },
  saldo: { rotulo: "Saldo", sql: "sum(saldo)::DOUBLE", formato: fmtSinal },
  salario: { rotulo: "Salário médio de admissão", sql: "sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0)", formato: fmtReais },
} as const;
type Medida = keyof typeof MEDIDAS;

const TODOS = "__todos__";

export default function Explorar() {
  const { cores: c } = useTema();
  const territorio = useFiltro();
  const [periodo, setPeriodo] = useState<Periodo>([2020, 2026]);
  const [filtros, setFiltros] = useState<Record<Filtravel, string>>(semFiltros);
  const [quebra, setQuebra] = useState<Dimensao>("area_ti");
  const [medida, setMedida] = useState<Medida>("admissoes");

  const valores = useConsulta(FILTRAVEIS.map((d) => `SELECT '${d}' AS dimensao, ${d}::VARCHAR AS valor FROM caged_cubo WHERE ${d} IS NOT NULL GROUP BY 2`).join(" UNION ALL "));
  const opcoesDe = (d: Dimensao) => {
    const vs = valores.linhas.filter((l) => l.dimensao === d).map((l) => String(l.valor));
    const ordem = DIMENSOES[d].ordem as readonly string[] | null;
    return ordem ? ordem.filter((o) => vs.includes(o)) : vs.sort((a, b) => a.localeCompare(b, "pt-BR"));
  };

  const onde = [entre(periodo), territorio.sql(), ...FILTRAVEIS.filter((d) => filtros[d] !== TODOS).map((d) => `${d} = ${literal(filtros[d])}`)].join(" AND ");
  const m = MEDIDAS[medida];

  const total = useConsulta(`
    SELECT sum(admissoes)::DOUBLE AS admissoes, sum(desligamentos)::DOUBLE AS desligamentos, sum(saldo)::DOUBLE AS saldo,
           sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
    FROM caged_cubo WHERE ${onde}`);
  const anual = useConsulta(`SELECT ano, ${m.sql} AS valor FROM caged_cubo WHERE ${onde} GROUP BY 1 ORDER BY 1`);
  const porCategoria = useConsulta(`
    SELECT ${quebra}::VARCHAR AS categoria, ${m.sql} AS valor, sum(admissoes)::DOUBLE AS admissoes, sum(saldo)::DOUBLE AS saldo,
           sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
    FROM caged_cubo WHERE ${onde} AND ${quebra} IS NOT NULL GROUP BY 1`);
  const evolucao = useConsulta(`
    SELECT ano, ${quebra}::VARCHAR AS categoria, sum(admissoes)::DOUBLE AS admissoes
    FROM caged_cubo WHERE ${onde} AND ${quebra} IS NOT NULL GROUP BY 1, 2 ORDER BY 1`);

  const t = total.linhas[0];
  const ordemQuebra = DIMENSOES[quebra].ordem as readonly string[] | null;
  const categorias = useMemo(() => {
    const l = [...porCategoria.linhas];
    return ordemQuebra
      ? l.sort((a, b) => ordemQuebra.indexOf(String(a.categoria)) - ordemQuebra.indexOf(String(b.categoria)))
      : l.sort((a, b) => num(b, "valor") - num(a, "valor")).slice(0, 25);
  }, [porCategoria.linhas, ordemQuebra]);

  const op = useMemo(() => {
    const a = anual.linhas;
    // Evolução: as 5 categorias de maior volume + "Outros", para não passar
    // de 6 cores (a paleta só garante separação até aí).
    const totais = new Map<string, number>();
    evolucao.linhas.forEach((l) => totais.set(String(l.categoria), (totais.get(String(l.categoria)) ?? 0) + num(l, "admissoes")));
    const principais = [...totais.entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k]) => k);
    const anosEv = [...new Set(evolucao.linhas.map((l) => num(l, "ano")))].sort();
    const temOutros = totais.size > principais.length;
    const seriesEv = [...principais, ...(temOutros ? ["Outros"] : [])].map((cat) => ({
      nome: cat,
      dados: anosEv.map((ano) =>
        evolucao.linhas
          .filter((l) => num(l, "ano") === ano && (cat === "Outros" ? !principais.includes(String(l.categoria)) : l.categoria === cat))
          .reduce((s, l) => s + num(l, "admissoes"), 0),
      ),
    }));
    return {
      anual: a.length
        ? medida === "salario"
          ? opcaoLinhas(c, rotulos(a, "ano"), [{ nome: m.rotulo, dados: coluna(a, "valor"), rotuloFinal: true }], { formato: m.formato, formatoEixo: fmtCompacto })
          : opcaoBarras(c, rotulos(a, "ano"), coluna(a, "valor"), { nome: m.rotulo, formato: m.formato, divergente: medida === "saldo" })
        : null,
      // Poucas categorias de uma soma (admissões): parte de um todo, rosca.
      // Saldo (tem sinal) e salário (média, não soma) continuam em barras.
      categorias: categorias.length && categorias.length <= 6 && medida === "admissoes"
        ? opcaoRosca(c, categorias.map((l) => ({ nome: String(l.categoria), valor: num(l, "valor") })), { centro: "admissões" })
        : categorias.length
        ? opcaoBarras(c, rotulos(categorias, "categoria"), coluna(categorias, "valor"), { horizontal: true, nome: m.rotulo, formato: m.formato, divergente: medida === "saldo", larguraRotulo: 230 })
        : null,
      evolucao: seriesEv.length && !ordemQuebra ? opcaoLinhas(c, anosEv, seriesEv, { formato: fmtNum }) : null,
    };
  }, [anual.linhas, categorias, evolucao.linhas, medida, m, ordemQuebra, c]);

  const filtrosAtivos = FILTRAVEIS.filter((d) => filtros[d] !== TODOS).length;

  // Clique numa barra ou fatia: filtra por aquela categoria (de novo, desfaz).
  // Na quebra por estado, o clique mexe no filtro de território do site.
  const clicarCategoria = ({ nome }: Clique) => {
    if (quebra === "uf") return territorio.alternar(nome);
    setFiltros((f) => ({ ...f, [quebra]: f[quebra] === nome ? TODOS : nome }));
  };

  return (
    <>
      <header className="mb-8">
        <p className="sobrelinha">
          <span className="mr-2 inline-block h-2 w-2 rounded-[2px] bg-acento align-middle" />
          Explorar
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-tinta sm:text-3xl">Monte o seu recorte do CAGED</h1>
        <p className="mt-2 text-[14px] text-tinta-3">CAGED 2007–2026 · filtre, quebre por qualquer dimensão, clique numa categoria para filtrar</p>
      </header>

      <LinhaFiltros resumo={`${periodo[0]}–${periodo[1]} · ${m.rotulo}${filtrosAtivos ? ` · ${filtrosAtivos} filtro(s)` : ""}`} nota={filtrosAtivos ? `${filtrosAtivos} filtro(s) ativo(s), além do período.` : "Sem filtros além do período."}>
        <FiltroPeriodo anos={ANOS} valor={periodo} aoMudar={setPeriodo} />
        {FILTRAVEIS.map((d) => (
          <Seletor
            key={d}
            rotulo={DIMENSOES[d].rotulo}
            valor={filtros[d]}
            opcoes={[{ valor: TODOS, rotulo: "Todos" }, ...opcoesDe(d).map((v) => ({ valor: v, rotulo: v }))]}
            aoMudar={(v) => setFiltros((f) => ({ ...f, [d]: v }))}
          />
        ))}
        {filtrosAtivos > 0 && (
          <button
            type="button"
            onClick={() => setFiltros(semFiltros())}
            className="h-9 rounded-md border border-borda px-3 text-[13px] text-tinta-2 hover:bg-superficie-2"
          >
            Limpar filtros
          </button>
        )}
      </LinhaFiltros>

      <Grade colunas={4}>
        <Kpi destaque rotulo="Admissões" valor={fmtCompacto(num(t, "admissoes"))} />
        <Kpi rotulo="Desligamentos" valor={fmtCompacto(num(t, "desligamentos"))} />
        <Kpi rotulo="Saldo" valor={fmtSinal(num(t, "saldo"))} />
        <Kpi rotulo="Salário médio de admissão" valor={fmtReais(num(t, "salario"))} detalhe="R$ nominais" />
      </Grade>

      <Bloco titulo="Análise">
        <div className="flex flex-wrap items-end gap-4">
          <Seletor rotulo="Medir" valor={medida} opcoes={(Object.keys(MEDIDAS) as Medida[]).map((k) => ({ valor: k, rotulo: MEDIDAS[k].rotulo }))} aoMudar={setMedida} />
          <Seletor rotulo="Quebrar por" valor={quebra} opcoes={LISTA.map((d) => ({ valor: d, rotulo: DIMENSOES[d].rotulo }))} aoMudar={setQuebra} />
        </div>
        <CartaoGrafico
          titulo={`${m.rotulo}, ano a ano`}
          subtitulo="CAGED · recorte filtrado"
          opcao={op.anual}
          carregando={anual.carregando}
          erro={anual.erro}
          altura={280}
          tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "valor", rotulo: m.rotulo, formato: m.formato, numero: true }], linhas: anual.linhas }}
        />
        <div className={`grid gap-4 ${ordemQuebra ? "" : "lg:grid-cols-2"}`}>
          <CartaoGrafico
            titulo={`${m.rotulo} por ${DIMENSOES[quebra].rotulo.toLowerCase()}`}
            subtitulo={ordemQuebra ? "Na ordem natural da categoria" : "Do maior para o menor · até 25 categorias"}
            aoClicar={clicarCategoria}
            dicaClique="Clique numa categoria para filtrar por ela"
            opcao={op.categorias}
            carregando={porCategoria.carregando}
            altura={Math.max(260, categorias.length * 26 + 40)}
            tabela={{
              colunas: [
                { chave: "categoria", rotulo: DIMENSOES[quebra].rotulo },
                { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true },
                { chave: "saldo", rotulo: "Saldo", formato: fmtSinal, numero: true },
                { chave: "salario", rotulo: "Salário médio", formato: fmtReais, numero: true },
              ],
              linhas: categorias,
            }}
          />
          {/* Categorias ordenadas (escolaridade, idade) pediriam rampa ordinal,
              não cores categóricas: ficam só no gráfico de barras. */}
          {!ordemQuebra && (
            <CartaoGrafico
              titulo={`Admissões por ${DIMENSOES[quebra].rotulo.toLowerCase()}, ao longo do tempo`}
              subtitulo="As 5 maiores categorias e o restante em “Outros”"
              opcao={op.evolucao}
              carregando={evolucao.carregando}
              altura={Math.max(260, categorias.length * 26 + 40)}
            />
          )}
        </div>
      </Bloco>
    </>
  );
}
