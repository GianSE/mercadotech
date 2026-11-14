import { useMemo, useState } from "react";
import { Grafico } from "../../components/Grafico";
import { Indicador } from "../../components/Indicador";
import { Painel } from "../../components/Painel";
import { Titulo } from "../../components/Titulo";
import { Segmentado } from "../../components/ui/segmentado";
import type { Area } from "../../lib/areas";
import type { Estado } from "../../lib/dados";
import { useConsulta, type LinhaSQL } from "../../lib/db";
import { fmt } from "../../lib/formato";
import { opcaoBarrasH, opcaoPrevisao } from "../../lib/graficos";
import { coluna, num, rotulos } from "../../lib/sql";

/*
 * Pergunta 5 — para onde o mercado vai: o saldo mensal projetado pelo modelo
 * escolhido na validação de origem móvel (SARIMA) e o nowcast do estoque do
 * ano corrente, antes de a RAIS dele sair. Os dois são calculados só para o
 * país, como no TCC.
 */

export function Futuro({ area }: { area: Area }) {
  return (
    <div className="flex flex-col gap-6">
      <Previsao area={area} />
      <Nowcast area={area} />
      <Validacao area={area} />
    </div>
  );
}

// ------------------------------------------------------------ previsão
function Previsao({ area }: { area: Area }) {
  const q = (sql: string) => useConsulta(area.slug, area.repo, sql);
  const serie = q("SELECT strftime(mes, '%Y-%m') AS mes, saldo FROM serie_mensal ORDER BY mes DESC LIMIT 72");
  const prev = q("SELECT strftime(mes, '%Y-%m') AS mes, previsao, inferior, superior, acum_previsao, acum_inferior, acum_superior, modelo FROM previsao_saldo ORDER BY mes");

  // As duas consultas viram um estado só: o gráfico precisa das duas juntas.
  const juntos = useMemo<Estado<{ obs: LinhaSQL[]; p: LinhaSQL[] }>>(() => {
    if (serie.tipo === "pronto" && prev.tipo === "pronto") return { tipo: "pronto", dados: { obs: [...serie.dados].reverse(), p: prev.dados } };
    const outro = serie.tipo !== "pronto" ? serie : prev;
    if (outro.tipo === "erro") return { tipo: "erro", mensagem: outro.mensagem };
    return { tipo: outro.tipo === "ausente" ? "ausente" : "carregando" };
  }, [serie, prev]);
  const p = prev.tipo === "pronto" ? prev.dados : [];
  const fim = p.at(-1);
  // A resposta lê os doze primeiros meses: é o horizonte em que a previsão
  // ainda informa algo (TCC, pergunta 5); adiante, a faixa de 80% do
  // acumulado já cruza o zero com folga. O gráfico mostra os 18.
  const ano = p[Math.min(11, p.length - 1)];
  const resposta = ano
    ? `Nos próximos ${Math.min(12, p.length)} meses, o modelo projeta para ${area.sigla} um saldo acumulado de ${fmt.sinal(num(ano, "acum_previsao"))} vagas, entre ${fmt.sinal(num(ano, "acum_inferior"))} e ${fmt.sinal(num(ano, "acum_superior"))} em 8 de cada 10 cenários: o intervalo inclui o zero, e a previsão não vai muito além de um ano.`
    : undefined;

  return (
    <section className="flex flex-col gap-4">
      <Titulo pergunta="Quanto o mercado deve contratar nos próximos meses?" resposta={resposta} />
      <Painel
        titulo="Saldo mensal: observado e projetado"
        descricao={`CAGED · últimos 72 meses observados e ${p.length || 18} projetados · a área sombreada é a faixa de 80%${fim ? ` · modelo ${String(fim.modelo)}` : ""}`}
        estado={juntos}
        altura={340}
        nacional
      >
        {(d) => {
          const meses = [...d.obs.map((l) => String(l.mes)), ...d.p.map((l) => String(l.mes))];
          const k = d.obs.length;
          // A previsão começa no último observado, para a linha não ficar solta.
          const observado = [...d.obs.map((l) => num(l, "saldo")), ...d.p.map(() => null)];
          const previsto = meses.map((_, i) => (i === k - 1 ? num(d.obs[k - 1], "saldo") : i >= k ? num(d.p[i - k], "previsao") : null));
          const inferior = meses.map((_, i) => (i >= k ? num(d.p[i - k], "inferior") : null));
          const superior = meses.map((_, i) => (i >= k ? num(d.p[i - k], "superior") : null));
          return <Grafico rotulo={`Saldo mensal observado e projetado de ${area.nome}`} altura={340} opcao={(t) => opcaoPrevisao(t, meses, observado, previsto, inferior, superior)} />;
        }}
      </Painel>
    </section>
  );
}

// ------------------------------------------------------------- nowcast
function Nowcast({ area }: { area: Area }) {
  const proj = useConsulta(area.slug, area.repo, "SELECT * FROM nowcast_projecao");
  const pr = proj.tipo === "pronto" ? proj.dados[0] : undefined;
  const carregando = proj.tipo === "carregando";
  const semDado = proj.tipo === "ausente" || proj.tipo === "erro";
  return (
    <section className="flex flex-col gap-4">
      <Titulo
        pergunta={`Quantos empregos de ${area.sigla} há hoje?`}
        resposta={pr ? `A RAIS de ${num(pr, "ano")} só sai no ano seguinte. Pelo fluxo que o CAGED já mostrou em ${num(pr, "meses_observados")} meses, o estoque de ${area.sigla} deve fechar ${num(pr, "ano")} perto de ${fmt.inteiro(num(pr, "estoque_estimado"))} vínculos.` : undefined}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador titulo={pr ? `Estoque estimado para ${num(pr, "ano")}` : "Estoque estimado"} valor={carregando ? undefined : pr ? fmt.inteiro(num(pr, "estoque_estimado")) : "—"} nota={pr ? `± ${fmt.compacto(num(pr, "margem"))} · nowcast pelo CAGED` : semDado ? "o nowcast não está na Gold" : undefined} />
        <Indicador titulo={pr ? `Último estoque da RAIS (${num(pr, "ano_base")})` : "Último estoque da RAIS"} valor={carregando ? undefined : pr ? fmt.inteiro(num(pr, "estoque_base")) : "—"} nota="RAIS, 31/12" />
        <Indicador titulo="Fluxo no ano" valor={carregando ? undefined : pr ? fmt.sinal(num(pr, "fluxo_total")) : "—"} nota={pr ? `${fmt.sinal(num(pr, "fluxo_observado"))} observado + ${fmt.sinal(num(pr, "fluxo_previsto"))} previsto` : undefined} />
      </div>
    </section>
  );
}

// ----------------------------------------------------------- validação
/*
 * Os dois modelos contra um estimador ingênuo, no passado (objetivo 5 do
 * TCC): a previsão do saldo na validação de origem móvel, contra o ingênuo
 * sazonal (o mesmo mês do ano anterior); o nowcast nos anos retidos, contra o
 * estoque parado. Menor é melhor nos dois.
 */
type Vista = "saldo" | "estoque";

function Validacao({ area }: { area: Area }) {
  const [vista, setVista] = useState<Vista>("saldo");
  const placar = useConsulta(area.slug, area.repo, "SELECT modelo AS nome, mae AS valor, \"ganho_vs_naive_%\" AS ganho FROM previsao_placar ORDER BY mae");
  const retro = useConsulta(area.slug, area.repo, "SELECT estimador AS nome, erro_pct / 100 AS valor, anos FROM nowcast_retrospectiva ORDER BY erro_pct");
  const estado = vista === "saldo" ? placar : retro;
  const melhor = estado.tipo === "pronto" ? estado.dados[0] : undefined;
  const ingenuo = estado.tipo === "pronto" ? estado.dados.find((l) => /naive|ingênuo/i.test(String(l.nome))) : undefined;
  const resposta =
    melhor && ingenuo
      ? vista === "saldo"
        ? `Na validação de origem móvel, o ${String(melhor.nome)} errou em média ${fmt.inteiro(num(melhor, "valor"))} vagas por mês, ${fmt.parte(num(melhor, "ganho") / 100)} menos que o ingênuo sazonal; nenhum Prophet o superou.`
        : `Nos ${num(melhor, "anos")} anos retidos, a ${String(melhor.nome)} errou o estoque em média ${fmt.parte(num(melhor, "valor"))}, contra ${fmt.parte(num(ingenuo, "valor"))} do estimador que supõe estoque parado.`
      : undefined;
  const formato = vista === "saldo" ? (v: number) => `${fmt.inteiro(v)} vagas` : fmt.parte;
  return (
    <section className="flex flex-col gap-4">
      <Titulo pergunta="Os modelos acertariam o passado?" resposta={resposta} />
      <Painel
        titulo={vista === "saldo" ? "Erro médio da previsão do saldo mensal, por modelo" : "Erro médio do nowcast do estoque, por estimador"}
        descricao={vista === "saldo" ? "CAGED · erro absoluto médio em 5 dobras de validação de origem móvel · em destaque, o modelo escolhido e o ingênuo sazonal" : "RAIS e CAGED · erro percentual médio nos anos retidos · em destaque, o estimador escolhido e o ingênuo"}
        estado={estado}
        altura={vista === "saldo" ? 340 : 200}
        nacional
        controles={<Segmentado<Vista> rotulo="Modelo" valor={vista} opcoes={[{ valor: "saldo", rotulo: "Previsão do saldo" }, { valor: "estoque", rotulo: "Nowcast do estoque" }]} aoMudar={setVista} />}
        tabela={(d) => ({ colunas: [{ chave: "nome", rotulo: vista === "saldo" ? "Modelo" : "Estimador" }, { chave: "valor", rotulo: "Erro médio", formato }], linhas: d })}
      >
        {(d) => (
          <Grafico
            rotulo={vista === "saldo" ? "Erro médio da previsão do saldo por modelo" : "Erro médio do nowcast por estimador"}
            altura={vista === "saldo" ? 340 : 200}
            opcao={(t) =>
              opcaoBarrasH(t, rotulos(d, "nome"), coluna(d, "valor"), {
                formato,
                larguraRotulo: 220,
                destaque: [String(d[0]?.nome), String(ingenuo?.nome ?? "")],
              })
            }
          />
        )}
      </Painel>
    </section>
  );
}
