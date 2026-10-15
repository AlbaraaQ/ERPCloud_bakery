import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
/** DB-backed outbox/jobs skeleton (D-006): enqueue inside business transactions; worker claims with backoff. */
@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}
  async enqueue(tx: any, input: { tenantId?: string; type: string; payload: unknown }) {
    return tx.outboxEvent.create({ data: { tenantId: input.tenantId ?? null, type: input.type, payload: input.payload as never } });
  }
  backoffMs(attempt: number): number { const base = Math.min(15*60_000, 5_000 * 2 ** attempt); return base + Math.floor(Math.random()*1000); } // + jitter
}
