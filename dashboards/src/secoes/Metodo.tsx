import { useEffect, useState } from "react";
import { CartaoTabela } from "../componentes/Grafico";
import { Bloco, Grade, Texto } from "../componentes/ui";
import { obterManifesto } from "../lib/db";
import { fmtDec } from "../lib/formato";

const REPOS = [
  ["bronze-caged", "Bronze", "Microdados do CAGED em Parquet, sem alteração de conteúdo"],
  ["bronze-rais", "Bronze", "Microdados da RAIS em Parquet, sem alteração de conteúdo"],
  ["mte-dicionarios", "Referência", "Planilhas de layout do MTE usadas na tradução dos códigos"],
  ["silver-caged-ti", "Silver", "CAGED traduzido e restrito ao recorte de tecnologia"],
  ["silver-rais-ti", "Silver", "RAIS traduzida e restrita ao recorte de tecnologia"],
  ["gold-analise-mercado-ti", "Gold", "Agregados e resultados dos modelos que este site consome"],
];

export default function Metodo() {
  const [arquivos, setArquivos] = useState<{ nome: string; kb: number }[]>([]);
  const [gerado, setGerado] = useState("");

  useEffect(() => {
    obterManifesto().then((m) => {
      setGerado(new Date(m.gerado_em).toLocaleString("pt-BR"));
      setArquivos(Object.entries(m.tabelas).map(([nome, t]) => ({ nome, kb: t.bytes / 1024 })).sort((a, b) => b.kb - a.kb));
    });
  }, []);

  const totalMb = arquivos.reduce((s, a) => s + a.kb, 0) / 1024;

  return (
    <>
      <header className="mb-8">
        <p className="sobrelinha">
          <span className="mr-2 inline-block h-2 w-2 rounded-[2px] bg-acento align-middle" />
          Método e dados
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-tinta sm:text-3xl">Como estes números foram construídos</h1>
      </header>

      <Grade>
        <Texto>
          <p>
            <strong>Fontes.</strong> Microdados da RAIS (2007–2025) e do CAGED (2007 até o último mês publicado), obtidos do servidor público do
            PDET/MTE. A RAIS fotografa os vínculos ativos em 31 de dezembro; o CAGED registra cada admissão e desligamento.
          </p>
          <p>
            <strong>Tradução.</strong> Os microdados são quase todos códigos. Cada coluna codificada foi traduzida pelos dicionários oficiais do
            próprio MTE, extraídos das planilhas de layout e mantidos com a procedência de cada linha. O código original fica ao lado da descrição.
          </p>
          <p>
            <strong>Recorte de tecnologia.</strong> União de duas lentes, preservadas como rótulos em cada registro: <em>setor de TI</em> (CNAE de
            serviços de tecnologia, divisões 62 e 63) e <em>ocupação de TI</em> (famílias CBO de tecnologia, em qualquer setor). O recorte é por família
            de código, nunca por palavra-chave: buscar “sistemas” traria “Operação de Sistemas de Irrigação por Aspersão”.
          </p>
          <p>
            <strong>Duas gerações do CAGED.</strong> O CAGED mudou de layout em 2020. As duas gerações foram harmonizadas num esquema único; o setor do
            CAGED antigo é derivado do CNAE 2.0 e foi validado contra a seção oficial do Novo CAGED.
          </p>
        </Texto>
        <Texto>
          <p>
            <strong>Arquitetura.</strong> Bronze → Silver de TI → Gold, executada em nuvem: o <em>data lake</em> são repositórios públicos do Hugging
            Face Hub, e o processamento roda em <em>workflows</em> do GitHub Actions encadeados por dependência, que verificam o servidor do MTE toda
            semana e reprocessam só os anos com dado novo.
          </p>
          <p>
            <strong>Este site.</strong> Estático, publicado no Cloudflare Pages. Os arquivos Parquet da Gold — e dois cubos do CAGED, agregados no
            grão dos filtros — vão junto do site, e o DuckDB-WASM os consulta no seu navegador. Nenhum servidor recebe as suas consultas.
          </p>
          <p>
            <strong>Limitações.</strong> Só o mercado formal (sem PJ, autônomos e informais). A localização é a do estabelecimento, não a do trabalho.
            Salários do CAGED são nominais. Diferenças salariais brutas não controlam ocupação nem experiência, e a parte não explicada do hiato não é
            medida de discriminação.
          </p>
        </Texto>
      </Grade>

      <Bloco titulo="Dados abertos" descricao="Todas as camadas são públicas e podem ser consultadas direto, por exemplo com DuckDB: SELECT * FROM 'hf://datasets/Gianpedro/gold-analise-mercado-ti/mapa_uf.parquet'.">
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {REPOS.map(([repo, camada, descricao]) => (
            <li key={repo}>
              <a
                href={`https://huggingface.co/datasets/Gianpedro/${repo}`}
                target="_blank"
                rel="noreferrer"
                className="block h-full rounded-xl border border-borda bg-superficie p-4 hover:border-acento"
              >
                <span className="sobrelinha">{camada}</span>
                <span className="mt-1 block font-mono text-[14px] text-tinta">{repo}</span>
                <span className="mt-1 block text-[13px] text-tinta-3">{descricao}</span>
              </a>
            </li>
          ))}
        </ul>
      </Bloco>

      <Bloco titulo="O que este site carregou" descricao={gerado ? `Arquivos gerados em ${gerado} · ${fmtDec(totalMb, 1)} MB no total` : undefined}>
        <CartaoTabela
          titulo="Tabelas consultadas no navegador"
          tabela={{
            colunas: [
              { chave: "nome", rotulo: "Tabela", formato: (v) => String(v) },
              { chave: "kb", rotulo: "Tamanho", formato: (v) => (Number(v) >= 1024 ? `${fmtDec(Number(v) / 1024, 1)} MB` : `${fmtDec(v, 0)} kB`), numero: true },
            ],
            linhas: arquivos,
          }}
        />
      </Bloco>
    </>
  );
}
