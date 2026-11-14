"""
Perdas na extração: quanto do microdado do FTP do MTE não chegou à Bronze?

A recontagem de reprodutibilidade (reprodutibilidade_rais.py / _caged.py)
compara a Bronze com a Silver, e por isso não enxerga o que se perde ANTES da
Bronze. Este script cobre esse trecho, arquivo a arquivo do FTP, e mede duas
perdas diferentes:

  1. Perda na FONTE: pacote corrompido no próprio servidor. O 7z para de
     decodificar no meio e entrega só parte do texto. A estimativa do que
     falta vem da proporção entre os bytes legíveis e o tamanho original que
     o índice do pacote declara (o mesmo critério da tabela de perdas do TCC).
  2. Perda na CONVERSÃO: linhas que existem no texto legível e não estão na
     Bronze (o conversor tolera descartar até 0,1% de linhas malformadas, ver
     transformador.TOLERANCIA_LINHAS), contadas pelo caminho_fonte de cada
     linha da Bronze.

É um "dry run" da Bronze: baixa e decodifica cada pacote como a ingestão
faria, mas nada é gravado nas camadas. O texto não vai para o disco: o 7z
descompacta para um pipe (`7z e -so`) e o script só conta bytes e quebras de
linha. O código de saída do mesmo 7z é o teste de integridade.

Uso (de dentro de tasks-python/):
    python _utils/perdas_extracao.py --dataset rais --ano-inicio 2007 --ano-fim 2025
    python _utils/perdas_extracao.py --dataset caged novo_caged --ano-inicio 2020 --ano-fim 2020
    python _utils/perdas_extracao.py --juntar perdas/*.csv      # consolida e resume
"""
import argparse
import csv
import glob
import os
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "1-bronze"))

from _utils import nuvem  # noqa: E402
from extracao_ftp import extrator  # noqa: E402
from extracao_ftp.catalogo import DATASETS, descobrir  # noqa: E402
from extracao_ftp.ftp_utils import ClienteFTP  # noqa: E402

BLOCO = 8 * 1024 * 1024

CAMPOS = [
    "dataset", "tabela", "ano", "mes", "recorte", "arquivo", "caminho_fonte",
    "bytes_compactado", "integridade", "erro_7z",
    "bytes_declarados", "bytes_legiveis", "linhas_texto", "linhas_estimadas",
    "linhas_perdidas_fonte", "linhas_bronze", "linhas_perdidas_conversao",
]


# --------------------------------------------------------------------------- 7z
def _membros(pacote: Path) -> list[tuple[str, int | None]]:
    """Arquivos de dados do pacote e o tamanho original declarado no índice."""
    saida = subprocess.run([extrator._binario_7z(), "l", "-slt", str(pacote)],
                           capture_output=True, text=True, errors="replace").stdout
    membros, caminho, pasta = [], None, False
    for linha in saida.splitlines() + [""]:
        if linha.startswith("Path = "):
            caminho, pasta = linha[7:].strip(), False
        elif linha.startswith("Folder = +") or linha.startswith("Attributes = D"):
            pasta = True
        elif linha.startswith("Size = ") and caminho and not pasta:
            tamanho = int(linha[7:].strip() or 0)
            nome = Path(caminho).name.lower()
            eh_dado = nome.endswith(extrator.EXTENSOES_DADOS) or "." not in nome
            # A primeira entrada "Path =" do -slt é o próprio pacote: sem Size.
            if eh_dado and tamanho >= extrator.TAMANHO_MINIMO_BYTES:
                membros.append((caminho, tamanho))
            caminho = None
    return membros


def _ler_stream(pacote: Path, membro: str | None) -> tuple[int, int, int, str]:
    """
    Descompacta para um pipe e conta. Devolve (bytes, quebras de linha,
    código de saída do 7z, mensagem de erro). Código 0 = íntegro.
    """
    cmd = [extrator._binario_7z(), "e", str(pacote), "-so", "-y"]
    if membro:
        cmd += ["--", membro]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    nbytes = quebras = 0
    ultimo = b"\n"
    while bloco := proc.stdout.read(BLOCO):
        nbytes += len(bloco)
        quebras += bloco.count(b"\n")
        ultimo = bloco[-1:]
    erro = proc.stderr.read().decode("utf-8", "replace")
    proc.wait()
    # Última linha sem quebra no fim também conta (mesma regra do conversor).
    linhas = quebras + (0 if ultimo == b"\n" or nbytes == 0 else 1)
    msg = " ".join(l.strip() for l in erro.splitlines()
                   if any(k in l for k in ("Error", "CRC", "Unexpected", "Headers", "Data")))
    return nbytes, linhas, proc.returncode, msg[:300]


# ----------------------------------------------------------------------- Bronze
_cache_bronze: dict[tuple[str, int], dict[str, int]] = {}


def _linhas_bronze(con, tabela: str, ano: int, caminho_fonte: str) -> int | None:
    """Linhas da Bronze com este caminho_fonte (uma consulta por tabela e ano)."""
    chave = (tabela, ano)
    if chave not in _cache_bronze:
        origem = nuvem.fonte_bronze(tabela, f"ano={ano}*/**/*.parquet")
        try:
            linhas = con.execute(
                f"SELECT caminho_fonte, count(*) FROM read_parquet({origem}, union_by_name=true) "
                f"GROUP BY caminho_fonte").fetchall()
            _cache_bronze[chave] = {c: n for c, n in linhas}
        except Exception as e:
            if "No files found" not in str(e):
                print(f"      ⚠️  não consegui contar a bronze de {tabela}/{ano}: {str(e)[:120]}")
                return None
            _cache_bronze[chave] = {}
    return _cache_bronze[chave].get(caminho_fonte, 0)


# --------------------------------------------------------------------- um item
def medir(item, cliente: ClienteFTP, con, pasta: Path, sem_bronze: bool) -> dict:
    pacote = pasta / item.nome_arquivo
    linha = dict(dataset=item.dataset, tabela=item.tabela, ano=item.ano, mes=item.mes or "",
                 recorte=item.recorte or "", arquivo=item.nome_arquivo,
                 caminho_fonte=item.caminho_remoto, bytes_compactado=item.tamanho)
    try:
        if not cliente.baixar(item.caminho_remoto, pacote, item.tamanho):
            return {**linha, "integridade": "download_falhou"}

        membros = _membros(pacote)
        declarados = legiveis = texto = 0
        estimadas = 0.0
        codigos, erros = [], []
        if membros:
            for caminho, tamanho in membros:
                nbytes, linhas, cod, msg = _ler_stream(pacote, caminho)
                codigos.append(cod)
                erros.append(msg) if msg else None
                declarados += tamanho
                legiveis += min(nbytes, tamanho)
                texto += max(linhas - 1, 0)          # sem o cabeçalho
                if nbytes and nbytes < tamanho:
                    estimadas += linhas * tamanho / nbytes - 1
                else:
                    estimadas += max(linhas - 1, 0)
        else:
            # Índice ilegível: lê o que o fluxo entregar, sem tamanho declarado.
            nbytes, linhas, cod, msg = _ler_stream(pacote, None)
            codigos.append(cod)
            erros.append(msg or "índice do pacote ilegível")
            legiveis, texto = nbytes, max(linhas - 1, 0)
            declarados, estimadas = None, None

        integro = all(c == 0 for c in codigos) and membros
        linha.update(
            integridade="ok" if integro else "corrompido",
            erro_7z=" | ".join(erros)[:300],
            bytes_declarados=declarados if declarados is not None else "",
            bytes_legiveis=legiveis,
            linhas_texto=texto,
            linhas_estimadas=round(estimadas) if estimadas is not None else "",
            linhas_perdidas_fonte=max(round(estimadas) - texto, 0) if estimadas is not None else "",
        )
        if not sem_bronze:
            na_bronze = _linhas_bronze(con, item.tabela, item.ano, item.caminho_remoto)
            if na_bronze is not None:
                linha.update(linhas_bronze=na_bronze, linhas_perdidas_conversao=texto - na_bronze)
        return linha
    except Exception as e:
        return {**linha, "integridade": "erro_script", "erro_7z": str(e)[:300]}
    finally:
        pacote.unlink(missing_ok=True)


# ------------------------------------------------------------------- resumo
def _int(v) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def resumir(linhas: list[dict]) -> str:
    """Markdown com os pacotes problemáticos e o total por dataset."""
    out = ["## Perdas na extração (FTP do MTE → Bronze)", ""]
    problemas = [l for l in linhas if l.get("integridade") != "ok"
                 or _int(l.get("linhas_perdidas_conversao")) != 0]
    if problemas:
        out += ["| Arquivo | Ano | Integridade | Linhas lidas | Estimadas no arquivo | Perdidas na fonte | Perdidas na conversão |",
                "|---|---|---|---:|---:|---:|---:|"]
        for l in problemas:
            perc = ""
            if _int(l.get("linhas_estimadas")):
                perc = f" ({100 * _int(l.get('linhas_perdidas_fonte')) / _int(l['linhas_estimadas']):.1f}%)"
            out.append(f"| {l['arquivo']} | {l['ano']}{('/' + str(l['mes'])) if l.get('mes') else ''} "
                       f"| {l.get('integridade')} | {_int(l.get('linhas_texto')):,} | {_int(l.get('linhas_estimadas')):,} "
                       f"| {_int(l.get('linhas_perdidas_fonte')):,}{perc} | {_int(l.get('linhas_perdidas_conversao')):+,} |")
        out.append("")
    else:
        out += ["Nenhum pacote corrompido e nenhuma linha perdida na conversão.", ""]

    out += ["| Dataset | Pacotes | Corrompidos | Linhas estimadas | Perdidas na fonte | Perdidas na conversão |",
            "|---|---:|---:|---:|---:|---:|"]
    for ds in sorted({l["dataset"] for l in linhas}):
        grupo = [l for l in linhas if l["dataset"] == ds]
        est = sum(_int(l.get("linhas_estimadas")) or _int(l.get("linhas_texto")) for l in grupo)
        fonte = sum(_int(l.get("linhas_perdidas_fonte")) for l in grupo)
        conv = sum(_int(l.get("linhas_perdidas_conversao")) for l in grupo)
        ruins = sum(1 for l in grupo if l.get("integridade") != "ok")
        pf = f" ({100 * fonte / est:.3f}%)" if est else ""
        pc = f" ({100 * conv / est:.3f}%)" if est else ""
        out.append(f"| {ds} | {len(grupo)} | {ruins} | {est:,} | {fonte:,}{pf} | {conv:+,}{pc} |")
    return "\n".join(out) + "\n"


def _gravar(linhas: list[dict], destino: Path) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    with open(destino, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=CAMPOS, extrasaction="ignore")
        w.writeheader()
        w.writerows(linhas)


def main() -> int:
    p = argparse.ArgumentParser(description="Perdas na extração, FTP do MTE -> Bronze (só leitura).")
    p.add_argument("--dataset", nargs="+", choices=DATASETS, default=["rais"])
    p.add_argument("--tabela", nargs="+", default=None)
    p.add_argument("--ano-inicio", type=int, default=2007)
    p.add_argument("--ano-fim", type=int, default=2025)
    p.add_argument("--arquivo", nargs="+", default=None, help="só os pacotes com estes nomes (ex.: AC2007.7z)")
    p.add_argument("--saida", default=None, help="CSV de saída (padrão: _staging/perdas/<dataset>_<anos>.csv)")
    p.add_argument("--sem-bronze", action="store_true", help="não compara com a Bronze (só a perda na fonte)")
    p.add_argument("--juntar", nargs="+", default=None, help="CSVs a consolidar; não baixa nada")
    p.add_argument("--publicar", action="store_true", help="com --juntar: grava auditoria/perdas_extracao.csv na Gold")
    args = p.parse_args()

    if args.juntar:
        arquivos = sorted({a for padrao in args.juntar for a in glob.glob(padrao)})
        linhas = []
        for a in arquivos:
            with open(a, encoding="utf-8") as f:
                linhas += list(csv.DictReader(f))
        nuvem.preparar_staging()
        local = nuvem.DIR_TEMP / "perdas_extracao.csv"
        _gravar(linhas, local)
        texto = resumir(linhas)
        print(texto)
        print(f"💾 {local} ({len(linhas)} pacotes de {len(arquivos)} arquivo(s))")
        if args.publicar:
            nuvem.publicar_arquivo(local, nuvem.REPO_GOLD, "auditoria/perdas_extracao.csv")
            print(f"📤 auditoria/perdas_extracao.csv em {nuvem.REPO_GOLD}")
        if resumo := os.getenv("GITHUB_STEP_SUMMARY"):
            Path(resumo).open("a", encoding="utf-8").write(texto)
        return 0

    if not extrator._tem_7z():
        print("❌ 7z não encontrado")
        return 1

    nuvem.preparar_staging()
    pasta = nuvem.DIR_TEMP / "perdas_download"
    pasta.mkdir(parents=True, exist_ok=True)
    saida = Path(args.saida) if args.saida else (
        nuvem.DIR_TEMP / "perdas" / f"{'_'.join(args.dataset)}_{args.ano_inicio}_{args.ano_fim}.csv")

    cliente = ClienteFTP()
    cliente.conectar()
    itens = descobrir(cliente, args.dataset, args.ano_inicio, args.ano_fim, tabelas=args.tabela)
    if args.arquivo:
        alvo = {a.lower() for a in args.arquivo}
        itens = [i for i in itens if i.nome_arquivo.lower() in alvo]
    print(f"\n📋 {len(itens)} pacote(s) a medir")

    con = None if args.sem_bronze else nuvem.conectar_duckdb()
    linhas, inicio = [], time.time()
    for n, item in enumerate(itens, 1):
        print(f"[{n}/{len(itens)}] {item.rotulo}  ({item.tamanho / 1e6:.0f} MB)", flush=True)
        r = medir(item, cliente, con, pasta, args.sem_bronze)
        linhas.append(r)
        marca = "✅" if r.get("integridade") == "ok" else "⚠️ "
        print(f"      {marca} {r.get('integridade')}: {_int(r.get('linhas_texto')):,} linhas no texto"
              f", {_int(r.get('linhas_bronze')):,} na bronze"
              + (f", ~{_int(r.get('linhas_perdidas_fonte')):,} perdidas na fonte" if _int(r.get('linhas_perdidas_fonte')) else ""))
        _gravar(linhas, saida)   # grava a cada pacote: um job cancelado não perde o que já mediu
    cliente.fechar()

    texto = resumir(linhas)
    print("\n" + texto + f"\n💾 {saida}  ({time.time() - inicio:.0f}s)")
    if resumo := os.getenv("GITHUB_STEP_SUMMARY"):
        Path(resumo).open("a", encoding="utf-8").write(texto)
    return 0


if __name__ == "__main__":
    sys.exit(main())
