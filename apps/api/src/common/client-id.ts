import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Client-chosen ids (spec 028, used by offline training and nutrition). A device that creates a
 * row with no connection names it itself, so later writes can refer to it before the server has
 * answered. The DTO checks the format (`IsMongoId`); this checks that no row of **any** user
 * already has it, so a guessed id can never reach someone else's data.
 */
export async function assertFreeId(
  model: { exists(filter: { _id: string }): Promise<unknown> },
  id: string | undefined,
): Promise<void> {
  if (!id) return;
  if (await model.exists({ _id: id })) {
    throw new ConflictException({ code: 'ID_TAKEN', message: 'That id is already in use. Try again.' });
  }
}

/** `{ _id }` for a create when the client chose the id, otherwise nothing. */
export const withId = (id: string | undefined) => (id ? { _id: new Types.ObjectId(id) } : {});
