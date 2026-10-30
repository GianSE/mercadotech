import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// O painel de um menu suspenso, desenhado fora da página (no body), em
// posição fixa logo abaixo do botão. Dentro da barra de filtros, ele dependia
// da ordem das camadas da página, e no modo apresentação em tela cheia os
// gráficos (canvas acelerado pela placa de vídeo, dentro de um bloco escalado)
// passavam por cima dele. Fora da página, nada o cobre.
export function Flutuante({ ancora, painel, className, children }: {
  ancora: RefObject<HTMLElement | null>;
  // Para o "clique fora" do menu reconhecer o painel, que não está mais dentro dele.
  painel: RefObject<HTMLDivElement | null>;
  className: string;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const largura = useRef(0);

  useLayoutEffect(() => {
    const medir = () => {
      const r = ancora.current?.getBoundingClientRect();
      if (!r) return;
      // Não passa da borda direita da tela.
      const w = painel.current?.offsetWidth || largura.current;
      largura.current = w;
      setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) });
    };
    medir();
    // Uma segunda medida já com a largura real do painel desenhado.
    const quadro = requestAnimationFrame(medir);
    window.addEventListener("resize", medir);
    window.addEventListener("scroll", medir, true);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("resize", medir);
      window.removeEventListener("scroll", medir, true);
    };
  }, [ancora, painel]);

  return createPortal(
    <div
      ref={painel}
      className={className}
      style={{ position: "fixed", zIndex: 70, top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos ? `calc(100vh - ${pos.top + 12}px)` : undefined, overflowY: "auto" }}
    >
      {children}
    </div>,
    document.body,
  );
}
