import * as duckdb from "@duckdb/duckdb-wasm";
import { useEffect, useState } from "react";
import { baixarTabela, infoGold, RENOMEAR, type Estado } from "./dados";

/*
 * SQL sobre a gold da área, no navegador. As páginas escrevem as consultas
 * pelo nome da tabela (`FROM rais_estoque_uf`), como no site do TCC; cada
 * tabela citada é baixada na primeira vez e vira uma VIEW no schema da área.
 * Um schema por área: trocar de área nunca mistura as tabelas de uma com as
 * da outra, e a mesma consulta serve a todas.
 *
 * O motor (uns 35 MB) só é baixado quando a primeira consulta chega, ou seja,
 * quando uma seção que filtra os dados é aberta. A página inicial e a visão
 * geral não precisam dele.
 */

export type LinhaSQL = Record<string, string | number | boolean | null>;

/** A área ainda não publicou a tabela: a página mostra o aviso, não um erro. */
export class TabelaAusente extends Error {
  constructor(public tabela: string) {
    super(`a área ainda não publicou ${tabela}`);
  }
}

let banco: Promise<duckdb.AsyncDuckDB> | null = null;
const views = new Map<string, Promise<void>>();

async function iniciar(): Promise<duckdb.AsyncDuckDB> {
  // Worker e .wasm do jsDelivr: o .wasm passa do limite de 25 MiB por arquivo
  // da Cloudflare, e o CDN já entrega comprimido e em cache.
  const pacote = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  const urlWorker = URL.createObjectURL(new Blob([`importScripts("${pacote.mainWorker}");`], { type: "text/javascript" }));
  const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(urlWorker));
  await db.instantiate(pacote.mainModule, pacote.pthreadWorker);
  URL.revokeObjectURL(urlWorker);
  return db;
}

const obterBanco = () => (banco ??= iniciar());

/**
 * O motor do DuckDB (worker e .wasm) vem do jsDelivr. Na primeira visita ele
 * pode ser baixado antes de o service worker assumir a página, e aí fica só
 * no cache do navegador, que pode ser apagado. Pedido de novo com o service
 * worker no controle, entra no cache do app: o site passa a abrir sem internet.
 */
export async function guardarMotorNoCache(): Promise<void> {
  if (import.meta.env.DEV) return;
  const pacote = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
  await Promise.all([pacote.mainModule, pacote.mainWorker].filter(Boolean).map((url) => fetch(url!)));
}

/** schema."tabela" pronto para consulta; baixa o arquivo só na primeira vez. */
function garantirView(schema: string, repo: string, tabela: string): Promise<void> {
  const chave = `${schema}.${tabela}`;
  let pronta = views.get(chave);
  if (!pronta) {
    pronta = (async () => {
      const [db, arquivo] = await Promise.all([obterBanco(), baixarTabela(repo, tabela)]);
      if (!arquivo) throw new TabelaAusente(tabela);
      const nome = `${schema}__${tabela}.parquet`;
      await db.registerFileBuffer(nome, new Uint8Array(arquivo));
      const con = await db.connect();
      try {
        await con.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
        // As colunas de TI ganham o nome genérico das páginas (ver RENOMEAR).
        const colunas = (await con.query(`SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${nome}'))`))
          .toArray()
          .map((l) => String(l.toJSON().column_name));
        const trocar = colunas.filter((c) => c in RENOMEAR);
        const lista = trocar.length ? `* EXCLUDE (${trocar.join(", ")}), ${trocar.map((c) => `${c} AS ${RENOMEAR[c]}`).join(", ")}` : "*";
        await con.query(`CREATE OR REPLACE VIEW "${schema}"."${tabela}" AS SELECT ${lista} FROM read_parquet('${nome}')`);
      } finally {
        await con.close();
      }
    })();
    // Uma falha de rede não fica guardada: a próxima consulta tenta de novo.
    pronta.catch((e) => !(e instanceof TabelaAusente) && views.delete(chave));
    views.set(chave, pronta);
  }
  return pronta;
}

// BIGINT chega do Arrow como bigint; para gráfico e texto, number basta.
function converter(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  return String(v);
}

/** Executa `sql` no schema da área (`schema` = slug da área). */
export async function consultar(schema: string, repo: string, sql: string): Promise<LinhaSQL[]> {
  const { tabelas } = await infoGold(repo);
  // As tabelas citadas na consulta, pelo nome: as que a gold tem e as que
  // ela não tem (para avisar qual falta, em vez de um erro de SQL).
  // Nomes definidos no WITH (`WITH est AS (...)`) não são tabelas da gold.
  const ctes = new Set([...sql.matchAll(/(?:\bWITH|,)\s*([a-z_][a-z0-9_]*)\s+AS\s*\(/gi)].map((m) => m[1].toLowerCase()));
  const citadas = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)]
    .map((m) => m[1].toLowerCase())
    .filter((t) => !ctes.has(t));
  const faltando = citadas.find((t) => !tabelas.has(t));
  if (faltando) throw new TabelaAusente(faltando);
  await Promise.all([...new Set(citadas)].map((t) => garantirView(schema, repo, t)));

  const con = await (await obterBanco()).connect();
  try {
    await con.query(`SET search_path = '${schema}'`);
    const resultado = await con.query(sql);
    return resultado.toArray().map((linha) => {
      const bruto = linha.toJSON() as Record<string, unknown>;
      return Object.fromEntries(Object.entries(bruto).map(([k, v]) => [k, converter(v)]));
    });
  } finally {
    await con.close();
  }
}

/**
 * Consulta da página. `null` não consulta (a parte da página que a usa está
 * escondida). Ao trocar um filtro, o resultado anterior fica na tela até o
 * novo chegar, sem pulo de layout.
 */
export function useConsulta(schema: string, repo: string, sql: string | null): Estado<LinhaSQL[]> & { anterior?: LinhaSQL[] } {
  const [estado, setEstado] = useState<Estado<LinhaSQL[]> & { anterior?: LinhaSQL[] }>({ tipo: "carregando" });
  useEffect(() => {
    if (sql === null) return;
    let vivo = true;
    setEstado((e) => ({ tipo: "carregando", anterior: e.tipo === "pronto" ? e.dados : e.anterior }));
    consultar(schema, repo, sql).then(
      (linhas) => vivo && setEstado({ tipo: "pronto", dados: linhas }),
      (e: unknown) =>
        vivo &&
        setEstado(
          e instanceof TabelaAusente
            ? { tipo: "ausente" }
            : { tipo: "erro", mensagem: e instanceof Error ? e.message : String(e) },
        ),
    );
    return () => {
      vivo = false;
    };
  }, [schema, repo, sql]);
  return estado;
}
