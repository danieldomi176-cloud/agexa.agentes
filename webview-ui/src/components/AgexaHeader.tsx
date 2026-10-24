import { isBrowserRuntime } from '../runtime.js';

/** Phase-one identity; never represents the future sales engine as running. */
export function AgexaHeader() {
  const simulated = isBrowserRuntime && import.meta.env.DEV;
  return (
    <header className="agexa-header">
      <div>
        <strong>AGEXA AI OFFICE</strong>
        <span className="agexa-slogan">Organização que trabalha por ti.</span>
      </div>
      <p role="status">
        {simulated ? 'SIMULAÇÃO VISUAL · dados de demonstração' : 'FASE 1 · base Pixel Agents'}
        <span className="agexa-stage">Motor comercial ainda não implementado</span>
      </p>
    </header>
  );
}
