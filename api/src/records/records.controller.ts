import { Controller, Get, Query } from '@nestjs/common';
import { RecordsService } from './records.service';

/**
 * GET /records — lista registros gravados no DynamoDB pela Lambda.
 */
@Controller()
export class RecordsController {
  constructor(private readonly recordsService: RecordsService) {}

  @Get('records')
  findAll(@Query('limit') limit?: string) {
    return this.recordsService.findAll(limit);
  }
}
