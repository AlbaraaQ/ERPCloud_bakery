import { describe, it, expect } from 'vitest';
import { JobsService } from './jobs.service';
describe('job backoff', () => { const s = new JobsService(null as never);
  it('grows exponentially and caps at 15min + jitter', () => { expect(s.backoffMs(0)).toBeGreaterThanOrEqual(5000); expect(s.backoffMs(20)).toBeLessThanOrEqual(15*60_000+1000); expect(s.backoffMs(3)).toBeGreaterThan(s.backoffMs(1)); }); });
