// DTO de criação de pedido (RFC §7.2 / D-015 / F-15).
// Validação de runtime — o material validaria só em compile-time.
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^CUST-[A-Za-z0-9-]+$/)
  customerId!: string;

  @IsNumber()
  @Min(0.01)
  @Max(1_000_000)
  @Type(() => Number)
  amount!: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  items!: string[];
}