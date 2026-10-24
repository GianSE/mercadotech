# dashboards — Mercado de TI no Brasil

Site estático (React + Vite + Tailwind) que consulta a camada Gold do projeto
direto no navegador, com DuckDB-WASM. Publicado no Cloudflare Pages.

A Gold no Hugging Face é a fonte oficial dos dados. O site guarda uma **cópia**
dela no build (`public/dados/`), junto com a extensão de Parquet do DuckDB
(`public/duckdb-ext/`): ele abre mesmo com o Hugging Face fora do ar. Só o motor
do DuckDB-WASM vem do jsDelivr em produção — o `.wasm` passa do limite de 25 MiB
por arquivo do Cloudflare. Em `npm run dev` ele sai do `node_modules`, e o site
roda sem internet nenhuma.

## Comandos

```bash
npm install
npm run dados     # baixa a Gold (com os cubos do CAGED) e a extensão parquet para public/
npm run dev       # desenvolvimento em http://localhost:5173
npm run build     # checa tipos e gera dist/
npm run deploy    # build + publica direto pelo wrangler (só para projeto sem Git)
```

## Publicação

O projeto no Cloudflare Pages é ligado ao repositório e faz o build sozinho:

| Configuração | Valor |
|---|---|
| Pasta raiz | `dashboards` |
| Comando de build | `pip install duckdb==1.5.6 && npm run dados && npm run build` |
| Saída | `dist` |
| Variáveis | `NODE_VERSION=22`, `PYTHON_VERSION=3.12` (opcional: `HF_TOKEN`) |

Um push que mexe no site dispara o build. Dado novo não gera commit, então o
pipeline chama o **Deploy Hook** do projeto no fim (job `site` do
`pipeline.yml`, segredo `CLOUDFLARE_DEPLOY_HOOK`). Se o Hugging Face estiver
fora do ar na hora, o build falha e a versão anterior continua no ar.

`npm run dados` precisa de Python com `duckdb`. Se a Gold publicada ainda não tiver
os cubos, ele os monta a partir da Silver com `tasks-python/3-gold/gold_caged/cubos.py`
— a mesma função do pipeline, com o mesmo recorte de TI.

## Como os dados chegam ao site

| Arquivo | Origem | Para quê |
|---|---|---|
| 25 tabelas da Gold | `Gianpedro/gold-analise-mercado-ti` | RAIS, mapa, modelos, série mensal do CAGED |
| `caged_cubo.parquet` | Gold (etapa Gold CAGED consolidado): CAGED agregado por ano, UF, setor, lente, área, sexo, raça, escolaridade e faixa etária | filtros livres (aba Explorar) e recortes do CAGED |
| `caged_ocupacao.parquet` | Gold: CAGED agregado por ano, ocupação e lente | recortes por ocupação |

Os cubos guardam **soma e contagem** do salário, nunca a média: o site divide no fim,
para que qualquer combinação de filtros dê a média ponderada correta.

## Design system

**Ideia:** preto e amarelo da UTFPR na interface; azul de tecnologia nos dados.
O amarelo é cor de ação e destaque (aba ativa, marcador de seção, foco, botão
primário) e aparece sempre como fundo com texto preto, ou sobre preto — amarelo
como texto sobre fundo claro não passa contraste.

Tokens em `src/index.css` (`:root` / `[data-tema="escuro"]`), expostos ao Tailwind
como classes: `bg-fundo`, `bg-superficie`, `bg-superficie-2`, `border-borda`,
`text-tinta`, `text-tinta-2`, `text-tinta-3`, `bg-acento`, `text-sobre-acento`,
`bg-marca`. O escuro é o tema padrão; o claro segue a preferência do sistema ou o
botão do cabeçalho.

| Papel | Claro | Escuro |
|---|---|---|
| Fundo da página | `#f4f4f1` | `#0b0c0f` |
| Superfície (cartões, gráficos) | `#fcfcfb` | `#16181d` |
| Texto principal / secundário / apagado | `#0b0b0b` / `#52514e` / `#6b6a65` | `#f0efec` / `#c3c2b7` / `#9a988f` |
| Acento (UTFPR) | `#ffc20e` com texto `#0b0b0b` | idem |

Todo texto passa 4,5:1 de contraste (WCAG AA) nos dois temas.

**Séries de dados** — só azuis, em ordem fixa, validados com o validador da skill
de dataviz (faixa de luminosidade, croma, separação entre vizinhas para daltonismo
e para visão normal). Claro: pior ΔE daltônico 15,0, normal 18,8; escuro: 14,0 e 17,9.

| Slot | Claro | Escuro |
|---|---|---|
| 1 royal | `#1d5bd0` | `#3b82f6` |
| 2 céu / petróleo | `#3fb8f0` | `#03a9a9` |
| 3 ciano-petróleo / aço | `#0b7f9f` | `#1a68a3` |
| 4 pervinca | `#8c96f5` | `#8c87df` |
| 5 índigo | `#3442a8` | `#494bf2` |
| 6 centáurea / ciano | `#6aa8f2` | `#2089ae` |

Regras: cor segue a entidade, nunca a posição; mais de 6 séries viram “Outros”.
**Verde e vermelho são só polaridade** (saldo, variação): verde cresce, vermelho
encolhe, nunca como “série 7”. Mapas de magnitude usam uma rampa de azul. Alguns
azuis claros ficam abaixo de 3:1 sobre a superfície — por isso todo gráfico tem
rótulo direto ou o botão **Tabela**.

**Gráficos (ECharts)** — construtores em `src/lib/graficos.ts`, e a forma segue o
dado:

| Dado | Forma |
|---|---|
| Parte de um todo, 2 a 6 fatias | rosca (`opcaoRosca`), total no centro |
| Quem tem mais, 8 a 20 itens positivos | mosaico/treemap (`opcaoMosaico`) |
| Ranking longo ou com sinal | pirulito (`opcaoBarras`, `forma: "pirulito"`) |
| Dois grupos por categoria | halteres (`opcaoHalteres`): a haste é a diferença |
| Série no tempo | linha suave; série única em degradê de dois azuis, área que se dissolve |
| Ano a ano com sinal | colunas com degradê verde/vermelho |

Barras com degradê da base translúcida para a ponta, ponta arredondada (base reta),
um eixo Y só, legenda a partir de duas séries, tooltip preso dentro do gráfico.

**Celular** (`compacto`, até 639 px — `src/lib/tema.tsx`): os construtores mudam de
forma, não só de tamanho. Barra horizontal ganha uma linha por categoria, com o
rótulo em cima e o valor na ponta, e a altura cresce com o número de categorias
(`alturaSugerida`). A legenda rola de lado; o mapa não arrasta (o dedo rola a
página); a rosca põe a legenda embaixo. Os filtros viram uma barra presa sob o
cabeçalho, com o resumo do recorte, e abrem num toque; os controles têm 44 px e
fonte de 16 px (o iOS não dá zoom). As tabelas prendem a primeira coluna.

**Forma** — tudo arredondado em três degraus: cartão (`.cartao`, 20 px), controle
(12 px) e chip (pílula). Os cartões têm um brilho azul fraco no canto; o cabeçalho
preto, um brilho azul sob a grade.

**Tipografia** — fonte do sistema; rótulos de seção em monoespaçada, caixa alta.
