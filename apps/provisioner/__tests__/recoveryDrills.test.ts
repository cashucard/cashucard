import {RecoveryDrill, type DrillState} from '../src/recoveryDrills';

test('a boundary pause is one-shot, resumes only deliberately, and rearming never persists state', async () => {
  let state: DrillState = {target: null, paused: null};
  const drill = new RecoveryDrill(next => {
    state = next;
  });
  drill.arm('installation-saved');
  await drill.checkpoint('install-intent-saved');
  const pending = drill.checkpoint('installation-saved');
  expect(state).toEqual({target: null, paused: 'installation-saved'});
  expect(() => drill.arm('rotation-saved')).toThrow('cannot be armed');
  drill.resume();
  await pending;
  await drill.checkpoint('installation-saved');
  expect(state).toEqual({target: null, paused: null});
  drill.arm('rotation-saved');
  drill.cancel();
  await drill.checkpoint('rotation-saved');
  expect(state).toEqual({target: null, paused: null});
});
