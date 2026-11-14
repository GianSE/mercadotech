import { lazy, Suspense, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import { AvisoPWA } from "./components/AvisoPWA";
import { Cabecalho, Rodape } from "./components/Cabecalho";
import { ProvedorTema } from "./lib/tema";

// A página traz o ECharts e as seções; carregada à parte do cabeçalho.
const Area = lazy(() => import("./paginas/Area").then((m) => ({ default: m.Area })));

/*
 * O site antigo navegava pelo hash (#/estoque, #/mapa). Um link guardado ou
 * citado continua chegando à seção que responde a mesma pergunta.
 */
const HASH_ANTIGO: Record<string, string> = {
  pesquisa: "", recorte: "metodo", estoque: "crescimento", fluxo: "crescimento", ocupacoes: "crescimento", "comparar-estados": "crescimento",
  setor: "onde", mapa: "onde", trajetoria: "onde", salario: "qualidade", permanencia: "qualidade", perfil: "equidade", "hiato-salarial": "equidade",
  previsao: "futuro", "estoque-atual": "futuro", respostas: "", "metodo-dados": "metodo",
};

function redirecionarHashAntigo() {
  const m = window.location.hash.match(/^#\/([\w-]+)/);
  if (!m || !(m[1] in HASH_ANTIGO)) return;
  history.replaceState(null, "", `/${HASH_ANTIGO[m[1]]}${window.location.search}`);
}
redirecionarHashAntigo();

/**
 * Cada página nova começa no topo; com âncora no endereço (#ocupacao), rola até
 * ela. A seção chega carregada sob demanda, então a âncora é procurada por
 * alguns instantes antes de desistir.
 */
function VoltaAoTopo() {
  const [local] = useLocation();
  useEffect(() => {
    const ancora = window.location.hash.slice(1);
    if (!ancora) {
      window.scrollTo(0, 0);
      return;
    }
    let tentativas = 0;
    const procurar = window.setInterval(() => {
      const alvo = document.getElementById(ancora);
      if (alvo || ++tentativas > 30) {
        window.clearInterval(procurar);
        alvo?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 100);
    return () => window.clearInterval(procurar);
  }, [local]);
  return null;
}

export function App() {
  return (
    <ProvedorTema>
      <div className="flex min-h-dvh flex-col">
        <VoltaAoTopo />
        <Cabecalho />
        <div className="flex-1">
          <Suspense>
            <Switch>
              <Route path="/:secao?">{(p) => <Area secao={p.secao} />}</Route>
            </Switch>
          </Suspense>
        </div>
        <Rodape />
        <AvisoPWA />
      </div>
    </ProvedorTema>
  );
}
