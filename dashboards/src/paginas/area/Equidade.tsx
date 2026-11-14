import { useState } from "react";
import { Grafico } from "../../components/Grafico";
import { Painel } from "../../components/Painel";
import { Titulo } from "../../components/Titulo";
import { Segmentado } from "../../components/ui/segmentado";
import type { Area } from "../../lib/areas";
import { useConsulta } from "../../lib/db";
import { fmt } from "../../lib/formato";
import { opcaoLinhas } from "../../lib/graficos";
import { coluna, num, RECORTE, rotulos } from "../../lib/sql";

/*
 * Pergunta 4 — quem ganha menos, e por quê: a decomposição de Oaxaca-Blinder
 * por sexo e por raça/cor, ano a ano, e a participação feminina no estoque,
 * que mostra o outro lado do hiato de gênero.
 */

const COMPARACOES = ["Branca vs Parda", "Branca vs Preta", "Homem vs Mulher"] as const;
const PLURAL: Record<string, string> = { Homem: "homens", Mulher: "mulheres", Branca: "pessoas brancas", Parda: "pessoas pardas", Preta: "pessoas pretas" };
type Comparacao = (typeof COMPARACOES)[number];

export function Equidade({ area }: { area: Area }) {
  return (
    <div className="flex flex-col gap-6">
      <Hiato area={area} />
      <Participacao area={area} />
    </div>
  );
}

// --------------------------------------------------------------- hiato
function Hiato({ area }: { area: Area }) {
  const [comparacao, setComparacao] = useState<Comparacao>("Branca vs Parda");
  const serie = useConsulta(area.slug, area.repo, `SELECT ano, hiato_pct / 100 AS hiato, explicada, nao_explicada FROM hiato_serie WHERE comparacao = '${comparacao}' ORDER BY ano`);
  const s = serie.tipo === "pronto" ? serie.dados : [];
  const [primeiro, ultimo] = [s[0], s.at(-1)];
  const [a, b] = comparacao.split(" vs ");
  const resposta =
    primeiro && ultimo
      ? (() => {
          // As parcelas estão em log: exp - 1 dá a diferença em %.
          const iguais = Math.exp(num(ultimo, "nao_explicada")) - 1;
          const sinal = (v: number) => `${fmt.parte(Math.abs(v))} ${v >= 0 ? "a mais" : "a menos"}`;
          return `${PLURAL[a][0].toUpperCase()}${PLURAL[a].slice(1)} ganhavam ${sinal(num(primeiro, "hiato"))} que ${PLURAL[b]} em ${num(primeiro, "ano")} e ${sinal(num(ultimo, "hiato"))} em ${num(ultimo, "ano")}. Entre pessoas de mesmo perfil, a diferença de ${num(ultimo, "ano")} é de ${fmt.variacao(iguais)}; o resto vem de os grupos ocuparem posições diferentes.`;
        })()
      : undefined;
  return (
    <section className="flex flex-col gap-4">
      <Titulo pergunta="Quem ganha menos, e por quê?" resposta={resposta} />
      <Painel
        titulo={`Hiato salarial · ${comparacao.replace(" vs ", " × ")}`}
        descricao="RAIS · decomposição de Oaxaca-Blinder: quanto o primeiro grupo ganha a mais, e quanto disso sobra entre pessoas de mesmo perfil (escolaridade, subárea, porte, região, idade, jornada, tempo de casa)"
        estado={serie}
        altura={300}
        nacional
        controles={<Segmentado<Comparacao> rotulo="Comparar" valor={comparacao} opcoes={COMPARACOES.map((c) => ({ valor: c, rotulo: c.replace(" vs ", " × ") }))} aoMudar={setComparacao} />}
        tabela={(d) => ({
          colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "hiato", rotulo: "Hiato", formato: fmt.parte }, { chave: "perfil", rotulo: "Do perfil", formato: fmt.variacao }, { chave: "iguais", rotulo: "Entre iguais", formato: fmt.variacao }],
          linhas: d.map((l) => ({ ...l, perfil: Math.exp(num(l, "explicada")) - 1, iguais: Math.exp(num(l, "nao_explicada")) - 1 })),
        })}
      >
        {(d) => (
          <Grafico
            rotulo={`Hiato salarial ${comparacao} em ${area.nome}`}
            altura={300}
            opcao={(t) =>
              opcaoLinhas(
                t,
                rotulos(d, "ano"),
                [
                  { nome: "Hiato total", dados: coluna(d, "hiato") },
                  { nome: "Entre pessoas iguais", dados: d.map((l) => Math.exp(num(l, "nao_explicada")) - 1) },
                ],
                { formato: fmt.parte, formatoEixo: (v) => fmt.parte(v), zero: true, rotuloFinal: true, altura: 300 },
              )
            }
          />
        )}
      </Painel>
      <p className="max-w-3xl text-sm text-muted-foreground">
        A parte entre iguais não prova discriminação: é o que sobra depois de comparar pessoas de mesmo perfil, e inclui tudo o que o modelo não mede. É o limite superior do que a discriminação poderia explicar.
      </p>
    </section>
  );
}

// -------------------------------------------------------- participação
function Participacao({ area }: { area: Area }) {
  const feminina = useConsulta(area.slug, area.repo, `
    SELECT ano,
           sum(estoque_3112) FILTER (WHERE sexo = 'Mulher') / sum(estoque_3112) FILTER (WHERE sexo IN ('Homem', 'Mulher')) AS estoque,
           sum(estoque_3112) FILTER (WHERE sexo = 'Mulher' AND ocupacao_da_area) / sum(estoque_3112) FILTER (WHERE sexo IN ('Homem', 'Mulher') AND ocupacao_da_area) AS profissionais
    FROM rais_estoque_perfil WHERE ${RECORTE} GROUP BY 1 ORDER BY 1`);
  const fem = feminina.tipo === "pronto" ? feminina.dados.filter((l) => l.estoque !== null) : [];
  const resposta =
    fem.length > 1
      ? `As mulheres eram ${fmt.parte(num(fem[0], "estoque"))} dos vínculos de ${area.sigla} em ${num(fem[0], "ano")} e ${fmt.parte(num(fem.at(-1), "estoque"))} em ${num(fem.at(-1), "ano")}: o setor cresceu e ficou proporcionalmente menos feminino.`
      : undefined;
  return (
    <section className="flex flex-col gap-4">
      <Titulo pergunta="As mulheres ganharam espaço?" resposta={resposta} />
      <Painel
        titulo="Participação feminina"
        descricao={`RAIS · parte de mulheres entre os vínculos ativos em 31/12, no recorte inteiro e só entre quem exerce ocupação de ${area.sigla}`}
        estado={feminina}
        altura={280}
        nacional
        tabela={(d) => ({ colunas: [{ chave: "ano", rotulo: "Ano" }, { chave: "estoque", rotulo: "Recorte de TI", formato: fmt.parte }, { chave: "profissionais", rotulo: "Profissionais de TI", formato: fmt.parte }], linhas: d })}
      >
        {(d) => (
          <Grafico
            rotulo={`Participação feminina em ${area.nome}`}
            altura={280}
            opcao={(t) =>
              opcaoLinhas(t, rotulos(d, "ano"), [{ nome: "Recorte de TI", dados: coluna(d, "estoque") }, { nome: "Profissionais de TI", dados: coluna(d, "profissionais") }], {
                formato: fmt.parte,
                formatoEixo: (v) => fmt.parte(v),
                rotuloFinal: true,
                altura: 280,
              })
            }
          />
        )}
      </Painel>
    </section>
  );
}
