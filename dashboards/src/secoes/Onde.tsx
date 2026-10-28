import { useEffect, useMemo, useState } from "react";
import { CartaoGrafico, CartaoTabela, registrarMapaBR, type Clique } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, Kpi, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { REGIOES, UFS, useFiltro, type Regiao } from "../lib/filtro";
import { escapar, fmtCompacto, fmtDec, fmtMunicipio, fmtNum, fmtPct, fmtReais, fmtSinal, fmtSM } from "../lib/formato";
import { opcaoBarras, opcaoDispersao, opcaoLinhas, opcaoMapa, opcaoMosaico, opcaoRosca } from "../lib/graficos";
import { coluna, entre, intervalo, literal, medianaExata, medianaHist, num, rotulos } from "../lib/sql";
import { useTema } from "../lib/tema";
import { escreverPeriodo, lerPeriodo, texto, useParametro } from "../lib/url";
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
// A cor segue o grupo no mapa e na dispersão. Laranja, verde-água e roxo:
// o trio passa na validação de daltonismo em todos os pares, nos dois temas,
// e nenhum é azul, então as bolhas não somem sobre o mapa (rampa azul).
const COR_GRUPO = [1, 2, 6] as const;

// Busca por nome, sem acento nem caixa: "cornelio procopio" acha "Cornélio
// Procópio". Com a UF entre parênteses (como na lista de sugestões), o nome
// precisa bater inteiro e na UF certa; sem ela, basta conter o texto.
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
type Busca = { termo: string; uf: string | null; casa: (nome: string, uf: string) => boolean; sql: (colNome: string, colUf: string) => string } | null;
function lerBusca(texto: string): Busca {
  const m = texto.match(/^(.*?)\s*\(([A-Za-z]{2})\)\s*$/);
  const termo = normalizar(m ? m[1] : texto);
  const uf = m ? m[2].toUpperCase() : null;
  if (termo.length < 3) return null;
  return {
    termo,
    uf,
    casa: (nome, u) => (uf ? u === uf && normalizar(nome) === termo : normalizar(nome).includes(termo)),
    sql: (colNome, colUf) =>
      uf ? `(strip_accents(lower(${colNome})) = ${literal(termo)} AND ${colUf} = ${literal(uf)})` : `strip_accents(lower(${colNome})) LIKE ${literal(`%${termo}%`)}`,
  };
}
// "Pr-Cornelio Procopio" (RAIS) -> nome e UF.
const partesMunicipio = (m: unknown) => {
  const r = String(m ?? "").match(/^([A-Za-z]{2})-(.+)$/);
  return r ? { nome: r[2], uf: r[1].toUpperCase() } : { nome: String(m ?? ""), uf: "" };
};
const REGIAO_DA_UF = Object.fromEntries((Object.keys(REGIOES) as Regiao[]).flatMap((r) => REGIOES[r].map((u) => [u, r])));

function BuscaMunicipio({ valor, aoMudar, encontrados }: { valor: string; aoMudar: (v: string) => void; encontrados?: number }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="sobrelinha">Destacar município</span>
      <span className="flex items-center gap-2">
        <input
          type="search"
          list="municipios-busca"
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          placeholder="Ex.: Cornélio Procópio"
          // 16px no celular: abaixo disso o iOS dá zoom ao focar.
          className="h-11 w-full min-w-[12rem] rounded-[var(--radius-controle)] border border-borda bg-superficie px-3 text-base text-tinta shadow-sm transition-colors placeholder:text-tinta-3 hover:border-serie-1/60 sm:h-9 sm:w-64 sm:px-2.5 sm:text-sm"
        />
        {valor && encontrados !== undefined && (
          <span className="whitespace-nowrap text-[12px] text-tinta-3">{encontrados ? `${encontrados} encontrado${encontrados > 1 ? "s" : ""}` : "nenhum"}</span>
        )}
      </span>
    </label>
  );
}

const ordenarLentes = <T extends { categoria?: unknown }>(l: T[]) =>
  [...l].sort((a, b) => LENTES.indexOf(String(a.categoria)) - LENTES.indexOf(String(b.categoria)));

// O clique numa bolha de município traz "Nome (UF)": filtra pela UF dele.
const ufDoClique = ({ nome }: Clique) => (UFS.includes(nome) ? nome : nome.match(/\(([A-Z]{2})\)$/)?.[1] ?? null);

export default function Onde() {
  const { cores: c } = useTema();
  const f = useFiltro();
  const [periodo, setPeriodo] = useParametro<Periodo>("periodo", [2007, 2026], lerPeriodo, escreverPeriodo);
  const anoRais = Math.min(periodo[1], 2025);
  // A busca vale para o mapa e para a dispersão de municípios ao mesmo tempo.
  const [busca, setBusca] = useParametro("destacar", "", texto, texto);
  const sugestoes = useConsulta(`
    SELECT DISTINCT g.nome || ' (' || g.uf || ')' AS rotulo
    FROM mapa_municipio m JOIN geo_municipios g ON g.cod6 = m.cod_municipio
    WHERE m.estoque > 0 ORDER BY 1`);

  const lentesFluxo = useConsulta(`
    SELECT lente AS categoria, sum(admissoes)::DOUBLE AS admissoes, sum(saldo)::DOUBLE AS saldo,
           sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
    FROM caged_cubo WHERE ${entre(periodo)} AND ${f.sql()} GROUP BY 1`);
  // Sem filtro, a tabela do cruzamento setor × ocupação (a do TCC); com
  // filtro, a mesma conta sobre o estoque por UF, que tem as duas marcações.
  // A mediana de cada lente: exata sem filtro, pelo histograma com filtro.
  const lentesEstoque = useConsulta(`
    SELECT e.categoria, e.estoque, m.mediana
    FROM (SELECT ${LENTE_RAIS} AS categoria, sum(estoque_3112)::DOUBLE AS estoque
          FROM ${f.ativo ? "rais_estoque_uf" : "rais_setor_vs_ocupacao"} WHERE ano = ${anoRais} AND ${f.sql()} GROUP BY 1) e
    LEFT JOIN (${f.ativo
      ? medianaHist(`ano = ${anoRais} AND ${f.sql()}`, LENTE_RAIS)
      : `SELECT CASE grupo WHEN 'dentro' THEN '${DENTRO}' WHEN 'fora' THEN '${FORA}' ELSE 'Outra ocupação em empresa de TI' END AS g, mediana
         FROM (${medianaExata("lente", `ano = ${anoRais}`)})`}) m ON m.g = e.categoria`);
  const quemContrata = useConsulta(`
    SELECT setor, sum(admissoes)::DOUBLE AS admissoes, sum(saldo)::DOUBLE AS saldo,
           sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
    FROM caged_cubo WHERE lente = '${FORA}' AND setor IS NOT NULL AND ${entre(periodo)} AND ${f.sql()}
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);

  const fluxo = ordenarLentes(lentesFluxo.linhas);
  const estoque = ordenarLentes(lentesEstoque.linhas);

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

  // Resposta do topo: a parcela dos profissionais de TI fora das empresas de TI.
  const resposta = (() => {
    const v = (cat: string) => num(estoque.find((l) => l.categoria === cat), "estoque");
    const [fora, dentro, outra] = [v(FORA), v(DENTRO), v("Outra ocupação em empresa de TI")];
    if (!Number.isFinite(fora) || !Number.isFinite(dentro)) return undefined;
    const onde = f.ativo ? ` em ${f.rotulo}` : "";
    const extra = Number.isFinite(outra) ? `; dentro das empresas de TI, ${fmtDec((outra / (outra + dentro)) * 100, 0)}% dos vínculos são de outras ocupações` : "";
    return `Em ${anoRais}, ${fmtDec((fora / (fora + dentro)) * 100, 0)}% dos profissionais de TI${onde} trabalhavam fora de empresas de TI, em bancos, comércio, indústria e governo${extra}.`;
  })();

  return (
    <>
      <CabecalhoPergunta
        numero={2}
        pergunta="Onde está o trabalho de TI: em que empresas e em que lugares?"
        resposta={resposta}
      />
      <LinhaFiltros
        resumo={`${periodo[0]}–${periodo[1]} · RAIS ${anoRais}`}
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
      >
        <Grade>
          <CartaoGrafico
            titulo={`Admissões, pelas duas lentes · ${f.rotulo}`}
            ajuda="lentes"
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
            ajuda="lentes"
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
        />
      </Bloco>

      <datalist id="municipios-busca">
        {sugestoes.linhas.map((l) => (
          <option key={String(l.rotulo)} value={String(l.rotulo)} />
        ))}
      </datalist>
      <Mapa busca={busca} aoBuscar={setBusca} />
      <SaoPaulo periodo={periodo} />
      <Clusters busca={busca} aoBuscar={setBusca} />
    </>
  );
}

function Mapa({ busca, aoBuscar }: { busca: string; aoBuscar: (v: string) => void }) {
  const { cores: c } = useTema();
  const f = useFiltro();
  const criterio = lerBusca(busca);
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
  // O município buscado entra mesmo abaixo do mínimo: pedir por ele e não
  // vê-lo no mapa seria pior que a bolha pequena. O grupo vem da dispersão.
  const muni = useConsulta(`
    SELECT g.nome AS municipio, m.uf, m.estoque::DOUBLE AS estoque, m.saldo::DOUBLE AS saldo, m.remuneracao_sm_mediana,
           g.longitude AS lon, g.latitude AS lat, k.nome AS grupo
    FROM mapa_municipio m JOIN geo_municipios g ON g.cod6 = m.cod_municipio
    LEFT JOIN municipios_cluster k ON k.cod_municipio = m.cod_municipio
    WHERE m.ano = ${ano} AND (m.estoque >= ${minimo}${criterio ? ` OR ${criterio.sql("g.nome", "g.uf")}` : ""})`);

  const m = METRICAS[metrica];
  const linhasUf = uf.linhas;
  const selecionadas = f.ativo ? linhasUf.filter((l) => f.ufs.includes(String(l.uf))) : linhasUf;
  const totalPais = linhasUf.reduce((s, l) => s + num(l, "estoque"), 0);
  const totalSel = selecionadas.reduce((s, l) => s + num(l, "estoque"), 0);
  const saldoSel = selecionadas.reduce((s, l) => s + num(l, "saldo"), 0);
  const ranking = useMemo(() => [...linhasUf].sort((a, b) => num(b, "estoque") - num(a, "estoque")), [linhasUf]);

  const bolhas = useMemo(
    () =>
      muni.linhas.map((l) => ({
        nome: `${String(l.municipio)} (${String(l.uf)})`,
        uf: String(l.uf),
        lon: num(l, "lon"),
        lat: num(l, "lat"),
        valor: num(l, metrica),
        tamanho: num(l, "estoque"),
        grupo: l.grupo ? String(l.grupo) : undefined,
        destaque: !!criterio?.casa(String(l.municipio), String(l.uf)),
      })),
    // `busca` no lugar de `criterio`: o critério é refeito a cada render.
    [muni.linhas, metrica, busca],
  );
  const encontrados = bolhas.filter((b) => b.destaque);

  const opMapa = useMemo(() => {
    if (!mapaPronto || !linhasUf.length) return null;
    // Poucos achados: o mapa centra neles e aproxima; muitos ("São..."), fica no país.
    const foco = encontrados.length && encontrados.length <= 5
      ? {
          lon: encontrados.reduce((s, b) => s + b.lon, 0) / encontrados.length,
          lat: encontrados.reduce((s, b) => s + b.lat, 0) / encontrados.length,
          zoom: encontrados.length === 1 ? 4 : 2.5,
        }
      : undefined;
    return opcaoMapa(
      c,
      linhasUf.map((l) => ({ uf: String(l.uf), valor: num(l, metrica) })),
      bolhas,
      {
        formato: (v) => m.formato(v),
        divergente: m.divergente,
        rotulo: m.rotulo,
        formatoBolha: fmtNum,
        destacar: f.ufs,
        grupos: GRUPOS.map((g, i) => ({ nome: g, cor: c.series[COR_GRUPO[i]] })),
        foco,
      },
    );
  }, [mapaPronto, linhasUf, bolhas, encontrados, metrica, m, f.ufs, c]);

  const opRanking = useMemo(() => {
    if (!ranking.length) return null;
    const esmaecer = f.ativo ? ranking.map((l, i) => (f.ufs.includes(String(l.uf)) ? -1 : i)).filter((i) => i >= 0) : [];
    return opcaoBarras(c, rotulos(ranking, "uf"), coluna(ranking, "estoque"), { horizontal: true, nome: "Vínculos", formato: fmtNum, larguraRotulo: 40, esmaecer });
  }, [ranking, f.ativo, f.ufs, c]);

  // Estado: liga e desliga no filtro. Município: destaca-o nos dois gráficos
  // e recorta a página pelo estado dele.
  const clicar = (cl: Clique) => {
    const sigla = ufDoClique(cl);
    if (!sigla) return;
    if (UFS.includes(cl.nome)) return f.alternar(sigla);
    aoBuscar(cl.nome);
    if (!f.ufs.includes(sigla)) f.alternar(sigla);
  };

  return (
    <Bloco titulo="O mapa: estoque e movimento no mesmo lugar">
      <div className="flex flex-wrap items-end gap-4">
        <Seletor rotulo="Ano" valor={ano} opcoes={intervalo(2007, 2026).map((a) => ({ valor: a, rotulo: String(a) }))} aoMudar={setAno} />
        <Seletor rotulo="Colorir por" valor={metrica} opcoes={(Object.keys(METRICAS) as Metrica[]).map((k) => ({ valor: k, rotulo: METRICAS[k].rotulo }))} aoMudar={setMetrica} />
        <Seletor rotulo="Município a partir de" valor={minimo} opcoes={[10, 50, 200, 1000, 5000].map((v) => ({ valor: v, rotulo: `${fmtNum(v)} vínculos` }))} aoMudar={setMinimo} />
        <BuscaMunicipio valor={busca} aoMudar={aoBuscar} encontrados={criterio ? encontrados.length : undefined} />
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
          subtitulo={`${m.rotulo} por estado · ${fmtNum(muni.linhas.length)} municípios acima do mínimo, coloridos pelo grupo de trajetória`}
          dicaClique="Clique num estado para filtrar, ou num município para destacá-lo"
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
           any_value(m.sp) AS mediana_sp, any_value(m.resto) AS mediana_resto
    FROM rais_estoque_uf e
    LEFT JOIN (SELECT ano AS m_ano, max(mediana) FILTER (WHERE grupo = 'SP') AS sp, max(mediana) FILTER (WHERE grupo = 'Brasil sem SP') AS resto
               FROM (${medianaExata("sp")}) GROUP BY 1) m ON m.m_ano = e.ano
    WHERE (setor_ti OR ocupacao_ti) AND ano BETWEEN ${inicio} AND ${fim} GROUP BY 1 ORDER BY 1`);

  const s = serie.linhas;
  const [p, u] = [s[0], s.at(-1)];
  const cresce = (chave: string) => (num(u, chave) / num(p, chave) - 1) * 100;
  const cresceTotal = ((num(u, "sp") + num(u, "resto")) / (num(p, "sp") + num(p, "resto")) - 1) * 100;
  const participacao = (l: (typeof s)[number] | undefined) => (num(l, "sp") / (num(l, "sp") + num(l, "resto"))) * 100;

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

  return (
    <Bloco
      titulo="São Paulo e o resto do país"
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
          subtitulo={`RAIS · índice ${num(p, "ano") || ""} = 100 · não segue o filtro`}
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
        />
        <CartaoGrafico
          titulo="Remuneração mediana"
          subtitulo="RAIS · salários mínimos, mediana exata"
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
    </Bloco>
  );
}

type Nivel = "municipio" | "uf";

function Clusters({ busca, aoBuscar }: { busca: string; aoBuscar: (v: string) => void }) {
  const { cores: c } = useTema();
  const f = useFiltro();
  const criterio = lerBusca(busca);
  // Município: os pontos do agrupamento (do estado filtrado, se houver).
  // Estado: a mesma leitura agregada por UF, para comparar os estados entre si.
  const [nivel, setNivel] = useState<Nivel>("municipio");
  const dados = useConsulta(`
    SELECT municipio, uf, nome, estoque::DOUBLE AS estoque, por_mil_hab, crescimento * 100 AS crescimento, remuneracao_sm_mediana
    FROM municipios_cluster WHERE ${f.sql()}`);
  // Por UF, o estoque inteiro do estado (não só dos municípios do agrupamento)
  // e a população de todos os municípios: a mesma janela, 2020–2025. Todos os
  // estados aparecem, como no mapa; os do filtro ficam em destaque.
  const estados = useConsulta(`
    WITH e AS (SELECT uf, max(estoque) FILTER (WHERE ano = 2025) AS fim, max(estoque) FILTER (WHERE ano = 2020) AS inicio,
                      max(remuneracao_sm_mediana) FILTER (WHERE ano = 2025) AS mediana
               FROM mapa_uf WHERE ${UF_VALIDA} GROUP BY uf),
         p AS (SELECT uf, sum(populacao) AS pop FROM geo_municipios GROUP BY uf)
    SELECT e.uf, e.fim::DOUBLE AS estoque, e.fim * 1000.0 / p.pop AS por_mil_hab, (e.fim / e.inicio - 1) * 100 AS crescimento, e.mediana AS remuneracao_sm_mediana
    FROM e JOIN p USING (uf) WHERE e.fim > 0 AND e.inicio > 0 ORDER BY e.fim DESC`);
  const perfil = useConsulta(`
    SELECT nome, count(*)::DOUBLE AS municipios, sum(estoque)::DOUBLE AS estoque_total, median(estoque)::DOUBLE AS estoque_mediano,
           median(por_mil_hab) AS por_mil_hab, median(crescimento) * 100 AS crescimento, median(remuneracao_sm_mediana) AS remuneracao
    FROM municipios_cluster WHERE ${f.sql()} GROUP BY 1 ORDER BY estoque_total DESC`);

  const eixos = { formatoX: (v: number) => fmtDec(v, 1), formatoY: (v: number) => `${fmtDec(v, 0)}%`, nomeX: "Vínculos de TI por mil habitantes (escala log)", nomeY: "Crescimento do estoque na janela", logX: true };
  const encontrados = nivel === "municipio" && criterio
    ? dados.linhas.filter((l) => { const p = partesMunicipio(l.municipio); return criterio.casa(p.nome, p.uf); }).length
    : undefined;

  const op = useMemo(() => {
    if (nivel === "uf") {
      const d = estados.linhas;
      if (!d.length) return null;
      const maior = Math.max(...d.map((l) => num(l, "estoque")));
      // Cinco regiões, nas cinco primeiras cores; a sigla escrita em cada ponto
      // é a segunda codificação, para não depender só da cor.
      return opcaoDispersao(
        c,
        (Object.keys(REGIOES) as Regiao[]).map((r, i) => ({
          nome: r,
          cor: c.series[i],
          pontos: d
            .filter((l) => REGIAO_DA_UF[String(l.uf)] === r)
            .map((l) => ({
              nome: String(l.uf),
              x: num(l, "por_mil_hab"),
              y: num(l, "crescimento"),
              tamanho: 10 + 34 * Math.sqrt(num(l, "estoque") / maior),
              rotulo: String(l.uf),
              detalhe: `${fmtNum(l.estoque)} vínculos · mediana ${fmtSM(l.remuneracao_sm_mediana)}`,
              destaque: f.ativo && f.ufs.includes(String(l.uf)) && f.ufs.length < 27,
            })),
        })),
        { ...eixos, rotularPontos: true },
      );
    }
    const d = dados.linhas;
    if (!d.length) return null;
    const maior = Math.max(...d.map((l) => num(l, "estoque")));
    return opcaoDispersao(
      c,
      GRUPOS.map((g, i) => ({
        nome: g,
        cor: c.series[COR_GRUPO[i]],
        pontos: d
          .filter((l) => l.nome === g)
          .map((l) => {
            const p = partesMunicipio(l.municipio);
            return {
              nome: fmtMunicipio(l.municipio),
              x: num(l, "por_mil_hab"),
              y: num(l, "crescimento"),
              tamanho: 7 + 30 * Math.sqrt(num(l, "estoque") / maior),
              rotulo: fmtMunicipio(l.municipio),
              detalhe: `${fmtNum(l.estoque)} vínculos · mediana ${fmtSM(l.remuneracao_sm_mediana)}`,
              destaque: !!criterio?.casa(p.nome, p.uf),
            };
          }),
      })),
      eixos,
    );
    // `busca` no lugar de `criterio`: o critério é refeito a cada render.
  }, [nivel, dados.linhas, estados.linhas, busca, f.ativo, f.ufs, c]);

  // Ponto de estado: liga e desliga o estado no filtro. Ponto de município:
  // destaca-o (também no mapa) e recorta a página pelo estado dele.
  const clicar = (cl: Clique) => {
    const sigla = ufDoClique(cl);
    if (!sigla) return;
    if (nivel === "uf") return f.alternar(sigla);
    aoBuscar(cl.nome);
    if (!f.ufs.includes(sigla)) f.alternar(sigla);
  };

  const fonte = nivel === "uf" ? estados : dados;
  return (
    <Bloco
      titulo="Municípios agrupados por trajetória"
    >
      <div className="flex flex-wrap items-end gap-4">
        <Seletor<Nivel>
          rotulo="Agrupar por"
          valor={nivel}
          opcoes={[
            { valor: "municipio", rotulo: f.ativo ? `Municípios · ${f.rotulo}` : "Municípios" },
            { valor: "uf", rotulo: "Estados" },
          ]}
          aoMudar={setNivel}
        />
        {nivel === "municipio" && <BuscaMunicipio valor={busca} aoMudar={aoBuscar} encontrados={encontrados} />}
      </div>
      <CartaoGrafico
        titulo={`Especialização × crescimento · ${nivel === "uf" ? "por estado" : f.rotulo}`}
        ajuda={nivel === "uf" ? "porMil" : "trajetoria"}
        subtitulo={
          nivel === "uf"
            ? "Cada ponto é um estado, colorido pela região · tamanho = estoque · janela 2020–2025"
            : "Cada ponto é um município com 30+ vínculos de TI em 2025 · tamanho = estoque · janela 2020–2025"
        }
        dicaClique={nivel === "uf" ? "Clique num estado para filtrar a página" : "Clique num município para destacá-lo e filtrar pelo estado dele"}
        aoClicar={clicar}
        opcao={op}
        carregando={fonte.carregando}
        erro={fonte.erro}
        altura={460}
        tabela={
          nivel === "uf"
            ? {
                colunas: [
                  { chave: "uf", rotulo: "UF" },
                  { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true },
                  { chave: "por_mil_hab", rotulo: "Por mil hab.", formato: (v) => fmtDec(v, 1), numero: true },
                  { chave: "crescimento", rotulo: "Crescimento", formato: (v) => fmtPct(v, 0), numero: true },
                ],
                linhas: estados.linhas,
              }
            : {
                colunas: [
                  { chave: "municipio", rotulo: "Município", formato: fmtMunicipio },
                  { chave: "nome", rotulo: "Grupo" },
                  { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true },
                  { chave: "por_mil_hab", rotulo: "Por mil hab.", formato: (v) => fmtDec(v, 1), numero: true },
                  { chave: "crescimento", rotulo: "Crescimento", formato: (v) => fmtPct(v, 0), numero: true },
                ],
                linhas: dados.linhas,
              }
        }
      />
      {nivel === "municipio" && <CartaoTabela
        titulo="Perfil de cada grupo"
        ajuda="trajetoria"
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
      />}
    </Bloco>
  );
}
