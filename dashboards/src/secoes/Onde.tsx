import { useEffect, useMemo, useState } from "react";
import { CartaoGrafico, CartaoTabela, registrarMapaBR, type Clique } from "../componentes/Grafico";
import { Aviso, Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, Kpi, Leitura, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { UFS, useFiltro } from "../lib/filtro";
import { escapar, fmtCompacto, fmtDec, fmtMunicipio, fmtNum, fmtPct, fmtReais, fmtSinal, fmtSM } from "../lib/formato";
import { opcaoBarras, opcaoDispersao, opcaoLinhas, opcaoMapa, opcaoMosaico, opcaoRosca } from "../lib/graficos";
import { TextoLentesEstoque } from "../lib/narrativa";
import { coluna, entre, intervalo, literal, num, ponderada, rotulos } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2026);
const FORA = "Profissional de TI fora do setor de TI";
const DENTRO = "Profissional de TI em empresa de TI";
const LENTES = [DENTRO, FORA, "Outra ocupação em empresa de TI"];
const LENTE_RAIS = `CASE WHEN setor_ti AND ocupacao_ti THEN '${DENTRO}' WHEN ocupacao_ti THEN '${FORA}' ELSE 'Outra ocupação em empresa de TI' END`;
// A Gold traz uma linha de UF corrompida no mapa; só siglas válidas entram.
const UF_VALIDA = `uf IN (${UFS.map(literal).join(", ")})`;

const METRICAS = {
  estoque: { rotulo: "Estoque (RAIS)", formato: fmtCompacto, divergente: false },
  saldo: { rotulo: "Saldo do ano (CAGED)", formato: fmtSinal, divergente: true },
  remuneracao_sm_mediana: { rotulo: "Remuneração mediana (SM)", formato: fmtSM, divergente: false },
} as const;
type Metrica = keyof typeof METRICAS;

const GRUPOS = ["Polo maduro", "Emergente", "Mercado incipiente"];

const ordenarLentes = <T extends { categoria?: unknown }>(l: T[]) =>
  [...l].sort((a, b) => LENTES.indexOf(String(a.categoria)) - LENTES.indexOf(String(b.categoria)));

// O clique numa bolha de município traz "Nome (UF)": filtra pela UF dele.
const ufDoClique = ({ nome }: Clique) => (UFS.includes(nome) ? nome : nome.match(/\(([A-Z]{2})\)$/)?.[1] ?? null);

export default function Onde() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [periodo, setPeriodo] = useState<Periodo>([2020, 2026]);
  const anoRais = Math.min(periodo[1], 2025);

  const lentesFluxo = useConsulta(`
    SELECT lente AS categoria, sum(admissoes)::DOUBLE AS admissoes, sum(saldo)::DOUBLE AS saldo,
           sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
    FROM caged_cubo WHERE ${entre(periodo)} AND ${f.sql()} GROUP BY 1`);
  // Sem filtro, a tabela do cruzamento setor × ocupação (a do TCC); com
  // filtro, a mesma conta sobre o estoque por UF, que tem as duas marcações.
  const lentesEstoque = useConsulta(`
    SELECT ${LENTE_RAIS} AS categoria, sum(estoque_3112)::DOUBLE AS estoque, ${ponderada("remuneracao_sm_mediana")} AS mediana
    FROM ${f.ativo ? "rais_estoque_uf" : "rais_setor_vs_ocupacao"} WHERE ano = ${anoRais} AND ${f.sql()} GROUP BY 1`);
  const quemContrata = useConsulta(`
    SELECT setor, sum(admissoes)::DOUBLE AS admissoes, sum(saldo)::DOUBLE AS saldo,
           sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
    FROM caged_cubo WHERE lente = '${FORA}' AND setor IS NOT NULL AND ${entre(periodo)} AND ${f.sql()}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);

  const fluxo = ordenarLentes(lentesFluxo.linhas);
  const estoque = ordenarLentes(lentesEstoque.linhas);
  const admFora = num(fluxo.find((l) => l.categoria === FORA), "admissoes");
  const admDentro = num(fluxo.find((l) => l.categoria === DENTRO), "admissoes");

  const op = useMemo(() => {
    const salarioExtra = (linhas: typeof fluxo) => (i: number) =>
      linhas[i]?.salario ? `<div style="margin-top:3px;opacity:.85">Salário médio de admissão: <strong>${escapar(fmtReais(linhas[i].salario))}</strong></div>` : "";
    return {
      lentesFluxo: fluxo.length
        ? opcaoRosca(c, fluxo.map((l) => ({ nome: String(l.categoria), valor: num(l, "admissoes") })), { centro: "admissões", extraTooltip: salarioExtra(fluxo) })
        : null,
      lentesEstoque: estoque.length
        ? opcaoRosca(c, estoque.map((l) => ({ nome: String(l.categoria), valor: num(l, "estoque") })), {
            centro: "vínculos ativos",
            extraTooltip: (i) => `<div style="margin-top:3px;opacity:.85">Mediana: <strong>${escapar(fmtSM(estoque[i]?.mediana))}</strong></div>`,
          })
        : null,
      quemContrata: quemContrata.linhas.length
        ? opcaoMosaico(c, quemContrata.linhas.map((l) => ({ nome: String(l.setor), valor: num(l, "admissoes") })), { extraTooltip: salarioExtra(quemContrata.linhas) })
        : null,
    };
  }, [fluxo, estoque, quemContrata.linhas, c]);

  return (
    <>
      <CabecalhoPergunta
        numero={2}
        pergunta="Onde está o trabalho de TI: em que empresas e em que lugares?"
        resposta="A maior parte dos profissionais de TI está fora das empresas de TI, e o interior cresce mais rápido que as capitais."
      />
      <LinhaFiltros
        resumo={`${periodo[0]}–${periodo[1]} · RAIS ${anoRais}`}
        nota={`O período vale para o CAGED (fluxo); a RAIS (estoque) usa o último ano coberto por ela: ${anoRais}. O mapa tem seu próprio ano. Clicar num estado do mapa ou do ranking também filtra.`}
      >
        <FiltroPeriodo
          anos={ANOS}
          valor={periodo}
          aoMudar={setPeriodo}
          atalhos={[
            { rotulo: "Novo CAGED", periodo: [2020, 2026] },
            { rotulo: "Tudo", periodo: [2007, 2026] },
            { rotulo: "Último ano", periodo: [2025, 2025] },
          ]}
        />
      </LinhaFiltros>

      <Bloco
        titulo="Setor de TI ou ocupação de TI?"
        descricao="O recorte une duas definições que descrevem populações diferentes: quem trabalha em empresa de tecnologia (CNAE) e quem exerce ocupação de tecnologia (CBO), em qualquer setor."
      >
        <Grade>
          <CartaoGrafico
            titulo={`Admissões, pelas duas lentes · ${f.rotulo}`}
            subtitulo={`CAGED · ${periodo[0]}–${periodo[1]} · passe o mouse para o salário médio`}
            opcao={op.lentesFluxo}
            carregando={lentesFluxo.carregando}
            erro={lentesFluxo.erro}
            altura={200}
            tabela={{
              colunas: [
                { chave: "categoria", rotulo: "Categoria" },
                { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true },
                { chave: "saldo", rotulo: "Saldo", formato: fmtSinal, numero: true },
                { chave: "salario", rotulo: "Salário médio", formato: fmtReais, numero: true },
              ],
              linhas: fluxo,
            }}
          />
          <CartaoGrafico
            titulo={`Vínculos ativos, pelas duas lentes · ${f.rotulo}`}
            subtitulo={`RAIS · estoque em 31/12/${anoRais}`}
            opcao={op.lentesEstoque}
            carregando={lentesEstoque.carregando}
            erro={lentesEstoque.erro}
            altura={200}
            tabela={{
              colunas: [
                { chave: "categoria", rotulo: "Categoria" },
                { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true },
                { chave: "mediana", rotulo: "Mediana", formato: fmtSM, numero: true },
              ],
              linhas: estoque,
            }}
          />
        </Grade>
        <Leitura>
          {admFora > 0 && (
            <p>
              No fluxo, <strong>{fmtPct((admFora / (admFora + admDentro)) * 100, 0)} das admissões de profissionais de TI</strong> foram feitas
              por empresas que não são de tecnologia ({fmtNum(admFora)} de {fmtNum(admFora + admDentro)}).
            </p>
          )}
          <TextoLentesEstoque fora={estoque.find((l) => l.categoria === FORA)} dentro={estoque.find((l) => l.categoria === DENTRO)} />
        </Leitura>
        <CartaoGrafico
          titulo="Quem mais contrata profissionais de TI fora do setor"
          subtitulo={`CAGED · admissões em ocupações de TI por setor da empresa · ${periodo[0]}–${periodo[1]} · ${f.rotulo}`}
          opcao={op.quemContrata}
          carregando={quemContrata.carregando}
          altura={380}
          tabela={{
            colunas: [
              { chave: "setor", rotulo: "Setor da empresa" },
              { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true },
              { chave: "saldo", rotulo: "Saldo", formato: fmtSinal, numero: true },
              { chave: "salario", rotulo: "Salário médio", formato: fmtReais, numero: true },
            ],
            linhas: quemContrata.linhas,
          }}
          rodape="Nenhum desses empregadores é empresa de tecnologia — uma análise que olhasse só o CNAE de TI não veria esse contingente."
        />
      </Bloco>

      <Mapa />
      <SaoPaulo periodo={periodo} />
      <Clusters />
    </>
  );
}

function Mapa() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [ano, setAno] = useState(2025);
  const [metrica, setMetrica] = useState<Metrica>("estoque");
  const [minimo, setMinimo] = useState(50);
  const [mapaPronto, setMapaPronto] = useState(false);

  useEffect(() => {
    registrarMapaBR().then(() => setMapaPronto(true));
  }, []);

  // O mapa mostra sempre o país inteiro — o filtro apaga os demais estados em
  // vez de tirá-los, para o recorte continuar com contexto.
  const uf = useConsulta(`SELECT uf, estoque::DOUBLE AS estoque, saldo::DOUBLE AS saldo, remuneracao_sm_mediana FROM mapa_uf WHERE ano = ${ano} AND ${UF_VALIDA}`);
  const muni = useConsulta(`
    SELECT g.nome AS municipio, m.uf, m.estoque::DOUBLE AS estoque, m.saldo::DOUBLE AS saldo, m.remuneracao_sm_mediana,
           g.longitude AS lon, g.latitude AS lat
    FROM mapa_municipio m JOIN geo_municipios g ON g.cod6 = m.cod_municipio
    WHERE m.ano = ${ano} AND m.estoque >= ${minimo}`);

  const m = METRICAS[metrica];
  const linhasUf = uf.linhas;
  const selecionadas = f.ativo ? linhasUf.filter((l) => f.ufs.includes(String(l.uf))) : linhasUf;
  const totalPais = linhasUf.reduce((s, l) => s + num(l, "estoque"), 0);
  const totalSel = selecionadas.reduce((s, l) => s + num(l, "estoque"), 0);
  const saldoSel = selecionadas.reduce((s, l) => s + num(l, "saldo"), 0);
  const comEstoque = selecionadas.filter((l) => num(l, "estoque") > 0).map((l) => ({ uf: String(l.uf), intensidade: num(l, "saldo") / num(l, "estoque") }));
  const ordenadas = [...comEstoque].sort((a, b) => b.intensidade - a.intensidade);
  const ranking = useMemo(() => [...linhasUf].sort((a, b) => num(b, "estoque") - num(a, "estoque")), [linhasUf]);

  const opMapa = useMemo(() => {
    if (!mapaPronto || !linhasUf.length) return null;
    return opcaoMapa(
      c,
      linhasUf.map((l) => ({ uf: String(l.uf), valor: num(l, metrica) })),
      muni.linhas.map((l) => ({ nome: `${String(l.municipio)} (${String(l.uf)})`, uf: String(l.uf), lon: num(l, "lon"), lat: num(l, "lat"), valor: num(l, metrica), tamanho: num(l, "estoque") })),
      { formato: (v) => m.formato(v), divergente: m.divergente, rotulo: m.rotulo, formatoBolha: fmtNum, destacar: f.ufs },
    );
  }, [mapaPronto, linhasUf, muni.linhas, metrica, m, f.ufs, c]);

  const opRanking = useMemo(() => {
    if (!ranking.length) return null;
    const esmaecer = f.ativo ? ranking.map((l, i) => (f.ufs.includes(String(l.uf)) ? -1 : i)).filter((i) => i >= 0) : [];
    return opcaoBarras(c, rotulos(ranking, "uf"), coluna(ranking, "estoque"), { horizontal: true, nome: "Vínculos", formato: fmtNum, larguraRotulo: 40, esmaecer });
  }, [ranking, f.ativo, f.ufs, c]);

  const clicar = (cl: Clique) => {
    const sigla = ufDoClique(cl);
    if (sigla) f.alternar(sigla);
  };

  return (
    <Bloco titulo="O mapa: estoque e movimento no mesmo lugar" descricao="A cor do estado mostra a métrica escolhida; as bolhas são municípios, do tamanho do estoque. Clique num estado (ou numa barra do ranking) para recortar o site inteiro por ele; clique de novo para desfazer.">
      <div className="flex flex-wrap items-end gap-4">
        <Seletor rotulo="Ano" valor={ano} opcoes={intervalo(2007, 2026).map((a) => ({ valor: a, rotulo: String(a) }))} aoMudar={setAno} />
        <Seletor rotulo="Colorir por" valor={metrica} opcoes={(Object.keys(METRICAS) as Metrica[]).map((k) => ({ valor: k, rotulo: METRICAS[k].rotulo }))} aoMudar={setMetrica} />
        <Seletor rotulo="Município a partir de" valor={minimo} opcoes={[10, 50, 200, 1000, 5000].map((v) => ({ valor: v, rotulo: `${fmtNum(v)} vínculos` }))} aoMudar={setMinimo} />
      </div>
      <Grade colunas={3}>
        <Kpi
          destaque
          rotulo={`Estoque · ${f.rotulo}`}
          valor={totalSel ? fmtCompacto(totalSel) : "—"}
          detalhe={!totalPais ? `a RAIS de ${ano} ainda não saiu` : f.ativo ? `${fmtPct((totalSel / totalPais) * 100, 1)} do país` : `RAIS, ${ano}`}
        />
        <Kpi rotulo={`Saldo do ano · ${f.rotulo}`} valor={fmtSinal(saldoSel)} detalhe={`CAGED, ${ano}`} />
        <Kpi rotulo="Estados com saldo positivo" valor={`${selecionadas.filter((l) => num(l, "saldo") > 0).length} de ${selecionadas.length}`} />
      </Grade>
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <CartaoGrafico
          titulo={`O mercado de TI no Brasil — ${ano}`}
          subtitulo={`${m.rotulo} por estado · ${fmtNum(muni.linhas.length)} municípios acima do mínimo`}
          dicaClique="Clique num estado para filtrar"
          aoClicar={clicar}
          opcao={opMapa}
          carregando={uf.carregando || muni.carregando || !mapaPronto}
          erro={uf.erro || muni.erro}
          altura={520}
          tabela={{
            colunas: [
              { chave: "uf", rotulo: "UF" },
              { chave: "estoque", rotulo: "Estoque", formato: fmtNum, numero: true },
              { chave: "saldo", rotulo: "Saldo", formato: fmtSinal, numero: true },
              { chave: "remuneracao_sm_mediana", rotulo: "Mediana", formato: fmtSM, numero: true },
            ],
            linhas: ranking,
          }}
        />
        <CartaoGrafico
          titulo="Estados por estoque"
          subtitulo={`RAIS · vínculos ativos, ${ano}`}
          dicaClique="Clique numa barra para filtrar"
          aoClicar={clicar}
          opcao={totalPais ? opRanking : null}
          altura={Math.max(520, ranking.length * 19)}
          tabela={{ colunas: [{ chave: "uf", rotulo: "UF" }, { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: ranking }}
        />
      </div>
      {ordenadas.length > 5 && (
        <Leitura>
          <p>
            Em {ano}, o maior movimento em relação ao próprio tamanho foi em <strong>{ordenadas.slice(0, 3).map((o) => o.uf).join(", ")}</strong>, e o
            menor em <strong>{ordenadas.slice(-3).reverse().map((o) => o.uf).join(", ")}</strong>. Nenhuma das duas bases sozinha mostra isso: o
            estoque diz o tamanho, o fluxo diz a direção.
          </p>
        </Leitura>
      )}
      <Aviso titulo="A localização é a do estabelecimento, não a do trabalho">
        A empresa de TI escolhe onde se registrar por causa do ISS, e isso desloca o mapa: Barueri aparece com 200 vínculos de TI por mil
        habitantes, e Guaraciaba (MG), com 10 mil habitantes, saiu de 1 vínculo em 2022 para 1.428 em 2023. A coluna da RAIS que resolveria
        (<code className="font-mono text-[12px]">mun_trab</code>) vem como “não informado” em praticamente todos os registros.
      </Aviso>
    </Bloco>
  );
}

// São Paulo tem ~40% do estoque: o bloco mede se as conclusões dependem dele,
// comparando SP com o resto do país. Não usa o filtro de território — a
// comparação é sempre a mesma.
function SaoPaulo({ periodo }: { periodo: Periodo }) {
  const { cores: c } = useTema();
  const fim = Math.min(periodo[1], 2025);
  const inicio = Math.min(periodo[0], fim);
  const serie = useConsulta(`
    SELECT ano,
           sum(estoque_3112) FILTER (WHERE uf = 'SP')::DOUBLE  AS sp,
           sum(estoque_3112) FILTER (WHERE uf <> 'SP')::DOUBLE AS resto,
           sum(estoque_3112 * remuneracao_sm_mediana) FILTER (WHERE uf = 'SP') / sum(estoque_3112) FILTER (WHERE uf = 'SP')   AS mediana_sp,
           sum(estoque_3112 * remuneracao_sm_mediana) FILTER (WHERE uf <> 'SP') / sum(estoque_3112) FILTER (WHERE uf <> 'SP') AS mediana_resto
    FROM rais_estoque_uf WHERE (setor_ti OR ocupacao_ti) AND ano BETWEEN ${inicio} AND ${fim} GROUP BY 1 ORDER BY 1`);
  const saldo = useConsulta(`
    SELECT sum(saldo) FILTER (WHERE uf = 'SP')::DOUBLE AS sp, sum(saldo)::DOUBLE AS total
    FROM caged_cubo WHERE ${entre(periodo)} AND uf IS NOT NULL`);

  const s = serie.linhas;
  const [p, u] = [s[0], s.at(-1)];
  const cresce = (chave: string) => (num(u, chave) / num(p, chave) - 1) * 100;
  const cresceTotal = ((num(u, "sp") + num(u, "resto")) / (num(p, "sp") + num(p, "resto")) - 1) * 100;
  const participacao = (l: (typeof s)[number] | undefined) => (num(l, "sp") / (num(l, "sp") + num(l, "resto"))) * 100;
  const com2022 = s.some((l) => num(l, "ano") === 2022);
  const saldoSp = num(saldo.linhas[0], "sp");
  const saldoTotal = num(saldo.linhas[0], "total");

  const op = useMemo(() => {
    if (s.length < 2) return { indice: null, mediana: null, participacao: null };
    const anos = rotulos(s, "ano");
    const base = (chave: string) => s.map((l) => (num(l, chave) / num(p, chave)) * 100);
    return {
      participacao: opcaoLinhas(c, anos, [{ nome: "Participação de SP", dados: s.map(participacao), rotuloFinal: true }], { formato: (v) => fmtPct(v, 1), formatoEixo: (v) => fmtPct(v, 0) }),
      indice: opcaoLinhas(
        c,
        anos,
        [
          { nome: "São Paulo", dados: base("sp"), rotuloFinal: true },
          { nome: "Brasil sem SP", dados: base("resto"), rotuloFinal: true },
        ],
        { formato: (v) => fmtDec(v, 0), formatoEixo: (v) => fmtDec(v, 0) },
      ),
      mediana: opcaoLinhas(
        c,
        anos,
        [
          { nome: "São Paulo", dados: coluna(s, "mediana_sp"), rotuloFinal: true },
          { nome: "Brasil sem SP", dados: coluna(s, "mediana_resto"), rotuloFinal: true },
        ],
        { formato: fmtSM, formatoEixo: (v) => fmtDec(v, 1), zero: true },
      ),
    };
  }, [s, p, c]);

  const nota2022 = com2022
    ? "2022 está subestimado: a camada publicada ainda não tem a correção da ingestão parcial desse ano, que afetou sobretudo o arquivo do Sudeste. O vale de SP em 2022 é defeito do dado, não do mercado."
    : undefined;

  return (
    <Bloco
      titulo="São Paulo e o resto do país"
      descricao="São Paulo concentra cerca de 40% do estoque. Não é um valor anômalo a descartar — é o maior mercado do país —, mas pesa tanto que vale perguntar: as conclusões mudam sem ele? Este bloco compara SP com o Brasil sem SP e não segue o filtro de território."
    >
      {s.length > 1 && (
        <Grade colunas={3}>
          <Kpi destaque rotulo={`Participação de SP no estoque (${num(u, "ano")})`} valor={fmtPct(participacao(u), 1)} detalhe={`era ${fmtPct(participacao(p), 1)} em ${num(p, "ano")}`} />
          <Kpi
            rotulo={`Crescimento ${num(p, "ano")}–${num(u, "ano")}`}
            valor={`${fmtDec(cresce("sp"), 0)}% × ${fmtDec(cresce("resto"), 0)}%`}
            detalhe={`SP × Brasil sem SP · Brasil: ${fmtDec(cresceTotal, 0)}%`}
          />
          <Kpi rotulo={`Mediana em ${num(u, "ano")}`} valor={`${fmtDec(num(u, "mediana_sp"), 2)} × ${fmtDec(num(u, "mediana_resto"), 2)} SM`} detalhe="SP × Brasil sem SP" />
        </Grade>
      )}
      <Grade>
        <CartaoGrafico
          titulo="Quem cresceu mais"
          subtitulo={`RAIS · estoque, índice ${num(p, "ano") || ""} = 100`}
          opcao={op.indice}
          carregando={serie.carregando}
          erro={serie.erro}
          altura={300}
          tabela={{
            colunas: [
              { chave: "ano", rotulo: "Ano" },
              { chave: "sp", rotulo: "SP", formato: fmtNum, numero: true },
              { chave: "resto", rotulo: "Brasil sem SP", formato: fmtNum, numero: true },
            ],
            linhas: s,
          }}
          rodape={nota2022}
        />
        <CartaoGrafico
          titulo="Remuneração mediana"
          subtitulo="RAIS · salários mínimos, ponderado pelo estoque"
          opcao={op.mediana}
          carregando={serie.carregando}
          altura={300}
          tabela={{
            colunas: [
              { chave: "ano", rotulo: "Ano" },
              { chave: "mediana_sp", rotulo: "SP", formato: fmtSM, numero: true },
              { chave: "mediana_resto", rotulo: "Brasil sem SP", formato: fmtSM, numero: true },
            ],
            linhas: s,
          }}
        />
      </Grade>
      {s.length > 1 && Number.isFinite(cresceTotal) && (
        <Leitura>
          <p>
            Sem São Paulo, o estoque de TI cresceu <strong>{fmtDec(cresce("resto"), 0)}%</strong> entre {num(p, "ano")} e {num(u, "ano")}, contra{" "}
            {fmtDec(cresceTotal, 0)}% do país inteiro
            {Math.abs(cresce("resto") - cresceTotal) < 10 ? <> — <strong>a conclusão de crescimento não depende de SP</strong>.</> : <>: SP muda a leitura do crescimento.</>}{" "}
            Onde SP difere é no salário: a mediana paulista equivale a {fmtDec(num(u, "mediana_sp") / num(u, "mediana_resto"), 1)} vez a do resto do país, e
            por isso tirar SP do recorte muda bem mais a leitura de remuneração do que a de crescimento.
            {Number.isFinite(saldoSp) && saldoTotal > 0 && (
              <> No fluxo do CAGED de {periodo[0]}–{periodo[1]}, SP respondeu por {fmtPct((saldoSp / saldoTotal) * 100, 0)} do saldo.</>
            )}{" "}
            Para ver qualquer página sem SP, use <strong>Território → Brasil sem SP</strong>.
          </p>
        </Leitura>
      )}
    </Bloco>
  );
}

function Clusters() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const dados = useConsulta(`
    SELECT municipio, uf, nome, estoque::DOUBLE AS estoque, por_mil_hab, crescimento * 100 AS crescimento, remuneracao_sm_mediana
    FROM municipios_cluster WHERE ${f.sql()}`);
  const perfil = useConsulta(`
    SELECT nome, count(*)::DOUBLE AS municipios, sum(estoque)::DOUBLE AS estoque_total, median(estoque)::DOUBLE AS estoque_mediano,
           median(por_mil_hab) AS por_mil_hab, median(crescimento) * 100 AS crescimento, median(remuneracao_sm_mediana) AS remuneracao
    FROM municipios_cluster WHERE ${f.sql()} GROUP BY 1 ORDER BY estoque_total DESC`);

  const op = useMemo(() => {
    const d = dados.linhas;
    if (!d.length) return null;
    const maior = Math.max(...d.map((l) => num(l, "estoque")));
    return opcaoDispersao(
      c,
      GRUPOS.map((g) => ({
        nome: g,
        pontos: d
          .filter((l) => l.nome === g)
          .map((l) => ({
            x: num(l, "por_mil_hab"),
            y: num(l, "crescimento"),
            tamanho: 7 + 30 * Math.sqrt(num(l, "estoque") / maior),
            rotulo: fmtMunicipio(l.municipio),
            detalhe: `${fmtNum(l.estoque)} vínculos · mediana ${fmtSM(l.remuneracao_sm_mediana)}`,
          })),
      })),
      { formatoX: (v) => fmtDec(v, 1), formatoY: (v) => `${fmtDec(v, 0)}%`, nomeX: "Vínculos de TI por mil habitantes (escala log)", nomeY: "Crescimento do estoque na janela", logX: true },
    );
  }, [dados.linhas, c]);

  return (
    <Bloco
      titulo="Municípios agrupados por trajetória"
      descricao="Ordenar municípios por estoque devolve sempre as cidades grandes — o ranking acaba medindo população. O agrupamento (k-médias sobre o estoque em escala log, a especialização e o crescimento; k escolhido por silhueta) pergunta quais municípios se parecem na forma como o mercado de TI se comporta neles. A escala log é o que impede São Paulo de definir os grupos sozinho."
    >
      <CartaoGrafico
        titulo={`Especialização × crescimento · ${f.rotulo}`}
        subtitulo="Cada ponto é um município com 30+ vínculos de TI em 2025 · tamanho = estoque · janela 2020–2025"
        opcao={op}
        carregando={dados.carregando}
        erro={dados.erro}
        altura={460}
        tabela={{
          colunas: [
            { chave: "municipio", rotulo: "Município", formato: fmtMunicipio },
            { chave: "nome", rotulo: "Grupo" },
            { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true },
            { chave: "por_mil_hab", rotulo: "Por mil hab.", formato: (v) => fmtDec(v, 1), numero: true },
            { chave: "crescimento", rotulo: "Crescimento", formato: (v) => fmtPct(v, 0), numero: true },
          ],
          linhas: dados.linhas,
        }}
        rodape={f.ativo ? "Os grupos foram calculados com o país inteiro; o filtro só escolhe quais municípios aparecem." : undefined}
      />
      <CartaoTabela
        titulo="Perfil de cada grupo"
        subtitulo={`Medianas dos municípios do grupo · ${f.rotulo}`}
        tabela={{
          colunas: [
            { chave: "nome", rotulo: "Grupo" },
            { chave: "municipios", rotulo: "Municípios", formato: fmtNum, numero: true },
            { chave: "estoque_total", rotulo: "Estoque total", formato: fmtNum, numero: true },
            { chave: "estoque_mediano", rotulo: "Estoque mediano", formato: fmtNum, numero: true },
            { chave: "por_mil_hab", rotulo: "Por mil hab.", formato: (v) => fmtDec(v, 1), numero: true },
            { chave: "crescimento", rotulo: "Crescimento", formato: (v) => fmtPct(v, 0), numero: true },
            { chave: "remuneracao", rotulo: "Mediana (SM)", formato: (v) => fmtDec(v, 2), numero: true },
          ],
          linhas: perfil.linhas,
        }}
      />
    </Bloco>
  );
}
