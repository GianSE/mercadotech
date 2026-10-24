"""
Valida o recorte de ocupação contra o painel público do MTE (Power BI).

POR QUE ESTE PAINEL
-------------------
A consulta online do PDET pede login, e o formulário de cadastro saiu do ar.
O MTE publica, porém, um painel em Power BI ("publicar na web") cujo modelo
traz a RAIS por ocupação (CBO de 6 dígitos) e município, e o Novo CAGED por
ocupação e competência. Relatório publicado na web responde à mesma API
pública que a própria página usa para desenhar os gráficos — é ela que este
script consulta, filtrando EXATAMENTE os códigos CBO do recorte (com as
exclusões e as ocupações avulsas), lidos da Gold.

O QUE ELE NÃO COBRE
-------------------
O painel não tem CNAE nas tabelas de fato: a lente de setor fica sem
validação externa. E a RAIS do painel vai de 2023 a 2025.

O CAGED do trabalho usa só as movimentações do mês (caged_mov); o painel
incorpora as declarações fora do prazo e desconta as exclusões. A comparação
soma caged_for e subtrai caged_exc, pela competência, para medir o mesmo.

Uso (de dentro de tasks-python/):
    python _utils/validar_painel_mte.py
"""
import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "3-gold"))

from _utils import nuvem  # noqa: E402
from gold_caged.cubos import UF_SIGLA, _normalizar  # noqa: E402

RAIZ = Path(__file__).resolve().parents[2]
CHAVE = "cd1ac8aa-a9e9-4408-83db-1c91f60b696d"  # relatório público do MTE
API = "https://wabi-brazil-south-d-primary-api.analysis.windows.net"
CAB = {"X-PowerBI-ResourceKey": CHAVE, "Content-Type": "application/json;charset=UTF-8"}
G = f"hf://datasets/{nuvem.REPO_GOLD}"
LENTES_OCUPACAO = "('Profissional de TI em empresa de TI', 'Profissional de TI fora do setor de TI')"


def col(fonte: str, prop: str) -> dict:
    return {"Column": {"Expression": {"SourceRef": {"Source": fonte}}, "Property": prop}}


def consultar(modelo: dict, relatorio: str, de: list, select: list, where: list) -> list[tuple]:
    """Uma consulta à API pública; devolve as linhas já decodificadas do formato DSR."""
    corpo = {"version": "1.0.0", "queries": [{"Query": {"Commands": [{"SemanticQueryDataShapeCommand": {
        "Query": {"Version": 2, "From": de, "Select": select, "Where": where},
        "Binding": {"Primary": {"Groupings": [{"Projections": list(range(len(select)))}]},
                    "DataReduction": {"DataVolume": 4, "Primary": {"Window": {"Count": 30000}}}, "Version": 1}}}]},
        "QueryId": "", "ApplicationContext": {"DatasetId": modelo["dbName"], "Sources": [{"ReportId": relatorio}]}}],
        "cancelQueries": [], "modelId": modelo["id"]}
    r = requests.post(f"{API}/public/reports/querydata?synchronous=true", headers=CAB, json=corpo, timeout=180)
    r.raise_for_status()
    ds = r.json()["results"][0]["result"]["data"]["dsr"]["DS"][0]
    dicionarios = ds.get("ValueDicts", {})
    # Cada linha traz só as colunas que mudaram; o bit i de "R" diz que a
    # coluna i repete a da linha anterior. Texto vem como índice de dicionário.
    linhas, anterior, n = [], [None] * len(select), len(select)
    for linha in ds["PH"][0]["DM0"]:
        valores, repete = iter(linha.get("C", [])), linha.get("R", 0)
        atual = [anterior[i] if repete & (1 << i) else next(valores, None) for i in range(n)]
        anterior = atual
        decodificada = list(atual)
        for i, campo in enumerate(linha.get("S", [])):
            if "DN" in campo:
                dicionarios.setdefault("_col", {})[i] = campo["DN"]
        for i, nome_dic in dicionarios.get("_col", {}).items():
            if isinstance(decodificada[i], int):
                decodificada[i] = dicionarios[nome_dic][decodificada[i]]
        linhas.append(tuple(decodificada))
    return linhas


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    p.add_argument("--destino", type=Path,
                   default=RAIZ / "overleaf" / "TCC2_Gian_Pedro_Rodrigues" / "estrutura" / "tabelas-geradas")
    args = p.parse_args()

    info = requests.get(f"{API}/public/reports/{CHAVE}/modelsAndExploration?preferReadOnlySession=true", headers=CAB, timeout=60).json()
    modelo, relatorio = info["models"][0], info["exploration"]["report"]["objectId"]

    con = nuvem.conectar_duckdb()
    cbos = [r[0] for r in con.execute(f"SELECT DISTINCT cbo FROM read_parquet('{G}/rais_recorte_cbo.parquet') WHERE cbo IS NOT NULL").fetchall()]
    filtro_cbo = lambda fonte: {"Condition": {"In": {"Expressions": [col(fonte, "cdg_ocupacao")],
                                                     "Values": [[{"Literal": {"Value": f"{int(c)}L"}}] for c in cbos]}}}
    print(f"{len(cbos)} códigos CBO no recorte de ocupação")

    # ------------------------------------------------------------------ RAIS
    rais = consultar(modelo, relatorio,
                     [{"Name": "r", "Entity": "RAIS_2015_2022_PAINEL", "Type": 0}, {"Name": "g", "Entity": "dim_geografica", "Type": 0}],
                     [{**col("r", "ano"), "Name": "ano"}, {**col("g", "UF"), "Name": "uf"},
                      {"Aggregation": {"Expression": col("r", "mtr_qtd_vinculos"), "Function": 0}, "Name": "v"}],
                     [filtro_cbo("r")])
    siglas = {_normalizar(n): s for n, s in UF_SIGLA.items()}
    con.execute("CREATE TABLE painel_rais (ano INT, uf VARCHAR, vinculos BIGINT)")
    con.executemany("INSERT INTO painel_rais VALUES (?, ?, ?)",
                    [(datetime.fromtimestamp(a / 1000, tz=timezone.utc).year, siglas.get(_normalizar(str(u))), v)
                     for a, u, v in rais if siglas.get(_normalizar(str(u)))])
    con.execute(f"""
        CREATE TABLE cmp_rais AS
        SELECT p.ano, p.uf, p.vinculos AS painel, t.vinculos AS trabalho,
               100.0 * (t.vinculos - p.vinculos) / p.vinculos AS dif
        FROM painel_rais p
        JOIN (SELECT ano, uf, sum(estoque_3112) AS vinculos FROM read_parquet('{G}/rais_estoque_uf.parquet')
              WHERE ocupacao_ti GROUP BY 1, 2) t USING (ano, uf)
    """)

    # ----------------------------------------------------------------- CAGED
    caged = consultar(modelo, relatorio,
                      [{"Name": "n", "Entity": "NOVO_CAGED_PAINEL", "Type": 0}],
                      [{**col("n", "competencia"), "Name": "comp"}] + [
                          {"Aggregation": {"Expression": col("n", m), "Function": 0}, "Name": m} for m in ("mtr_sum_adm", "mtr_sum_des")],
                      [filtro_cbo("n")])
    con.execute("CREATE TABLE painel_caged (comp INT, adm BIGINT, des BIGINT)")
    con.executemany("INSERT INTO painel_caged VALUES (?, ?, ?)", caged)
    lista = ", ".join(f"'{c}'" for c in cbos)

    def tardias(tabela: str) -> str:
        return f"""SELECT TRY_CAST(competenciamov AS INT) // 100 AS ano,
                          count(*) FILTER (WHERE TRY_CAST(saldomovimentacao AS INT) = 1)  AS adm,
                          count(*) FILTER (WHERE TRY_CAST(saldomovimentacao AS INT) = -1) AS des
                   FROM read_parquet({nuvem.fonte_silver_ti(tabela)}, union_by_name = true)
                   WHERE TRY_CAST(cbo2002ocupacao AS VARCHAR) IN ({lista}) GROUP BY 1"""

    con.execute(f"""
        CREATE TABLE cmp_caged AS
        SELECT p.ano, p.adm AS adm_painel, m.adm + coalesce(f.adm, 0) - coalesce(e.adm, 0) AS adm_trabalho,
               p.des AS des_painel, m.des + coalesce(f.des, 0) - coalesce(e.des, 0) AS des_trabalho
        FROM (SELECT comp // 100 AS ano, sum(adm) AS adm, sum(des) AS des FROM painel_caged GROUP BY 1) p
        JOIN (SELECT ano, sum(admissoes) AS adm, sum(desligamentos) AS des FROM read_parquet('{G}/caged_cubo.parquet')
              WHERE lente IN {LENTES_OCUPACAO} GROUP BY 1) m USING (ano)
        LEFT JOIN ({tardias('caged_for')}) f USING (ano)
        LEFT JOIN ({tardias('caged_exc')}) e USING (ano)
        ORDER BY 1
    """)

    # --------------------------------------------------------------- saídas
    pasta_csv = RAIZ / "overleaf" / "validacao"
    pasta_csv.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY (SELECT * FROM cmp_rais ORDER BY ano, uf) TO '{(pasta_csv / 'painel_mte_rais.csv').as_posix()}' (HEADER)")
    con.execute(f"COPY cmp_caged TO '{(pasta_csv / 'painel_mte_caged.csv').as_posix()}' (HEADER)")

    num = lambda v, c=0: f"{float(v):,.{c}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    pct = lambda v: ("+" if v >= 0 else "") + num(v, 2) + r"\%"

    linhas = []
    for ano, painel, trabalho, mediana, minimo, maximo, ufs in con.execute("""
        SELECT ano, sum(painel), sum(trabalho), quantile_cont(dif, 0.5), min(dif), max(dif), count(*)
        FROM cmp_rais GROUP BY 1 ORDER BY 1""").fetchall():
        dif = 100.0 * (trabalho - painel) / painel
        linhas.append(f"        {ano} & {num(painel)} & {num(trabalho)} & {pct(dif)} & {pct(mediana)} & {pct(minimo)} a {pct(maximo)} \\\\")
    tabela_rais = "\n".join(linhas)

    linhas = []
    for ano, ap, at, dp, dt in con.execute("SELECT * FROM cmp_caged").fetchall():
        linhas.append(f"        {ano} & {num(ap)} & {num(at)} & {pct(100.0 * (at - ap) / ap)} & {num(dp)} & {num(dt)} & {pct(100.0 * (dt - dp) / dp)} \\\\")
    tabela_caged = "\n".join(linhas)

    (args.destino / "tab-validacao-rais.tex").write_text(f"""% Gerado por _utils/validar_painel_mte.py --- não editar à mão.
\\begin{{table}}[htbp]
    \\centering
    \\caption{{Vínculos ativos em 31/12 nas ocupações do recorte: painel do MTE e este trabalho}}
    \\label{{tab:validacao-rais}}
    \\footnotesize
    \\renewcommand{{\\arraystretch}}{{1.25}}
    \\begin{{tabular}}{{lrrrrl}}
        \\toprule
        \\rowcolor{{black!8}}
        \\textbf{{Ano}} & \\textbf{{Painel MTE}} & \\textbf{{Trabalho}} & \\textbf{{Diferença}} & \\textbf{{Mediana UF}} & \\textbf{{Faixa nas 27 UFs}} \\\\
        \\midrule
{tabela_rais}
        \\bottomrule
    \\end{{tabular}}
    \\\\[4pt]
    Fonte: Autoria própria, a partir do painel público do MTE e da camada Gold.
\\end{{table}}
""", encoding="utf-8")
    (args.destino / "tab-validacao-caged.tex").write_text(f"""% Gerado por _utils/validar_painel_mte.py --- não editar à mão.
\\begin{{table}}[htbp]
    \\centering
    \\caption{{Admissões e desligamentos no Novo CAGED nas ocupações do recorte: painel do MTE e este trabalho}}
    \\label{{tab:validacao-caged}}
    \\footnotesize
    \\renewcommand{{\\arraystretch}}{{1.25}}
    \\begin{{tabular}}{{lrrrrrr}}
        \\toprule
        \\rowcolor{{black!8}}
        & \\multicolumn{{3}}{{c}}{{\\textbf{{Admissões}}}} & \\multicolumn{{3}}{{c}}{{\\textbf{{Desligamentos}}}} \\\\
        \\rowcolor{{black!8}}
        \\textbf{{Ano}} & \\textbf{{Painel}} & \\textbf{{Trabalho}} & \\textbf{{Dif.}} & \\textbf{{Painel}} & \\textbf{{Trabalho}} & \\textbf{{Dif.}} \\\\
        \\midrule
{tabela_caged}
        \\bottomrule
    \\end{{tabular}}
    \\\\[4pt]
    Nota: o trabalho inclui as declarações fora do prazo e desconta as exclusões, como o painel. \\\\
    Fonte: Autoria própria, a partir do painel público do MTE e da camada Silver.
\\end{{table}}
""", encoding="utf-8")
    print("✅ tab-validacao-rais.tex e tab-validacao-caged.tex gerados; detalhe em overleaf/validacao/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
