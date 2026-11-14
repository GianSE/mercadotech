# dashboards — Mercado de TI no Brasil

Site estático (React + Vite + Tailwind) que lê a camada Gold do TCC direto do
Hugging Face e a consulta no navegador. Publicado no Cloudflare Pages
(`mercadotech.pages.dev`). O código veio do site do
[mercadobrasil](https://github.com/GianSE/mercadobrasil), que serve várias áreas
com as mesmas páginas; aqui ele fica preso a uma só, TI (`src/lib/areas.ts`).

## Como os dados chegam ao site

Nada de dado no build. O site lista as tabelas do dataset
[`Gianpedro/gold-analise-mercado-ti`](https://huggingface.co/datasets/Gianpedro/gold-analise-mercado-ti)
pela API do Hub (`tree/main?expand=true`, que traz o último commit de cada
arquivo) e baixa só as que a aba aberta pede, cada uma pelo endereço do seu
commit (`resolve/<commit>/<tabela>.parquet`). Consequências:

- **Dado novo aparece sem rebuild.** O pipeline publica a Gold e pronto: o
  orquestrador não tem mais etapa de site.
- **O cache não envelhece errado.** O endereço de uma tabela só muda quando a
  tabela muda, então o service worker guarda o Parquet sem prazo (`CacheFirst`);
  só a listagem vai sempre à rede (`NetworkFirst`), e cai no cache se estiver
  sem internet.
- **Tabela ausente não quebra a página.** Cada gráfico mostra "ainda não foram
  publicados na Gold" até a etapa correspondente rodar.

Leituras simples usam `hyparquet` (+ `fzstd`, a Gold sai em ZSTD); as que
precisam de SQL usam DuckDB-Wasm, com o mesmo SQL do pipeline sobre uma view de
cada tabela (`src/lib/db.ts`). O motor do DuckDB vem do jsDelivr: o `.wasm`
passa do limite de 25 MiB por arquivo do Cloudflare.

Toda requisição ao Hub sai **sem Referer** (`referrerPolicy: "no-referrer"`):
o Hub responde 404 a Referer de `*.workers.dev`.

**Nomes de coluna.** A Gold do TCC usa `setor_ti`, `ocupacao_ti` e `area_ti`;
as páginas do mercadobrasil, `setor_da_area`, `ocupacao_da_area` e `subarea`.
Os valores são iguais, só o nome muda: `RENOMEAR` em `src/lib/dados.ts` traduz
na leitura (no hyparquet e na view do DuckDB), e a Gold publicada, que o texto
do TCC cita, fica como está.

## Organização

Uma aba por pergunta do TCC, com o filtro de território (estados, regiões,
"Brasil sem SP") valendo para todas:

| Aba | Pergunta |
|---|---|
| Visão geral | os quatro números e as cinco respostas, cada uma com link para a sua aba |
| 1 · Crescimento | quanto o mercado cresceu, e como isso aparece nas contratações |
| 2 · Onde | mapa (OpenStreetMap) por estado e município; em que empresas está o trabalho |
| 3 · Qualidade | salário em salários mínimos, por escolaridade; giro e permanência |
| 4 · Equidade | hiato salarial (Oaxaca-Blinder) por raça/cor e sexo; participação feminina |
| 5 · Futuro | previsão do saldo, nowcast do estoque e a validação de cada modelo |
| Método | o recorte em anéis (CNAE e CBO), de onde vêm os dados, ressalvas, dados abertos |

Gráfico calculado só para o país (decomposição, sobrevivência, previsão) ganha
o selo "Brasil inteiro" quando o filtro está ligado. Todo gráfico tem o botão
**Tabela** (os números exatos, e o que o leitor de tela lê) e **CSV**.

Links antigos (`#/estoque`, `#/salario`…) são redirecionados para a aba nova em
`src/App.tsx`.

## Comandos

```bash
npm install
npm run dev       # desenvolvimento em http://localhost:5173 (lê o Hub de verdade)
npm run build     # checa tipos e gera dist/
npm run preview   # serve o dist/ como em produção, com o service worker
npm run deploy    # build + publica direto pelo wrangler
```

`VITE_DADOS_BASE` troca o endereço do Hub (um espelho em bucket, por exemplo)
sem mexer nas páginas.

## Publicação

O projeto no Cloudflare Pages é ligado ao repositório e faz o build a cada push
que mexe no site:

| Configuração | Valor |
|---|---|
| Pasta raiz | `dashboards` |
| Comando de build | `npm run build` |
| Saída | `dist` |
| Variáveis | `NODE_VERSION=22` |

`npm run dados` ficou como um comando vazio só para o comando de build antigo
(`… && npm run dados && npm run build`) não quebrar até ser trocado no painel.

## Design system

Herdado do mercadobrasil, sem mudança de paleta:

- **Tokens** em `src/index.css` (`:root` e `.dark`), no formato do shadcn/ui
  (`--background`, `--card`, `--primary`…), expostos ao Tailwind 4. Claro em
  off-white quente, escuro em marinho; o tema segue o sistema ou o botão do
  cabeçalho.
- **Séries** `--chart-1` a `--chart-7`, na mesma ordem e nos mesmos matizes nos
  dois temas, validadas para daltonismo contra a cor do cartão (o validador da
  skill de dataviz). Verde (`--sobe`) e vermelho (`--desce`) são só polaridade:
  admissão e saldo positivo, desligamento e saldo negativo.
- **Componentes** em `src/components/ui/` (botão, cartão, controle segmentado,
  esqueleto) e, acima deles, `Painel` (cartão de gráfico com carregando, ausente,
  erro, tabela e CSV), `Titulo` (a pergunta e a resposta em uma frase, calculada
  dos dados) e `Indicador`.
- **Gráficos** (ECharts) montados em `src/lib/graficos.ts`: linhas, fluxo
  (admissões, desligamentos e saldo), barras horizontais, previsão com
  intervalo e os anéis da hierarquia. Os construtores leem a tinta do tema, e o
  gráfico se redesenha quando o tema troca.
- **Mapa** em `src/components/MapaOSM.tsx`: Leaflet sobre os tiles do
  OpenStreetMap, com os estados (`public/geo/br_uf.json`) e os municípios
  pintados numa rampa de uma cor.
