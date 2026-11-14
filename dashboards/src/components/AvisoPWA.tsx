import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Button } from "./ui/button";

// O site como PWA: avisa quando já abre sem internet (o cache ficou pronto)
// e quando há versão nova. A versão nova espera o clique em "Atualizar":
// recarregar sozinho derrubaria quem está no meio de uma análise.
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
    // Sob demanda: a biblioteca do DuckDB fica fora do carregamento da página
    // inicial, que não a usa (só as seções com SQL).
    import("../lib/db")
      .then((m) => m.guardarMotorNoCache())
      .then(() => setMotorGuardado(true))
      .catch(() => setPronto(false));
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
      className="fixed bottom-4 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-3 rounded-full border bg-card px-4 py-2 text-sm text-card-foreground shadow-lg"
    >
      {novaVersao ? (
        <>
          <span>Nova versão do site disponível</span>
          <Button size="sm" className="rounded-full" onClick={atualizar}>
            Atualizar
          </Button>
          <button
            type="button"
            aria-label="Agora não"
            onClick={() => setNovaVersao(false)}
            className="text-lg leading-none text-muted-foreground hover:text-foreground"
          >
            ×
          </button>
        </>
      ) : (
        <span>Pronto para usar sem internet</span>
      )}
    </div>
  );
}
