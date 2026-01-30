import { Test, TestingModule } from '@nestjs/testing';
import { CaptchaService } from './captcha.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

describe('CaptchaService', () => {
  let service: CaptchaService;

  const mockHttpService = {
    post: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockImplementation((key) => {
      if (key === 'RECAPTCHA_SCORE_THRESHOLD') return 0.5;
      return 'mock_value';
    }),
  };

  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mock_jwt'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CaptchaService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<CaptchaService>(CaptchaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
