import { planComputerDecision } from '../engine/computer.js';
self.onmessage = ({ data }) => {
    try { self.postMessage(planComputerDecision(data.config, data.snapshot)); }
    catch (error) { self.postMessage({ error: error.message }); }
};

// Signal readiness after the engine's asynchronous module initialization.
self.postMessage({ ready: true });
