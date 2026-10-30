---
license: odc-by
language:
  - pt
tags:
  - brazil
  - labor-market
  - employment
  - rais
  - microdata
pretty_name: RAIS — Microdados Traduzidos (Brasil, 1985–2025)
size_categories:
  - 1B<n<10B
configs:
  - config_name: rais_vinc
    data_files: "rais_vinc/**/*.parquet"
  - config_name: rais_estab
    data_files: "rais_estab/**/*.parquet"
---

# RAIS — Microdados Traduzidos (Brasil)

Todos os microdados públicos da **RAIS** (Relação Anual de Informações
Sociais, Ministério do Trabalho e Emprego), de **1985 a 2025**, com os
códigos traduzidos pelos dicionários oficiais do próprio MTE. Todas as
ocupações e todos os setores, sem recorte.

## Origem

`ftp.mtps.gov.br/pdet/microdados`: dados públicos do PDET/MTE, sem
identificação de pessoas nem de empresas.

## Tratamento aplicado

1. Códigos traduzidos pelos **dicionários oficiais** do MTE: cada coluna
   codificada ganhou uma `<coluna>_descricao` legível, e o código original
   continua ao lado.
2. Nomes de colunas harmonizados entre layouts: em 2023 a fonte acrescentou
   `_codigo` a vários campos e renomeou a remuneração; a silver mantém um
   nome só para a série inteira.
3. Campos numéricos tipados (a fonte usa vírgula decimal).
4. Cada arquivo do FTP foi conferido na extração: o tamanho descompactado
   precisa bater com o declarado no próprio pacote, e as linhas gravadas com
   as do texto.

## Tabelas

| Tabela | Conteúdo | Período |
|---|---|---|
| `rais_vinc` | Vínculos: um por linha, ativos em 31/12 ou desligados no ano | 1985–2025 (anos publicados pelo MTE) |
| `rais_estab` | Estabelecimentos | 1985–2025 |

Pastas no padrão Hive, `<tabela>/ano_particao=<ano>/`. No `rais_vinc`, cada
ano tem vários arquivos, um por pedaço do arquivo de origem do MTE (que vem
dividido por UF ou região); leia a pasta do ano inteira.

Os anos anteriores a 2007 usam layouts e classificações antigas (CBO 94,
CNAE 95), e nem todas as colunas desses anos têm dicionário: nelas, a
`_descricao` fica vazia e o código original continua disponível.

## Cuidados ao usar

- **Estoque em 31/12:** filtre `vinculo_ativo_3112 = '1'`. Contar todas as
  linhas soma os vínculos encerrados no ano.
- **Codificação dos meses mudou entre layouts.** Em `mes_admissao` e
  `mes_desligamento`, "não houve" aparece como `00` até 2018, como `{ñ` de
  2019 a 2022 e como `0` de 2023 em diante. Converta para número
  (`try_cast(... AS INT) BETWEEN 1 AND 12`) em vez de comparar texto.
- **Artefato de Rondônia:** em oito anos, o funcionalismo estadual de RO foi
  declarado com o CBO 317110 (programador de sistemas de informação), o que
  infla as ocupações de tecnologia do estado. Os dados estão como a fonte os
  publicou.
- **Tipo de vínculo:** a RAIS inclui estatutários, temporários e outros
  vínculos além da CLT (`tipo_vinculo`). Para comparar com o CAGED, que só
  cobre a CLT, filtre os vínculos celetistas.

## Como consultar

```python
import duckdb

duckdb.sql("""
    SELECT cbo_ocupacao_2002_descricao AS ocupacao, count(*) AS vinculos
    FROM 'hf://datasets/Gianpedro/silver-rais/rais_vinc/ano_particao=2024/*.parquet'
    WHERE vinculo_ativo_3112 = '1'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10
""").show()
```

O DuckDB lê só as colunas e o ano pedidos, sem baixar o conjunto inteiro.

## Recorte de tecnologia

Um recorte do mercado de trabalho em tecnologia, feito com o mesmo código, está em
[Gianpedro/silver-rais-ti](https://huggingface.co/datasets/Gianpedro/silver-rais-ti).

## Citação

Rodrigues, G. P. *Análise, Visualização e Previsão do Mercado de Tecnologia no
Brasil Utilizando Dados Históricos da RAIS e CAGED*. Trabalho de Conclusão de
Curso (Engenharia de Computação), UTFPR, 2026. Código:
[github.com/GianSE/mercadotech](https://github.com/GianSE/mercadotech).
