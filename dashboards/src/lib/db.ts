import * as duckdb from "@duckdb/duckdb-wasm";

export type Linha = Record<string, string | number | boolean | null>;

type Manifesto = {
  gerado_em: string;
  tabelas: Record<string, { arquivo: string; bytes: number }>;
};

let manifesto: Promise<Manifesto> | null = null;
let banco: Promise<duckdb.AsyncDuckDB> | null = null;
const tabelas = new Map<string, Promise<void>>();

export function obterManifesto(): Promise<Manifesto> {
  // Sempre conferido com o servidor (a resposta é um 304 quando nada mudou):
  // é ele que diz qual versão dos dados acompanha o código publicado.
  manifesto ??= fetch("/dados/manifesto.json", { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error("manifesto.json não encontrado — rode `npm run dados`");
    return r.json();
  });
  return manifesto;
}

// O motor do DuckDB (worker e .wasm) vem do jsDelivr. Na primeira visita ele
// é baixado antes de o service worker assumir a página, e fica só no cache
// do navegador, que pode ser apagado. Pedido de novo com o service worker já
// no controle, entra no cache do app: o painel passa a abrir sem internet.
export async function guardarMotorNoCache(): Promise<void> {
  if (import.meta.env.DEV) return;
  const pacote = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  await Promise.all([pacote.mainModule, pacote.mainWorker].filter(Boolean).map((url) => fetch(url!)));
}

async function iniciar(): Promise<duckdb.AsyncDuckDB> {
  // Worker e .wasm vêm do jsDelivr: o .wasm passa do limite de 25 MiB por
  // arquivo do Cloudflare Pages, e o CDN entrega comprimido e em cache.
  // Em desenvolvimento (`npm run dev`), os mesmos arquivos saem do
  // node_modules pelo servidor do Vite: o site roda sem internet. Por URL, e
  // não por import, para o build de produção nem enxergar os .wasm.
  const local = `${location.origin}/node_modules/@duckdb/duckdb-wasm/dist/`;
  const pacotes: duckdb.DuckDBBundles = import.meta.env.DEV
    ? {
        mvp: { mainModule: `${local}duckdb-mvp.wasm`, mainWorker: `${local}duckdb-browser-mvp.worker.js` },
        eh: { mainModule: `${local}duckdb-eh.wasm`, mainWorker: `${local}duckdb-browser-eh.worker.js` },
      }
    : duckdb.getJsDelivrBundles();
  const pacote = await duckdb.selectBundle(pacotes);
  const urlWorker = URL.createObjectURL(
    new Blob([`importScripts("${pacote.mainWorker}");`], { type: "text/javascript" }),
  );
  const worker = new Worker(urlWorker);
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
  await db.instantiate(pacote.mainModule, pacote.pthreadWorker);
  URL.revokeObjectURL(urlWorker);
  await carregarParquet(db);
  return db;
}

// A extensão de Parquet vem da cópia que o build embarca (public/duckdb-ext,
// ver scripts/preparar_dados.py); se ela faltar ou não servir a esta versão
// do motor, do servidor oficial. Sem ela, nenhuma tabela abre.
async function carregarParquet(db: duckdb.AsyncDuckDB) {
  const con = await db.connect();
  try {
    await con.query(`SET custom_extension_repository = '${location.origin}/duckdb-ext'`);
    await con.query("INSTALL parquet; LOAD parquet;");
  } catch {
    await con.query("RESET custom_extension_repository");
    await con.query("INSTALL parquet; LOAD parquet;");
  } finally {
    await con.close();
  }
}

function obterBanco() {
  banco ??= iniciar();
  return banco;
}

// Baixa o parquet inteiro (são pequenos) e o expõe como VIEW com o nome da
// tabela: as consultas escrevem `FROM mapa_uf`, não o caminho do arquivo.
function garantirTabela(nome: string, arquivo: string): Promise<void> {
  let pronta = tabelas.get(nome);
  if (!pronta) {
    pronta = (async () => {
      // A data de geração no endereço: depois de uma Gold nova, o navegador
      // não reaproveita a cópia antiga de uma tabela junto do código novo.
      const versao = encodeURIComponent((await obterManifesto()).gerado_em);
      const [db, resposta] = await Promise.all([obterBanco(), fetch(`/dados/${arquivo}?v=${versao}`)]);
      if (!resposta.ok) throw new Error(`falha ao baixar ${arquivo}`);
      await db.registerFileBuffer(arquivo, new Uint8Array(await resposta.arrayBuffer()));
      const con = await db.connect();
      try {
        await con.query(`CREATE OR REPLACE VIEW "${nome}" AS SELECT * FROM read_parquet('${arquivo}')`);
      } finally {
        await con.close();
      }
    })();
    tabelas.set(nome, pronta);
  }
  return pronta;
}

// BIGINT chega do Arrow como bigint; para gráfico e texto, number basta
// (os maiores valores daqui são contagens na casa dos milhões).
function converter(valor: unknown): string | number | boolean | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "bigint") return Number(valor);
  if (typeof valor === "number" || typeof valor === "string" || typeof valor === "boolean") return valor;
  return String(valor);
}

export async function consultar(sql: string): Promise<Linha[]> {
  const { tabelas: disponiveis } = await obterManifesto();
  const usadas = Object.entries(disponiveis).filter(([nome]) => new RegExp(`\\b${nome}\\b`).test(sql));
  await Promise.all(usadas.map(([nome, t]) => garantirTabela(nome, t.arquivo)));

  const con = await (await obterBanco()).connect();
  try {
    const resultado = await con.query(sql);
    return resultado.toArray().map((linha) => {
      const bruto = linha.toJSON() as Record<string, unknown>;
      return Object.fromEntries(Object.entries(bruto).map(([k, v]) => [k, converter(v)]));
    });
  } finally {
    await con.close();
  }
}
