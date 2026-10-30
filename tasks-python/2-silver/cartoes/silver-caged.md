---
license: odc-by
language:
  - pt
tags:
  - brazil
  - labor-market
  - employment
  - caged
  - microdata
pretty_name: CAGED — Microdados Traduzidos (Brasil, 2002–2026)
size_categories:
  - 1B<n<10B
configs:
  - config_name: caged_mov
    data_files: "caged_mov/**/*.parquet"
  - config_name: caged_for
    data_files: "caged_for/**/*.parquet"
  - config_name: caged_exc
    data_files: "caged_exc/**/*.parquet"
  - config_name: caged_old
    data_files: "caged_old/**/*.parquet"
  - config_name: caged_ajustes
    data_files: "caged_ajustes/**/*.parquet"
---

# CAGED — Microdados Traduzidos (Brasil)

Todos os microdados do **CAGED** (Cadastro Geral de Empregados e
Desempregados, Ministério do Trabalho e Emprego), de **2002 a 2026**, com os
códigos traduzidos pelos dicionários oficiais do próprio MTE. Todas as
ocupações e todos os setores, sem recorte: cada linha é uma admissão ou um
desligamento de emprego formal (CLT).

## Origem

`ftp.mtps.gov.br/pdet/microdados`: dados públicos do PDET/MTE, sem
identificação de pessoas nem de empresas.

## Tratamento aplicado

1. Códigos traduzidos pelos **dicionários oficiais** do MTE: cada coluna
   codificada ganhou uma `<coluna>_descricao` legível, e o código original
   continua ao lado.
2. Encoding detectado por arquivo: o acervo mistura UTF-8 (Novo CAGED,
   2020+) e Latin-1 (CAGED antigo), e assumir um só gera mojibake silencioso.
3. Campos numéricos tipados (a fonte usa vírgula decimal) e competência
   `AAAAMM` convertida para data (`<coluna>_data`).
4. Cada arquivo do FTP foi conferido na extração: o tamanho descompactado
   precisa bater com o declarado no próprio pacote, e as linhas gravadas com
   as do texto. Um arquivo que não passa não é publicado.

## Tabelas

| Tabela | Conteúdo | Período |
|---|---|---|
| `caged_mov` | Movimentações do Novo CAGED | 2020–2026 |
| `caged_for` | Movimentações declaradas fora do prazo (Novo CAGED) | 2020–2026 |
| `caged_exc` | Exclusões de movimentações (Novo CAGED) | 2020–2026 |
| `caged_old` | CAGED antigo (CAGEDEST) | 2007–2019 |
| `caged_ajustes` | Ajustes e declarações fora do prazo do CAGED antigo | 2002–2019 |

Pastas no padrão Hive, `<tabela>/ano_particao=<ano>/mes_particao=<mês>/`,
com um arquivo por mês. As duas gerações do CAGED têm esquemas diferentes:
o Novo CAGED (eSocial) não é continuação direta do antigo, e séries que
atravessam 2019–2020 precisam harmonizar as colunas.

## Lacunas da fonte

Dois arquivos do FTP do MTE estão **corrompidos na origem** (o mesmo arquivo
baixado várias vezes falha no teste de integridade, com o mesmo hash):

| Arquivo | O que se lê | O que falta |
|---|---|---|
| `caged_old` 03/2011 | ~55% do texto; o arquivo é ordenado por UF | PR, SC, RS, MS, MT, GO e DF por inteiro; SP incompleto |
| `caged_ajustes` 10/2010 | 1.942 de ~190 mil linhas | quase todo o mês |

Os dois meses estão publicados com a parte legível. Contagens nacionais ou
regionais que incluam esses meses ficam subestimadas.

## Métrica principal

`saldomovimentacao` (Novo CAGED) e `saldo_mov` (CAGED antigo) valem **+1 na
admissão** e **−1 no desligamento**; a soma é a geração líquida de emprego
formal, a métrica-título do CAGED.

## Como consultar

```python
import duckdb

duckdb.sql("""
    SELECT uf_descricao,
           count(*) FILTER (WHERE saldomovimentacao = 1) AS admissoes,
           sum(saldomovimentacao) AS saldo
    FROM 'hf://datasets/Gianpedro/silver-caged/caged_mov/ano_particao=2025/**/*.parquet'
    GROUP BY 1 ORDER BY saldo DESC
""").show()
```

O DuckDB lê só as colunas e os meses pedidos, sem baixar o conjunto inteiro.

## Recorte de tecnologia

Um recorte do mercado de trabalho em tecnologia, feito com o mesmo código, está em
[Gianpedro/silver-caged-ti](https://huggingface.co/datasets/Gianpedro/silver-caged-ti).

## Citação

Rodrigues, G. P. *Análise, Visualização e Previsão do Mercado de Tecnologia no
Brasil Utilizando Dados Históricos da RAIS e CAGED*. Trabalho de Conclusão de
Curso (Engenharia de Computação), UTFPR, 2026. Código:
[github.com/GianSE/mercadotech](https://github.com/GianSE/mercadotech).
