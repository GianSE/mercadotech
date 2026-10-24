"""
Notificação no Telegram — um lugar só, em vez do bloco de curl repetido em
cada workflow do Actions.

Uso:
    from _utils.telegram import notificar
    notificar("🏁 Bronze CAGED concluído")
"""
import json
import os
import re
import urllib.request


def notificar(mensagem: str) -> bool:
    """
    Envia uma mensagem ao Telegram. Silenciosamente não faz nada se as
    credenciais não estiverem no ambiente (ex.: rodando local, sem secret).
    """
    token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    chat_id = (os.getenv("TELEGRAM_CHAT_ID") or "").strip()
    if not token or not chat_id:
        print("   (Telegram não configurado — pulando notificação)")
        return False

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    # No Markdown do Telegram, o "_" de "caged_mov" abre um itálico que nunca
    # fecha, e a mensagem inteira volta com HTTP 400. Escapa o "_" no meio
    # de palavra; o *negrito* das mensagens continua valendo.
    formatada = re.sub(r"(?<=\w)_(?=\w)", r"\\_", mensagem)
    tentativas = ({"text": formatada, "parse_mode": "Markdown"},
                  # Se a formatação ainda for recusada, vai como texto puro:
                  # perder o negrito é melhor que perder o aviso.
                  {"text": mensagem.replace("*", "")})

    erro = None
    for extra in tentativas:
        corpo = json.dumps({"chat_id": chat_id, **extra}).encode("utf-8")
        try:
            req = urllib.request.Request(
                url, data=corpo, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=10):
                pass
            return True
        except Exception as e:
            erro = e
    print(f"   ⚠️  falha ao notificar no Telegram: {erro}")
    return False
