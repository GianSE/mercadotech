import { useEffect, useState } from "react";
import { consultar, type Linha } from "./db";

type Estado = { linhas: Linha[]; carregando: boolean; erro: string | null };

// Ao trocar o filtro, mantém o resultado anterior na tela (o gráfico fica
// esmaecido) até o novo chegar — sem esqueleto, sem pulo de layout.
export function useConsulta(sql: string | null): Estado {
  const [estado, setEstado] = useState<Estado>({ linhas: [], carregando: sql !== null, erro: null });

  useEffect(() => {
    if (sql === null) return;
    let ativo = true;
    setEstado((e) => ({ ...e, carregando: true, erro: null }));
    consultar(sql)
      .then((linhas) => ativo && setEstado({ linhas, carregando: false, erro: null }))
      .catch((e: unknown) => ativo && setEstado((s) => ({ ...s, carregando: false, erro: String(e) })));
    return () => {
      ativo = false;
    };
  }, [sql]);

  return estado;
}
