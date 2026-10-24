import type { SalesSnapshot } from '../../../core/src/agexa.js';
import type { OfficeState } from '../office/engine/officeState.js';

/** Only actual backend work can turn on a commercial character's work animation. */
export function syncSalesCharacters(
  office: OfficeState,
  snapshot: SalesSnapshot,
  live = true,
): void {
  const labels: Record<string, string> = {
    paused: 'Pausado',
    available: 'Disponível',
    working: 'A trabalhar',
    awaiting_approval: 'Aguarda aprovação',
    blocked: 'Sem IA',
    error: 'Erro',
  };
  for (const employee of snapshot.employees) {
    office.addAgent(
      employee.characterId,
      employee.palette,
      employee.hue,
      employee.seatId,
      true,
      employee.area,
    );
    const character = office.characters.get(employee.characterId);
    if (!character) continue;
    character.agentName = employee.name;
    character.commercialStatus = live ? labels[employee.status] : 'Sem ligação';
    character.commercialTask = live
      ? snapshot.tasks.find((t) => t.id === employee.currentTask)?.objective
      : undefined;
    character.commercialRole = employee.role;
    office.setAgentActive(employee.characterId, live && employee.status === 'working');
    office.setAgentTool(
      employee.characterId,
      live && employee.status === 'working' ? 'Read' : null,
    );
  }
}
