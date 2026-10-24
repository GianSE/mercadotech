// A única página com texto: as respostas, a leitura dos números, as
// ressalvas e o método. As páginas de pergunta são painel — só gráficos.
// Tudo aqui é do Brasil inteiro e calculado na hora, como nas páginas: quando
// a série atualiza, o texto acompanha.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CartaoTabela } from "../componentes/Grafico";
import { AvisoNacional, Bloco } from "../componentes/ui";
import { obterManifesto } from "../lib/db";
import { fmtDec, fmtNum, fmtPct, fmtReais, fmtSinal } from "../lib/formato";
import { arcoSaldo, TextoEstoque, TextoLentesEstoque, TextoRemuneracao, TextoSaldo } from "../lib/narrativa";
import { medianaExata, num, ponderada, TI } from "../lib/sql";
import { useConsulta } from "../lib/useConsulta";

const FORA = "Profissional de TI fora do setor de TI";
const DENTRO = "Profissional de TI em empresa de TI";
const ROTULO_FAIXA: Record<string, string> = { "0-6m": "0–6 meses", "6-12m": "6–12 meses", "1-2a": "1–2 anos", "2-3a": "2–3 anos", "3-5a": "3–5 anos", "5-10a": "5–10 anos", "10-20a": "10–20 anos" };

const REPOS = [
  ["bronze-caged", "Bronze", "Microdados do CAGED em Parquet, sem alteração de conteúdo"],
  ["bronze-rais", "Bronze", "Microdados da RAIS em Parquet, sem alteração de conteúdo"],
  ["mte-dicionarios", "Referência", "Planilhas de layout do MTE usadas na tradução dos códigos"],
  ["silver-caged-ti", "Silver", "CAGED traduzido e restrito ao recorte de tecnologia"],
  ["silver-rais-ti", "Silver", "RAIS traduzida e restrita ao recorte de tecnologia"],
  ["gold-analise-mercado-ti", "Gold", "Agregados, cubos do CAGED e resultados dos modelos que este site consome"],
];

function correlacao(x: number[], y: number[]) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function Resposta({ numero, id, pergunta, resposta, children }: { numero: number; id: string; pergunta: string; resposta: string; children: ReactNode }) {
  return (
    <article className="cartao p-5 sm:p-6">
      <p className="sobrelinha">Pergunta {String(numero).padStart(2, "0")}</p>
      <h3 className="mt-1 text-lg font-semibold text-tinta">{pergunta}</h3>
      <p className="mt-2 rounded-xl bg-superficie-2/70 px-4 py-3 text-[15px] font-medium leading-relaxed text-tinta shadow-[inset_3px_0_0_var(--acento)]">{resposta}</p>
      <div className="mt-4 space-y-3 text-[15px] leading-relaxed text-tinta-2 [&_strong]:font-semibold [&_strong]:text-tinta">{children}</div>
      <a href={`#/${id}`} className="mt-4 inline-block text-[14px] font-medium text-serie-1 hover:underline">Ver os gráficos →</a>
    </article>
  );
}

export default function Analise() {
  // ---------------------------------------------------------- pergunta 1
  const estoque = useConsulta(`SELECT ano, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_anual WHERE ${TI} GROUP BY 1 ORDER BY 1`);
  const cagedAnual = useConsulta("SELECT ano, sum(saldo)::DOUBLE AS saldo, sum(admissoes)::DOUBLE AS admissoes FROM caged_cubo GROUP BY 1 ORDER BY 1");
  const referencia = useConsulta("SELECT year(max(mes)) AS ano FROM serie_mensal");
  const arco = useMemo(() => arcoSaldo(cagedAnual.linhas, num(referencia.linhas[0], "ano")), [cagedAnual.linhas, referencia.linhas]);

  // ---------------------------------------------------------- pergunta 2
  // Medianas exatas (rais_mediana): as mesmas das tabelas do TCC.
  const lentesEstoque = useConsulta(`
    SELECT e.categoria, e.estoque, m.mediana
    FROM (SELECT CASE WHEN setor_ti AND ocupacao_ti THEN 'dentro' WHEN ocupacao_ti THEN 'fora' ELSE 'outra' END AS categoria,
                 sum(estoque_3112)::DOUBLE AS estoque
          FROM rais_setor_vs_ocupacao WHERE ano = (SELECT max(ano) FROM rais_setor_vs_ocupacao) GROUP BY 1) e
    JOIN (${medianaExata("lente", "ano = (SELECT max(ano) FROM rais_mediana)")}) m ON m.grupo = e.categoria`);
  const lentesFluxo = useConsulta(`SELECT lente, sum(admissoes)::DOUBLE AS admissoes FROM caged_cubo GROUP BY 1`);
  const sp = useConsulta(`
    SELECT e.ano, e.sp, e.resto, m.m_sp, m.m_resto
    FROM (SELECT ano, sum(estoque_3112) FILTER (WHERE uf = 'SP')::DOUBLE AS sp, sum(estoque_3112) FILTER (WHERE uf <> 'SP')::DOUBLE AS resto
          FROM rais_estoque_uf WHERE ${TI} AND ano IN ((SELECT min(ano) FROM rais_estoque_uf), (SELECT max(ano) FROM rais_estoque_uf)) GROUP BY 1) e
    JOIN (SELECT ano, max(mediana) FILTER (WHERE grupo = 'SP') AS m_sp, max(mediana) FILTER (WHERE grupo = 'Brasil sem SP') AS m_resto
          FROM (${medianaExata("sp")}) GROUP BY 1) m ON m.ano = e.ano
    ORDER BY 1`);
  const clusters = useConsulta("SELECT nome, count(*)::DOUBLE AS n, median(crescimento) * 100 AS cresc FROM municipios_cluster GROUP BY 1 ORDER BY 3 DESC");

  // ---------------------------------------------------------- pergunta 3
  const remuneracao = useConsulta(`
    SELECT a.ano, a.media, m.mediana
    FROM (SELECT ano, ${ponderada("remuneracao_sm")} AS media FROM rais_estoque_anual WHERE ${TI} GROUP BY 1) a
    JOIN (${medianaExata("total")}) m ON m.ano = a.ano
    ORDER BY 1`);
  const risco = useConsulta(`SELECT tempo_de_casa, "risco_%" AS risco, ano FROM sobrevivencia_risco`);

  // ---------------------------------------------------------- pergunta 4
  const sexo = useConsulta(`
    SELECT sexo, sum(admissoes)::DOUBLE AS admissoes, sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
    FROM caged_cubo WHERE sexo IN ('Homem', 'Mulher') GROUP BY 1`);
  const feminina = useConsulta(`
    SELECT ano, 100 * sum(estoque_3112) FILTER (WHERE sexo = 'Mulher') / sum(estoque_3112) FILTER (WHERE sexo IN ('Homem', 'Mulher')) AS mulheres
    FROM rais_estoque_perfil WHERE ${TI} GROUP BY 1 ORDER BY 1`);
  const hiato = useConsulta("SELECT ano, comparacao, hiato_pct, explicada, nao_explicada, explicada_share FROM hiato_serie ORDER BY ano");

  // ---------------------------------------------------------- pergunta 5
  const placar = useConsulta(`SELECT modelo, "ganho_vs_naive_%" AS ganho FROM previsao_placar ORDER BY mae`);
  const pares = useConsulta("SELECT ano, fluxo, delta FROM nowcast_pares ORDER BY ano");
  const retido = useConsulta("SELECT estimador, erro_pct, ano_teste FROM nowcast_ano_retido ORDER BY abs(erro_pct) LIMIT 1");
  const projecao = useConsulta("SELECT * FROM nowcast_projecao");

  // ---------------------------------------------------------- método
  const [arquivos, setArquivos] = useState<{ nome: string; kb: number }[]>([]);
  const [gerado, setGerado] = useState("");
  useEffect(() => {
    obterManifesto().then((m) => {
      setGerado(new Date(m.gerado_em).toLocaleString("pt-BR"));
      setArquivos(Object.entries(m.tabelas).map(([nome, t]) => ({ nome, kb: t.bytes / 1024 })).sort((a, b) => b.kb - a.kb));
    });
  }, []);

  // ---------------------------------------------------------- derivados
  const fora = lentesEstoque.linhas.find((l) => l.categoria === "fora");
  const dentro = lentesEstoque.linhas.find((l) => l.categoria === "dentro");
  const admFora = num(lentesFluxo.linhas.find((l) => l.lente === FORA), "admissoes");
  const admDentro = num(lentesFluxo.linhas.find((l) => l.lente === DENTRO), "admissoes");
  const [sp0, sp1] = [sp.linhas[0], sp.linhas.at(-1)];
  const cresce = (chave: string) => (num(sp1, chave) / num(sp0, chave) - 1) * 100;
  const cresceTotal = ((num(sp1, "sp") + num(sp1, "resto")) / (num(sp0, "sp") + num(sp0, "resto")) - 1) * 100;
  const partSp = (num(sp1, "sp") / (num(sp1, "sp") + num(sp1, "resto"))) * 100;
  const rem = remuneracao.linhas;
  const riscoPico = risco.linhas.reduce<(typeof risco.linhas)[number] | undefined>((m, l) => (!m || num(l, "risco") > num(m, "risco") ? l : m), undefined);
  const homem = sexo.linhas.find((l) => l.sexo === "Homem");
  const mulher = sexo.linhas.find((l) => l.sexo === "Mulher");
  const fem = feminina.linhas;
  const ultimoHiato = (comp: string) => hiato.linhas.filter((l) => l.comparacao === comp).at(-1);
  const primeiroHiato = (comp: string) => hiato.linhas.find((l) => l.comparacao === comp);
  const [hg0, hg1, hr1] = [primeiroHiato("Homem vs Mulher"), ultimoHiato("Homem vs Mulher"), ultimoHiato("Branca vs Preta")];
  const vencedor = placar.linhas[0];
  const corr = (linhas: typeof pares.linhas) =>
    linhas.length > 2 ? correlacao(linhas.map((l) => num(l, "fluxo")), linhas.map((l) => num(l, "delta"))) : NaN;
  const r = corr(pares.linhas);
  // Sem 2022 e 2023: o estoque de 2022 subestimado distorce as duas variações.
  const rSem2022 = corr(pares.linhas.filter((l) => ![2022, 2023].includes(num(l, "ano"))));
  const nc = retido.linhas[0];
  const pr = projecao.linhas[0];
  const totalMb = arquivos.reduce((s, a) => s + a.kb, 0) / 1024;

  return (
    <>
      <AvisoNacional>A análise é sempre do Brasil inteiro; o filtro de território vale para as páginas de gráficos.</AvisoNacional>
      <header className="mb-8">
        <p className="sobrelinha">
          <span className="mr-2 inline-block h-2 w-2 rounded-[2px] bg-acento align-middle" />
          Análise e conclusões
        </p>
        <h1 className="mt-2 text-[1.6rem] font-semibold leading-tight tracking-tight text-tinta sm:text-3xl">O que os dados mostram</h1>
      </header>

      <Bloco titulo="As cinco respostas">
        <Resposta numero={1} id="crescimento" pergunta="Quanto o mercado cresceu, e em que ritmo?" resposta="Cresceu muito, com o salto concentrado em 2021–22 — e o ritmo agora desacelera.">
          {estoque.linhas.length > 1 && <TextoEstoque anual={estoque.linhas} />}
          {arco && <TextoSaldo a={arco} />}
          <p>
            O vale do estoque em 2022 nos gráficos é defeito do dado, não do mercado: parte dos arquivos daquele ano não chegou à camada tratada. A
            correção foi feita e reprocessada; enquanto a Gold publicada não a incorporar, 2022 aparece subestimado.
          </p>
        </Resposta>

        <Resposta numero={2} id="onde" pergunta="Onde está o trabalho de TI: em que empresas e em que lugares?" resposta="A maior parte dos profissionais de TI está fora das empresas de TI, e o interior cresce mais rápido que as capitais.">
          <TextoLentesEstoque fora={fora} dentro={dentro} />
          {admFora > 0 && (
            <p>
              No fluxo, <strong>{fmtPct((admFora / (admFora + admDentro)) * 100, 0)} das admissões de profissionais de TI</strong> foram feitas por
              empresas que não são de tecnologia — comércio, serviços administrativos, indústria, educação, finanças. Uma análise que olhasse só o CNAE de TI não
              veria esse contingente.
            </p>
          )}
          {sp1 && (
            <p>
              São Paulo concentra <strong>{fmtPct(partSp, 1)} do estoque</strong>. Não é um valor anômalo a descartar — é o maior mercado do país —,
              mas pesa o bastante para testar se as conclusões dependem dele. Entre {num(sp0, "ano")} e {num(sp1, "ano")}, o estoque cresceu{" "}
              {fmtDec(cresce("sp"), 0)}% em SP e <strong>{fmtDec(cresce("resto"), 0)}% no resto do país</strong>, contra {fmtDec(cresceTotal, 0)}% no total:
              a conclusão de crescimento não depende de SP. A remuneração, sim: a mediana paulista foi de {fmtDec(num(sp0, "m_sp"), 2)} para{" "}
              {fmtDec(num(sp1, "m_sp"), 2)} salários mínimos, enquanto a do resto do país caiu de {fmtDec(num(sp0, "m_resto"), 2)} para{" "}
              {fmtDec(num(sp1, "m_resto"), 2)}. A estabilidade nacional é a soma de dois movimentos opostos.
            </p>
          )}
          {clusters.linhas.length > 0 && (
            <p>
              Ordenar municípios por estoque devolve sempre as cidades grandes. O agrupamento por <em>k</em>-médias — sobre o estoque em escala log, a
              especialização e o crescimento, com <em>k</em> escolhido por silhueta — separa{" "}
              {clusters.linhas.map((l, i) => (
                <span key={String(l.nome)}>
                  {i > 0 && (i === clusters.linhas.length - 1 ? " e " : ", ")}
                  <strong>{String(l.nome).toLowerCase()}</strong> ({fmtNum(l.n)} municípios, crescimento mediano de {fmtPct(num(l, "cresc"), 0)})
                </span>
              ))}
              . A escala log é o que impede São Paulo de definir os grupos sozinho; os grupos são calculados com o país inteiro, e o filtro de território só
              escolhe quais municípios aparecem.
            </p>
          )}
          <p>
            A localização é a do estabelecimento, não a do trabalho: a empresa escolhe onde se registrar por causa do ISS (Barueri aparece com 200
            vínculos de TI por mil habitantes), e o trabalho remoto agrava a distorção.
          </p>
        </Resposta>

        <Resposta numero={3} id="qualidade" pergunta="O emprego de TI melhorou em qualidade?" resposta="Não em remuneração relativa: o salário medido em salários mínimos está praticamente parado, e o risco de desligamento se concentra no primeiro ano.">
          {rem.length > 1 && <TextoRemuneracao u={rem.at(-1)!} inicio={num(rem[0], "ano")} />}
          <p>
            A partir de 2023 a fonte traz registros com a conversão para salário mínimo invertida (multiplicada em vez de dividida). Eles foram
            descartados por um teto de 500 salários mínimos; sem o corte, a média saltaria de 6,17 para 8,84 SM entre 2022 e 2023 — uma valorização de
            43% que não aconteceu.
          </p>
          {riscoPico && (
            <p>
              O risco anual de desligamento tem pico em <strong>{ROTULO_FAIXA[String(riscoPico.tempo_de_casa)]}</strong> de casa (
              {fmtPct(num(riscoPico, "risco"), 1)} ao ano) e cai com a duração do vínculo. É uma tábua de vida de período ({num(riscoPico, "ano")}): as taxas
              de um ano só, como numa tábua demográfica — descreve o risco vigente, não a trajetória de quem entrou num ano específico. O modelo de
              risco usado é de tempo discreto, e não Cox: num corte transversal, o Cox suporia que quem tem dez anos de casa estava em risco aos doze
              meses no ano observado, o que não é verdade.
            </p>
          )}
        </Resposta>

        <Resposta numero={4} id="equidade" pergunta="Quem ganha menos, e por quê?" resposta="Mulheres e pessoas negras, por mecanismos diferentes: a diferença por gênero é de retorno; a por raça é sobretudo de acesso.">
          {homem && mulher && (
            <p>
              Mulheres são <strong>{fmtPct((num(mulher, "admissoes") / (num(mulher, "admissoes") + num(homem, "admissoes"))) * 100, 0)} das admissões</strong> em
              tecnologia, com salário médio de admissão {fmtPct((1 - num(mulher, "salario") / num(homem, "salario")) * 100, 0)} menor que o dos homens (
              {fmtReais(mulher.salario)} contra {fmtReais(homem.salario)}, valores nominais). A diferença é bruta: dimensiona, não atribui causa.
            </p>
          )}
          {fem.length > 1 && (
            <p>
              A participação feminina no estoque foi de {fmtPct(num(fem[0], "mulheres"), 1)} em {num(fem[0], "ano")} para{" "}
              <strong>{fmtPct(num(fem.at(-1), "mulheres"), 1)} em {num(fem.at(-1), "ano")}</strong>: o mercado cresceu sem ficar mais feminino.
            </p>
          )}
          {hg1 && (
            <p>
              Pela decomposição de Oaxaca-Blinder, o hiato salarial de gênero caiu de {fmtPct(num(hg0, "hiato_pct"), 1)} para{" "}
              <strong>{fmtPct(num(hg1, "hiato_pct"), 1)}</strong>, e a parte explicada por características é{" "}
              {num(hg1, "explicada") < 0 ? <strong>negativa</strong> : "positiva"}
              {num(hg1, "explicada") < 0
                ? ": as mulheres em tecnologia têm características que deveriam fazê-las ganhar mais (escolaridade, empresas maiores, áreas mais bem pagas). O hiato bruto subestima a diferença de retorno."
                : "."}
              {hr1 && (
                <>
                  {" "}No hiato entre pessoas brancas e pretas, <strong>{fmtPct(num(hr1, "explicada_share"), 0)}</strong> vem de diferença de características —
                  onde se trabalha, em quê, com qual formação: é sobretudo acesso.
                </>
              )}{" "}
              A parte não explicada não é medida de discriminação: contém tudo que afeta salário e não está no modelo. É o limite superior da diferença
              de retorno, não a sua causa.
            </p>
          )}
        </Resposta>

        <Resposta numero={5} id="futuro" pergunta="Para onde o mercado vai?" resposta="Para crescimento modesto e positivo, com intervalo declarado. Estimar o presente é bem mais preciso que prever o futuro.">
          {vencedor && (
            <p>
              A previsão do saldo mensal usa o SARIMA escolhido por validação de origem móvel (treina até um ponto, prevê 12 meses, avança, repete).
              O vencedor erra <strong>{fmtPct(num(vencedor, "ganho"), 1)} menos</strong> que a regra ingênua “igual ao mesmo mês do ano passado” — a
              comparação certa para uma série com sazonalidade forte. A faixa de 80% é larga e cruza o zero adiante de um ano: o número certo é a faixa,
              não o ponto.
            </p>
          )}
          {Number.isFinite(r) && (
            <p>
              {r >= 0.7 ? (
                <>O saldo acumulado do CAGED acompanha de perto a variação do estoque da RAIS (correlação de <strong>{fmtDec(r, 2)}</strong>).</>
              ) : (
                <>
                  A correlação entre o saldo acumulado do CAGED e a variação do estoque da RAIS é de {fmtDec(r, 2)} nesta versão dos dados: o estoque de
                  2022 subestimado (pergunta 1) distorce as variações de 2022 e 2023. Sem esses dois anos, ela é de <strong>{fmtDec(rSem2022, 2)}</strong>.
                </>
              )}{" "}
              É essa relação que permite o <em>nowcast</em>: estimar a RAIS do ano corrente, que o MTE só publica cerca de um ano depois, a partir do
              último estoque e do fluxo já publicado.
              {nc && (
                <>
                  {" "}Com {num(nc, "ano_teste")} retido do ajuste, o melhor estimador errou <strong>{fmtPct(Math.abs(num(nc, "erro_pct")), 2)}</strong>.
                </>
              )}
            </p>
          )}
          {pr && (
            <p>
              Para {num(pr, "ano")}, a estimativa é de {fmtNum(num(pr, "estoque_estimado"))} vínculos, ± {fmtNum(num(pr, "margem"))}, com{" "}
              {fmtSinal(num(pr, "fluxo_observado"))} vagas já observadas em {num(pr, "meses_observados")} meses. A margem soma em quadratura duas
              incertezas — o fluxo previsto e a relação fluxo→estoque — e é ordem de grandeza, não intervalo exato. Quando o MTE publicar a RAIS de{" "}
              {num(pr, "ano")}, a projeção vira validação.
            </p>
          )}
        </Resposta>
      </Bloco>

      <Bloco titulo="O que estes dados não permitem afirmar">
        <ul className="grid gap-3 text-[15px] leading-relaxed text-tinta-2 md:grid-cols-2 [&_strong]:text-tinta">
          <li className="cartao p-4"><strong>Só o mercado formal.</strong> RAIS e CAGED não veem PJ, autônomos nem informais — relevante num setor em que a contratação como pessoa jurídica é comum.</li>
          <li className="cartao p-4"><strong>Lugar do estabelecimento, não do trabalho.</strong> A coluna da RAIS que resolveria (<code className="font-mono text-[13px]">mun_trab</code>) vem como “não informado” em praticamente todos os registros.</li>
          <li className="cartao p-4"><strong>Salário do CAGED é nominal.</strong> A RAIS é lida em salários mínimos justamente para comparar 2007 com 2025 sem escolher deflator.</li>
          <li className="cartao p-4"><strong>Mediana com filtro, por faixas.</strong> Mediana não se soma: com filtro de território, ela sai da distribuição dos salários em faixas de 0,1 SM dos estados escolhidos, com erro máximo de 0,05 SM. Sem filtro, é a mediana exata.</li>
        </ul>
      </Bloco>

      <Bloco titulo="Método e dados">
        <div className="grid gap-4 text-[15px] leading-relaxed text-tinta-2 lg:grid-cols-2 [&_strong]:text-tinta">
          <div className="space-y-3">
            <p><strong>Fontes.</strong> Microdados da RAIS (2007–2025) e do CAGED (2007 até o último mês publicado), do servidor público do PDET/MTE. A RAIS fotografa os vínculos ativos em 31 de dezembro; o CAGED registra cada admissão e desligamento.</p>
            <p><strong>Tradução.</strong> Cada coluna codificada é traduzida pelos dicionários oficiais do MTE, extraídos das planilhas de layout, com a procedência de cada linha. O código original fica ao lado da descrição.</p>
            <p><strong>Recorte.</strong> União de duas lentes, preservadas como rótulos em cada registro: <em>setor de TI</em> (CNAE) e <em>ocupação de TI</em> (CBO, em qualquer setor). O recorte é por família de código, nunca por palavra-chave.</p>
          </div>
          <div className="space-y-3">
            <p><strong>Arquitetura.</strong> Bronze → Silver de TI → Gold, executada em nuvem: o <em>data lake</em> são repositórios públicos do Hugging Face, e o processamento roda em <em>workflows</em> do GitHub Actions encadeados por dependência, que verificam o servidor do MTE toda semana e reprocessam só o que mudou.</p>
            <p><strong>Este site.</strong> Estático, no Cloudflare Pages. A Gold vai junto do site, e o DuckDB-WASM a consulta no seu navegador: nenhum servidor recebe as suas consultas.</p>
          </div>
        </div>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {REPOS.map(([repo, camada, descricao]) => (
            <li key={repo}>
              <a href={`https://huggingface.co/datasets/Gianpedro/${repo}`} target="_blank" rel="noreferrer" className="block h-full rounded-xl border border-borda bg-superficie p-4 hover:border-acento">
                <span className="sobrelinha">{camada}</span>
                <span className="mt-1 block font-mono text-[14px] text-tinta">{repo}</span>
                <span className="mt-1 block text-[13px] text-tinta-3">{descricao}</span>
              </a>
            </li>
          ))}
        </ul>
        <CartaoTabela
          titulo="Tabelas carregadas por este site"
          subtitulo={gerado ? `Geradas em ${gerado} · ${fmtDec(totalMb, 1)} MB` : undefined}
          tabela={{
            colunas: [
              { chave: "nome", rotulo: "Tabela", formato: (v) => String(v) },
              { chave: "kb", rotulo: "Tamanho", formato: (v) => (Number(v) >= 1024 ? `${fmtDec(Number(v) / 1024, 1)} MB` : `${fmtDec(v, 0)} kB`), numero: true },
            ],
            linhas: arquivos,
          }}
        />
      </Bloco>
    </>
  );
}
