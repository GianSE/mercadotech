// Recorte no endereço: #/onde?uf=PR&destacar=Cornélio%20Procópio. Copiar o
// link da barra (ou pelo botão do cabeçalho) leva outra pessoa ao mesmo
// recorte. A rota fica antes do "?"; os parâmetros, depois.
import { useCallback, useEffect, useState } from "react";

export function partesHash(): { rota: string; params: URLSearchParams } {
  const [rota, consulta = ""] = window.location.hash.replace(/^#\/?/, "").split("?");
  return { rota, params: new URLSearchParams(consulta) };
}

// replaceState não dispara hashchange nem cria entrada no histórico: mudar
// um filtro não vira um "voltar" a mais no navegador.
export function gravarParametro(nome: string, valor: string | null) {
  const { rota, params } = partesHash();
  if (valor === null || valor === "") params.delete(nome);
  else params.set(nome, valor);
  const consulta = params.toString();
  const novo = `#/${rota}${consulta ? `?${consulta}` : ""}`;
  if (novo !== window.location.hash) history.replaceState(null, "", novo);
}

// Estado de página que mora no endereço. Ao entrar na página, lê o
// parâmetro; ao mudar, grava. O padrão não aparece no link.
export function useParametro<T>(nome: string, padrao: T, ler: (s: string) => T | null, escrever: (v: T) => string) {
  const [valor, setValor] = useState<T>(() => {
    const bruto = partesHash().params.get(nome);
    return (bruto === null ? null : ler(bruto)) ?? padrao;
  });
  // Um link colado com a página já aberta muda só o parâmetro, sem remontar a
  // página: o valor acompanha o endereço. (A escrita usa replaceState, que
  // não dispara este evento.)
  useEffect(() => {
    const aoMudar = () => {
      const bruto = partesHash().params.get(nome);
      const novo = (bruto === null ? null : ler(bruto)) ?? padrao;
      setValor((atual) => (escrever(atual) === escrever(novo) ? atual : novo));
    };
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nome]);
  // `ler`, `escrever` e `padrao` são fixos por página: só o nome entra na dependência.
  const definir = useCallback(
    (v: T) => {
      setValor(v);
      const texto = escrever(v);
      gravarParametro(nome, texto === escrever(padrao) ? null : texto);
    },
    [nome],
  );
  return [valor, definir] as const;
}

// "Limpar filtros": volta a página ao padrão. Avisa antes (o filtro de
// território zera e a página se remonta, o que repõe também as escolhas que
// não vão para o link, como Ano/Mês) e só depois tira os parâmetros do
// endereço — nessa ordem, o território não é regravado no link novo.
export const EVENTO_LIMPAR = "mercadotech:limpar-filtros";
export function limparFiltros() {
  window.dispatchEvent(new Event(EVENTO_LIMPAR));
  const { rota } = partesHash();
  if (window.location.hash !== `#/${rota}`) window.location.hash = `#/${rota}`;
}

// Período "2007-2026" no link.
export const lerPeriodo = (s: string): [number, number] | null => {
  const m = s.match(/^(\d{4})-(\d{4})$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
export const escreverPeriodo = (p: readonly [number, number]) => `${p[0]}-${p[1]}`;
export const texto = (s: string) => s;
