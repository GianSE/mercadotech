import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { AneisRecorte } from "../../components/Recorte";
import { Titulo } from "../../components/Titulo";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import type { Area } from "../../lib/areas";

/*
 * Método: o que conta como TI (o recorte em anéis, CBO ou CNAE), de onde vêm
 * os dados e o que se sabe sobre eles. O detalhe está no capítulo de
 * materiais e métodos do TCC; aqui fica o que o leitor do site precisa para
 * ler os gráficos sem tropeçar.
 */

const HF = "https://huggingface.co/datasets/Gianpedro/";
const CONJUNTOS = [
  { nome: "bronze-rais", papel: "RAIS como publicada pelo MTE, em Parquet" },
  { nome: "bronze-caged", papel: "CAGED antigo e Novo CAGED, em Parquet" },
  { nome: "mte-dicionarios", papel: "os códigos do MTE e de onde cada um saiu" },
  { nome: "silver-rais-ti", papel: "o recorte de TI da RAIS, traduzido" },
  { nome: "silver-caged-ti", papel: "o recorte de TI do CAGED, traduzido" },
  { nome: "gold-analise-mercado-ti", papel: "os agregados e modelos que este site lê" },
] as const;

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle>{titulo}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

export function Metodo({ area }: { area: Area }) {
  return (
    <div className="flex flex-col gap-8">
      <AneisRecorte area={area} />

      <section className="flex flex-col gap-4">
        <Titulo
          pergunta="De onde vêm os números?"
          resposta="Dos microdados da RAIS (2007–2025) e do CAGED (2007 a setembro de 2026), tratados por um pipeline em três camadas que roda no GitHub Actions e publica cada camada como dado aberto no Hugging Face."
        />
        <div className="grid gap-4 lg:grid-cols-3">
          <Bloco titulo="Duas lentes">
            <p>
              Um vínculo entra no recorte se a empresa é de TI (pela atividade, CNAE) <span className="text-foreground">ou</span> se a pessoa exerce ocupação de TI (pela
              CBO). As duas lentes ficam separadas nos dados: é o que permite ver os profissionais de TI que trabalham fora das empresas de TI.
            </p>
          </Bloco>
          <Bloco titulo="Validação">
            <p>
              A recontagem do recorte a partir do dado bruto deu diferença zero em 36,5 milhões de registros, e os totais ficam a cerca de 1% dos de um painel público do
              Ministério do Trabalho.
            </p>
          </Bloco>
          <Bloco titulo="Ressalvas">
            <p>
              O funcionalismo estadual de Rondônia, declarado como programador em oito anos da RAIS, sai do recorte. O CAGED de março de 2011 está corrompido no servidor do
              MTE. Em 2007, o CAGED quase não traz a atividade da empresa.
            </p>
          </Bloco>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          O site lê a camada Gold direto do Hugging Face e a consulta no navegador, com DuckDB-Wasm: não há servidor de aplicação. Salários estão em salários mínimos do ano,
          para comparar anos entre si. Cada gráfico mostra a tabela com os valores exatos e baixa os dados em CSV.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold tracking-tight">Dados abertos</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {CONJUNTOS.map((c) => (
            <li key={c.nome}>
              <a
                href={`${HF}${c.nome}`}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex h-full flex-col gap-0.5 rounded-xl border bg-card p-3 text-sm transition-colors outline-none hover:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <span className="inline-flex items-center gap-1.5 font-mono text-[13px] font-medium">
                  {c.nome} <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden />
                </span>
                <span className="text-muted-foreground">{c.papel}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
