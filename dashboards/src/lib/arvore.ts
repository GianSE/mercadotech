import type { Area } from "./areas";
import { DIVISOES_CNAE } from "./cnae";
import type { Linha } from "./dados";

/*
 * As hierarquias do recorte: ocupações (subárea → família CBO → ocupação) e
 * atividades (divisão CNAE → subclasse). Do site do TCC (ArvoreContagem.tsx),
 * com os nomes vindos da área em vez de escritos para TI.
 */

/** Um nó: grupo (com filhos) ou item (folha). Qualquer nível pode ser escolhido. */
export type No = { id: string; codigo: string; nome: string; valor: number; filhos?: No[] };

// Busca sem acento e sem maiúscula; o código também casa sem a pontuação
// ("2124", "212405", "8610" ou "8610-1/01").
const normalizar = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const soDigitos = (s: string) => s.replace(/\D/g, "");

export function casaBusca(no: No, busca: string): boolean {
  const termo = normalizar(busca.trim());
  if (!termo) return true;
  const digitos = soDigitos(termo);
  return normalizar(no.nome).includes(termo) || (digitos.length >= 2 && digitos === termo.replace(/[\s.\-/]/g, "") && soDigitos(no.codigo).startsWith(digitos));
}

// Um grupo que casa mostra tudo o que tem dentro; senão, só os filhos que casam.
function filtrar(no: No, busca: string): No | null {
  if (casaBusca(no, busca)) return no;
  const filhos = (no.filhos ?? []).map((f) => filtrar(f, busca)).filter((f): f is No => f !== null);
  return filhos.length ? { ...no, filhos } : null;
}

export function filtrarArvore(nos: No[], busca: string): No[] {
  return nos.map((n) => filtrar(n, busca)).filter((n): n is No => n !== null);
}

export function acharNo(nos: No[], id: string): No | undefined {
  for (const n of nos) {
    if (n.id === id) return n;
    const achado = acharNo(n.filhos ?? [], id);
    if (achado) return achado;
  }
  return undefined;
}

/** Do topo até o nó: os ancestrais e o próprio nó (a trilha do drill down). */
export function caminhoAte(nos: No[], id: string): No[] {
  for (const n of nos) {
    if (n.id === id) return [n];
    const resto = caminhoAte(n.filhos ?? [], id);
    if (resto.length) return [n, ...resto];
  }
  return [];
}

/** As folhas debaixo de um nó (ou o próprio nó, se for folha). */
export function folhasDe(no: No): No[] {
  return no.filhos?.length ? no.filhos.flatMap(folhasDe) : [no];
}

/** Só o ramo de um nó: os ancestrais (para o contexto) e tudo debaixo dele. */
export function ramo(nos: No[], id: string): No[] {
  const podar = (no: No): No | null => {
    if (no.id === id) return no;
    const filhos = (no.filhos ?? []).map(podar).filter((f): f is No => f !== null);
    return filhos.length ? { ...no, filhos } : null;
  };
  return nos.map(podar).filter((n): n is No => n !== null);
}

const soma = (filhos: No[]) => filhos.reduce((t, f) => t + f.valor, 0);
const porValor = (a: No, b: No) => b.valor - a.valor;

/**
 * Ocupações da área: subárea → família → ocupação. `linhas` de
 * rais_recorte_cbo (cbo, ocupacao, area, vinculos). Quem entrou só pela lente
 * do setor (a subárea "Outra ocupação") fica de fora: não é ocupação da área.
 */
export function arvoreCbo(linhas: Linha[], area: Area): No[] {
  const { familias, avulsos } = area;
  const subareas = new Map<string, Map<string, No[]>>();
  for (const l of linhas) {
    const sub = String(l.area ?? "");
    if (!sub || sub === area.rotulos.nao_area) continue;
    const cbo = String(l.cbo);
    const fam = cbo.slice(0, 4);
    const porFamilia = subareas.get(sub) ?? new Map<string, No[]>();
    subareas.set(sub, porFamilia);
    const lista = porFamilia.get(fam) ?? [];
    porFamilia.set(fam, lista);
    lista.push({ id: `cbo:${cbo}`, codigo: `${fam}-${cbo.slice(4)}`, nome: String(l.ocupacao ?? cbo), valor: Number(l.vinculos ?? 0) });
  }
  // A ordem das subáreas é a do areas.py; dentro delas, por tamanho.
  return area.subareas
    .filter((s) => subareas.has(s))
    .map((s) => {
      const filhos = [...subareas.get(s)!.entries()]
        .map(([fam, ocupacoes]): No => ({
          id: `familia:${fam}`,
          codigo: fam,
          // Uma família que só tem código avulso na área (como a 3132 em TI)
          // leva o nome do avulso.
          nome: familias[fam] ?? (ocupacoes.length === 1 ? avulsos[soDigitos(ocupacoes[0].codigo)] ?? ocupacoes[0].nome : `Família ${fam}`),
          valor: soma(ocupacoes),
          filhos: ocupacoes.sort(porValor),
        }))
        .sort(porValor);
      return { id: `subarea:${s}`, codigo: "", nome: s, valor: soma(filhos), filhos };
    });
}

const fmtCnae = (c: string) => (c.length === 7 ? `${c.slice(0, 4)}-${c[4]}/${c.slice(5)}` : c);

/** Atividades do setor da área: divisão → subclasse. `linhas` com (cnae, atividade, vinculos). */
export function arvoreCnae(linhas: Linha[]): No[] {
  const divisoes = new Map<string, No[]>();
  for (const l of linhas) {
    const cnae = String(l.cnae ?? "").padStart(7, "0");
    const d = cnae.slice(0, 2);
    const lista = divisoes.get(d) ?? [];
    divisoes.set(d, lista);
    lista.push({ id: `cnae:${cnae}`, codigo: fmtCnae(cnae), nome: String(l.atividade ?? cnae), valor: Number(l.vinculos ?? 0) });
  }
  return [...divisoes.entries()]
    .sort()
    .map(([d, filhos]) => ({ id: `divisao:${d}`, codigo: d, nome: DIVISOES_CNAE[d] ?? `Divisão ${d}`, valor: soma(filhos), filhos: filhos.sort(porValor) }));
}
