import { Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';

@Injectable()
export class UserService {
  constructor(private prisma: DbService) {}

  async getPublicInformation(id: number): Promise<object> {
    const userPublicInformation: any = await this.prisma.user.findUniqueOrThrow(
      {
        where: { id },
        select: {
          username: true,
          description: true,
        },
      },
    );
    return userPublicInformation;
  }

  async getUserActivity(
    userId: number,
    from: Date,
    to: Date,
    requestedBy: number,
  ) {
    const inclusiveTo = new Date(to);
    inclusiveTo.setDate(inclusiveTo.getDate() + 1);

    const data = await this.prisma.user.findFirst({
      where: { id: userId },
      select: {
        id: true,
        rulesets: {
          select: {
            id: true,
            name: true,
          },
          where: {
            createdAt: {
              gte: new Date(from),
              lte: inclusiveTo,
            },
          },
        },
        Environment: {
          select: {
            id: true,
            isPrivate: true,
            name: true,
          },
          where: {
            createdAt: {
              gte: new Date(from),
              lte: inclusiveTo,
            },
          },
        },
      },
    });
    const environmentsToReturn = [];
    data.Environment.forEach((env) => {
      if (env.isPrivate) {
        if (data.id === requestedBy) {
          environmentsToReturn.push(env);
        }
      } else {
        environmentsToReturn.push(env);
      }
    });

    return {
      createdRulesets: data.rulesets,
      createdEnvironments: environmentsToReturn,
    };
  }
}
