import { createContext, useContext, useState, type ReactNode } from "react";

type Tema = "claro" | "escuro";

const Contexto = createContext<{ tema: Tema; alternar: () => void }>({ tema: "claro", alternar: () => {} });

/** O index.html já aplicou a classe antes da pintura; aqui só se lê e se troca. */
export function ProvedorTema({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(() =>
    document.documentElement.classList.contains("dark") ? "escuro" : "claro",
  );
  const alternar = () => {
    const novo = tema === "escuro" ? "claro" : "escuro";
    document.documentElement.classList.toggle("dark", novo === "escuro");
    try {
      localStorage.setItem("tema", novo);
    } catch {
      // Sem armazenamento (aba anônima, bloqueio): o tema vale só para esta visita.
    }
    setTema(novo);
  };
  return <Contexto.Provider value={{ tema, alternar }}>{children}</Contexto.Provider>;
}

export const useTema = () => useContext(Contexto);
