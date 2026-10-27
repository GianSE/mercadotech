"""
Roda os modelos e grava os resultados na gold, para o dashboard só ler.

POR QUE NÃO CALCULAR NO DASHBOARD
---------------------------------
Os quatro modelos custam minutos, não milissegundos:

    previsão       ~2 min   (30 ajustes SARIMA na validação em origem móvel)
    sobrevivência  ~3 min   (1,2 milhão de vínculos, tábua por grupo)
    nowcast        ~1 min   (depende da previsão)
    hiato ano a ano ~10 min (57 decomposições, três regressões cada)

Um dashboard que recalculasse isso a cada filtro seria inutilizável, e o cache
do Streamlit não resolve: ele expira, e a primeira pessoa a abrir a página
pagaria os quinze minutos.

Modelo é coisa de build, não de request. Aqui eles rodam uma vez e viram
tabela; o dashboard lê tabela.

O QUE FICA GRAVADO
------------------
Resultado, não modelo. Não há pickle de SARIMA nem de k-means — o que o
dashboard precisa é a previsão com intervalo, a tábua, os grupos. Guardar
objeto serializado amarraria o dashboard à versão da biblioteca e quebraria em
silêncio numa atualização.

Uso:
    python -m ciencia_dados.materializar
    python -m ciencia_dados.materializar --pular hiato
"""
import argparse
import sys
import time
import warnings

import pandas as pd

from _utils.nuvem import conectar_duckdb

warnings.simplefilter("ignore")

# Modelo escolhido pela etapa de previsão; o nowcast projeta os meses que
# faltam do ano com o MESMO modelo.
_MODELO_PROJECAO: str | None = None


def _gravar(con, df: pd.DataFrame, nome: str) -> int:
    from _utils import nuvem

    con.register("_saida", df)
    nuvem.DIR_GOLD_LOCAL.mkdir(parents=True, exist_ok=True)
    destino = nuvem.caminho_gold(nome)
    con.execute(f"""
        COPY (SELECT * FROM _saida) TO '{destino}' (
            FORMAT PARQUET,
            COMPRESSION 'ZSTD',
            COMPRESSION_LEVEL 3)
    """)
    con.unregister("_saida")
    return len(df)


def previsao(con) -> dict[str, pd.DataFrame]:
    """Previsão do saldo mensal, mais o placar da validação."""
    from ciencia_dados import previsao_saldo as ps
    from ciencia_dados import serie as sr

    df = sr.carregar(con)
    y = df["saldo"].dropna()
    placar = ps.validar(y, h=12, origens=5)

    # O rótulo é o do modelo que de fato projeta (ver modelo_para_projecao).
    global _MODELO_PROJECAO
    _MODELO_PROJECAO = ps.modelo_para_projecao(placar)
    prev = ps.prever_vencedor(y, _MODELO_PROJECAO, h=18)
    prev = prev.reset_index().rename(columns={"index": "mes"})
    prev.columns = ["mes", "previsao", "inferior", "superior",
                    "acum_previsao", "acum_inferior", "acum_superior"]
    prev["modelo"] = _MODELO_PROJECAO

    # A série observada vai junto: o gráfico precisa do histórico e da
    # projeção na mesma escala, e buscá-los de tabelas diferentes convidaria a
    # divergência entre o que o modelo viu e o que o gráfico mostra.
    observado = df.reset_index()[["mes", "saldo", "admissoes", "desligamentos"]]
    return {"previsao_saldo": prev,
            "previsao_placar": placar,
            "serie_mensal": observado}


def sobrevivencia(con, ano: int) -> dict[str, pd.DataFrame]:
    from ciencia_dados import sobrevivencia as sv

    df = sv.carregar(ano, con=con)
    tabelas = [sv.tabua_periodo(df).assign(recorte="todos")]
    for coluna in ("sexo", "area", "setor", "porte"):
        t = sv.tabua_periodo(df, coluna)
        if not t.empty:
            tabelas.append(t.assign(recorte=coluna))
    tabua = pd.concat(tabelas, ignore_index=True)
    tabua["ano"] = ano

    risco = sv.risco_por_faixa(df)
    risco["ano"] = ano

    amostra = df.sample(min(150_000, len(df)), random_state=42)
    multivariado = sv.risco_multivariado(amostra)
    multivariado["ano"] = ano
    return {"sobrevivencia_tabua": tabua,
            "sobrevivencia_risco": risco,
            "sobrevivencia_multivariado": multivariado}


def nowcast(con) -> dict[str, pd.DataFrame]:
    from ciencia_dados import nowcast_estoque as nc

    df = nc.montar(con)
    retro = nc.retrospectiva(df)
    ano_teste = int(df["ano"].max())
    detalhe = nc.detalhe_ano(df, ano_teste).assign(ano_teste=ano_teste)
    proj = nc.projetar_ano_corrente(df, con, modelo=_MODELO_PROJECAO)
    return {"nowcast_retrospectiva": retro,
            "nowcast_retrospectiva_anos": nc.retrospectiva_anos(df),
            "nowcast_ano_retido": detalhe,
            "nowcast_projecao": pd.DataFrame([proj]) if proj else pd.DataFrame(),
            "nowcast_pares": df}


ETAPAS = {
    "previsao": previsao,
    "sobrevivencia": sobrevivencia,
    "nowcast": nowcast,
}


def main() -> int:
    p = argparse.ArgumentParser(description="Materializa os modelos na gold.")
    p.add_argument("--pular", nargs="*", default=[], choices=list(ETAPAS) + ["hiato"])
    p.add_argument("--ano-sobrevivencia", type=int, default=2024)
    args = p.parse_args()

    con = conectar_duckdb()
    con.execute("SET enable_progress_bar=false")
    con.execute("SET threads=4")

    print("=" * 74)
    print("  MATERIALIZAÇÃO DOS MODELOS NA GOLD")
    print("=" * 74)

    total = 0
    falhas: list[str] = []
    for nome, fn in ETAPAS.items():
        if nome in args.pular:
            print(f"\n⏭️  {nome} (pulado)")
            continue
        print(f"\n🔨 {nome}")
        inicio = time.time()
        try:
            saidas = (fn(con, args.ano_sobrevivencia)
                      if nome == "sobrevivencia" else fn(con))
            for tabela, df in saidas.items():
                if df is None or df.empty:
                    print(f"   ⚠️  {tabela}: vazio, não gravado")
                    continue
                n = _gravar(con, df, tabela)
                total += 1
                print(f"   ✅ {tabela}: {n:,} linha(s)")
            print(f"   ⏱️  {time.time() - inicio:.0f}s")
        except Exception as e:
            falhas.append(nome)
            print(f"   ❌ falhou: {str(e)[:200]}")

    if "hiato" not in args.pular:
        print(f"\n🔨 hiato (série completa — o mais demorado)")
        inicio = time.time()
        try:
            from ciencia_dados import hiato_salarial as hs

            tabela = hs.serie(range(2007, 2026), con)
            if not tabela.empty:
                total += 1
                print(f"   ✅ hiato_serie: {_gravar(con, tabela, 'hiato_serie'):,} linha(s)")
            print(f"   ⏱️  {time.time() - inicio:.0f}s")
        except Exception as e:
            falhas.append("hiato")
            print(f"   ❌ falhou: {str(e)[:200]}")

    from _utils import nuvem

    print(f"\n🏁 {total} tabela(s) materializada(s) em {nuvem.DIR_GOLD_LOCAL}")
    # Etapa que falha não pode virar "sucesso": sem isto, a Gold seria
    # publicada com a tabela antiga daquela etapa e ninguém saberia.
    if falhas:
        print(f"❌ {len(falhas)} etapa(s) falharam: {', '.join(falhas)} — nada deve ser publicado.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
