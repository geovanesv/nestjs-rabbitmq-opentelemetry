// API de pedidos (RFC §7.5 / F-17).
// POST /orders → 201; GET /orders → lista; GET /orders/:id → 200 | 404.
import { Body, Controller, Get, NotFoundException, Param, Post } from '@nestjs/common';
import { CreateOrderDto } from './order.dto';
import { Order } from './order.interface';
import { OrderService } from './order.service';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.orderService.createOrder(dto);
  }

  @Get()
  list(): Order[] {
    return this.orderService.getOrders();
  }

  @Get(':id')
  getOne(@Param('id') id: string): Order {
    const order = this.orderService.getById(id);
    if (order === undefined) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return order;
  }
}