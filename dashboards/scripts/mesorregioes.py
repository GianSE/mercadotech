"""
Mesorregião de cada município, para o mapa descer de estado para região do
estado ("Norte Pioneiro Paranaense") antes de chegar ao município.

A fonte é a API de localidades do IBGE: uma requisição devolve os 5.570
municípios com a microrregião e, dentro dela, a mesorregião. É referência
estática (a divisão é de 1990 e não muda), então fica no site como o contorno
dos estados, em public/geo, e não na Gold.

A chave é o código de 6 dígitos, o mesmo da RAIS (o IBGE usa 7: o sétimo é o
dígito verificador).

Uso:
    python scripts/mesorregioes.py
"""
import gzip
import json
import urllib.request
from pathlib import Path

URL = "https://servicodados.ibge.gov.br/api/v1/localidades/municipios"
DESTINO = Path(__file__).resolve().parents[1] / "public" / "geo" / "mesorregioes.json"


def main() -> None:
    req = urllib.request.Request(URL, headers={"User-Agent": "mercadotech"})
    with urllib.request.urlopen(req, timeout=120) as r:
        bruto = r.read()
    # O IBGE às vezes responde comprimido sem avisar no cabeçalho.
    if bruto[:2] == b"\x1f\x8b":
        bruto = gzip.decompress(bruto)
    municipios = json.loads(bruto.decode("utf-8"))

    mesos: dict[str, str] = {}
    por_municipio: dict[str, str] = {}
    for m in municipios:
        meso = (m.get("microrregiao") or {}).get("mesorregiao")
        if not meso:
            continue
        mesos[str(meso["id"])] = meso["nome"]
        por_municipio[str(m["id"])[:6]] = str(meso["id"])

    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(json.dumps({"fonte": URL, "mesorregioes": mesos, "municipios": por_municipio},
                                  ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(por_municipio):,} municípios em {len(mesos)} mesorregiões -> {DESTINO}")


if __name__ == "__main__":
    main()
