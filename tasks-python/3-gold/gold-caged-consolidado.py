"""
Gold CAGED consolidado — um parquet por tabela e por ano (para servir por
HTTPS) mais o arquivo unificado das duas gerações, a partir da
silver-caged-ti já publicada. Publica no mesmo repositório da silver
(Gianpedro/silver-caged-ti), como um espelho pronto pra consulta direta.

Totalmente independente do resto da gold: só depende de silver-caged-ti,
nunca lê nada que gold-rais.py, gold-territorio.py ou gold-modelos.py
produzem. Ao final, agrega o CAGED unificado nos cubos do site de
dashboards (gold_caged/cubos.py) e os publica na Gold.

Uso:
    python gold-caged-consolidado.py
"""
import sys
from pathlib import Path

_AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(_AQUI))
sys.path.insert(0, str(_AQUI.parent))

from _utils import log, nuvem, telegram  # noqa: E402

log.ativar_horario()


def main() -> int:
    from gold_caged import consolidar, unificar, publicar_hf

    codigo_consolidar = consolidar.main()
    codigo_unificar = unificar.main()

    if codigo_consolidar != 0 or codigo_unificar != 0:
        telegram.notificar("⚠️ *Gold CAGED consolidado*: consolidar/unificar falhou, "
                           "publicação pulada.")
        return 2

    print("\n📤 Publicando no Hugging Face...")
    codigo_publicar = publicar_hf.main()
    if codigo_publicar != 0:
        telegram.notificar("⚠️ *Gold CAGED consolidado*: publicação falhou.")
        return codigo_publicar

    print("\n🧊 Cubos do CAGED para o site de dashboards...")
    codigo_cubos = _publicar_cubos()
    if codigo_cubos != 0:
        telegram.notificar("⚠️ *Gold CAGED consolidado*: espelho publicado, mas os cubos falharam.")
        return codigo_cubos

    telegram.notificar("🏁 *Gold CAGED consolidado*: reconstruído e publicado, com os cubos.")
    return 0


def _publicar_cubos() -> int:
    """
    Os cubos vão para a Gold (não para o espelho da silver): são agregados
    prontos para consumo, como o resto da Gold, e é dela que o site baixa
    os dados no build. Um commit só com os dois arquivos — o site nunca vê
    um cubo novo ao lado de um velho.
    """
    import duckdb
    from huggingface_hub import CommitOperationAdd, HfApi

    from gold_caged import cubos
    from gold_unificado.publicar_gold import _credencial

    try:
        nomes = cubos.montar(duckdb.connect(), (cubos.DIR_ENTRADA / "caged_ti_*.parquet").as_posix(), cubos.DIR_SAIDA)
    except Exception as e:
        print(f"❌ cubos falharam: {str(e)[:200]}")
        return 1

    api = HfApi(token=_credencial())
    operacoes = [CommitOperationAdd(path_in_repo=f"{n}.parquet", path_or_fileobj=str(cubos.DIR_SAIDA / f"{n}.parquet")) for n in nomes]
    api.create_commit(repo_id=nuvem.REPO_GOLD, repo_type="dataset", operations=operacoes,
                      commit_message="cubos do CAGED para o site")
    print(f"✅ {len(operacoes)} cubo(s) publicados em {nuvem.REPO_GOLD}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
