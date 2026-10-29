import { useEffect, useMemo, useState } from "react";
import { CartaoGrafico, CartaoTabela, registrarMapaBR, type Clique } from "../componentes/Grafico";
import { Bloco, CabecalhoPergunta, FiltroPeriodo, Grade, Kpi, LinhaFiltros, Seletor, type Periodo } from "../componentes/ui";
import { REGIOES, rotuloTerritorio, UFS, useFiltro, type Regiao } from "../lib/filtro";
import { escapar, fmtCompacto, fmtDec, fmtMunicipio, fmtNum, fmtPct, fmtReais, fmtSinal, fmtSM } from "../lib/formato";
import { opcaoBarras, opcaoDispersao, opcaoMapa, opcaoRosca } from "../lib/graficos";
import { entre, intervalo, literal, medianaExata, medianaHist, num } from "../lib/sql";
import { useTema } from "../lib/tema";
import { escreverPeriodo, lerPeriodo, texto, useParametro } from "../lib/url";
import { useConsulta } from "../lib/useConsulta";

const ANOS = intervalo(2007, 2026);
// Nomes curtos para as seções da CNAE, que no CAGED vêm por extenso ("Atividades
// Financeiras, de Seguros e Serviços Relacionados"). A seção N reúne locação
// de mão de obra e serviços terceirizados: por isso o "terceirização".
const SETORES_CURTOS: Record<string, string> = {
  "Atividades Administrativas e Serviços Complementares": "Serviços administrativos e terceirização",
  "Comércio, Reparação de Veículos Automotores e Motocicletas": "Comércio",
  "Atividades Profissionais, Científicas e Técnicas": "Serviços profissionais e técnicos",
  "Atividades Financeiras, de Seguros e Serviços Relacionados": "Bancos e seguros",
  "Indústrias de Transformação": "Indústria",
  "Informação e Comunicação": "Informação e comunicação",
  "Outras Atividades de Serviços": "Outros serviços",
  "Saúde Humana e Serviços Sociais": "Saúde",
  "Transporte, Armazenagem e Correio": "Transporte e logística",
  "Administração Pública, Defesa e Seguridade Social": "Administração pública",
  "Artes, Cultura, Esporte e Recreação": "Artes, cultura e esporte",
};
const nomeSetor = (s: string) => SETORES_CURTOS[s] ?? s;
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

  const contrata = quemContrata.linhas.map((l) => Object.assign({}, l, { curto: nomeSetor(String(l.setor)) }));
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
      quemContrata: contrata.length
        ? opcaoBarras(c, contrata.map((l) => l.curto), contrata.map((l) => num(l, "admissoes")), {
            horizontal: true,
            nome: "Admissões",
            formato: fmtNum,
            formatoEixo: fmtCompacto,
            larguraRotulo: 230,
            rotulos: true,
            rotuloExtra: (i) => (contrata[i]?.salario ? fmtReais(contrata[i].salario) : ""),
            extraTooltip: (i) =>
              `<div style="margin-top:3px;opacity:.85">${escapar(String(contrata[i]?.setor ?? ""))}</div>` +
              (contrata[i]?.salario ? `<div style="margin-top:3px;opacity:.85">Salário médio de admissão: <strong>${escapar(fmtReais(contrata[i].salario))}</strong></div>` : ""),
          })
        : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <FiltroPeriodo anos={ANOS} valor={periodo} aoMudar={setPeriodo} />
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
          subtitulo={`CAGED · admissões em ocupações de TI por setor da empresa, com o salário médio de admissão ao lado · ${periodo[0]}–${periodo[1]} · ${f.rotulo}`}
          opcao={op.quemContrata}
          carregando={quemContrata.carregando}
          altura={400}
          tabela={{
            colunas: [
              { chave: "setor", rotulo: "Setor da empresa (seção CNAE)" },
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
      <Clusters busca={busca} aoBuscar={setBusca} />
    </>
  );
}

// ------------------------------------------------------- mapa em níveis
// Brasil → região → estado, guiado pelo filtro de território: descer um nível
// é filtrar a página por ele, e a trilha no topo volta. No país, só os
// estados (sem bolhas: 882 pontos sem nome não ajudam a achar uma cidade);
// numa região ou num estado, as bolhas dos municípios aparecem, as maiores
// com o nome, e o município buscado ou clicado ganha um pino.
type NivelMapa =
  | { tipo: "brasil" }
  | { tipo: "regiao"; regiao: Regiao; ufs: string[] }
  | { tipo: "selecao"; ufs: string[] }
  | { tipo: "estado"; uf: string };

function nivelDoFiltro(ufs: string[]): NivelMapa {
  if (!ufs.length) return { tipo: "brasil" };
  if (ufs.length === 1) return { tipo: "estado", uf: ufs[0] };
  const regiao = (Object.keys(REGIOES) as Regiao[]).find((r) => REGIOES[r].length === ufs.length && REGIOES[r].every((u) => ufs.includes(u)));
  return regiao ? { tipo: "regiao", regiao, ufs } : { tipo: "selecao", ufs };
}

// Mesorregião de cada município (IBGE), de public/geo: gerado por
// scripts/mesorregioes.py. Baixado uma vez, quando o mapa chega a um estado.
type Mesos = { mesorregioes: Record<string, string>; municipios: Record<string, string> };
let mesos: Promise<Mesos> | null = null;
function useMesorregioes(ativo: boolean): Mesos | null {
  const [dado, setDado] = useState<Mesos | null>(null);
  useEffect(() => {
    if (!ativo || dado) return;
    mesos ??= fetch("/geo/mesorregioes.json").then((r) => r.json());
    mesos.then(setDado, () => {});
  }, [ativo, dado]);
  return dado;
}

// O cartão das barras tem a altura do mapa; cabem 18 barras de uma vez, e
// as demais se veem rolando.
const ALTURA_MAPA = 520;
const JANELA_BARRAS = 18;

// Quantas bolhas ganham nome em cada nível.
const NOMEADAS = { brasil: 0, regiao: 8, selecao: 8, estado: 10 } as const;

function Trilha({ nivel, aoIr, meso, aoSairMeso, municipio, aoSairMunicipio }: {
  nivel: NivelMapa; aoIr: (ufs: string[]) => void; meso?: string; aoSairMeso: () => void; municipio?: string; aoSairMunicipio: () => void;
}) {
  const passos: { rotulo: string; ufs: string[]; meso?: boolean; municipio?: boolean }[] = [{ rotulo: "Brasil", ufs: [] }];
  if (nivel.tipo === "regiao") passos.push({ rotulo: nivel.regiao, ufs: nivel.ufs });
  if (nivel.tipo === "selecao") passos.push({ rotulo: rotuloTerritorio(nivel.ufs), ufs: nivel.ufs });
  if (nivel.tipo === "estado") {
    const regiao = REGIAO_DA_UF[nivel.uf] as Regiao | undefined;
    if (regiao) passos.push({ rotulo: regiao, ufs: [...REGIOES[regiao]] });
    passos.push({ rotulo: nivel.uf, ufs: [nivel.uf], meso: true });
    if (meso) passos.push({ rotulo: meso, ufs: [nivel.uf], municipio: true });
    if (municipio) passos.push({ rotulo: municipio, ufs: [nivel.uf] });
  }
  return (
    <nav aria-label="Nível do mapa" className="flex flex-wrap items-center gap-1 text-[14px]">
      {passos.map((p, i) => {
        const atual = i === passos.length - 1;
        return (
          <span key={p.rotulo} className="flex items-center gap-1">
            {i > 0 && <span className="text-tinta-3">›</span>}
            {atual ? (
              <span className="rounded-full bg-acento/15 px-3 py-1 font-semibold text-tinta">{p.rotulo}</span>
            ) : (
              <button type="button" onClick={() => (p.municipio ? aoSairMunicipio() : p.meso ? (aoSairMunicipio(), aoSairMeso()) : aoIr(p.ufs))} className="rounded-full px-3 py-1 text-tinta-2 underline-offset-2 hover:bg-superficie hover:text-tinta hover:underline">
                {p.rotulo}
              </button>
            )}
          </span>
        );
      })}
    </nav>
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
  const nivel = nivelDoFiltro(f.ufs);
  // Mesorregião escolhida dentro do estado (código do IBGE), no link.
  const [mesoSel, setMesoSel] = useParametro("meso", "", texto, texto);
  const tabelaMesos = useMesorregioes(nivel.tipo === "estado");
  const ufsNivel = nivel.tipo === "brasil" ? [] : nivel.tipo === "estado" ? [nivel.uf] : nivel.ufs;
  const sqlUfs = ufsNivel.map(literal).join(", ");

  useEffect(() => {
    registrarMapaBR().then(() => setMapaPronto(true));
  }, []);

  // O mapa mostra sempre o país inteiro — o filtro apaga os demais estados em
  // vez de tirá-los, para o recorte continuar com contexto.
  const uf = useConsulta(`SELECT uf, estoque::DOUBLE AS estoque, saldo::DOUBLE AS saldo, remuneracao_sm_mediana FROM mapa_uf WHERE ano = ${ano} AND ${UF_VALIDA}`);
  // Bolhas só abaixo do país; o município buscado entra em qualquer nível,
  // mesmo abaixo do mínimo — pedir por ele e não vê-lo seria pior.
  const condicoes = [
    ...(ufsNivel.length ? [`(m.uf IN (${sqlUfs}) AND m.estoque >= ${minimo})`] : []),
    ...(criterio ? [criterio.sql("g.nome", "g.uf")] : []),
  ];
  const muni = useConsulta(condicoes.length ? `
    SELECT m.cod_municipio AS cod, g.nome AS municipio, m.uf, m.estoque::DOUBLE AS estoque, m.saldo::DOUBLE AS saldo, m.remuneracao_sm_mediana,
           g.longitude AS lon, g.latitude AS lat, k.nome AS grupo
    FROM mapa_municipio m JOIN geo_municipios g ON g.cod6 = m.cod_municipio
    LEFT JOIN municipios_cluster k ON k.cod_municipio = m.cod_municipio
    WHERE m.ano = ${ano} AND (${condicoes.join(" OR ")})` : null);
  // A extensão de cada estado, para enquadrar o mapa na região ou no estado.
  const extensao = useConsulta(`
    SELECT uf, min(longitude) AS lon0, max(longitude) AS lon1, min(latitude) AS lat0, max(latitude) AS lat1
    FROM geo_municipios GROUP BY uf`);
  // No estado, todos os municípios com vínculo: somam por mesorregião e dão a
  // extensão de cada uma para o enquadramento.
  const doEstado = useConsulta(nivel.tipo === "estado" ? `
    SELECT m.cod_municipio AS cod, g.nome || ' (' || m.uf || ')' AS nome, g.nome AS municipio, m.uf, m.estoque::DOUBLE AS estoque,
           m.saldo::DOUBLE AS saldo, m.remuneracao_sm_mediana, g.longitude AS lon, g.latitude AS lat, k.nome AS grupo
    FROM mapa_municipio m JOIN geo_municipios g ON g.cod6 = m.cod_municipio
    LEFT JOIN municipios_cluster k ON k.cod_municipio = m.cod_municipio
    WHERE m.ano = ${ano} AND m.estoque > 0 AND m.uf = ${literal(nivel.uf)}
    ORDER BY m.estoque DESC` : null);
  const mesoDe = (cod: unknown) => (tabelaMesos ? tabelaMesos.municipios[String(cod)] : undefined);
  // A mesorregião só vale se for deste estado (o link pode trazer outra).
  const mesosDoEstado = useMemo(() => {
    if (!tabelaMesos) return [];
    const soma = new Map<string, number>();
    for (const l of doEstado.linhas) {
      const id = tabelaMesos.municipios[String(l.cod)];
      if (id) soma.set(id, (soma.get(id) ?? 0) + num(l, "estoque"));
    }
    return [...soma.entries()].map(([id, estoque]) => ({ id, nome: tabelaMesos.mesorregioes[id], estoque })).sort((a, b) => b.estoque - a.estoque);
  }, [doEstado.linhas, tabelaMesos]);
  const meso = nivel.tipo === "estado" ? mesosDoEstado.find((x) => x.id === mesoSel) : undefined;

  const m = METRICAS[metrica];
  const linhasUf = uf.linhas;
  const selecionadas = f.ativo ? linhasUf.filter((l) => f.ufs.includes(String(l.uf))) : linhasUf;
  const totalPais = linhasUf.reduce((s, l) => s + num(l, "estoque"), 0);
  const totalSel = selecionadas.reduce((s, l) => s + num(l, "estoque"), 0);
  const saldoSel = selecionadas.reduce((s, l) => s + num(l, "saldo"), 0);
  const totalEstado = nivel.tipo === "estado" ? doEstado.linhas.reduce((s, l) => s + num(l, "estoque"), 0) : 0;
  const ranking = useMemo(() => [...linhasUf].sort((a, b) => num(b, "estoque") - num(a, "estoque")), [linhasUf]);

  const bolhas = useMemo(
    () =>
      muni.linhas.map((l) => ({
        nome: `${String(l.municipio)} (${String(l.uf)})`,
        cod: String(l.cod),
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
  const visiveis = useMemo(() => {
    if (!meso) return bolhas;
    const daMeso = doEstado.linhas
      .filter((l) => mesoDe(l.cod) === meso.id)
      .map((l) => ({
        nome: String(l.nome),
        cod: String(l.cod),
        uf: String(l.uf),
        lon: num(l, "lon"),
        lat: num(l, "lat"),
        valor: num(l, metrica),
        tamanho: num(l, "estoque"),
        grupo: l.grupo ? String(l.grupo) : undefined,
        destaque: !!criterio?.casa(String(l.municipio), String(l.uf)),
      }));
    const fora = bolhas.filter((b) => b.destaque && !daMeso.some((x) => x.cod === b.cod));
    return [...daMeso, ...fora];
    // `busca` no lugar de `criterio`: o critério é refeito a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bolhas, meso?.id, doEstado.linhas, tabelaMesos, metrica, busca]);
  const encontrados = bolhas.filter((b) => b.destaque);
  // Município marcado (um só, no estado aberto): os cards passam a ser dele.
  const marcado = nivel.tipo === "estado" && encontrados.length === 1 && encontrados[0].uf === nivel.uf
    ? doEstado.linhas.find((l) => String(l.cod) === encontrados[0].cod)
    : undefined;
  const daMesoSel = meso ? doEstado.linhas.filter((l) => mesoDe(l.cod) === meso.id) : [];
  const cards = (() => {
    if (marcado) {
      return {
        rotulo: String(marcado.municipio),
        estoque: num(marcado, "estoque"),
        saldo: num(marcado, "saldo"),
        parte: totalEstado ? `${fmtPct((num(marcado, "estoque") / totalEstado) * 100, 1)} do estado` : undefined,
        terceiro: { rotulo: "Remuneração mediana", valor: fmtSM(marcado.remuneracao_sm_mediana), detalhe: `RAIS, ${ano}` },
      };
    }
    const municipios = meso ? daMesoSel : nivel.tipo === "estado" ? doEstado.linhas : null;
    if (municipios) {
      const estoque = municipios.reduce((s, l) => s + num(l, "estoque"), 0);
      return {
        rotulo: meso ? meso.nome : f.rotulo,
        estoque: meso ? estoque : totalSel,
        saldo: meso ? municipios.reduce((s, l) => s + num(l, "saldo"), 0) : saldoSel,
        parte: meso && totalEstado ? `${fmtPct((estoque / totalEstado) * 100, 1)} do estado` : undefined,
        terceiro: {
          rotulo: "Municípios com saldo positivo",
          valor: `${municipios.filter((l) => num(l, "saldo") > 0).length} de ${municipios.length}`,
          detalhe: "entre os que têm vínculo de TI",
        },
      };
    }
    return null;
  })();

  // Enquadramento: os achados da busca, se forem poucos; senão, o nível.
  const foco = useMemo(() => {
    if (!meso && encontrados.length && encontrados.length <= 5) {
      return {
        lon: encontrados.reduce((s, b) => s + b.lon, 0) / encontrados.length,
        lat: encontrados.reduce((s, b) => s + b.lat, 0) / encontrados.length,
        zoom: encontrados.length === 1 ? 4 : 2.5,
      };
    }
    const daMeso = meso ? doEstado.linhas.filter((l) => mesoDe(l.cod) === meso.id) : [];
    const caixas = daMeso.length
      ? daMeso.map((l) => ({ lon0: l.lon, lon1: l.lon, lat0: l.lat, lat1: l.lat }))
      : extensao.linhas.filter((l) => ufsNivel.includes(String(l.uf)));
    if (!caixas.length) return undefined;
    const [lon0, lon1] = [Math.min(...caixas.map((l) => num(l, "lon0"))), Math.max(...caixas.map((l) => num(l, "lon1")))];
    const [lat0, lat1] = [Math.min(...caixas.map((l) => num(l, "lat0"))), Math.max(...caixas.map((l) => num(l, "lat1")))];
    // O Brasil inteiro tem ~40° de largura e de altura no zoom 1.
    const zoom = Math.max(1, Math.min(24, 0.85 * Math.min(40 / Math.max(lon1 - lon0, 0.5), 39 / Math.max(lat1 - lat0, 0.5))));
    return { lon: (lon0 + lon1) / 2, lat: (lat0 + lat1) / 2, zoom };
    // `busca` e `f.ufs` no lugar dos derivados, refeitos a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encontrados.length, bolhas, extensao.linhas, f.ufs.join(","), meso?.id, doEstado.linhas]);

  const opMapa = useMemo(() => {
    if (!mapaPronto || !linhasUf.length) return null;
    return opcaoMapa(
      c,
      linhasUf.map((l) => ({ uf: String(l.uf), valor: num(l, metrica) })),
      visiveis,
      {
        formato: (v) => m.formato(v),
        divergente: m.divergente,
        rotulo: m.rotulo,
        formatoBolha: fmtNum,
        destacar: f.ufs,
        // No país não há bolhas: a legenda dos grupos só aparece abaixo dele.
        grupos: nivel.tipo === "brasil" ? undefined : GRUPOS.map((g, i) => ({ nome: g, cor: c.series[COR_GRUPO[i]] })),
        foco,
        nomear: NOMEADAS[nivel.tipo],
      },
    );
  }, [mapaPronto, linhasUf, visiveis, metrica, m, f.ufs, nivel.tipo, foco, c]);

  // Barras do nível: regiões no país, estados numa região, municípios no estado.
  const barras = useMemo(() => {
    if (nivel.tipo === "estado" && !meso) {
      return { rotulos: mesosDoEstado.map((x) => x.nome), valores: mesosDoEstado.map((x) => x.estoque), linhas: mesosDoEstado.map((x) => ({ nome: x.nome, estoque: x.estoque })) };
    }
    if (nivel.tipo === "estado" && meso) {
      const d = doEstado.linhas.filter((l) => mesoDe(l.cod) === meso.id);
      return { rotulos: d.map((l) => String(l.nome)), valores: d.map((l) => num(l, "estoque")), linhas: d.map((l) => ({ nome: l.nome, estoque: l.estoque })) };
    }
    if (nivel.tipo === "brasil") {
      const porRegiao = (Object.keys(REGIOES) as Regiao[])
        .map((r) => ({ nome: r, estoque: linhasUf.filter((l) => REGIAO_DA_UF[String(l.uf)] === r).reduce((s, l) => s + num(l, "estoque"), 0) }))
        .sort((a, b) => b.estoque - a.estoque);
      return { rotulos: porRegiao.map((r) => r.nome), valores: porRegiao.map((r) => r.estoque), linhas: porRegiao };
    }
    const estados = ranking.filter((l) => ufsNivel.includes(String(l.uf)));
    return { rotulos: estados.map((l) => String(l.uf)), valores: estados.map((l) => num(l, "estoque")), linhas: estados.map((l) => ({ nome: l.uf, estoque: l.estoque })) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nivel.tipo, doEstado.linhas, mesosDoEstado, meso?.id, linhasUf, ranking, f.ufs.join(",")]);

  const opRanking = useMemo(() => {
    if (!barras.valores.length) return null;
    // No estado, com uma busca ativa, o que não casa fica esmaecido.
    const esmaecer = meso && criterio
      ? barras.rotulos.map((r, i) => (criterio.casa(r.replace(/ \([A-Z]{2}\)$/, ""), r.slice(-3, -1)) ? -1 : i)).filter((i) => i >= 0)
      : [];
    return opcaoBarras(c, barras.rotulos, barras.valores, { horizontal: true, nome: "Vínculos", formato: fmtNum, larguraRotulo: nivel.tipo === "estado" ? (meso ? 170 : 200) : nivel.tipo === "brasil" ? 100 : 40, esmaecer, janela: JANELA_BARRAS, rotulos: !!meso });
    // `busca` no lugar de `criterio`: o critério é refeito a cada render.
  }, [barras, nivel.tipo, meso?.id, busca, c]);

  // Descer um nível: região → seus estados; estado → seu filtro; município → pino.
  const clicar = (cl: Clique) => {
    const mesoClicada = mesosDoEstado.find((x) => x.nome === cl.nome);
    if (mesoClicada) return setMesoSel(mesoClicada.id);
    if (cl.nome in REGIOES) return f.definir([...REGIOES[cl.nome as Regiao]]);
    const sigla = ufDoClique(cl);
    if (!sigla) return;
    if (UFS.includes(cl.nome)) {
      // No país, um estado do mapa leva à região dele (o nível seguinte).
      if (nivel.tipo === "brasil") return f.definir([...REGIOES[REGIAO_DA_UF[sigla] as Regiao]]);
      setMesoSel("");
      return f.definir([sigla]);
    }
    aoBuscar(cl.nome);
    if (nivel.tipo !== "estado" || nivel.uf !== sigla) f.definir([sigla]);
    // No estado, o município clicado abre a mesorregião dele.
    const cod = doEstado.linhas.find((l) => l.nome === cl.nome)?.cod;
    const id = mesoDe(cod);
    if (id) setMesoSel(id);
  };

  const nomeNivel = nivel.tipo === "brasil" ? "Regiões" : nivel.tipo === "estado" ? (meso ? `Municípios · ${meso.nome}` : `Mesorregiões · ${nivel.uf}`) : `Estados · ${f.rotulo}`;
  const proximo =
    nivel.tipo === "brasil" ? "Clique numa região para ver os estados dela"
    : nivel.tipo !== "estado" ? "Clique num estado para ver as regiões dele"
    : meso ? "Clique num município para marcá-lo no mapa" : "Clique numa mesorregião para ver os municípios dela";

  return (
    <Bloco titulo="O mapa: estoque e movimento no mesmo lugar">
      <div className="flex flex-wrap items-end gap-4">
        <Seletor rotulo="Ano" valor={ano} opcoes={intervalo(2007, 2026).map((a) => ({ valor: a, rotulo: String(a) }))} aoMudar={setAno} />
        <Seletor rotulo="Colorir por" valor={metrica} opcoes={(Object.keys(METRICAS) as Metrica[]).map((k) => ({ valor: k, rotulo: METRICAS[k].rotulo }))} aoMudar={setMetrica} />
        {nivel.tipo !== "brasil" && !meso && (
          <Seletor rotulo="Município a partir de" valor={minimo} opcoes={[10, 50, 200, 1000, 5000].map((v) => ({ valor: v, rotulo: `${fmtNum(v)} vínculos` }))} aoMudar={setMinimo} />
        )}
        <BuscaMunicipio valor={busca} aoMudar={aoBuscar} encontrados={criterio ? encontrados.length : undefined} />
      </div>
      <Grade colunas={3}>
        <Kpi
          destaque
          rotulo={`Estoque · ${cards?.rotulo ?? f.rotulo}`}
          valor={(cards?.estoque ?? totalSel) ? fmtCompacto(cards?.estoque ?? totalSel) : "—"}
          detalhe={
            !totalPais ? `a RAIS de ${ano} ainda não saiu`
            : cards?.parte ?? (f.ativo ? `${fmtPct(((cards?.estoque ?? totalSel) / totalPais) * 100, 1)} do país` : `RAIS, ${ano}`)
          }
        />
        <Kpi rotulo={`Saldo do ano · ${cards?.rotulo ?? f.rotulo}`} valor={fmtSinal(cards?.saldo ?? saldoSel)} detalhe={`CAGED, ${ano}`} />
        {cards ? (
          <Kpi rotulo={cards.terceiro.rotulo} valor={cards.terceiro.valor} detalhe={cards.terceiro.detalhe} />
        ) : (
          <Kpi rotulo="Estados com saldo positivo" valor={`${selecionadas.filter((l) => num(l, "saldo") > 0).length} de ${selecionadas.length}`} />
        )}
      </Grade>
      <Trilha
        nivel={nivel}
        aoIr={(ufs) => { setMesoSel(""); aoBuscar(""); f.definir(ufs); }}
        meso={meso?.nome}
        aoSairMeso={() => setMesoSel("")}
        municipio={marcado ? String(marcado.municipio) : undefined}
        aoSairMunicipio={() => aoBuscar("")}
      />
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <CartaoGrafico
          titulo={nivel.tipo === "brasil" ? `O mercado de TI no Brasil — ${ano}` : `O mercado de TI · ${meso ? meso.nome : f.rotulo} — ${ano}`}
          subtitulo={
            nivel.tipo === "brasil"
              ? `${m.rotulo} por estado`
              : meso
                ? `${m.rotulo} por estado · os ${fmtNum(visiveis.length)} municípios da mesorregião com vínculos de TI, coloridos pelo grupo de trajetória`
                : `${m.rotulo} por estado · ${fmtNum(visiveis.filter((b) => !b.destaque).length)} municípios acima do mínimo, coloridos pelo grupo de trajetória`
          }
          dicaClique={nivel.tipo === "brasil" ? "Clique num estado para abrir a região dele" : "Clique num estado para abri-lo, ou num município para marcá-lo"}
          aoClicar={clicar}
          opcao={opMapa}
          carregando={uf.carregando || muni.carregando || !mapaPronto}
          erro={uf.erro || muni.erro}
          altura={ALTURA_MAPA}
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
          titulo={`${nomeNivel} por estoque`}
          subtitulo={`RAIS · vínculos ativos, ${ano}${meso ? ` · todos os ${fmtNum(barras.valores.length)} municípios${barras.valores.length > JANELA_BARRAS ? ", role para ver" : ""}` : nivel.tipo === "estado" ? " · mesorregiões do IBGE" : ""}`}
          dicaClique={proximo}
          aoClicar={clicar}
          opcao={totalPais ? opRanking : null}
          carregando={nivel.tipo === "estado" ? doEstado.carregando || !tabelaMesos : uf.carregando}
          erro={nivel.tipo === "estado" ? doEstado.erro : undefined}
          altura={ALTURA_MAPA}
          tabela={{ colunas: [{ chave: "nome", rotulo: meso ? "Município" : nivel.tipo === "estado" ? "Mesorregião" : nivel.tipo === "brasil" ? "Região" : "UF" }, { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: barras.linhas }}
        />
      </div>
    </Bloco>
  );
}

// Município: os pontos do agrupamento; estado: a mesma leitura por UF.
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
