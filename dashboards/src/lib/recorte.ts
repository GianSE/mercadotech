import type { Area } from "./areas";
import { arvoreCbo, arvoreCnae, type No } from "./arvore";
import { useTabela, type Estado, type Linha } from "./dados";

/*
 * As duas árvores do recorte e a série de cada folha, lidas sem o DuckDB (as
 * tabelas são pequenas): a aba Método mostra os anéis sem baixar o motor.
 */

export type Hierarquia = "cbo" | "cnae";

export type Recorte = {
  ano: number;
  arvore: No[];
  /** vínculos ativos em 31/12 por ano e folha (id do nó folha) */
  serie: Map<string, Map<number, number>>;
  anos: number[];
};

function montar(linhas: { ano: number; id: string; valor: number }[], arvoreDoAno: (ano: number) => No[]): Recorte {
  const anos = [...new Set(linhas.map((l) => l.ano))].sort((a, b) => a - b);
  const ano = anos.at(-1) ?? 0;
  const serie = new Map<string, Map<number, number>>();
  for (const l of linhas) {
    const porAno = serie.get(l.id) ?? new Map<number, number>();
    serie.set(l.id, porAno);
    porAno.set(l.ano, (porAno.get(l.ano) ?? 0) + l.valor);
  }
  return { ano, arvore: arvoreDoAno(ano), serie, anos };
}

/** Ocupações da área (rais_recorte_cbo): subárea → família → ocupação. */
export function useRecorteCbo(area: Area): Estado<Recorte> {
  return useTabela(area.repo, "rais_recorte_cbo", (linhas: Linha[]) => {
    const ativos = linhas.filter((l) => Number(l.estoque_3112) > 0);
    return montar(
      ativos.map((l) => ({ ano: Number(l.ano), id: `cbo:${l.cbo}`, valor: Number(l.estoque_3112) })),
      (ano) => arvoreCbo(ativos.filter((l) => Number(l.ano) === ano).map((l) => ({ ...l, vinculos: Number(l.estoque_3112) })), area),
    );
  });
}

/** Atividades do setor da área (rais_setor_vs_ocupacao, só o setor): divisão → subclasse. */
export function useRecorteCnae(area: Area): Estado<Recorte> {
  return useTabela(area.repo, "rais_setor_vs_ocupacao", (linhas: Linha[]) => {
    const setor = linhas.filter((l) => l.setor_da_area && Number(l.estoque_3112) > 0 && l.cnae);
    const cod = (l: Linha) => String(l.cnae).padStart(7, "0");
    return montar(
      setor.map((l) => ({ ano: Number(l.ano), id: `cnae:${cod(l)}`, valor: Number(l.estoque_3112) })),
      (ano) => {
        // Uma subclasse aparece em várias linhas (uma por lente): soma antes.
        const porCnae = new Map<string, { cnae: string; atividade: string; vinculos: number }>();
        for (const l of setor.filter((x) => Number(x.ano) === ano)) {
          const c = cod(l);
          const atual = porCnae.get(c) ?? { cnae: c, atividade: String(l.setor_empresa ?? c), vinculos: 0 };
          atual.vinculos += Number(l.estoque_3112);
          porCnae.set(c, atual);
        }
        return arvoreCnae([...porCnae.values()]);
      },
    );
  });
}
