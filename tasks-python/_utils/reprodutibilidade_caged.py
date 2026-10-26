"""
Reprodutibilidade do CAGED: a camada publicada sai do dado bruto?

Mesma verificação de reprodutibilidade_rais.py, para as cinco tabelas do
CAGED (Novo CAGED: movimentações, fora do prazo, exclusões; CAGED antigo:
movimentações e ajustes). Para cada tabela e ano, aplica a definição do
recorte de tecnologia a cada arquivo da bronze-caged e compara a contagem com
as linhas da silver-caged-ti publicada. O apêndice B do TCC traz a mesma
conta em SQL para um mês; aqui ela cobre todos.

O resultado vai para auditoria/reprodutibilidade_caged.csv na Gold e, no
GitHub Actions, para o resumo da execução.

Uso (de dentro de tasks-python/):
    python _utils/reprodutibilidade_caged.py                       # 2007 a 2026, todas as tabelas
    python _utils/reprodutibilidade_caged.py --tabela caged_mov --anos 2025
"""
import argparse
import os
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "2-silver"))

from _utils import escopo_tecnologia as esc  # noqa: E402
from _utils import nuvem  # noqa: E402
from silver_caged import mapeamento as mp  # noqa: E402


def predicado(con, tabela: str, origem: str) -> str:
    """O recorte para este arquivo, pelas colunas de CNAE/CBO da tabela."""
    colunas = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{origem}') LIMIT 0").fetchall()]
    col_cnae, col_cbo = esc.colunas_da_tabela(tabela, colunas)
    filtro = esc.sql_filtro_tecnologia(f'"{col_cnae}"' if col_cnae else None, f'"{col_cbo}"' if col_cbo else None)
    if not filtro:
        raise RuntimeError(f"{origem}: sem coluna de CNAE nem de CBO")
    return filtro


def contar(con, tabela: str, ano: int) -> tuple[int, int, int] | None:
    bronze = sorted(a for a in nuvem.arquivos_remotos(nuvem.repo_bronze(tabela))
                    if a.startswith(f"{tabela}/ano={ano}/") and a.endswith(".parquet"))
    if not bronze:
        return None
    no_bruto = 0
    for caminho in bronze:
        origem = nuvem.fonte_leitura(nuvem.repo_bronze(tabela), caminho)
        no_bruto += con.execute(f"SELECT count(*) FROM read_parquet('{origem}') WHERE {predicado(con, tabela, origem)}").fetchone()[0]
    try:
        publicado = con.execute(
            f"SELECT count(*) FROM read_parquet({nuvem.fonte_silver_ti(tabela, f'ano_particao={ano}/**/*.parquet')})").fetchone()[0]
    except Exception as e:
        if "No files found" not in str(e):
            raise
        publicado = 0
    return len(bronze), no_bruto, publicado


def main() -> int:
    p = argparse.ArgumentParser(description="Reprodutibilidade do CAGED a partir da bronze.")
    p.add_argument("--tabela", nargs="+", choices=mp.TODAS_TABELAS, default=list(mp.TODAS_TABELAS))
    p.add_argument("--anos", type=int, nargs="+", default=list(range(2000, 2027)))
    p.add_argument("--sem-publicar", action="store_true", help="não grava o CSV na Gold")
    args = p.parse_args()

    con = nuvem.conectar_duckdb()
    linhas = []
    for tabela in args.tabela:
        for ano in args.anos:
            r = contar(con, tabela, ano)
            if r is None:
                continue
            arquivos, bruto, publicado = r
            linhas.append((tabela, ano, arquivos, bruto, publicado, publicado - bruto))
            print(f"   {tabela:14} {ano}: {arquivos:>3} arquivo(s) | bruto {bruto:>9,} | publicado {publicado:>9,} | diferença {publicado - bruto:+,}")

    # Rodada parcial (alguns anos ou tabelas): atualiza só essas linhas do CSV já
    # publicado, em vez de sobrescrevê-lo com um recorte. Assim, depois de
    # corrigir um ano, basta repetir a verificação dele.
    medidas = {(l[0], l[1]) for l in linhas}
    try:
        antigas = con.execute(
            f"SELECT tabela, ano, arquivos_bronze, linhas_no_bruto, linhas_publicadas, diferenca "
            f"FROM read_csv('hf://datasets/{nuvem.REPO_GOLD}/auditoria/reprodutibilidade_caged.csv')").fetchall()
        linhas += [tuple(r) for r in antigas if (r[0], r[1]) not in medidas]
        linhas.sort(key=lambda l: (list(mp.TODAS_TABELAS).index(l[0]) if l[0] in mp.TODAS_TABELAS else 99, l[1]))
    except Exception:
        pass  # primeira rodada: ainda não há CSV publicado

    total_bruto, total_pub = sum(l[3] for l in linhas), sum(l[4] for l in linhas)
    print(f"\n🏁 total: bruto {total_bruto:,} | publicado {total_pub:,} | diferença {total_pub - total_bruto:+,}")

    csv = "tabela,ano,arquivos_bronze,linhas_no_bruto,linhas_publicadas,diferenca\n" + "".join(
        f"{t},{a},{n},{b},{pub},{d}\n" for t, a, n, b, pub, d in linhas)
    nuvem.preparar_staging()
    local = nuvem.DIR_TEMP / "reprodutibilidade_caged.csv"
    local.write_text(csv, encoding="utf-8")
    if not args.sem_publicar:
        nuvem.publicar_arquivo(local, nuvem.REPO_GOLD, "auditoria/reprodutibilidade_caged.csv")
        print(f"📤 auditoria/reprodutibilidade_caged.csv em {nuvem.REPO_GOLD}")

    if resumo := os.getenv("GITHUB_STEP_SUMMARY"):
        with open(resumo, "a", encoding="utf-8") as f:
            f.write("## Reprodutibilidade do CAGED\n\n| Tabela | Ano | Arquivos | No bruto | Publicado | Diferença |\n|---|---|---:|---:|---:|---:|\n")
            f.writelines(f"| {t} | {a} | {n} | {b:,} | {pub:,} | {d:+,} |\n" for t, a, n, b, pub, d in linhas)
            f.write(f"| **Total** | | | **{total_bruto:,}** | **{total_pub:,}** | **{total_pub - total_bruto:+,}** |\n")
    return 0 if all(l[5] == 0 for l in linhas) else 1


if __name__ == "__main__":
    sys.exit(main())
