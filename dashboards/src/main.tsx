import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { ProvedorFiltro } from "./lib/filtro";
import { ProvedorTema } from "./lib/tema";

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <ProvedorTema>
      <ProvedorFiltro>
        <App />
      </ProvedorFiltro>
    </ProvedorTema>
  </StrictMode>,
);
