import { useMemo } from "react";
import { CartaoGrafico, CartaoTabela } from "../componentes/Grafico";
import { AvisoNacional, Bloco, Grade, Kpi } from "../componentes/ui";
import { UFS } from "../lib/filtro";
import { fmtCompacto, fmtDec, fmtNum } from "../lib/formato";
import { opcaoBarras } from "../lib/graficos";
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

export default function Pesquisa() {
  const { cores: c } = useTema();

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
    WHERE ano = ${ULTIMO_RAIS} ORDER BY area, vinculos DESC`);
  const atividades = useConsulta(`
    SELECT coalesce(setor_empresa, 'Subclasse sem descrição no dicionário') AS atividade, sum(estoque_3112)::DOUBLE AS vinculos
    FROM rais_setor_vs_ocupacao WHERE setor_ti AND ano = ${ULTIMO_RAIS} GROUP BY 1 ORDER BY 2 DESC`);

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

  const op = useMemo(
    () => ({
      areas: areas.linhas.length
        ? opcaoBarras(c, rotulos(areas.linhas, "area"), coluna(areas.linhas, "estoque"), { horizontal: true, nome: "Vínculos", formato: fmtNum, larguraRotulo: 210 })
        : null,
      contratam: contratam.linhas.length
        ? opcaoBarras(c, rotulos(contratam.linhas, "ocupacao"), coluna(contratam.linhas, "admissoes"), { horizontal: true, nome: "Admissões", formato: fmtNum, larguraRotulo: 230 })
        : null,
    }),
    [areas.linhas, contratam.linhas, c],
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
          <CartaoTabela
            titulo="As ocupações do recorte"
            subtitulo={`Códigos CBO considerados de TI, com os vínculos ativos em ${anoRais || "—"}`}
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
          <CartaoTabela
            titulo="As atividades do recorte"
            subtitulo={`Atividades econômicas (CNAE) das empresas de TI, com os vínculos em ${anoRais || "—"}`}
            tabela={{
              colunas: [
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
