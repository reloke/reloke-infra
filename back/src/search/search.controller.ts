import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Patch,
  Param,
  UseGuards,
  Request,
  ParseIntPipe,
} from '@nestjs/common';
import { SearchService } from './search.service';
import {
  CreateSearchDto,
  UpdateSearchDto,
  SearchResponseDto,
  UpdateSearchPeriodDto,
  StopSearchResponseDto,
  UpdatePeriodResponseDto,
} from './dto/search.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('searches')
@UseGuards(AuthGuard('jwt'))
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * Create a new search profile
   * POST /searches
   */
  @Post()
  create(
    @Request() req,
    @Body() createSearchDto: CreateSearchDto,
  ): Promise<SearchResponseDto> {
    return this.searchService.create(req.user.userId, createSearchDto);
  }

  /**
   * Get the current user's search profile
   * GET /searches/me
   */
  @Get('me')
  findOne(@Request() req): Promise<SearchResponseDto | null> {
    return this.searchService.findOneByUserId(req.user.userId);
  }

  /**
   * Update an existing search profile
   * PUT /searches/:id
   */
  @Put(':id')
  update(
    @Request() req,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateSearchDto: UpdateSearchDto,
  ): Promise<SearchResponseDto> {
    return this.searchService.update(id, req.user.userId, updateSearchDto);
  }

  /**
   * Stop search - user no longer wants to receive matches/emails
   * POST /searches/stop
   */
  @Post('stop')
  stopSearch(@Request() req): Promise<StopSearchResponseDto> {
    return this.searchService.stopSearch(req.user.userId);
  }

  /**
   * Restart search - user wants to receive matches/emails again
   * POST /searches/restart
   */
  @Post('restart')
  restartSearch(@Request() req): Promise<StopSearchResponseDto> {
    return this.searchService.restartSearch(req.user.userId);
  }

  /**
   * Update only the search period dates
   * PATCH /searches/period
   */
  @Patch('period')
  updatePeriod(
    @Request() req,
    @Body() dto: UpdateSearchPeriodDto,
  ): Promise<UpdatePeriodResponseDto> {
    return this.searchService.updatePeriod(req.user.userId, dto);
  }
}
