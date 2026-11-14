/** A pergunta de um bloco da seção e a resposta em uma frase, gerada dos dados da área. */
export function Titulo({ pergunta, resposta }: { pergunta: string; resposta?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-semibold tracking-tight">{pergunta}</h2>
      {resposta && <p className="max-w-3xl text-muted-foreground">{resposta}</p>}
    </div>
  );
}
