import { Controller, Get } from '@nestjs/common';
import { Public } from './api-key.guard';

@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }
}
