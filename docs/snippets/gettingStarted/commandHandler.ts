// #region command-handler
import { CommandHandler } from '@event-driven-io/emmett';
import { evolve, getInitialState } from './shoppingCart';

export const handle = CommandHandler(evolve, getInitialState);
// #endregion command-handler
