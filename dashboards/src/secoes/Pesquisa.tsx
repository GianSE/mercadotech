import { useEffect, useMemo, useState } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { AvisoNacional, Bloco, Grade, Kpi } from "../componentes/ui";
import { UFS } from "../lib/filtro";
import { fmtCompacto, fmtDec, fmtNum } from "../lib/formato";
import { opcaoBarras, opcaoHierarquia, type NoHierarquia } from "../lib/graficos";
import { obterManifesto, type Linha } from "../lib/db";
import { coluna, literal, num, rotulos, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

// A visão geral apresenta o painel, sem repetir as páginas: o que conta como
// TI (o recorte), o que cada base mostra (um gráfico da RAIS, um do CAGED,
// que não aparecem nas perguntas) e o roteiro das cinco perguntas, cada uma
// com o número que a página vai explicar.
const PAGINAS = [
  { id: "crescimento", p: "Quanto o mercado cresceu, e em que ritmo?" },
  { id: "onde", p: "Onde está o trabalho de TI?" },
  { id: "qualidade", p: "O emprego melhorou em qualidade?" },
  { id: "equidade", p: "Quem ganha menos, e por quê?" },
  { id: "futuro", p: "Para onde o mercado vai?" },
];

const OUTRA = "Outra ocupação em empresa de TI";
const ULTIMO_RAIS = "(SELECT max(ano) FROM rais_estoque_anual)";
// Último ano completo do CAGED: o ano corrente só entra quando tiver dezembro.
const ULTIMO_CAGED = "(SELECT year(max(mes)) - CASE WHEN month(max(mes)) < 12 THEN 1 ELSE 0 END FROM serie_mensal)";

// A CBO é uma árvore: grande grupo (1 dígito), subgrupos (2 e 3), família
// (4) e ocupação (6). O gráfico mostra três desses níveis; os nomes das
// famílias são os da CBO 2002, encurtados.
const GRANDES_GRUPOS: Record<string, string> = {
  "1": "1 · Dirigentes e gerentes",
  "2": "2 · Profissionais das ciências",
  "3": "3 · Técnicos de nível médio",
};
const FAMILIAS_CBO: Record<string, string> = {
  "1236": "Diretores de informática",
  "1421": "Gerentes administrativos (DPO)",
  "1425": "Gerentes de TI",
  "2031": "Pesquisadores (computação)",
  "2112": "Estatísticos",
  "2122": "Engenheiros em computação",
  "2123": "Administradores de TI",
  "2124": "Analistas de TI",
  "3132": "Técnicos em eletrônica",
  "3133": "Técnicos em telecomunicações",
  "3171": "Técnicos de desenvolvimento",
  "3172": "Técnicos de operação",
};
const DIVISOES_CNAE: Record<string, string> = {
  "62": "62 · Serviços de tecnologia da informação",
  "63": "63 · Serviços de informação",
};
// Numa Gold sem a coluna do código, a divisão sai do nome da atividade.
const divisaoPeloNome = (nome: string) => (/dados|portais|provedores de conte|servi\S*os de informa\S*o n/i.test(nome) ? "63" : "62");
const fmtCnae = (c: string) => (c.length === 7 ? `${c.slice(0, 4)}-${c[4]}/${c.slice(5)}` : c);

function arvoreCbo(linhas: Linha[]): NoHierarquia[] {
  const grupos = new Map<string, Map<string, NoHierarquia[]>>();
  for (const l of linhas) {
    const cbo = String(l.cbo);
    const familias = grupos.get(cbo[0]) ?? new Map<string, NoHierarquia[]>();
    grupos.set(cbo[0], familias);
    const lista = familias.get(cbo.slice(0, 4)) ?? [];
    familias.set(cbo.slice(0, 4), lista);
    lista.push({ nome: `${cbo.slice(0, 4)}-${cbo.slice(4)} ${String(l.ocupacao)}`, valor: num(l, "vinculos") });
  }
  return [...grupos.entries()].sort().map(([g, familias]) => ({
    nome: GRANDES_GRUPOS[g] ?? g,
    filhos: [...familias.entries()].sort().map(([f, ocupacoes]) => ({ nome: `${f} · ${FAMILIAS_CBO[f] ?? "família " + f}`, filhos: ocupacoes })),
  }));
}

function arvoreCnae(linhas: Linha[]): NoHierarquia[] {
  const divisoes = new Map<string, NoHierarquia[]>();
  for (const l of linhas) {
    const nome = String(l.atividade);
    const codigo = typeof l.cnae === "string" ? l.cnae : "";
    const divisao = codigo ? codigo.slice(0, 2) : divisaoPeloNome(nome);
    const lista = divisoes.get(divisao) ?? [];
    divisoes.set(divisao, lista);
    lista.push({ nome: codigo ? `${fmtCnae(codigo)} ${nome}` : nome, valor: num(l, "vinculos") });
  }
  return [...divisoes.entries()].sort().map(([d, filhos]) => ({ nome: DIVISOES_CNAE[d] ?? d, filhos }));
}

// Do bruto ao painel: o que cada camada guarda, para o funil da visão geral.
function Funil({ passos }: { passos: { camada: string; valor: string; titulo: string; texto: string }[] }) {
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {passos.map((p, i) => (
        <li key={p.camada} className="cartao relative p-4">
          <p className="sobrelinha">
            {String(i + 1).padStart(2, "0")} · {p.camada}
          </p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-tinta">{p.valor}</p>
          <p className="mt-1 font-medium text-tinta">{p.titulo}</p>
          <p className="mt-1 text-[13px] leading-snug text-tinta-3">{p.texto}</p>
          {i < passos.length - 1 && (
            <span aria-hidden className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 place-items-center rounded-full border border-borda bg-superficie text-[12px] text-tinta-3 md:grid">
              →
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export default function Pesquisa() {
  const { cores: c } = useTema();
  const [nTabelas, setNTabelas] = useState<number | null>(null);
  useEffect(() => {
    obterManifesto().then((m) => setNTabelas(Object.keys(m.tabelas).length), () => {});
  }, []);

  // O recorte em números, calculado do dado (a lista não é escrita à mão).
  const cbo = useConsulta(`
    SELECT count(DISTINCT cbo)::DOUBLE AS ocupacoes, count(DISTINCT familia)::DOUBLE AS familias, count(DISTINCT area)::DOUBLE AS areas
    FROM rais_recorte_cbo WHERE ano = ${ULTIMO_RAIS} AND estoque_3112 > 0`);
  const cnae = useConsulta(`
    SELECT count(DISTINCT coalesce(setor_empresa, '?'))::DOUBLE AS atividades
    FROM rais_setor_vs_ocupacao WHERE setor_ti AND ano = ${ULTIMO_RAIS} AND estoque_3112 > 0`);
  const lugares = useConsulta(`
    SELECT count(DISTINCT cod_municipio)::DOUBLE AS municipios, count(DISTINCT uf)::DOUBLE AS estados, any_value(ano) AS ano
    FROM mapa_municipio WHERE estoque > 0 AND uf IN (${UFS.map(literal).join(", ")})
      AND ano = (SELECT max(ano) FROM mapa_municipio WHERE estoque > 0)`);
  const cobertura = useConsulta(`
    SELECT (SELECT min(ano) FROM rais_estoque_anual) AS de, (SELECT max(ano) FROM rais_estoque_anual) AS ate_rais,
           (SELECT count(*) FROM serie_mensal)::DOUBLE AS meses, (SELECT strftime(max(mes), '%m/%Y') FROM serie_mensal) AS ate_caged`);

  // RAIS: quem está no recorte, por área, no último ano.
  const areas = useConsulta(`
    SELECT area, estoque FROM (
      SELECT area_ti AS area, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_area
      WHERE ano = ${ULTIMO_RAIS} AND area_ti IS NOT NULL GROUP BY 1
      UNION ALL
      SELECT '${OUTRA}', sum(estoque_3112)::DOUBLE FROM rais_setor_vs_ocupacao
      WHERE ano = ${ULTIMO_RAIS} AND setor_ti AND NOT ocupacao_ti)
    ORDER BY estoque DESC`);
  // CAGED: as ocupações de TI que mais contrataram no último ano completo.
  const contratam = useConsulta(`
    SELECT ocupacao, sum(admissoes)::DOUBLE AS admissoes, any_value(ano) AS ano FROM caged_ocupacao
    WHERE ano = ${ULTIMO_CAGED} AND lente <> '${OUTRA}' AND ocupacao IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`);
  const lista = useConsulta(`
    SELECT cbo, ocupacao, area, estoque_3112::DOUBLE AS vinculos FROM rais_recorte_cbo
    WHERE ano = ${ULTIMO_RAIS} AND estoque_3112 > 0 ORDER BY cbo`);
  // A coluna do código CNAE só existe nas Golds mais novas; sem ela, a
  // divisão sai do nome da atividade.
  const sqlAtividades = (comCodigo: boolean) => `
    SELECT coalesce(setor_empresa, 'Subclasse sem descrição no dicionário') AS atividade, ${comCodigo ? "any_value(cnae) AS cnae," : ""}
           sum(estoque_3112)::DOUBLE AS vinculos
    FROM rais_setor_vs_ocupacao WHERE setor_ti AND ano = ${ULTIMO_RAIS} AND estoque_3112 > 0 GROUP BY 1 ORDER BY 2 DESC`;
  const atividadesCod = useConsulta(sqlAtividades(true));
  const atividadesNome = useConsulta(atividadesCod.erro ? sqlAtividades(false) : null);
  const atividades = atividadesCod.erro ? atividadesNome : atividadesCod;
  // O tamanho da base: registros de cada camada, contados no rodapé dos Parquet.
  const volume = useConsulta(`SELECT camada, base, tabela, registros::DOUBLE AS registros, bytes::DOUBLE AS bytes, ano_inicial, ano_final FROM plataforma_volume`);

  // Um número por pergunta, para o roteiro.
  const estoque = useConsulta(`SELECT ano, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_anual WHERE ${TI} GROUP BY 1 ORDER BY 1`);
  const lentes = useConsulta(`
    SELECT sum(estoque_3112) FILTER (WHERE ocupacao_ti AND NOT setor_ti)::DOUBLE AS fora,
           sum(estoque_3112) FILTER (WHERE ocupacao_ti)::DOUBLE AS profissionais
    FROM rais_setor_vs_ocupacao WHERE ano = ${ULTIMO_RAIS}`);
  const mediana = useConsulta(`SELECT ano, mediana_sm FROM rais_mediana WHERE recorte = 'total' ORDER BY ano`);
  const hiato = useConsulta(`SELECT comparacao, hiato_pct FROM hiato_serie WHERE ano = (SELECT max(ano) FROM hiato_serie)`);
  const projecao = useConsulta("SELECT ano, estoque_estimado FROM nowcast_projecao");

  const k = { cbo: cbo.linhas[0], cnae: cnae.linhas[0], lug: lugares.linhas[0], cob: cobertura.linhas[0] };
  const e = estoque.linhas;
  const md = mediana.linhas;
  const parda = hiato.linhas.find((l) => l.comparacao === "Branca vs Parda");
  const genero = hiato.linhas.find((l) => l.comparacao === "Homem vs Mulher");
  const pr = projecao.linhas[0];
  const ln = lentes.linhas[0];

  const chamada: Record<string, string | null> = {
    crescimento: e.length > 1 ? `+${fmtDec((num(e.at(-1), "estoque") / num(e[0], "estoque") - 1) * 100, 0)}% de vínculos desde ${num(e[0], "ano")}` : null,
    onde: ln ? `${fmtDec((num(ln, "fora") / num(ln, "profissionais")) * 100, 0)}% dos profissionais de TI estão fora das empresas de TI` : null,
    qualidade: md.length > 1 ? `Mediana de ${fmtDec(num(md.at(-1), "mediana_sm"), 2)} salários mínimos, ${fmtDec(num(md[0], "mediana_sm"), 2)} em ${num(md[0], "ano")}` : null,
    equidade: parda && genero ? `Brancos ganham ${fmtDec(num(parda, "hiato_pct"), 0)}% mais que pardos; homens, ${fmtDec(num(genero, "hiato_pct"), 1)}% mais que mulheres` : null,
    futuro: pr ? `${fmtCompacto(num(pr, "estoque_estimado"))} vínculos estimados para ${num(pr, "ano")}` : null,
  };

  // Silver de TI: os registros brutos do recorte (o número que importa);
  // Bronze: todo o emprego formal de onde eles foram tirados.
  const vol = (() => {
    const v = volume.linhas;
    if (!v.length) return null;
    const soma = (f: (l: Linha) => boolean, campo = "registros") => v.filter(f).reduce((s, l) => s + num(l, campo), 0);
    const silver = (l: Linha) => String(l.camada).startsWith("Silver");
    const bronze = (l: Linha) => String(l.camada) === "Bronze";
    const fatos = (l: Linha) => l.tabela !== "rais_estab";
    const r = {
      raisVinc: soma((l) => silver(l) && l.tabela === "rais_vinc"),
      raisEstab: soma((l) => silver(l) && l.tabela === "rais_estab"),
      caged: soma((l) => silver(l) && l.base === "CAGED"),
      bronze: soma((l) => bronze(l) && fatos(l)),
      bronzeBytes: soma(bronze, "bytes"),
      anoFinal: Math.max(...v.map((l) => num(l, "ano_final")).filter(Number.isFinite)),
    };
    return { ...r, ti: r.raisVinc + r.caged };
  })();

  const op = useMemo(
    () => ({
      cbo: lista.linhas.length ? opcaoHierarquia(c, arvoreCbo(lista.linhas), { formato: fmtNum, unidade: "vínculos" }) : null,
      cnae: atividades.linhas.length ? opcaoHierarquia(c, arvoreCnae(atividades.linhas), { formato: fmtNum, unidade: "vínculos" }) : null,
      areas: areas.linhas.length
        ? opcaoBarras(c, rotulos(areas.linhas, "area"), coluna(areas.linhas, "estoque"), { horizontal: true, nome: "Vínculos", formato: fmtNum, larguraRotulo: 210 })
        : null,
      contratam: contratam.linhas.length
        ? opcaoBarras(c, rotulos(contratam.linhas, "ocupacao"), coluna(contratam.linhas, "admissoes"), { horizontal: true, nome: "Admissões", formato: fmtNum, larguraRotulo: 230 })
        : null,
    }),
    [areas.linhas, contratam.linhas, lista.linhas, atividades.linhas, c],
  );

  const anoRais = num(k.cob, "ate_rais");
  const anoCaged = num(contratam.linhas[0], "ano");

  return (
    <>
      <AvisoNacional />
      <header className="mb-6">
        <p className="sobrelinha">
          <span className="mr-2 inline-block h-2 w-2 rounded-[2px] bg-acento align-middle" />
          Visão geral · RAIS + CAGED · 2007–2026
        </p>
        <h1 className="mt-2 text-[1.6rem] font-semibold leading-tight tracking-tight text-tinta sm:text-3xl">Emprego formal em tecnologia no Brasil</h1>
        <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-tinta-2">
          Cinco perguntas sobre o mercado formal de TI, respondidas com os microdados públicos do Ministério do Trabalho: a RAIS, que fotografa os empregos ativos em 31 de dezembro de cada ano, e o CAGED, que registra cada admissão e cada desligamento, mês a mês.
        </p>
      </header>

      <Bloco
        titulo="O tamanho da base"
        descricao="Cada número do painel sai de microdados: um registro por vínculo de emprego na RAIS e um por admissão ou desligamento no CAGED. Estes são os registros de TI lidos, um a um, de 2007 até hoje."
      >
        <Grade colunas={4}>
          <Kpi
            destaque
            ajuda="silver"
            rotulo="Registros de TI analisados"
            valor={vol ? fmtCompacto(vol.ti) : "—"}
            detalhe={vol ? `${fmtNum(vol.ti)} registros brutos, 2007–${vol.anoFinal}` : volume.carregando ? undefined : "medição disponível após a próxima Gold"}
          />
          <Kpi
            rotulo="Vínculos na RAIS"
            ajuda="estoque"
            valor={vol ? fmtCompacto(vol.raisVinc) : "—"}
            detalhe={vol ? `uma linha por pessoa e emprego, a cada ano · mais ${fmtCompacto(vol.raisEstab)} registros de estabelecimentos` : undefined}
          />
          <Kpi
            rotulo="Movimentações no CAGED"
            ajuda="saldo"
            valor={vol ? fmtCompacto(vol.caged) : "—"}
            detalhe={vol ? "admissões e desligamentos, mês a mês, com as declarações fora do prazo e os ajustes" : undefined}
          />
          <Kpi
            rotulo="Selecionados entre"
            valor={vol ? fmtCompacto(vol.bronze) : "—"}
            detalhe={vol ? `registros de todo o emprego formal do país (${fmtDec((vol.ti / vol.bronze) * 100, 1)}% são de TI) · ${fmtDec(vol.bronzeBytes / 1e9, 0)} GB em Parquet` : undefined}
          />
        </Grade>
        <h3 className="mt-2 text-[15px] font-semibold text-tinta">Como o recorte é feito</h3>
        <Funil
          passos={[
            { camada: "Bronze", valor: vol ? fmtCompacto(vol.bronze) : "—", titulo: "Microdados completos", texto: "Todo o emprego formal do Brasil, como o Ministério do Trabalho publica: RAIS e CAGED, sem filtro." },
            { camada: "Silver de TI", valor: vol ? fmtCompacto(vol.ti) : "—", titulo: "Filtro de TI", texto: "Fica o registro cuja ocupação (CBO) é de TI ou cuja empresa (CNAE) é de TI. Os códigos viram nomes pelo dicionário oficial." },
            { camada: "Gold", valor: nTabelas ? `${nTabelas} tabelas` : "—", titulo: "O que este painel lê", texto: "Os registros somados por ano, mês, estado, município, ocupação e perfil, mais os modelos. Nada aqui é amostra." },
          ]}
        />
      </Bloco>

      <Bloco titulo="O que conta como emprego de TI">
        <Grade colunas={4}>
          <Kpi
            destaque
            ajuda="lentes"
            rotulo="Ocupações de TI (CBO)"
            valor={k.cbo ? fmtNum(num(k.cbo, "ocupacoes")) : "—"}
            detalhe={k.cbo ? `em ${fmtNum(num(k.cbo, "familias"))} famílias e ${fmtNum(num(k.cbo, "areas"))} áreas de atuação` : undefined}
          />
          <Kpi
            ajuda="lentes"
            rotulo="Atividades de empresas de TI (CNAE)"
            valor={k.cnae ? fmtNum(num(k.cnae, "atividades")) : "—"}
            detalhe="software, consultoria, suporte, dados e hospedagem"
          />
          <Kpi
            rotulo={`Municípios com emprego de TI${k.lug ? ` (${num(k.lug, "ano")})` : ""}`}
            valor={k.lug ? fmtNum(num(k.lug, "municipios")) : "—"}
            detalhe={k.lug ? `nos ${fmtNum(num(k.lug, "estados"))} estados` : undefined}
          />
          <Kpi
            rotulo="Período coberto"
            valor={k.cob ? `${num(k.cob, "de")}–${String(k.cob.ate_caged ?? "").slice(-4)}` : "—"}
            detalhe={k.cob ? `${anoRais - num(k.cob, "de") + 1} anos de RAIS e ${fmtNum(num(k.cob, "meses"))} meses de CAGED, até ${k.cob.ate_caged}` : undefined}
          />
        </Grade>
        <Grade>
          <CartaoGrafico
            titulo={`Quem está no recorte · RAIS ${anoRais || ""}`}
            subtitulo="Vínculos ativos em 31/12, por área de atuação · inclui quem trabalha em empresa de TI em outra função"
            ajuda="estoque"
            opcao={op.areas}
            carregando={areas.carregando}
            erro={areas.erro}
            altura={300}
            tabela={{ colunas: [{ chave: "area", rotulo: "Área" }, { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: areas.linhas }}
          />
          <CartaoGrafico
            titulo={`As ocupações que mais contrataram · CAGED ${anoCaged || ""}`}
            subtitulo="Admissões no ano, só ocupações de TI · dentro e fora das empresas de TI"
            ajuda="saldo"
            opcao={op.contratam}
            carregando={contratam.carregando}
            erro={contratam.erro}
            altura={300}
            tabela={{ colunas: [{ chave: "ocupacao", rotulo: "Ocupação" }, { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true }], linhas: contratam.linhas }}
          />
        </Grade>
        <Grade>
          <CartaoGrafico
            titulo="As ocupações do recorte (CBO)"
            subtitulo={`Clique num anel para abrir: grande grupo › família › ocupação · vínculos ativos em ${anoRais || "—"}`}
            ajuda="lentes"
            opcao={op.cbo}
            carregando={lista.carregando}
            erro={lista.erro}
            altura={440}
            rodape="A Classificação Brasileira de Ocupações numera cada ocupação com 6 dígitos: o 1º é o grande grupo, os 4 primeiros são a família. O recorte pega famílias inteiras de TI (como a 2124, analistas de TI) e algumas ocupações avulsas, como o técnico de manutenção de computadores e o encarregado de proteção de dados. Clique no centro para voltar."
            tabela={{
              colunas: [
                { chave: "cbo", rotulo: "CBO" },
                { chave: "ocupacao", rotulo: "Ocupação" },
                { chave: "area", rotulo: "Área" },
                { chave: "vinculos", rotulo: "Vínculos", formato: fmtNum, numero: true },
              ],
              linhas: lista.linhas,
            }}
          />
          <CartaoGrafico
            titulo="As atividades do recorte (CNAE)"
            subtitulo={`Clique num anel para abrir: divisão › atividade · todos os vínculos das empresas de TI em ${anoRais || "—"}`}
            ajuda="lentes"
            opcao={op.cnae}
            carregando={atividades.carregando}
            erro={atividades.erro}
            altura={440}
            rodape="A Classificação Nacional de Atividades Econômicas diz o que a empresa faz. Entram a divisão 62 inteira (software, consultoria e suporte em TI) e, da 63, só dados, hospedagem e portais: agências de notícias ficam de fora. Aqui conta todo mundo que trabalha nessas empresas, de programador a recepcionista."
            tabela={{
              colunas: [
                ...(atividades.linhas.some((l) => l.cnae) ? [{ chave: "cnae", rotulo: "CNAE", formato: (v: unknown) => fmtCnae(String(v ?? "")) }] : []),
                { chave: "atividade", rotulo: "Atividade da empresa" },
                { chave: "vinculos", rotulo: "Vínculos", formato: fmtNum, numero: true },
              ],
              linhas: atividades.linhas,
            }}
          />
        </Grade>
      </Bloco>

      <Bloco titulo="O roteiro: cinco perguntas">
        <nav aria-label="Páginas" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PAGINAS.map((q, i) => (
            <a key={q.id} href={`#/${q.id}`} className="cartao group flex items-start gap-4 p-4 transition-colors hover:border-acento">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-serie-1/12 font-mono text-[14px] font-semibold text-serie-1">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0">
                <span className="block font-medium text-tinta">{q.p}</span>
                {chamada[q.id] && <span className="mt-1 block text-[13px] leading-snug text-tinta-3 group-hover:text-tinta-2">{chamada[q.id]}</span>}
              </span>
            </a>
          ))}
          <a href="#/analise" className="flex items-center gap-4 rounded-[var(--radius-cartao)] bg-acento p-4 text-sobre-acento">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-black/10 font-mono text-[14px] font-semibold">→</span>
            <span>
              <span className="block font-semibold">Análise e conclusões</span>
              <span className="mt-1 block text-[13px] opacity-80">As respostas lidas em conjunto, as ressalvas e o método</span>
            </span>
          </a>
        </nav>
      </Bloco>
    </>
  );
}
