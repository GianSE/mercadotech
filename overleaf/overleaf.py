"""
Sincroniza a pasta do TCC com o projeto no Overleaf da UTFPR.

O Overleaf da UTFPR é a edição Community: não tem integração Git. Este
script usa o mesmo caminho do navegador — login com e-mail e senha, download
do projeto em .zip, envio de arquivo pelo upload do editor.

    python overleaf/overleaf.py projetos          # lista os projetos e os ids
    python overleaf/overleaf.py diff              # o que difere entre local e Overleaf
    python overleaf/overleaf.py enviar            # manda o que mudou no local
    python overleaf/overleaf.py baixar [pasta]    # traz o projeto (padrão: pasta temporária)
    python overleaf/overleaf.py compilar          # compila lá e diz se deu erro

Credenciais e projeto em overleaf/.env: OVERLEAF_USER, OVERLEAF_PASS e
OVERLEAF_PROJECT (o id que `projetos` mostra).

SEGURANÇA DO ENVIO
------------------
O envio nunca apaga nada no Overleaf, e não sobrescreve um arquivo que pareça
editado LÁ: se a versão do Overleaf difere da local e não bate com nenhuma
versão do arquivo no histórico do git, alguém mexeu nela direto no editor
(você ou o orientador). Esse arquivo é listado e pulado — traga a mudança
para o local antes, ou use --forcar. O Overleaf guarda o histórico de cada
arquivo, então até um envio forçado pode ser desfeito por lá.

Requer `requests` e `python-dotenv`.
"""
import argparse
import io
import json
import mimetypes
import os
import re
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

import requests
from dotenv import load_dotenv

AQUI = Path(__file__).resolve().parent
RAIZ = AQUI.parent  # raiz do repositório, para consultar o histórico do git
PASTA_TCC = AQUI / "TCC2_Gian_Pedro_Rodrigues"
BASE = "https://overleaf.utfpr.edu.br"
# O que é fonte do documento; o resto (PDF, .aux, .log...) é resultado da compilação.
EXTENSOES = {".tex", ".bib", ".cls", ".sty", ".bst", ".png", ".jpg", ".jpeg", ".pdf", ".svg", ".eps"}
IGNORAR = {"main-tcc.pdf"}

load_dotenv(AQUI / ".env")


# ------------------------------------------------------------------ sessão
def entrar() -> requests.Session:
    usuario = (os.getenv("OVERLEAF_USER") or "").strip()
    senha = (os.getenv("OVERLEAF_PASS") or "").strip()
    if not usuario or not senha:
        sys.exit("❌ defina OVERLEAF_USER e OVERLEAF_PASS no .env")
    s = requests.Session()
    pagina = s.get(f"{BASE}/login", timeout=30).text
    csrf = re.search(r'name="ol-csrfToken" content="([^"]+)"', pagina) \
        or re.search(r'name="_csrf" type="hidden" value="([^"]+)"', pagina)
    r = s.post(f"{BASE}/login", json={"_csrf": csrf.group(1), "email": usuario, "password": senha},
               headers={"Accept": "application/json"}, timeout=30)
    if r.status_code != 200 or "redir" not in r.text:
        sys.exit(f"❌ login recusado ({r.status_code})")
    return s


def projeto_id(args) -> str:
    pid = args.projeto or (os.getenv("OVERLEAF_PROJECT") or "").strip()
    if not pid:
        sys.exit("❌ informe --projeto ou OVERLEAF_PROJECT no .env (veja `projetos`)")
    return pid


def pasta_raiz(s: requests.Session, pid: str) -> str:
    """Id da pasta raiz, pela conexão em tempo real do editor (é ela que entrega a árvore)."""
    t = lambda: int(time.time() * 1000)
    params = {"projectId": pid, "esh": 1, "ssp": 1}
    sid = s.get(f"{BASE}/socket.io/1/", params={**params, "t": t()}, timeout=30).text.split(":")[0]
    for _ in range(6):
        texto = s.get(f"{BASE}/socket.io/1/xhr-polling/{sid}", params={**params, "t": t()}, timeout=40).text
        if "joinProjectResponse" in texto:
            corpo = texto[texto.index("{"):].split("�")[0]
            return json.loads(corpo)["args"][0]["project"]["rootFolder"][0]["_id"]
    sys.exit("❌ o editor não devolveu a árvore do projeto")


def baixar_zip(s: requests.Session, pid: str, destino: Path) -> Path:
    r = s.get(f"{BASE}/project/{pid}/download/zip", timeout=120)
    r.raise_for_status()
    destino.mkdir(parents=True, exist_ok=True)
    zipfile.ZipFile(io.BytesIO(r.content)).extractall(destino)
    return destino


# ------------------------------------------------------------- comparação
def arquivos_locais() -> dict[str, Path]:
    return {p.relative_to(PASTA_TCC).as_posix(): p for p in PASTA_TCC.rglob("*")
            if p.is_file() and p.suffix.lower() in EXTENSOES and p.name not in IGNORAR}


def _normalizar(dado: bytes, caminho: str) -> bytes:
    # Texto compara sem \r: o Windows grava CRLF, o Overleaf devolve LF.
    return dado.replace(b"\r\n", b"\n") if Path(caminho).suffix in {".tex", ".bib", ".cls", ".sty", ".bst"} else dado


def versao_conhecida(caminho: str, conteudo: bytes) -> bool:
    """O conteúdo bate com alguma versão do arquivo no histórico do git?"""
    alvo = _normalizar(conteudo, caminho)
    # O TCC morou na raiz antes de vir para overleaf/: o histórico de cada
    # arquivo está dividido entre os dois caminhos.
    atual = f"{PASTA_TCC.relative_to(RAIZ).as_posix()}/{caminho}"
    for rel in (atual, f"{PASTA_TCC.name}/{caminho}"):
        commits = subprocess.run(["git", "log", "--format=%h", "--", rel], cwd=RAIZ,
                                 capture_output=True, text=True).stdout.split()
        for c in commits:
            antigo = subprocess.run(["git", "show", f"{c}:{rel}"], cwd=RAIZ, capture_output=True).stdout
            if _normalizar(antigo, caminho) == alvo:
                return True
    return False


def comparar(s: requests.Session, pid: str) -> dict[str, list[str]]:
    with tempfile.TemporaryDirectory() as tmp:
        remoto_dir = baixar_zip(s, pid, Path(tmp))
        remotos = {p.relative_to(remoto_dir).as_posix(): p.read_bytes() for p in remoto_dir.rglob("*") if p.is_file()}
    locais = arquivos_locais()
    resultado = {"novos": [], "alterados": [], "editados_no_overleaf": [], "so_no_overleaf": []}
    for rel, caminho in sorted(locais.items()):
        if rel not in remotos:
            resultado["novos"].append(rel)
        elif _normalizar(caminho.read_bytes(), rel) != _normalizar(remotos[rel], rel):
            chave = "alterados" if versao_conhecida(rel, remotos[rel]) else "editados_no_overleaf"
            resultado[chave].append(rel)
    resultado["so_no_overleaf"] = sorted(r for r in remotos if r not in locais and Path(r).suffix.lower() in EXTENSOES)
    return resultado


def imprimir(c: dict[str, list[str]]) -> None:
    rotulos = {"novos": "novos no local", "alterados": "alterados no local",
               "editados_no_overleaf": "⚠️  editados no Overleaf (não serão sobrescritos)",
               "so_no_overleaf": "só no Overleaf (não são apagados)"}
    for chave, rotulo in rotulos.items():
        if c[chave]:
            print(f"\n{rotulo}: {len(c[chave])}")
            for r in c[chave]:
                print(f"   {r}")
    if not any(c[k] for k in ("novos", "alterados", "editados_no_overleaf")):
        print("✅ Overleaf em dia com o local")


# ------------------------------------------------------------------ envio
def enviar(s: requests.Session, pid: str, caminhos: list[str]) -> None:
    raiz = pasta_raiz(s, pid)
    csrf = re.search(r'name="ol-csrfToken" content="([^"]+)"', s.get(f"{BASE}/project/{pid}", timeout=30).text).group(1)
    for rel in caminhos:
        dado = (PASTA_TCC / rel).read_bytes()
        nome = Path(rel).name
        tipo = mimetypes.guess_type(nome)[0] or "text/plain"
        # relativePath: o Overleaf cria as pastas que faltarem e substitui o
        # arquivo de mesmo caminho (o histórico do projeto guarda a versão anterior).
        r = s.post(f"{BASE}/project/{pid}/upload", params={"folder_id": raiz},
                   data={"name": nome, "type": tipo, "relativePath": rel},
                   files={"qqfile": (nome, dado, tipo)}, headers={"X-Csrf-Token": csrf}, timeout=120)
        ok = r.status_code == 200 and r.json().get("success")
        print(f"   {'✅' if ok else '❌'} {rel}" + ("" if ok else f" ({r.status_code}: {r.text[:120]})"))


def compilar(s: requests.Session, pid: str) -> int:
    csrf = re.search(r'name="ol-csrfToken" content="([^"]+)"', s.get(f"{BASE}/project/{pid}", timeout=30).text).group(1)
    r = s.post(f"{BASE}/project/{pid}/compile", headers={"X-Csrf-Token": csrf}, timeout=300,
               json={"check": "silent", "draft": False, "incrementalCompilesEnabled": True,
                     "rootDoc_id": None, "stopOnFirstError": False})
    resposta = r.json()
    status = resposta.get("status")
    saidas = {f["path"]: f for f in resposta.get("outputFiles", [])}
    print(f"{'✅' if status == 'success' else '❌'} compilação: {status}")
    if "output.log" in saidas:
        log = s.get(f"{BASE}{saidas['output.log']['url']}", timeout=60).text
        erros = [l for l in log.splitlines() if l.startswith("!")]
        paginas = re.search(r"Output written on \S+ \((\d+) pages", log)
        print(f"   {paginas.group(1) if paginas else '?'} página(s), {len(erros)} erro(s) no log")
        for l in erros[:10]:
            print(f"   {l}")
    return 0 if status == "success" else 1


def main() -> int:
    p = argparse.ArgumentParser(description="Sincroniza o TCC com o Overleaf da UTFPR.")
    p.add_argument("comando", choices=("projetos", "diff", "enviar", "baixar", "compilar"))
    p.add_argument("destino", nargs="?", help="pasta do `baixar`")
    p.add_argument("--projeto", help="id do projeto (padrão: OVERLEAF_PROJECT do .env)")
    p.add_argument("--forcar", action="store_true", help="sobrescreve também o que foi editado no Overleaf")
    args = p.parse_args()

    s = entrar()
    if args.comando == "projetos":
        pagina = s.get(f"{BASE}/project", timeout=30).text
        m = re.search(r'name="ol-prefetchedProjectsBlob"[^>]*content="([^"]+)"', pagina)
        import html
        for proj in json.loads(html.unescape(m.group(1))).get("projects", []):
            print(f"{proj['id']}  {proj.get('lastUpdated', '')[:10]}  {proj['name']}")
        return 0

    pid = projeto_id(args)
    if args.comando == "baixar":
        destino = Path(args.destino) if args.destino else Path(tempfile.mkdtemp(prefix="overleaf_"))
        print(f"📥 {baixar_zip(s, pid, destino)}")
        return 0

    if args.comando == "compilar":
        return compilar(s, pid)

    c = comparar(s, pid)
    imprimir(c)
    if args.comando == "enviar":
        lista = c["novos"] + c["alterados"] + (c["editados_no_overleaf"] if args.forcar else [])
        if lista:
            print(f"\n📤 enviando {len(lista)} arquivo(s)")
            enviar(s, pid, lista)
    return 0


if __name__ == "__main__":
    sys.exit(main())
