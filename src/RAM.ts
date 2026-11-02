type Pagina = {
    pid: number;
    numero: number;
    carregadaEm: number;   // Para FIFO
    ultimoAcesso: number;  // Para LRU
    protegida: boolean;
};


type Politica = "fifo" | "lru";

export class MemoriaRAM {
    private quadros: (Pagina | null)[];
    private relogio = 0;

    constructor(
        quantidadeQuadros: number,
        private politica: Politica
    ) {
        this.quadros = Array(quantidadeQuadros).fill(null);
    }

    acessar(pid: number, numero: number) {
        this.relogio++;

        // Verificar se a página já está na RAM
        const pagina = this.quadros.find(
            p => p?.pid === pid && p.numero === numero
        );

        if (pagina) {
            pagina.ultimoAcesso = this.relogio;
            pagina.protegida = false;
            return "hit";
        }

        // Page fault: procurar quadro livre
        let indice = this.quadros.findIndex(p => p === null);

        // Se não houver quadro livre, substituir uma página
        if (indice === -1) {
            const candidatos = this.quadros
                .map((p, i) => ({ pagina: p!, indice: i }))
                .filter(x => !x.pagina.protegida);

            if (candidatos.length === 0) return "sem_vitima";

            const criterio = this.politica === "fifo"
                ? "carregadaEm"
                : "ultimoAcesso";

            candidatos.sort(
                (a, b) => a.pagina[criterio] - b.pagina[criterio]
            );

            indice = candidatos[0]?.indice as number;
        }

        this.quadros[indice] = {
            pid,
            numero,
            carregadaEm: this.relogio,
            ultimoAcesso: this.relogio,
            protegida: true
        };

        return "page_fault";
    }

    liberar(pid: number) {
        this.quadros = this.quadros.map(
            p => p?.pid === pid ? null : p
        );
    }

    visualizar() {
        return this.quadros;
    }
}

