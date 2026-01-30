import {
  Controller,
  Post,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
  Query,
} from '@nestjs/common';
import { InfluencerService } from './influencer.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Role } from '../auth/enums/role.enum';

@Controller('influencers')
export class InfluencerController {
  constructor(private readonly influencerService: InfluencerService) {}

  @Post('admin/:id/generate-link')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async generateLink(@Param('id', ParseIntPipe) id: number) {
    return this.influencerService.generateInfluencerLink(id);
  }

  @Post('admin/:id/send-link')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async sendLink(@Param('id', ParseIntPipe) id: number) {
    return this.influencerService.sendInfluencerLink(id);
  }

  @Get('info')
  async getInfo(@Query('hash') hash: string) {
    return this.influencerService.getInfluencerInfoByHash(hash);
  }
}
