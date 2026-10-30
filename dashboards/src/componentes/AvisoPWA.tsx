import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { guardarMotorNoCache } from "../lib/db";

// O painel como PWA: avisa quando já funciona sem internet (o cache ficou
// pronto) e quando há versão nova. A versão nova espera o clique em
// "Atualizar": recarregar sozinho derrubaria uma apresentação no meio.
export function AvisoPWA() {
  const {
    offlineReady: [pronto, setPronto],
    needRefresh: [novaVersao, setNovaVersao],
    updateServiceWorker,
  } = useRegisterSW();

  // "Pronto para usar sem internet" só depois que o motor do DuckDB também
  // estiver no cache do app, e não só os arquivos do site.
  const [motorGuardado, setMotorGuardado] = useState(false);
  useEffect(() => {
    if (!pronto) return;
    guardarMotorNoCache().then(() => setMotorGuardado(true)).catch(() => setPronto(false));
  }, [pronto, setPronto]);
  useEffect(() => {
    if (!motorGuardado) return;
    const t = setTimeout(() => { setPronto(false); setMotorGuardado(false); }, 6000);
    return () => clearTimeout(t);
  }, [motorGuardado, setPronto]);

  // Ativa a versão nova e recarrega quando ela assumir a página. O reload do
  // próprio plugin depende de um evento que, com o service worker assumindo a
  // página na instalação, não chega; o do navegador (controllerchange) chega,
  // e o tempo limite cobre o caso de a troca já ter acontecido.
  const atualizar = () => {
    navigator.serviceWorker?.addEventListener("controllerchange", () => window.location.reload(), { once: true });
    void updateServiceWorker(true);
    setTimeout(() => window.location.reload(), 3000);
  };

  if (!(pronto && motorGuardado) && !novaVersao) return null;
  return (
    <div
      role="status"
      className="fixed bottom-20 left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border border-borda bg-superficie px-4 py-2 text-[13px] text-tinta shadow-xl"
    >
      {novaVersao ? (
        <>
          <span>Nova versão do painel disponível</span>
          <button type="button" onClick={atualizar} className="rounded-full bg-acento px-3 py-1 font-medium text-sobre-acento">
            Atualizar
          </button>
          <button type="button" aria-label="Agora não" onClick={() => setNovaVersao(false)} className="text-lg leading-none text-tinta-3 hover:text-tinta">
            ×
          </button>
        </>
      ) : (
        <span>Pronto para usar sem internet</span>
      )}
    </div>
  );
}
