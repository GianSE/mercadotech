"""
Cubos do CAGED para o site de dashboards, a partir do CAGED unificado
(caged_ti_<ano>.parquet, ver unificar.py).

POR QUE CUBOS
-------------
O CAGED não tinha Gold equivalente à da RAIS: os recortes por UF, setor,
ocupação e perfil eram calculados sobre a Silver a cada filtro. Um cubo é a
Silver já agregada no grão dos filtros que o site oferece — qualquer
combinação deles vira uma consulta de milissegundos no navegador, com uma
fração do volume (~5 MB no lugar de ~114 MB).

SOMA E CONTAGEM, NUNCA MÉDIA
----------------------------
O salário vai como soma e contagem. Média de médias de grupos de tamanhos
diferentes sai plausível e errada; quem consulta divide no fim, depois de
filtrar.

Os cubos são publicados na Gold (gold-caged-consolidado.py) e o site os
embarca no build (dashboards/scripts/preparar_dados.py) — a mesma função
serve aos dois, para a conta não existir em duas versões.

Uso:
    python -m gold_caged.cubos            # lê publicacao/detalhado, grava publicacao/gold
"""
import sys
import unicodedata
from pathlib import Path

from _utils import escopo_tecnologia as esc

RAIZ = Path(__file__).resolve().parents[3]
DIR_ENTRADA = RAIZ / "publicacao" / "detalhado"
DIR_SAIDA = RAIZ / "publicacao" / "gold"

UF_SIGLA = {
    "Acre": "AC", "Alagoas": "AL", "Amapá": "AP", "Amazonas": "AM", "Bahia": "BA",
    "Ceará": "CE", "Distrito Federal": "DF", "Espírito Santo": "ES", "Goiás": "GO",
    "Maranhão": "MA", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS",
    "Minas Gerais": "MG", "Pará": "PA", "Paraíba": "PB", "Paraná": "PR",
    "Pernambuco": "PE", "Piauí": "PI", "Rio de Janeiro": "RJ",
    "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS", "Rondônia": "RO",
    "Roraima": "RR", "Santa Catarina": "SC", "São Paulo": "SP", "Sergipe": "SE",
    "Tocantins": "TO",
}

# Grão de cada cubo: as dimensões que o site filtra ou quebra.
CUBOS = {
    "caged_cubo": "ano, uf, setor, lente, area_ti, sexo, raca_cor, escolaridade, faixa_idade",
    "caged_ocupacao": "ano, ocupacao, lente",
}


def _normalizar(texto: str) -> str:
    sem_acento = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return sem_acento.strip().upper()


def montar(con, origem: str, destino: Path) -> list[str]:
    """
    Agrega os arquivos de `origem` (glob de caged_ti_<ano>.parquet) nos cubos
    e grava um parquet por cubo em `destino`. Devolve os nomes gravados.
    """
    destino.mkdir(parents=True, exist_ok=True)
    con.execute(f"CREATE OR REPLACE TEMP TABLE caged_ti AS SELECT * FROM read_parquet('{origem}', union_by_name=true)")

    # O dicionário do MTE grafa o mesmo estado de jeitos diferentes conforme o
    # ano ("Pará"/"Para", "Minas Gerais"/"Minas gerais"): compara sem acento e
    # em maiúsculas, senão esses anos somem do recorte por UF sem erro nenhum.
    casos = "\n".join(f"WHEN '{_normalizar(nome)}' THEN '{sigla}'" for nome, sigla in UF_SIGLA.items())
    cnae = f"coalesce({esc.sql_filtro_cnae('cnae_subclasse')}, false)"
    cbo = f"coalesce({esc.sql_filtro_cbo('cbo')}, false)"
    con.execute(f"""
        CREATE OR REPLACE TEMP TABLE base_cubo AS SELECT
            ano::INTEGER AS ano,
            CASE upper(strip_accents(trim(uf))) {casos} ELSE NULL END AS uf,
            setor, ocupacao, area_ti, sexo, raca_cor, escolaridade,
            CASE WHEN {cnae} AND {cbo} THEN 'Profissional de TI em empresa de TI'
                 WHEN {cbo}            THEN 'Profissional de TI fora do setor de TI'
                 ELSE 'Outra ocupação em empresa de TI' END AS lente,
            CASE WHEN idade IS NULL THEN NULL WHEN idade < 25 THEN '<25'
                 WHEN idade < 30 THEN '25-29' WHEN idade < 40 THEN '30-39'
                 WHEN idade < 50 THEN '40-49' ELSE '50+' END AS faixa_idade,
            saldo, salario
        FROM caged_ti
    """)
    metricas = """
        count(*) FILTER (WHERE saldo = 1)::INTEGER                       AS admissoes,
        count(*) FILTER (WHERE saldo = -1)::INTEGER                      AS desligamentos,
        sum(saldo)::INTEGER                                              AS saldo,
        sum(salario) FILTER (WHERE saldo = 1 AND salario > 0)::DOUBLE    AS soma_salario_adm,
        count(*) FILTER (WHERE saldo = 1 AND salario > 0)::INTEGER       AS n_salario_adm"""
    for nome, grao in CUBOS.items():
        arquivo = (destino / f"{nome}.parquet").as_posix()
        con.execute(f"""COPY (SELECT {grao}, {metricas} FROM base_cubo GROUP BY ALL ORDER BY ALL)
                        TO '{arquivo}' (FORMAT PARQUET, COMPRESSION ZSTD, COMPRESSION_LEVEL 9)""")
        linhas = con.execute(f"SELECT count(*) FROM '{arquivo}'").fetchone()[0]
        print(f"✅ {nome}: {linhas:,} linhas, {Path(arquivo).stat().st_size / 1e6:.1f} MB")
    con.execute("DROP TABLE base_cubo; DROP TABLE caged_ti;")
    return list(CUBOS)


def main() -> int:
    import duckdb

    if not any(DIR_ENTRADA.glob("caged_ti_*.parquet")):
        print(f"❌ nenhum caged_ti_<ano>.parquet em {DIR_ENTRADA} (rode unificar antes)")
        return 1
    montar(duckdb.connect(), (DIR_ENTRADA / "caged_ti_*.parquet").as_posix(), DIR_SAIDA)
    return 0


if __name__ == "__main__":
    sys.exit(main())
