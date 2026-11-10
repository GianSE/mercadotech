"""
Sincroniza a pasta do TCC com o projeto no Overleaf da UTFPR.

O Overleaf da UTFPR é a edição Community: não tem integração Git. Este
script usa o mesmo caminho do navegador — login com e-mail e senha, download
do projeto em .zip, envio de arquivo pelo upload do editor.

    python overleaf/overleaf.py projetos          # lista os projetos e os ids
    python overleaf/overleaf.py diff              # o que difere entre local e Overleaf
    python overleaf/overleaf.py enviar            # manda o que mudou no local
    python overleaf/overleaf.py aplicar           # idem, SEM soltar os comentários (ver abaixo)
    python overleaf/overleaf.py baixar [pasta]    # traz o projeto (padrão: pasta temporária)
    python overleaf/overleaf.py compilar          # compila lá e diz se deu erro
    python overleaf/overleaf.py comentarios       # notas do orientador: arquivo, linha e trecho

Credenciais e projeto em overleaf/.env: OVERLEAF_USER, OVERLEAF_PASS e
OVERLEAF_PROJECT (o id que `projetos` mostra). `--original` troca o projeto pelo
de OVERLEAF_PROJECT_ORIGINAL (o que o orientador comenta), em qualquer comando.

SEGURANÇA DO ENVIO
------------------
O envio nunca apaga nada no Overleaf, e não sobrescreve um arquivo que pareça
editado LÁ: se a versão do Overleaf difere da local e não bate com nenhuma
versão do arquivo no histórico do git, alguém mexeu nela direto no editor
(você ou o orientador). Esse arquivo é listado e pulado — traga a mudança
para o local antes, ou use --forcar. O Overleaf guarda o histórico de cada
arquivo, então até um envio forçado pode ser desfeito por lá.

Comentário não altera o texto, e por isso não aparece no diff. Enquanto o
projeto tiver comentário em aberto, o envio é recusado (salvo --forcar):
substituir o arquivo pode soltar a nota do trecho a que ela se refere.

LEVAR O TEXTO SEM SOLTAR OS COMENTÁRIOS
---------------------------------------
`aplicar` faz o que o `enviar` não pode com comentário em aberto. Os arquivos
que têm comentário (ou sugestão) são editados como o próprio editor do
Overleaf faz, pela conexão em tempo real, com operações de remoção e inserção
sobre o texto atual: o Overleaf reposiciona cada comentário junto com o trecho
(se o trecho em si é reescrito, a nota segue o texto novo que o substituiu). Os
arquivos sem comentário vão pelo upload de sempre. Antes de enviar, cada
operação é conferida em memória (tem de dar exatamente o arquivo local) e,
depois, o texto no Overleaf é lido de volta e comparado. `--simular` só mostra
o plano. O orientador pode ter o arquivo aberto: as mudanças aparecem na tela
dele, ao vivo. Foi testado num projeto-cópia com os comentários recriados.

Requer `requests` e `python-dotenv`.
"""
import argparse
import difflib
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
    if args.original:
        pid = (os.getenv("OVERLEAF_PROJECT_ORIGINAL") or "").strip()
        if not pid:
            sys.exit("❌ --original pede OVERLEAF_PROJECT_ORIGINAL no .env")
        return pid
    pid = args.projeto or (os.getenv("OVERLEAF_PROJECT") or "").strip()
    if not pid:
        sys.exit("❌ informe --projeto ou OVERLEAF_PROJECT no .env (veja `projetos`)")
    return pid


class Editor:
    """Conexão em tempo real do editor (socket.io 0.9 por xhr-polling): é ela
    que entrega a árvore do projeto e o conteúdo de cada documento com os
    comentários e as sugestões ancorados no texto."""

    def __init__(self, s: requests.Session, pid: str):
        self.s, self.pid, self.ack = s, pid, 0
        sid = s.get(f"{BASE}/socket.io/1/", params=self._params(), timeout=30).text.split(":")[0]
        self.url = f"{BASE}/socket.io/1/xhr-polling/{sid}"
        for _ in range(8):
            for tipo, _id, dado in self._quadros():
                if tipo == "5" and json.loads(dado).get("name") == "joinProjectResponse":
                    self.projeto = json.loads(dado)["args"][0]["project"]
                    return
        sys.exit("❌ o editor não devolveu a árvore do projeto")

    def _params(self) -> dict:
        return {"projectId": self.pid, "esh": 1, "ssp": 1, "t": int(time.time() * 1000)}

    def _quadros(self):
        """Uma leitura do canal: cada quadro é `tipo:id:endpoint:dado`; vários
        quadros na mesma resposta vêm separados por �<tamanho>�."""
        texto = self.s.get(self.url, params=self._params(), timeout=40).text
        quadros = texto.split("�")[2::2] if texto.startswith("�") else [texto]
        for q in quadros:
            partes = q.split(":", 3)
            if len(partes) == 4:
                yield partes[0], partes[1], partes[3]

    def emitir(self, nome: str, args: list) -> list:
        """Manda um evento e espera a confirmação (quadro 6) com a resposta."""
        self.ack += 1
        corpo = f"5:{self.ack}+::" + json.dumps({"name": nome, "args": args})
        self.s.post(self.url, params=self._params(), data=corpo.encode("utf-8"), timeout=40)
        for _ in range(10):
            for tipo, _id, dado in self._quadros():
                if tipo == "6" and dado.startswith(f"{self.ack}+"):
                    return json.loads(dado[len(f"{self.ack}+"):])
        sys.exit(f"❌ o editor não respondeu a {nome}")

    def documentos(self) -> dict[str, str]:
        """Caminho -> id de cada documento de texto do projeto."""
        docs = {}

        def percorrer(pasta: dict, prefixo: str) -> None:
            for d in pasta.get("docs", []):
                docs[prefixo + d["name"]] = d["_id"]
            for sub in pasta.get("folders", []):
                percorrer(sub, f"{prefixo}{sub['name']}/")

        percorrer(self.projeto["rootFolder"][0], "")
        return docs

    def abrir(self, doc_id: str) -> tuple[str, dict]:
        """Texto do documento e seus `ranges` (comentários e sugestões)."""
        erro, linhas, _versao, _pendentes, ranges = self.emitir("joinDoc", [doc_id, {"encodeRanges": True}])[:5]
        if erro:
            sys.exit(f"❌ joinDoc: {erro}")
        self.emitir("leaveDoc", [doc_id])
        # O canal manda o texto como bytes UTF-8 em caracteres latin-1.
        decodificar = lambda t: t.encode("latin-1").decode("utf-8")
        texto = "\n".join(decodificar(l) for l in linhas)
        for c in (ranges or {}).get("comments", []):
            c["op"]["c"] = decodificar(c["op"]["c"])
        for c in (ranges or {}).get("changes", []):
            for k in ("i", "d"):
                if k in c["op"]:
                    c["op"][k] = decodificar(c["op"][k])
        return texto, ranges or {}

    # --- edição por operações (usada por `aplicar`) ---
    def entrar(self, doc_id: str) -> tuple[str, int]:
        """Entra no documento e FICA nele: as operações de edição exigem o
        documento aberto. Devolve o texto e a versão; quem chama deve `sair`."""
        erro, linhas, versao = self.emitir("joinDoc", [doc_id, {"encodeRanges": True}])[:3]
        if erro:
            sys.exit(f"❌ joinDoc: {erro}")
        return "\n".join(l.encode("latin-1").decode("utf-8") for l in linhas), versao

    def sair(self, doc_id: str) -> None:
        self.emitir("leaveDoc", [doc_id])

    def editar(self, doc_id: str, operacao: list[dict], versao: int) -> None:
        """Manda uma operação (applyOtUpdate) e espera a confirmação. O servidor
        confirma SEM dados ("6:::N"), formato que `emitir` não reconhece, e
        recusa pelo evento otUpdateError."""
        self.ack += 1
        corpo = f"5:{self.ack}+::" + json.dumps({"name": "applyOtUpdate",
                                                "args": [doc_id, {"doc": doc_id, "op": operacao, "v": versao}]})
        self.s.post(self.url, params=self._params(), data=corpo.encode("utf-8"), timeout=60)
        for _ in range(15):
            for tipo, _id, dado in self._quadros():
                if tipo == "6" and (dado == str(self.ack) or dado.startswith(f"{self.ack}+")):
                    return
                if tipo == "5" and "otUpdateError" in dado:
                    sys.exit(f"❌ o Overleaf recusou a edição: {dado[:300]}")
        sys.exit("❌ o Overleaf não confirmou a edição")


def pasta_raiz(s: requests.Session, pid: str) -> str:
    """Id da pasta raiz, que o upload pede como destino."""
    return Editor(s, pid).projeto["rootFolder"][0]["_id"]


# ------------------------------------------------------------ comentários
def discussoes(s: requests.Session, pid: str) -> dict:
    """As discussões de comentário do projeto, com as mensagens e o estado."""
    r = s.get(f"{BASE}/project/{pid}/threads", headers={"Accept": "application/json"}, timeout=30)
    r.raise_for_status()
    return r.json()


def abertas(s: requests.Session, pid: str) -> list[str]:
    return [t for t, d in discussoes(s, pid).items() if not d.get("resolved")]


def listar_comentarios(s: requests.Session, pid: str, todos: bool = False) -> int:
    """Cada comentário com arquivo, linha e trecho, e cada sugestão de texto."""
    threads = discussoes(s, pid)
    ed = Editor(s, pid)
    # Quem é quem, para as sugestões (que trazem só o id do usuário).
    pessoas = {u["_id"]: " ".join(filter(None, [u.get("first_name"), u.get("last_name")])) or u.get("email", "?")
               for u in [ed.projeto.get("owner", {})] + ed.projeto.get("members", []) if u.get("_id")}
    total = 0
    for caminho, doc_id in sorted(ed.documentos().items()):
        texto, ranges = ed.abrir(doc_id)
        linha = lambda p: texto[:p].count("\n") + 1
        for c in sorted(ranges.get("comments", []), key=lambda c: c["op"]["p"]):
            t = threads.get(c["op"]["t"], {})
            if t.get("resolved") and not todos:
                continue
            total += 1
            trecho = " ".join(c["op"]["c"].split())
            estado = " (resolvido)" if t.get("resolved") else ""
            print(f"\n💬 {caminho}:{linha(c['op']['p'])}{estado}")
            print(f"   trecho: \"{trecho[:200]}{'…' if len(trecho) > 200 else ''}\"")
            for m in t.get("messages", []):
                u = m.get("user") or {}
                quem = " ".join(filter(None, [u.get("first_name"), u.get("last_name")])) or u.get("email") or "?"
                quando = time.strftime("%d/%m %H:%M", time.localtime(m.get("timestamp", 0) / 1000)) if m.get("timestamp") else ""
                print(f"   {quem} {quando}: {m.get('content', '').strip()}")
        for c in sorted(ranges.get("changes", []), key=lambda c: c["op"]["p"]):
            total += 1
            tipo, valor = ("inserir", c["op"]["i"]) if "i" in c["op"] else ("apagar", c["op"].get("d", ""))
            quem = pessoas.get((c.get("metadata") or {}).get("user_id"), "?")
            print(f"\n✏️  {caminho}:{linha(c['op']['p'])} sugestão de {tipo} ({quem}): \"{' '.join(valor.split())[:200]}\"")
    print(f"\n{total} item(ns)" if total else "✅ nenhum comentário nem sugestão em aberto")
    return 0


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


# ------------------------------------------------- aplicar (preserva comentários)
def operacoes(antigo: str, novo: str) -> list[dict]:
    """Operações de texto (formato ShareJS) que levam `antigo` a `novo`.

    A diferença é feita por linha e, dentro de cada bloco trocado, por
    caractere: o menor conjunto de remoções é o que mantém de pé os trechos em
    que os comentários estão ancorados. Saem em ordem DECRESCENTE de posição,
    de modo que cada posição vale no texto original (editar mais adiante não
    desloca o que está antes); na mesma posição, a remoção vem antes da inserção.
    """
    la, lb = antigo.splitlines(keepends=True), novo.splitlines(keepends=True)
    inicio = [0]
    for linha in la:
        inicio.append(inicio[-1] + len(linha))
    comps = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, la, lb, autojunk=False).get_opcodes():
        if tag == "equal":
            continue
        a, b = "".join(la[i1:i2]), "".join(lb[j1:j2])
        for t2, k1, k2, m1, m2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
            if t2 in ("replace", "delete"):
                comps.append({"p": inicio[i1] + k1, "d": a[k1:k2]})
            if t2 in ("replace", "insert"):
                comps.append({"p": inicio[i1] + k1, "i": b[m1:m2]})
    comps.sort(key=lambda c: (c["p"], 0 if "i" in c else 1), reverse=True)
    return comps


def _simular_operacoes(antigo: str, ops: list[dict]) -> str:
    """Aplica as operações em memória, na ordem em que o servidor as aplicará."""
    texto = antigo
    for c in ops:
        if "d" in c:
            if texto[c["p"]:c["p"] + len(c["d"])] != c["d"]:
                raise ValueError(f"a remoção em {c['p']} não bate com o texto")
            texto = texto[:c["p"]] + texto[c["p"] + len(c["d"]):]
        else:
            texto = texto[:c["p"]] + c["i"] + texto[c["p"]:]
    return texto


def _texto_local(rel: str) -> str:
    return (PASTA_TCC / rel).read_bytes().decode("utf-8").replace("\r\n", "\n")


def aplicar(s: requests.Session, pid: str, simular: bool = False, forcar: bool = False) -> int:
    """Leva o local ao projeto SEM soltar os comentários (ver o topo do arquivo).

    Como no `enviar`, arquivo cuja versão no Overleaf não está no histórico do
    git é tratado como editado lá (por você ou pelo orientador) e barra a
    operação; `--forcar` o inclui, e o histórico do Overleaf permite desfazer.
    """
    ed = Editor(s, pid)
    docs = ed.documentos()
    threads = discussoes(s, pid)
    com_nota: dict[str, int] = {}
    for caminho, doc_id in docs.items():
        _, ranges = ed.abrir(doc_id)
        abertos = sum(1 for c in ranges.get("comments", []) if not threads.get(c["op"]["t"], {}).get("resolved"))
        n = abertos + len(ranges.get("changes", []))
        if n:
            com_nota[caminho] = n
    print("documentos com comentário ou sugestão em aberto:", com_nota or "nenhum")

    c = comparar(s, pid)
    if c["editados_no_overleaf"] and not forcar:
        imprimir(c)
        print("\n⛔ há arquivo editado direto no Overleaf: traga a mudança para o local antes de aplicar "
              "(ou use --forcar, sabendo que o texto de lá será substituído).")
        return 1
    pendentes = c["novos"] + c["alterados"] + (c["editados_no_overleaf"] if forcar else [])
    via_upload = [r for r in pendentes if r not in com_nota]
    via_operacoes = [r for r in pendentes if r in com_nota]

    plano = {}
    for rel in via_operacoes:
        novo = _texto_local(rel)
        if any(ord(ch) > 0xFFFF for ch in novo):
            sys.exit(f"❌ {rel} tem caractere fora do plano básico do Unicode, cujas posições o editor "
                     "conta de outro jeito; aplique esse arquivo pela interface do Overleaf.")
        antigo, versao = ed.entrar(docs[rel])
        ed.sair(docs[rel])
        ops = operacoes(antigo, novo)
        if _simular_operacoes(antigo, ops) != novo:
            sys.exit(f"❌ as operações de {rel} não reproduzem o arquivo local; nada foi enviado.")
        plano[rel] = (antigo, novo, ops)

    print(f"\nplano: {len(via_upload)} arquivo(s) por upload (sem comentário), "
          f"{len(via_operacoes)} por operações (com comentário)")
    for r in via_upload:
        print(f"   upload     {r}")
    for r, (_a, _n, ops) in plano.items():
        print(f"   operações  {r}: {len(ops)} operação(ões), {com_nota[r]} nota(s) em aberto")
    if simular or not pendentes:
        print("\n(simulação: nada foi enviado)" if simular else "\n✅ nada a aplicar")
        return 0

    if via_upload:
        print(f"\n📤 upload de {len(via_upload)} arquivo(s) sem comentário")
        enviar(s, pid, via_upload)
    for rel, (antigo, novo, ops) in plano.items():
        print(f"\n✏️  {rel}")
        texto, versao = ed.entrar(docs[rel])
        if texto != antigo:
            ed.sair(docs[rel])
            sys.exit(f"❌ {rel} mudou no Overleaf desde o plano (alguém editou agora); rode de novo.")
        if ops:
            ed.editar(docs[rel], ops, versao)
        ed.sair(docs[rel])
        final, _ = ed.entrar(docs[rel])
        ed.sair(docs[rel])
        if final != novo:
            sys.exit(f"❌ o texto de {rel} no Overleaf ficou diferente do local; o Overleaf guarda o "
                     "histórico do arquivo, restaure a versão anterior por lá.")
        print(f"   ✅ idêntico ao local, {com_nota[rel]} nota(s) preservada(s)")
    print("\nconfira com `comentarios` e `diff`.")
    return 0


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
    p.add_argument("comando", choices=("projetos", "diff", "enviar", "aplicar", "baixar", "compilar", "comentarios"))
    p.add_argument("destino", nargs="?", help="pasta do `baixar`")
    p.add_argument("--projeto", help="id do projeto (padrão: OVERLEAF_PROJECT do .env)")
    p.add_argument("--original", action="store_true",
                   help="usa o projeto de OVERLEAF_PROJECT_ORIGINAL (o que o orientador comenta)")
    p.add_argument("--simular", action="store_true", help="`aplicar`: mostra o plano e não envia nada")
    p.add_argument("--forcar", action="store_true",
                   help="envia mesmo com comentários em aberto e sobrescreve o que foi editado no Overleaf")
    p.add_argument("--todos", action="store_true", help="`comentarios`: inclui os resolvidos")
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

    if args.comando == "comentarios":
        return listar_comentarios(s, pid, args.todos)

    if args.comando == "aplicar":
        return aplicar(s, pid, args.simular, args.forcar)

    c = comparar(s, pid)
    imprimir(c)
    if args.comando == "enviar":
        # Comentário não altera o texto, então o diff não o vê; substituir o
        # arquivo pode desancorá-lo. Enquanto houver nota em aberto, não envia.
        if (n := len(abertas(s, pid))) and not args.forcar:
            print(f"\n⛔ {n} comentário(s) em aberto no Overleaf: nada foi enviado. "
                  "Leia com `comentarios` e resolva lá, ou use `aplicar`, que leva o texto "
                  "sem soltar os comentários.")
            return 1
        lista = c["novos"] + c["alterados"] + (c["editados_no_overleaf"] if args.forcar else [])
        if lista:
            print(f"\n📤 enviando {len(lista)} arquivo(s)")
            enviar(s, pid, lista)
    return 0


if __name__ == "__main__":
    sys.exit(main())
