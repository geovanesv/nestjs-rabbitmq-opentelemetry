// Health check do producer (RFC §7.5 / F-18).
import { Controller, Get } from '@nestjs/common';
import { config } from './config';

@Controller()
export class HealthController {
  @Get('health')
  health(): {
    status: string;
    service: string;
    version: string;
    uptime: number;
  } {
    return {
      status: 'ok',
      service: 'producer-service',
      version: config.serviceVersion,
      uptime: process.uptime(),
    };
  }
}
