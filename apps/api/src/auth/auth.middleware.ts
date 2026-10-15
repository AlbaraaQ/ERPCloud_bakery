import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service';
import { tenantStorage } from '../tenancy/tenant-context';
/** Authenticates the session cookie and opens the tenant ALS context for the whole request.
 *  Tenant identity comes only from the server-side session — never from client input. */
@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private auth: AuthService) {}
  async use(req: Request, _res: Response, next: NextFunction) {
    const token = (req as any).cookies?.erp_session;
    if (!token) throw new UnauthorizedException('غير مصرح — سجّل الدخول أولاً');
    const ctx = await this.auth.authenticate(token);
    (req as any).tenantCtx = ctx;
    tenantStorage.run(ctx, () => next());
  }
}
