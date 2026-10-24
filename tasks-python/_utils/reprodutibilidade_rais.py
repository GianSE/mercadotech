"""
Reprodutibilidade da RAIS: a camada publicada sai do dado bruto?

Para cada ano, aplica a definição do recorte de tecnologia (escopo_tecnologia)
a CADA arquivo da bronze-rais — o microdado como veio do servidor do MTE, só
convertido para Parquet — e compara a contagem com as linhas da silver-rais-ti
publicada. É a mesma verificação feita para o CAGED (apêndice B do TCC), agora
para a RAIS, que é onde ela teria pego a ingestão parcial de 2022.

O que é reaproveitado do pipeline é só a DEFINIÇÃO: os códigos do recorte e o
nome da coluna de CNAE/CBO em cada layout. A contagem é independente — lê só
as duas colunas de cada arquivo da bronze, sem tradução, sem pedaços, sem
publicação.

O resultado vai para auditoria/reprodutibilidade_rais.csv na Gold publicada e,
no GitHub Actions, para o resumo da execução.

Uso (de dentro de tasks-python/):
    python _utils/reprodutibilidade_rais.py                 # 2007 a 2025
    python _utils/reprodutibilidade_rais.py --anos 2022 2025
"""
import argparse
import os
import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "2-silver"))

from _utils import escopo_tecnologia as esc  # noqa: E402
from _utils import nuvem  # noqa: E402
from silver_rais import mapeamento as mp  # noqa: E402

TABELA = "rais_vinc"


def predicado(con, origem: str) -> str:
    """O recorte para ESTE arquivo: o nome das colunas muda entre layouts."""
    colunas = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{origem}') LIMIT 0").fetchall()]
    col_cnae, col_cbo = esc.colunas_da_tabela(TABELA, colunas)
    col_cnae = mp.resolver(col_cnae, colunas) if col_cnae else mp.resolver("cnae_20_subclasse", colunas)
    col_cbo = mp.resolver(col_cbo, colunas) if col_cbo else mp.resolver("cbo_ocupacao_2002", colunas)
    filtro = esc.sql_filtro_tecnologia(f'"{col_cnae}"' if col_cnae else None, f'"{col_cbo}"' if col_cbo else None)
    if not filtro:
        raise RuntimeError(f"{origem}: sem coluna de CNAE nem de CBO")
    return filtro


def contar_ano(con, ano: int) -> tuple[int, int, int]:
    bronze = sorted(a for a in nuvem.arquivos_remotos(nuvem.repo_bronze(TABELA))
                    if a.startswith(f"{TABELA}/ano={ano}/") and a.endswith(".parquet"))
    no_bruto = 0
    for caminho in bronze:
        origem = nuvem.fonte_leitura(nuvem.repo_bronze(TABELA), caminho)
        no_bruto += con.execute(f"SELECT count(*) FROM read_parquet('{origem}') WHERE {predicado(con, origem)}").fetchone()[0]
    publicado = con.execute(
        f"SELECT count(*) FROM read_parquet({nuvem.fonte_silver_ti(TABELA, f'ano_particao={ano}/*.parquet')})").fetchone()[0]
    return len(bronze), no_bruto, publicado


def main() -> int:
    p = argparse.ArgumentParser(description="Reprodutibilidade da RAIS a partir da bronze.")
    p.add_argument("--anos", type=int, nargs="+", default=list(range(2007, 2026)))
    p.add_argument("--sem-publicar", action="store_true", help="não grava o CSV na Gold")
    args = p.parse_args()

    con = nuvem.conectar_duckdb()
    linhas = []
    for ano in args.anos:
        arquivos, bruto, publicado = contar_ano(con, ano)
        linhas.append((ano, arquivos, bruto, publicado, publicado - bruto))
        print(f"   {ano}: {arquivos:>3} arquivo(s) | bruto {bruto:>11,} | publicado {publicado:>11,} | diferença {publicado - bruto:+,}")

    total_bruto, total_pub = sum(l[2] for l in linhas), sum(l[3] for l in linhas)
    print(f"\n🏁 total: bruto {total_bruto:,} | publicado {total_pub:,} | diferença {total_pub - total_bruto:+,}")

    csv = "ano,arquivos_bronze,linhas_no_bruto,linhas_publicadas,diferenca\n" + "".join(
        f"{a},{n},{b},{pub},{d}\n" for a, n, b, pub, d in linhas)
    local = nuvem.DIR_TEMP / "reprodutibilidade_rais.csv"
    nuvem.preparar_staging()
    local.write_text(csv, encoding="utf-8")
    if not args.sem_publicar:
        nuvem.publicar_arquivo(local, nuvem.REPO_GOLD, "auditoria/reprodutibilidade_rais.csv")
        print(f"📤 auditoria/reprodutibilidade_rais.csv em {nuvem.REPO_GOLD}")

    if resumo := os.getenv("GITHUB_STEP_SUMMARY"):
        with open(resumo, "a", encoding="utf-8") as f:
            f.write("## Reprodutibilidade da RAIS\n\n| Ano | Arquivos | No bruto | Publicado | Diferença |\n|---|---:|---:|---:|---:|\n")
            f.writelines(f"| {a} | {n} | {b:,} | {pub:,} | {d:+,} |\n" for a, n, b, pub, d in linhas)
            f.write(f"| **Total** | | **{total_bruto:,}** | **{total_pub:,}** | **{total_pub - total_bruto:+,}** |\n")
    # Falha visível se algum ano não bater: é para isso que a verificação existe.
    return 0 if all(l[4] == 0 for l in linhas) else 1


if __name__ == "__main__":
    sys.exit(main())
