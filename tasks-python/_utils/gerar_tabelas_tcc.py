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
import re
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


# Fonte de cada tabela e figura: a base de onde vem o dado, com citação. O
# trabalho de agregação é do autor, mas o número é da RAIS ou do CAGED, e é
# isso que a fonte precisa dizer (ABNT NBR 14724: a fonte identifica a origem
# da informação, mesmo quando a elaboração é própria).
RAIS = "Elaborado pelo autor com dados da RAIS \\cite{RAIS2024}."
CAGED = "Elaborado pelo autor com dados do CAGED \\cite{CAGED2024}."
AMBAS = "Elaborado pelo autor com dados da RAIS e do CAGED \\cite{RAIS2024, CAGED2024}."
FONTES = {
    "tab-volumes.tex": "Elaborado pelo autor a partir dos repositórios de dados do projeto, com microdados da RAIS e do CAGED \\cite{RAIS2024, CAGED2024}.",
    "tab-linhas-camada.tex": AMBAS,
    "tab-artefato-ro.tex": RAIS,
    "tab-estoque-serie.tex": RAIS,
    "fig-estoque-serie.tex": RAIS,
    "tab-fases.tex": RAIS,
    "tab-lentes.tex": RAIS,
    "tab-lentes-evolucao.tex": RAIS,
    "tab-areas.tex": RAIS,
    "tab-uf.tex": RAIS,
    "tab-hiato.tex": RAIS,
    "fig-hiato-serie.tex": RAIS,
    "tab-previsao.tex": CAGED,
    "tab-nowcast.tex": AMBAS,
    "fig-nowcast-anos.tex": AMBAS,
    "tab-coerencia.tex": AMBAS,
    "tab-risco.tex": RAIS,
    "fig-risco.tex": RAIS,
    "tab-clusters.tex": AMBAS,
    "tab-cbos.tex": RAIS,
    "tab-reprodutibilidade-rais.tex": RAIS,
    "tab-reprodutibilidade.tex": AMBAS,
}


def tabela(nome: str, caption: str, rotulo: str, colunas: str,
           cabecalho: list[str], linhas: list[list[str]],
           fonte: str | None = None,
           nota: str = "", ambiente: str = "table") -> None:
    """Monta uma tabela ABNT com booktabs e grava o arquivo."""
    fonte = fonte or FONTES[nome]
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
       "tab:volumes", "lrr", ["Camada", "Arquivos", "Tamanho"], linhas)

# ------------------------------------------------- linhas por tabela
linhas = []
for t in TABELAS_TI:
    # count(*) sai do rodapé de cada arquivo: lê metadado, não dado.
    # Só o período analisado: a Silver de caged_ajustes guarda também 2003 a 2006.
    n = con.execute(f"SELECT count(*) FROM read_parquet({nuvem.fonte_silver_ti(t)}, union_by_name=true) "
                    f"WHERE ano_particao >= 2007").fetchone()[0]
    linhas.append([f"\\texttt{{{t.replace('_', chr(92) + '_')}}}", num(n)])
tabela("tab-linhas-camada.tex",
       "Registros no recorte de tecnologia, por tabela da camada tratada",
       "tab:linhas-camada", "lr", ["Tabela", "Registros"], linhas)

# ------------------------------------------------- artefato de Rondônia
# O funcionalismo estadual declarado como programador: medido na Silver, que
# ainda o contém, contra o estoque publicado na Gold, que já não o contém
# (ver escopo_tecnologia.ARTEFATO_RO).
from _utils import escopo_tecnologia as esc  # noqa: E402
FV = nuvem.fonte_silver_ti("rais_vinc")
grupo = esc.sql_grupo_artefato_ro()
linhas = [[ano(r[0]), num(r[1]), num(r[2]), pct(100 * r[1] / (r[1] + r[2]))] for r in con.execute(f"""
    SELECT a.ano, a.n, e.estoque
    FROM (SELECT ano, count(*) FILTER (WHERE vinculo_ativo_3112 = '1') AS n
          FROM read_parquet({FV}, union_by_name=true) WHERE {grupo}
          GROUP BY ano HAVING count(*) > {esc.LIMIAR_ARTEFATO}) a
    JOIN (SELECT ano, sum(estoque_3112) AS estoque
          FROM read_parquet('{G}/rais_estoque_anual.parquet') GROUP BY 1) e USING (ano)
    ORDER BY 1
""").fetchall()]
tabela("tab-artefato-ro.tex",
       "Servidores do governo de Rondônia declarados como programador de sistemas",
       "tab:artefato-ro", "lrrr",
       ["Ano", "Vínculos ativos do grupo", "Estoque de TI sem o grupo", "Peso do grupo"], linhas,
       nota="Grupo: Poder Executivo Estadual, Porto Velho, CBO 317110. Peso: parcela do estoque "
            "de TI que o grupo representaria se não fosse excluído. ")

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
           fonte: str | None = None) -> None:
    fonte = fonte or FONTES[nome]
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

# ------------------------------------------------- fases do crescimento
# A taxa média do período inteiro esconde ciclos opostos. As fronteiras são
# os anos em que o ritmo muda de sinal ou de patamar na série (recessão de
# 2015-2016, retomada, aceleração de 2021-2022) e o nome de cada fase é a
# leitura do texto, não um cálculo.
est = {int(r[0]): r[1] for r in serie}
FASES = [(2007, 2014, "Expansão"), (2014, 2017, "Recessão"), (2017, 2020, "Retomada"),
         (2020, 2022, "Aceleração pós-pandemia"), (2022, int(p1[0]), "Desaceleração")]
taxa = lambda a, b: ((est[b] / est[a]) ** (1 / (b - a)) - 1) * 100
total = est[int(p1[0])] - est[int(p0[0])]
linhas = [[f"{a}--{b}", nomef, pct(taxa(a, b)), num(est[b] - est[a]), pct(100 * (est[b] - est[a]) / total, 0)]
          for a, b, nomef in FASES]
linhas.append([f"\\textbf{{{ano(p0[0])}--{ano(p1[0])}}}", "\\textbf{Período inteiro}",
               f"\\textbf{{{pct(taxa(int(p0[0]), int(p1[0])))}}}", f"\\textbf{{{num(total)}}}", "\\textbf{100\\%}"])
tabela("tab-fases.tex", "Ritmo do crescimento do estoque de TI, por fase",
       "tab:fases", "llrrr",
       ["Período", "Fase", "Ritmo anual", "Vínculos ganhos", "Parcela do crescimento"], linhas,
       nota="Ritmo anual: taxa composta de crescimento do estoque em 31/12. ")

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

# A mesma divisão no tempo: a fotografia de um ano mostra a maioria fora das
# empresas de TI, a série mostra para onde ela se move.
ANOS_LENTE = (2007, 2014, 2020, ANO)
linhas = [[ano(r[0]), num(r[1]), num(r[2]), num(r[3]), pct(r[4]), num(r[5], 2), num(r[6], 2)]
          for r in con.execute(f"""
    SELECT e.ano, e.dentro, e.fora, e.outra, 100.0 * e.fora / (e.fora + e.dentro),
           md.mediana_sm, mf.mediana_sm
    FROM (SELECT ano,
                 sum(estoque_3112) FILTER (WHERE ocupacao_ti AND setor_ti)     AS dentro,
                 sum(estoque_3112) FILTER (WHERE ocupacao_ti AND NOT setor_ti) AS fora,
                 sum(estoque_3112) FILTER (WHERE setor_ti AND NOT ocupacao_ti) AS outra
          FROM read_parquet('{G}/rais_setor_vs_ocupacao.parquet')
          WHERE ano IN {ANOS_LENTE} GROUP BY 1) e
    JOIN read_parquet('{G}/rais_mediana.parquet') md
      ON md.ano = e.ano AND md.recorte = 'lente' AND md.grupo = 'dentro'
    JOIN read_parquet('{G}/rais_mediana.parquet') mf
      ON mf.ano = e.ano AND mf.recorte = 'lente' AND mf.grupo = 'fora'
    ORDER BY 1
""").fetchall()]
tabela("tab-lentes-evolucao.tex", "Profissionais de TI dentro e fora das empresas de TI ao longo do tempo",
       "tab:lentes-evolucao", "lrrrrrr",
       ["Ano", "Dentro", "Fora", "Outra ocupação", "\\% fora", "Mediana dentro", "Mediana fora"], linhas,
       nota="Dentro e fora: profissionais de TI em empresa de TI e fora dela. Outra ocupação: "
            "quem trabalha em empresa de TI sem ocupação de TI. \\% fora: parcela dos profissionais "
            "de TI que está fora das empresas de TI. Medianas em salários mínimos. ")

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

# A trajetória do hiato bruto, ano a ano: a tabela acima mostra três pontos, e
# o hiato de gênero muda de sinal entre eles.
hiato = con.execute(f"SELECT ano, comparacao, hiato_pct FROM read_parquet('{G}/hiato_serie.parquet') ORDER BY ano").df()
a0, a1 = int(hiato["ano"].min()), int(hiato["ano"].max())
ESTILOS = {"Branca vs Parda": "very thick, black!85, mark=*, mark size=1.1pt",
           "Branca vs Preta": "thick, black!55, dashed, mark=o, mark size=1.1pt",
           "Homem vs Mulher": "thick, black!85, densely dotted, mark=square*, mark size=1.1pt"}
linhas_hiato = "\n".join(
    f"        \\addplot[{estilo}] coordinates {{{pontos((int(r.ano), round(r.hiato_pct, 1)) for r in hiato[hiato['comparacao'] == comp].itertuples())}}};\n"
    f"        \\addlegendentry{{{comp}}}"
    for comp, estilo in ESTILOS.items())
figura("fig-hiato-serie.tex", f"Hiato salarial bruto por raça/cor e por sexo, {a0}--{a1}",
       "fig:hiato-serie", f"""    \\begin{{tikzpicture}}
    \\begin{{axis}}[{EIXO}, width=0.85\\textwidth, height=6.2cm, ylabel={{Hiato bruto (\\%)}},
            xmin={a0}, xmax={a1}, xtick distance=2,
            x tick label style={{/pgf/number format/1000 sep={{}}}},
            legend style={{font=\\footnotesize, at={{(0.03,0.40)}}, anchor=west, draw=none, fill=white}}]
        \\addplot[black!40, thin, forget plot] coordinates {{({a0},0) ({a1},0)}};
{linhas_hiato}
    \\end{{axis}}
    \\end{{tikzpicture}}""",
       nota="Diferença percentual da remuneração média do primeiro grupo sobre a do segundo; "
            "negativo: o segundo grupo ganha mais. ")

# ------------------------------------------------- previsao
# "Prophet(tendência 0.01)" -> vírgula decimal no texto.
modelo_tex = lambda m: m.replace("0.", "0,") if m.startswith("Prophet") else m
linhas = [[f"\\texttt{{{modelo_tex(r[0])}}}", num(r[1]), num(r[2]), num(r[3]), pct(r[4])]
          for r in con.execute(f"""
    SELECT modelo, dobras, mae, rmse, \"ganho_vs_naive_%\"
    FROM read_parquet('{G}/previsao_placar.parquet') ORDER BY mae
""").fetchall()]
tabela("tab-previsao.tex",
       "Desempenho dos modelos na validação de origem móvel",
       "tab:previsao", "lrrrr",
       ["Modelo", "Dobras", "MAE", "RMSE", "Ganho sobre o ingênuo"], linhas)

# ------------------------------------------------- nowcast
# Retrospectiva: cada ano, de 2014 em diante, estimado só com os anteriores. O
# último ano retido sozinho é o melhor caso, não o típico; a tabela mostra a
# média, a mediana, o pior ano e o último ano de cada estimador.
try:
    ret = con.execute(f"SELECT ano, estimador, erro_pct FROM read_parquet('{G}/nowcast_retrospectiva_anos.parquet')").df()
except Exception:
    # Gold publicada antes da tabela ano a ano: o mesmo cálculo, a partir dos pares.
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "3-gold"))
    from ciencia_dados import nowcast_estoque as nc
    pares = con.execute(f"SELECT * FROM read_parquet('{G}/nowcast_pares.parquet') ORDER BY ano").df()
    ret = nc.retrospectiva_anos(pares)[["ano", "estimador", "erro_pct"]]
ret["abs"] = ret["erro_pct"].abs()
ano0, ult = int(ret["ano"].min()), int(ret["ano"].max())
res = ret.groupby("estimador").agg(media=("abs", "mean"), mediana=("abs", "median")).reset_index()
pior = ret.loc[ret.groupby("estimador")["abs"].idxmax(), ["estimador", "ano", "erro_pct"]]
fim = ret[ret["ano"] == ult][["estimador", "erro_pct"]].rename(columns={"erro_pct": "erro_fim"})
res = res.merge(pior, on="estimador").merge(fim, on="estimador").sort_values("media")
tabela("tab-nowcast.tex",
       f"\\textit{{Nowcast}} do estoque: erro de cada estimador com cada ano retido, {ano0}--{ult}",
       "tab:nowcast", "lrrrr",
       ["Estimador", "Erro médio", "Erro mediano", "Maior erro (ano)", f"Erro em {ult}"],
       [[r.estimador, pct(r.media, 2), pct(r.mediana, 2), f"{pct(r.erro_pct, 1)} ({int(r.ano)})", pct(r.erro_fim, 2)]
        for r in res.itertuples()],
       nota="Erros em \\% do estoque observado; médio e mediano em valor absoluto. Cada ano é estimado só com os anteriores. ")

melhor = res.iloc[0].estimador
erros = lambda n: pontos((int(a), round(e, 2)) for a, e in
                         ret[ret["estimador"] == n].sort_values("ano")[["ano", "erro_pct"]].itertuples(index=False))
figura("fig-nowcast-anos.tex", f"Erro do \\textit{{nowcast}} em cada ano retido, {ano0}--{ult}",
       "fig:nowcast-anos", f"""    \\begin{{tikzpicture}}
    \\begin{{axis}}[{EIXO}, width=0.85\\textwidth, height=6cm, ylabel={{Erro (\\% do estoque)}},
            xmin={ano0}, xmax={ult}, xtick distance=1,
            x tick label style={{/pgf/number format/1000 sep={{}}, rotate=45, anchor=north east}},
            legend style={{font=\\footnotesize, at={{(0.02,0.03)}}, anchor=south west, draw=none, fill=white}}]
        \\addplot[black!40, thin, forget plot] coordinates {{({ano0},0) ({ult},0)}};
        \\addplot[very thick, black!85, mark=*, mark size=1.3pt] coordinates {{{erros(melhor)}}};
        \\addlegendentry{{{melhor}}}
        \\addplot[thick, black!45, dashed, mark=o, mark size=1.3pt] coordinates {{{erros('ingênuo (sem mudança)')}}};
        \\addlegendentry{{ingênuo (sem mudança)}}
    \\end{{axis}}
    \\end{{tikzpicture}}""",
       nota="Erro positivo: o estimador superestimou o estoque. ")

# ------------------------------------- coerência entre a RAIS e o CAGED
# Por que a variação do estoque da RAIS não é igual ao saldo do CAGED. Nos
# vínculos CLT da RAIS (os que o CAGED cobre), a variação se decompõe, sem
# resto, em duas parcelas: os vínculos que entram ou saem da TI sem contratação
# nem demissão (troca de ocupação ou de atividade da empresa, transferência
# entre estabelecimentos) e as admissões menos os desligamentos da própria
# RAIS. A segunda se compara com o CAGED. Lê a Silver da RAIS (mês de
# admissão, situação em 31/12, tipo de vínculo e de admissão), não a Gold:
# a Gold não guarda esses campos.
CLT = "('10','15','20','25','55','60','65','70','75')"
ADMITIDO = "try_cast(mes_admissao AS INT) BETWEEN 1 AND 12"
ATIVO = "vinculo_ativo_3112::VARCHAR IN ('1', '01')"
TRANSF_ENTRA = "try_cast(tipo_admissao AS INT) IN (3, 4)"
TRANSF_SAI = "try_cast(motivo_desligamento AS INT) IN (30, 31)"
rais_clt = con.execute(f"""
    SELECT ano_particao::INT AS ano,
           count(*) FILTER (WHERE {ATIVO}) AS estoque,
           count(*) FILTER (WHERE NOT ({ADMITIDO})) AS vindos,
           count(*) FILTER (WHERE {ADMITIDO} AND NOT ({TRANSF_ENTRA})) AS adm,
           count(*) FILTER (WHERE {ADMITIDO} AND {TRANSF_ENTRA}) AS transf_entra,
           count(*) FILTER (WHERE NOT ({ATIVO}) AND NOT ({TRANSF_SAI})) AS desl,
           count(*) FILTER (WHERE NOT ({ATIVO}) AND {TRANSF_SAI}) AS transf_sai
    FROM read_parquet('hf://datasets/{nuvem.REPO_SILVER_TI_RAIS}/rais_vinc/*/*.parquet', hive_partitioning = true)
    WHERE tipo_vinculo::VARCHAR IN {CLT}
    GROUP BY 1 ORDER BY 1""").df()
caged_ano = con.execute(f"""
    SELECT year(mes)::INT AS ano, sum(admissoes) AS adm_caged, sum(desligamentos) AS desl_caged, sum(saldo) AS saldo_caged
    FROM read_parquet('{G}/serie_mensal.parquet') GROUP BY 1 HAVING count(*) = 12""").df()
co = rais_clt.merge(caged_ano, on="ano")
co["variacao"] = co["estoque"].diff()
co["sem_contratacao"] = co["vindos"] - co["estoque"].shift(1) + co["transf_entra"] - co["transf_sai"]
co["fluxo_rais"] = co["adm"] - co["desl"]
co = co[co["variacao"].notna()]
assert (co["sem_contratacao"] + co["fluxo_rais"] == co["variacao"]).all(), "a decomposição da RAIS não fecha"
# Os períodos acompanham a mudança de regime: até 2018, os vínculos saem da TI
# sem demissão; de 2019 a 2022, transição para o eSocial e expansão, entram.
periodos = [(2008, 2018), (2019, 2022), (2023, int(co["ano"].max())), (int(co["ano"].min()), int(co["ano"].max()))]
linhas_co = []
for a, b in periodos:
    w = co[(co["ano"] >= a) & (co["ano"] <= b)]
    linhas_co.append([f"{a}--{b}" if (a, b) != periodos[-1] else f"\\textbf{{Total, {a}--{b}}}",
                      num(w["variacao"].sum()), num(w["saldo_caged"].sum()), num(w["variacao"].sum() - w["saldo_caged"].sum()),
                      num(w["sem_contratacao"].sum()), num(w["fluxo_rais"].sum() - w["saldo_caged"].sum()),
                      num(w["adm"].sum() / w["adm_caged"].sum(), 3), num(w["desl"].sum() / w["desl_caged"].sum(), 3)])
tabela("tab-coerencia.tex",
       f"Variação do estoque da RAIS e saldo do CAGED, vínculos CLT de TI, {periodos[-1][0]}--{periodos[-1][1]}",
       "tab:coerencia", "lrrrrrrr",
       ["Período", "Var. RAIS", "Saldo CAGED", "Diferença", "Sem contratação", "Fluxos", "Adm.", "Desl."],
       linhas_co,
       nota="Var. RAIS: variação do estoque CLT em 31/12. A diferença para o saldo do CAGED se divide, sem resto, "
            "em Sem contratação (vínculos que passam a contar ou deixam de contar como TI sem admissão nem desligamento, "
            "inclusive transferências entre estabelecimentos) e Fluxos (admissões menos desligamentos da RAIS, "
            "menos o saldo do CAGED). Adm. e Desl.: admissões e desligamentos da RAIS sobre os do CAGED, "
            "sem as transferências. ")

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
       nota="")

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
# Os nomes que a Gold toma do dicionário do CAGED vêm Com Cada Palavra Em
# Maiúscula; aqui ficam no padrão da RAIS (o mesmo ajuste que a Gold passa a
# fazer na reserva — repetido para a tabela não depender da rodada).
_LIGACOES = re.compile(r" (De|Da|Do|Das|Dos|E|Em|Para|Com|Ou|No|Na|Nos|Nas|Sob)(?= )")


def _como_rais(nome: str) -> str:
    return _LIGACOES.sub(lambda m: " " + m.group(1).lower(), nome).replace("(Dpo)", "(DPO)")


linhas = [[f"\\texttt{{{r[0]}}}", f"\\texttt{{{r[1]}}}", _como_rais(r[2])[:52], r[3], num(r[4])]
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
       ["Ano", "Arquivos brutos", "Linhas no dado bruto", "Linhas publicadas", "Diferença"], linhas)

# ------------------------------- reprodutibilidade, por tabela (RAIS e CAGED)
# Soma da recontagem ano a ano das duas bases, uma linha por tabela tratada.
# O CAGED vem de _utils/reprodutibilidade_caged.py (auditoria/reprodutibilidade_caged.csv).
resumo = con.execute(f"""
    SELECT 'rais_vinc' AS tabela, min(ano) AS de, max(ano) AS ate, sum(arquivos_bronze) AS arq,
           sum(linhas_no_bruto) AS bruto, sum(linhas_publicadas) AS pub, sum(diferenca) AS dif
    FROM read_csv('{G}/auditoria/reprodutibilidade_rais.csv')
    UNION ALL
    SELECT tabela, min(ano), max(ano), sum(arquivos_bronze), sum(linhas_no_bruto), sum(linhas_publicadas), sum(diferenca)
    FROM read_csv('{G}/auditoria/reprodutibilidade_caged.csv') GROUP BY tabela
""").fetchall()
ordem = ["rais_vinc", "caged_mov", "caged_for", "caged_exc", "caged_old", "caged_ajustes"]
resumo.sort(key=lambda r: ordem.index(r[0]) if r[0] in ordem else 99)
linhas = [[f"\\texttt{{{r[0].replace('_', chr(92) + '_')}}}", f"{ano(r[1])}--{ano(r[2])}", num(r[3]), num(r[4]), num(r[5]), num(r[6])]
          for r in resumo]
linhas.append(["\\textbf{Total}", "", num(sum(r[3] for r in resumo)), num(sum(r[4] for r in resumo)),
               num(sum(r[5] for r in resumo)), num(sum(r[6] for r in resumo))])
tabela("tab-reprodutibilidade.tex",
       "Recontagem do recorte de tecnologia a partir do dado bruto, por tabela",
       "tab:reprodutibilidade", "llrrrr",
       ["Tabela", "Anos", "Arquivos", "Linhas no dado bruto", "Linhas publicadas", "Diferença"], linhas)

print(f"\n{len(list(DESTINO.glob('*.tex')))} tabela(s) geradas.")
