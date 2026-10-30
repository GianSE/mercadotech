import { useMemo } from "react";
import { ArvoreContagem, contarItens, type NoContagem } from "../componentes/ArvoreContagem";
import { CartaoGrafico } from "../componentes/Grafico";
import { AvisoNacional, Bloco, CampoBusca, Grade, Kpi } from "../componentes/ui";
import { UFS } from "../lib/filtro";
import { fmtCompacto, fmtNum, fmtPct, fmtReais, fmtSinal } from "../lib/formato";
import { opcaoLinhas } from "../lib/graficos";
import type { Linha } from "../lib/db";
import { literal, num, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { texto, useParametro } from "../lib/url";
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

const soma = (filhos: NoContagem[]) => filhos.reduce((t, f) => t + f.valor, 0);
const porValor = (a: NoContagem, b: NoContagem) => b.valor - a.valor;

function arvoreCbo(linhas: Linha[]): NoContagem[] {
  const grupos = new Map<string, Map<string, NoContagem[]>>();
  for (const l of linhas) {
    const cbo = String(l.cbo);
    const familias = grupos.get(cbo[0]) ?? new Map<string, NoContagem[]>();
    grupos.set(cbo[0], familias);
    const lista = familias.get(cbo.slice(0, 4)) ?? [];
    familias.set(cbo.slice(0, 4), lista);
    lista.push({ id: `cbo:${cbo}`, codigo: `${cbo.slice(0, 4)}-${cbo.slice(4)}`, nome: String(l.ocupacao), valor: num(l, "vinculos") });
  }
  return [...grupos.entries()].sort().map(([g, familias]) => {
    const filhos = [...familias.entries()].map(([f, ocupacoes]): NoContagem => ({
      id: `familia:${f}`, codigo: f, nome: FAMILIAS_CBO[f] ?? `Família ${f}`, valor: soma(ocupacoes), filhos: ocupacoes.sort(porValor),
    })).sort(porValor);
    return { id: `grupo:${g}`, codigo: g, nome: (GRANDES_GRUPOS[g] ?? g).replace(/^\d · /, ""), valor: soma(filhos), filhos };
  });
}

function arvoreCnae(linhas: Linha[]): NoContagem[] {
  const divisoes = new Map<string, NoContagem[]>();
  for (const l of linhas) {
    const nome = String(l.atividade);
    const codigo = typeof l.cnae === "string" ? l.cnae : "";
    const divisao = codigo ? codigo.slice(0, 2) : divisaoPeloNome(nome);
    const lista = divisoes.get(divisao) ?? [];
    divisoes.set(divisao, lista);
    lista.push({ id: `cnae:${nome}`, codigo: codigo ? fmtCnae(codigo) : "", nome, valor: num(l, "vinculos") });
  }
  return [...divisoes.entries()].sort().map(([d, filhos]) => ({
    id: `divisao:${d}`, codigo: d, nome: (DIVISOES_CNAE[d] ?? d).replace(/^\d+ · /, ""), valor: soma(filhos), filhos: filhos.sort(porValor),
  }));
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
  // A busca filtra as duas listas; o item escolhido (ocupação ou atividade)
  // abre a ficha e vai para o link.
  const [busca, setBusca] = useParametro("busca", "", texto, texto);
  const [item, setItem] = useParametro("item", "", texto, texto);

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
  const lista = useConsulta(!recorte ? null : `
    SELECT cbo, ocupacao, area, estoque_3112::DOUBLE AS vinculos FROM rais_recorte_cbo
    WHERE ano = ${ULTIMO_RAIS} AND estoque_3112 > 0 ORDER BY cbo`);
  // A coluna do código CNAE só existe nas Golds mais novas; sem ela, a
  // divisão sai do nome da atividade.
  const sqlAtividades = (comCodigo: boolean) => `
    SELECT coalesce(setor_empresa, 'Subclasse sem descrição no dicionário') AS atividade, ${comCodigo ? "any_value(cnae) AS cnae," : ""}
           sum(estoque_3112)::DOUBLE AS vinculos
    FROM rais_setor_vs_ocupacao WHERE setor_ti AND ano = ${ULTIMO_RAIS} AND estoque_3112 > 0 GROUP BY 1 ORDER BY 2 DESC`;
  const atividadesCod = useConsulta(!recorte ? null : sqlAtividades(true));
  const atividadesNome = useConsulta(recorte && atividadesCod.erro ? sqlAtividades(false) : null);
  const atividades = atividadesCod.erro ? atividadesNome : atividadesCod;

  const est = estoque.linhas[0];
  const registros = num(volume.linhas[0], "registros");
  const lug = lugares.linhas[0];
  const cob = cobertura.linhas[0];
  const anoRais = num(cob, "ate_rais");
  const ocupacoes = lista.linhas.length;
  const familias = new Set(lista.linhas.map((l) => String(l.cbo).slice(0, 4))).size;
  const nAtividades = atividades.linhas.length;

  const arvores = useMemo(() => ({ cbo: arvoreCbo(lista.linhas), cnae: arvoreCnae(atividades.linhas) }), [lista.linhas, atividades.linhas]);
  const encontrados = busca.trim() ? contarItens(arvores.cbo, busca) + contarItens(arvores.cnae, busca) : undefined;

  // A ficha: o item do link ou, sem escolha, a ocupação com mais vínculos
  // (o slide da ficha nunca abre vazio).
  const maior = [...lista.linhas].sort((a, b) => num(b, "vinculos") - num(a, "vinculos"))[0];
  const escolhido = item || (maior ? `cbo:${maior.cbo}` : "");
  const [lenteFicha, chaveFicha] = [escolhido.split(":")[0], escolhido.slice(escolhido.indexOf(":") + 1)];
  const ehCbo = lenteFicha === "cbo";
  const nomeFicha = ehCbo
    ? String(lista.linhas.find((l) => String(l.cbo) === chaveFicha)?.ocupacao ?? "")
    : chaveFicha;
  const infoCbo = ehCbo ? lista.linhas.find((l) => String(l.cbo) === chaveFicha) : undefined;
  const serieRais = useConsulta(!recorte || !escolhido ? null : ehCbo
    ? `SELECT ano, estoque_3112::DOUBLE AS vinculos FROM rais_recorte_cbo WHERE cbo = ${literal(chaveFicha)} ORDER BY ano`
    : `SELECT ano, sum(estoque_3112)::DOUBLE AS vinculos FROM rais_setor_vs_ocupacao
       WHERE setor_ti AND coalesce(setor_empresa, 'Subclasse sem descrição no dicionário') = ${literal(chaveFicha)} GROUP BY 1 ORDER BY 1`);
  // O CAGED da ocupação: as duas lentes em que ela é ocupação de TI (dentro
  // e fora das empresas de TI), pelo nome, que é o mesmo nas duas bases.
  const serieCaged = useConsulta(!recorte || !ehCbo || !nomeFicha ? null : `
    SELECT ano, sum(admissoes)::DOUBLE AS admissoes, sum(desligamentos)::DOUBLE AS desligamentos, sum(saldo)::DOUBLE AS saldo,
           sum(soma_salario_adm) / nullif(sum(n_salario_adm), 0) AS salario
    FROM caged_ocupacao
    WHERE lower(ocupacao) = lower(${literal(nomeFicha)}) AND lente <> 'Outra ocupação em empresa de TI'
    GROUP BY 1 ORDER BY 1`);
  const ultimoCaged = String(cob?.ate_caged ?? "");
  const anoCompleto = ultimoCaged.startsWith("12/") ? Number(ultimoCaged.slice(-4)) : Number(ultimoCaged.slice(-4)) - 1;

  const sr = serieRais.linhas;
  const ultimo = sr.at(-1);
  const dezAntes = sr.find((l) => num(l, "ano") === num(ultimo, "ano") - 10) ?? sr[0];
  const cagedAno = serieCaged.linhas.find((l) => num(l, "ano") === anoCompleto);
  // Só anos completos no gráfico: o ano corrente, parcial, despencaria a linha no fim.
  const cagedCompletos = serieCaged.linhas.filter((l) => num(l, "ano") <= anoCompleto);
  const escolher = (no: NoContagem) => {
    setItem(no.id);
    requestAnimationFrame(() => document.getElementById("ficha")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const totalLente = ehCbo ? arvores.cbo.reduce((t, n) => t + n.valor, 0) : arvores.cnae.reduce((t, n) => t + n.valor, 0);

  const op = useMemo(() => ({
    rais: sr.length
      ? opcaoLinhas(c, sr.map((l) => num(l, "ano")), [{ nome: "Vínculos em 31/12", cor: c.series[0], dados: sr.map((l) => num(l, "vinculos")), rotuloFinal: true }], { formato: fmtNum })
      : null,
    caged: cagedCompletos.length
      ? opcaoLinhas(c, cagedCompletos.map((l) => num(l, "ano")), [
          { nome: "Admissões", cor: c.series[0], dados: cagedCompletos.map((l) => num(l, "admissoes")) },
          { nome: "Desligamentos", cor: c.series[1], dados: cagedCompletos.map((l) => num(l, "desligamentos")) },
        ], { formato: fmtNum })
      : null,
  }), [sr, cagedCompletos, c]);

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
      <>
      <Bloco
        titulo="As duas lentes do recorte"
        descricao="Um emprego entra no recorte pela ocupação da pessoa (CBO) ou pela atividade da empresa em que ela trabalha (CNAE). Clique num item para ver a ficha dele."
      >
        <div className="flex flex-wrap items-end gap-4">
          <CampoBusca rotulo="Buscar ocupação ou atividade" valor={busca} aoMudar={setBusca} placeholder="Ex.: analista, programador, 2124, 6201" largura="sm:w-80" encontrados={encontrados} />
        </div>
        <Grade>
          <ArvoreContagem
            titulo={ocupacoes ? `${ocupacoes} ocupações de TI · CBO` : "Ocupações de TI · CBO"}
            subtitulo={`${familias ? `${familias} famílias · ` : ""}vínculos em 31/12/${anoRais || "—"}`}
            ajuda="lentes"
            nos={arvores.cbo}
            busca={busca}
            selecionado={escolhido}
            aoSelecionar={escolher}
            carregando={lista.carregando}
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
          <ArvoreContagem
            titulo={nAtividades ? `${nAtividades} atividades de empresas de TI · CNAE` : "Atividades de empresas de TI · CNAE"}
            subtitulo={`divisões 62 e 63 · vínculos em 31/12/${anoRais || "—"}`}
            ajuda="lentes"
            nos={arvores.cnae}
            busca={busca}
            selecionado={escolhido}
            aoSelecionar={escolher}
            carregando={atividades.carregando}
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

      {escolhido && (
        <div id="ficha" className="scroll-mt-24">
        <Bloco
          titulo={nomeFicha || "Ficha"}
          descricao={ehCbo
            ? `Ocupação ${infoCbo ? `${String(infoCbo.cbo).slice(0, 4)}-${String(infoCbo.cbo).slice(4)} · família ${String(infoCbo.cbo).slice(0, 4)} · área ${String(infoCbo.area ?? "—")}` : ""}`
            : "Atividade de empresa de TI (CNAE): todos os vínculos nas empresas desta atividade, de qualquer ocupação."}
        >
          <Grade colunas={ehCbo ? 4 : 3}>
            <Kpi destaque rotulo={`Vínculos em ${num(ultimo, "ano") || "—"}`} valor={ultimo ? fmtNum(num(ultimo, "vinculos")) : "—"} detalhe={totalLente && ultimo ? `${fmtPct((num(ultimo, "vinculos") / totalLente) * 100, 1)} da lente` : undefined} />
            <Kpi
              rotulo={dezAntes && ultimo ? `Desde ${num(dezAntes, "ano")}` : "Crescimento"}
              valor={dezAntes && ultimo && num(dezAntes, "vinculos") ? `${num(ultimo, "vinculos") >= num(dezAntes, "vinculos") ? "+" : ""}${fmtPct((num(ultimo, "vinculos") / num(dezAntes, "vinculos") - 1) * 100, 0)}` : "—"}
              detalhe={dezAntes ? `eram ${fmtNum(num(dezAntes, "vinculos"))} vínculos` : undefined}
            />
            {ehCbo ? (
              <>
                <Kpi rotulo={`Saldo no CAGED em ${anoCompleto}`} valor={cagedAno ? fmtSinal(num(cagedAno, "saldo")) : "—"} detalhe={cagedAno ? `${fmtNum(num(cagedAno, "admissoes"))} admissões` : undefined} />
                <Kpi rotulo={`Salário de admissão em ${anoCompleto}`} valor={cagedAno?.salario != null ? fmtReais(num(cagedAno, "salario")) : "—"} detalhe="média no CAGED" />
              </>
            ) : (
              <Kpi rotulo="Lente" valor="Setor de TI" detalhe="pela atividade da empresa" />
            )}
          </Grade>
          {/* Ocupação: a RAIS e o CAGED lado a lado; atividade: só a RAIS, na largura toda. */}
          <div className={`grid gap-4 [&>*]:min-w-0 ${ehCbo ? "lg:grid-cols-2" : ""}`}>
            <CartaoGrafico
              titulo="Vínculos ano a ano"
              subtitulo="RAIS · ativos em 31/12"
              opcao={op.rais}
              carregando={serieRais.carregando}
              erro={serieRais.erro}
              altura={260}
              tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "vinculos", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: sr }}
            />
            {ehCbo && (
              <CartaoGrafico
                titulo="Admissões e desligamentos"
                subtitulo={`CAGED · anos completos, até ${anoCompleto || "—"}`}
                opcao={op.caged}
                carregando={serieCaged.carregando}
                erro={serieCaged.erro}
                altura={260}
                tabela={{
                  colunas: [
                    { chave: "ano", rotulo: "Ano" },
                    { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true },
                    { chave: "desligamentos", rotulo: "Desligamentos", formato: fmtNum, numero: true },
                    { chave: "saldo", rotulo: "Saldo", formato: fmtSinal, numero: true },
                    { chave: "salario", rotulo: "Salário de admissão", formato: fmtReais, numero: true },
                  ],
                  linhas: serieCaged.linhas,
                }}
              />
            )}
          </div>
        </Bloco>
        </div>
      )}
      </>
      )}
    </>
  );
}
