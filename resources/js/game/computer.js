import { createComputerPlayback } from './computer-playback.js';

export async function computerInput(sim, config = sim.config) {
    try { return await planInWorker(sim, config); }
    catch (error) {
        // Some browsers restrict workers. A failed worker must never consume
        // the computer's turn: use the same planner on this thread instead.
        console.warn('Computer worker unavailable; using local planner.', error);
        const { planComputerDecision } = await import('../engine/computer.js');
        const decision = planComputerDecision(config, sim.snapshot());
        return Object.assign(createComputerPlayback(decision.commands), { decision });
    }
}

function planInWorker(sim, config) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./computer-worker.js', import.meta.url), { type: 'module' });
        const timeout = () => { worker.terminate(); reject(new Error('Computer planning timed out')); };
        let timer = setTimeout(timeout, 8000);
        const cleanup = () => { clearTimeout(timer); worker.terminate(); };
        worker.onerror = (event) => { cleanup(); reject(new Error(event.message)); };
        worker.onmessage = ({ data }) => {
            if (data.ready) {
                clearTimeout(timer);
                // Large battles on slower phones need more search time than
                // worker startup. Do not discard a healthy in-progress search.
                timer = setTimeout(timeout, 30000);
                worker.postMessage({ config, snapshot: sim.snapshot() });
                return;
            }
            cleanup();
            if (data.error) { reject(new Error(data.error)); return; }
            resolve(Object.assign(createComputerPlayback(data.commands), { decision: data }));
        };
    });
}
