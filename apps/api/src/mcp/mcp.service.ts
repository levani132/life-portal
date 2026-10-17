import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { toDay } from '@life-portal/shared-domain';
import { CONFIG, type AppConfig } from '../config/configuration';
import { NutritionService } from '../nutrition/nutrition.service';

/** MCP token payload. */
interface McpPayload {
  sub: string;
  typ: 'mcp';
  iat: number;
  exp: number;
}

/** Tool definition for AI discovery. */
interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** One year in seconds. */
const MCP_TOKEN_TTL = 365 * 24 * 60 * 60;

@Injectable()
export class McpService {
  constructor(
    private readonly jwt: JwtService,
    private readonly nutrition: NutritionService,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  /** Generate a long-lived MCP token for AI assistants. */
  generateToken(userId: string): { token: string; expiresAt: string } {
    const expiresAt = new Date(Date.now() + MCP_TOKEN_TTL * 1000);
    const token = this.jwt.sign(
      { sub: userId, typ: 'mcp' } as Omit<McpPayload, 'iat' | 'exp'>,
      { expiresIn: MCP_TOKEN_TTL },
    );
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** Verify an MCP token and return the user ID. */
  async verifyToken(token: string): Promise<string> {
    try {
      const payload = this.jwt.verify<McpPayload>(token);
      if (payload.typ !== 'mcp') {
        throw new UnauthorizedException('Invalid token type');
      }
      return payload.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired MCP token');
    }
  }

  /** List all available tools for AI discovery. */
  listTools(): { tools: McpTool[] } {
    return {
      tools: [
        {
          name: 'get_nutrition_day',
          description:
            'Get full nutrition data for a specific day including all meals, macros, and targets. Returns what was eaten, totals, and how it compares to goals.',
          inputSchema: {
            type: 'object',
            properties: {
              day: {
                type: 'string',
                description: 'Date in YYYY-MM-DD format. Defaults to today if not provided.',
              },
            },
          },
        },
        {
          name: 'log_meal',
          description:
            'Log a meal entry. Requires a food ID from the database, amount in grams/ml, and the meal slot.',
          inputSchema: {
            type: 'object',
            properties: {
              foodId: { type: 'string', description: 'MongoDB ID of the food from the database' },
              day: { type: 'string', description: 'Date in YYYY-MM-DD format' },
              slot: {
                type: 'string',
                enum: ['breakfast', 'lunch', 'dinner', 'snack', 'uncategorized'],
                description: 'Meal slot',
              },
              amount: { type: 'number', description: 'Amount in base units (grams or ml)' },
              servings: { type: 'number', description: 'Number of servings (alternative to amount)' },
              note: { type: 'string', description: 'Optional note about the meal' },
            },
            required: ['foodId', 'day', 'slot'],
          },
        },
        {
          name: 'update_meal',
          description: 'Update an existing meal entry. Can change amount, slot, day, or note.',
          inputSchema: {
            type: 'object',
            properties: {
              entryId: { type: 'string', description: 'MongoDB ID of the meal entry' },
              day: { type: 'string', description: 'New date in YYYY-MM-DD format' },
              slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'uncategorized'] },
              amount: { type: 'number', description: 'New amount in base units' },
              servings: { type: 'number', description: 'New number of servings' },
              note: { type: 'string', description: 'New note' },
            },
            required: ['entryId'],
          },
        },
        {
          name: 'delete_meal',
          description: 'Delete a meal entry by its ID.',
          inputSchema: {
            type: 'object',
            properties: {
              entryId: { type: 'string', description: 'MongoDB ID of the meal entry to delete' },
            },
            required: ['entryId'],
          },
        },
        {
          name: 'list_foods',
          description:
            'List foods from the user\'s food database. Can filter by search query or favourites.',
          inputSchema: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Search query to filter foods by name or brand' },
              favourite: { type: 'boolean', description: 'Only return favourite foods' },
              includeArchived: { type: 'boolean', description: 'Include archived foods' },
            },
          },
        },
        {
          name: 'create_food',
          description:
            'Add a new food to the database. Requires name, serving size, and macros (energy, protein, fat, carbs).',
          inputSchema: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Food name' },
              brand: { type: 'string', description: 'Brand name (optional)' },
              unit: { type: 'string', enum: ['g', 'ml'], description: 'Base unit (grams or ml)' },
              servingSize: { type: 'number', description: 'Serving size in base units' },
              servingLabel: { type: 'string', description: 'Serving label like "1 slice"' },
              energyKcal: { type: 'number', description: 'Calories per serving' },
              proteinMg: { type: 'number', description: 'Protein in milligrams per serving' },
              fatMg: { type: 'number', description: 'Fat in milligrams per serving' },
              carbMg: { type: 'number', description: 'Carbohydrates in milligrams per serving' },
              fibreMg: { type: 'number', description: 'Fibre in milligrams per serving (optional)' },
              favourite: { type: 'boolean', description: 'Mark as favourite' },
              notes: { type: 'string', description: 'Notes about the food' },
            },
            required: ['name', 'servingSize', 'energyKcal', 'proteinMg', 'fatMg', 'carbMg'],
          },
        },
        {
          name: 'update_food',
          description: 'Update an existing food in the database.',
          inputSchema: {
            type: 'object',
            properties: {
              foodId: { type: 'string', description: 'MongoDB ID of the food' },
              name: { type: 'string' },
              brand: { type: 'string' },
              servingSize: { type: 'number' },
              energyKcal: { type: 'number' },
              proteinMg: { type: 'number' },
              fatMg: { type: 'number' },
              carbMg: { type: 'number' },
              favourite: { type: 'boolean' },
              archived: { type: 'boolean' },
              notes: { type: 'string' },
            },
            required: ['foodId'],
          },
        },
        {
          name: 'delete_food',
          description: 'Delete a food from the database. Foods that have been logged are archived instead.',
          inputSchema: {
            type: 'object',
            properties: {
              foodId: { type: 'string', description: 'MongoDB ID of the food to delete' },
            },
            required: ['foodId'],
          },
        },
        {
          name: 'get_profile',
          description:
            'Get the user\'s nutrition profile including goals, activity level, and calculated targets.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'update_profile',
          description:
            'Update the user\'s nutrition profile. Can set sex, height, birth date, activity level, goal, and manual target overrides.',
          inputSchema: {
            type: 'object',
            properties: {
              sex: { type: 'string', enum: ['male', 'female'] },
              heightCm: { type: 'number', description: 'Height in centimeters' },
              birthDate: { type: 'string', description: 'Birth date in YYYY-MM-DD format' },
              activityLevel: {
                type: 'string',
                enum: ['sedentary', 'light', 'moderate', 'very', 'athlete'],
              },
              goal: {
                type: 'string',
                enum: ['pure_weight_loss', 'fat_loss', 'recomp', 'maintain', 'lean_gain', 'max_gain'],
              },
              energyOverrideKcal: { type: 'number', description: 'Manual calorie target override' },
              proteinOverrideG: { type: 'number', description: 'Manual protein target in grams' },
              fatOverrideG: { type: 'number', description: 'Manual fat target in grams' },
              carbOverrideG: { type: 'number', description: 'Manual carb target in grams' },
            },
          },
        },
        {
          name: 'log_weight',
          description: 'Log a weigh-in for a specific day.',
          inputSchema: {
            type: 'object',
            properties: {
              day: { type: 'string', description: 'Date in YYYY-MM-DD format. Defaults to today.' },
              weightGrams: { type: 'number', description: 'Weight in grams (e.g., 75000 for 75kg)' },
              bodyFatPct: { type: 'number', description: 'Body fat percentage as decimal (e.g., 0.18 for 18%)' },
              note: { type: 'string', description: 'Optional note' },
            },
            required: ['weightGrams'],
          },
        },
        {
          name: 'get_weigh_ins',
          description: 'Get all weigh-in records.',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    };
  }

  /** OpenAPI 3.0 schema for ChatGPT Actions. */
  openApiSchema(baseUrl: string) {
    return {
      openapi: '3.0.0',
      info: {
        title: 'Life Portal Nutrition API',
        version: '1.0.0',
        description: 'AI assistant API for nutrition tracking in Life Portal',
      },
      servers: [{ url: baseUrl }],
      paths: {
        '/call': {
          post: {
            operationId: 'callTool',
            summary: 'Execute a nutrition tool',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['tool'],
                    properties: {
                      tool: {
                        type: 'string',
                        enum: [
                          'get_nutrition_day', 'log_meal', 'update_meal', 'delete_meal',
                          'list_foods', 'create_food', 'update_food', 'delete_food',
                          'get_profile', 'update_profile', 'log_weight', 'get_weigh_ins',
                        ],
                        description: 'Tool to execute',
                      },
                      arguments: {
                        type: 'object',
                        description: 'Tool arguments (see /tools for schema)',
                      },
                    },
                  },
                },
              },
            },
            responses: {
              '200': { description: 'Tool result' },
              '401': { description: 'Invalid or missing token' },
            },
            security: [{ bearerAuth: [] }],
          },
        },
        '/tools': {
          get: {
            operationId: 'listTools',
            summary: 'List available tools and their schemas',
            responses: { '200': { description: 'Tool definitions' } },
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    };
  }

  /** Execute a tool and return the result. */
  async callTool(
    userId: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<{ result: unknown }> {
    const today = toDay(new Date().toISOString());

    switch (tool) {
      case 'get_nutrition_day': {
        const day = (args.day as string) || today;
        const overview = await this.nutrition.overview(userId, today, day);
        return {
          result: {
            day: overview.day,
            totals: overview.dayTotals.totals,
            slots: overview.dayTotals.slots,
            entryCount: overview.dayTotals.entryCount,
            targets: overview.targets,
            week: overview.week,
          },
        };
      }

      case 'log_meal': {
        const entry = await this.nutrition.createEntry(userId, {
          foodId: args.foodId as string,
          day: args.day as string,
          slot: args.slot as string,
          amount: args.amount as number | undefined,
          servings: args.servings as number | undefined,
          note: args.note as string | undefined,
        });
        return { result: entry };
      }

      case 'update_meal': {
        const entry = await this.nutrition.updateEntry(userId, args.entryId as string, {
          day: args.day as string | undefined,
          slot: args.slot as string | undefined,
          amount: args.amount as number | undefined,
          servings: args.servings as number | undefined,
          note: args.note as string | undefined,
        });
        return { result: entry };
      }

      case 'delete_meal': {
        const result = await this.nutrition.removeEntry(userId, args.entryId as string);
        return { result };
      }

      case 'list_foods': {
        const foods = await this.nutrition.listFoods(userId, {
          q: args.q as string | undefined,
          favourite: args.favourite as boolean | undefined,
          includeArchived: args.includeArchived as boolean | undefined,
        });
        return { result: foods };
      }

      case 'create_food': {
        const food = await this.nutrition.createFood(userId, {
          name: args.name as string,
          brand: args.brand as string | undefined,
          unit: (args.unit as string) || 'g',
          servingSize: args.servingSize as number,
          servingLabel: args.servingLabel as string | undefined,
          energyKcal: args.energyKcal as number,
          proteinMg: args.proteinMg as number,
          fatMg: args.fatMg as number,
          carbMg: args.carbMg as number,
          fibreMg: args.fibreMg as number | undefined,
          favourite: args.favourite as boolean | undefined,
          notes: args.notes as string | undefined,
        });
        return { result: food };
      }

      case 'update_food': {
        const food = await this.nutrition.updateFood(userId, args.foodId as string, {
          name: args.name as string | undefined,
          brand: args.brand as string | undefined,
          servingSize: args.servingSize as number | undefined,
          energyKcal: args.energyKcal as number | undefined,
          proteinMg: args.proteinMg as number | undefined,
          fatMg: args.fatMg as number | undefined,
          carbMg: args.carbMg as number | undefined,
          favourite: args.favourite as boolean | undefined,
          archived: args.archived as boolean | undefined,
          notes: args.notes as string | undefined,
        });
        return { result: food };
      }

      case 'delete_food': {
        const result = await this.nutrition.removeFood(userId, args.foodId as string);
        return { result };
      }

      case 'get_profile': {
        const [profile, targets] = await Promise.all([
          this.nutrition.profile(userId),
          this.nutrition.targets(userId, today),
        ]);
        return { result: { profile, targets } };
      }

      case 'update_profile': {
        const profile = await this.nutrition.updateProfile(userId, {
          sex: args.sex as string | undefined,
          heightCm: args.heightCm as number | undefined,
          birthDate: args.birthDate as string | undefined,
          activityLevel: args.activityLevel as string | undefined,
          goal: args.goal as string | undefined,
          energyOverrideKcal: args.energyOverrideKcal as number | undefined,
          proteinOverrideG: args.proteinOverrideG as number | undefined,
          fatOverrideG: args.fatOverrideG as number | undefined,
          carbOverrideG: args.carbOverrideG as number | undefined,
        });
        const targets = await this.nutrition.targets(userId, today);
        return { result: { profile, targets } };
      }

      case 'log_weight': {
        const weighIn = await this.nutrition.upsertWeighIn(userId, today, {
          day: args.day as string | undefined,
          weightGrams: args.weightGrams as number,
          bodyFatPct: args.bodyFatPct as number | undefined,
          note: args.note as string | undefined,
        });
        return { result: weighIn };
      }

      case 'get_weigh_ins': {
        const weighIns = await this.nutrition.listWeighIns(userId);
        return { result: weighIns };
      }

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }
}
