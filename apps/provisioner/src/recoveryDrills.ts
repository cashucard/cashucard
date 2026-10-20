/** Validation-build controls only. Never persisted alongside card evidence. */
import {TransportError} from './cardkit';

export const RECOVERY_BOUNDARIES = [
  'install-intent-saved',
  'installation-verified-before-save',
  'installation-saved',
  'rotation-intent-saved',
  'rotation-verified-before-save',
  'rotation-saved',
  'record-frozen-session-closed',
] as const;
export type RecoveryBoundary = (typeof RECOVERY_BOUNDARIES)[number];
export interface DrillState {
  target: RecoveryBoundary | null;
  paused: RecoveryBoundary | null;
}
export class RecoveryDrill {
  private state: DrillState = {target: null, paused: null};
  private waiter?: {resolve(): void; reject(error: Error): void};
  constructor(private readonly changed: (state: DrillState) => void) {}
  arm(target: RecoveryBoundary | null): void {
    if (
      this.waiter ||
      (target !== null && !RECOVERY_BOUNDARIES.includes(target))
    ) {
      throw new Error('drill cannot be armed');
    }
    this.update({target, paused: null});
  }
  async checkpoint(boundary: RecoveryBoundary): Promise<void> {
    if (this.state.target !== boundary) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      this.waiter = {resolve, reject};
      this.update({target: null, paused: boundary});
    });
  }
  resume(): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    this.update({target: null, paused: null});
    waiter?.resolve();
  }
  cancel(): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    this.update({target: null, paused: null});
    waiter?.reject(new TransportError('Recovery drill stopped'));
  }
  private update(state: DrillState): void {
    if (
      state.target === this.state.target &&
      state.paused === this.state.paused
    ) {
      return;
    }
    this.state = state;
    this.changed({...state});
  }
}
