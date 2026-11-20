import { ForbiddenException } from '@nestjs/common';
import { ROADMAP } from './roadmap.data';
import { RoadmapController } from './roadmap.module';

const access = {
  requireDeveloper: (userId: string) => {
    if (userId !== 'dev') throw new ForbiddenException('Developer access required.');
  },
};

describe('roadmap', () => {
  it('is for the developer only', () => {
    const controller = new RoadmapController(access as never);
    expect(controller.read('dev')).toBe(ROADMAP);
    expect(() => controller.read('ana')).toThrow(ForbiddenException);
  });

  it('has an order, with something done and something next', () => {
    expect(ROADMAP.steps.length).toBeGreaterThan(5);
    expect(ROADMAP.steps.some((step) => step.status === 'done')).toBe(true);
    expect(ROADMAP.steps.some((step) => step.status === 'next')).toBe(true);
  });
});
