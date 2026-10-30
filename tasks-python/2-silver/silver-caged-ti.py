"""
Silver CAGED TI — traduz e filtra pra TI o que já está em
Gianpedro/bronze-caged, publica em Gianpedro/silver-caged-ti.

Dois modos, um script:
    python silver-caged-ti.py --modo verificar [--ano-inicio N] [--ano-fim N]
        Compara bronze x silver por LISTAGEM de ano (sem ler dado) e
        imprime o JSON de (tabela, ano) pendentes de tradução.

    python silver-caged-ti.py --modo processar --tabela X --ano-inicio Y --ano-fim Y
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

_AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(_AQUI))
sys.path.insert(0, str(_AQUI.parent))

from silver_caged.construir_silver import construir  # noqa: E402
from silver_caged import mapeamento as mp  # noqa: E402
from _utils import log, nuvem, telegram  # noqa: E402

log.ativar_horario()


def _preparar_completa(args) -> None:
    """Na silver completa, cria o repositório na primeira vez e mantém o cartão em dia."""
    if args.completa:
        repo = nuvem.repo_silver("caged_mov", completa=True)
        if nuvem.publicar_cartao(repo, _AQUI / "cartoes" / "silver-caged.md"):
            print(f"   📝 cartão de {repo} atualizado")


def _argumentos():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--modo", choices=("verificar", "processar"), required=True)
    p.add_argument("--tabela", nargs="+", default=list(mp.TODAS_TABELAS))
    p.add_argument("--ano-inicio", type=int, default=0)
    p.add_argument("--ano-fim", type=int, default=9999)
    # Reprocessa os anos do intervalo mesmo que já estejam na silver — para
    # correções de conteúdo, que a comparação por listagem não enxerga.
    p.add_argument("--forcar", action="store_true")
    # A base inteira traduzida, sem o recorte de TI, em repositório próprio
    # (ver silver-caged-completa.py).
    p.add_argument("--completa", action="store_true")
    args = p.parse_args()
    args.rotulo = "Silver CAGED completa" if args.completa else "Silver CAGED TI"
    return args


def _meses_no_repo(repo: str, tabela: str, chave_ano: str, chave_mes: str) -> set[tuple[int, int]]:
    """(ano, mês) presentes num repo, pela listagem (sem ler dado). Vazio se a tabela não é mensal."""
    import re

    padrao = re.compile(rf"{chave_ano}=(\d{{4}})/{chave_mes}=(\d{{1,2}})/")
    meses = set()
    for caminho in nuvem.arquivos_remotos(repo):
        if caminho.startswith(f"{tabela}/") and (m := padrao.search(caminho)):
            meses.add((int(m.group(1)), int(m.group(2))))
    return meses


def modo_verificar(args) -> int:
    ano_inicio = args.ano_inicio or (time.localtime().tm_year - 1)
    ano_fim = args.ano_fim if args.ano_fim != 9999 else time.localtime().tm_year

    pares = []
    for tabela in mp.TODAS_TABELAS:
        bronze = nuvem.anos_no_repo(nuvem.repo_bronze(tabela), tabela, "ano")
        silver = nuvem.anos_no_repo(nuvem.repo_silver(tabela, args.completa), tabela, "ano_particao")
        # Comparar só o ano deixava o CAGED parado: depois que o primeiro mês de
        # um ano entra na silver, o ano "existe" e os meses seguintes nunca eram
        # traduzidos. Um mês da bronze sem o mesmo mês na silver também deixa o
        # ano pendente. Nas tabelas em que a competência do arquivo não é a dos
        # registros (exclusões, fora do prazo), isso pode reprocessar um ano à
        # toa — custo pequeno; deixar de traduzir um mês é erro silencioso.
        meses_bronze = _meses_no_repo(nuvem.repo_bronze(tabela), tabela, "ano", "mes")
        meses_silver = _meses_no_repo(nuvem.repo_silver(tabela, args.completa), tabela, "ano_particao", "mes_particao")
        com_mes_faltando = {a for a, _ in meses_bronze - meses_silver} if meses_silver else set()
        candidatos = bronze if args.forcar else (bronze - silver) | com_mes_faltando
        faltam = sorted(a for a in candidatos if ano_inicio <= a <= ano_fim)
        print(f"   {tabela}: {len(bronze)} ano(s) na bronze, {len(silver)} já na silver, "
              f"{len(faltam)} pendente(s)")
        pares += [{"tabela": tabela, "ano": a} for a in faltam]

    saida = {"tem_novidade": bool(pares), "anos": pares}
    print(json.dumps(saida, ensure_ascii=False, indent=2))

    github_output = os.getenv("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a", encoding="utf-8") as f:
            f.write(f"tem_novidade={str(saida['tem_novidade']).lower()}\n")
            f.write(f"anos={json.dumps(saida['anos'])}\n")

    if saida["tem_novidade"]:
        telegram.notificar(f"🔎 *{args.rotulo}*: tem ano pendente de tradução, processando.")
    else:
        telegram.notificar(f"🔎 *{args.rotulo}*: verificado, já em dia.")
    return 0


def modo_processar(args) -> int:
    con = nuvem.conectar_duckdb()
    sucesso = 0
    for tabela in args.tabela:
        if construir(con, tabela, args.ano_inicio, args.ano_fim, completa=args.completa):
            sucesso += 1

    icone = "🏁" if sucesso == len(args.tabela) else "⚠️"
    telegram.notificar(f"{icone} *{args.rotulo}*: {sucesso}/{len(args.tabela)} tabela(s) "
                       f"({', '.join(args.tabela)} {args.ano_inicio})")
    return 0 if sucesso == len(args.tabela) else 2


def main() -> int:
    args = _argumentos()
    _preparar_completa(args)
    if args.modo == "verificar":
        return modo_verificar(args)
    return modo_processar(args)


if __name__ == "__main__":
    sys.exit(main())
