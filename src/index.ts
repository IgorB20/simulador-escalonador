import { MemoriaRAM } from "./RAM.js";

export type BurstCPU = {
    cpu: number;
    refs: number[];
};

export type BurstES = {
    es: number;
};

export type EstadoProcesso =
    | "novo"
    | "pronto"
    | "executando"
    | "bloqueado"
    | "terminado";

export type Processo = {
    // Dados do JSON
    pid: number;
    chegada: number;
    classe: "curto" | "longo";
    paginas: number;
    bursts: (BurstCPU | BurstES)[];

    // Dados da simulação
    estado?: EstadoProcesso;
    burstAtual?: number;
    executado?: number;
    faultPendente?: boolean;
};

// const processos: Processo[] = [
//     {
//         pid: 1,
//         chegada: 0,
//         classe: "curto",
//         paginas: 6,
//         bursts: [
//             { cpu: 6, refs: [0, 1, 1, 2, 3, 0] }
//         ]
//     },
//     {
//         pid: 2,
//         chegada: 1,
//         classe: "curto",
//         paginas: 6,
//         bursts: [
//             { cpu: 8, refs: [0, 1, 2, 2, 3, 4, 1, 0] }
//         ]
//     },
//     {
//         pid: 3,
//         chegada: 2,
//         classe: "curto",
//         paginas: 6,
//         bursts: [
//             { cpu: 7, refs: [0, 1, 1, 2, 3, 4, 0] }
//         ]
//     },
//     {
//         pid: 4,
//         chegada: 3,
//         classe: "curto",
//         paginas: 6,
//         bursts: [
//             { cpu: 3, refs: [0, 1, 2] }
//         ]
//     }
// ];

const processos: Processo[] = [
    {
        pid: 1,
        chegada: 0,
        classe: "curto",
        paginas: 6,
        bursts: [
            { cpu: 3, refs: [0, 1, 1] },
            { es: 5 },
            { cpu: 2, refs: [2, 3] }
        ]
    },
    {
        pid: 2,
        chegada: 1,
        classe: "curto",
        paginas: 6,
        bursts: [
            { cpu: 2, refs: [0, 0] },
            { es: 3 },
            { cpu: 3, refs: [1, 2, 2] }
        ]
    },
    {
        pid: 3,
        chegada: 2,
        classe: "curto",
        paginas: 6,
        bursts: [
            { cpu: 4, refs: [0, 1, 0, 2] }
        ]
    }
];

function obterBurstCPU(processo: Processo): BurstCPU {
    const burst = processo.bursts[processo.burstAtual ?? 0];

    if (!burst || !("cpu" in burst)) {
        throw new Error(`P${processo.pid} não está em um burst de CPU`);
    }

    return burst;
}

class CPU {
    public disponivel = true;
    public processoAtual: Processo | null = null;

    executarUnidade(): boolean {
        if (!this.processoAtual) return false;

        const processo = this.processoAtual;
        const burst = obterBurstCPU(processo);

        processo.executado = (processo.executado ?? 0) + 1;

        return processo.executado >= burst.cpu;
    }
}

class SO {
    private time: number = 0;
    private cpus: any = [];
    private fila_prontos: Processo[] = []; // prontos
    private ram = new MemoriaRAM(256, "fifo");
    private totalPageFaults = 0;

    private fila_bloqueados: {
        processo: Processo;
        retorno: number; // tempo de retorno do bloqueio
    }[] = [];

    constructor(num_cpus: number) {
        for (let i = 0; i < num_cpus; i++) {
            this.cpus.push(new CPU());
        }
    }

    execute() {
        let terminados = 0;

        while (terminados < processos.length) {

            // 1. Verificar chegadas
            const chegadas = processos.filter(
                p => p.chegada === this.time
            );

            // 2. Verificar retornos de E/S e page fault
            const retornos = this.fila_bloqueados
                .filter(b => b.retorno === this.time)
                .map(b => b.processo);

            this.fila_bloqueados = this.fila_bloqueados.filter(
                b => b.retorno > this.time
            );

            for (const p of [...chegadas, ...retornos].sort((a, b) => a.pid - b.pid)) {
                p.estado = "pronto";
                this.fila_prontos.push(p);
            }

            // 3. Ordenar fila de prontos
            this.fila_prontos = this.SJF();

            // CPUs que terminaram um burst neste instante
            const burstsConcluidos: CPU[] = [];

            // 4. Executar CPUs
            for (const cpu of this.cpus) {

                while (true) {

                    // Despachar processo
                    if (cpu.disponivel) {
                        const p = this.fila_prontos.shift();
                        if (!p) break;

                        cpu.processoAtual = p;
                        cpu.disponivel = false;
                        p.estado = "executando";
                    }

                    const p = cpu.processoAtual!;
                    const burst = obterBurstCPU(p);

                    const indice = p.executado ?? 0;
                    const pagina = burst.refs[indice];

                    if (pagina === undefined) {
                        throw new Error(`Referência inválida em P${p.pid}`);
                    }

                    // 5. Acessar RAM
                    const resultado = this.ram.acessar(p.pid, pagina);

                    if (resultado !== "hit") {

                        if (!p.faultPendente) {
                            this.totalPageFaults++;
                            p.faultPendente = true;
                        }

                        p.estado = "bloqueado";

                        this.fila_bloqueados.push({
                            processo: p,
                            retorno: this.time + 20
                        });

                        console.log(`[t=${this.time}] P${p.pid}: ${resultado}`);

                        cpu.processoAtual = null;
                        cpu.disponivel = true;

                        // Tentar outro processo na mesma CPU
                        continue;
                    }

                    p.faultPendente = false;

                    // 6. Executar uma unidade de CPU
                    const terminouBurst = cpu.executarUnidade();

                    if (terminouBurst) {
                        burstsConcluidos.push(cpu);
                    }

                    break;
                }
            }

            // 7. Tratar bursts concluídos no fim da unidade
            for (const cpu of burstsConcluidos) {
                const p = cpu.processoAtual!;
                const indiceAtual = p.burstAtual ?? 0;
                const proximo = p.bursts[indiceAtual + 1];

                if (proximo && "es" in proximo) {

                    // Existe E/S após o burst de CPU
                    const retorno = this.time + 1 + proximo.es;

                    p.estado = "bloqueado";
                    p.burstAtual = indiceAtual + 2;
                    p.executado = 0;

                    this.fila_bloqueados.push({
                        processo: p,
                        retorno
                    });

                    console.log(
                        `[t=${this.time + 1}] P${p.pid} iniciou E/S. Retorno em t=${retorno}`
                    );

                } else if (!proximo) {

                    // Não existem mais bursts: processo terminou
                    p.estado = "terminado";

                    this.ram.liberar(p.pid);
                    terminados++;

                    console.log(
                        `[t=${this.time + 1}] P${p.pid} terminou`
                    );
                } else {
                    throw new Error(`Sequência de bursts inválida em P${p.pid}`);
                }

                cpu.processoAtual = null;
                cpu.disponivel = true;
            }

            // 8. Avançar o relógio
            this.time++;
        }

        console.log(`Tempo total: ${this.time}`);
        console.log(`Page faults: ${this.totalPageFaults}`);
    }

    SJF(): Processo[] {
        return this.fila_prontos.sort((a, b) => {
            const burstA = obterBurstCPU(a);
            const burstB = obterBurstCPU(b);

            const restanteA = burstA.cpu - (a.executado ?? 0);
            const restanteB = burstB.cpu - (b.executado ?? 0);

            return restanteA - restanteB;
        });
    }
}


const so = new SO(1);
so.execute();

//so.SJF();


// const cpu = new CPU();

// for (const p of processos) {
//     await cpu.execute(p);
// }


/*

const ram = new MemoriaRAM(256, "fifo");

console.log(ram.acessar(1, 0)); // page_fault
console.log(ram.acessar(1, 0)); // hit
console.log(ram.acessar(2, 3)); // page_fault
console.log(ram.acessar(2, 3)); // hit

console.log(ram.visualizar());

// Quando P1 terminar:
ram.liberar(1);

*/
