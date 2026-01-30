import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { MatchingService } from './matching.service';
import { AuthGuard } from '@nestjs/passport';

@Controller('matches')
@UseGuards(AuthGuard('jwt'))
export class MatchingController {
  constructor(private readonly matchingService: MatchingService) {}

  @Get('potential')
  findPotentialMatches(@Request() req) {
    return this.matchingService.findMatchesForUser(req.user.userId);
  }

  @Post(':intentId/request')
  requestMatch(
    @Request() req,
    @Param('intentId', ParseIntPipe) intentId: number,
  ) {
    return this.matchingService.acceptMatch(req.user.userId, intentId);
  }
}
