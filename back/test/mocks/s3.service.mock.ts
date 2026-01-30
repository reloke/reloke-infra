import { S3Service } from '../../src/home/services/s3.service';

/**
 * Mock version of S3Service for unit testing.
 * Implements the same interface as S3Service but without using AWS SDK or filesystem.
 */
export const S3ServiceMock: Partial<Record<keyof S3Service, jest.Mock>> = {
  uploadFile: jest
    .fn()
    .mockImplementation(async (buffer: Buffer, key: string) => {
      return key;
    }),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  deleteFiles: jest.fn().mockResolvedValue(undefined),
  getPublicUrl: jest
    .fn()
    .mockImplementation(
      (key: string) => `https://mock-s3.amazonaws.com/${key}`,
    ),
  generateObjectKey: jest
    .fn()
    .mockImplementation(
      (userId, homeId, filename) =>
        `homes/${userId}/${homeId}/mock-${filename}`,
    ),
};
