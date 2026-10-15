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
import { PartiesService } from './parties/parties.service';
import { PartiesController } from './parties/parties.controller';
import { SalesService } from './sales/sales.service';
import { SalesController } from './sales/sales.controller';
import { PurchasingService } from './purchasing/purchasing.service';
import { PurchasingController } from './purchasing/purchasing.controller';
import { CashService } from './cash/cash.service';
import { CashController } from './cash/cash.controller';
import { NotificationsService } from './notifications/notifications.service';
import { RepresentativesService } from './representatives/representatives.service';
import { TransfersService } from './transfers/transfers.service';
import { SettlementsService } from './settlements/settlements.service';
import { SyncService } from './sync/sync.service';
import { RepresentativesController } from './representatives/representatives.controller';
import { StockCountsService } from './inventory/inventory.service';
import { ManufacturingService } from './manufacturing/manufacturing.service';
import { ManufacturingController } from './manufacturing/manufacturing.controller';
import { TaxService } from './tax/tax.service';
import { TaxController } from './tax/tax.controller';
import { HttpZatcaGateway } from './tax/zatca.gateway';
import { PermissionsGuard } from './rbac/permissions.guard';
import { APP_GUARD } from '@nestjs/core';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
@Module({ controllers: [AuthController, HealthController, AccountingController, InventoryController, PartiesController, SalesController, PurchasingController, CashController, RepresentativesController, ManufacturingController, TaxController], providers: [PrismaService, AuditService, AuthService, JobsService, AccountingService, InventoryService, PartiesService, SalesService, PurchasingService, CashService, NotificationsService, RepresentativesService, TransfersService, SettlementsService, SyncService, StockCountsService, ManufacturingService, TaxService, HttpZatcaGateway, { provide: APP_GUARD, useClass: PermissionsGuard }] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(AuthMiddleware).forRoutes(AccountingController, InventoryController, PartiesController, SalesController, PurchasingController, CashController, RepresentativesController, ManufacturingController, TaxController); }
}
