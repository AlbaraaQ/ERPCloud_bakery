import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { AuditService } from './audit/audit.service';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { HealthController } from './health/health.controller';
import { JobsService } from './jobs/jobs.service';
import { AccountingService } from './accounting/accounting.service';
import { AccountingController } from './accounting/accounting.controller';
import { InventoryService } from './inventory/inventory.service';
import { InventoryController } from './inventory/inventory.controller';
import { AuthMiddleware } from './auth/auth.middleware';
import { PermissionsGuard } from './rbac/permissions.guard';
import { APP_GUARD } from '@nestjs/core';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
@Module({ controllers: [AuthController, HealthController, AccountingController, InventoryController], providers: [PrismaService, AuditService, AuthService, JobsService, AccountingService, InventoryService, { provide: APP_GUARD, useClass: PermissionsGuard }] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(AuthMiddleware).forRoutes(AccountingController, InventoryController); }
}
