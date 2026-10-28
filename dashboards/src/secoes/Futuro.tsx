import { useMemo } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { AvisoNacional, Bloco, CabecalhoPergunta, Grade, Kpi } from "../componentes/ui";
import { fmtCompacto, fmtDec, fmtNum, fmtPct, fmtSinal } from "../lib/formato";
import { opcaoBarras, opcaoDispersao, opcaoLinhas, opcaoPrevisao } from "../lib/graficos";
import { num } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";


// Nomes que se leem sem o TCC ao lado. A ordem é a das cores: o estimador
// escolhido fica com a primeira.
const ESTIMADORES: Record<string, string> = {
  "razão mediana": "Razão histórica (escolhido)",
  "regressão OLS": "Regressão linear",
  "identidade (delta = fluxo)": "Soma direta do CAGED",
  "ingênuo (sem mudança)": "Repetir o ano anterior",
};
const ORDEM_ESTIMADORES = Object.keys(ESTIMADORES);
const nomeEstimador = (e: unknown) => ESTIMADORES[String(e)] ?? String(e);
const comSinal = (casas: number) => (v: number) => `${v > 0 ? "+" : ""}${fmtDec(v, casas)}%`;

function nomeModelo(m: string, escolhido: string): string {
  if (m === "naive sazonal") return "Regra ingênua (mesmo mês do ano anterior)";
  const prophet = m.match(/^Prophet\(tend\S* ([\d.]+)\)$/);
  const nome = prophet ? `Prophet, tendência ${prophet[1].replace(".", ",")}` : m.replace(/, /g, ",");
  return m === escolhido ? `${nome} · escolhido` : nome;
}

export default function Futuro() {
  const { cores: c } = useTema();
  const serie = useConsulta("SELECT strftime(mes, '%Y-%m') AS mes, saldo FROM serie_mensal ORDER BY mes DESC LIMIT 72");
  // SELECT * para aceitar a Gold com ou sem as colunas acum_* (intervalo da soma).
  const prev = useConsulta("SELECT * REPLACE (strftime(mes, '%Y-%m') AS mes) FROM previsao_saldo ORDER BY mes");
  const placar = useConsulta(`SELECT modelo, mae, rmse, "ganho_vs_naive_%" AS ganho FROM previsao_placar ORDER BY mae`);
  const pares = useConsulta("SELECT ano, fluxo, delta FROM nowcast_pares ORDER BY ano");
  const retro = useConsulta("SELECT estimador, anos, erro_medio, erro_pct FROM nowcast_retrospectiva ORDER BY abs(erro_pct)");
  const retroAnos = useConsulta("SELECT ano, estimador, previsto, real, erro_pct FROM nowcast_retrospectiva_anos ORDER BY ano");
  const retido = useConsulta("SELECT estimador, previsto, real, erro, erro_pct, ano_teste FROM nowcast_ano_retido ORDER BY abs(erro_pct)");
  const proj = useConsulta("SELECT * FROM nowcast_projecao");

  const obs = [...serie.linhas].reverse();
  const p = prev.linhas;
  const modelo = String(p[0]?.modelo ?? "—");
  const acumulado = p.reduce((s, l) => s + num(l, "previsao"), 0);
  // Faixa da SOMA, das trajetórias simuladas na Gold. Somar os limites mensais
  // daria uma faixa larga demais; fica só como reserva para uma Gold antiga.
  const ultima = p.at(-1);
  const temAcum = ultima != null && ultima.acum_inferior != null && ultima.acum_superior != null;
  const faixa = temAcum
    ? [num(ultima, "acum_inferior"), num(ultima, "acum_superior")]
    : [p.reduce((s, l) => s + num(l, "inferior"), 0), p.reduce((s, l) => s + num(l, "superior"), 0)];
  const pr = proj.linhas[0];
  const anoTeste = num(retido.linhas[0], "ano_teste");


  const op = useMemo(() => {
    // Placar: quanto cada modelo erra a menos que a regra ingênua (o zero).
    const pl = placar.linhas;
    const placarOp = pl.length
      ? opcaoBarras(c, pl.map((l) => nomeModelo(String(l.modelo), modelo)), pl.map((l) => num(l, "ganho")), {
          horizontal: true,
          divergente: true,
          nome: "Erra a menos que a regra ingênua",
          formato: comSinal(1),
          formatoEixo: (v) => `${fmtDec(v, 0)}%`,
          larguraRotulo: 260,
          rotulos: true,
          extraTooltip: (i) => `erro médio de ${fmtNum(num(pl[i], "mae"))} vagas por mês nos testes`,
        })
      : null;
    // Retrospectiva: o erro de cada estimador, ano a ano, e a média.
    const ra = retroAnos.linhas;
    const anosRetro = [...new Set(ra.map((l) => num(l, "ano")))].sort((x, y) => x - y);
    const estimadores = ORDEM_ESTIMADORES.filter((e) => ra.some((l) => l.estimador === e));
    const retroOp = anosRetro.length
      ? opcaoLinhas(
          c,
          anosRetro.map(String),
          estimadores.map((e, i) => ({
            nome: nomeEstimador(e),
            cor: c.series[i],
            rotuloFinal: true,
            dados: anosRetro.map((ano) => {
              const l = ra.find((x) => x.estimador === e && num(x, "ano") === ano);
              return l ? num(l, "erro_pct") : null;
            }),
          })),
          { formato: comSinal(1), formatoEixo: (v) => `${fmtDec(v, 0)}%` },
        )
      : null;
    const rl = retro.linhas;
    const mediaOp = rl.length
      ? opcaoBarras(c, rl.map((l) => nomeEstimador(l.estimador)), rl.map((l) => Math.abs(num(l, "erro_pct"))), {
          horizontal: true,
          nome: "Erro médio",
          formato: (v) => fmtPct(v, 1),
          formatoEixo: (v) => fmtPct(v, 0),
          larguraRotulo: 200,
          rotulos: true,
          extraTooltip: (i) => `em média ${fmtNum(num(rl[i], "erro_medio"))} vínculos de diferença`,
        })
      : null;
    const rt = retido.linhas;
    const retidoOp = rt.length
      ? opcaoBarras(c, rt.map((l) => nomeEstimador(l.estimador)), rt.map((l) => Math.abs(num(l, "erro_pct"))), {
          horizontal: true,
          nome: "Erro",
          formato: (v) => fmtPct(v, 2),
          formatoEixo: (v) => `${fmtDec(v, 0)}%`,
          larguraRotulo: 200,
          rotulos: true,
          extraTooltip: (i) => `previu ${fmtNum(num(rt[i], "previsto"))} (${num(rt[i], "erro_pct") < 0 ? "abaixo" : "acima"} do real, ${fmtNum(num(rt[i], "real"))})`,
        })
      : null;
    const extras = { placar: placarOp, retro: retroOp, media: mediaOp, retido: retidoOp };
    if (!obs.length || !p.length) return { previsao: null, nowcast: null, ...extras };
    // Eixo único: os meses observados seguidos dos projetados; cada série
    // só tem valor no seu trecho, e a previsão começa no último observado
    // para a linha não ficar solta.
    const meses = [...obs.map((l) => String(l.mes)), ...p.map((l) => String(l.mes))];
    const k = obs.length;
    const observado = [...obs.map((l) => num(l, "saldo")), ...p.map(() => null)];
    const previsto = meses.map((_, i) => (i === k - 1 ? num(obs[k - 1], "saldo") : i >= k ? num(p[i - k], "previsao") : null));
    const inferior = meses.map((_, i) => (i >= k ? num(p[i - k], "inferior") : null));
    const superior = meses.map((_, i) => (i >= k ? num(p[i - k], "superior") : null));
    const fl = pares.linhas.map((l) => num(l, "fluxo"));
    const lim: [number, number] = [Math.min(...fl), Math.max(...fl)];
    return {
      previsao: opcaoPrevisao(c, meses, observado, previsto, inferior, superior, fmtSinal),
      nowcast: pares.linhas.length
        ? opcaoDispersao(
            c,
            [{ nome: "Ano", pontos: pares.linhas.map((l) => ({ x: num(l, "fluxo"), y: num(l, "delta"), rotulo: String(l.ano), tamanho: 12 })) }],
            { formatoX: fmtCompacto, formatoY: fmtCompacto, nomeX: "Saldo acumulado do CAGED no ano", nomeY: "Variação do estoque da RAIS", identidade: lim, rotularPontos: true },
          )
        : null,
      ...extras,
    };
  }, [obs, p, pares.linhas, placar.linhas, retro.linhas, retroAnos.linhas, retido.linhas, modelo, c]);
  const realRetido = num(retido.linhas[0], "real");

  // Resposta do topo: o saldo previsto e o estoque estimado do ano corrente.
  const resposta = p.length && pr
    ? `O modelo prevê saldo de ${fmtSinal(acumulado)} vagas nos próximos ${p.length} meses (faixa de ${fmtCompacto(faixa[0])} a ${fmtCompacto(faixa[1])}), e o estoque de ${num(pr, "ano")} é estimado em ${fmtCompacto(num(pr, "estoque_estimado"))} vínculos (± ${fmtCompacto(num(pr, "margem"))}).`
    : undefined;

  return (
    <>
      <CabecalhoPergunta
        numero={5}
        pergunta="Para onde o mercado vai?"
        resposta={resposta}
      />
      <AvisoNacional>Os modelos foram ajustados sobre a série nacional: o filtro de território não se aplica a esta página.</AvisoNacional>

      <Bloco titulo="Saldo mensal: observado e projetado">
        <Grade>
          <Kpi destaque ajuda="sarima" rotulo={`Saldo previsto em ${p.length} meses`} valor={fmtSinal(acumulado)} detalhe={<>modelo <span className="font-mono">{modelo}</span></>} />
          <Kpi ajuda="faixa80" rotulo="Faixa de 80% do acumulado" valor={`${fmtCompacto(faixa[0])} a ${fmtCompacto(faixa[1])}`} />
        </Grade>
        <CartaoGrafico
          titulo="Saldo mensal de empregos em tecnologia"
          subtitulo="CAGED · últimos 72 meses observados e 18 projetados"
          opcao={op.previsao}
          carregando={serie.carregando || prev.carregando}
          erro={serie.erro || prev.erro}
          altura={380}
          tabela={{
            colunas: [
              { chave: "mes", rotulo: "Mês" },
              { chave: "previsao", rotulo: "Previsto", formato: fmtSinal, numero: true },
              { chave: "inferior", rotulo: "Limite inferior", formato: fmtSinal, numero: true },
              { chave: "superior", rotulo: "Limite superior", formato: fmtSinal, numero: true },
            ],
            linhas: p,
          }}
        />
        <CartaoGrafico
          titulo="Por que este modelo, e não outro"
          ajuda="backtest"
          subtitulo="Quanto cada modelo erra a menos que a regra mais simples possível: repetir o saldo do mesmo mês do ano anterior"
          opcao={op.placar}
          carregando={placar.carregando}
          erro={placar.erro}
          rodape="Teste com o passado em 5 rodadas: o modelo treina até um mês, prevê os 12 seguintes e é comparado ao que aconteceu; depois avança e repete. Barra à direita = erra menos que a regra ingênua; à esquerda = erra mais, e então não vale a pena usá-lo. Passe o mouse para ver o erro médio em vagas por mês."
          tabela={{
            colunas: [
              { chave: "modelo", rotulo: "Modelo" },
              { chave: "mae", rotulo: "Erro médio (vagas/mês)", formato: fmtNum, numero: true },
              { chave: "rmse", rotulo: "Erro quadrático (RMSE)", formato: fmtNum, numero: true },
              { chave: "ganho", rotulo: "Erra a menos que a regra ingênua", formato: (v) => fmtPct(v, 1), numero: true },
            ],
            linhas: placar.linhas,
          }}
        />
      </Bloco>

      <Bloco titulo="Estimar a RAIS antes de ela sair">
        <CartaoGrafico
          titulo="Fluxo do CAGED × variação do estoque da RAIS"
          ajuda="nowcast"
          subtitulo="Cada ponto é um ano · a linha tracejada é a identidade (1:1)"
          opcao={op.nowcast}
          carregando={pares.carregando}
          altura={400}
          tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "fluxo", rotulo: "Saldo CAGED", formato: fmtSinal, numero: true }, { chave: "delta", rotulo: "Variação RAIS", formato: fmtSinal, numero: true }], linhas: pares.linhas }}
        />
        <CartaoGrafico
          titulo="Quanto cada estimador teria errado, ano a ano"
          ajuda="backtest"
          subtitulo="Cada ano estimado só com os anos anteriores e comparado à RAIS que saiu depois · 0% = acerto exato"
          opcao={op.retro}
          carregando={retroAnos.carregando}
          erro={retroAnos.erro}
          altura={340}
          rodape="Acima de zero, o estimador previu mais vínculos do que houve; abaixo, menos. Repetir o ano anterior erra muito sempre que o mercado cresce rápido (2021 e 2022); a razão histórica entre o saldo do CAGED e a variação da RAIS fica perto de zero quase todo ano."
          tabela={{
            colunas: [
              { chave: "ano", rotulo: "Ano" },
              { chave: "estimador", rotulo: "Estimador", formato: nomeEstimador },
              { chave: "previsto", rotulo: "Previsto", formato: fmtNum, numero: true },
              { chave: "real", rotulo: "Real (RAIS)", formato: fmtNum, numero: true },
              { chave: "erro_pct", rotulo: "Erro", formato: (v) => fmtPct(v, 2), numero: true },
            ],
            linhas: retroAnos.linhas,
          }}
        />
        <Grade>
          <CartaoGrafico
            titulo={`Erro médio nos ${num(retro.linhas[0], "anos") || "—"} anos testados`}
            subtitulo="Média do erro, sem o sinal · menor é melhor"
            opcao={op.media}
            carregando={retro.carregando}
            altura={220}
            tabela={{
              colunas: [
                { chave: "estimador", rotulo: "Estimador", formato: nomeEstimador },
                { chave: "anos", rotulo: "Anos", formato: fmtNum, numero: true },
                { chave: "erro_medio", rotulo: "Erro médio (vínculos)", formato: fmtNum, numero: true },
                { chave: "erro_pct", rotulo: "Erro médio", formato: (v) => fmtPct(v, 2), numero: true },
              ],
              linhas: retro.linhas,
            }}
          />
          <CartaoGrafico
            titulo={`Prova final: ${anoTeste || "—"}, o último ano publicado`}
            subtitulo={`Ajustados só até ${anoTeste ? anoTeste - 1 : "—"} e comparados aos ${realRetido ? fmtNum(realRetido) : "—"} vínculos que a RAIS registrou · tamanho do erro, menor é melhor`}
            opcao={op.retido}
            carregando={retido.carregando}
            altura={220}
            tabela={{
              colunas: [
                { chave: "estimador", rotulo: "Estimador", formato: nomeEstimador },
                { chave: "previsto", rotulo: "Previsto", formato: fmtNum, numero: true },
                { chave: "real", rotulo: "Real", formato: fmtNum, numero: true },
                { chave: "erro_pct", rotulo: "Erro", formato: (v) => fmtPct(v, 2), numero: true },
              ],
              linhas: retido.linhas,
            }}
          />
        </Grade>
        {pr && (
          <>
            <h3 className="mt-2 text-[15px] font-semibold text-tinta">Projeção para {num(pr, "ano")}</h3>
            <Grade colunas={3}>
              <Kpi rotulo={`CAGED observado (${num(pr, "meses_observados")} meses)`} valor={fmtSinal(num(pr, "fluxo_observado"))} />
              <Kpi rotulo="CAGED previsto (resto do ano)" valor={fmtSinal(num(pr, "fluxo_previsto"))} />
              <Kpi destaque ajuda="nowcast" rotulo={`Estoque estimado em ${num(pr, "ano")}`} valor={fmtCompacto(num(pr, "estoque_estimado"))} detalhe={`± ${fmtCompacto(num(pr, "margem"))}`} />
            </Grade>
          </>
        )}
      </Bloco>
    </>
  );
}
