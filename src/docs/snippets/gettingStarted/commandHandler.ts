// #region command-handler
import { CommandHandler } from '@event-driven-io/emmett';
import { evolve, initialState } from './shoppingCart';

export const handle = CommandHandler({ evolve, initialState });
// #endregion command-handler
