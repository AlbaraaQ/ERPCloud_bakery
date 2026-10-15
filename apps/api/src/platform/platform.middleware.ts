import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { PlatformService } from './platform.service';
@Injectable()
export class PlatformMiddleware implements NestMiddleware {
  constructor(private svc: PlatformService) {}
  async use(req: Request, _res: Response, next: NextFunction) {
    if (req.path.endsWith('/platform/login')) return next();
    const token = (req as any).cookies?.platform_session;
    if (!token) throw new UnauthorizedException('جلسة المنصة مطلوبة');
    (req as any).platformUser = await this.svc.authenticate(token);
    return next();
  }
}
