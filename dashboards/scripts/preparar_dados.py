"""
Prepara os dados que o site embarca: a Gold publicada no Hugging Face.

A Gold no Hub é a fonte oficial — inclusive os cubos do CAGED
(caged_cubo, caged_ocupacao), que o pipeline monta e publica junto
(tasks-python/3-gold/gold_caged/cubos.py). O site guarda uma CÓPIA dela no
build (public/dados/), como medida de segurança: o DuckDB-WASM consulta os
arquivos na mesma origem do site, e o dashboard abre mesmo com o Hub fora do
ar — no Cloudflare ou na máquina local.

Se a Gold publicada ainda não tiver os cubos (o pipeline não rodou desde que
eles passaram a ser publicados), monta-os aqui a partir da Silver do CAGED,
com a mesma função que o pipeline usa.

Uso (na pasta dashboards/):
    python scripts/preparar_dados.py
"""
import json
import re
import os
import shutil
import sys
import tempfile
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import duckdb

RAIZ = Path(__file__).resolve().parents[1]
DESTINO = RAIZ / "public" / "dados"
DESTINO_EXT = RAIZ / "public" / "duckdb-ext"
WASM_DUCKDB = RAIZ / "node_modules" / "@duckdb" / "duckdb-wasm" / "dist" / "duckdb-eh.wasm"
sys.path.insert(0, str(RAIZ.parent / "tasks-python"))
sys.path.insert(0, str(RAIZ.parent / "tasks-python" / "3-gold"))

from gold_caged import cubos  # noqa: E402

REPO_GOLD = "Gianpedro/gold-analise-mercado-ti"
REPO_SILVER_CAGED = "Gianpedro/silver-caged-ti"
HF = "https://huggingface.co"

def _requisicao(url: str) -> urllib.request.Request:
    cabecalhos = {"User-Agent": "dashboards-mercado-ti"}
    # Opcional: autenticado, o limite de taxa do Hub é maior.
    if token := (os.getenv("HF_TOKEN") or "").strip():
        cabecalhos["Authorization"] = f"Bearer {token}"
    return urllib.request.Request(url, headers=cabecalhos)


def _listar(repo: str) -> list[dict]:
    with urllib.request.urlopen(_requisicao(f"{HF}/api/datasets/{repo}/tree/main")) as r:
        return json.load(r)


def _baixar(repo: str, caminho: str, destino: Path) -> None:
    url = f"{HF}/datasets/{repo}/resolve/main/{caminho}"
    for espera in (5, 15, 45, None):
        try:
            with urllib.request.urlopen(_requisicao(url)) as r, open(destino, "wb") as f:
                shutil.copyfileobj(r, f)
            return
        except Exception as e:
            if espera is None:
                raise
            print(f"   ⏳ {caminho}: {str(e)[:60]} — nova tentativa em {espera}s")
            time.sleep(espera)


def baixar_gold() -> list[str]:
    nomes = []
    for item in _listar(REPO_GOLD):
        if not item["path"].endswith(".parquet"):
            continue
        _baixar(REPO_GOLD, item["path"], DESTINO / item["path"])
        nomes.append(item["path"].removesuffix(".parquet"))
    print(f"✅ gold: {len(nomes)} tabela(s)")
    return nomes


def montar_cubos() -> list[str]:
    """Plano B: os cubos a partir da Silver, quando a Gold ainda não os traz."""
    anuais = sorted(i["path"] for i in _listar(REPO_SILVER_CAGED)
                    if i["path"].startswith("caged_ti_") and i["path"].endswith(".parquet"))
    if not anuais:
        raise SystemExit("❌ silver-caged-ti sem arquivos caged_ti_<ano>.parquet "
                         "(rode a etapa Gold CAGED consolidado).")
    with tempfile.TemporaryDirectory() as tmp:
        for nome in anuais:
            _baixar(REPO_SILVER_CAGED, nome, Path(tmp) / nome)
        return cubos.montar(duckdb.connect(), f"{Path(tmp).as_posix()}/caged_ti_*.parquet", DESTINO)


def baixar_extensoes() -> None:
    """
    O DuckDB-WASM baixa a extensão de Parquet na hora de rodar, de
    extensions.duckdb.org. Uma cópia no site tira essa dependência (o site
    tenta a cópia primeiro e só recorre ao servidor oficial se ela falhar).

    O caminho leva a versão do MOTOR, que não é a do pacote npm. Ela só
    aparece dentro do .wasm, como a mais recente da tabela de versões que o
    motor sabe ler — é a maior vX.Y.Z do binário.
    """
    if not WASM_DUCKDB.exists():
        print("⚠️  node_modules sem @duckdb/duckdb-wasm (rode npm install): extensões puladas")
        return
    versoes = re.findall(rb"(?<![\w.])v(\d+)\.(\d+)\.(\d+)(?![\w.])", WASM_DUCKDB.read_bytes())
    versao = "v%d.%d.%d" % max(tuple(map(int, v)) for v in versoes)
    shutil.rmtree(DESTINO_EXT, ignore_errors=True)
    for plataforma in ("wasm_eh", "wasm_mvp"):
        destino = DESTINO_EXT / versao / plataforma / "parquet.duckdb_extension.wasm"
        destino.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://extensions.duckdb.org/{versao}/{plataforma}/parquet.duckdb_extension.wasm"
        with urllib.request.urlopen(_requisicao(url)) as r, open(destino, "wb") as f:
            shutil.copyfileobj(r, f)
    print(f"✅ extensão parquet {versao} (eh e mvp) em {DESTINO_EXT}")


def main() -> int:
    DESTINO.mkdir(parents=True, exist_ok=True)
    for antigo in DESTINO.glob("*.parquet"):
        antigo.unlink()

    nomes = baixar_gold()
    faltando = [c for c in cubos.CUBOS if c not in nomes]
    if faltando:
        print(f"⚠️  a Gold publicada não tem {', '.join(faltando)} — montando a partir da Silver")
        nomes += [c for c in montar_cubos() if c in faltando]
    manifesto = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "fontes": {"gold": REPO_GOLD, "silver_caged": REPO_SILVER_CAGED},
        "tabelas": {n: {"arquivo": f"{n}.parquet",
                        "bytes": (DESTINO / f"{n}.parquet").stat().st_size}
                    for n in sorted(nomes)},
    }
    (DESTINO / "manifesto.json").write_text(json.dumps(manifesto, indent=2), encoding="utf-8")
    baixar_extensoes()
    total = sum(t["bytes"] for t in manifesto["tabelas"].values())
    print(f"🏁 {len(nomes)} tabela(s), {total / 1e6:.1f} MB em {DESTINO}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
