"""
Silver RAIS completa — a mesma tradução da silver de TI, sem o recorte de
tecnologia: todas as ocupações e setores, publicadas em
Gianpedro/silver-rais para quem quiser consumir a base inteira já
traduzida.

O código é um só (silver-rais-ti.py): este arquivo só liga o modo --completa,
para que as duas silvers nunca traduzam de jeitos diferentes.

    python silver-rais-completa.py --modo verificar [--ano-inicio N] [--ano-fim N] [--forcar]
    python silver-rais-completa.py --modo processar --tabela X --ano-inicio Y --ano-fim Y
"""
import runpy
import sys
from pathlib import Path

sys.argv.insert(1, "--completa")
runpy.run_path(str(Path(__file__).with_name("silver-rais-ti.py")), run_name="__main__")
