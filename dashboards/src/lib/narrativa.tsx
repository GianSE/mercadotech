// Frases de leitura derivadas dos próprios dados: os números são calculados,
// nunca escritos à mão — quando a série atualiza, o texto acompanha em vez de
// virar mentira silenciosa.
import type { Linha } from "./db";
import { fmtDec, fmtNum, fmtSinal } from "./formato";

const n = (v: unknown) => Number(v);

export function arcoSaldo(anual: Linha[], ultimoAnoDaBase: number) {
  if (!anual.length) return null;
  // O ano corrente está sempre incompleto: entra na soma, não nas comparações.
  const fechados = anual.filter((l) => n(l.ano) < ultimoAnoDaBase);
  const base = fechados.length ? fechados : anual;
  const melhor = base.reduce((a, b) => (n(b.saldo) > n(a.saldo) ? b : a));
  const negativos = base.filter((l) => n(l.saldo) < 0);
  let queda: { ano: number; de: number; valor: number } | null = null;
  for (let i = 1; i < base.length; i++) {
    const v = n(base[i].saldo) - n(base[i - 1].saldo);
    if (!queda || v < queda.valor) queda = { ano: n(base[i].ano), de: n(base[i - 1].saldo), valor: v };
  }
  return {
    inicio: n(anual[0].ano),
    fim: n(anual[anual.length - 1].ano),
    saldoTotal: anual.reduce((s, l) => s + n(l.saldo), 0),
    admissoes: anual.reduce((s, l) => s + n(l.admissoes), 0),
    melhor: { ano: n(melhor.ano), saldo: n(melhor.saldo) },
    negativos: negativos.map((l) => n(l.ano)),
    perdaNegativos: negativos.reduce((s, l) => s + n(l.saldo), 0),
    queda,
  };
}

export function TextoSaldo({ a }: { a: NonNullable<ReturnType<typeof arcoSaldo>> }) {
  return (
    <p>
      Entre {a.inicio} e {a.fim}, o emprego formal em tecnologia gerou <strong>{fmtSinal(a.saldoTotal)} vagas líquidas</strong>,
      de {fmtNum(a.admissoes)} admissões.{" "}
      {a.negativos.length > 0 && (
        <>
          {a.negativos.length === 1 ? "O ano de saldo negativo foi " : "Os anos de saldo negativo foram "}
          <strong>{a.negativos.join(", ").replace(/, (?=[^,]*$)/, " e ")}</strong>, com perda somada de {fmtNum(Math.abs(a.perdaNegativos))} vagas
          {Math.abs(a.perdaNegativos) < a.melhor.saldo ? " — menos que o ganho do melhor ano sozinho" : ""}.{" "}
        </>
      )}
      O pico veio em <strong>{a.melhor.ano}</strong>, com {fmtSinal(a.melhor.saldo)} vagas.
      {a.queda && a.queda.de > 0 && a.queda.valor < 0 && (
        <> A maior desaceleração foi em <strong>{a.queda.ano}</strong>, quando o saldo caiu {fmtDec((Math.abs(a.queda.valor) / a.queda.de) * 100, 0)}% em relação ao ano anterior.</>
      )}
    </p>
  );
}

export function TextoEstoque({ anual }: { anual: Linha[] }) {
  if (anual.length < 2) return null;
  const [p, u] = [anual[0], anual[anual.length - 1]];
  const variacao = (n(u.estoque) / n(p.estoque) - 1) * 100;
  return (
    <p>
      Em {n(u.ano)} havia <strong>{fmtNum(u.estoque)} vínculos de tecnologia ativos em 31 de dezembro</strong> —{" "}
      {variacao >= 0 ? "+" : "−"}
      {fmtDec(Math.abs(variacao), 0)}% em relação aos {fmtNum(p.estoque)} de {n(p.ano)}. É o tamanho do mercado, não o quanto ele se
      moveu: o saldo do CAGED mede o movimento, a RAIS mede o nível.
    </p>
  );
}

export function TextoRemuneracao({ u, inicio }: { u: Linha; inicio: number }) {
  const razao = n(u.media) / n(u.mediana);
  return (
    <p>
      A mediana em {n(u.ano)} é de <strong>{fmtDec(u.mediana, 2)} salários mínimos</strong>, contra uma média de {fmtDec(u.media, 2)} —{" "}
      {fmtDec(razao, 1)} vez{razao >= 2 ? "es" : ""} maior. A distância mostra que a média é puxada por poucos salários altos: metade
      dos profissionais ganha até a mediana. Medir em salários mínimos permite comparar {inicio} com {n(u.ano)} sem escolher deflator.
    </p>
  );
}

export function TextoLentesEstoque({ fora, dentro }: { fora?: Linha; dentro?: Linha }) {
  if (!fora || !dentro) return null;
  const total = n(fora.estoque) + n(dentro.estoque);
  const smF = n(fora.mediana);
  const smD = n(dentro.mediana);
  const comparacao = smF > smD ? "e ganham mais que quem está dentro" : smF < smD ? "e ganham menos que quem está dentro" : "com remuneração equivalente";
  return (
    <p>
      <strong>{fmtDec((n(fora.estoque) / total) * 100, 0)}% dos profissionais de TI trabalham fora do setor de tecnologia</strong>{" "}
      ({fmtNum(fora.estoque)} contra {fmtNum(dentro.estoque)}), {comparacao} ({fmtDec(smF, 2)} contra {fmtDec(smD, 2)} salários mínimos na
      mediana). Olhar só as empresas de TI perderia mais da metade do mercado.
    </p>
  );
}
