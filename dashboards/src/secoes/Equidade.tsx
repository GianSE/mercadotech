import { useMemo } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, Kpi, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { escapar, fmtDec, fmtNum, fmtPct, fmtReais } from "../lib/formato";
import { opcaoLinhas, opcaoRosca } from "../lib/graficos";
import { useFiltro } from "../lib/filtro";
import { coluna, entre, intervalo, num, rotulos, TI } from "../lib/sql";
import { escreverPeriodo, lerPeriodo, texto, useParametro } from "../lib/url";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2026);
const COMPARACOES = ["Homem vs Mulher", "Branca vs Preta", "Branca vs Parda"];
// Como cada grupo aparece numa frase.
const PLURAL: Record<string, string> = { Homem: "homens", Mulher: "mulheres", Branca: "pessoas brancas", Preta: "pessoas pretas", Parda: "pessoas pardas" };

// A decomposição trabalha com o log do salário. exp(x) − 1 traduz cada parte
// para "quanto a mais, em %": 0,134 vira +14,3%. As duas partes se combinam
// multiplicando (1 − 5,6%) × (1 + 14,3%) ≈ 1 + 7,9%, por isso não somam
// exatamente o hiato total.
const emPct = (log: number) => (Math.exp(log) - 1) * 100;
// Termo de uma conta: "+ 14,3%", "− 5,7%".
const termo = (v: number) => `${v < 0 ? "−" : "+"} ${fmtDec(Math.abs(v), 1)}%`;
const comSinal = (v: number, casas = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmtDec(Math.abs(v), casas)}%`;

// Os três números com nome do que medem: "no salário" (o que se vê),
// "entre pessoas iguais" (o que sobra com o mesmo perfil) e "efeito do
// perfil" (o que vem de os grupos terem perfis diferentes).
const NOMES = { total: "No salário", iguais: "Entre pessoas iguais", perfil: "Efeito do perfil" } as const;

// "Em 2025, homens ganham 7,8% mais que mulheres. Entre pessoas iguais,
// ganham 14,3% mais; mas o perfil, sozinho, faria mulheres ganharem 5,7% mais."
function leitura(ano: number, a: string, b: string, total: number, perfil: number, pagamento: number) {
  const [pa, pb] = [PLURAL[a] ?? a, PLURAL[b] ?? b];
  const quem = total >= 0 ? `${pa} ganham ${fmtDec(Math.abs(total), 1)}% mais que ${pb}` : `${pb} ganham ${fmtDec(Math.abs(total), 1)}% mais que ${pa}`;
  const iguais = `entre pessoas iguais (mesma escolaridade, área, idade, região e porte da empresa), ${pa} ganham ${fmtDec(Math.abs(pagamento), 1)}% ${pagamento >= 0 ? "mais" : "menos"}`;
  const pelo = perfil >= 0
    ? `e o perfil soma mais ${fmtDec(perfil, 1)}% a favor de ${pa}, que estão mais nas posições que pagam melhor`
    : `mas o perfil, sozinho, faria ${pb} ganharem ${fmtDec(Math.abs(perfil), 1)}% mais`;
  return `Em ${ano}, ${quem}. A diferença tem duas partes: ${iguais}, ${pelo}.`;
}

const perfilSql = (dim: string, p: Periodo, territorio: string) => `
  SELECT ${dim} AS categoria, sum(admissoes)::DOUBLE AS admissoes,
         sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
  FROM caged_cubo WHERE ${entre(p)} AND ${territorio} AND ${dim} IS NOT NULL AND ${dim} <> 'Não informado'
  GROUP BY 1 ORDER BY 2 DESC`;

export default function Equidade() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [periodo, setPeriodo] = useParametro<Periodo>("periodo", [2007, 2026], lerPeriodo, escreverPeriodo);
  const [comparacao, setComparacao] = useParametro("comparacao", COMPARACOES[0], (s) => (COMPARACOES.includes(s) ? s : null), texto);

  const sexo = useConsulta(perfilSql("sexo", periodo, f.sql()));
  const raca = useConsulta(perfilSql("raca_cor", periodo, f.sql()));
  const feminina = useConsulta(`
    SELECT ano, 100 * sum(estoque_3112) FILTER (WHERE sexo = 'Mulher') / sum(estoque_3112) FILTER (WHERE sexo IN ('Homem', 'Mulher')) AS mulheres
    FROM rais_estoque_perfil WHERE ${TI} AND ${entre([periodo[0], Math.min(periodo[1], 2025)])} GROUP BY 1 ORDER BY 1`);
  const hiato = useConsulta(`
    SELECT ano, hiato_pct, hiato_log, explicada, nao_explicada, explicada_share, salario_a, salario_b
    FROM hiato_serie WHERE comparacao = '${comparacao}' ORDER BY ano`);
  // O último ano das três comparações, para a resposta do topo da página.
  const ultimo = useConsulta(`
    SELECT comparacao, hiato_pct, explicada, nao_explicada, ano FROM hiato_serie
    WHERE ano = (SELECT max(ano) FROM hiato_serie)`);

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
      // Três linhas em %, e não barras empilhadas em log: a diferença total,
      // a que sobra com o mesmo perfil e a que vem do perfil.
      hiato: h.length
        ? opcaoLinhas(
            c,
            rotulos(h, "ano"),
            [
              { nome: NOMES.total, dados: coluna(h, "hiato_pct"), rotuloFinal: true },
              { nome: NOMES.iguais, dados: h.map((l) => emPct(num(l, "nao_explicada"))), rotuloFinal: true },
              { nome: NOMES.perfil, dados: h.map((l) => emPct(num(l, "explicada"))), rotuloFinal: true, tracejada: true },
            ],
            { formato: (v) => comSinal(v), formatoEixo: (v) => `${fmtDec(v, 0)}%`, zero: true },
          )
        : null,
    };
  }, [s, raca.linhas, fem, h, c]);

  // Resposta do topo: gênero e o maior hiato racial, no último ano.
  const resposta = (() => {
    const u = ultimo.linhas;
    const g = u.find((l) => l.comparacao === "Homem vs Mulher");
    const racas = u.filter((l) => l.comparacao !== "Homem vs Mulher").sort((x, y) => num(y, "hiato_pct") - num(x, "hiato_pct"));
    const r = racas[0];
    if (!g || !r) return undefined;
    const [, rb] = String(r.comparacao).split(" vs ");
    const generoRetorno = num(g, "explicada") < 0;
    return `Em ${num(g, "ano")}, pessoas brancas ganham ${fmtDec(num(r, "hiato_pct"), 0)}% mais que ${PLURAL[rb]}, sobretudo por estarem nas posições que pagam mais; homens ganham ${fmtDec(num(g, "hiato_pct"), 1)}% mais que mulheres${generoRetorno ? ", e entre pessoas iguais a diferença seria ainda maior" : ""}.`;
  })();
  const total = num(hu, "hiato_pct");
  const perfil = emPct(num(hu, "explicada"));
  const pagamento = emPct(num(hu, "nao_explicada"));

  return (
    <>
      <CabecalhoPergunta
        numero={4}
        pergunta="Quem ganha menos, e por quê?"
        resposta={resposta}
      />
      <LinhaFiltros resumo={`${periodo[0]}–${periodo[1]}`}>
        <FiltroPeriodo anos={ANOS} valor={periodo} aoMudar={setPeriodo} />
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

      <Bloco
        titulo="Hiato salarial: o que vem do perfil e o que sobra entre iguais"
        descricao={hu ? leitura(num(hu, "ano"), grupoA, grupoB, total, perfil, pagamento) : undefined}
      >
        <div className="flex flex-wrap items-end gap-4">
          <Seletor rotulo="Comparação" valor={comparacao} opcoes={COMPARACOES.map((v) => ({ valor: v, rotulo: v }))} aoMudar={setComparacao} />
        </div>
        {hu && (
          <Grade colunas={3}>
            <Kpi
              destaque
              ajuda="hiato"
              rotulo={`${NOMES.total} · ${num(hu, "ano")}`}
              valor={comSinal(total)}
              detalhe={`o que ${PLURAL[grupoA]} ganham a mais, em média · era ${comSinal(num(hp, "hiato_pct"))} em ${num(hp, "ano")}`}
            />
            <Kpi
              ajuda="pagamento"
              rotulo={NOMES.iguais}
              valor={comSinal(pagamento)}
              detalhe={`mesma escolaridade, área, idade, região e porte · era ${comSinal(emPct(num(hp, "nao_explicada")))} em ${num(hp, "ano")}`}
            />
            <Kpi
              ajuda="perfil"
              rotulo={NOMES.perfil}
              valor={comSinal(perfil)}
              detalhe={perfil < 0 ? `negativo: o perfil, sozinho, favorece ${PLURAL[grupoB]}` : `o perfil de ${PLURAL[grupoA]} é o de posições que pagam mais`}
            />
          </Grade>
        )}
        <CartaoGrafico
          titulo={`${grupoA} × ${grupoB}`}
          subtitulo={`Quanto ${PLURAL[grupoA]} ganham a mais, em % · decomposição de Oaxaca-Blinder, RAIS`}
          ajuda="pagamento"
          rodape={hu ? `As duas partes se combinam multiplicando, e não somando: (1 ${termo(pagamento)}) × (1 ${termo(perfil)}) ≈ 1 ${termo(total)}, em ${num(hu, "ano")}.` : undefined}
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
              { chave: "hiato_pct", rotulo: `${NOMES.total} (%)`, formato: (v) => fmtPct(v, 1), numero: true },
              { chave: "perfil_pct", rotulo: `${NOMES.perfil} (%)`, formato: (v) => comSinal(Number(v)), numero: true },
              { chave: "pagamento_pct", rotulo: `${NOMES.iguais} (%)`, formato: (v) => comSinal(Number(v)), numero: true },
            ],
            linhas: h.map((l) => ({ ...l, perfil_pct: emPct(num(l, "explicada")), pagamento_pct: emPct(num(l, "nao_explicada")) })),
          }}
        />
      </Bloco>
    </>
  );
}
