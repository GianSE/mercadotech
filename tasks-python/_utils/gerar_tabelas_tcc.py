"""
Gera as tabelas LaTeX do TCC a partir da camada Gold.

POR QUE GERAR, E NÃO DIGITAR
----------------------------
Todo número deste trabalho vem de um agregado da camada Gold. Digitá-los no
texto criaria duas versões da mesma informação, e a segunda envelheceria em
silêncio: bastaria uma revisão do recorte ou uma correção na camada para o
documento passar a afirmar algo que o dado não diz. Foi exatamente o que
aconteceu com a lista de códigos CBO, escrita à mão no início e corrigida depois.

Cada tabela sai num arquivo próprio em `TCC2_.../estrutura/tabelas-geradas/`,
incluído no capítulo correspondente com `\\input`. Regerar é um comando:

    python -m gerar_tabelas_tcc        (de dentro de tasks_python/)

O script mora AQUI, e não na pasta do TCC, por dois motivos: precisa dos
módulos do pipeline para ler o repositório de dados, e a pasta do TCC é
empacotada para o Overleaf, que não executa Python.

Lê o mesmo lugar que o pipeline grava: os repositórios do Hugging Face (a Gold
para os agregados, a listagem da Bronze e da Silver para os volumes). Para
comparar antes de sobrescrever as tabelas do texto, gere em outra pasta:

    python _utils/gerar_tabelas_tcc.py --destino /tmp/tabelas
"""
import argparse
import sys
from pathlib import Path

RAIZ_PROJETO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from _utils import nuvem  # noqa: E402

_args = argparse.ArgumentParser(description="Gera as tabelas LaTeX do TCC.")
_args.add_argument("--destino", type=Path,
                   default=RAIZ_PROJETO / "overleaf" / "TCC2_Gian_Pedro_Rodrigues" / "estrutura" / "tabelas-geradas")
DESTINO = _args.parse_args().destino
# Arquivo único por hf:// não lista o repositório (sem risco de limite de taxa).
G = f"hf://datasets/{nuvem.REPO_GOLD}"

con = nuvem.conectar_duckdb()
DESTINO.mkdir(parents=True, exist_ok=True)


# ------------------------------------------------------------- formatação
def num(v, casas: int = 0) -> str:
    """Número no padrão brasileiro: ponto de milhar, vírgula decimal."""
    if v is None:
        return "---"
    texto = f"{float(v):,.{casas}f}"
    return texto.replace(",", "X").replace(".", ",").replace("X", ".")


def ano(v) -> str:
    """Ano é identificador, não quantidade: sem separador de milhar."""
    return str(int(v))


def pct(v, casas: int = 1) -> str:
    return f"{num(v, casas)}\\%"


def escrever(nome: str, corpo: str):
    (DESTINO / nome).write_text(corpo.rstrip() + "\n", encoding="utf-8")
    print(f"   {nome}")


def tabela(nome: str, caption: str, rotulo: str, colunas: str,
           cabecalho: list[str], linhas: list[list[str]],
           fonte: str = "Autoria própria, a partir da camada Gold.",
           nota: str = "", ambiente: str = "table") -> None:
    """Monta uma tabela ABNT com booktabs e grava o arquivo."""
    cab = " & ".join(f"\\textbf{{{c}}}" for c in cabecalho) + " \\\\"
    corpo = "\n".join("        " + " & ".join(l) + " \\\\" for l in linhas)
    escrever(nome, f"""% Gerado por scripts/gerar_tabelas.py --- não editar à mão.
\\begin{{{ambiente}}}[htbp]
    \\centering
    \\caption{{{caption}}}
    \\label{{{rotulo}}}
    \\footnotesize
    \\renewcommand{{\\arraystretch}}{{1.25}}
    \\begin{{tabular}}{{{colunas}}}
        \\toprule
        \\rowcolor{{black!8}}
        {cab}
        \\midrule
{corpo}
        \\bottomrule
    \\end{{tabular}}
    \\\\[4pt]
    {nota}Fonte: {fonte}
\\end{{{ambiente}}}""")


print("Gerando tabelas em", DESTINO)

# ------------------------------------------------- volumes das camadas
# Tamanho de cada arquivo pela listagem do repositório, sem baixar nada. Na
# Silver do CAGED, o repositório também guarda o espelho consolidado da Gold
# (caged_ti_<ano> e um arquivo por tabela e ano): só entram as pastas das
# tabelas tratadas, que são a camada Silver propriamente dita.
TABELAS_TI = ("caged_mov", "caged_old", "caged_for", "caged_exc", "caged_ajustes",
              "rais_vinc", "rais_estab")


def _parquets(repo: str, prefixos: tuple[str, ...] | None = None, escopo: bool | None = None) -> list[int]:
    """Tamanhos dos .parquet do repo. `escopo`: True só 2007 em diante, False só antes."""
    import re
    from huggingface_hub import HfApi

    def no_escopo(caminho: str) -> bool:
        m = re.search(r"ano=(\d+)", caminho)
        return m is None or int(m.group(1)) >= 2007  # sem ano (dicionário) conta no escopo

    return [f.size for f in HfApi().list_repo_tree(repo, repo_type="dataset", recursive=True)
            if getattr(f, "size", None) is not None and f.path.endswith(".parquet")
            and (prefixos is None or f.path.startswith(prefixos))
            and (escopo is None or no_escopo(f.path) == escopo)]


# A Bronze guarda também anos anteriores a 2007 (RAIS desde 1985), fora do
# período analisado: em linha própria, para o volume do escopo ficar visível.
linhas = []
camadas = (
    ("Bronze, 2007 em diante", [_parquets(nuvem.REPO_BRONZE_CAGED, escopo=True), _parquets(nuvem.REPO_BRONZE_RAIS, escopo=True)]),
    ("Bronze, anos anteriores", [_parquets(nuvem.REPO_BRONZE_CAGED, escopo=False), _parquets(nuvem.REPO_BRONZE_RAIS, escopo=False)]),
    ("Silver de TI", [_parquets(nuvem.REPO_SILVER_TI_CAGED, tuple(f"{t}/" for t in TABELAS_TI)),
                      _parquets(nuvem.REPO_SILVER_TI_RAIS, tuple(f"{t}/" for t in TABELAS_TI))]),
    ("Gold", [_parquets(nuvem.REPO_GOLD)]),
)
for rotulo, listas in camadas:
    arqs = [t for lista in listas for t in lista]
    tam = sum(arqs) / 2**30
    linhas.append([rotulo, num(len(arqs)), f"{num(tam, 2)} GB" if tam >= 0.01 else "< 10 MB"])
tabela("tab-volumes.tex", "Volume de cada camada do \\textit{data lake}",
       "tab:volumes", "lrr", ["Camada", "Arquivos", "Tamanho"], linhas,
       fonte="Autoria própria, a partir da listagem dos repositórios de dados.")

# ------------------------------------------------- linhas por tabela
linhas = []
for t in TABELAS_TI:
    # count(*) sai do rodapé de cada arquivo: lê metadado, não dado.
    n = con.execute(f"SELECT count(*) FROM read_parquet({nuvem.fonte_silver_ti(t)}, union_by_name=true)"
                    ).fetchone()[0]
    linhas.append([f"\\texttt{{{t.replace('_', chr(92) + '_')}}}", num(n)])
tabela("tab-linhas-camada.tex",
       "Registros no recorte de tecnologia, por tabela da camada tratada",
       "tab:linhas-camada", "lr", ["Tabela", "Registros"], linhas)

# ------------------------------------------------- estoque e qualidade
# A mediana vem de rais_mediana (exata, sobre os vínculos). A média ponderada
# das medianas dos grupos não é a mediana do conjunto — ver construir_gold.
# Já o tempo médio pode ser ponderado: média de médias pesada pelo tamanho do
# grupo é a média do conjunto.
serie = con.execute(f"""
    SELECT e.ano, e.estoque, m.mediana_sm, e.meses
    FROM (SELECT ano, sum(estoque_3112) AS estoque,
                 sum(estoque_3112 * tempo_emprego_meses) / sum(estoque_3112) AS meses
          FROM read_parquet('{G}/rais_estoque_anual.parquet') GROUP BY 1) e
    JOIN read_parquet('{G}/rais_mediana.parquet') m ON m.ano = e.ano AND m.recorte = 'total'
    ORDER BY 1
""").fetchall()
tabela("tab-estoque-serie.tex",
       "Estoque de vínculos formais de TI, remuneração mediana e tempo de emprego",
       "tab:estoque-serie", "lrrr",
       ["Ano", "Vínculos em 31/12", "Remuneração mediana (SM)", "Tempo de emprego (meses)"],
       [[ano(r[0]), num(r[1]), num(r[2], 2), num(r[3])] for r in serie],
       nota="SM: salários mínimos do ano de referência. ")


# ------------------------------------------------- gráficos
# As séries no tempo vão para o texto como gráfico (pgfplots, vetorial e na
# fonte do documento) e a tabela correspondente fica no apêndice, com os
# valores exatos. Os pontos saem da mesma consulta da tabela.
EIXO = r"""width=\linewidth, height=6.2cm, axis lines=left, tick align=outside,
            ymajorgrids, grid style={black!12}, tick label style={font=\footnotesize},
            label style={font=\footnotesize}, title style={font=\small\bfseries},
            /pgf/number format/use comma, /pgf/number format/1000 sep={.}"""


def figura(nome: str, caption: str, rotulo: str, corpo: str, nota: str = "",
           fonte: str = "Autoria própria, a partir da camada Gold.") -> None:
    escrever(nome, f"""% Gerado por scripts/gerar_tabelas.py --- não editar à mão.
\\begin{{figure}}[htbp]
    \\centering
    \\caption{{{caption}}}
    \\label{{{rotulo}}}
{corpo}
    \\\\[4pt]
    {{\\footnotesize {nota}}}Fonte: {fonte}
\\end{{figure}}""")


def pontos(pares) -> str:
    return " ".join(f"({x},{y})" for x, y in pares)


p0, p1 = serie[0], serie[-1]
figura("fig-estoque-serie.tex",
       f"Estoque de vínculos formais de TI e remuneração mediana, {ano(p0[0])}--{ano(p1[0])}",
       "fig:estoque-serie", f"""    \\begin{{minipage}}[t]{{0.49\\textwidth}}
    \\begin{{tikzpicture}}
    \\begin{{axis}}[{EIXO}, title={{Vínculos ativos em 31/12 (mil)}},
            xmin={ano(p0[0])}, xmax={ano(p1[0])}, ymin=0, xtick distance=3,
            x tick label style={{/pgf/number format/1000 sep={{}}}}]
        \\addplot[very thick, black!80, mark=*, mark size=1.2pt] coordinates {{{pontos((r[0], round(r[1] / 1000, 1)) for r in serie)}}};
        \\node[font=\\scriptsize, anchor=north west, yshift=-2pt] at (axis cs:{ano(p0[0])},{p0[1] / 1000:.1f}) {{{num(p0[1])}}};
        \\node[font=\\scriptsize, anchor=south east] at (axis cs:{ano(p1[0])},{p1[1] / 1000:.1f}) {{{num(p1[1])}}};
    \\end{{axis}}
    \\end{{tikzpicture}}
    \\end{{minipage}}\\hfill
    \\begin{{minipage}}[t]{{0.49\\textwidth}}
    \\begin{{tikzpicture}}
    \\begin{{axis}}[{EIXO}, title={{Remuneração mediana (salários mínimos)}},
            xmin={ano(p0[0])}, xmax={ano(p1[0])}, ymin=0, ymax=4, xtick distance=3,
            x tick label style={{/pgf/number format/1000 sep={{}}}},
            y tick label style={{/pgf/number format/.cd, use comma, fixed, fixed zerofill, precision=1}}]
        \\addplot[very thick, black!80, mark=*, mark size=1.2pt] coordinates {{{pontos((r[0], round(r[2], 2)) for r in serie)}}};
        \\node[font=\\scriptsize, anchor=north west, yshift=-4pt] at (axis cs:{ano(p0[0])},{p0[2]:.2f}) {{{num(p0[2], 2)}}};
        \\node[font=\\scriptsize, anchor=north east] at (axis cs:{ano(p1[0])},{p1[2]:.2f}) {{{num(p1[2], 2)}}};
    \\end{{axis}}
    \\end{{tikzpicture}}
    \\end{{minipage}}""",
       nota="Valores anuais na \\autoref{tab:estoque-serie}, no \\autoref{apend:series}. ")

# ------------------------------------------------- as duas lentes
ANO = con.execute(f"SELECT max(ano) FROM read_parquet('{G}/rais_estoque_anual.parquet')").fetchone()[0]
linhas = [[r[0], num(r[1]), num(r[2], 2), num(r[3])] for r in con.execute(f"""
    SELECT CASE e.lente WHEN 'fora' THEN 'Profissional de TI fora de empresa de TI'
                        WHEN 'dentro' THEN 'Profissional de TI em empresa de TI'
                        ELSE 'Outra ocupação em empresa de TI' END,
           e.estoque, m.mediana_sm, e.meses
    FROM (SELECT CASE WHEN ocupacao_ti AND NOT setor_ti THEN 'fora'
                      WHEN ocupacao_ti AND setor_ti THEN 'dentro' ELSE 'outra' END AS lente,
                 sum(estoque_3112) AS estoque,
                 sum(estoque_3112 * tempo_emprego_meses) / sum(estoque_3112) AS meses
          FROM read_parquet('{G}/rais_setor_vs_ocupacao.parquet')
          WHERE ano = {ANO} GROUP BY 1) e
    JOIN read_parquet('{G}/rais_mediana.parquet') m
      ON m.ano = {ANO} AND m.recorte = 'lente' AND m.grupo = e.lente
    ORDER BY e.estoque DESC
""").fetchall()]
tabela("tab-lentes.tex",
       f"As duas lentes do recorte de tecnologia em {ANO}",
       "tab:lentes", "lrrr",
       ["Lente", "Vínculos", "Remuneração mediana (SM)", "Tempo de emprego (meses)"], linhas)

# ------------------------------------------------- areas de TI
linhas = [[r[0], num(r[1]), num(r[2], 2)] for r in con.execute(f"""
    SELECT a.area_ti, a.estoque, m.mediana_sm
    FROM (SELECT area_ti, sum(estoque_3112) AS estoque
          FROM read_parquet('{G}/rais_estoque_area.parquet')
          WHERE ano = {ANO} GROUP BY 1) a
    JOIN read_parquet('{G}/rais_mediana.parquet') m
      ON m.ano = {ANO} AND m.recorte = 'area' AND m.grupo = a.area_ti
    ORDER BY a.estoque DESC
""").fetchall()]
tabela("tab-areas.tex", f"Estoque e remuneração por área de TI em {ANO}",
       "tab:areas", "lrr", ["Área", "Vínculos", "Remuneração mediana (SM)"], linhas)

# ------------------------------------------------- concentracao por UF
linhas = [[r[0], num(r[1]), pct(r[2]), num(r[3], 2)] for r in con.execute(f"""
    SELECT uf, estoque, 100.0 * estoque / sum(estoque) OVER () AS parte,
           remuneracao_sm_mediana
    FROM read_parquet('{G}/mapa_uf.parquet') WHERE ano = {ANO}
    ORDER BY estoque DESC LIMIT 10
""").fetchall()]
tabela("tab-uf.tex", f"As dez unidades federativas com maior estoque de TI em {ANO}",
       "tab:uf", "lrrr",
       ["UF", "Vínculos", "Participação", "Remuneração mediana (SM)"], linhas)

# ------------------------------------------------- hiato salarial
linhas = [[ano(r[0]), r[1], pct(r[2]), num(r[3], 3), num(r[4], 3)] for r in con.execute(f"""
    SELECT ano, comparacao, hiato_pct, explicada, nao_explicada
    FROM read_parquet('{G}/hiato_serie.parquet')
    WHERE ano IN (2007, 2015, {ANO}) ORDER BY comparacao, ano
""").fetchall()]
tabela("tab-hiato.tex", "Decomposição de Oaxaca-Blinder do hiato salarial",
       "tab:hiato", "llrrr",
       ["Ano", "Comparação", "Hiato bruto", "Parcela explicada (log)",
        "Parcela não explicada (log)"], linhas,
       nota="Parcelas em logaritmo da remuneração; referência de Neumark. ")

# ------------------------------------------------- previsao
linhas = [[f"\\texttt{{{r[0]}}}", num(r[1]), num(r[2]), num(r[3]), pct(r[4])]
          for r in con.execute(f"""
    SELECT modelo, dobras, mae, rmse, \"ganho_vs_naive_%\"
    FROM read_parquet('{G}/previsao_placar.parquet') ORDER BY mae
""").fetchall()]
tabela("tab-previsao.tex",
       "Desempenho dos modelos na validação de origem móvel",
       "tab:previsao", "lrrrr",
       ["Modelo", "Dobras", "MAE", "RMSE", "Ganho sobre o ingênuo"], linhas)

# ------------------------------------------------- nowcast
linhas = [[r[0], num(r[1]), num(r[2]), num(r[3]), pct(r[4], 2)] for r in con.execute(f"""
    SELECT estimador, previsto, real, erro, erro_pct
    FROM read_parquet('{G}/nowcast_ano_retido.parquet') ORDER BY abs(erro_pct)
""").fetchall()]
ano_teste = con.execute(f"SELECT max(ano_teste) FROM read_parquet('{G}/nowcast_ano_retido.parquet')").fetchone()[0]
tabela("tab-nowcast.tex",
       f"\\textit{{Nowcast}} do estoque: estimadores ajustados sem o ano de {int(ano_teste)}",
       "tab:nowcast", "lrrrr",
       ["Estimador", "Estimado", "Observado", "Erro", "Erro relativo"], linhas)

# ------------------------------------------------- sobrevivencia
risco = con.execute(f"""
    SELECT tempo_de_casa, vinculos, desligamentos, \"risco_%\"
    FROM read_parquet('{G}/sobrevivencia_risco.parquet')
    ORDER BY list_position(['0-6m', '6-12m', '1-2a', '2-3a', '3-5a', '5-10a', '10-20a', '20a+'], tempo_de_casa)
""").fetchall()
ano_risco = con.execute(f"SELECT max(ano) FROM read_parquet('{G}/sobrevivencia_risco.parquet')").fetchone()[0]
tabela("tab-risco.tex", f"Risco de desligamento por tempo de casa em {int(ano_risco)}",
       "tab:risco", "lrrr",
       ["Tempo de casa", "Vínculos", "Desligamentos", "Risco no ano"],
       [[r[0], num(r[1]), num(r[2]), pct(r[3])] for r in risco])

# Coordenada simbólica sem traço (0-6m -> f0_6m); rótulo legível em duas linhas (0–6\\meses).
chave = lambda f: "f" + f.replace("-", "_")
faixa = lambda f: f.replace("-", "--").replace("m", "\\\\meses").replace("a", "\\\\anos")
pico = max(risco, key=lambda r: r[3])[0]
barras = "\n".join(
    f"        \\addplot[ybar, bar width=16pt, fill={'black!75' if r[0] == pico else 'black!30'}, draw=none, "
    f"nodes near coords, nodes near coords style={{font=\\scriptsize, /pgf/number format/.cd, use comma, fixed, fixed zerofill, precision=1}}] "
    f"coordinates {{({chave(r[0])},{r[3]:.1f})}};"
    for r in risco)
figura("fig-risco.tex", f"Risco de desligamento no ano, por tempo de casa, em {int(ano_risco)}",
       "fig:risco", f"""    \\begin{{tikzpicture}}
    \\begin{{axis}}[{EIXO}, width=0.85\\textwidth, height=6cm, ymin=0, ymax={max(r[3] for r in risco) * 1.18:.0f},
            ylabel={{Desligados no ano (\\%)}}, symbolic x coords={{{",".join(chave(r[0]) for r in risco)}}},
            xtick={{{",".join(chave(r[0]) for r in risco)}}}, xticklabels={{{",".join("{" + faixa(r[0]) + "}" for r in risco)}}},
            enlarge x limits=0.08, ybar=0pt, bar shift=0pt,
            x tick label style={{font=\\footnotesize, align=center}}]
{barras}
    \\end{{axis}}
    \\end{{tikzpicture}}""",
       nota="Vínculos e desligamentos de cada faixa na \\autoref{tab:risco}, no \\autoref{apend:series}. ")

# ------------------------------------------------- perfis de municipio
linhas = [[r[0], num(r[1]), num(r[2]), num(r[3], 2), num(r[4], 2)] for r in con.execute(f"""
    SELECT nome, count(*) AS municipios, avg(estoque) AS estoque,
           avg(crescimento) AS cresc, avg(remuneracao_sm_mediana) AS sm
    FROM read_parquet('{G}/municipios_cluster.parquet')
    GROUP BY 1 ORDER BY 3 DESC
""").fetchall()]
tabela("tab-clusters.tex", "Perfis de município obtidos por $k$-médias",
       "tab:clusters", "lrrrr",
       ["Perfil", "Municípios", "Estoque médio", "Crescimento médio",
        "Remuneração mediana (SM)"], linhas)

# ------------------------------------------- apendice: codigos do recorte
linhas = [[f"\\texttt{{{r[0]}}}", f"\\texttt{{{r[1]}}}", r[2][:52], r[3], num(r[4])]
          for r in con.execute(f"""
    SELECT familia, cbo, ocupacao, area, estoque_3112
    FROM read_parquet('{G}/rais_recorte_cbo.parquet')
    WHERE ano = {ANO} ORDER BY familia, cbo
""").fetchall()]
tabela("tab-cbos.tex",
       f"Códigos CBO do recorte de tecnologia observados no estoque de {ANO}",
       "quadro:cbos", "llp{6.0cm}lr",
       ["Família", "CBO", "Ocupação", "Área", f"Vínculos {ANO}"], linhas,
       nota="Ocupações sem descrição são códigos em uso que não constam dos "
            "dicionários oficiais do MTE. ", ambiente="quadro")

# ------------------------------- reprodutibilidade da RAIS (auditoria)
# Resultado de _utils/reprodutibilidade_rais.py, publicado na Gold em
# auditoria/: recontagem do recorte no dado bruto, ano a ano.
rep = con.execute(f"""
    SELECT ano, arquivos_bronze, linhas_no_bruto, linhas_publicadas, diferenca
    FROM read_csv('{G}/auditoria/reprodutibilidade_rais.csv') ORDER BY ano
""").fetchall()
linhas = [[ano(r[0]), num(r[1]), num(r[2]), num(r[3]), num(r[4])] for r in rep]
linhas.append(["\\textbf{Total}", num(sum(r[1] for r in rep)), num(sum(r[2] for r in rep)),
               num(sum(r[3] for r in rep)), num(sum(r[4] for r in rep))])
tabela("tab-reprodutibilidade-rais.tex",
       "Recontagem do recorte de tecnologia na RAIS a partir do dado bruto",
       "tab:reprodutibilidade-rais", "lrrrr",
       ["Ano", "Arquivos brutos", "Linhas no dado bruto", "Linhas publicadas", "Diferença"], linhas,
       fonte="Autoria própria, a partir das camadas Bronze e Silver publicadas.")

print(f"\n{len(list(DESTINO.glob('*.tex')))} tabela(s) geradas.")
