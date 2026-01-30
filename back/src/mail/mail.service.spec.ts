import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';
import { AwsConfigService } from '../aws/aws-config.service';
import { ConfigService } from '@nestjs/config';

describe('MailService', () => {
  let service: MailService;

  const mockAwsConfig = {
    region: 'eu-west-3',
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    fromEmail: 'test@example.com',
    fromName: 'Reloke',
  };

  const mockConfig = {
    get: jest.fn().mockReturnValue('http://localhost:4200'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: AwsConfigService, useValue: mockAwsConfig },
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
