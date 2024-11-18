import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaClient } from '@prisma/client';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { OrderPaginationDto } from './dto/order-pagination.dto';
import { ChangeOrderStatusDto } from './dto/change-order-status.dto';
import { NATS_SERVICE } from 'src/config';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrdersService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger('OrdersService');

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
  ) {
    super();
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async create(createOrderDto: CreateOrderDto) {
    try {
      // 1 Confirmar los ids de los productos
      const productIds: any[] = createOrderDto.items.map(
        (item) => item.productId,
      );
      const products: any[] = await firstValueFrom(
        this.client.send({ cmd: 'validate_products' }, productIds),
      );

      // 2 Cálculos de los valores
      const totalAmount = createOrderDto.items.reduce((acc, orderItem) => {
        const price = products.find(
          (product) => product.id === orderItem.productId,
        ).price;

        return price * orderItem.quantity;
      }, 0);

      const totalItems = createOrderDto.items.reduce((acc, orderItem) => {
        return acc + orderItem.quantity;
      }, 0);

      // 3 Crear una transacción de base de datos
      const order = await this.order.create({
        data: {
          totalAmount,
          totalItems,
          OrderItem: {
            createMany: {
              data: createOrderDto.items.map((orderItem) => ({
                quantity: orderItem.quantity,
                productId: orderItem.productId,
                price: products.find(
                  (product) => product.id === orderItem.productId,
                ).price,
              })),
            },
          },
        },
        include: {
          OrderItem: {
            select: {
              price: true,
              quantity: true,
              productId: true
            }
          }
        }
      });

      return {
        ...order,
        OrderItem: order.OrderItem.map((orderItem) => ({
          ...orderItem,
          name: products.find(product => product.id === orderItem.productId).name
        }))
      };

    } catch (error) {
      console.error(error);
      throw new RpcException({
        status: HttpStatus.BAD_REQUEST,
        message: 'Check logs',
      });
    }
    //return createOrderDto;
    // const products = this.//productsclient
    // return this.order.create({ data: createOrderDto });
  }

  async findAll(orderPaginationDto: OrderPaginationDto) {
    const { page, limit, status } = orderPaginationDto;

    const totalPages = await this.order.count({ where: { status } });
    const lastPage = Math.ceil(totalPages / limit);

    return {
      data: await this.order.findMany({
        skip: (page - 1) * limit,
        take: limit,
        where: { status },
      }),
      meta: {
        page: page,
        total: totalPages,
        limit: limit,
        status: status || 'ALL',
        lastPage: lastPage,
      },
    };
  }

  async findOne(id: string) {
    const order = await this.order.findFirst({ 
      where: { id: id },
    include: {
      OrderItem: {
        select: {
          price: true,
          quantity: true,
          productId: true
        }
      }
    } });

    if (!order) {
      throw new RpcException({
        message: `Order with id ${id} not found`,
        status: HttpStatus.NOT_FOUND,
      });
    }

    const productIds: any[] = order.OrderItem.map(
      (item) => item.productId,
    );
    const products: any[] = await firstValueFrom(
      this.client.send({ cmd: 'validate_products' }, productIds),
    );

    return {
      ...order,
      OrderItem: order.OrderItem.map(
        (orderItem) => ({
          ...orderItem,
          name: products.find(product => product.id === orderItem.productId).name}),
      )
    };
  }

  async changeStatus(changeOrderStatusDto: ChangeOrderStatusDto) {
    const order = await this.findOne(changeOrderStatusDto.id);

    if (order.status === changeOrderStatusDto.status) {
      return order;
    }

    return this.order.update({
      where: { id: changeOrderStatusDto.id },
      data: { status: changeOrderStatusDto.status },
    });
  }
}
