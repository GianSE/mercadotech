import { parquetReadObjects } from "hyparquet";
import { decompress } from "fzstd";
import { useEffect, useState } from "react";

// A gold sai do DuckDB em ZSTD; o hyparquet só traz o Snappy embutido.
const compressors = { ZSTD: (entrada: Uint8Array) => decompress(entrada) };

/*
 * Os dados não vêm no build: o site lê do Hugging Face as tabelas da Gold do
 * TCC (Gianpedro/gold-analise-mercado-ti) que a página pede. As funções
 * recebem o caminho "usuário/repositório[/pasta]" (o `repo` de lib/areas.ts);
 * a pasta existe no mercadobrasil, onde cada área tem a sua, e aqui é vazia. A base fica numa
 * variável para poder trocar o Hub por outro endereço (um bucket R2, por
 * exemplo) sem mexer nas páginas.
 */
const BASE = (import.meta.env.VITE_DADOS_BASE as string | undefined) ?? "https://huggingface.co";

// O Hub responde 404 a toda requisição com Referer de *.workers.dev (o
// endereço do site), na API e nos arquivos; sem Referer, a mesma requisição
// passa. A origem continua indo, que é o que o CORS precisa.
const SEM_REFERER: RequestInit = { referrerPolicy: "no-referrer" };

export type Linha = Record<string, unknown>;

/** `tabelas`: o nome de cada tabela da gold -> o último commit que a mudou. */
type InfoGold = { atualizado: Date; tabelas: Map<string, string>; repo: string; pasta: string };
type Arquivo = { type: string; path: string; lastCommit?: { id: string; date: string } };

const listagens = new Map<string, Promise<Arquivo[]>>();
const tabelas = new Map<string, Promise<Linha[] | null>>();

/** "usuário/repositório/pasta" -> o repositório e a pasta (vazia na gold de uma área só, como a do TCC). */
function separar(caminho: string): { repo: string; pasta: string } {
  const partes = caminho.split("/");
  return { repo: partes.slice(0, 2).join("/"), pasta: partes.slice(2).join("/") };
}

/** O endereço da próxima página no cabeçalho Link (`<url>; rel="next"`), ou null. */
function proximaPagina(link: string | null): string | null {
  const m = link?.match(/<([^>]+)>;\s*rel="next"/);
  return m ? m[1] : null;
}

/**
 * Os arquivos direto na pasta da gold, cada um com o último commit que o
 * mudou: uma chamada por pasta e sessão. Só a pasta, e não o repositório
 * inteiro: no repositório da área a silver mora ao lado, e um commit dela não
 * pode mudar a data da gold nem invalidar o cache das tabelas.
 */
function listar(repo: string, pasta: string): Promise<Arquivo[]> {
  const chave = `${repo}/${pasta}`;
  let listagem = listagens.get(chave);
  if (!listagem) {
    listagem = (async () => {
      const arquivos: Arquivo[] = [];
      let url: string | null = `${BASE}/api/datasets/${repo}/tree/main${pasta ? `/${pasta}` : ""}?expand=true`;
      while (url) {
        const r: Response = await fetch(url, SEM_REFERER);
        // O repositório ou a pasta ainda não existem (a primeira gold não
        // rodou): não é erro, só não há tabela nenhuma. Sem login, o Hub
        // responde 401 (e não 404) a repositório inexistente.
        if (r.status === 404 || r.status === 401) return arquivos;
        if (!r.ok) throw new Error(`${repo}: HTTP ${r.status}`);
        arquivos.push(...((await r.json()) as Arquivo[]));
        // Com expand, o Hub pagina; o resto vem pelo cabeçalho Link.
        url = proximaPagina(r.headers.get("Link"));
      }
      return arquivos;
    })();
    listagem.catch(() => listagens.delete(chave));
    listagens.set(chave, listagem);
  }
  return listagem;
}

/** As tabelas que a área publicou (os .parquet direto na pasta dela) e quando a gold mudou por último. */
export async function infoGold(caminho: string): Promise<InfoGold> {
  const { repo, pasta } = separar(caminho);
  const prefixo = pasta ? `${pasta}/` : "";
  const tabelasDaPasta = new Map<string, string>();
  let atualizado = new Date(0);
  for (const a of await listar(repo, pasta)) {
    if (a.type !== "file" || !a.path.endsWith(".parquet")) continue;
    tabelasDaPasta.set(a.path.slice(prefixo.length, -8), a.lastCommit?.id ?? "main");
    const data = a.lastCommit ? new Date(a.lastCommit.date) : null;
    if (data && data > atualizado) atualizado = data;
  }
  return { atualizado, tabelas: tabelasDaPasta, repo, pasta };
}

/**
 * A gold do TCC guarda as colunas de classificação com o nome de TI
 * (setor_ti, ocupacao_ti, area_ti); as páginas, que vieram do mercadobrasil,
 * usam os nomes genéricos de lá. Os valores são os mesmos nas duas golds, só
 * o nome muda: a tradução acontece aqui, na leitura, e a gold publicada (que o
 * texto do TCC cita) fica como está.
 */
export const RENOMEAR: Record<string, string> = {
  setor_ti: "setor_da_area",
  ocupacao_ti: "ocupacao_da_area",
  area_ti: "subarea",
};

/** Números grandes do Parquet chegam como BigInt; os gráficos e a formatação querem Number. */
function normalizar(linha: Linha): Linha {
  for (const k in linha) {
    if (typeof linha[k] === "bigint") linha[k] = Number(linha[k]);
    if (k in RENOMEAR) {
      linha[RENOMEAR[k]] = linha[k];
      delete linha[k];
    }
  }
  return linha;
}

/**
 * O arquivo Parquet de uma tabela da gold, inteiro. As tabelas são agregados
 * pequenos (poucos KB a 1 MB). null quando a área ainda não publicou a
 * tabela — o que é normal: cada etapa da gold roda separada.
 */
export async function baixarTabela(caminho: string, nome: string): Promise<ArrayBuffer | null> {
  const info = await infoGold(caminho);
  const revisao = info.tabelas.get(nome);
  if (!revisao) return null;
  // Pelo último commit da tabela, não por "main": o endereço só muda quando a
  // própria tabela muda, e o cache do navegador pode guardá-lo.
  const arquivo = info.pasta ? `${info.pasta}/${nome}.parquet` : `${nome}.parquet`;
  const r = await fetch(`${BASE}/datasets/${info.repo}/resolve/${revisao}/${arquivo}`, SEM_REFERER);
  if (!r.ok) throw new Error(`${nome}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

/** Uma tabela inteira da gold já como linhas, sem SQL: para as leituras simples. */
export function lerTabela(repo: string, nome: string): Promise<Linha[] | null> {
  const chave = `${repo}/${nome}`;
  let tabela = tabelas.get(chave);
  if (!tabela) {
    tabela = baixarTabela(repo, nome).then(async (arquivo) => {
      if (!arquivo) return null;
      const linhas = (await parquetReadObjects({ file: arquivo, compressors })) as Linha[];
      return linhas.map(normalizar);
    });
    tabela.catch(() => tabelas.delete(chave));
    tabelas.set(chave, tabela);
  }
  return tabela;
}

export type Estado<T> =
  | { tipo: "carregando" }
  | { tipo: "ausente" }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "pronto"; dados: T };

/** Lê uma tabela e a transforma; refaz quando o repositório ou a tabela mudam. */
export function useTabela<T>(repo: string, nome: string, transformar: (linhas: Linha[]) => T): Estado<T> {
  const [estado, setEstado] = useState<Estado<T>>({ tipo: "carregando" });
  useEffect(() => {
    let vivo = true;
    setEstado({ tipo: "carregando" });
    lerTabela(repo, nome).then(
      (linhas) => vivo && setEstado(linhas ? { tipo: "pronto", dados: transformar(linhas) } : { tipo: "ausente" }),
      (e: unknown) => vivo && setEstado({ tipo: "erro", mensagem: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      vivo = false;
    };
    // `transformar` é uma função pura de cada página; mudar só ela não pede outra leitura.
  }, [repo, nome]);
  return estado;
}
