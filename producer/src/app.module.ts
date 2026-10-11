// Módulo raiz do producer (RFC §7 / F-12).
// Registra o ClientProxy RMQ ('ORDER_SERVICE') usado para publicar em orders_queue.
// OrderController/OrderService são adicionados no WP-05.
import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { HealthController } from './health.controller';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { rabbitmqConfig } from './rabbitmq.config';

@Module({
  imports: [
    ClientsModule.register([{ name: 'ORDER_SERVICE', ...rabbitmqConfig }]),
  ],
  controllers: [OrderController, HealthController],
  providers: [OrderService],
})
export class AppModule {}
