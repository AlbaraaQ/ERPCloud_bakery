import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}
  @Get() live() { return { status: 'ok', service: 'erpcloud-api', time: new Date().toISOString() }; }
  @Get('ready') async ready(@Res() res: Response) {
    let db = false; try { db = await this.prisma.ping(); } catch { db = false; }
    const body = { status: db ? 'ready' : 'degraded', db, time: new Date().toISOString() };
    return res.status(db ? 200 : 503).json(body);
  }
}
