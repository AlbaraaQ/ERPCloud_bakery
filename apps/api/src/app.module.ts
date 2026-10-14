import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { AuditService } from './audit/audit.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { HealthController } from './health/health.controller';
import { JobsService } from './jobs/jobs.service';
@Module({ controllers: [AuthController, HealthController], providers: [PrismaService, AuditService, AuthService, JobsService] })
export class AppModule {}
