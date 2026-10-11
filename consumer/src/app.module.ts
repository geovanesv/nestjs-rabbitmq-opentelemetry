// Módulo raiz do consumer (RFC §7 / F-25).
import { Module } from '@nestjs/common';
import { OrderConsumer } from './order.consumer';

@Module({
  controllers: [OrderConsumer],
  providers: [],
})
export class AppModule {}