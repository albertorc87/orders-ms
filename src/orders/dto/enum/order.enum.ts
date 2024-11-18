import { OrderStatus } from '@prisma/client';

export const OrderStatusList = [
  OrderStatus.CANCELLED,
  OrderStatus.PENDING,
  OrderStatus.DELIVERED,
];
