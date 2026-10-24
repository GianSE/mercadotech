import { useMemo } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { AvisoNacional, Kpi } from "../componentes/ui";
import { fmtDec, fmtNum } from "../lib/formato";
import { opcaoLinhas } from "../lib/graficos";
import { coluna, num, rotulos, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

const PERGUNTAS = [
  { id: "crescimento", p: "Quanto o mercado cresceu, e em que ritmo?", r: "Cresceu muito, com o salto concentrado em 2021–22 — e o ritmo agora desacelera." },
  { id: "onde", p: "Onde está o trabalho de TI: em que empresas e em que lugares?", r: "A maior parte dos profissionais de TI está fora das empresas de TI, e o interior cresce mais rápido que as capitais." },
  { id: "qualidade", p: "O emprego de TI melhorou em qualidade?", r: "Não em remuneração relativa: o salário em salários mínimos está praticamente parado, e o risco de desligamento se concentra no primeiro ano." },
  { id: "equidade", p: "Quem ganha menos, e por quê?", r: "Mulheres e pessoas negras. A diferença por gênero é de retorno — mesma qualificação, salário menor; a por raça é sobretudo de acesso." },
  { id: "futuro", p: "Para onde o mercado vai?", r: "Crescimento modesto e positivo, com intervalo declarado: estimar o presente é bem mais preciso do que prever o futuro." },
];

export default function Pesquisa() {
  const { cores: c } = useTema();
  const estoque = useConsulta(`SELECT ano, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_anual WHERE ${TI} GROUP BY 1 ORDER BY 1`);
  const lentes = useConsulta(`
    SELECT sum(estoque_3112) FILTER (WHERE ocupacao_ti AND NOT setor_ti)::DOUBLE AS fora,
           sum(estoque_3112) FILTER (WHERE ocupacao_ti)::DOUBLE AS profissionais
    FROM rais_setor_vs_ocupacao WHERE ano = (SELECT max(ano) FROM rais_setor_vs_ocupacao)`);
  const hiato = useConsulta("SELECT ano, hiato_pct FROM hiato_serie WHERE comparacao = 'Homem vs Mulher' ORDER BY ano");
  const nowcast = useConsulta("SELECT estimador, erro_pct, ano_teste FROM nowcast_ano_retido ORDER BY abs(erro_pct) LIMIT 1");

  const e = estoque.linhas;
  const [primeiro, ultimo] = [e[0], e.at(-1)];
  const variacao = (num(ultimo, "estoque") / num(primeiro, "estoque") - 1) * 100;
  const fora = (num(lentes.linhas[0], "fora") / num(lentes.linhas[0], "profissionais")) * 100;
  const h = hiato.linhas;
  const nc = nowcast.linhas[0];

  const opcao = useMemo(
    () => (e.length ? opcaoLinhas(c, rotulos(e, "ano"), [{ nome: "Vínculos ativos em 31/12", dados: coluna(e, "estoque"), area: true, rotuloFinal: true }], { formato: fmtNum, zero: true }) : null),
    [e, c],
  );

  return (
    <>
      <AvisoNacional>Esta abertura resume o Brasil inteiro. As páginas de cada pergunta seguem o filtro de território onde a fonte permite.</AvisoNacional>
      <section className="grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:items-end">
        <div>
          <p className="sobrelinha">
            <span className="mr-2 inline-block h-2 w-2 rounded-[2px] bg-acento align-middle" />
            Trabalho de conclusão de curso · Engenharia da Computação · UTFPR
          </p>
          <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-tinta sm:text-4xl">
            O emprego em tecnologia cresceu. <span className="text-tinta-2">Ficou melhor e mais justo?</span>
          </h1>
          <p className="mt-4 max-w-2xl text-[16px] leading-relaxed text-tinta-2">
            Dezoito anos de microdados da RAIS e do CAGED, recortados em tecnologia pela união de duas lentes — quem trabalha em empresa de
            TI e quem exerce ocupação de TI em qualquer setor —, para responder se o crescimento do emprego formal veio acompanhado de
            melhores salários e de mais equidade.
          </p>
        </div>
        <div className="rounded-xl border border-borda border-l-2 border-l-acento bg-superficie p-6">
          <p className="text-[13px] text-tinta-3">Vínculos de tecnologia ativos em 31/12/{num(ultimo, "ano") || "—"}</p>
          <p className="mt-1 text-5xl font-semibold tracking-tight text-tinta sm:text-6xl">{fmtNum(num(ultimo, "estoque"))}</p>
          <p className="mt-2 text-[14px] text-tinta-2">
            {Number.isFinite(variacao) ? `+${fmtDec(variacao, 0)}%` : "—"} desde {num(primeiro, "ano") || "—"} ({fmtNum(num(primeiro, "estoque"))} vínculos)
          </p>
        </div>
      </section>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Kpi rotulo="Profissionais de TI fora de empresas de TI" valor={Number.isFinite(fora) ? `${fmtDec(fora, 0)}%` : "—"} detalhe="RAIS, último ano — a lente de setor sozinha perderia a maioria" />
        <Kpi
          rotulo={`Hiato salarial de gênero${h.length ? ` (${num(h.at(-1), "ano")})` : ""}`}
          valor={h.length ? `${fmtDec(num(h.at(-1), "hiato_pct"), 1)}%` : "—"}
          detalhe={h.length ? `era ${fmtDec(num(h[0], "hiato_pct"), 1)}% em ${num(h[0], "ano")} · RAIS, homens × mulheres` : undefined}
        />
        <Kpi
          rotulo={nc ? `Erro do nowcast ao estimar ${num(nc, "ano_teste")}` : "Erro do nowcast"}
          valor={nc ? `${fmtDec(Math.abs(num(nc, "erro_pct")), 2)}%` : "—"}
          detalhe={nc ? `estimador "${String(nc.estimador)}", com o ano fora do ajuste` : undefined}
        />
      </div>

      <div className="mt-6">
        <CartaoGrafico
          titulo="O tamanho do mercado formal de tecnologia"
          subtitulo="RAIS · vínculos ativos em 31 de dezembro, setor de TI ou ocupação de TI"
          opcao={opcao}
          carregando={estoque.carregando}
          erro={estoque.erro}
          altura={260}
          tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: e }}
        />
      </div>

      <section className="mt-12">
        <h2 className="text-lg font-semibold text-tinta">Cinco perguntas, cinco respostas</h2>
        <p className="mt-1 text-sm text-tinta-3">Cada uma abre a evidência que a sustenta.</p>
        <ol className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {PERGUNTAS.map((q, i) => (
            <li key={q.id}>
              <a
                href={`#/${q.id}`}
                className="group flex h-full flex-col rounded-xl border border-borda bg-superficie p-5 transition-colors hover:border-acento"
              >
                <span className="font-mono text-[12px] font-semibold text-tinta-3">{String(i + 1).padStart(2, "0")}</span>
                <span className="mt-1 font-semibold text-tinta">{q.p}</span>
                <span className="mt-2 flex-1 text-[14px] leading-relaxed text-tinta-2">{q.r}</span>
                <span className="mt-4 text-[13px] font-medium text-tinta-2 group-hover:text-tinta">Ver a evidência →</span>
              </a>
            </li>
          ))}
          <li>
            <a href="#/explorar" className="flex h-full flex-col justify-between rounded-xl bg-acento p-5 text-sobre-acento">
              <span className="font-mono text-[12px] font-semibold uppercase tracking-wider">Explorar</span>
              <span className="mt-2 text-[15px] font-semibold leading-snug">
                Filtre o CAGED por estado, setor, área, sexo, raça, escolaridade e idade — e cruze do jeito que quiser.
              </span>
              <span className="mt-4 text-[13px] font-medium">Abrir o explorador →</span>
            </a>
          </li>
        </ol>
      </section>

      <section className="mt-12 rounded-xl border border-borda bg-superficie p-6">
        <h2 className="text-lg font-semibold text-tinta">O que estes dados não permitem afirmar</h2>
        <ul className="mt-3 grid gap-3 text-[14px] leading-relaxed text-tinta-2 md:grid-cols-2">
          <li><strong className="text-tinta">Só o mercado formal.</strong> RAIS e CAGED não veem PJ, autônomos nem informais — relevante num setor em que a contratação como pessoa jurídica é comum.</li>
          <li><strong className="text-tinta">Lugar do estabelecimento, não do trabalho.</strong> Empresas de TI se registram onde o ISS é menor, e o trabalho remoto agrava a distorção.</li>
          <li><strong className="text-tinta">Hiato não explicado não é discriminação medida.</strong> É o limite superior do que a discriminação poderia explicar.</li>
          <li><strong className="text-tinta">Salário do CAGED é nominal.</strong> A RAIS é lida em salários mínimos justamente para comparar 2007 com 2025 sem escolher deflator.</li>
        </ul>
      </section>
    </>
  );
}
