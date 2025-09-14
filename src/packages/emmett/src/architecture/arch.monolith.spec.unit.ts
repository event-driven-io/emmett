import { emmettArch } from '.';

const { component, container, relationship } = emmettArch;

const query =
  <Input, Output>() =>
  (_input: Input) =>
    Promise.resolve<Output>({} as Output);

const getGuestByExternalId = (_externalId: string): Promise<string> =>
  Promise.resolve(_externalId);

const guests = component('guests', {
  components: {},
  ports: {
    requires: {},
    exposes: {
      queries: {
        getGuestByExternalId,
      },
    },
  },
});

const pricing = component('pricing');

const groupReservations = component('group-reservations');

const reservations = component('reservations', {
  components: { groupReservations },
  ports: {
    requires: {
      guests: {
        getGuestByExternalId: query<string, string>(),
      },
    },
    exposes: {},
  },
});

const reservationsToGuests = relationship(
  reservations,
  'provides guest information to',
  guests,
  ({ queries: { getGuestByExternalId } }) => ({
    guests: {
      getGuestByExternalId,
    },
  }),
);

const hotelManagement = container('hotel-management', {
  guests,
  reservations,
  pricing,
});
