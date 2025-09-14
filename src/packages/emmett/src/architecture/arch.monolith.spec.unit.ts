import { emmettArch } from '.';

const guests = emmettArch.component('guests');

const pricing = emmettArch.component('pricing');

const reservations = emmettArch.component('reservations', (ctx) => ({
  relationships: {
    guests: ctx.relationship(
      guests,
      'uses',
      'Gets user information from guests module by externalId',
    ),
    pricing: ctx.relationship(
      pricing,
      'uses',
      'Gets pricing information from pricing module by room type',
    ),
  },
}));

const ccc = reservations.relationships.test;

const hotelManagement = emmettArch.container('hotel-management', {
  guests,
  reservations,
  pricing,
});
