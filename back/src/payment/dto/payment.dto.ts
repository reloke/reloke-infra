import { IsNumber, IsString, IsNotEmpty } from 'class-validator';

export class CreateOrderDto {
  @IsNumber()
  amount: number;

  @IsString()
  @IsNotEmpty()
  packId: string; // e.g., 'PACK_5_MATCHES'
}
