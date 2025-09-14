import { emmettArch } from '.';

const { component, container, relationship } = emmettArch;

const guests = component('guests');

const pricing = component('pricing');

const groupReservations = component('group-reservations');

const reservations = component('reservations', {
  components: { groupReservations },
});

const rel1 = relationship(reservations, 'reads guest information from', guests);

const ccc = reservations.components.groupReservations;

const hotelManagement = container('hotel-management', {
  guests,
  reservations,
  pricing,
});
