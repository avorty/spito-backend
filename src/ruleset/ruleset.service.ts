import { HttpException, Injectable } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { CreateRulesetDto } from './dto/createRuleset.dto';
import { Prisma } from '@prisma/client';
import { UpdateRulesetDto } from './dto/updateRuleset.dto';
import { PublishRulesDto } from './dto/publishRules.dto';
import { sha512 } from 'js-sha512';

@Injectable()
export class RulesetService {
  constructor(private readonly prisma: DbService) {}

  async getRulesets(
    search?: string,
    skip = 0,
    take = 10,
    requestedBy?: number,
  ) {
    const whereParams = {};

    if (search) {
      whereParams['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const rulesets: any = await this.prisma.ruleset.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        url: true,
        createdAt: true,
        updatedAt: true,
        rulesetTags: {
          select: {
            tag: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        rules: {
          select: {
            id: true,
            name: true,
            path: true,
          },
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
        },
        user: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      where: whereParams,
      skip,
      take,
    });

    const count = await this.prisma.ruleset.count({
      where: whereParams,
    });

    for (const ruleset of rulesets) {
      const rules = await this.assignLikesToRules(ruleset.rules, requestedBy);
      ruleset.rules = rules;
      ruleset.tags = ruleset.rulesetTags.map((rulesetTag) => {
        return { id: rulesetTag.tag.id, name: rulesetTag.tag.name };
      });
      ruleset.rulesetTags = undefined;
    }

    return {
      data: rulesets,
      totalRulesets: count,
    };
  }

  async getUserRulesets(
    userId: number,
    skip = 0,
    take = 10,
    requestedBy?: number,
  ) {
    const rulesets: any = await this.prisma.ruleset.findMany({
      select: {
        id: true,
        name: true,
        description: true,
        url: true,
        createdAt: true,
        updatedAt: true,
        rulesetTags: {
          select: {
            tag: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        rules: {
          select: {
            id: true,
            name: true,
            path: true,
            createdAt: true,
          },
          take: 10,
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
      where: {
        userId,
      },
      skip,
      take,
    });

    const totalNumberOfRulesets = await this.prisma.ruleset.count({
      where: {
        userId,
      },
    });

    for (const ruleset of rulesets) {
      const rules = await this.assignLikesToRules(ruleset.rules, requestedBy);
      ruleset.rules = rules;
      ruleset.tags = ruleset.rulesetTags.map((rulesetTag) => {
        return { id: rulesetTag.tag.id, name: rulesetTag.tag.name };
      });
      ruleset.rulesetTags = undefined;
    }

    return {
      data: rulesets,
      count: totalNumberOfRulesets,
    };
  }

  async createRuleset(dto: CreateRulesetDto, userId: number) {
    const extractedRepoNameAndOwner = this.extractRepoName(dto.url);
    const normalizedUrl = this.normalizeUrl(dto.url);
    let rulesetId = 0;
    try {
      const ruleset = await this.prisma.ruleset.create({
        data: {
          name: extractedRepoNameAndOwner,
          description: dto.description,
          url: normalizedUrl,
          user: {
            connect: {
              id: userId,
            },
          },
        },
      });
      rulesetId = ruleset.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          throw new HttpException(
            {
              statusCode: 409,
              message: 'Ruleset with this URL already exists',
              error: 'Conflict',
            },
            409,
          );
        }
      }
    }
    for (const tag of dto.tags) {
      const newTag = await this.prisma.tag.upsert({
        where: {
          name: tag,
        },
        update: {},
        create: {
          name: tag,
        },
      });

      await this.prisma.rulesetTag.create({
        data: {
          ruleset: {
            connect: {
              id: rulesetId,
            },
          },
          tag: {
            connect: {
              id: newTag.id,
            },
          },
        },
      });
    }
    return {
      message: 'Ruleset created successfully',
      status: 201,
    };
  }

  async getRulesetById(id: number, requestedBy?: number) {
    const ruleset = await this.prisma.ruleset.findUnique({
      where: {
        id,
      },
      select: {
        id: true,
        name: true,
        description: true,
        url: true,
        branch: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            username: true,
          },
        },
        rules: {
          select: {
            id: true,
            name: true,
            path: true,
            unsafe: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        rulesetTags: {
          select: {
            tag: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    const rules = await this.assignLikesToRules(ruleset.rules, requestedBy);
    return {
      ...ruleset,
      rulesetTags: undefined,
      tags: ruleset.rulesetTags.map((rulesetTag) => {
        return { id: rulesetTag.tag.id, name: rulesetTag.tag.name };
      }),
      rules,
    };
  }

  async updateRuleset(
    rulesetId: number,
    dto: UpdateRulesetDto,
    userId: number,
  ) {
    const ruleset = await this.getRulesetById(rulesetId);
    if (!ruleset) {
      throw new HttpException(
        {
          statusCode: 404,
          message: 'Ruleset not found',
          error: 'Not Found',
        },
        404,
      );
    }
    if (ruleset.user.id !== userId) {
      throw new HttpException(
        {
          statusCode: 403,
          message: 'You are not allowed to update this ruleset',
          error: 'Forbidden',
        },
        403,
      );
    }
    await this.prisma.ruleset.update({
      where: {
        id: rulesetId,
      },
      data: {
        description: dto.description,
      },
    });
    await this.updateTags(rulesetId, dto.tags, userId);
    return {
      message: 'Ruleset updated successfully',
      status: 200,
    };
  }

  async publishRules(dto: PublishRulesDto, token: string) {
    const tokenFromDb = await this.prisma.token.findUnique({
      where: {
        token: sha512(token).toString(),
      },
    });
    const url = this.normalizeUrl(dto.url);
    const ruleset = await this.prisma.ruleset.findUnique({
      where: {
        url: url,
        userId: tokenFromDb.userId,
      },
    });
    if (!ruleset) {
      throw new HttpException(
        {
          statusCode: 404,
          message: 'Ruleset not found',
          error: 'Not Found',
        },
        404,
      );
    }
    await this.prisma.ruleset.update({
      where: {
        id: ruleset.id,
      },
      data: {
        branch: dto.branch,
      },
    });

    await this.prisma.rule.deleteMany({
      where: {
        rulesetId: ruleset.id,
      },
    });

    await this.prisma.rule.createMany({
      data: dto.rules.map((rule) => {
        return {
          name: rule.name,
          description: rule.description,
          path: rule.path,
          unsafe: rule.unsafe,
          rulesetId: ruleset.id,
        };
      }),
    });
  }

  async updateTags(rulesetId: number, tags: string[], userId: number) {
    const ruleset = await this.getRulesetById(rulesetId);
    if (!ruleset) {
      throw new HttpException(
        {
          statusCode: 404,
          message: 'Ruleset not found',
          error: 'Not Found',
        },
        404,
      );
    }
    if (ruleset.user.id !== userId) {
      throw new HttpException(
        {
          statusCode: 403,
          message: 'You are not allowed to update this ruleset',
          error: 'Forbidden',
        },
        403,
      );
    }
    await this.prisma.rulesetTag.deleteMany({
      where: {
        rulesetId,
      },
    });
    for (const tag of tags) {
      const newTag = await this.prisma.tag.upsert({
        where: {
          name: tag,
        },
        update: {},
        create: {
          name: tag,
        },
      });

      await this.prisma.rulesetTag.create({
        data: {
          ruleset: {
            connect: {
              id: rulesetId,
            },
          },
          tag: {
            connect: {
              id: newTag.id,
            },
          },
        },
      });
    }
  }

  async deleteRuleset(rulesetId: number, userId: number) {
    const ruleset = await this.getRulesetById(rulesetId);
    if (!ruleset) {
      throw new HttpException(
        {
          statusCode: 404,
          message: 'Ruleset not found',
          error: 'Not Found',
        },
        404,
      );
    }
    if (ruleset.user.id !== userId) {
      throw new HttpException(
        {
          statusCode: 403,
          message: 'You are not allowed to delete this ruleset',
          error: 'Forbidden',
        },
        403,
      );
    }
    await this.prisma.ruleset.delete({
      where: {
        id: rulesetId,
      },
    });
    return {
      message: 'Ruleset deleted successfully',
      status: 200,
    };
  }

  private extractRepoName(url: string) {
    if (url.endsWith('.git')) {
      url = url.substring(0, url.length - 4);
    }
    const urlParts = url.split('/');
    return urlParts[urlParts.length - 2] + '/' + urlParts[urlParts.length - 1];
  }

  private normalizeUrl(url: string) {
    if (url.endsWith('.git')) {
      url = url.substring(0, url.length - 4);
    }
    url = url.replace(/\/$/, '');
    url = url.replace(/(^\w+:|^)\/\//, '');
    return url;
  }

  private async assignLikesToRules(rules: any, requestedBy: number) {
    const rulesWithLikes = [];
    for (const rule of rules) {
      const likes = await this.prisma.likedRules.count({
        where: { ruleId: rule.id },
      });
      rule.likes = likes;
      if (requestedBy) {
        const liked = await this.prisma.likedRules.findFirst({
          where: { ruleId: rule.id, userId: requestedBy },
        });
        rule.isLiked = !!liked;
      }
      rulesWithLikes.push(rule);
    }
    return rulesWithLikes;
  }
}
