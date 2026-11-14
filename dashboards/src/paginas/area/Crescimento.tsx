import { useState } from "react";
import { BarraFiltros, FiltroPeriodo, SeletorUF } from "../../components/Filtros";
import { Grafico } from "../../components/Grafico";
import { Indicador } from "../../components/Indicador";
import { Painel } from "../../components/Painel";
import { Titulo } from "../../components/Titulo";
import { Segmentado } from "../../components/ui/segmentado";
import type { Area } from "../../lib/areas";
import { useConsulta, type LinhaSQL } from "../../lib/db";
import { useFiltro } from "../../lib/filtro";
import { fmt } from "../../lib/formato";
import { opcaoFluxo, opcaoLinhas, type SerieFluxo } from "../../lib/graficos";
import { coluna, entre, num, RECORTE, rotulos, tabelaRais, type Periodo } from "../../lib/sql";
import { escreverPeriodo, lerPeriodo, useParametro } from "../../lib/url";
import { cn } from "../../lib/utils";

/*
 * Pergunta 1 — quanto o mercado cresceu, e em que ritmo: o estoque (RAIS) e
 * o fluxo de admissões e desligamentos (CAGED), as duas evidências do quadro
 * de perguntas do TCC.
 */

const ANO_INICIAL = 2007;
const ANO_ATUAL = new Date().getFullYear();

type Grao = "ano" | "mes";
const SERIES_FLUXO: { chave: SerieFluxo; rotulo: string }[] = [
  { chave: "admissoes", rotulo: "Admissões" },
  { chave: "desligamentos", rotulo: "Desligamentos" },
  { chave: "saldo", rotulo: "Saldo" },
];

export function Crescimento({ area }: { area: Area }) {
  const f = useFiltro();
  const q = (sql: string | null) => useConsulta(area.slug, area.repo, sql);
  const [periodo, setPeriodo] = useParametro<Periodo>("periodo", [ANO_INICIAL, ANO_ATUAL], lerPeriodo, escreverPeriodo);
  const onde = f.ativo ? ` em ${f.rotulo}` : "";

  // ------------------------------------------------------------- estoque
  const rais = q(`
    SELECT ano, sum(estoque_3112)::DOUBLE AS estoque
    FROM ${tabelaRais(f.ativo)} WHERE ${RECORTE} AND ${entre(periodo)} AND ${f.sql()} GROUP BY 1 ORDER BY 1`);
  const r = rais.tipo === "pronto" ? rais.dados : [];
  const crescimento = r.length > 1 ? num(r.at(-1), "estoque") / num(r[0], "estoque") - 1 : NaN;
  const anos = r.length > 1 ? num(r.at(-1), "ano") - num(r[0], "ano") : 0;
  const ritmo = anos ? (num(r.at(-1), "estoque") / num(r[0], "estoque")) ** (1 / anos) - 1 : NaN;
  const resposta = (() => {
    if (r.length < 2 || !Number.isFinite(crescimento)) return undefined;
    const saltos = r.slice(1).map((l, i) => ({ ano: num(l, "ano"), taxa: num(l, "estoque") / num(r[i], "estoque") - 1 }));
    const maior = saltos.reduce((m, x) => (x.taxa > m.taxa ? x : m), saltos[0]);
    return `O emprego formal de ${area.sigla}${onde} ${crescimento >= 0 ? "cresceu" : "caiu"} ${fmt.parte(Math.abs(crescimento))} entre ${num(r[0], "ano")} e ${num(r.at(-1), "ano")}, ${fmt.parte(ritmo)} ao ano em média, com o maior salto em ${maior.ano} (${fmt.variacao(maior.taxa)}).`;
  })();

  return (
    <div className="flex flex-col gap-6">
      <BarraFiltros>
        <FiltroPeriodo valor={periodo} aoMudar={setPeriodo} min={ANO_INICIAL} max={ANO_ATUAL} />
        <SeletorUF />
      </BarraFiltros>

      <section className="flex flex-col gap-4">
        <Titulo pergunta="Quanto o mercado cresceu, e em que ritmo?" resposta={resposta} />
        <div className="grid gap-4 sm:grid-cols-3">
          <Indicador titulo="Crescimento do estoque" valor={rais.tipo === "carregando" ? undefined : Number.isFinite(crescimento) ? fmt.variacao(crescimento) : "—"} nota={r.length ? `RAIS, ${num(r[0], "ano")}–${num(r.at(-1), "ano")}` : undefined} />
          <Indicador titulo={`Vínculos ativos em ${r.length ? num(r.at(-1), "ano") : "—"}`} valor={rais.tipo === "carregando" ? undefined : r.length ? fmt.inteiro(num(r.at(-1), "estoque")) : "—"} nota="RAIS, 31/12" />
          <Indicador titulo="Ritmo médio" valor={rais.tipo === "carregando" ? undefined : Number.isFinite(ritmo) ? `${fmt.parte(ritmo)} ao ano` : "—"} nota="crescimento composto do estoque" />
        </div>
        <Painel
          titulo={`Vínculos ativos em 31/12 · ${f.rotulo}`}
          descricao={`RAIS · quem trabalha no setor ou exerce ocupação de ${area.sigla}`}
          estado={rais}
          altura={320}
          tabela={(d) => ({ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "estoque", rotulo: "Vínculos ativos", formato: fmt.inteiro }], linhas: d })}
        >
          {(d) => (
            <Grafico
              rotulo={`Vínculos ativos de ${area.nome}${onde}, ano a ano`}
              altura={320}
              opcao={(t) => opcaoLinhas(t, rotulos(d, "ano"), [{ nome: "Vínculos ativos", dados: coluna(d, "estoque"), area: true }], { zero: true })}
            />
          )}
        </Painel>
      </section>

      <Fluxo area={area} periodo={periodo} />
    </div>
  );
}

// --------------------------------------------------------------- fluxo
function Fluxo({ area, periodo }: { area: Area; periodo: Periodo }) {
  const f = useFiltro();
  const q = (sql: string | null) => useConsulta(area.slug, area.repo, sql);
  const [grao, setGrao] = useState<Grao>("ano");
  const [visiveis, setVisiveis] = useState<SerieFluxo[]>(["admissoes", "desligamentos", "saldo"]);
  // Pelo menos uma série fica ligada: um gráfico vazio não diz nada.
  const alternar = (s: SerieFluxo) =>
    setVisiveis((v) => (v.includes(s) ? (v.length > 1 ? v.filter((x) => x !== s) : v) : SERIES_FLUXO.map((x) => x.chave).filter((x) => x === s || v.includes(x))));

  // Os cubos do CAGED têm a UF; sem eles (a gold da área ainda não os
  // publicou), a série nacional, e o cartão avisa que é o Brasil inteiro.
  const anualCubo = q(`
    SELECT ano::VARCHAR AS periodo, ano, sum(saldo)::DOUBLE AS saldo, sum(admissoes)::DOUBLE AS admissoes, sum(desligamentos)::DOUBLE AS desligamentos
    FROM caged_cubo WHERE ${entre(periodo)} AND ${f.sql()} GROUP BY ano ORDER BY ano`);
  const semCubo = anualCubo.tipo === "ausente";
  const anualNacional = q(semCubo ? `
    SELECT year(mes)::VARCHAR AS periodo, year(mes) AS ano, sum(saldo)::DOUBLE AS saldo, sum(admissoes)::DOUBLE AS admissoes, sum(desligamentos)::DOUBLE AS desligamentos
    FROM serie_mensal WHERE ${entre(periodo, "year(mes)")} GROUP BY 1, 2 ORDER BY 2` : null);
  const mensalCubo = q(grao === "mes" ? `
    SELECT strftime(make_date(ano, mes, 1), '%Y-%m') AS periodo, sum(saldo)::DOUBLE AS saldo, sum(admissoes)::DOUBLE AS admissoes, sum(desligamentos)::DOUBLE AS desligamentos
    FROM caged_mensal WHERE ${entre(periodo)} AND ${f.sql()} GROUP BY 1 ORDER BY 1` : null);
  const semMensal = grao === "mes" && mensalCubo.tipo === "ausente";
  const mensalNacional = q(semMensal ? `
    SELECT strftime(mes, '%Y-%m') AS periodo, saldo::DOUBLE AS saldo, admissoes::DOUBLE AS admissoes, desligamentos::DOUBLE AS desligamentos
    FROM serie_mensal WHERE ${entre(periodo, "year(mes)")} ORDER BY 1` : null);
  const referencia = q("SELECT strftime(max(mes), '%m/%Y') AS ultimo, year(max(mes)) AS ano FROM serie_mensal");

  const anual = semCubo ? anualNacional : anualCubo;
  const estado = grao === "ano" ? anual : semMensal ? mensalNacional : mensalCubo;
  const soNacional = (grao === "ano" ? semCubo : semMensal) && f.ativo;
  const nacional = grao === "ano" ? semCubo : semMensal;
  const ref = referencia.tipo === "pronto" ? referencia.dados[0] : undefined;
  const anoParcial = num(ref, "ano");

  const a = anual.tipo === "pronto" ? anual.dados : [];
  const soma = (k: string) => a.reduce((s, l) => s + num(l, k), 0);
  const completos = a.filter((l) => num(l, "ano") !== anoParcial);
  const resposta = (() => {
    if (!completos.length) return undefined;
    const melhor = completos.reduce((m, l) => (num(l, "saldo") > num(m, "saldo") ? l : m));
    const pior = completos.reduce((m, l) => (num(l, "saldo") < num(m, "saldo") ? l : m));
    const onde = f.ativo && !semCubo ? ` em ${f.rotulo}` : "";
    return `De ${periodo[0]} a ${periodo[1]}, o mercado de ${area.sigla}${onde} contratou ${fmt.compacto(soma("admissoes"))} e desligou ${fmt.compacto(soma("desligamentos"))}, um saldo de ${fmt.sinal(soma("saldo"))} vagas; o melhor ano foi ${num(melhor, "ano")} (${fmt.sinal(num(melhor, "saldo"))}) e o pior, ${num(pior, "ano")} (${fmt.sinal(num(pior, "saldo"))}).`;
  })();

  const carregando = anual.tipo === "carregando";
  return (
    <section className="flex flex-col gap-4">
      <Titulo pergunta="Como o crescimento aparece nas contratações?" resposta={resposta} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador titulo="Saldo no período" valor={carregando ? undefined : a.length ? fmt.sinal(soma("saldo")) : "—"} nota="CAGED, vagas líquidas" />
        <Indicador titulo="Admissões" valor={carregando ? undefined : a.length ? fmt.compacto(soma("admissoes")) : "—"} nota={`CAGED, ${periodo[0]}–${periodo[1]}`} />
        <Indicador titulo="Desligamentos" valor={carregando ? undefined : a.length ? fmt.compacto(soma("desligamentos")) : "—"} nota={`CAGED, ${periodo[0]}–${periodo[1]}`} />
      </div>
      <Painel
        titulo={`Admissões, desligamentos e saldo · ${grao === "ano" ? "anual" : "mensal"} · ${nacional ? "Brasil" : f.rotulo}`}
        descricao={
          <>
            CAGED · admissões para cima, desligamentos para baixo; a linha é o saldo
            {grao === "ano" && anoParcial && periodo[1] >= anoParcial ? ` · ${anoParcial} até ${ref?.ultimo}, esmaecido` : ""}
            {periodo[0] <= 2007 && (
              <span className="mt-1 block">
                Em 2007 o CAGED quase não traz a atividade da empresa (93% dos registros sem CNAE): o ano conta só quem exerce ocupação de TI, e fica abaixo dos outros.
              </span>
            )}
            {soNacional && <span className="mt-1 block text-foreground">A Gold não traz o CAGED por estado: o gráfico mostra o Brasil inteiro.</span>}
          </>
        }
        estado={estado}
        altura={380}
        controles={
          <div className="flex flex-wrap items-end gap-4">
            <Segmentado<Grao> rotulo="Ver por" valor={grao} opcoes={[{ valor: "ano", rotulo: "Ano" }, { valor: "mes", rotulo: "Mês" }]} aoMudar={setGrao} />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Mostrar</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Séries do gráfico">
                {SERIES_FLUXO.map((s, i) => (
                  <button
                    key={s.chave}
                    type="button"
                    aria-pressed={visiveis.includes(s.chave)}
                    onClick={() => alternar(s.chave)}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                      visiveis.includes(s.chave) ? "bg-card" : "text-muted-foreground line-through",
                    )}
                  >
                    <span aria-hidden className={cn(i === 2 ? "h-0.5 w-3.5 rounded-full bg-foreground" : `size-2.5 rounded-[3px] ${i === 0 ? "bg-sobe" : "bg-desce"}`, !visiveis.includes(s.chave) && "opacity-30")} />
                    {s.rotulo}
                  </button>
                ))}
              </div>
            </div>
          </div>
        }
        tabela={(d) => ({
          colunas: [
            { chave: "periodo", rotulo: grao === "ano" ? "Ano" : "Mês" },
            { chave: "admissoes", rotulo: "Admissões", formato: fmt.inteiro },
            { chave: "desligamentos", rotulo: "Desligamentos", formato: fmt.inteiro },
            { chave: "saldo", rotulo: "Saldo", formato: fmt.sinal },
          ],
          linhas: d,
        })}
      >
        {(d) => (
          <GraficoFluxo d={d} grao={grao} visiveis={visiveis} anoParcial={anoParcial} rotulo={`Admissões, desligamentos e saldo de ${area.nome}`} />
        )}
      </Painel>
    </section>
  );
}

function GraficoFluxo({ d, grao, visiveis, anoParcial, rotulo }: { d: LinhaSQL[]; grao: Grao; visiveis: SerieFluxo[]; anoParcial: number; rotulo: string }) {
  const x = rotulos(d, "periodo");
  // O ano corrente (incompleto) fica esmaecido nas barras anuais.
  const esmaecer = grao === "ano" ? [x.indexOf(String(anoParcial))] : [];
  return (
    <Grafico
      rotulo={rotulo}
      altura={380}
      opcao={(t) => opcaoFluxo(t, x, { admissoes: coluna(d, "admissoes"), desligamentos: coluna(d, "desligamentos"), saldo: coluna(d, "saldo") }, { visiveis, esmaecer })}
    />
  );
}
