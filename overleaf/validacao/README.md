# Validação contra o painel do MTE

Os números do recorte de ocupação conferidos com um painel público do
Ministério do Trabalho e Emprego, publicado em Power BI. Gerado por
[`tasks-python/_utils/validar_painel_mte.py`](../../tasks-python/_utils/validar_painel_mte.py),
que consulta o painel filtrando exatamente os códigos CBO do recorte e compara
com a camada Gold e a Silver:

```bash
cd tasks-python
python _utils/validar_painel_mte.py
```

| Arquivo | Conteúdo |
|---|---|
| `painel_mte_rais.csv` | vínculos ativos em 31/12, por ano (2023–2025) e UF: painel × trabalho |
| `painel_mte_caged.csv` | admissões e desligamentos do Novo CAGED, por ano: painel × trabalho |

O script também grava `tab-validacao-rais.tex` e `tab-validacao-caged.tex` em
`TCC2_Gian_Pedro_Rodrigues/estrutura/tabelas-geradas/` (seção 4.3 do TCC).

**Resultado:** o trabalho conta cerca de 1% a mais que o painel, com o mesmo
sinal em todos os anos, estados e ocupações — diferença de critério de
contagem, não de processamento. O painel não traz CNAE, então a lente de setor
não tem confronto externo.
