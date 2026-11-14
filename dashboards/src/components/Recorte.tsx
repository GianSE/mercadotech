import { ChevronRight } from "lucide-react";
import { useCallback, useMemo } from "react";
import type { Area } from "../lib/areas";
import { acharNo, caminhoAte, folhasDe, type No } from "../lib/arvore";
import type { Estado } from "../lib/dados";
import { fmt } from "../lib/formato";
import { opcaoHierarquia, type NoAnel } from "../lib/graficos";
import { useRecorteCbo, useRecorteCnae, type Hierarquia, type Recorte } from "../lib/recorte";
import { useParametro } from "../lib/url";
import { Grafico } from "./Grafico";
import { Painel } from "./Painel";
import { SeletorArvore } from "./SeletorArvore";
import { Titulo } from "./Titulo";
import { Segmentado } from "./ui/segmentado";

/*
 * O recorte de TI como hierarquia, em anéis (aba Método). Escolher um nível
 * no menu ou clicar num anel levam ao mesmo lugar, e a escolha fica no
 * endereço (?h=cbo&no=...).
 */

const TODOS = "todos";
const lerH = (s: string) => (s === "cbo" || s === "cnae" ? s : null);
const lerNo = (s: string) => s || null;

function useEscolha() {
  const [h, setH] = useParametro<Hierarquia>("h", "cbo", lerH, String);
  const [no, setNo] = useParametro<string>("no", TODOS, lerNo, String);
  return { h, no, trocarH: (v: Hierarquia) => (setH(v), setNo(TODOS)), setNo };
}

function useRecorte(area: Area, h: Hierarquia): Estado<Recorte> {
  const cbo = useRecorteCbo(area);
  const cnae = useRecorteCnae(area);
  return h === "cbo" ? cbo : cnae;
}

const textos = (area: Area, h: Hierarquia) =>
  h === "cbo"
    ? { rotulo: "Ocupação", todos: `Todas as ocupações de ${area.sigla}`, busca: "Buscar ocupação ou código CBO", unidade: "vínculos" }
    : { rotulo: "Atividade", todos: `Todas as atividades do setor de ${area.sigla}`, busca: "Buscar atividade ou código CNAE", unidade: "vínculos" };

/** A trilha do topo até o nó escolhido, cada passo clicável. */
function Trilha({ caminho, raiz, aoIr }: { caminho: No[]; raiz: string; aoIr: (id: string) => void }) {
  if (!caminho.length) return null;
  return (
    <nav aria-label="Nível escolhido" className="flex flex-wrap items-center gap-1 text-sm">
      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => aoIr(TODOS)}>
        {raiz}
      </button>
      {caminho.map((n, i) => (
        <span key={n.id} className="flex items-center gap-1">
          <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />
          {i === caminho.length - 1 ? (
            <span className="font-medium">{n.nome}</span>
          ) : (
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => aoIr(n.id)}>
              {n.nome}
            </button>
          )}
        </span>
      ))}
    </nav>
  );
}

function Controles({ area, h, no, trocarH, setNo, arvore }: { area: Area; h: Hierarquia; no: string; trocarH: (h: Hierarquia) => void; setNo: (id: string) => void; arvore: No[] }) {
  const t = textos(area, h);
  return (
    <div className="flex flex-wrap items-end gap-4">
      <Segmentado<Hierarquia> rotulo="Hierarquia" valor={h} opcoes={[{ valor: "cbo", rotulo: "Ocupações (CBO)" }, { valor: "cnae", rotulo: "Atividades (CNAE)" }]} aoMudar={trocarH} />
      <SeletorArvore rotulo={t.rotulo} valor={no} nos={arvore} todos={{ id: TODOS, nome: t.todos }} aoMudar={setNo} placeholder={t.busca} />
    </div>
  );
}

const paraAnel = (nos: No[]): NoAnel[] => nos.map((n) => ({ id: n.id, nome: n.codigo && !n.filhos?.length ? `${n.codigo} ${n.nome}` : n.nome, valor: n.valor, filhos: n.filhos?.length ? paraAnel(n.filhos) : undefined }));

// ------------------------------------------------------------- anéis
export function AneisRecorte({ area }: { area: Area }) {
  const { h, no, trocarH, setNo } = useEscolha();
  const estado = useRecorte(area, h);
  const t = textos(area, h);
  const r = estado.tipo === "pronto" ? estado.dados : null;
  const arvore = useMemo(() => r?.arvore ?? [], [r]);
  const atual = no === TODOS ? undefined : acharNo(arvore, no);
  // Uma folha não tem anel próprio: mostra a família dela, com ela dentro.
  const caminho = atual ? caminhoAte(arvore, atual.id) : [];
  const centro = atual && !atual.filhos?.length ? caminho.at(-2) : atual;
  const nos = centro ? [centro] : arvore;
  const clicar = useCallback((p: { data?: unknown }) => {
    const id = (p.data as { id?: string } | undefined)?.id;
    if (id) setNo(id);
  }, [setNo]);
  const total = nos.reduce((s, n) => s + n.valor, 0);

  return (
    <section className="flex flex-col gap-4">
      <Titulo
        pergunta={`O que conta como ${area.sigla}?`}
        resposta={r ? `Em ${r.ano}, ${fmt.inteiro(arvore.reduce((s, n) => s + n.valor, 0))} vínculos ativos ${h === "cbo" ? `de quem exerce ocupação de ${area.sigla}, em ${folhasDe({ id: "", codigo: "", nome: "", valor: 0, filhos: arvore }).length} ocupações` : `nas ${folhasDe({ id: "", codigo: "", nome: "", valor: 0, filhos: arvore }).length} atividades do setor de ${area.sigla}`}. Clique num anel para descer na hierarquia.` : undefined}
      />
      <Painel
        titulo={atual ? atual.nome : t.todos}
        descricao={
          <>
            RAIS · vínculos ativos em 31/12{r ? `/${r.ano}` : ""} · {h === "cbo" ? "subárea → família → ocupação" : "divisão → subclasse"}
            {atual && <span className="block">{fmt.inteiro(atual.valor)} vínculos · {fmt.parte(atual.valor / (arvore.reduce((s, n) => s + n.valor, 0) || 1))} do recorte</span>}
          </>
        }
        estado={estado}
        altura={520}
        controles={
          <div className="flex flex-col gap-3">
            <Controles area={area} h={h} no={no} trocarH={trocarH} setNo={setNo} arvore={arvore} />
            <Trilha caminho={caminho} raiz={t.todos} aoIr={setNo} />
          </div>
        }
        tabela={() => ({
          colunas: [{ chave: "codigo", rotulo: "Código" }, { chave: "nome", rotulo: "Nome" }, { chave: "valor", rotulo: "Vínculos", formato: fmt.inteiro }, { chave: "parte", rotulo: "Parte", formato: fmt.parte }],
          linhas: nos.flatMap(folhasDe).sort((a, b) => b.valor - a.valor).map((f) => ({ codigo: f.codigo, nome: f.nome, valor: f.valor, parte: f.valor / (total || 1) })),
        })}
      >
        {() => <Grafico rotulo={`Hierarquia do recorte de ${area.nome}`} altura={520} aoClicar={clicar} opcao={(tinta) => opcaoHierarquia(tinta, paraAnel(nos), { unidade: "vínculos" })} />}
      </Painel>
    </section>
  );
}
