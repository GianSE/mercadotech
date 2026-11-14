import { useCallback, useState } from "react";

/*
 * Estado de página que mora no endereço: /saude/crescimento?periodo=2010-2025&uf=PR,SC.
 * Copiar o link leva outra pessoa ao mesmo recorte. O valor padrão não aparece
 * no link, e mudar um filtro não cria entrada no histórico (replaceState).
 */

export function gravarParametro(nome: string, valor: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (valor === null || valor === "") params.delete(nome);
  else params.set(nome, valor);
  const consulta = params.toString();
  const novo = `${window.location.pathname}${consulta ? `?${consulta}` : ""}${window.location.hash}`;
  if (novo !== `${window.location.pathname}${window.location.search}${window.location.hash}`) history.replaceState(history.state, "", novo);
}

export function lerParametro(nome: string): string | null {
  return new URLSearchParams(window.location.search).get(nome);
}

export function useParametro<T>(nome: string, padrao: T, ler: (s: string) => T | null, escrever: (v: T) => string) {
  const [valor, setValor] = useState<T>(() => {
    const bruto = lerParametro(nome);
    return (bruto === null ? null : ler(bruto)) ?? padrao;
  });
  // `ler`, `escrever` e `padrao` são fixos por página: só o nome importa.
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

/** Período "2007-2025" no link. */
export const lerPeriodo = (s: string): [number, number] | null => {
  const m = s.match(/^(\d{4})-(\d{4})$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
export const escreverPeriodo = (p: readonly [number, number]) => `${p[0]}-${p[1]}`;
