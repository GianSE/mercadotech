import { useMemo } from "react";
import { CartaoGrafico, CartaoTabela } from "../componentes/Grafico";
import { AvisoNacional, Bloco, CabecalhoPergunta, Grade, Kpi } from "../componentes/ui";
import { fmtCompacto, fmtNum, fmtPct, fmtSinal } from "../lib/formato";
import { opcaoDispersao, opcaoPrevisao } from "../lib/graficos";
import { num } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";


export default function Futuro() {
  const { cores: c } = useTema();
  const serie = useConsulta("SELECT strftime(mes, '%Y-%m') AS mes, saldo FROM serie_mensal ORDER BY mes DESC LIMIT 72");
  const prev = useConsulta("SELECT strftime(mes, '%Y-%m') AS mes, previsao, inferior, superior, modelo FROM previsao_saldo ORDER BY mes");
  const placar = useConsulta(`SELECT modelo, mae, rmse, "ganho_vs_naive_%" AS ganho FROM previsao_placar ORDER BY mae`);
  const pares = useConsulta("SELECT ano, fluxo, delta FROM nowcast_pares ORDER BY ano");
  const retro = useConsulta("SELECT estimador, anos, erro_medio, erro_pct FROM nowcast_retrospectiva ORDER BY abs(erro_pct)");
  const retido = useConsulta("SELECT estimador, previsto, real, erro, erro_pct, ano_teste FROM nowcast_ano_retido ORDER BY abs(erro_pct)");
  const proj = useConsulta("SELECT * FROM nowcast_projecao");

  const obs = [...serie.linhas].reverse();
  const p = prev.linhas;
  const modelo = String(p[0]?.modelo ?? "—");
  const acumulado = p.reduce((s, l) => s + num(l, "previsao"), 0);
  const faixa = [p.reduce((s, l) => s + num(l, "inferior"), 0), p.reduce((s, l) => s + num(l, "superior"), 0)];
  const pr = proj.linhas[0];
  const anoTeste = num(retido.linhas[0], "ano_teste");


  const op = useMemo(() => {
    if (!obs.length || !p.length) return { previsao: null, nowcast: null };
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
    };
  }, [obs, p, pares.linhas, c]);

  return (
    <>
      <CabecalhoPergunta
        numero={5}
        pergunta="Para onde o mercado vai?"
      />
      <AvisoNacional>Os modelos foram ajustados sobre a série nacional: o filtro de território não se aplica a esta página.</AvisoNacional>

      <Bloco titulo="Saldo mensal: observado e projetado">
        <Grade>
          <Kpi destaque rotulo={`Saldo previsto em ${p.length} meses`} valor={fmtSinal(acumulado)} detalhe={<>modelo <span className="font-mono">{modelo}</span></>} />
          <Kpi rotulo="Faixa de 80% do acumulado" valor={`${fmtCompacto(faixa[0])} a ${fmtCompacto(faixa[1])}`} />
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
        <CartaoTabela
          titulo="Por que este modelo, e não outro"
          subtitulo="Validação em origem móvel: treina até um ponto, prevê 12 meses, avança, repete (5 dobras)"
          tabela={{
            colunas: [
              { chave: "modelo", rotulo: "Modelo" },
              { chave: "mae", rotulo: "MAE", formato: fmtNum, numero: true },
              { chave: "rmse", rotulo: "RMSE", formato: fmtNum, numero: true },
              { chave: "ganho", rotulo: "Ganho sobre a regra ingênua", formato: (v) => fmtPct(v, 1), numero: true },
            ],
            linhas: placar.linhas,
          }}
        />
      </Bloco>

      <Bloco titulo="Estimar a RAIS antes de ela sair">
        <CartaoGrafico
          titulo="Fluxo do CAGED × variação do estoque da RAIS"
          subtitulo="Cada ponto é um ano · a linha tracejada é a identidade (1:1)"
          opcao={op.nowcast}
          carregando={pares.carregando}
          altura={400}
          tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "fluxo", rotulo: "Saldo CAGED", formato: fmtSinal, numero: true }, { chave: "delta", rotulo: "Variação RAIS", formato: fmtSinal, numero: true }], linhas: pares.linhas }}
        />
        <Grade>
          <CartaoTabela
            titulo="Retrospectiva"
            subtitulo="Cada ano estimado só com os anteriores"
            tabela={{
              colunas: [
                { chave: "estimador", rotulo: "Estimador" },
                { chave: "anos", rotulo: "Anos", formato: fmtNum, numero: true },
                { chave: "erro_medio", rotulo: "Erro médio", formato: fmtNum, numero: true },
                { chave: "erro_pct", rotulo: "Erro %", formato: (v) => fmtPct(v, 2), numero: true },
              ],
              linhas: retro.linhas,
            }}
          />
          <CartaoTabela
            titulo={`Ano retido: ${anoTeste || "—"}`}
            subtitulo={`Estimadores ajustados só até ${anoTeste ? anoTeste - 1 : "—"}, comparados ao valor real`}
            tabela={{
              colunas: [
                { chave: "estimador", rotulo: "Estimador" },
                { chave: "previsto", rotulo: "Previsto", formato: fmtNum, numero: true },
                { chave: "real", rotulo: "Real", formato: fmtNum, numero: true },
                { chave: "erro_pct", rotulo: "Erro %", formato: (v) => fmtPct(v, 2), numero: true },
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
              <Kpi destaque rotulo={`Estoque estimado em ${num(pr, "ano")}`} valor={fmtCompacto(num(pr, "estoque_estimado"))} detalhe={`± ${fmtCompacto(num(pr, "margem"))}`} />
            </Grade>
          </>
        )}
      </Bloco>
    </>
  );
}
