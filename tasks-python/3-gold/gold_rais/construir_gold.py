"""
Constrói a camada gold da RAIS: agregados de estoque prontos para o dashboard.

POR QUE A RAIS AO LADO DO CAGED
-------------------------------
As duas bases respondem perguntas diferentes, e é a diferença que interessa:

    CAGED  -> FLUXO. Quantos empregos foram criados neste mês.
    RAIS   -> ESTOQUE. Quantos empregos existem em 31 de dezembro.

Um saldo positivo no CAGED não diz se o mercado é grande, e um estoque grande
na RAIS não diz se está crescendo. Juntas: "o setor tem 1,27 milhão de
vínculos de TI e gerou X mil no ano" — que é a leitura que um trabalho sobre
mercado de trabalho precisa fazer.

A RAIS ainda permite três coisas que o CAGED não tem:

  1. REMUNERAÇÃO EM SALÁRIOS MÍNIMOS (`vl_remun_media_sm`). O salário nominal
     do CAGED não é comparável entre 2007 e 2025 sem deflacionar — e escolher
     deflator é decisão metodológica discutível. O múltiplo do mínimo já vem
     pronto na fonte e atravessa a série inteira.
  2. TEMPO DE EMPREGO. Permanência média no vínculo, que é a leitura de
     rotatividade. O CAGED registra a movimentação, não a duração.
  3. ESTABELECIMENTOS. Quantas empresas de TI existem e de que porte — o
     CAGED não tem cadastro de empresa.

O QUE É O ESTOQUE
-----------------
`vinculo_ativo_3112 = '1'` marca o vínculo ativo em 31/12. A RAIS traz também
os vínculos que existiram e terminaram durante o ano, e somar os dois inflaria
o estoque. Por isso as médias (remuneração, tempo, idade) são calculadas SÓ
sobre os ativos: incluir quem saiu misturaria o mercado do fim do ano com o de
qualquer mês anterior.

A contagem dos que NÃO estão ativos vira métrica própria (`desligados_no_ano`)
em vez de ser descartada — é o que permite ler rotatividade contra o estoque.

SOBRE A UF
----------
A RAIS não tem coluna de UF. O código do município é IBGE de 6 dígitos e a
descrição já vem prefixada com a sigla ('Df-Brasilia', 'Mt-Sinop'), então a UF
sai do prefixo. É mais direto que carregar uma tabela de-para de município só
para recuperar informação que já está no texto.

Uso:
    python -m gold_rais.construir_gold
    python -m gold_rais.construir_gold --tabela rais_estoque_anual
"""
import argparse
import sys
import time

from _utils import nuvem
from _utils import escopo_tecnologia as esc
from gold_unificado.dicionario_canonico import sql_canonico

FONTE_VINC = nuvem.fonte_silver_ti("rais_vinc")
FONTE_ESTAB = nuvem.fonte_silver_ti("rais_estab")

COL_CNAE = "cnae_20_subclasse"
COL_CBO = "cbo_ocupacao_2002"

# Rotula cada vínculo nas duas lentes (setor por CNAE, ocupação por CBO). Igual
# ao CAGED: rotular em vez de filtrar mantém o mercado geral como linha de base
# na mesma tabela — sem baseline, "TI paga 2,3x mais" não diz nada.
#
# O funcionalismo do governo de Rondônia, declarado como programador em oito
# anos da série, sai aqui (ver escopo_tecnologia.ARTEFATO_RO). A silver fica
# como está: ela reproduz a fonte, e a recontagem contra o bronze depende disso.
#
# O dicionário da RAIS parou no tempo para alguns códigos criados depois
# dele: as subclasses CNAE 6201-5/01 (desenvolvimento de programas sob
# encomenda, a maior atividade do recorte desde 2018) e 6201-5/02 (web
# design), e os CBO 2124-25 (arquiteto de soluções) e 2124-30 (analista de
# testes). O dicionário do CAGED, do mesmo Ministério, tem os nomes: entra
# como reserva, só onde a RAIS não traduziu. O 2115-20 continua sem nome em
# nenhum dos dois, e é assim que deve aparecer.
DIC_CAGED = nuvem.fonte_leitura(nuvem.REPO_BRONZE_CAGED, "dicionarios.parquet")


# O dicionário do CAGED escreve Cada Palavra Com Maiúscula ("Analista De
# Testes De Tecnologia Da Informação"); a RAIS, não. Na reserva, as palavras
# de ligação voltam a minúsculas e a sigla volta a maiúsculas, para os nomes
# emprestados não destoarem dos outros na mesma lista.
LIGACOES = ("De", "Da", "Do", "Das", "Dos", "E", "Em", "Para", "Com", "Ou", "No", "Na", "Nos", "Nas", "Sob")


def _como_rais(expr: str) -> str:
    for palavra in LIGACOES:
        expr = f"replace({expr}, ' {palavra} ', ' {palavra.lower()} ')"
    return f"replace({expr}, '(Dpo)', '(DPO)')"


def _reserva(coluna: str) -> str:
    return (f"(SELECT codigo, {_como_rais('any_value(descricao)')} AS descricao FROM read_parquet('{DIC_CAGED}') "
            f"WHERE tabela = 'caged_mov' AND coluna = '{coluna}' GROUP BY 1)")


BASE_VINC = f"""
    SELECT v.* REPLACE (
               coalesce(v.cbo_ocupacao_2002_descricao, dic_cbo.descricao) AS cbo_ocupacao_2002_descricao,
               coalesce(v.cnae_20_subclasse_descricao, dic_cnae.descricao) AS cnae_20_subclasse_descricao),
           {esc.sql_classificacao(COL_CNAE, COL_CBO)}
    FROM read_parquet({FONTE_VINC}, hive_partitioning=true) v
    LEFT JOIN {_reserva('cbo2002ocupacao')} dic_cbo ON dic_cbo.codigo = {esc.sql_codigo_cbo('v.' + COL_CBO)}
    LEFT JOIN {_reserva('subclasse')} dic_cnae ON dic_cnae.codigo = v.{COL_CNAE}
    WHERE {esc.sql_sem_artefato_rais(FONTE_VINC, COL_CBO)}
"""

# O estabelecimento não tem ocupação — uma empresa não exerce CBO —, então só
# a lente de setor se aplica.
BASE_ESTAB = f"""
    SELECT *, {esc.sql_classificacao(COL_CNAE, None)}
    FROM read_parquet({FONTE_ESTAB}, hive_partitioning=true)
"""

ATIVO = "vinculo_ativo_3112 = '1'"
UF = "upper(split_part(municipio_descricao, '-', 1))"

# Teto de plausibilidade da remuneração, em salários mínimos.
#
# POR QUE ISTO PRECISA EXISTIR
# ----------------------------
# A partir de 2023 a fonte traz registros com a conversão para salário mínimo
# INVERTIDA — multiplicou em vez de dividir. Um exemplo real de 2023:
#
#     vl_remun_media_sm = 147.817,11   vl_remun_media_nom = R$ 112,43
#
# A razão entre os dois é 1.315, que é o salário mínimo daquele ano. São 222
# registros em 2023, 205 em 2024 e 94 em 2025 — 0,018% dos vínculos. E eles
# sozinhos respondem por 35% de toda a massa salarial do ano.
#
# O efeito na média é devastador e silencioso: a remuneração média salta de
# 6,17 para 8,84 SM entre 2022 e 2023, o que se leria como uma valorização de
# 43% do trabalho em TI. Não houve valorização nenhuma — a MEDIANA fica em
# 3,60, praticamente igual à de 2022 (3,63).
#
# O teto é generoso de propósito: em 2022, com o layout antigo e sem o defeito,
# o maior valor da série inteira é 149,90 SM. Cortar em 500 preserva qualquer
# salário legítimo com folga de mais de 3x e remove só o que é aritmeticamente
# impossível.
#
# A conferência que expõe isso é dividir o nominal pelo SM: o "mínimo
# implícito" bate com o salário mínimo real até 2022 (R$ 1.000 em 2019, R$
# 1.102 em 2021) e desaba para R$ 843 em 2023.
LIMITE_REMUN_SM = 500

REMUN_VALIDA = f"vl_remun_media_sm > 0 AND vl_remun_media_sm <= {LIMITE_REMUN_SM}"


def _so_ativo(expr: str, positivo: bool = False) -> str:
    """Média calculada apenas sobre o estoque de 31/12, ignorando zeros."""
    guarda = f" AND {expr} > 0" if positivo else ""
    return f"CASE WHEN {ATIVO}{guarda} THEN {expr} END"


def _remuneracao(expr: str) -> str:
    """
    Remuneração do estoque, descartando o registro implausível.

    O descarte vale para as DUAS colunas de remuneração, não só para a que
    está corrompida: se a conversão de um registro está invertida, o registro
    inteiro é suspeito, e mantê-lo na média nominal seria escolher confiar em
    metade de um dado que já se sabe errado.
    """
    return f"CASE WHEN {ATIVO} AND {REMUN_VALIDA} THEN {expr} END"


# A mediana entra ao lado da média de propósito: distribuição salarial é
# assimétrica, e a distância entre as duas É o achado. Média puxada por poucos
# salários altos esconde o que a maioria ganha.
METRICAS = f"""
        count(*)                                   AS vinculos_no_ano,
        count(*) FILTER (WHERE {ATIVO})            AS estoque_3112,
        count(*) FILTER (WHERE NOT {ATIVO})        AS desligados_no_ano,
        round(avg({_remuneracao('vl_remun_media_sm')}), 2)     AS remuneracao_sm,
        round(median({_remuneracao('vl_remun_media_sm')}), 2)  AS remuneracao_sm_mediana,
        round(avg({_remuneracao('vl_remun_media_nom')}), 2)    AS remuneracao_nominal,
        -- Quantos registros o teto de plausibilidade descartou. Fica NA
        -- TABELA, não só no comentário: quem consultar a gold precisa poder
        -- ver que houve descarte e conferir que ele é desprezível no estoque
        -- (0,018%) ainda que enorme na massa salarial (35%).
        count(*) FILTER (WHERE {ATIVO} AND vl_remun_media_sm > {LIMITE_REMUN_SM})
                                                   AS remun_implausivel,
        round(avg({_so_ativo('tempo_emprego')}), 1)            AS tempo_emprego_meses,
        round(avg({_so_ativo('idade')}), 1)                    AS idade_media,
        round(avg({_so_ativo('qtd_hora_contr', True)}), 1)     AS horas_semanais
"""

AGREGADOS = {
    # A série-título: estoque de TI ano a ano, nas duas lentes.
    "rais_estoque_anual": f"""
        SELECT ano_particao AS ano, setor_ti, ocupacao_ti, {METRICAS}
        FROM ({BASE_VINC})
        GROUP BY 1, 2, 3 ORDER BY 1
    """,
    "rais_estoque_uf": f"""
        SELECT ano_particao AS ano, {UF} AS uf, setor_ti, ocupacao_ti, {METRICAS}
        FROM ({BASE_VINC})
        WHERE municipio_descricao IS NOT NULL
        GROUP BY 1, 2, 3, 4 ORDER BY 1, 2
    """,
    # Áreas de atuação (ver escopo_tecnologia.AREAS_TI): desenvolvimento,
    # infraestrutura, dados, suporte. Só faz sentido sobre quem TEM ocupação de
    # TI — a recepcionista da software house não pertence a nenhuma área.
    "rais_estoque_area": f"""
        SELECT ano_particao AS ano,
               {esc.sql_area_ti(COL_CBO)} AS area_ti,
               setor_ti, {METRICAS}
        FROM ({BASE_VINC})
        WHERE ocupacao_ti
        GROUP BY 1, 2, 3 ORDER BY 1, 2
    """,
    # Sexo, raça e escolaridade juntos permitem ler o hiato salarial DENTRO de
    # tecnologia, controlando por escolaridade — a comparação que separa
    # "ganham menos porque estudaram menos" de "ganham menos no mesmo nível".
    "rais_estoque_perfil": f"""
        SELECT ano_particao AS ano,
               {sql_canonico("sexo", "sexo_trabalhador_descricao")} AS sexo,
               {sql_canonico("raca_cor", "raca_cor_descricao")} AS raca_cor,
               {sql_canonico("escolaridade", "escolaridade_apos_2005_descricao")} AS escolaridade,
               setor_ti, ocupacao_ti, {METRICAS}
        FROM ({BASE_VINC})
        GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1
    """,
    "rais_remuneracao_ocupacao": f"""
        SELECT ano_particao AS ano,
               cbo_ocupacao_2002_descricao AS ocupacao,
               setor_ti, {METRICAS}
        FROM ({BASE_VINC})
        WHERE cbo_ocupacao_2002_descricao IS NOT NULL
        GROUP BY 1, 2, 3
        HAVING count(*) FILTER (WHERE vinculo_ativo_3112 = '1') >= 200
        ORDER BY 1, 5 DESC
    """,
    "rais_estoque_municipio": f"""
        SELECT ano_particao AS ano, {UF} AS uf,
               municipio_descricao AS municipio, ocupacao_ti, {METRICAS}
        FROM ({BASE_VINC})
        WHERE municipio_descricao IS NOT NULL
        GROUP BY 1, 2, 3, 4 ORDER BY 1, 5 DESC
    """,
    # O achado central, agora sobre o estoque: quanto do trabalho de TI
    # acontece FORA do setor de TI — e quanto ele paga em cada lado.
    "rais_setor_vs_ocupacao": f"""
        SELECT ano_particao AS ano, setor_ti, ocupacao_ti,
               cnae_20_subclasse_descricao AS setor_empresa,
               -- O código, para o site montar a hierarquia da CNAE (divisão > subclasse).
               any_value({COL_CNAE}) AS cnae, {METRICAS}
        FROM ({BASE_VINC})
        WHERE ocupacao_ti OR setor_ti
        GROUP BY 1, 2, 3, 4 ORDER BY 1, 6 DESC
    """,
    # A documentação do recorte, calculada do dado: que códigos CBO de fato
    # aparecem no estoque e quantos vínculos cada um tem. Antes esta lista era
    # escrita à mão no dashboard, e uma revisão do recorte a deixaria mentindo
    # sem ninguém perceber.
    "rais_recorte_cbo": f"""
        SELECT ano_particao AS ano,
               {esc.sql_codigo_cbo('cbo_ocupacao_2002')} AS cbo,
               substr({esc.sql_codigo_cbo('cbo_ocupacao_2002')}, 1, 4) AS familia,
               coalesce(any_value(cbo_ocupacao_2002_descricao),
                        'Código recente, sem descrição no dicionário do MTE') AS ocupacao,
               {esc.sql_area_ti('cbo_ocupacao_2002')} AS area,
               count(*) FILTER (WHERE {ATIVO}) AS estoque_3112,
               count(*)                        AS vinculos_no_ano
        FROM ({BASE_VINC})
        WHERE ocupacao_ti
        GROUP BY 1, 2, 3, 5
        ORDER BY 1, 3, 2
    """,
    # Mediana EXATA da remuneração, sobre os vínculos, nos recortes que o texto
    # usa. As tabelas acima guardam a mediana de cada grupo; somar grupos
    # (ex.: o total de TI a partir de setor × ocupação) pela média ponderada
    # das medianas NÃO dá a mediana do conjunto — e o resultado muda com a
    # granularidade dos grupos (3,61 SM pela tabela nacional, 4,07 pela tabela
    # por UF, no mesmo ano). Uma leitura só da silver, com GROUPING SETS.
    # Lente em código (dentro/fora/outra): o rótulo é de quem consome.
    "rais_mediana": f"""
        SELECT ano,
               CASE WHEN grouping(lente) = 0 THEN 'lente'
                    WHEN grouping(area_ti) = 0 THEN 'area'
                    WHEN grouping(escolaridade) = 0 THEN 'escolaridade'
                    WHEN grouping(uf) = 0 THEN 'uf'
                    WHEN grouping(sp) = 0 THEN 'sp'
                    ELSE 'total' END                       AS recorte,
               coalesce(lente, area_ti, escolaridade, uf, sp, 'TI') AS grupo,
               round(median(remun), 2)                     AS mediana_sm,
               count(remun)                                AS vinculos
        FROM (
            SELECT ano_particao AS ano,
                   CASE WHEN ocupacao_ti AND setor_ti THEN 'dentro'
                        WHEN ocupacao_ti THEN 'fora' ELSE 'outra' END AS lente,
                   CASE WHEN ocupacao_ti THEN {esc.sql_area_ti(COL_CBO)} END AS area_ti,
                   -- A RAIS separa mestrado e doutorado; o rótulo canônico os
                   -- junta em "Pós-graduação" porque o Novo CAGED não separa.
                   -- Aqui o dado é só da RAIS: os dois níveis ficam. (MBA e
                   -- especialização não existem na RAIS: entram como superior.)
                   CASE upper(trim(escolaridade_apos_2005_descricao))
                        WHEN 'MESTRADO' THEN 'Mestrado' WHEN 'DOUTORADO' THEN 'Doutorado'
                        ELSE {sql_canonico("escolaridade", "escolaridade_apos_2005_descricao")} END AS escolaridade,
                   CASE WHEN municipio_descricao IS NOT NULL THEN {UF} END AS uf,
                   CASE WHEN municipio_descricao IS NULL THEN NULL
                        WHEN {UF} = 'SP' THEN 'SP' ELSE 'Brasil sem SP' END AS sp,
                   {_remuneracao('vl_remun_media_sm')}        AS remun
            FROM ({BASE_VINC})
        )
        GROUP BY GROUPING SETS ((ano), (ano, lente), (ano, area_ti), (ano, escolaridade), (ano, uf), (ano, sp))
        -- Grupo nulo (sem área, sem UF) não é recorte: sai.
        HAVING NOT ((grouping(area_ti) = 0 AND area_ti IS NULL)
                 OR (grouping(escolaridade) = 0 AND (escolaridade IS NULL OR escolaridade = 'Não informado'))
                 OR (grouping(uf) = 0 AND uf IS NULL)
                 OR (grouping(sp) = 0 AND sp IS NULL))
        ORDER BY 1, 2, 3
    """,
    # Distribuição da remuneração do estoque em faixas de 0,1 SM (a última
    # junta tudo de 50 SM para cima). Serve ao site: com o filtro de estados,
    # a mediana de QUALQUER combinação de UFs sai somando as faixas e
    # interpolando dentro da faixa do meio — erro máximo de 0,05 SM, contra a
    # média de medianas, que não tem limite de erro nenhum.
    "rais_remuneracao_hist": f"""
        SELECT ano_particao AS ano, {UF} AS uf, setor_ti, ocupacao_ti,
               least(floor(vl_remun_media_sm / 0.1), 500)::SMALLINT AS faixa,
               count(*) AS vinculos
        FROM ({BASE_VINC})
        WHERE {ATIVO} AND {REMUN_VALIDA} AND municipio_descricao IS NOT NULL
        GROUP BY ALL ORDER BY ALL
    """,
    # Estabelecimentos: o que o CAGED não tem. Quantas empresas de TI existem,
    # de que porte, e quantos vínculos elas concentram.
    "rais_estabelecimentos": f"""
        SELECT ano_particao AS ano, {UF} AS uf,
               tamanho_estabelecimento_descricao AS porte,
               natureza_juridica_descricao AS natureza_juridica,
               setor_ti,
               count(*)                           AS estabelecimentos,
               sum(qtd_vinculos_ativos)           AS vinculos_ativos,
               sum(qtd_vinculos_clt)              AS vinculos_clt,
               sum(qtd_vinculos_estatutarios)     AS vinculos_estatutarios,
               round(avg(qtd_vinculos_ativos), 1) AS media_vinculos_por_estab
        FROM ({BASE_ESTAB})
        WHERE municipio_descricao IS NOT NULL
        GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 6 DESC
    """,
}


def construir(con, nome: str) -> bool:
    # Grava direto na pasta local que gold_unificado/publicar_gold.py lê
    # para publicar.
    nuvem.DIR_GOLD_LOCAL.mkdir(parents=True, exist_ok=True)
    destino = nuvem.caminho_gold(nome)
    print(f"\n🔨 {nome}")
    inicio = time.time()
    try:
        con.execute(f"""
            COPY ({AGREGADOS[nome]}) TO '{destino}' (
                FORMAT PARQUET,
                COMPRESSION 'ZSTD',
                COMPRESSION_LEVEL 3
            );
        """)
        linhas = con.execute(f"SELECT count(*) FROM read_parquet('{destino}')").fetchone()[0]
        print(f"   ✅ {linhas:,} linhas em {time.time() - inicio:.0f}s -> {destino}")
        return True
    except Exception as e:
        print(f"   ❌ falhou: {str(e)[:300]}")
        return False


def verificar_saltos(con, minimo: int = 5000, fator: int = 10) -> None:
    """
    Acusa ocupação de TI que aparece ou some num município de um ano para o
    outro.

    Foi assim que o funcionalismo de Rondônia apareceu: o CBO 317110 em Porto
    Velho passando de 181 para 44 mil vínculos ativos de um ano para o outro,
    com 158 meses de casa em média, ou seja, gente que já estava lá com outro
    código. Nenhum mercado se move assim, e nada na fonte acusa erro.

    A chave é (município, CBO), sem a natureza jurídica: com ela, empresa que
    muda de LTDA para S.A. levando os empregados aparece como salto, e a
    verificação acusava 27 casos dos quais só um era defeito. Lê a silver
    (antes de qualquer exclusão) e não interrompe a construção: o que ela
    lista precisa de leitura humana, e o artefato já conhecido sai marcado.
    """
    cbo = esc.sql_codigo_cbo(COL_CBO)
    saltos = con.execute(f"""
        WITH g AS (
            SELECT ano, municipio, {cbo} AS cbo,
                   count(*) FILTER (WHERE {ATIVO}) AS n,
                   round(avg(tempo_emprego) FILTER (WHERE {ATIVO})) AS tempo
            FROM read_parquet({FONTE_VINC}, union_by_name=true)
            WHERE {esc.sql_filtro_cbo(COL_CBO)}
            GROUP BY ALL
        ),
        pares AS (
            SELECT coalesce(a.ano, b.ano + 1) AS ano,
                   coalesce(a.municipio, b.municipio) AS municipio,
                   coalesce(a.cbo, b.cbo) AS cbo,
                   coalesce(b.n, 0) AS antes, coalesce(a.n, 0) AS depois, a.tempo
            FROM g a FULL JOIN g b
              ON b.ano = a.ano - 1 AND b.municipio = a.municipio AND b.cbo = a.cbo
        )
        SELECT * FROM pares
        WHERE ano > (SELECT min(ano) FROM g) AND ano <= (SELECT max(ano) FROM g)
          AND greatest(antes, depois) >= {minimo}
          AND greatest(antes, depois) >= {fator} * least(antes, depois)
        ORDER BY ano
    """).fetchall()
    a = esc.ARTEFATO_RO
    print(f"\n🔎 ocupações de TI que mudam {fator}x num município de um ano para o outro "
          f"(>= {minimo:,} vínculos): {len(saltos)}")
    for ano, mun, cod, antes, depois, tempo in saltos:
        conhecido = (mun, cod) == (a["municipio"], a["cbo"])
        marca = "conhecido, excluído" if conhecido else "⚠️ NOVO: investigar"
        casa = f", {tempo:.0f} meses de casa" if tempo is not None else ""
        print(f"   {ano}  município {mun}  CBO {cod}: {antes:,} -> {depois:,}{casa}  ({marca})")


def main() -> int:
    p = argparse.ArgumentParser(description="Constrói a camada gold da RAIS.")
    p.add_argument("--tabela", nargs="+", choices=list(AGREGADOS), default=list(AGREGADOS))
    p.add_argument("--threads", type=int, default=4,
                   help="A RAIS de TI tem 23,8 milhões de vínculos e as médias "
                        "com FILTER seguram muita memória por thread.")
    args = p.parse_args()

    con = nuvem.conectar_duckdb()
    con.execute(f"SET threads={args.threads}")
    print("=" * 70)
    print("  GOLD — estoque de emprego em tecnologia (RAIS)")
    print("=" * 70)

    ok = sum(construir(con, nome) for nome in args.tabela)
    print(f"\n🏁 {ok}/{len(args.tabela)} agregado(s) construído(s).")
    try:
        verificar_saltos(con)
    except Exception as e:
        print(f"   ⚠️ verificação de saltos não rodou: {str(e)[:200]}")
    return 0 if ok == len(args.tabela) else 2


if __name__ == "__main__":
    sys.exit(main())
