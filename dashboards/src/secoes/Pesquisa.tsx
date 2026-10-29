import { useMemo } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { AvisoNacional, Bloco, Grade, Kpi } from "../componentes/ui";
import { UFS } from "../lib/filtro";
import { fmtCompacto, fmtNum } from "../lib/formato";
import { opcaoHierarquia, type NoHierarquia } from "../lib/graficos";
import type { Linha } from "../lib/db";
import { literal, num, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

// A visão geral só situa quem chega, nesta ordem: o que é o painel e as duas
// bases (RAIS e CAGED), os números do recorte e o que
// conta como TI (CBO e CNAE). As respostas ficam nas páginas de cada
// pergunta e na Análise.
const ULTIMO_RAIS = "(SELECT max(ano) FROM rais_estoque_anual)";

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

// As duas bases, em uma frase cada, para quem nunca ouviu falar delas.
const FONTES = [
  {
    sigla: "RAIS",
    apelido: "a fotografia do ano",
    texto: "Relação Anual de Informações Sociais: uma vez por ano, toda empresa declara cada emprego formal, com ocupação, salário e perfil de quem estava empregado em 31 de dezembro.",
  },
  {
    sigla: "CAGED",
    apelido: "o filme do mês",
    texto: "Cadastro Geral de Empregados e Desempregados: registra cada admissão e cada desligamento, mês a mês, e mostra o mercado em movimento.",
  },
];

// A visão geral em duas páginas: a apresentação (o painel, as bases e os
// números) e o recorte (o que conta como TI, pela CBO e pela CNAE).
export type PartePesquisa = "apresentacao" | "recorte";

export default function Pesquisa({ parte = "apresentacao" }: { parte?: PartePesquisa }) {
  const recorte = parte === "recorte";
  const { cores: c } = useTema();

  const estoque = useConsulta(`SELECT ano, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_anual WHERE ${TI} AND ano = ${ULTIMO_RAIS} GROUP BY 1`);
  // Os registros brutos do recorte (Silver de TI), contados no rodapé dos Parquet.
  const volume = useConsulta(`
    SELECT sum(registros) FILTER (WHERE camada LIKE 'Silver%' AND tabela <> 'rais_estab')::DOUBLE AS registros
    FROM plataforma_volume`);
  const lugares = useConsulta(`
    SELECT count(DISTINCT cod_municipio)::DOUBLE AS municipios, count(DISTINCT uf)::DOUBLE AS estados
    FROM mapa_municipio WHERE estoque > 0 AND uf IN (${UFS.map(literal).join(", ")})
      AND ano = (SELECT max(ano) FROM mapa_municipio WHERE estoque > 0)`);
  const cobertura = useConsulta(`
    SELECT (SELECT min(ano) FROM rais_estoque_anual) AS de, (SELECT max(ano) FROM rais_estoque_anual) AS ate_rais,
           (SELECT strftime(max(mes), '%m/%Y') FROM serie_mensal) AS ate_caged`);
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

  const est = estoque.linhas[0];
  const registros = num(volume.linhas[0], "registros");
  const lug = lugares.linhas[0];
  const cob = cobertura.linhas[0];
  const anoRais = num(cob, "ate_rais");
  const ocupacoes = lista.linhas.length;
  const familias = new Set(lista.linhas.map((l) => String(l.cbo).slice(0, 4))).size;
  const nAtividades = atividades.linhas.length;

  const op = useMemo(
    () => ({
      cbo: lista.linhas.length ? opcaoHierarquia(c, arvoreCbo(lista.linhas), { formato: fmtNum, unidade: "vínculos" }) : null,
      cnae: atividades.linhas.length ? opcaoHierarquia(c, arvoreCnae(atividades.linhas), { formato: fmtNum, unidade: "vínculos" }) : null,
    }),
    [lista.linhas, atividades.linhas, c],
  );

  return (
    <>
      <AvisoNacional />
      <header className="mb-6">
        <p className="sobrelinha">
          <span className="mr-2 inline-block h-2 w-2 rounded-[2px] bg-acento align-middle" />
          Visão geral · RAIS + CAGED · 2007–2026
        </p>
        <h1 className="mt-2 text-[1.6rem] font-semibold leading-tight tracking-tight text-tinta sm:text-3xl">{recorte ? "O que conta como emprego de TI" : "Emprego formal em tecnologia no Brasil"}</h1>
      </header>
      {!recorte && (
        <>
      <header className="-mt-4 mb-6">
        <p className="max-w-3xl text-[15px] leading-relaxed text-tinta-2">
          Este painel acompanha o mercado de trabalho de TI no Brasil desde 2007, com os dados públicos do Ministério do Trabalho. Duas bases contam essa história:
        </p>
      </header>
      <div className="mb-10 grid gap-3 sm:grid-cols-2">
        {FONTES.map((fonte) => (
          <div key={fonte.sigla} className="cartao p-4">
            <p className="sobrelinha">{fonte.sigla} · {fonte.apelido}</p>
            <p className="mt-2 text-[14px] leading-relaxed text-tinta-2">{fonte.texto}</p>
            <p className="mt-2 text-[12px] text-tinta-3">{fonte.sigla === "RAIS" ? `Aqui: ${num(cob, "de") || 2007} a ${anoRais || "—"}` : `Aqui: de 2007 a ${cob?.ate_caged ?? "—"}`}</p>
          </div>
        ))}
      </div>

        </>
      )}
      {!recorte && (
      <Bloco titulo="Os dados em números">
      <Grade colunas={4}>
        <Kpi destaque ajuda="estoque" rotulo={`Empregos de TI em ${num(est, "ano") || "—"}`} valor={est ? fmtCompacto(num(est, "estoque")) : "—"} detalhe="vínculos formais ativos em 31/12" />
        <Kpi ajuda="silver" rotulo="Registros analisados" valor={registros ? fmtCompacto(registros) : "—"} detalhe="vínculos da RAIS e movimentações do CAGED" />
        <Kpi rotulo="Municípios" valor={lug ? fmtNum(num(lug, "municipios")) : "—"} detalhe={lug ? `com emprego de TI, nos ${fmtNum(num(lug, "estados"))} estados` : undefined} />
        <Kpi rotulo="Período" valor={cob ? `${num(cob, "de")}–${String(cob.ate_caged ?? "").slice(-4)}` : "—"} detalhe={cob ? `RAIS até ${anoRais} · CAGED até ${cob.ate_caged}` : undefined} />
      </Grade>
      </Bloco>
      )}

      {recorte && (
      <Bloco
        titulo="As duas lentes do recorte"
        descricao="Um emprego entra no recorte pela ocupação da pessoa (CBO) ou pela atividade da empresa em que ela trabalha (CNAE)."
      >
        <Grade>
          <CartaoGrafico
            titulo={ocupacoes ? `${ocupacoes} ocupações de TI · CBO` : "Ocupações de TI · CBO"}
            subtitulo={`${familias ? `${familias} famílias ocupacionais · ` : ""}vínculos em ${anoRais || "—"} · clique para abrir`}
            ajuda="lentes"
            opcao={op.cbo}
            carregando={lista.carregando}
            erro={lista.erro}
            altura={420}
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
            titulo={nAtividades ? `${nAtividades} atividades de empresas de TI · CNAE` : "Atividades de empresas de TI · CNAE"}
            subtitulo={`divisões 62 e 63 · vínculos em ${anoRais || "—"} · clique para abrir`}
            ajuda="lentes"
            opcao={op.cnae}
            carregando={atividades.carregando}
            erro={atividades.erro}
            altura={420}
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
      )}
    </>
  );
}
