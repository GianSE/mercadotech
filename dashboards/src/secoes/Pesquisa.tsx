import { useMemo } from "react";
import { CartaoGrafico } from "../componentes/Grafico";
import { AvisoNacional, Grade, Kpi } from "../componentes/ui";
import { fmtCompacto, fmtDec, fmtNum } from "../lib/formato";
import { opcaoLinhas } from "../lib/graficos";
import { coluna, num, rotulos, TI } from "../lib/sql";
import { useTema } from "../lib/tema";
import { useConsulta } from "../lib/useConsulta";

// Atalhos para as páginas: só a pergunta. A resposta está na página Análise.
const PAGINAS = [
  { id: "crescimento", p: "Quanto o mercado cresceu?" },
  { id: "onde", p: "Onde está o trabalho de TI?" },
  { id: "qualidade", p: "O emprego melhorou em qualidade?" },
  { id: "equidade", p: "Quem ganha menos?" },
  { id: "futuro", p: "Para onde o mercado vai?" },
];

export default function Pesquisa() {
  const { cores: c } = useTema();
  const estoque = useConsulta(`SELECT ano, sum(estoque_3112)::DOUBLE AS estoque FROM rais_estoque_anual WHERE ${TI} GROUP BY 1 ORDER BY 1`);
  const lentes = useConsulta(`
    SELECT sum(estoque_3112) FILTER (WHERE ocupacao_ti AND NOT setor_ti)::DOUBLE AS fora,
           sum(estoque_3112) FILTER (WHERE ocupacao_ti)::DOUBLE AS profissionais
    FROM rais_setor_vs_ocupacao WHERE ano = (SELECT max(ano) FROM rais_setor_vs_ocupacao)`);
  const hiato = useConsulta("SELECT ano, hiato_pct FROM hiato_serie WHERE comparacao = 'Homem vs Mulher' ORDER BY ano");
  const saldo = useConsulta("SELECT sum(saldo)::DOUBLE AS saldo, min(ano) AS de, max(ano) AS ate FROM caged_cubo");

  const e = estoque.linhas;
  const [primeiro, ultimo] = [e[0], e.at(-1)];
  const variacao = (num(ultimo, "estoque") / num(primeiro, "estoque") - 1) * 100;
  const fora = (num(lentes.linhas[0], "fora") / num(lentes.linhas[0], "profissionais")) * 100;
  const h = hiato.linhas.at(-1);
  const sd = saldo.linhas[0];

  const opcao = useMemo(
    () => (e.length ? opcaoLinhas(c, rotulos(e, "ano"), [{ nome: "Vínculos ativos em 31/12", dados: coluna(e, "estoque"), area: true, rotuloFinal: true }], { formato: fmtNum, zero: true }) : null),
    [e, c],
  );

  return (
    <>
      <AvisoNacional />
      <header className="mb-6">
        <p className="sobrelinha">
          <span className="mr-2 inline-block h-2 w-2 rounded-[2px] bg-acento align-middle" />
          Visão geral · RAIS + CAGED · 2007–2026
        </p>
        <h1 className="mt-2 text-[1.6rem] font-semibold leading-tight tracking-tight text-tinta sm:text-3xl">Emprego formal em tecnologia no Brasil</h1>
      </header>

      <Grade colunas={4}>
        <Kpi
          destaque
          rotulo={`Vínculos de TI em ${num(ultimo, "ano") || "—"}`}
          valor={fmtCompacto(num(ultimo, "estoque"))}
          detalhe={Number.isFinite(variacao) ? `+${fmtDec(variacao, 0)}% desde ${num(primeiro, "ano")}` : undefined}
        />
        <Kpi rotulo="Saldo do CAGED" valor={fmtCompacto(num(sd, "saldo"))} detalhe={sd ? `${num(sd, "de")}–${num(sd, "ate")}` : undefined} />
        <Kpi rotulo="Profissionais de TI fora de empresas de TI" valor={Number.isFinite(fora) ? `${fmtDec(fora, 0)}%` : "—"} detalhe="RAIS, último ano" />
        <Kpi rotulo={`Hiato salarial de gênero${h ? ` (${num(h, "ano")})` : ""}`} valor={h ? `${fmtDec(num(h, "hiato_pct"), 1)}%` : "—"} detalhe="RAIS, homens × mulheres" />
      </Grade>

      <div className="mt-6">
        <CartaoGrafico
          titulo="Vínculos de TI ativos em 31/12"
          subtitulo="RAIS · setor ou ocupação de TI"
          opcao={opcao}
          carregando={estoque.carregando}
          erro={estoque.erro}
          altura={280}
          tabela={{ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "estoque", rotulo: "Vínculos", formato: fmtNum, numero: true }], linhas: e }}
        />
      </div>

      <nav aria-label="Páginas" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PAGINAS.map((q, i) => (
          <a key={q.id} href={`#/${q.id}`} className="cartao group flex items-center gap-4 p-4 transition-colors hover:border-acento">
            <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-serie-1/12 font-mono text-[14px] font-semibold text-serie-1">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="font-medium text-tinta">{q.p}</span>
          </a>
        ))}
        <a href="#/analise" className="flex items-center gap-4 rounded-[var(--radius-cartao)] bg-acento p-4 text-sobre-acento">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-black/10 font-mono text-[14px] font-semibold">→</span>
          <span className="font-semibold">Análise e conclusões</span>
        </a>
      </nav>
    </>
  );
}
