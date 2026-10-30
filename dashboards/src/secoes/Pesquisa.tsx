import { useMemo } from "react";
import { acharNo, ArvoreContagem, caminhoAte, folhasDe, ramo, type NoContagem } from "../componentes/ArvoreContagem";
import { SeletorArvore } from "../componentes/SeletorArvore";
import { CartaoGrafico } from "../componentes/Grafico";
import { AvisoNacional, Bloco, Grade, Kpi, LinhaFiltros, Seletor } from "../componentes/ui";
import { UFS } from "../lib/filtro";
import { fmtCompacto, fmtNum, fmtPct, fmtReais, fmtSinal } from "../lib/formato";
import { opcaoHierarquia, opcaoLinhas, type NoHierarquia, type SerieLinha } from "../lib/graficos";
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

// A lista no formato do gráfico de sol, com os rótulos de antes (grupo e
// família "código · nome", item "código nome") e a cor fixa de cada grupo.
function paraHierarquia(nos: NoContagem[], cor?: (codigo: string) => string): NoHierarquia[] {
  return nos.map((n) => ({
    nome: n.filhos?.length ? `${n.codigo} · ${n.nome}` : `${n.codigo} ${n.nome}`.trim(),
    valor: n.filhos?.length ? undefined : n.valor,
    filhos: n.filhos?.length ? paraHierarquia(n.filhos) : undefined,
    cor: cor?.(n.codigo),
  }));
}

// Do rótulo de uma fatia do gráfico de sol de volta ao item (para a ficha).
function itensPorRotulo(nos: NoContagem[], mapa = new Map<string, NoContagem>()): Map<string, NoContagem> {
  for (const n of nos) {
    if (n.filhos?.length) {
      mapa.set(`${n.codigo} · ${n.nome}`, n);
      itensPorRotulo(n.filhos, mapa);
    } else mapa.set(`${n.codigo} ${n.nome}`.trim(), n);
  }
  return mapa;
}

// O nível abaixo de cada escolha, no plural do título do gráfico.
const NIVEL_ABAIXO: Record<string, string> = {
  "cbo:todas": "grande grupo", grupo: "família", familia: "ocupação",
  "cnae:todas": "divisão", divisao: "atividade",
};
const soDigitos = (s: string) => s.replace(/\D/g, "");
// Rótulo curto de uma linha: código e nome, sem estourar a legenda.
const rotuloLinha = (n: NoContagem) => `${n.codigo} ${n.nome.length > 34 ? `${n.nome.slice(0, 33)}…` : n.nome}`;

// O que está escolhido: o total de uma lente, um grupo, uma família ou um item.
const TODAS_CBO = "cbo:todas";
const TODAS_CNAE = "cnae:todas";
const ehDaCbo = (id: string) => /^(cbo|grupo|familia):/.test(id);

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
  // O que os menus escolhem: todas as ocupações (o padrão), um grupo, uma
  // família ou uma ocupação da CBO, ou o mesmo na CNAE. Vai para o link.
  const [item, setItem] = useParametro("item", TODAS_CBO, texto, texto);
  // Círculo (o padrão) ou lista.
  const [ver, setVer] = useParametro<"circulo" | "lista">("ver", "circulo", (v) => (v === "lista" ? "lista" : "circulo"), texto);

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

  const arvores = useMemo(() => ({ cbo: arvoreCbo(lista.linhas), cnae: arvoreCnae(atividades.linhas) }), [lista.linhas, atividades.linhas]);

  const escolhido = item || TODAS_CBO;
  const ehCbo = ehDaCbo(escolhido);
  const todas = escolhido === TODAS_CBO || escolhido === TODAS_CNAE;
  const noFicha = todas ? undefined : acharNo(ehCbo ? arvores.cbo : arvores.cnae, escolhido);
  const nivelFicha = escolhido.split(":")[0];
  // Cada menu mostra a escolha da sua lente; o outro fica no total.
  const selCbo = ehCbo ? escolhido : TODAS_CBO;
  const selCnae = ehCbo ? TODAS_CNAE : escolhido;
  // Grupo, família ou divisão escolhidos: os gráficos mostram só aquele ramo.
  const podar = (nos: NoContagem[], id: string) => (id.endsWith(":todas") || !acharNo(nos, id)?.filhos?.length ? nos : ramo(nos, id));
  const visCbo = podar(arvores.cbo, selCbo);
  const visCnae = podar(arvores.cnae, selCnae);
  // Os títulos acompanham o ramo mostrado.
  const nVisCbo = visCbo.flatMap(folhasDe).length;
  const nVisCnae = visCnae.flatMap(folhasDe).length;
  const nomeSelCbo = selCbo === TODAS_CBO ? "" : acharNo(arvores.cbo, selCbo)?.nome ?? "";
  const nomeSelCnae = selCnae === TODAS_CNAE ? "" : acharNo(arvores.cnae, selCnae)?.nome ?? "";
  const circulos = useMemo(() => ({
    cbo: visCbo.length ? opcaoHierarquia(c, paraHierarquia(visCbo, (g) => c.series[Number(g) - 1] ?? c.series[0]), { formato: fmtNum, unidade: "vínculos" }) : null,
    cnae: visCnae.length ? opcaoHierarquia(c, paraHierarquia(visCnae, (d) => c.series[d === "63" ? 1 : 0]), { formato: fmtNum, unidade: "vínculos" }) : null,
    itens: itensPorRotulo([...arvores.cbo, ...arvores.cnae]),
  }), [visCbo, visCnae, arvores, c]);

  // As consultas da ficha valem para qualquer nível: o total, um grupo, uma
  // família ou um item. Na CBO, pelo prefixo do código; na CNAE, pelos nomes
  // das atividades debaixo do nó.
  const prefixo = !ehCbo || todas ? "" : nivelFicha === "cbo" ? escolhido.slice(4) : noFicha?.codigo ?? "";
  const folhasFicha = noFicha ? folhasDe(noFicha) : [];
  const nomesCbo = lista.linhas.filter((l) => String(l.cbo).startsWith(prefixo)).map((l) => String(l.ocupacao));
  // Drill down: a ficha desenha uma linha por filho do nível escolhido
  // (todas -> grande grupo -> família -> ocupação; na CNAE, todas -> divisão
  // -> atividade). No item, uma linha só, e não há mais o que abrir.
  const ehFolha = !todas && !noFicha?.filhos?.length;
  // Sem escolha, uma linha só (a soma da lente); a quebra por filho começa
  // no primeiro nível escolhido. Os botões de abrir aparecem desde o topo.
  const linhaUnica = ehFolha || todas;
  const filhosFicha: NoContagem[] = todas ? (ehCbo ? arvores.cbo : arvores.cnae) : ehFolha ? (noFicha ? [noFicha] : []) : noFicha!.filhos!;
  const nivelAbaixo = NIVEL_ABAIXO[todas ? escolhido : nivelFicha] ?? "";
  const cboDoNome = new Map(lista.linhas.map((l) => [String(l.ocupacao).toLowerCase(), String(l.cbo)]));
  const filhoDe = (chave: string): NoContagem | undefined => ehCbo
    ? filhosFicha.find((f) => chave.startsWith(soDigitos(f.codigo)))
    : filhosFicha.find((f) => folhasDe(f).some((x) => x.nome === chave));
  const serieRais = useConsulta(!recorte ? null : ehCbo
    ? `SELECT ano, cbo::VARCHAR AS chave, sum(estoque_3112)::DOUBLE AS vinculos FROM rais_recorte_cbo
       ${prefixo ? `WHERE cbo LIKE ${literal(prefixo + "%")}` : ""} GROUP BY 1, 2 ORDER BY 1`
    : `SELECT ano, coalesce(setor_empresa, 'Subclasse sem descrição no dicionário') AS chave, sum(estoque_3112)::DOUBLE AS vinculos
       FROM rais_setor_vs_ocupacao
       WHERE setor_ti ${todas ? "" : `AND coalesce(setor_empresa, 'Subclasse sem descrição no dicionário') IN (${folhasFicha.flatMap(folhasDe).map((f) => literal(f.nome)).join(", ") || "''"})`}
       GROUP BY 1, 2 ORDER BY 1`);
  // O CAGED das ocupações escolhidas: as duas lentes em que elas são
  // ocupação de TI (dentro e fora das empresas de TI), pelo nome, que é o
  // mesmo nas duas bases. Na CNAE, a ficha fica só com a RAIS.
  const serieCaged = useConsulta(!recorte || !ehCbo || (!todas && !nomesCbo.length) ? null : `
    SELECT ano, ocupacao AS chave, sum(admissoes)::DOUBLE AS admissoes, sum(desligamentos)::DOUBLE AS desligamentos,
           sum(saldo)::DOUBLE AS saldo, sum(soma_salario_adm)::DOUBLE AS soma_salario, sum(n_salario_adm)::DOUBLE AS n_salario
    FROM caged_ocupacao
    WHERE lente <> 'Outra ocupação em empresa de TI'
      ${todas ? "" : `AND lower(ocupacao) IN (${nomesCbo.map((n) => `lower(${literal(n)})`).join(", ")})`}
    GROUP BY 1, 2 ORDER BY 1`);
  const nOcupacoesFicha = todas ? ocupacoes : folhasFicha.length;
  const tituloFicha = todas ? (ehCbo ? "Todas as ocupações de TI" : "Todas as atividades de empresas de TI") : noFicha?.nome ?? "Ficha";
  const descricaoFicha = ehCbo
    ? todas
      ? `As ${ocupacoes} ocupações de TI da CBO, somadas. Escolha um grupo, uma família ou uma ocupação no menu acima.`
      : nivelFicha === "grupo"
        ? `Grande grupo ${noFicha?.codigo} da CBO · ${nOcupacoesFicha} ocupações de TI somadas`
        : nivelFicha === "familia"
          ? `Família ${noFicha?.codigo} da CBO · ${nOcupacoesFicha} ocupações de TI somadas`
          : `Ocupação ${noFicha?.codigo ?? ""} · família ${prefixo.slice(0, 4)} · área ${String(lista.linhas.find((l) => String(l.cbo) === prefixo)?.area ?? "—")}`
    : todas
      ? "As atividades das divisões 62 e 63 da CNAE, somadas: todos os vínculos nas empresas de TI, de qualquer ocupação."
      : nivelFicha === "divisao"
        ? `Divisão ${noFicha?.codigo} da CNAE · ${nOcupacoesFicha} atividades somadas: todos os vínculos nas empresas, de qualquer ocupação.`
        : "Atividade de empresa de TI (CNAE): todos os vínculos nas empresas desta atividade, de qualquer ocupação."
  const ultimoCaged = String(cob?.ate_caged ?? "");
  const anoCompleto = ultimoCaged.startsWith("12/") ? Number(ultimoCaged.slice(-4)) : Number(ultimoCaged.slice(-4)) - 1;

  // Os totais do nível (para os indicadores) e uma série por filho (para as linhas).
  const somarPorAno = <T extends Record<string, number>>(linhas: Linha[], campos: (keyof T & string)[]) => {
    const anos = new Map<number, Record<string, number>>();
    for (const l of linhas) {
      const a = anos.get(num(l, "ano")) ?? Object.fromEntries(campos.map((k) => [k, 0]));
      for (const k of campos) a[k] += num(l, k);
      anos.set(num(l, "ano"), a);
    }
    return [...anos.entries()].sort(([x], [y]) => x - y).map(([ano, v]) => ({ ano, ...v }) as Linha);
  };
  const sr = somarPorAno(serieRais.linhas, ["vinculos"]);
  const cagedTotal = somarPorAno(serieCaged.linhas, ["admissoes", "desligamentos", "saldo", "soma_salario", "n_salario"])
    .map((l) => ({ ...l, salario: num(l, "n_salario") ? num(l, "soma_salario") / num(l, "n_salario") : null }) as Linha);
  const ultimo = sr.at(-1);
  const dezAntes = sr.find((l) => num(l, "ano") === num(ultimo, "ano") - 10) ?? sr[0];
  const cagedAno = cagedTotal.find((l) => num(l, "ano") === anoCompleto);
  // Só anos completos no gráfico: o ano corrente, parcial, despencaria a linha no fim.
  const cagedCompletos = cagedTotal.filter((l) => num(l, "ano") <= anoCompleto);
  // Uma série por filho, na ordem da árvore (do maior para o menor). Mais de
  // oito viram sete e "Outras": cor nova não se inventa.
  const porFilho = (linhas: Linha[], campo: string, chaveDe: (l: Linha) => string, anos: number[]) => {
    const visiveis = filhosFicha.length > 8 ? filhosFicha.slice(0, 7) : filhosFicha;
    const series: SerieLinha[] = visiveis.map((f, i) => ({ nome: rotuloLinha(f), cor: c.series[i], dados: anos.map(() => 0) }));
    const outras: SerieLinha = { nome: "Outras", cor: c.tinta3, dados: anos.map(() => 0) };
    for (const l of linhas) {
      const f = filhoDe(chaveDe(l));
      const i = anos.indexOf(num(l, "ano"));
      if (!f || i < 0) continue;
      const k = visiveis.indexOf(f);
      const alvo = k >= 0 ? series[k] : outras;
      alvo.dados[i] = (alvo.dados[i] ?? 0) + num(l, campo);
    }
    return filhosFicha.length > 8 ? [...series, outras] : series;
  };
  const tabelaFilhos = (linhas: Linha[], campo: string, chaveDe: (l: Linha) => string) =>
    linhas.flatMap((l) => {
      const f = filhoDe(chaveDe(l));
      return f ? [{ ano: num(l, "ano"), nivel: rotuloLinha(f), valor: num(l, campo) } as Linha] : [];
    });
  const chaveCaged = (l: Linha) => cboDoNome.get(String(l.chave).toLowerCase()) ?? "";
  // A linha clicável: o clique numa linha (e não só num ponto) abre o nível.
  // Os botões de abrir, acima, têm as mesmas cores e fazem de legenda: a do
  // gráfico quebraria em duas linhas com nomes longos e cobriria o eixo.
  const clicavel = (op: ReturnType<typeof opcaoLinhas>) => ({
    ...op,
    legend: { show: false },
    grid: { ...(op.grid as object), top: 24 },
    series: (op.series as object[]).map((x) => ({ ...x, triggerLineEvent: true })),
  });
  const abrir = ({ serie }: { serie?: string }) => {
    const f = filhosFicha.find((x) => rotuloLinha(x) === serie);
    if (f && !linhaUnica) setItem(f.id);
  };
  const trilha = todas ? [] : caminhoAte(ehCbo ? arvores.cbo : arvores.cnae, escolhido);
  // Escolher num gráfico leva à ficha; nos menus, a página fica onde está.
  const escolher = (no: NoContagem) => {
    setItem(no.id);
    requestAnimationFrame(() => document.getElementById("ficha")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const totalLente = ehCbo ? arvores.cbo.reduce((t, n) => t + n.valor, 0) : arvores.cnae.reduce((t, n) => t + n.valor, 0);

  const anosRais = sr.map((l) => num(l, "ano"));
  const anosCaged = cagedCompletos.map((l) => num(l, "ano"));
  const op = {
    rais: !sr.length
      ? null
      : linhaUnica
        ? opcaoLinhas(c, anosRais, [{ nome: "Vínculos em 31/12", cor: c.series[0], dados: sr.map((l) => num(l, "vinculos")), rotuloFinal: true }], { formato: fmtNum })
        : clicavel(opcaoLinhas(c, anosRais, porFilho(serieRais.linhas, "vinculos", (l) => String(l.chave), anosRais), { formato: fmtNum })),
    caged: !cagedCompletos.length
      ? null
      : linhaUnica
        ? opcaoLinhas(c, anosCaged, [
            { nome: "Admissões", cor: c.series[0], dados: cagedCompletos.map((l) => num(l, "admissoes")) },
            { nome: "Desligamentos", cor: c.series[1], dados: cagedCompletos.map((l) => num(l, "desligamentos")) },
          ], { formato: fmtNum })
        : clicavel(opcaoLinhas(c, anosCaged, porFilho(serieCaged.linhas.filter((l) => num(l, "ano") <= anoCompleto), "saldo", chaveCaged, anosCaged), { formato: fmtSinal })),
  };

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
      <LinhaFiltros territorio={false} resumo={[selCbo === TODAS_CBO ? "Todas as ocupações" : acharNo(arvores.cbo, selCbo)?.nome, selCnae === TODAS_CNAE ? "Todas as atividades" : acharNo(arvores.cnae, selCnae)?.nome].join(" · ")}>
        <SeletorArvore
          rotulo="Ocupação · CBO"
          valor={selCbo}
          nos={arvores.cbo}
          todos={{ id: TODAS_CBO, nome: "Todas as ocupações de TI" }}
          aoMudar={setItem}
          placeholder="Buscar: analista, 2124, programador…"
        />
        <SeletorArvore
          rotulo="Atividade da empresa · CNAE"
          valor={selCnae}
          nos={arvores.cnae}
          todos={{ id: TODAS_CNAE, nome: "Todas as atividades de TI" }}
          aoMudar={setItem}
          placeholder="Buscar: software, 6201, consultoria…"
        />
        <Seletor<"circulo" | "lista">
          rotulo="Ver como"
          valor={ver}
          opcoes={[{ valor: "circulo", rotulo: "Círculo" }, { valor: "lista", rotulo: "Lista" }]}
          aoMudar={setVer}
        />
      </LinhaFiltros>
      <Bloco
        titulo="As duas lentes do recorte"
        descricao="Um emprego entra no recorte pela ocupação da pessoa (CBO) ou pela atividade da empresa em que ela trabalha (CNAE). Escolha nos menus acima, ou clique num gráfico, para ver a ficha de um grupo, família ou item."
      >
        <Grade>
          {ver === "lista" ? (
            <>
          <ArvoreContagem
            titulo={nVisCbo ? `${nVisCbo} ocupações de TI · CBO` : "Ocupações de TI · CBO"}
            subtitulo={`${nomeSelCbo || (familias ? `${familias} famílias` : "")} · vínculos em 31/12/${anoRais || "—"}`}
            ajuda="lentes"
            nos={visCbo}
            busca=""
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
            titulo={nVisCnae ? `${nVisCnae} atividades de empresas de TI · CNAE` : "Atividades de empresas de TI · CNAE"}
            subtitulo={`${nomeSelCnae || "divisões 62 e 63"} · vínculos em 31/12/${anoRais || "—"}`}
            ajuda="lentes"
            nos={visCnae}
            busca=""
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
            </>
          ) : (
            <>
          <CartaoGrafico
            titulo={nVisCbo ? `${nVisCbo} ocupações de TI · CBO` : "Ocupações de TI · CBO"}
            subtitulo={`${nomeSelCbo || (familias ? `${familias} famílias` : "")} · vínculos em 31/12/${anoRais || "—"}`}
            ajuda="lentes"
            opcao={circulos.cbo}
            altura={420}
            erro={lista.erro}
            dicaClique="Clique num grupo para abrir; num item, para ver a ficha"
            aoClicar={({ nome }) => { const no = circulos.itens.get(nome); if (no) escolher(no); }}
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
          <CartaoGrafico
            titulo={nVisCnae ? `${nVisCnae} atividades de empresas de TI · CNAE` : "Atividades de empresas de TI · CNAE"}
            subtitulo={`${nomeSelCnae || "divisões 62 e 63"} · vínculos em 31/12/${anoRais || "—"}`}
            ajuda="lentes"
            opcao={circulos.cnae}
            altura={420}
            erro={atividades.erro}
            dicaClique="Clique num grupo para abrir; num item, para ver a ficha"
            aoClicar={({ nome }) => { const no = circulos.itens.get(nome); if (no) escolher(no); }}
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
            </>
          )}
        </Grade>
      </Bloco>

      {escolhido && (
        <div id="ficha" className="mt-12 scroll-mt-24">
        <Bloco
          titulo={tituloFicha}
          descricao={descricaoFicha}
        >
          <nav aria-label="Nível da ficha" className="-mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px]">
            <button type="button" onClick={() => setItem(ehCbo ? TODAS_CBO : TODAS_CNAE)} className={todas ? "font-semibold text-tinta" : "text-serie-1 hover:underline"} aria-current={todas ? "page" : undefined}>
              {ehCbo ? "Todas as ocupações" : "Todas as atividades"}
            </button>
            {trilha.map((n) => (
              <span key={n.id} className="flex items-center gap-1.5">
                <span aria-hidden className="text-tinta-3">›</span>
                <button type="button" onClick={() => setItem(n.id)} className={n.id === escolhido ? "font-semibold text-tinta" : "text-serie-1 hover:underline"} aria-current={n.id === escolhido ? "page" : undefined}>
                  <span className="font-mono text-[11px] text-tinta-3">{n.codigo}</span> {n.nome}
                </button>
              </span>
            ))}
          </nav>
          {!ehFolha && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="sobrelinha">Abrir {nivelAbaixo}</span>
              {filhosFicha.map((f, i) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setItem(f.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-borda px-2.5 py-1 text-[12px] text-tinta-2 transition-colors hover:border-serie-1/60 hover:text-tinta"
                >
                  {!linhaUnica && <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: i < 7 || filhosFicha.length <= 8 ? c.series[i] : c.tinta3 }} />}
                  <span className="font-mono text-[11px] text-tinta-3">{f.codigo}</span>
                  {f.nome}
                </button>
              ))}
            </div>
          )}
          <Grade colunas={ehCbo ? 4 : 3}>
            <Kpi destaque rotulo={`Vínculos em ${num(ultimo, "ano") || "—"}`} valor={ultimo ? fmtNum(num(ultimo, "vinculos")) : "—"} detalhe={!todas && totalLente && ultimo ? `${fmtPct((num(ultimo, "vinculos") / totalLente) * 100, 1)} da lente` : todas ? "o total da lente" : undefined} />
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
              <Kpi rotulo="Lente" valor="Setor de TI" detalhe={nOcupacoesFicha > 1 ? `${nOcupacoesFicha} atividades somadas` : "pela atividade da empresa"} />
            )}
          </Grade>
          {/* Ocupação: a RAIS e o CAGED lado a lado; atividade: só a RAIS, na largura toda. */}
          <div className={`grid gap-4 [&>*]:min-w-0 ${ehCbo ? "lg:grid-cols-2" : ""}`}>
            <CartaoGrafico
              titulo={linhaUnica ? "Vínculos ano a ano" : `Vínculos ano a ano, por ${nivelAbaixo}`}
              subtitulo="RAIS · ativos em 31/12"
              opcao={op.rais}
              carregando={serieRais.carregando}
              erro={serieRais.erro}
              altura={linhaUnica ? 260 : 320}
              dicaClique={linhaUnica ? undefined : `Clique numa linha para abrir ${nivelAbaixo === "grande grupo" ? "o" : "a"} ${nivelAbaixo}`}
              aoClicar={linhaUnica ? undefined : abrir}
              tabela={linhaUnica
                ? { colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "vinculos", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: sr }
                : { colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "nivel", rotulo: nivelAbaixo[0]?.toUpperCase() + nivelAbaixo.slice(1) }, { chave: "valor", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: tabelaFilhos(serieRais.linhas, "vinculos", (l) => String(l.chave)) }}
            />
            {ehCbo && (
              <CartaoGrafico
                titulo={linhaUnica ? "Admissões e desligamentos" : `Saldo no CAGED, por ${nivelAbaixo}`}
                subtitulo={`CAGED · anos completos, até ${anoCompleto || "—"}`}
                opcao={op.caged}
                carregando={serieCaged.carregando}
                erro={serieCaged.erro}
                altura={linhaUnica ? 260 : 320}
                aoClicar={linhaUnica ? undefined : abrir}
                tabela={!linhaUnica
                  ? { colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "nivel", rotulo: nivelAbaixo[0]?.toUpperCase() + nivelAbaixo.slice(1) }, { chave: "valor", rotulo: "Saldo", formato: fmtSinal, numero: true }], linhas: tabelaFilhos(serieCaged.linhas, "saldo", chaveCaged) }
                  : {
                  colunas: [
                    { chave: "ano", rotulo: "Ano" },
                    { chave: "admissoes", rotulo: "Admissões", formato: fmtNum, numero: true },
                    { chave: "desligamentos", rotulo: "Desligamentos", formato: fmtNum, numero: true },
                    { chave: "saldo", rotulo: "Saldo", formato: fmtSinal, numero: true },
                    { chave: "salario", rotulo: "Salário de admissão", formato: fmtReais, numero: true },
                  ],
                  linhas: cagedTotal,
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
