import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SalesSnapshot } from '../../core/src/agexa.js';
import { EMPLOYEES, salesCharacterId } from '../../core/src/agexa.js';
import { syncSalesCharacters } from '../src/agexa/pixelBridge.js';
import { updateCharacter } from '../src/office/engine/characters.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import type { OfficeLayout } from '../src/office/types.js';

function snapshot(): SalesSnapshot {
  return {
    version: 1,
    suspended: false,
    inference: { connected: false, provider: 'none', message: 'Sem IA' },
    tasks: [],
    events: [],
    objective: 'Vendas',
    employees: EMPLOYEES.map((e, index) => ({
      ...e,
      characterId: salesCharacterId(index),
      seatId: `agexa-${e.id}-chair`,
      status: 'paused',
      enabled: false,
      currentTask: null,
      completed: 0,
      errors: 0,
      queued: 0,
    })),
  };
}

describe('Commercial pixel bridge', () => {
  it('preserves eight identities and never animates work from configuration alone', () => {
    const layout = JSON.parse(
      fs.readFileSync(path.resolve('public/assets/agexa-layout.json'), 'utf8'),
    ) as OfficeLayout;
    const office = new OfficeState(layout);
    const state = snapshot();
    syncSalesCharacters(office, state);
    expect(office.characters.size).toBe(8);
    for (const e of state.employees) {
      const ch = office.characters.get(e.characterId)!;
      expect(ch.agentName).toBe(e.name);
      expect(ch.isActive).toBe(false);
      const frame = ch.frame;
      const x = ch.x;
      updateCharacter(ch, 30, [], office.seats, office.tileMap, office.blockedTiles);
      expect(ch.frame).toBe(frame);
      expect(ch.x).toBe(x);
      expect(ch.isActive).toBe(false);
    }
    state.employees[0].status = 'working';
    syncSalesCharacters(office, state);
    expect(office.characters.get(state.employees[0].characterId)?.isActive).toBe(true);
    syncSalesCharacters(office, state, false);
    expect(office.characters.get(state.employees[0].characterId)?.isActive).toBe(false);
    state.employees[0].status = 'paused';
    syncSalesCharacters(office, state);
    expect(office.characters.get(state.employees[0].characterId)?.isActive).toBe(false);
    expect(Object.keys(office.getPersistableSeats())).toHaveLength(0);
  });
});
