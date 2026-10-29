"""
Ponte com o Hugging Face Hub — leitura (hf://, via DuckDB) e escrita
(arquivo local temporário, publicado e apagado) das camadas bronze/silver/
gold. Sem MinIO: este é o único modo que o projeto roda hoje.

Os dicionários do MTE (CBO, CNAE, escolaridade, ...) são a única parte que
isto não deriva sozinho: mudam raramente, e são publicados à mão por
`_utils/dicionario.py --modo extrair` — os jobs de bronze/silver/gold só
leem o que já está publicado.
"""
import os
import re
import time
from pathlib import Path

REPO_BRONZE_CAGED = os.getenv("REPO_BRONZE_CAGED", "Gianpedro/bronze-caged")
REPO_BRONZE_RAIS = os.getenv("REPO_BRONZE_RAIS", "Gianpedro/bronze-rais")
REPO_SILVER_TI_CAGED = os.getenv("REPO_SILVER_TI_CAGED", "Gianpedro/silver-caged-ti")
REPO_SILVER_TI_RAIS = os.getenv("REPO_SILVER_TI_RAIS", "Gianpedro/silver-rais-ti")
REPO_GOLD = os.getenv("REPO_GOLD", "Gianpedro/gold-analise-mercado-ti")
REPO_DICIONARIOS = os.getenv("REPO_DICIONARIOS", "Gianpedro/mte-dicionarios")

# Staging do job — some ao final, não precisa sobreviver entre execuções.
DIR_TEMP = Path(os.getenv("STAGING_DIR") or ".") / "_staging"

# Mesma pasta que o publicador da gold lê pra subir ao Hub.
DIR_GOLD_LOCAL = Path(__file__).resolve().parents[2] / "publicacao" / "gold"


def repo_bronze(tabela: str) -> str:
    return REPO_BRONZE_RAIS if tabela.startswith("rais") else REPO_BRONZE_CAGED


def repo_silver_ti(tabela: str) -> str:
    return REPO_SILVER_TI_RAIS if tabela.startswith("rais") else REPO_SILVER_TI_CAGED


def fonte_leitura(repo: str, prefixo: str = "") -> str:
    """`hf://datasets/<repo>/<prefixo>` — caminho de UM arquivo (ou glob, só no dashboard)."""
    prefixo = prefixo.lstrip("/")
    return f"hf://datasets/{repo}/{prefixo}" if prefixo else f"hf://datasets/{repo}"


def _glob_para_regex(padrao: str) -> re.Pattern:
    """Mesma semântica de glob do DuckDB: `**/` casa zero ou mais pastas, `*` e `?` não cruzam `/`."""
    partes, i = [], 0
    while i < len(padrao):
        if padrao.startswith("**/", i):
            partes.append("(?:[^/]+/)*")
            i += 3
        elif padrao.startswith("**", i):
            partes.append(".*")
            i += 2
        elif padrao[i] == "*":
            partes.append("[^/]*")
            i += 1
        elif padrao[i] == "?":
            partes.append("[^/]")
            i += 1
        else:
            partes.append(re.escape(padrao[i]))
            i += 1
    return re.compile("".join(partes))


def fonte_parquet(repo: str, padrao: str) -> str:
    """
    Expressão pronta pra `read_parquet(...)` — o chamador NÃO põe aspas em
    volta: é a lista explícita dos arquivos do repo que casam com o glob.

    Passar o glob `hf://.../**/*.parquet` ao DuckDB faz ele listar o repo
    pasta por pasta: medido, 86 chamadas à API só pra expandir `caged_mov`
    (uma por ano/mês). Com vários jobs em paralelo, isso bate o limite de
    taxa do Hub (HTTP 429) na listagem. Aqui a listagem é uma por repo e
    processo (arquivos_remotos), e o DuckDB recebe os arquivos prontos — as
    colunas de partição hive e o filtro por partição continuam funcionando.

    Nada casando, devolve um padrão LOCAL que não existe: o DuckDB falha na
    hora com "No files found", que os chamadores tratam como "ainda não
    publicado". Devolver o glob hf:// seria pior que inútil: numa pasta que
    ainda não existe no Hub (um ano novo, por exemplo) ele dá HTTP 404, e a
    verificação da bronze leria isso como erro e assumiria "já existe".
    """
    padrao = padrao.lstrip("/")
    regex = _glob_para_regex(padrao)
    arquivos = sorted(a for a in arquivos_remotos(repo) if regex.fullmatch(a))
    if not arquivos:
        return f"'{DIR_TEMP.as_posix()}/_nada_no_hub/{repo.replace('/', '__')}/{padrao}'"
    return "[" + ", ".join(f"'{fonte_leitura(repo, a)}'" for a in arquivos) + "]"


def fonte_bronze(tabela: str, resto: str = "**/*.parquet") -> str:
    return fonte_parquet(repo_bronze(tabela), f"{tabela}/{resto}")


def fonte_silver_ti(tabela: str, resto: str = "**/*.parquet") -> str:
    return fonte_parquet(repo_silver_ti(tabela), f"{tabela}/{resto}")


def glob_silver_ti(tabela: str, resto: str = "**/*.parquet") -> str:
    """Glob cru, só pro dashboard: ele não instala huggingface_hub, então não lista."""
    return fonte_leitura(repo_silver_ti(tabela), f"{tabela}/{resto}")


def caminho_gold(nome: str) -> str:
    """Arquivo local que tanto lê quanto grava uma tabela da gold final."""
    return str(DIR_GOLD_LOCAL / f"{nome}.parquet")


_cache_listagem: dict[str, set] = {}


def arquivos_remotos(repo: str, forcar: bool = False) -> set:
    """
    Lista (uma vez por processo, salvo `forcar`) os arquivos já publicados.

    A listagem também cai no limite de taxa do Hub; espera e tenta de novo
    (8s, 16, 32, 64, 128). Repo inexistente não é transitório: sobe na hora.
    """
    if forcar or repo not in _cache_listagem:
        import time
        from huggingface_hub import HfApi
        from huggingface_hub.errors import RepositoryNotFoundError

        for espera in (8, 16, 32, 64, 128, None):
            try:
                _cache_listagem[repo] = set(HfApi().list_repo_files(repo, repo_type="dataset"))
                break
            except RepositoryNotFoundError:
                raise
            except Exception as e:
                if espera is None:
                    raise
                print(f"      ⏳ listagem de {repo} falhou ({str(e)[:80]}), esperando {espera}s...")
                time.sleep(espera)
    return _cache_listagem[repo]


def existe_remoto(repo: str, caminho: str) -> bool:
    try:
        return caminho in arquivos_remotos(repo)
    except Exception:
        return False  # repo ainda não existe (primeira execução)


def anos_no_repo(repo: str, tabela: str, chave_particao: str) -> set[int]:
    """
    Anos (`ano=`/`ano_particao=`) já presentes num repo, por LISTAGEM — sem
    ler dado. Usado pra decidir "bronze tem o que a silver não tem" e
    "silver tem o que a gold não tem" sem bater limite de taxa do Hub.
    """
    import re

    anos = set()
    for caminho in arquivos_remotos(repo):
        if not caminho.startswith(f"{tabela}/"):
            continue
        m = re.search(rf"{chave_particao}=(\d{{4}})", caminho)
        if m:
            anos.add(int(m.group(1)))
    return anos


_cache_fontes: dict[tuple, set] = {}

# Tabelas grandes o bastante (30+ GB) pra NÃO caber numa leitura só — só
# essas ficam com a consulta restrita ao ano. As do CAGED (cada uma, no
# máximo, algumas centenas de MB somando todos os anos) leem inteiras de
# uma vez, o que evita bater limite de taxa do Hub (ver caminhos_fonte_ingeridos).
TABELAS_GRANDES = {"rais_vinc", "rais_estab"}


def caminhos_fonte_ingeridos(tabela: str, ano: int) -> set:
    """
    Caminhos do FTP (`caminho_fonte`, coluna gravada em toda linha da
    bronze) já representados no repositório de bronze — NÃO pelo nome do
    arquivo de destino (arquivo grande é quebrado em `_parteNN` só na
    publicação; o nome "sem parte" nunca existe sozinho no Hub).
    """
    tabela_inteira = tabela not in TABELAS_GRANDES
    chave = tabela if tabela_inteira else (tabela, ano)
    if chave in _cache_fontes:
        resultado = _cache_fontes[chave]
        if resultado is None:
            raise RuntimeError(f"consulta de caminho_fonte de {chave} já tinha "
                                "falhado nesta execução (ver tentativa original acima)")
        return resultado

    import time
    import duckdb

    alvo_log = tabela if tabela_inteira else f"{tabela}/{ano}"
    print(f"      🔗 consultando {alvo_log} no Hub...")

    con = duckdb.connect()
    con.execute("INSTALL httpfs; LOAD httpfs; SET enable_progress_bar=false;")
    aplicar_secret_hf(con)
    # "ano={ano}*" casa tanto ano=2022 quanto ano=2022_parcial.
    origem = fonte_bronze(tabela) if tabela_inteira else fonte_bronze(tabela, f"ano={ano}*/**/*.parquet")

    # Limite de taxa do Hub: a janela observada na prática foi de até 300s.
    # 6 tentativas com espera crescente (8s, 16, 32, 64, 128, 256 ≈ 504s)
    # cobre isso sem travar o job por tempo absurdo se o erro for outro.
    erro_final = None
    esperas = [8, 16, 32, 64, 128]
    for tentativa in range(6):
        try:
            linhas = con.execute(
                f"SELECT DISTINCT caminho_fonte FROM read_parquet({origem}, union_by_name=true)"
            ).fetchall()
            fontes = {r[0] for r in linhas if r[0]}
            _cache_fontes[chave] = fontes
            return fontes
        except Exception as e:
            # "No files found" é resposta válida (nada publicado ainda) —
            # qualquer outro erro (rede, timeout, limite de taxa) é
            # transitório e vale tentar de novo.
            if "No files found" in str(e):
                _cache_fontes[chave] = set()
                return set()
            erro_final = e
            if tentativa < len(esperas):
                espera = esperas[tentativa]
                print(f"      ⏳ {alvo_log}: tentativa {tentativa + 1}/6 falhou "
                      f"({str(e)[:80]}), esperando {espera}s...")
                time.sleep(espera)

    # Cacheia a FALHA (None, não set()) pra não martelar de novo no mesmo
    # processo, e levanta — um set() vazio aqui seria lido como "nada
    # publicado ainda" e reprocessaria à toa (ou duplicaria dado existente).
    _cache_fontes[chave] = None
    alvo = tabela if tabela_inteira else f"{tabela} (ano {ano})"
    raise RuntimeError(
        f"não consegui consultar caminho_fonte de {alvo} depois de 6 tentativas: {erro_final}"
    )


# O Hub aceita 128 commits por hora em cada repositório, e na Bronze cada mês
# é um commit: com quatro anos em paralelo o limite estoura (HTTP 429) e os
# meses seguintes falhavam todos. A espera cresce até cobrir a janela inteira
# de uma hora (53 min somados); passou disso, o erro sobe.
ESPERAS_LIMITE_HUB = (60, 120, 300, 600, 900, 1200)


def com_espera_no_limite(acao, descricao: str):
    from huggingface_hub.utils import HfHubHTTPError

    for tentativa, espera in enumerate((0, *ESPERAS_LIMITE_HUB)):
        if espera:
            print(f"      ⏳ limite de commits do Hub (429) em {descricao}: "
                  f"nova tentativa em {espera // 60} min ({tentativa}/{len(ESPERAS_LIMITE_HUB)})", flush=True)
            time.sleep(espera)
        try:
            return acao()
        except HfHubHTTPError as e:
            if getattr(e.response, "status_code", None) != 429 or tentativa == len(ESPERAS_LIMITE_HUB):
                raise


def publicar_arquivo(local: Path, repo: str, caminho_repo: str, privado: bool = False) -> None:
    from huggingface_hub import HfApi

    api = HfApi()
    api.create_repo(repo_id=repo, repo_type="dataset", exist_ok=True, private=privado)
    com_espera_no_limite(lambda: api.upload_file(path_or_fileobj=str(local), path_in_repo=caminho_repo,
                                                 repo_id=repo, repo_type="dataset"), caminho_repo)
    arquivos_remotos(repo).add(caminho_repo)  # mantém o cache coerente sem relistar


def publicar_diretorio(local_dir: Path, repo: str, prefixo_repo: str = "") -> int:
    """
    Sobe toda a árvore local (resultado de um COPY particionado hive) pro
    Hugging Face, preservando a estrutura de pastas, e apaga o local ao
    final. Em lote (um commit): um COPY com PARTITION_BY pode gerar várias
    subpastas de uma vez (um arquivo-fonte do CAGED antigo pode espalhar
    linhas por vários ano_particao/mes_particao).
    """
    arquivos = sorted(local_dir.rglob("*.parquet"))
    if not arquivos:
        return 0

    from huggingface_hub import HfApi, CommitOperationAdd

    api = HfApi()
    api.create_repo(repo_id=repo, repo_type="dataset", exist_ok=True)
    operacoes = [
        CommitOperationAdd(
            path_in_repo=(f"{prefixo_repo}/{arq.relative_to(local_dir).as_posix()}"
                          if prefixo_repo else arq.relative_to(local_dir).as_posix()),
            path_or_fileobj=str(arq),
        )
        for arq in arquivos
    ]
    com_espera_no_limite(lambda: api.create_commit(repo_id=repo, repo_type="dataset", operations=operacoes,
                                                   commit_message=f"{len(operacoes)} arquivo(s)"), prefixo_repo or repo)
    _cache_listagem.pop(repo, None)  # relista na próxima consulta: mudou de verdade

    for arq in arquivos:
        arq.unlink()
    return len(arquivos)


def publicar_particoes(con, local_dir: Path, repo: str, tabela: str) -> int:
    """
    Publica a reconstrução de uma tabela da silver SUBSTITUINDO os anos
    reconstruídos, em vez de acrescentar arquivos a eles.

    `publicar_diretorio` só acrescenta: os pedaços novos (um por arquivo de
    origem) ficariam ao lado do arquivo consolidado que já existia na
    partição, e toda consulta à pasta contaria o ano em dobro, sem erro. Aqui:

    - cada partição local vira UM arquivo `<tabela>_<ano>[_<mês>].parquet`,
      o mesmo nome da camada consolidada;
    - tudo o que existia em `<tabela>/ano_particao=<ano>/` sai no mesmo
      commit. Substituir o ano inteiro, e não partição a partição, é seguro
      porque `ano_particao`/`mes_particao` são o ano e o mês do ARQUIVO de
      origem (gravados na bronze): reconstruir um ano lê todos os arquivos
      dele, então nenhuma linha de outro ano é perdida. E cobre partições
      que mudaram de forma (o caged_ajustes antigo, anual na bronze, estava
      em pastas mensais na camada migrada);
    - também saem os arquivos que as primeiras execuções em nuvem gravaram
      na RAIZ do repositório (`ano_particao=<ano>/...`, sem a pasta da
      tabela), que nenhuma consulta lia.
    """
    import re

    folhas = sorted({p.parent for p in local_dir.rglob("*.parquet")})
    if not folhas:
        return 0

    from huggingface_hub import CommitOperationAdd, CommitOperationDelete, HfApi

    remotos = arquivos_remotos(repo, forcar=True)
    consolidado_dir = local_dir.parent / f"_consolidado_{tabela}"
    consolidado_dir.mkdir(parents=True, exist_ok=True)
    adicionar, anos = [], set()
    for folha in folhas:
        rel = folha.relative_to(local_dir).as_posix()
        valores = dict(re.findall(r"(\w+_particao)=([^/]+)", rel))
        ano, mes = valores["ano_particao"], valores.get("mes_particao", "")
        anos.add(ano)
        nome = f"{tabela}_{ano}" + (f"_{mes}" if mes.isdigit() else "") + ".parquet"
        saida = consolidado_dir / rel / nome
        saida.parent.mkdir(parents=True, exist_ok=True)
        # Sem hive_partitioning: as colunas de partição ficam no caminho, não
        # no arquivo — igual aos arquivos consolidados que já estão no Hub.
        con.execute(f"""
            COPY (SELECT * FROM read_parquet('{folha.as_posix()}/*.parquet',
                                             hive_partitioning = false, union_by_name = true))
            TO '{saida.as_posix()}' (FORMAT PARQUET, COMPRESSION 'ZSTD', COMPRESSION_LEVEL 3)
        """)
        adicionar.append(CommitOperationAdd(path_in_repo=f"{tabela}/{rel}/{nome}", path_or_fileobj=str(saida)))

    novos = {op.path_in_repo for op in adicionar}
    apagar = [
        caminho for caminho in remotos
        if caminho not in novos and caminho.endswith(".parquet") and any(
            caminho.startswith(f"{tabela}/ano_particao={a}/")
            or (caminho.startswith(f"ano_particao={a}/") and caminho.rsplit("/", 1)[-1].startswith(f"{tabela}_"))
            for a in anos)
    ]
    operacoes = adicionar + [CommitOperationDelete(path_in_repo=c) for c in apagar]
    com_espera_no_limite(lambda: HfApi().create_commit(
        repo_id=repo, repo_type="dataset", operations=operacoes,
        commit_message=f"{tabela}: ano(s) {', '.join(sorted(anos))} substituído(s) "
                       f"({len(adicionar)} arquivo(s), {len(apagar)} removido(s))"), tabela)
    _cache_listagem.pop(repo, None)
    print(f"   ☁️  {tabela}: {len(adicionar)} partição(ões) publicada(s), {len(apagar)} arquivo(s) antigo(s) removido(s)")

    import shutil
    shutil.rmtree(consolidado_dir, ignore_errors=True)
    for arq in local_dir.rglob("*.parquet"):
        arq.unlink()
    return len(adicionar)


def preparar_staging() -> None:
    DIR_TEMP.mkdir(parents=True, exist_ok=True)


def aplicar_secret_hf(con) -> None:
    """
    Autentica as leituras `hf://` do DuckDB com o HF_TOKEN do ambiente, e
    deixa o retry de HTTP mais paciente.

    Sem o SECRET explícito, toda leitura `hf://` via DuckDB é ANÔNIMA — o
    DuckDB não lê a variável de ambiente HF_TOKEN sozinho. E mesmo
    autenticado, o download do arquivo em si (resolve/main/...) tem limite
    de taxa próprio (do CDN) — por isso o retry mais paciente também.

    O `http_timeout` importa tanto quanto o retry: sem ele, uma conexão que
    trava (sem responder, sem dar 429) nunca aciona o retry — fica parada
    até o job inteiro bater o limite do runner, em vez de falhar em minutos
    e deixar o retry de 6 tentativas (até ~504s) fazer o trabalho dele.
    """
    con.execute("INSTALL httpfs; LOAD httpfs;")
    con.execute("SET http_timeout=60000;")
    con.execute("SET http_retries=6;")
    con.execute("SET http_retry_wait_ms=8000;")
    con.execute("SET http_retry_backoff=2;")

    token = (os.getenv("HF_TOKEN") or "").strip()  # espaço ou quebra de linha no segredo invalida o cabeçalho
    if not token:
        return
    con.execute(f"""
        CREATE OR REPLACE SECRET secret_hf (
            TYPE huggingface,
            TOKEN '{token.replace("'", "''")}'
        );
    """)


DUCKDB_MEMORY_LIMIT = os.getenv("DUCKDB_MEMORY_LIMIT", "4GB")
DUCKDB_THREADS = os.getenv("DUCKDB_THREADS")  # vazio = deixa o DuckDB decidir
DIR_SPILL = DIR_TEMP / "duckdb_spill"


def conectar_duckdb():
    """
    Conexão DuckDB padrão do projeto: httpfs + secret do Hub + ajustes de
    memória (a RAIS passa de 10 GB descompactada — sem spill pra disco, o
    runner do Actions (7 GB de RAM) estoura).
    """
    import duckdb

    con = duckdb.connect()
    con.execute("SET enable_progress_bar=false;")
    aplicar_secret_hf(con)

    DIR_SPILL.mkdir(parents=True, exist_ok=True)
    con.execute(f"SET memory_limit='{DUCKDB_MEMORY_LIMIT}';")
    con.execute(f"SET temp_directory='{DIR_SPILL.as_posix()}';")
    con.execute("SET preserve_insertion_order=false;")
    if DUCKDB_THREADS:
        con.execute(f"SET threads={int(DUCKDB_THREADS)};")
    return con
