"""
Previsão do saldo mensal de emprego em tecnologia (SARIMA).

O QUE DECIDE SE O MODELO PRESTA
-------------------------------
Não é o AIC, e não é o ajuste ao passado. É bater um BASELINE INGÊNUO fora da
amostra. A série tem sazonalidade forte — dezembro é sempre negativo —, e por
isso a regra "o saldo deste mês será igual ao do mesmo mês do ano passado"
(naive sazonal) já acerta bastante. Um SARIMA que não supere isso não está
capturando nada além da sazonalidade, e usá-lo daria falsa autoridade a um
número que a média histórica já daria.

Por isso a seleção aqui é por VALIDAÇÃO EM ORIGEM MÓVEL, não por AIC:
treina até um ponto, prevê 12 meses, anda o ponto para frente, repete. É o
mais próximo que se consegue de "como o modelo teria se saído se estivesse no
ar" — e é a única forma de flagrar o modelo que decora o passado.

INTERVALO, NÃO PONTO
--------------------
A previsão sai com intervalo de confiança e é assim que deve ser lida. Saldo
mensal de emprego é ruidoso: o intervalo costuma ser largo, e esconder isso
atrás de um número único seria o erro mais grave que este módulo poderia
cometer. Um TCC que diga "o saldo em dezembro de 2026 será -4.200" está
errado; "estará entre -9.000 e +600, com 80% de confiança" está certo.

Uso:
    python -m ciencia_dados.previsao_saldo
    python -m ciencia_dados.previsao_saldo --horizonte 18 --origens 6
"""
import argparse
import sys
import warnings

import numpy as np
import pandas as pd

from ciencia_dados import serie as sr

warnings.simplefilter("ignore")

# Grade pequena de propósito. Com 234 pontos e uma origem móvel de várias
# dobras, uma grade grande encontraria por acaso o modelo que se sai bem no
# teste — que é o mesmo overfitting, só que na validação.
CANDIDATOS = [
    ((1, 0, 1), (1, 1, 1, 12)),
    ((2, 0, 1), (1, 1, 1, 12)),
    ((1, 1, 1), (0, 1, 1, 12)),
    ((0, 1, 1), (0, 1, 1, 12)),
    ((2, 1, 2), (1, 1, 1, 12)),
    ((1, 0, 0), (1, 1, 0, 12)),
]


def naive_sazonal(treino: pd.Series, h: int) -> np.ndarray:
    """O valor do mesmo mês do ano anterior. É o piso a ser superado."""
    ultimos = treino.iloc[-12:].to_numpy()
    return np.array([ultimos[i % 12] for i in range(h)])


def _ajustar(treino: pd.Series, ordem, sazonal):
    from statsmodels.tsa.statespace.sarimax import SARIMAX

    # A convergência falha em algumas dobras, e é esperado: ordens altas em
    # janelas curtas não têm dado suficiente. O aviso não é silenciado por
    # conveniência — o modelo que não converge simplesmente perde na
    # validação, que é onde a decisão acontece. Deixar o aviso passar
    # encheria o relatório de ruído e esconderia o que importa.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        modelo = SARIMAX(treino, order=ordem, seasonal_order=sazonal,
                         enforce_stationarity=False, enforce_invertibility=False)
        return modelo.fit(disp=False)


# Prophet, o modelo previsto na proposta do TCC 1, entra na MESMA validação do
# SARIMA, contra o mesmo baseline, com uma grade tão pequena quanto a dele: só
# a flexibilidade da tendência varia (changepoint_prior_scale; 0,05 é o padrão
# da biblioteca). Uma grade maior seria o mesmo sobreajuste na validação que a
# grade do SARIMA evita.
PROPHET_ESCALAS = (0.01, 0.05, 0.5)


def _nome_prophet(escala: float) -> str:
    return f"Prophet(tendência {escala:g})"


def _prophet(treino: pd.Series, escala: float = 0.05, intervalo: float = 0.80):
    """Prophet com sazonalidade anual aditiva (o saldo é negativo em parte dos meses)."""
    import logging

    from prophet import Prophet

    logging.getLogger("cmdstanpy").setLevel(logging.WARNING)
    modelo = Prophet(yearly_seasonality=True, weekly_seasonality=False,
                     daily_seasonality=False, seasonality_mode="additive",
                     changepoint_prior_scale=escala, interval_width=intervalo)
    return modelo.fit(pd.DataFrame({"ds": treino.index, "y": treino.to_numpy()}))


def _prever_prophet(modelo, h: int) -> pd.DataFrame:
    futuro = modelo.make_future_dataframe(periods=h, freq="MS", include_history=False)
    return modelo.predict(futuro).set_index("ds")[["yhat", "yhat_lower", "yhat_upper"]]


def _candidatos():
    """(nome, função treino,h -> previsão): baseline, SARIMAs e Prophet."""
    yield "naive sazonal", naive_sazonal
    for o, s in CANDIDATOS:
        yield f"SARIMA{o}{s}", (lambda t, h, o=o, s=s: _ajustar(t, o, s).forecast(h).to_numpy())
    for e in PROPHET_ESCALAS:
        yield _nome_prophet(e), (lambda t, h, e=e: _prever_prophet(_prophet(t, e), h)["yhat"].to_numpy())


def validar(y: pd.Series, h: int = 12, origens: int = 5) -> pd.DataFrame:
    """
    Origem móvel: treina até T, prevê h, anda 12 meses, repete.

    O baseline entra na MESMA tabela e nas mesmas dobras. Comparar contra um
    baseline avaliado de outro jeito seria comparar com nada.
    """
    fim = len(y)
    cortes = [fim - h - 12 * k for k in range(origens)][::-1]
    cortes = [c for c in cortes if c > 36]

    linhas = []
    for nome, prever_fn in _candidatos():
        erros_abs, erros_qua = [], []
        falhou = False
        for corte in cortes:
            treino, teste = y.iloc[:corte], y.iloc[corte:corte + h]
            if len(teste) < h:
                continue
            try:
                pred = prever_fn(treino, h)
            except Exception:
                falhou = True
                break
            erro = teste.to_numpy() - pred
            erros_abs.append(np.abs(erro))
            erros_qua.append(erro ** 2)

        if falhou or not erros_abs:
            continue
        linhas.append({
            "modelo": nome,
            "dobras": len(erros_abs),
            "mae": float(np.mean(np.concatenate(erros_abs))),
            "rmse": float(np.sqrt(np.mean(np.concatenate(erros_qua)))),
        })

    df = pd.DataFrame(linhas).sort_values("mae").reset_index(drop=True)
    base = df.loc[df.modelo == "naive sazonal", "mae"]
    if len(base):
        # Ganho sobre o baseline: negativo significa que o modelo é PIOR que a
        # regra ingênua, e a coluna existe para que isso não passe batido.
        df["ganho_vs_naive_%"] = ((base.iloc[0] - df["mae"]) / base.iloc[0] * 100).round(1)
    return df


def prever(y: pd.Series, ordem, sazonal, h: int = 12, alpha: float = 0.20):
    """Previsão com intervalo. `alpha=0.20` dá 80% — o usual em conjuntura."""
    ajuste = _ajustar(y, ordem, sazonal)
    fc = ajuste.get_forecast(steps=h)
    media = fc.predicted_mean
    ic = fc.conf_int(alpha=alpha)
    saida = pd.DataFrame({
        "previsao": media,
        "inferior": ic.iloc[:, 0],
        "superior": ic.iloc[:, 1],
    })
    return saida, ajuste


def prever_vencedor(y: pd.Series, modelo: str, h: int = 18, alpha: float = 0.20) -> pd.DataFrame:
    """Previsão com intervalo pelo modelo que venceu a validação, seja qual for.

    Se o vencedor for o próprio baseline, a projeção usa o primeiro SARIMA da
    grade: o baseline não tem intervalo, e o placar já diz que nenhum modelo o
    superou — a leitura honesta fica registrada lá.
    """
    escalas = {_nome_prophet(e): e for e in PROPHET_ESCALAS}
    if modelo in escalas:
        p = _prever_prophet(_prophet(y, escalas[modelo], intervalo=1 - alpha), h)
        return pd.DataFrame({"previsao": p["yhat"], "inferior": p["yhat_lower"],
                             "superior": p["yhat_upper"]})
    nomes = [f"SARIMA{o}{s}" for o, s in CANDIDATOS]
    ordem, sazonal = CANDIDATOS[nomes.index(modelo)] if modelo in nomes else CANDIDATOS[0]
    return prever(y, ordem, sazonal, h=h, alpha=alpha)[0]


def main() -> int:
    p = argparse.ArgumentParser(description="Prevê o saldo mensal de emprego em TI.")
    p.add_argument("--horizonte", type=int, default=12)
    p.add_argument("--origens", type=int, default=5)
    args = p.parse_args()

    print("=" * 72)
    print("  PREVISÃO DO SALDO MENSAL DE EMPREGO EM TECNOLOGIA")
    print("=" * 72)

    df = sr.carregar()
    y = df["saldo"].dropna()
    d = sr.diagnostico(df)

    print(f"\n📊 Série: {d['n']} meses, {d['inicio']:%Y-%m} a {d['fim']:%Y-%m}")
    print(f"   média {d['media']:,.0f} · desvio {d['desvio']:,.0f}")
    print(f"   ADF p={d['adf_p']:.4f} (H0: tem raiz unitária)")
    print(f"   KPSS p={d['kpss_p']:.4f} (H0: é estacionária)")
    veredito = ("estacionária" if d["adf_p"] < 0.05 and d["kpss_p"] > 0.05
                else "não estacionária" if d["adf_p"] > 0.05 and d["kpss_p"] < 0.05
                else "inconclusiva — os dois testes discordam")
    print(f"   -> {veredito}")

    print(f"\n🔀 A emenda de 2020 (competência declarada -> competência do fato)")
    print(f"   até 2019: média {d['media_antes_2020']:,.0f} · desvio {d['desvio_antes_2020']:,.0f}")
    print(f"   de 2020 : média {d['media_depois_2020']:,.0f} · desvio {d['desvio_depois_2020']:,.0f}")

    meses = ["jan", "fev", "mar", "abr", "mai", "jun",
             "jul", "ago", "set", "out", "nov", "dez"]
    print(f"\n📅 Sazonalidade: pior mês {meses[d['mes_pior'] - 1]} "
          f"({d['sazonal'][d['mes_pior']]:,.0f}), "
          f"melhor {meses[d['mes_melhor'] - 1]} ({d['sazonal'][d['mes_melhor']]:,.0f})")

    print(f"\n🧪 Validação em origem móvel (horizonte {args.horizonte}m, "
          f"{args.origens} origens)")
    placar = validar(y, h=args.horizonte, origens=args.origens)
    print(placar.to_string(index=False))

    vencedor = placar.iloc[0]
    if vencedor["modelo"] == "naive sazonal":
        print("\n⚠️  Nenhum SARIMA superou a regra ingênua fora da amostra.")
        print("    A leitura honesta é que a sazonalidade explica quase tudo, e")
        print("    a previsão publicável é a própria média sazonal. Usar um")
        print("    modelo mais complexo aqui só daria falsa autoridade.")
    else:
        print(f"\n✅ Escolhido: {vencedor['modelo']} — MAE {vencedor['mae']:,.0f}, "
              f"{vencedor['ganho_vs_naive_%']:+.1f}% vs baseline")

    previsao = prever_vencedor(y, vencedor["modelo"], h=args.horizonte)
    print(f"\n🔮 Próximos {args.horizonte} meses (intervalo de 80%)")
    print(f"{'mês':<10}{'previsão':>12}{'inferior':>12}{'superior':>12}")
    for idx, linha in previsao.iterrows():
        print(f"{idx:%Y-%m}  {linha['previsao']:>12,.0f}"
              f"{linha['inferior']:>12,.0f}{linha['superior']:>12,.0f}")

    total = previsao["previsao"].sum()
    faixa_inf = previsao["inferior"].sum()
    faixa_sup = previsao["superior"].sum()
    print(f"\n   Acumulado do horizonte: {total:,.0f} "
          f"(entre {faixa_inf:,.0f} e {faixa_sup:,.0f})")
    print("\n   O intervalo é largo porque a série é ruidosa. Ler o ponto")
    print("   isolado como previsão seria o erro que este módulo evita.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
